// textcore.ts — 検査層3スクリプト（lint.ts / outline.ts / terms.ts）の共有基盤。
//
// Python版（sudachipy + textcore.py）からの移植。形態素解析器は sudachipy から
// kuromoji.js（IPADIC辞書）に置き換えた。品詞体系がわずかに異なるため
// （例: sudachiの「補助記号」はkuromojiでは「記号」、sudachiが「格助詞」に
// 分類する連体化の「の」はkuromojiでは pos_detail_1="連体化" になる等）、
// 品詞判定のヘルパーはここで吸収し、呼び出し側（lint.ts等）は
// kuromoji固有の分類名に直接依存しないようにする。
//
// 提供するもの:
//   - kuromoji Tokenizer の遅延初期化（getTokenizer）
//   - 文分割（splitSentencesWithLines 等）
//   - Markdown構造のマスク処理（maskMarkdownStructure / maskHtmlComments）
//   - 行番号付き反復・段落分割ユーティリティ
//   - 入力ファイルの読み込みと入力エラー処理（readSourceFile）
//   - 共有データ構造（Finding）

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
// @ts-ignore kuromoji has no bundled types; treated as `any` at the tsx (esbuild) runtime.
import kuromoji from "kuromoji";

// ---------------------------------------------------------------------------
// kuromoji の型（IPADIC features）。DefinitelyTyped 相当を最小限だけ手書きする。
// ---------------------------------------------------------------------------
export interface Morpheme {
  word_id: number;
  word_type: string;
  word_position: number; // 1-indexed（実測確認済み）
  surface_form: string;
  pos: string; // 品詞大分類: 名詞/動詞/形容詞/副詞/連体詞/接続詞/助詞/助動詞/感動詞/記号/フィラー/その他/接頭詞
  pos_detail_1: string;
  pos_detail_2: string;
  pos_detail_3: string;
  conjugated_type: string;
  conjugated_form: string;
  basic_form: string;
  reading: string;
  pronunciation: string;
}

interface KuromojiTokenizer {
  tokenize(text: string): Morpheme[];
}

// ---------------------------------------------------------------------------
// 共有データ構造
// ---------------------------------------------------------------------------
export type Severity = "info" | "warn" | "critical";

export interface Finding {
  line: number;
  category: string;
  excerpt: string;
  severity: Severity;
  detail: string;
  related_lines?: number[] | null;
  status?: "new" | "persisting" | null;
}

export function makeFinding(f: Omit<Finding, "related_lines" | "status"> & {
  related_lines?: number[] | null;
}): Finding {
  const related = f.related_lines ? Array.from(new Set(f.related_lines)).sort((a, b) => a - b) : undefined;
  return { ...f, related_lines: related ?? null, status: null };
}

export function findingToDict(f: Finding): Record<string, unknown> {
  const d: Record<string, unknown> = {
    line: f.line,
    category: f.category,
    excerpt: f.excerpt,
    severity: f.severity,
    detail: f.detail,
  };
  if (f.related_lines) d.related_lines = f.related_lines;
  if (f.status) d.status = f.status;
  return d;
}

// ---------------------------------------------------------------------------
// kuromoji Tokenizer は生成コスト（辞書ロード）が高いので遅延・使い回し。
// ---------------------------------------------------------------------------
let tokenizerPromise: Promise<KuromojiTokenizer> | null = null;

export function getTokenizer(): Promise<KuromojiTokenizer> {
  if (!tokenizerPromise) {
    const require = createRequire(import.meta.url);
    const dicPath = path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath }).build((err: Error | null, tokenizer: KuromojiTokenizer) => {
        if (err) reject(err);
        else resolve(tokenizer);
      });
    });
  }
  return tokenizerPromise;
}

export function morphemeBegin(m: Morpheme): number {
  return m.word_position - 1;
}

export function morphemeEnd(m: Morpheme): number {
  return morphemeBegin(m) + m.surface_form.length;
}

export function dictionaryForm(m: Morpheme): string {
  return m.basic_form && m.basic_form !== "*" ? m.basic_form : m.surface_form;
}

export function readingForm(m: Morpheme): string {
  return m.reading && m.reading !== "*" ? m.reading : m.surface_form;
}

// ---------------------------------------------------------------------------
// 体言止め判定（lint.ts の nominal_ending 検出器と outline.ts の見出し統計で共用）。
// kuromoji(IPADIC) の「記号」大分類が sudachi の「補助記号」「空白」に相当する。
// ---------------------------------------------------------------------------
export const NOUN_ENDING_POS = new Set(["名詞"]);
export const TRAILING_SYMBOL_POS = new Set(["記号"]);

export function stripTrailingSymbols(morphemes: Morpheme[]): Morpheme[] {
  let i = morphemes.length;
  while (i > 0 && TRAILING_SYMBOL_POS.has(morphemes[i - 1].pos)) {
    i -= 1;
  }
  return morphemes.slice(0, i);
}

export function stripLeadingSymbols(morphemes: Morpheme[]): Morpheme[] {
  let i = 0;
  while (i < morphemes.length && TRAILING_SYMBOL_POS.has(morphemes[i].pos)) {
    i += 1;
  }
  return morphemes.slice(i);
}

// ---------------------------------------------------------------------------
// テンプレ見出し語彙カタログ（outline.ts の見出し統計「テンプレ見出し検出」で使用）。
// ---------------------------------------------------------------------------
export const TEMPLATE_HEADING_WORDS: string[] = [
  "はじめに",
  "背景",
  "概要",
  "本記事について",
  "この記事について",
  "まとめと今後",
  "今後の展望",
  "今後の課題",
  "今後について",
  "まとめ",
  "おわりに",
  "終わりに",
  "さいごに",
  "最後に",
  "結論",
  "総括",
  "conclusion",
  "introduction",
  "summary",
];

// ---------------------------------------------------------------------------
// Markdown構造行のマスク処理
// 見出し・リスト項目・コードブロック内・引用ブロックは「文章」ではないため、
// 体言止め判定や翻訳調検出などの対象から外す。行を削除すると後続行の行番号が
// ズレてレポートの L<n> が狂うので、該当行は「内容を空文字に置き換える」ことで
// 行番号を保ったまま解析対象外にする（マスク方式）。
// ---------------------------------------------------------------------------
export const HEADING_RE = /^\s*#{1,6}(\s|$)/;
export const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])(\s|$)/;
const BLOCKQUOTE_RE = /^\s*>/;
const CODE_FENCE_RE = /^\s*(`{3,}|~{3,})/;
export const TABLE_ROW_RE = /^\s*\|.*\|/;
export const TABLE_DELIMITER_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/;
const FRONT_MATTER_DELIM_RE = /^---\s*$/;
const INLINE_CODE_SPAN_RE = /``(?:[^`\n]|`(?!`))+``|`[^`\n]+`/g;
const MARKDOWN_LINK_URL_RE = /(\]\()([^)]*)(\))/g;

function maskHtmlCommentsInLine(line: string, inComment: boolean): [string, boolean] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (inComment) {
      const close = line.indexOf("-->", i);
      if (close === -1) {
        out.push(" ".repeat(n - i));
        i = n;
      } else {
        const end = close + 3;
        out.push(" ".repeat(end - i));
        i = end;
        inComment = false;
      }
    } else {
      const start = line.indexOf("<!--", i);
      if (start === -1) {
        out.push(line.slice(i));
        i = n;
      } else {
        out.push(line.slice(i, start));
        i = start;
        inComment = true;
      }
    }
  }
  return [out.join(""), inComment];
}

export function maskHtmlComments(text: string): string {
  const lines = text.split("\n");
  const maskedLines: string[] = [];
  let inHtmlComment = false;
  for (const line of lines) {
    const [maskedLine, next] = maskHtmlCommentsInLine(line, inHtmlComment);
    maskedLines.push(maskedLine);
    inHtmlComment = next;
  }
  return maskedLines.join("\n");
}

function blankInlineCodeSpans(line: string): string {
  line = line.replace(INLINE_CODE_SPAN_RE, (m) => " ".repeat(m.length));
  line = line.replace(MARKDOWN_LINK_URL_RE, (_m, p1, p2, p3) => p1 + " ".repeat(p2.length) + p3);
  return line;
}

export function maskMarkdownStructure(text: string): string {
  const lines = text.split("\n");
  const maskedLines: string[] = [];
  let openFence: [string, number] | null = null;
  let inFrontMatter = false;
  let inHtmlComment = false;

  lines.forEach((rawLine, idx) => {
    if (idx === 0 && FRONT_MATTER_DELIM_RE.test(rawLine)) {
      inFrontMatter = true;
      maskedLines.push("");
      return;
    }
    if (inFrontMatter) {
      maskedLines.push("");
      if (FRONT_MATTER_DELIM_RE.test(rawLine)) inFrontMatter = false;
      return;
    }

    const fenceMatch = rawLine.match(CODE_FENCE_RE);
    if (fenceMatch) {
      const fenceRun = fenceMatch[1];
      const fenceChar = fenceRun[0];
      const fenceLen = fenceRun.length;
      const remainderAfterFence = rawLine.slice(fenceMatch[0].length);
      const isCloseEligible = remainderAfterFence.trim() === "";
      if (openFence === null) {
        openFence = [fenceChar, fenceLen];
      } else if (fenceChar === openFence[0] && fenceLen >= openFence[1] && isCloseEligible) {
        openFence = null;
      }
      maskedLines.push("");
      return;
    }
    if (openFence !== null) {
      maskedLines.push("");
      return;
    }

    let line: string;
    [line, inHtmlComment] = maskHtmlCommentsInLine(rawLine, inHtmlComment);

    if (
      HEADING_RE.test(line) ||
      LIST_ITEM_RE.test(line) ||
      BLOCKQUOTE_RE.test(line) ||
      (TABLE_ROW_RE.test(line) && (line.match(/\|/g) || []).length >= 2) ||
      TABLE_DELIMITER_RE.test(line)
    ) {
      maskedLines.push("");
      return;
    }
    maskedLines.push(blankInlineCodeSpans(line));
  });
  return maskedLines.join("\n");
}

export function iterLinesWithNo(text: string): Array<[number, string]> {
  return text.split(/\r\n|\r|\n/).map((line, idx) => [idx + 1, line] as [number, string]);
}

export function iterParagraphsWithLines(lines: Array<[number, string]>): Array<Array<[number, string]>> {
  const paragraphs: Array<Array<[number, string]>> = [];
  let current: Array<[number, string]> = [];
  for (const [no, line] of lines) {
    if (line.trim()) {
      current.push([no, line]);
    } else if (current.length) {
      paragraphs.push(current);
      current = [];
    }
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

// ---------------------------------------------------------------------------
// 文分割
// ---------------------------------------------------------------------------
export const SENTENCE_SPLIT_RE = /[。！？\n]/;

export function splitSentencesWithLines(
  lines: Array<[number, string]>,
  rawLinesByNo: Map<number, string> | null = null
): Array<[number, string, string]> {
  const sentences: Array<[number, string, string]> = [];
  for (const [no, line] of lines) {
    const rawLine = rawLinesByNo?.get(no) ?? line;
    const bounds: Array<[number, number]> = [];
    let prev = 0;
    const re = /[。！？]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      bounds.push([prev, m.index]);
      prev = m.index + 1;
    }
    bounds.push([prev, line.length]);
    for (const [s, e] of bounds) {
      const piece = line.slice(s, e);
      if (piece.trim()) {
        const rawPiece = rawLine.length >= e ? rawLine.slice(s, e) : piece;
        sentences.push([no, piece.trim(), rawPiece.trim()]);
      }
    }
  }
  return sentences;
}

// ---------------------------------------------------------------------------
// 見出し行パーサ（outline.ts / terms.ts で共用）
// ---------------------------------------------------------------------------
export function headingLevelAndText(line: string): [number, string] {
  const m = line.match(/^\s*(#{1,6})\s*(.*?)(?:\s+#+)?\s*$/);
  if (!m) return [0, line.trim()];
  return [m[1].length, m[2].trim()];
}

// ---------------------------------------------------------------------------
// ファイル読み込みと入力エラー処理
// ---------------------------------------------------------------------------
export function readSourceFile(filePath: string): [string | null, string | null] {
  if (!fs.existsSync(filePath)) {
    return [null, `エラー: ファイルが見つかりません: ${filePath}`];
  }
  if (fs.statSync(filePath).isDirectory()) {
    return [null, `エラー: ディレクトリが指定されました（ファイルを指定してください）: ${filePath}`];
  }
  try {
    return [fs.readFileSync(filePath, "utf-8"), null];
  } catch (exc: any) {
    return [null, `エラー: ファイルを読み込めません: ${filePath} (${exc?.message ?? exc})`];
  }
}
