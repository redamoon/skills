#!/usr/bin/env -S npx tsx
// outline.ts — 文書のスケルトン（見出し・各段落の先頭文・箇条書き）を抽出する。
// coji/natural-japanese の scripts/outline.py（sudachipy版）を TypeScript + kuromoji.js へ移植。
//
// 設計原則「検出は機械、判断はAI」に基づき、良し悪しの判断はせず、決定的な抽出のみを行う。
// SKILL.md §4 の構造レビュー（スケルトン通読）への入力として使う。
//
// 使い方:
//   npx tsx scripts/outline.ts <file.md> [--json]

import {
  TEMPLATE_HEADING_WORDS,
  NOUN_ENDING_POS,
  getTokenizer,
  headingLevelAndText,
  maskHtmlComments,
  readSourceFile,
  stripTrailingSymbols,
  LIST_ITEM_RE,
  HEADING_RE,
  TABLE_ROW_RE,
  TABLE_DELIMITER_RE,
} from "./textcore.ts";

const BLOCKQUOTE_RE = /^\s*>/;
const CODE_FENCE_RE = /^\s*(`{3,}|~{3,})/;
const FRONT_MATTER_DELIM_RE = /^---\s*$/;

interface OutlineEntry {
  line: number;
  kind: "heading" | "lead" | "bullets";
  level: number | null;
  text: string;
}

function lineKind(lineText: string): "bullets" | "blockquote" | "table" | "lead" {
  if (LIST_ITEM_RE.test(lineText)) return "bullets";
  if (BLOCKQUOTE_RE.test(lineText)) return "blockquote";
  if ((TABLE_ROW_RE.test(lineText) && (lineText.match(/\|/g) || []).length >= 2) || TABLE_DELIMITER_RE.test(lineText)) {
    return "table";
  }
  return "lead";
}

function buildOutline(rawText: string): OutlineEntry[] {
  const text = maskHtmlComments(rawText);
  const lines = text.split("\n");

  const outline: OutlineEntry[] = [];
  let buffer: Array<[number, string]> = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let inFrontMatter = false;

  function flushBuffer(): void {
    if (!buffer.length) return;
    const [firstNo, firstLine] = buffer[0];
    if (LIST_ITEM_RE.test(firstLine)) {
      const count = buffer.filter(([, lineText]) => LIST_ITEM_RE.test(lineText)).length;
      outline.push({ line: firstNo, kind: "bullets", level: null, text: `(箇条書き ${count} 項目)` });
    } else if (BLOCKQUOTE_RE.test(firstLine)) {
      // skip
    } else if ((TABLE_ROW_RE.test(firstLine) && (firstLine.match(/\|/g) || []).length >= 2) || TABLE_DELIMITER_RE.test(firstLine)) {
      // skip
    } else {
      const m = firstLine.match(/[。！？]/);
      let lead = m ? firstLine.slice(0, (m.index ?? 0) + 1) : firstLine;
      lead = lead.trim();
      if (lead) outline.push({ line: firstNo, kind: "lead", level: null, text: lead });
    }
    buffer = [];
  }

  lines.forEach((line, idx0) => {
    const i = idx0 + 1;
    if (i === 1 && FRONT_MATTER_DELIM_RE.test(line)) {
      inFrontMatter = true;
      return;
    }
    if (inFrontMatter) {
      if (FRONT_MATTER_DELIM_RE.test(line)) inFrontMatter = false;
      return;
    }

    const fenceMatch = line.match(CODE_FENCE_RE);
    if (fenceMatch) {
      flushBuffer();
      const fenceRun = fenceMatch[1];
      const fc = fenceRun[0];
      const fl = fenceRun.length;
      const isCloseEligible = line.slice(fenceMatch[0].length).trim() === "";
      if (!inFence) {
        inFence = true;
        fenceChar = fc;
        fenceLen = fl;
      } else if (fc === fenceChar && fl >= fenceLen && isCloseEligible) {
        inFence = false;
      }
      return;
    }
    if (inFence) return;

    if (!line.trim()) {
      flushBuffer();
      return;
    }

    if (HEADING_RE.test(line)) {
      flushBuffer();
      const [level, headingText] = headingLevelAndText(line);
      outline.push({ line: i, kind: "heading", level, text: headingText });
      return;
    }

    if (buffer.length) {
      const curKind = lineKind(buffer[0][1]);
      const isIndentedContinuation = curKind === "bullets" && lineKind(line) === "lead" && /^\s+\S/.test(line);
      if (curKind !== lineKind(line) && !isIndentedContinuation) {
        flushBuffer();
      }
    }

    buffer.push([i, line]);
  });

  flushBuffer();
  return outline;
}

// ---------------------------------------------------------------------------
// 見出し統計
// ---------------------------------------------------------------------------
const SIGNATURE_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "接頭詞"]);
const LEADING_NUMBERING_RE = /^[\s0-9０-９.．、,()（）【】\[\]#・-]+/;
const NUMBERED_HEADING_RE = /^\s*([0-9０-９]+[.).、]|[①-⑳])\s*\S/;
const BRACKETED_HEADING_RE = /^\s*[【[［(（].+[】\]］)）]\s*$/;
const TOWA_HEADING_RE = /.+とは[?？]?\s*$/;

async function headingPosSignature(text: string): Promise<string[]> {
  const tokenizer = await getTokenizer();
  const sig: string[] = [];
  for (const m of tokenizer.tokenize(text)) {
    if (SIGNATURE_POS.has(m.pos)) sig.push(m.pos);
  }
  return sig;
}

async function isNominalEnding(text: string): Promise<boolean> {
  const tokenizer = await getTokenizer();
  const morphemes = tokenizer.tokenize(text);
  const effective = stripTrailingSymbols(morphemes);
  if (!effective.length) return false;
  return NOUN_ENDING_POS.has(effective[effective.length - 1].pos);
}

function matchTemplateWord(text: string): string | null {
  const stripped = text.replace(LEADING_NUMBERING_RE, "").trim().toLowerCase();
  for (const word of TEMPLATE_HEADING_WORDS) {
    if (stripped.startsWith(word.toLowerCase())) return word;
  }
  return null;
}

function matchStructuralPattern(text: string): string | null {
  if (NUMBERED_HEADING_RE.test(text)) return "numbered";
  if (BRACKETED_HEADING_RE.test(text)) return "bracketed";
  if (TOWA_HEADING_RE.test(text)) return "towa";
  return null;
}

interface HeadingGroupStats {
  count: number;
  length_mean: number;
  length_cv: number;
  nominal_ending_ratio: number;
  dominant_pos_signature_ratio: number;
  template_hits: Array<{ line: number; text: string; matched: string }>;
  structural_pattern_ratio: number;
}

async function summarizeHeadingGroup(headings: OutlineEntry[]): Promise<HeadingGroupStats> {
  const count = headings.length;
  if (count === 0) {
    return {
      count: 0,
      length_mean: 0.0,
      length_cv: 0.0,
      nominal_ending_ratio: 0.0,
      dominant_pos_signature_ratio: 0.0,
      template_hits: [],
      structural_pattern_ratio: 0.0,
    };
  }

  const lengths = headings.map((h) => h.text.length);
  const meanLen = lengths.reduce((a, b) => a + b, 0) / count;
  let cv = 0.0;
  if (meanLen > 0 && count > 1) {
    const variance = lengths.reduce((acc, l) => acc + (l - meanLen) ** 2, 0) / count;
    cv = Math.sqrt(variance) / meanLen;
  }

  let nominalCount = 0;
  for (const h of headings) if (await isNominalEnding(h.text)) nominalCount += 1;

  const signatures: string[][] = [];
  for (const h of headings) signatures.push(await headingPosSignature(h.text));
  const nonEmptySignatures = signatures.filter((s) => s.length).map((s) => s.join("/"));
  let dominantRatio = 0.0;
  if (nonEmptySignatures.length) {
    const counts = new Map<string, number>();
    for (const s of nonEmptySignatures) counts.set(s, (counts.get(s) ?? 0) + 1);
    let mostCommonCount = 0;
    for (const c of counts.values()) mostCommonCount = Math.max(mostCommonCount, c);
    dominantRatio = mostCommonCount / count;
  }

  const templateHits: Array<{ line: number; text: string; matched: string }> = [];
  for (const h of headings) {
    const word = matchTemplateWord(h.text);
    if (word !== null) templateHits.push({ line: h.line, text: h.text, matched: word });
  }

  const structuralCount = headings.filter((h) => matchStructuralPattern(h.text) !== null).length;

  return {
    count,
    length_mean: Math.round(meanLen * 100) / 100,
    length_cv: Math.round(cv * 1000) / 1000,
    nominal_ending_ratio: Math.round((nominalCount / count) * 1000) / 1000,
    dominant_pos_signature_ratio: Math.round(dominantRatio * 1000) / 1000,
    template_hits: templateHits,
    structural_pattern_ratio: Math.round((structuralCount / count) * 1000) / 1000,
  };
}

interface HeadingStats {
  total_headings: number;
  level_distribution: Record<string, number>;
  by_level: Record<string, HeadingGroupStats>;
  overall: HeadingGroupStats;
}

async function buildHeadingStats(outline: OutlineEntry[]): Promise<HeadingStats> {
  const headings = outline.filter((e) => e.kind === "heading");
  const byLevel = new Map<number, OutlineEntry[]>();
  for (const h of headings) {
    const lvl = h.level ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(h);
  }

  const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b);
  const levelDistribution: Record<string, number> = {};
  for (const lvl of sortedLevels) levelDistribution[String(lvl)] = byLevel.get(lvl)!.length;

  const byLevelStats: Record<string, HeadingGroupStats> = {};
  for (const lvl of sortedLevels) byLevelStats[String(lvl)] = await summarizeHeadingGroup(byLevel.get(lvl)!);

  return {
    total_headings: headings.length,
    level_distribution: levelDistribution,
    by_level: byLevelStats,
    overall: await summarizeHeadingGroup(headings),
  };
}

function printHeadingStatsHuman(stats: HeadingStats): void {
  console.log();
  console.log("=== 見出し統計（判断材料。判定はAIが行う） ===");
  console.log();
  console.log(`見出し総数: ${stats.total_headings}`);
  if (Object.keys(stats.level_distribution).length) {
    const dist = Object.entries(stats.level_distribution)
      .map(([level, n]) => `h${level}=${n}`)
      .join(", ");
    console.log(`レベル分布: ${dist}`);
  }

  function printGroup(label: string, g: HeadingGroupStats): void {
    if (g.count === 0) return;
    console.log(
      `[${label}] 本数=${g.count}  平均長=${g.length_mean}字  長さの変動係数=${g.length_cv}  ` +
        `体言止め率=${(g.nominal_ending_ratio * 100).toFixed(0)}%  品詞パターン一致率=${(g.dominant_pos_signature_ratio * 100).toFixed(0)}%  ` +
        `構造パターン率=${(g.structural_pattern_ratio * 100).toFixed(0)}%`
    );
    if (g.template_hits.length) {
      const hits = g.template_hits.map((h) => `L${h.line}:${h.text}（${h.matched}）`).join(", ");
      console.log(`  テンプレ見出しヒット: ${hits}`);
    }
  }

  for (const [level, g] of Object.entries(stats.by_level)) printGroup(`h${level}`, g);
  printGroup("全体", stats.overall);
}

function printOutlineHuman(filePath: string, outline: OutlineEntry[]): void {
  console.log(`=== outline: ${filePath} ===`);
  console.log();
  if (!outline.length) {
    console.log("(スケルトンなし)");
    return;
  }
  for (const entry of outline) {
    const lineTag = `L${entry.line}`;
    if (entry.kind === "heading") {
      const indent = "  ".repeat(Math.max(0, (entry.level ?? 1) - 1));
      const prefix = "#".repeat(entry.level ?? 1);
      console.log(`${lineTag.padStart(6)}  ${indent}${prefix} ${entry.text}`);
    } else {
      console.log(`${lineTag.padStart(6)}    ${entry.text}`);
    }
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

  const outline = buildOutline(text as string);
  const headingStats = await buildHeadingStats(outline);
  if (asJson) {
    console.log(JSON.stringify({ outline, heading_stats: headingStats }, null, 2));
  } else {
    printOutlineHuman(filePath, outline);
    printHeadingStatsHuman(headingStats);
  }
  return 0;
}

main().then((code) => process.exit(code));
