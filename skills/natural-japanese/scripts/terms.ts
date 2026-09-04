#!/usr/bin/env -S npx tsx
// terms.ts — 専門用語候補（カタカナ複合語・ASCII英略語・固有名詞）を初出順に抽出する。
// coji/natural-japanese の scripts/terms.py（sudachipy版）を TypeScript + kuromoji.js へ移植。
//
// 設計原則「検出は機械、判断はAI」に基づき、有用な専門用語かどうか、初出で説明済みかどうか
// の判断は行わない（hasGlossHint はあくまでヒント）。文体憲法第4条の確認材料として使う。
//
// 使い方:
//   npx tsx scripts/terms.ts <file.md> [--json]

import {
  Morpheme,
  getTokenizer,
  headingLevelAndText,
  iterLinesWithNo,
  maskHtmlComments,
  maskMarkdownStructure,
  morphemeBegin,
  morphemeEnd,
  readSourceFile,
  HEADING_RE,
} from "./textcore.ts";

const KATAKANA_CHAR_RE = /^[ァ-ヶー]+$/;
const ASCII_ACRONYM_RE = /(?<![A-Za-z0-9])[A-Z]{2,}[0-9]*(?![A-Za-z0-9])/g;
const TERMS_KATAKANA_MIN_LEN = 3;
const TERMS_GLOSS_CONTEXT_CHARS = 80;
const TERMS_GLOSS_MARKER_WORDS = ["とは", "と呼ぶ", "という", "、つまり"];
const CAPITALIZED_LATIN_WORD_RE = /^[A-Z][a-zA-Z0-9]*$/;

function isKatakanaToken(surface: string): boolean {
  return KATAKANA_CHAR_RE.test(surface);
}

function isProperNounOrCapitalizedLatinMorpheme(m: Morpheme): boolean {
  if (m.pos === "名詞" && m.pos_detail_1 === "固有名詞") return true;
  const surface = m.surface_form;
  return surface.length >= 2 && CAPITALIZED_LATIN_WORD_RE.test(surface);
}

function termContextAndGlossHint(
  term: string,
  firstLineNo: number,
  searchText: string,
  lineOffsets: Map<number, number>
): [string, boolean] {
  const lines = searchText.split("\n");
  const lineText = firstLineNo > 0 && firstLineNo <= lines.length ? lines[firstLineNo - 1] : "";
  const localIdx = lineText.indexOf(term);
  if (localIdx === -1) {
    return [lineText.trim(), TERMS_GLOSS_MARKER_WORDS.some((marker) => lineText.includes(marker))];
  }

  const absPos = (lineOffsets.get(firstLineNo) ?? 0) + localIdx;
  const ctxStart = Math.max(0, absPos - TERMS_GLOSS_CONTEXT_CHARS);
  const ctxEnd = absPos + term.length + TERMS_GLOSS_CONTEXT_CHARS;
  const context = searchText.slice(ctxStart, ctxEnd);

  const termStartLocal = absPos - ctxStart;
  const termEndLocal = termStartLocal + term.length;
  const after = context.slice(termEndLocal, termEndLocal + 2);
  let hasGlossHint = after.startsWith("(") || after.startsWith("（");
  if (!hasGlossHint) {
    hasGlossHint = TERMS_GLOSS_MARKER_WORDS.some((marker) => context.includes(marker));
  }

  return [context.trim(), hasGlossHint];
}

interface TermEntry {
  term: string;
  first_line: number;
  count: number;
  has_gloss_hint: boolean;
  context: string;
}

async function buildTermInventory(rawText: string): Promise<TermEntry[]> {
  const tokenizer = await getTokenizer();

  const maskedComments = maskHtmlComments(rawText);
  const maskedStructure = maskMarkdownStructure(maskedComments);
  const bodyLines = iterLinesWithNo(maskedStructure);

  const headingLines: Array<[number, string]> = [];
  for (const [no, line] of iterLinesWithNo(maskedComments)) {
    if (HEADING_RE.test(line)) {
      const [, headingText] = headingLevelAndText(line);
      headingLines.push([no, headingText]);
    }
  }

  const combinedLines = [...bodyLines, ...headingLines].sort((a, b) => a[0] - b[0]);

  const lineOffsets = new Map<number, number>();
  let pos = 0;
  const commentLines = maskedComments.split("\n");
  commentLines.forEach((lineText, idx) => {
    lineOffsets.set(idx + 1, pos);
    pos += lineText.length + 1;
  });

  const seen = new Map<string, { first_line: number; first_offset: number }>();

  function register(term: string, no: number, offset: number): void {
    const t = term.trim();
    if (!t) return;
    if (!seen.has(t)) seen.set(t, { first_line: no, first_offset: offset });
  }

  for (const [no, line] of combinedLines) {
    if (!line.trim()) continue;

    for (const m of line.matchAll(ASCII_ACRONYM_RE)) {
      register(m[0], no, m.index ?? 0);
    }

    const morphemes = tokenizer.tokenize(line);
    const n = morphemes.length;
    let i = 0;
    while (i < n) {
      const m0 = morphemes[i];
      if (isKatakanaToken(m0.surface_form)) {
        let j = i + 1;
        while (j < n && isKatakanaToken(morphemes[j].surface_form)) j += 1;
        const spanStart = morphemeBegin(m0);
        const spanEnd = morphemeEnd(morphemes[j - 1]);
        const term = line.slice(spanStart, spanEnd);
        if (term.length >= TERMS_KATAKANA_MIN_LEN) register(term, no, spanStart);
        i = j;
        continue;
      }
      if (isProperNounOrCapitalizedLatinMorpheme(m0)) {
        let j = i + 1;
        while (j < n && isProperNounOrCapitalizedLatinMorpheme(morphemes[j])) j += 1;
        const spanStart = morphemeBegin(m0);
        const spanEnd = morphemeEnd(morphemes[j - 1]);
        const term = line.slice(spanStart, spanEnd);
        register(term, no, spanStart);
        i = j;
        continue;
      }
      i += 1;
    }
  }

  const results: TermEntry[] = [];
  for (const [term, info] of seen) {
    const count = (maskedComments.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
    const [context, hasGlossHint] = termContextAndGlossHint(term, info.first_line, maskedComments, lineOffsets);
    results.push({ term, first_line: info.first_line, count, has_gloss_hint: hasGlossHint, context });
  }

  results.sort((a, b) => {
    const ai = seen.get(a.term)!;
    const bi = seen.get(b.term)!;
    if (ai.first_line !== bi.first_line) return ai.first_line - bi.first_line;
    return ai.first_offset - bi.first_offset;
  });
  return results;
}

function printTermsHuman(filePath: string, terms: TermEntry[]): void {
  console.log(`=== terms: ${filePath} ===`);
  console.log("has_gloss_hint は「説明済みと判定した」印ではなく、初出近傍に説明マーカーが見つかったという機械的なヒントに過ぎない。要確認は人間/AIの判断に委ねる。");
  console.log();
  if (!terms.length) {
    console.log("(用語候補なし)");
    return;
  }
  for (const t of terms) {
    const hint = t.has_gloss_hint ? "あり" : "なし";
    console.log(`L${t.first_line} ${t.term} (出現${t.count}回, 説明手掛かり: ${hint})`);
    console.log(`    近傍: ${t.context}`);
    console.log();
  }
}

async function main(): Promise<number> {
  const positional = process.argv.slice(2).filter((a) => a !== "--json");
  const asJson = process.argv.includes("--json");
  const filePath = positional[0];
  if (!filePath) {
    console.error("エラー: 対象の Markdown/テキストファイルを指定してください。");
    return 1;
  }

  const [text, err] = readSourceFile(filePath);
  if (err !== null) {
    console.error(err);
    return 1;
  }

  const terms = await buildTermInventory(text as string);
  if (asJson) {
    console.log(JSON.stringify({ terms }, null, 2));
  } else {
    printTermsHuman(filePath, terms);
  }
  return 0;
}

main().then((code) => process.exit(code));
