#!/usr/bin/env -S npx tsx
// lint.ts — AI臭い日本語文章を決定的に検出する lint スクリプト（CI ゲートではない）。
//
// coji/natural-japanese の scripts/lint.py（sudachipy版）を TypeScript + kuromoji.js
// （IPADIC辞書）へ移植したもの。検出ロジック・閾値は原典を可能な限りそのまま踏襲するが、
// 形態素解析辞書が変わるため、品詞の分類名が一部異なる（textcore.ts 参照）。
// 移植していない検出器: なし（semantic.py は別スクリプトのため textcore とは無関係。
// calibrate.py の閾値スイープ用フックは移植していない＝各閾値はモジュール定数固定）。
//
// 設計思想: 「AI は自分自身の AI 臭さを認識できない」→ 機械的・決定的に検出して
// 人間（または AI 自身の別セッション）に突きつけ、直すかどうかの判断は委ねる。
// これは CI ゲートではなく lint であるため、検出件数に関わらず exit code は常に 0。
// ファイルが読めない等の入力エラーだけ exit code 1。
//
// 使い方:
//   npx tsx scripts/lint.ts <file.md> [--json] [--genre essay|tech|business]
//     [--experimental] [--reading-load] [--baseline PREV.json]

import fs from "node:fs";
import {
  Finding,
  Morpheme,
  dictionaryForm,
  getTokenizer,
  iterLinesWithNo,
  iterParagraphsWithLines,
  makeFinding,
  findingToDict,
  maskHtmlComments,
  maskMarkdownStructure,
  morphemeBegin,
  morphemeEnd,
  readSourceFile,
  SENTENCE_SPLIT_RE,
  splitSentencesWithLines,
  stripLeadingSymbols,
  stripTrailingSymbols,
  LIST_ITEM_RE,
  HEADING_RE,
} from "./textcore.ts";

// ---------------------------------------------------------------------------
// 統計ヘルパー（Python の statistics モジュール相当）
// ---------------------------------------------------------------------------
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pstdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

// ---------------------------------------------------------------------------
// 辞書: 禁止語・LLM 常套句カタログ（原典コーパス校正2026-07 済みの語彙をそのまま採用）
// ---------------------------------------------------------------------------
const FORBIDDEN_PHRASES: string[] = [
  "と言えるでしょう",
  "と言えるだろう",
  "と言えます",
  "ということになるでしょう",
  "のではないでしょうか",
  "重要なのは",
  "大切なのは",
  "ポイントは",
  "結論から言うと",
  "結論として",
  "いかがでしたか",
  "いかがでしたでしょうか",
  "いかがでしょうか",
  "まとめると",
  "総じて",
  "非常に重要",
  "極めて重要",
  "言うまでもなく",
  "言うまでもありません",
  "まさしく",
  "さて、",
  "それでは、",
  "このように",
  "このような中",
  "ここで注目したいのは",
  "見ていきましょう",
  "紹介していきます",
  "解説していきます",
  "深掘りしていきます",
  "一概には言えません",
  "個人差がありますが",
  "あくまで一例ですが",
  "正面から扱う",
  "正面から見る",
  "正面から書く",
  "正面から立てる",
  "正面から回収する",
  "不可欠",
  "核心的",
  "鍵となる",
  "根本的な",
  "多角的",
  "包括的",
  "総合的",
  "掘り下げる",
  "深掘りする",
  "言語化する",
  "について見ていく",
  "を探求する",
];

// コーパス校正で「人間側でも一定数ヒットするため弱いシグナル」と判定した語（severity=info）。
const FORBIDDEN_PHRASES_WEAK_SIGNAL = new Set(["重要なのは", "このように", "不可欠", "ポイントは", "さて、"]);

// 翻訳調パターン（英語直訳っぽい構文）
const TRANSLATIONESE_PATTERNS: RegExp[] = [
  /することができ(る|ます|た)/g,
  /することが可能(です|だ|になる)/g,
  /と言えるだろう/g,
  /という点で/g,
  /という観点(から|で)/g,
  /にとって(重要|不可欠)/g,
  /を持つ(こと|存在)/g,
  /することによって/g,
  /であることは間違いない/g,
  /に他ならない/g,
];

// 段落頭に来ると「AI が構成を接続詞で誤魔化しがち」な語
const PARAGRAPH_CONJUNCTIONS: string[] = [
  "しかし",
  "また",
  "そして",
  "そのため",
  "さらに",
  "つまり",
  "一方",
  "一方で",
  "このように",
  "なぜなら",
  "したがって",
  "ただし",
];

// 否定→肯定対比の手癖パターン
const ANTITHESIS_PATTERNS: RegExp[] = [/ではなく、?.{0,30}/g, /だけでなく.{0,10}も/g];

// ---------------------------------------------------------------------------
// 検出器の閾値パラメータ（原典 corpus/reports/ のコーパス校正結果をそのまま踏襲）
// ---------------------------------------------------------------------------
const ANTITHESIS_REPETITION_THRESHOLD = 3;
const ANTITHESIS_RATE_INFO_BELOW = 0.02;
const ANTITHESIS_RATE_CRITICAL_ABOVE = 0.03;
const SENTENCE_VARIANCE_MIN_SENTENCES = 5;
const SENTENCE_VARIANCE_CV_THRESHOLD = 0.25;
const NOMINAL_ENDING_MIN_SENTENCES = 5;
const NOMINAL_ENDING_RATIO_THRESHOLD = 0.0;
const NOMINAL_ENDING_MIN_CHARS = 2000;
const PARAGRAPH_CONJ_MIN_PARAGRAPHS = 3;
const PARAGRAPH_CONJ_RATIO_THRESHOLD = 0.3;
const UNIFORM_PARAGRAPH_MIN_PARAGRAPHS = 4;
const UNIFORM_PARAGRAPH_CV_THRESHOLD = 0.15;
const BURSTINESS_MIN_TOKENIZED = 6;
const BURSTINESS_THRESHOLD = -0.24;
const AUTOCORR_MIN_XS = 4;
const AUTOCORR_THRESHOLD = 0.6;
const NGRAM_LEAD_REPEAT_THRESHOLD = 6;
const NGRAM_TEMPLATE_MIN_COUNT = 6;
const NGRAM_TEMPLATE_RATIO_THRESHOLD = 0.4;
const LEXDIV_MIN_TOKENS = 30;
const TTR_THRESHOLD = 0.45;
const MTLD_THRESHOLD = 40;
const LEXDIV_MIN_DOC_CHARS = 4000;

const LOW_SPECIFICITY_MIN_CHARS = 80;
const LOW_SPECIFICITY_MIN_CONTENT_WORDS = 15;
const LOW_SPECIFICITY_PROPER_NOUN_WEIGHT = 1.0;
const LOW_SPECIFICITY_NUMERIC_WEIGHT = 1.0;
const LOW_SPECIFICITY_EXAMPLE_MARKER_BONUS = 0.1;
const LOW_SPECIFICITY_ABSTRACT_NOUN_WEIGHT = 1.5;
const LOW_SPECIFICITY_SCORE_THRESHOLD = -0.15;

const CONTENT_WORD_POS = new Set(["名詞", "動詞", "形容詞", "副詞"]);

const ABSTRACT_NOUN_WORDS = new Set([
  "側面",
  "観点",
  "重要性",
  "可能性",
  "あり方",
  "存在",
  "意味",
  "本質",
  "価値",
  "意義",
  "課題",
  "問題",
  "要素",
  "要因",
  "背景",
  "傾向",
  "姿勢",
  "視点",
  "概念",
  "特徴",
  "性質",
  "状況",
  "状態",
  "変化",
]);

const EXAMPLE_MARKER_WORDS: string[] = [
  "たとえば",
  "例えば",
  "実際に",
  "実際には",
  "具体的には",
  "具体例として",
  "一例として",
  "先日",
  "昨日",
  "現に",
  "実例として",
];

const NUMERIC_QUANTITY_RE =
  /[0-9０-９]+(年代|年間|世紀|年|月|日|時間|時|分|秒|人|円|%|％|kg|km|cm|mm|g|m|回|件|個|つ|割|倍|台|社|名|冊|本|杯|軒)?/g;

interface GenreProfile {
  nominal_min_chars?: number;
  lead_repeat_threshold?: number;
  reading_load_sentence_max_chars?: number;
  antithesis_rate_critical_above?: number;
  disabled_categories?: Set<string>;
}

const GENRE_PROFILES: Record<string, GenreProfile> = {
  essay: {
    nominal_min_chars: 1500,
    lead_repeat_threshold: 5,
    reading_load_sentence_max_chars: 110,
  },
  tech: {
    nominal_min_chars: 3000,
    lead_repeat_threshold: 7,
    antithesis_rate_critical_above: 0.045,
  },
  business: {
    nominal_min_chars: 3000,
    lead_repeat_threshold: 7,
    disabled_categories: new Set([
      "high_bullet_ratio",
      "high_bold_density",
      "boilerplate_heading",
      "numbered_phase_structure",
    ]),
  },
};

// ---------------------------------------------------------------------------
// baseline 差分（--baseline）
// ---------------------------------------------------------------------------
function formatRelatedLines(relatedLines: number[]): string {
  const uniqSorted = Array.from(new Set(relatedLines)).sort((a, b) => a - b);
  return "対応箇所: " + uniqSorted.map((n) => `L${n}`).join(", ");
}

const BASELINE_KEY_EXCERPT_PREFIX_LEN = 20;
const CATEGORY_ONLY_KEY_CATEGORIES = new Set([
  "low_burstiness",
  "high_length_autocorrelation",
  "low_sentence_variance",
  "uniform_paragraph_structure",
  "low_lexical_diversity_ttr",
  "low_lexical_diversity_mtld",
]);

function normalizeExcerptForKey(excerpt: string): string {
  return (excerpt || "").replace(/\s+/g, "");
}

function findingIdentityKey(category: string, excerpt: string): string {
  if (CATEGORY_ONLY_KEY_CATEGORIES.has(category)) return `${category} `;
  const normalized = normalizeExcerptForKey(excerpt).slice(0, BASELINE_KEY_EXCERPT_PREFIX_LEN);
  return `${category} ${normalized}`;
}

interface BaselineFinding {
  category?: string;
  excerpt?: string;
  [k: string]: unknown;
}

function validateBaselineData(baselineData: unknown): [{ findings: BaselineFinding[] } | null, string[]] {
  const warnings: string[] = [];
  if (typeof baselineData !== "object" || baselineData === null || Array.isArray(baselineData)) {
    warnings.push("--baseline の内容が JSON オブジェクトではありません。baseline比較を無視して通常のlintを実行します。");
    return [null, warnings];
  }
  const findingsRaw = (baselineData as any).findings;
  if (!Array.isArray(findingsRaw)) {
    warnings.push("--baseline に 'findings' 配列が見つかりません。baseline比較を無視して通常のlintを実行します。");
    return [null, warnings];
  }
  const validFindings: BaselineFinding[] = [];
  let skipped = 0;
  for (const item of findingsRaw) {
    if (item && typeof item === "object" && typeof item.category === "string" && typeof item.excerpt === "string") {
      validFindings.push(item);
    } else {
      skipped += 1;
    }
  }
  if (skipped) {
    warnings.push(`--baseline の findings 配列内に不正な要素が${skipped}件あったため読み飛ばしました。`);
  }
  return [{ findings: validFindings }, warnings];
}

function computeBaselineDiff(
  findings: Finding[],
  baselineData: { findings: BaselineFinding[] }
): [BaselineFinding[], Record<string, number>] {
  const baselineByKey = new Map<string, BaselineFinding[]>();
  for (const bf of baselineData.findings) {
    const key = findingIdentityKey(bf.category ?? "", bf.excerpt ?? "");
    if (!baselineByKey.has(key)) baselineByKey.set(key, []);
    baselineByKey.get(key)!.push(bf);
  }

  for (const f of findings) {
    const key = findingIdentityKey(f.category, f.excerpt);
    const bucket = baselineByKey.get(key);
    if (bucket && bucket.length) {
      bucket.shift();
      f.status = "persisting";
    } else {
      f.status = "new";
    }
  }

  const resolved: BaselineFinding[] = [];
  for (const bucket of baselineByKey.values()) resolved.push(...bucket);

  const summary = {
    resolved: resolved.length,
    new: findings.filter((f) => f.status === "new").length,
    persisting: findings.filter((f) => f.status === "persisting").length,
  };
  return [resolved, summary];
}

// ---------------------------------------------------------------------------
// 各検出器
// ---------------------------------------------------------------------------
function rawOrMasked(rawLinesByNo: Map<number, string> | null, no: number, fallback: string): string {
  if (rawLinesByNo === null) return fallback;
  return rawLinesByNo.get(no) ?? fallback;
}

function detectForbiddenPhrases(
  lines: Array<[number, string]>,
  rawLinesByNo: Map<number, string> | null = null
): Finding[] {
  const findings: Finding[] = [];
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const phrase of FORBIDDEN_PHRASES) {
      const idx = line.indexOf(phrase);
      if (idx !== -1) {
        const start = Math.max(0, idx - 10);
        const end = idx + phrase.length + 10;
        const excerpt = rawLine.length >= end ? rawLine.slice(start, end) : line.slice(start, end);
        const isWeakSignal = FORBIDDEN_PHRASES_WEAK_SIGNAL.has(phrase);
        const severity = isWeakSignal ? "info" : "warn";
        let detail = `禁止語/LLM常套句ヒット: 「${phrase}」`;
        if (isWeakSignal) detail += "（コーパス校正で人間側にも一定数出現する弱いシグナルと判定、severity低下）";
        findings.push(
          makeFinding({ line: no, category: "forbidden_phrase", excerpt: excerpt.trim(), severity, detail })
        );
      }
    }
  }
  return findings;
}

function detectTranslationese(
  lines: Array<[number, string]>,
  rawLinesByNo: Map<number, string> | null = null
): Finding[] {
  const findings: Finding[] = [];
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const pat of TRANSLATIONESE_PATTERNS) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(line)) !== null) {
        const start = Math.max(0, m.index - 10);
        const end = m.index + m[0].length + 10;
        const excerpt = rawLine.length >= end ? rawLine.slice(start, end) : line.slice(start, end);
        findings.push(
          makeFinding({
            line: no,
            category: "translationese",
            excerpt: excerpt.trim(),
            severity: "info",
            detail: `翻訳調パターン: /${pat.source}/ に一致`,
          })
        );
        if (m.index === pat.lastIndex) pat.lastIndex++;
      }
    }
  }
  return findings;
}

function detectAntithesisRepetition(
  lines: Array<[number, string]>,
  rawLinesByNo: Map<number, string> | null,
  threshold = ANTITHESIS_REPETITION_THRESHOLD,
  rateInfoBelow = ANTITHESIS_RATE_INFO_BELOW,
  rateCriticalAbove = ANTITHESIS_RATE_CRITICAL_ABOVE
): Finding[] {
  const hits: Array<[number, string]> = [];
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const pat of ANTITHESIS_PATTERNS) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(line)) !== null) {
        const excerpt = rawLine.length >= m.index + m[0].length ? rawLine.slice(m.index, m.index + m[0].length) : m[0];
        hits.push([no, excerpt]);
        if (m.index === pat.lastIndex) pat.lastIndex++;
      }
    }
  }

  const findings: Finding[] = [];
  if (hits.length >= threshold) {
    const totalSentences = splitSentencesWithLines(lines, rawLinesByNo ?? undefined).length;
    const ratio = totalSentences ? hits.length / totalSentences : 0.0;
    let severity: Finding["severity"];
    if (ratio < rateInfoBelow) severity = "info";
    else if (ratio >= rateCriticalAbove) severity = "critical";
    else severity = "warn";

    const allLines = hits.map(([no]) => no);
    const related = formatRelatedLines(allLines);
    for (const [no, text] of hits) {
      findings.push(
        makeFinding({
          line: no,
          category: "antithesis_repetition",
          excerpt: text.trim(),
          severity,
          detail: `否定→肯定対比パターンが文書内で${hits.length}回検出（閾値${threshold}回以上、総文数に対する比率=${(ratio * 100).toFixed(1)}%）。${related}`,
          related_lines: allLines,
        })
      );
    }
  }
  return findings;
}

function detectLowSentenceLengthVariance(
  sentences: Array<[number, string, string]>,
  threshold = SENTENCE_VARIANCE_CV_THRESHOLD,
  minSentences = SENTENCE_VARIANCE_MIN_SENTENCES
): Finding[] {
  const lengths = sentences.map(([, s]) => s.length).filter((n) => n > 0);
  if (lengths.length < minSentences) return [];
  const m = mean(lengths);
  if (m === 0) return [];
  const stdev = pstdev(lengths);
  const cv = stdev / m;
  if (cv < threshold) {
    const firstLine = sentences.length ? sentences[0][0] : 1;
    return [
      makeFinding({
        line: firstLine,
        category: "low_sentence_variance",
        excerpt: `文数=${lengths.length}, 平均文長=${m.toFixed(1)}字, 変動係数=${cv.toFixed(3)}`,
        severity: "warn",
        detail: `文長の変動係数が閾値(${threshold})未満。リズムが均質でAI臭い可能性`,
      }),
    ];
  }
  return [];
}

// --- 形態素解析ベース ---
interface TokenizedSentence {
  line: number;
  text: string;
  morphemes: Morpheme[];
  rawText: string;
}

async function tokenizeSentences(sentences: Array<[number, string, string]>): Promise<TokenizedSentence[]> {
  const tokenizer = await getTokenizer();
  const result: TokenizedSentence[] = [];
  for (const [no, sent, rawSent] of sentences) {
    if (!sent) continue;
    const morphemes = tokenizer.tokenize(sent);
    result.push({ line: no, text: sent, morphemes, rawText: rawSent || sent });
  }
  return result;
}

const ABSTRACT_PRONOUNS = new Set(["これ", "それ", "あれ", "それら"]);
const ABSTRACT_PRONOUN_PHRASES = new Set(["この事実", "そのこと"]);
const TRANSITIVE_SMELL_VERBS = new Set([
  "もたらす",
  "示す",
  "意味する",
  "証明する",
  "生み出す",
  "反映する",
  "示唆する",
  "物語る",
  "浮き彫りにする",
  "後押しする",
]);

function detectNominalEndingAndParagraphConjunctions(
  lines: Array<[number, string]>,
  tokenized: TokenizedSentence[],
  rawLinesByNo: Map<number, string> | null,
  opts: {
    nominalMinSentences?: number;
    nominalRatioThreshold?: number;
    nominalMinChars?: number;
    conjMinParagraphs?: number;
    conjRatioThreshold?: number;
    uniformMinParagraphs?: number;
    uniformCvThreshold?: number;
  } = {}
): [Finding[], Record<string, unknown>] {
  const nominalMinSentences = opts.nominalMinSentences ?? NOMINAL_ENDING_MIN_SENTENCES;
  const nominalRatioThreshold = opts.nominalRatioThreshold ?? NOMINAL_ENDING_RATIO_THRESHOLD;
  const nominalMinChars = opts.nominalMinChars ?? NOMINAL_ENDING_MIN_CHARS;
  const conjMinParagraphs = opts.conjMinParagraphs ?? PARAGRAPH_CONJ_MIN_PARAGRAPHS;
  const conjRatioThreshold = opts.conjRatioThreshold ?? PARAGRAPH_CONJ_RATIO_THRESHOLD;
  const uniformMinParagraphs = opts.uniformMinParagraphs ?? UNIFORM_PARAGRAPH_MIN_PARAGRAPHS;
  const uniformCvThreshold = opts.uniformCvThreshold ?? UNIFORM_PARAGRAPH_CV_THRESHOLD;

  let nominalEndingCount = 0;
  let totalSentences = 0;
  let totalChars = 0;
  let lastLine = 1;

  for (const ts of tokenized) {
    totalSentences += 1;
    totalChars += ts.rawText.length;
    lastLine = ts.line;
    const effective = stripTrailingSymbols(ts.morphemes);
    if (!effective.length) continue;
    const last = effective[effective.length - 1];
    if (last.pos === "名詞") nominalEndingCount += 1;
  }

  const ratio = totalSentences ? nominalEndingCount / totalSentences : 0.0;
  const findings: Finding[] = [];

  if (totalSentences >= nominalMinSentences && totalChars >= nominalMinChars && ratio <= nominalRatioThreshold) {
    findings.push(
      makeFinding({
        line: lastLine,
        category: "nominal_ending",
        excerpt: `体言止め0件（全${totalSentences}文、約${totalChars}字）`,
        severity: "info",
        detail:
          "この文書には体言止めが1つもない。ある程度の長さの文書でこの修辞技法が皆無なのはAI文章に特徴的" +
          "（コーパス実測: essayジャンルで人間60% vs AI 0%が体言止めを使用）。人間的な修辞の欠如の疑い",
      })
    );
  }

  const paragraphs = iterParagraphsWithLines(lines);
  let conjParagraphCount = 0;
  const totalParagraphs = paragraphs.length;
  const conjFindings: Array<[number, string, string]> = [];
  const sentenceCountsPerParagraph: number[] = [];
  for (const paraLines of paragraphs) {
    const [firstNo, firstLineRaw] = paraLines[0];
    const firstLineText = firstLineRaw.trim();
    const paraJoined = paraLines.map(([, t]) => t).join("\n");
    sentenceCountsPerParagraph.push(paraJoined.split(SENTENCE_SPLIT_RE).filter((p) => p.trim()).length);
    for (const conj of PARAGRAPH_CONJUNCTIONS) {
      if (firstLineText.startsWith(conj)) {
        conjParagraphCount += 1;
        conjFindings.push([firstNo, firstLineText, conj]);
        break;
      }
    }
  }

  const conjRatio = totalParagraphs ? conjParagraphCount / totalParagraphs : 0.0;
  if (totalParagraphs >= conjMinParagraphs && conjRatio >= conjRatioThreshold) {
    const conjLines = conjFindings.map(([no]) => no);
    const related = formatRelatedLines(conjLines);
    for (const [no, textLine, conj] of conjFindings) {
      const excerptSource = rawOrMasked(rawLinesByNo, no, textLine);
      findings.push(
        makeFinding({
          line: no,
          category: "paragraph_lead_conjunction",
          excerpt: excerptSource.slice(0, 40),
          severity: "info",
          detail: `段落頭が接続詞「${conj}」で始まる（文書全体の段落頭接続詞率=${(conjRatio * 100).toFixed(1)}%、閾値${(conjRatioThreshold * 100).toFixed(0)}%以上で警告）。${related}`,
          related_lines: conjLines,
        })
      );
    }
  }

  const paraStructureStats: Record<string, unknown> = {
    paragraph_sentence_counts: sentenceCountsPerParagraph,
    paragraph_sentence_count_cv: null,
  };
  if (sentenceCountsPerParagraph.length >= uniformMinParagraphs) {
    const pMean = mean(sentenceCountsPerParagraph);
    const pStd = pstdev(sentenceCountsPerParagraph);
    const pCv = pMean ? pStd / pMean : 0.0;
    paraStructureStats.paragraph_sentence_count_cv = pCv;
    if (pCv < uniformCvThreshold) {
      findings.push(
        makeFinding({
          line: 1,
          category: "uniform_paragraph_structure",
          excerpt: `段落数=${sentenceCountsPerParagraph.length}, 各段落の文数=[${sentenceCountsPerParagraph.join(", ")}]`,
          severity: "info",
          detail: `段落あたり文数の変動係数=${pCv.toFixed(3)}（閾値${uniformCvThreshold}未満）。どの段落もほぼ同じ文数=定型段落（例: 3文段落の量産）の疑い`,
        })
      );
    }
  }

  const stats = {
    total_sentences: totalSentences,
    nominal_ending_count: nominalEndingCount,
    nominal_ending_ratio: ratio,
    total_paragraphs: totalParagraphs,
    paragraph_lead_conjunction_count: conjParagraphCount,
    paragraph_lead_conjunction_ratio: conjRatio,
    ...paraStructureStats,
  };
  return [findings, stats];
}

function detectTranslationeseMorph(tokenized: TokenizedSentence[]): Finding[] {
  const findings: Finding[] = [];
  for (const ts of tokenized) {
    const surfaces = ts.morphemes.map((m) => m.surface_form);
    const poss = ts.morphemes.map((m) => m.pos);
    const n = ts.morphemes.length;
    for (let i = 0; i < n; i++) {
      if (surfaces[i] === "こと" && poss[i] === "名詞") {
        const j = i + 1;
        if (j < n && poss[j] === "助詞" && (surfaces[j] === "が" || surfaces[j] === "は")) {
          const k = j + 1;
          if (k < n && poss[k] === "動詞" && surfaces[k].startsWith("でき")) {
            const spanStart = morphemeBegin(ts.morphemes[Math.max(0, i - 4)]);
            const spanEnd = morphemeEnd(ts.morphemes[k]);
            const excerpt = ts.rawText.slice(spanStart, spanEnd);
            findings.push(
              makeFinding({
                line: ts.line,
                category: "translationese_morph",
                excerpt,
                severity: "info",
                detail: "品詞列マッチ: 名詞/動詞+こと+が/は+できる型の翻訳調構文",
              })
            );
          }
        }
      }
    }
  }
  return findings;
}

const SMALL_KANA_MERGE = new Set("ァィゥェォャュョヮ".split(""));

function moraLength(morphemes: Morpheme[]): number {
  let total = 0;
  for (const m of morphemes) {
    const reading = m.reading && m.reading !== "*" ? m.reading : m.surface_form;
    let count = 0;
    for (const ch of reading) {
      if (SMALL_KANA_MERGE.has(ch) && count > 0) continue;
      count += 1;
    }
    total += count;
  }
  return total;
}

function detectRhythmStatistics(
  tokenized: TokenizedSentence[],
  minTokenized = BURSTINESS_MIN_TOKENIZED,
  burstinessThreshold = BURSTINESS_THRESHOLD,
  autocorrMinXs = AUTOCORR_MIN_XS,
  autocorrThreshold = AUTOCORR_THRESHOLD
): [Finding[], Record<string, unknown>] {
  if (tokenized.length < minTokenized) return [[], {}];

  const moraLengths = tokenized.map((ts) => moraLength(ts.morphemes));
  const m = mean(moraLengths);
  const std = pstdev(moraLengths);

  const findings: Finding[] = [];
  const burstiness = std + m ? (std - m) / (std + m) : 0.0;

  const xs = moraLengths.slice(0, -1);
  const ys = moraLengths.slice(1);
  let autocorr: number | null = null;
  if (xs.length >= autocorrMinXs && pstdev(xs) > 0 && pstdev(ys) > 0) {
    const mx = mean(xs);
    const my = mean(ys);
    const cov = xs.reduce((acc, a, idx) => acc + (a - mx) * (ys[idx] - my), 0) / xs.length;
    autocorr = cov / (pstdev(xs) * pstdev(ys));
  }

  if (burstiness < burstinessThreshold) {
    findings.push(
      makeFinding({
        line: tokenized[0].line,
        category: "low_burstiness",
        excerpt: `burstiness=${burstiness.toFixed(3)} (モーラ近似長 平均=${m.toFixed(1)}, 標準偏差=${std.toFixed(1)})`,
        severity: "warn",
        detail: `burstiness が閾値(${burstinessThreshold})未満。文の長短のメリハリが乏しく機械的なリズムの疑い`,
      })
    );
  }

  if (autocorr !== null && autocorr > autocorrThreshold) {
    findings.push(
      makeFinding({
        line: tokenized[0].line,
        category: "high_length_autocorrelation",
        excerpt: `lag-1 自己相関=${autocorr.toFixed(3)}`,
        severity: "info",
        detail: `隣接する文の長さが強く相関（閾値${autocorrThreshold}超）。文長パターンが単調に繰り返されている疑い`,
      })
    );
  }

  const stats = {
    mora_mean: m,
    mora_stdev: std,
    burstiness,
    length_autocorrelation_lag1: autocorr,
  };
  return [findings, stats];
}

const LATIN_TECH_TOKEN_RE = /^[A-Za-z][A-Za-z0-9\-_.]*$/;

function isProperNounOrTechTerm(m: Morpheme): boolean {
  const isProperNoun = m.pos === "名詞" && m.pos_detail_1 === "固有名詞";
  const isLatinTech = LATIN_TECH_TOKEN_RE.test(m.surface_form);
  return isProperNoun || isLatinTech;
}

function detectNgramRepetition(
  tokenized: TokenizedSentence[],
  leadRepeatThreshold = NGRAM_LEAD_REPEAT_THRESHOLD,
  templateMinCount = NGRAM_TEMPLATE_MIN_COUNT,
  templateRatioThreshold = NGRAM_TEMPLATE_RATIO_THRESHOLD
): [Finding[], Record<string, unknown>] {
  const findings: Finding[] = [];

  const leadBigrams: Array<[number, string, string, boolean]> = [];
  for (const ts of tokenized) {
    const leadMorphemes = stripLeadingSymbols(ts.morphemes).slice(0, 2);
    const surfaces = leadMorphemes.map((m) => m.surface_form);
    if (surfaces.length === 2) {
      const isTechLead = isProperNounOrTechTerm(leadMorphemes[0]);
      leadBigrams.push([ts.line, ts.rawText, surfaces.join(""), isTechLead]);
    }
  }

  const bigramCounter = new Map<string, number>();
  for (const [, , text] of leadBigrams) bigramCounter.set(text, (bigramCounter.get(text) ?? 0) + 1);

  for (const [bigram, count] of bigramCounter) {
    if (count >= leadRepeatThreshold) {
      const bigramLines = leadBigrams.filter(([, , text]) => text === bigram).map(([no]) => no);
      const related = formatRelatedLines(bigramLines);
      for (const [no, sent, text, isTechLead] of leadBigrams) {
        if (text !== bigram) continue;
        const severity: Finding["severity"] = "info";
        const detail = isTechLead
          ? `文頭2形態素「${bigram}」が${count}回反復（閾値${leadRepeatThreshold}回以上）。固有名詞/技術用語由来の可能性が高い。${related}`
          : `文頭2形態素「${bigram}」が${count}回反復（閾値${leadRepeatThreshold}回以上）。人間の意図的な反復技法との区別がつかないため参考情報として提示。${related}`;
        findings.push(
          makeFinding({
            line: no,
            category: "repeated_sentence_lead",
            excerpt: sent.slice(0, 20),
            severity,
            detail,
            related_lines: bigramLines,
          })
        );
      }
    }
  }

  const leadPosNgrams: Array<[number, string, string]> = [];
  for (const ts of tokenized) {
    const posSeq = stripLeadingSymbols(ts.morphemes)
      .slice(0, 4)
      .map((m) => m.pos);
    if (posSeq.length === 4) leadPosNgrams.push([ts.line, ts.rawText, posSeq.join("/")]);
  }

  const totalWithNgram = leadPosNgrams.length;
  const posCounter = new Map<string, number>();
  for (const [, , seq] of leadPosNgrams) posCounter.set(seq, (posCounter.get(seq) ?? 0) + 1);

  const stats: Record<string, unknown> = { lead_pos_4gram_top: null, lead_pos_4gram_ratio: null };
  if (totalWithNgram >= templateMinCount && posCounter.size) {
    let topSeq = "";
    let topCount = 0;
    for (const [seq, count] of posCounter) {
      if (count > topCount) {
        topSeq = seq;
        topCount = count;
      }
    }
    const ratio = topCount / totalWithNgram;
    stats.lead_pos_4gram_top = topSeq;
    stats.lead_pos_4gram_ratio = ratio;
    if (ratio >= templateRatioThreshold) {
      const templateLines = leadPosNgrams.filter(([, , seq]) => seq === topSeq).map(([no]) => no);
      const related = formatRelatedLines(templateLines);
      for (const [no, sent, seq] of leadPosNgrams) {
        if (seq !== topSeq) continue;
        findings.push(
          makeFinding({
            line: no,
            category: "repeated_syntax_template",
            excerpt: sent.slice(0, 20),
            severity: "info",
            detail: `文頭品詞4-gram「${topSeq}」が全文の${(ratio * 100).toFixed(1)}%で一致（閾値${(templateRatioThreshold * 100).toFixed(0)}%以上）。構文テンプレートの使い回しの疑い。${related}`,
            related_lines: templateLines,
          })
        );
      }
    }
  }

  return [findings, stats];
}

function computeMtld(tokens: string[], threshold = 0.72): number | null {
  if (tokens.length < 20) return null;

  function factorsOneDirection(seq: string[]): number {
    let factorCount = 0;
    let types = new Set<string>();
    let tokenCount = 0;
    for (const tok of seq) {
      types.add(tok);
      tokenCount += 1;
      const ttr = types.size / tokenCount;
      if (ttr <= threshold) {
        factorCount += 1;
        types = new Set();
        tokenCount = 0;
      }
    }
    if (tokenCount > 0) {
      const typesTtr = tokenCount ? types.size / tokenCount : 1.0;
      const partial = typesTtr < 1 ? (1 - typesTtr) / (1 - threshold) : 0.0;
      factorCount += Math.min(partial, 1.0);
    }
    return factorCount > 0 ? seq.length / factorCount : seq.length;
  }

  const forward = factorsOneDirection(tokens);
  const backward = factorsOneDirection([...tokens].reverse());
  return (forward + backward) / 2;
}

function detectLexicalDiversity(
  tokenized: TokenizedSentence[],
  minTokens = LEXDIV_MIN_TOKENS,
  ttrThreshold = TTR_THRESHOLD,
  mtldThreshold = MTLD_THRESHOLD,
  minDocChars = LEXDIV_MIN_DOC_CHARS
): [Finding[], Record<string, unknown>] {
  const contentTokens: string[] = [];
  const totalDocChars = tokenized.reduce((acc, ts) => acc + ts.rawText.length, 0);
  for (const ts of tokenized) {
    for (const m of ts.morphemes) {
      if (CONTENT_WORD_POS.has(m.pos)) contentTokens.push(dictionaryForm(m));
    }
  }

  const findings: Finding[] = [];
  const stats: Record<string, unknown> = {
    ttr: null,
    mtld: null,
    content_token_count: contentTokens.length,
    doc_char_count: totalDocChars,
    skipped_too_short: false,
  };
  if (totalDocChars < minDocChars) {
    stats.skipped_too_short = true;
    return [findings, stats];
  }
  if (contentTokens.length >= minTokens) {
    const ttr = new Set(contentTokens).size / contentTokens.length;
    const mtld = computeMtld(contentTokens);
    stats.ttr = ttr;
    stats.mtld = mtld;
    if (ttr < ttrThreshold) {
      findings.push(
        makeFinding({
          line: tokenized[0].line,
          category: "low_lexical_diversity_ttr",
          excerpt: `TTR=${ttr.toFixed(3)} (内容語 ${contentTokens.length} 語中 ${new Set(contentTokens).size} 種類)`,
          severity: "info",
          detail: `TTR(Type-Token Ratio)が閾値${ttrThreshold}未満。同じ語彙の使い回しが多い疑い`,
        })
      );
    }
    if (mtld !== null && mtld < mtldThreshold) {
      findings.push(
        makeFinding({
          line: tokenized[0].line,
          category: "low_lexical_diversity_mtld",
          excerpt: `MTLD=${mtld.toFixed(1)}`,
          severity: "info",
          detail: `MTLD が閾値${mtldThreshold}未満。文章長で正規化した語彙多様性が低い疑い`,
        })
      );
    }
  }
  return [findings, stats];
}

async function detectLowSpecificity(
  lines: Array<[number, string]>,
  rawLinesByNo: Map<number, string> | null,
  minChars = LOW_SPECIFICITY_MIN_CHARS,
  minContentWords = LOW_SPECIFICITY_MIN_CONTENT_WORDS,
  properNounWeight = LOW_SPECIFICITY_PROPER_NOUN_WEIGHT,
  numericWeight = LOW_SPECIFICITY_NUMERIC_WEIGHT,
  exampleMarkerBonus = LOW_SPECIFICITY_EXAMPLE_MARKER_BONUS,
  abstractNounWeight = LOW_SPECIFICITY_ABSTRACT_NOUN_WEIGHT,
  scoreThreshold = LOW_SPECIFICITY_SCORE_THRESHOLD
): Promise<[Finding[], Record<string, unknown>]> {
  const tokenizer = await getTokenizer();
  const findings: Finding[] = [];
  const paragraphs = iterParagraphsWithLines(lines);
  let evaluated = 0;
  let fired = 0;

  for (const paraLines of paragraphs) {
    const [firstNo] = paraLines[0];
    const paraMasked = paraLines.map(([, t]) => t).join("\n");
    const paraChars = paraMasked.length;
    if (paraChars < minChars) continue;

    let morphemes: Morpheme[] = [];
    for (const [, paraLine] of paraLines) {
      if (!paraLine.trim()) continue;
      morphemes = morphemes.concat(tokenizer.tokenize(paraLine));
    }
    const contentWords = morphemes.filter((m) => CONTENT_WORD_POS.has(m.pos));
    if (contentWords.length < minContentWords) continue;

    evaluated += 1;

    const properNounCount = contentWords.filter((m) => m.pos === "名詞" && m.pos_detail_1 === "固有名詞").length;
    const abstractNounCount = contentWords.filter((m) => m.pos === "名詞" && ABSTRACT_NOUN_WORDS.has(dictionaryForm(m))).length;
    const numericHitCount = (paraMasked.match(NUMERIC_QUANTITY_RE) || []).length;
    const hasExampleMarker = EXAMPLE_MARKER_WORDS.some((marker) => paraMasked.includes(marker));

    const nContent = contentWords.length;
    const properNounDensity = properNounCount / nContent;
    const numericDensity = numericHitCount / nContent;
    const abstractNounRatio = abstractNounCount / nContent;

    const score =
      properNounDensity * properNounWeight +
      numericDensity * numericWeight +
      (hasExampleMarker ? exampleMarkerBonus : 0.0) -
      abstractNounRatio * abstractNounWeight;

    if (score < scoreThreshold) {
      fired += 1;
      const excerptSource = rawOrMasked(rawLinesByNo, firstNo, paraLines[0][1]);
      findings.push(
        makeFinding({
          line: firstNo,
          category: "low_specificity",
          excerpt: excerptSource.trim().slice(0, 40),
          severity: "info",
          detail:
            `段落の具体性スコア=${score.toFixed(3)}（閾値${scoreThreshold}未満）。` +
            `固有名詞密度=${properNounDensity.toFixed(3)}, 数値密度=${numericDensity.toFixed(3)}, ` +
            `抽象名詞率=${abstractNounRatio.toFixed(3)}, 例示マーカー=${hasExampleMarker ? "あり" : "なし"}。` +
            "固有名詞・数値・実例が乏しく一般論に留まっている疑い。素材不足のサインであり、文体の修正でなく情報収集を検討する" +
            "（revision-guide.md の素材不足の分岐を参照）",
        })
      );
    }
  }

  return [findings, { paragraphs_evaluated: evaluated, paragraphs_fired: fired }];
}

// --- 英語統語の検出 ---
const INANIMATE_SUBJECT_PATTERNS: RegExp[] = [
  /(これ|それ|この事実|そのこと)(は|が).{0,40}(もたらす|示す|意味する|証明する|生み出す|反映する)/g,
  /.{0,20}(こと|事実)(は|が).{0,40}(もたらす|示す|意味する|証明する|生み出す|反映する)/g,
];
const CLEFT_BECAUSE_HEAD = /^(それ|これ|この)は.{0,60}(である|だ)$/;
const BECAUSE_HEAD = /^(なぜなら|というのも)/;

function detectEnglishSyntaxSmell(
  lines: Array<[number, string]>,
  rawLinesByNo: Map<number, string> | null
): Finding[] {
  const findings: Finding[] = [];
  for (const [no, line] of lines) {
    const rawLine = rawOrMasked(rawLinesByNo, no, line);
    for (const pat of INANIMATE_SUBJECT_PATTERNS) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(line)) !== null) {
        const excerpt = rawLine.length >= m.index + m[0].length ? rawLine.slice(m.index, m.index + m[0].length) : m[0];
        findings.push(
          makeFinding({
            line: no,
            category: "english_syntax_inanimate_subject",
            excerpt,
            severity: "info",
            detail: "無生物主語+他動詞的述語（表層パターン、英語統語の直訳調の可能性、要人間判断）",
          })
        );
        if (m.index === pat.lastIndex) pat.lastIndex++;
      }
    }
  }

  const sentences = splitSentencesWithLines(lines, rawLinesByNo ?? undefined);
  for (let i = 0; i < sentences.length - 1; i++) {
    const [no1, s1, r1] = sentences[i];
    const [, s2, r2] = sentences[i + 1];
    if (CLEFT_BECAUSE_HEAD.test(s1) && BECAUSE_HEAD.test(s2)) {
      findings.push(
        makeFinding({
          line: no1,
          category: "english_syntax_cleft_because",
          excerpt: `${r1}。${r2}`,
          severity: "warn",
          detail: "「それは〜である。なぜなら〜だ」型の強調構文（英語 It is ... because ... の直訳調）",
        })
      );
    }
  }
  return findings;
}

function detectInanimateSubjectMorph(tokenized: TokenizedSentence[]): Finding[] {
  const findings: Finding[] = [];
  for (const ts of tokenized) {
    const surfaces = ts.morphemes.map((m) => m.surface_form);
    const poss = ts.morphemes.map((m) => m.pos);
    const dictForms = ts.morphemes.map((m) => dictionaryForm(m));
    const n = ts.morphemes.length;
    let skipUntil = -1;
    for (let i = 0; i < n; i++) {
      if (i <= skipUntil) continue;
      let isAbstractSubject = ABSTRACT_PRONOUNS.has(surfaces[i]) || (poss[i] === "名詞" && ["こと", "事実", "の"].includes(surfaces[i]));
      let subjectEnd = i;
      if (!isAbstractSubject) {
        if (i + 1 < n && ABSTRACT_PRONOUN_PHRASES.has(surfaces[i] + surfaces[i + 1])) {
          isAbstractSubject = true;
          subjectEnd = i + 1;
        }
      }
      if (!isAbstractSubject) continue;
      skipUntil = Math.max(skipUntil, subjectEnd);
      const j = subjectEnd + 1;
      if (j >= n || poss[j] !== "助詞" || (surfaces[j] !== "が" && surfaces[j] !== "は")) continue;
      for (let k = j + 1; k < n; k++) {
        if (poss[k] === "動詞" && TRANSITIVE_SMELL_VERBS.has(dictForms[k])) {
          const spanStart = morphemeBegin(ts.morphemes[Math.max(0, i - 3)]);
          const spanEnd = morphemeEnd(ts.morphemes[k]);
          const excerpt = ts.rawText.slice(spanStart, spanEnd);
          const subjectText = surfaces.slice(i, subjectEnd + 1).join("");
          findings.push(
            makeFinding({
              line: ts.line,
              category: "inanimate_subject_morph",
              excerpt,
              severity: "info",
              detail: `品詞列マッチ: 抽象主語「${subjectText}」+ ${surfaces[j]} + 他動詞的述語「${dictForms[k]}」（英語統語の直訳調の疑い）`,
            })
          );
          break;
        }
      }
    }
  }
  return findings;
}

// --- 構造層検出器（Markdown マスク前の raw テキストを見る） ---
const BOLD_SPAN_RE = /\*\*[^*\n]+\*\*/g;
const BOLD_DENSITY_PER_1000_THRESHOLD = 3.0;
const BULLET_LINE_RATIO_THRESHOLD = 0.35;
const BULLET_LINE_MIN_LINES = 10;
const BOILERPLATE_HEADING_WORDS = new Set(["まとめ", "おわりに", "終わりに", "さいごに", "最後に", "結論", "総括", "conclusion"]);
const NUMBERED_PHASE_RE = /(フェーズ|ステップ|段階|ステージ)\s*[0-9０-９]/g;
const NUMBERED_PHASE_MIN_COUNT = 3;
const EMOJI_SYMBOL_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{2757}\u{2753}]/gu;
const EMOJI_SYMBOL_PER_1000_THRESHOLD = 2.0;

function detectStructuralAiHabits(rawText: string): [Finding[], Record<string, unknown>] {
  const findings: Finding[] = [];
  const totalChars = rawText.length || 1;

  const boldHits = Array.from(rawText.matchAll(BOLD_SPAN_RE));
  const boldPer1000 = (boldHits.length / totalChars) * 1000;
  if (boldPer1000 >= BOLD_DENSITY_PER_1000_THRESHOLD && boldHits.length >= 3) {
    const firstLine = (rawText.slice(0, boldHits[0].index).match(/\n/g) || []).length + 1;
    findings.push(
      makeFinding({
        line: firstLine,
        category: "high_bold_density",
        excerpt: `太字スパン${boldHits.length}箇所（1000字あたり${boldPer1000.toFixed(2)}）`,
        severity: "info",
        detail: `太字（**...**）の使用密度が閾値（1000字あたり${BOLD_DENSITY_PER_1000_THRESHOLD}）以上。強調の多用は教科書的なAI生成文に見られる傾向（実験的検出器、閾値は暫定）`,
      })
    );
  }

  const rawLines = iterLinesWithNo(rawText);
  const nonBlankLines = rawLines.filter(([, line]) => line.trim());
  const bulletLines = nonBlankLines.filter(([, line]) => LIST_ITEM_RE.test(line)).map(([no]) => no);
  if (nonBlankLines.length >= BULLET_LINE_MIN_LINES) {
    const bulletRatio = bulletLines.length / nonBlankLines.length;
    if (bulletRatio >= BULLET_LINE_RATIO_THRESHOLD) {
      findings.push(
        makeFinding({
          line: bulletLines[0] ?? 1,
          category: "high_bullet_ratio",
          excerpt: `箇条書き行${bulletLines.length}/${nonBlankLines.length}行（${(bulletRatio * 100).toFixed(1)}%）`,
          severity: "info",
          detail: `箇条書き行の比率が閾値${(BULLET_LINE_RATIO_THRESHOLD * 100).toFixed(0)}%以上。文章より箇条書きに頼る構成は教科書的なAI生成文に見られる傾向（実験的検出器）`,
          related_lines: bulletLines.length > 1 ? bulletLines : null,
        })
      );
    }
  }

  const boilerplateLines: Array<[number, string, string]> = [];
  for (const [no, line] of iterLinesWithNo(rawText)) {
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const headingText = line.slice(m[0].length).trim().toLowerCase();
    for (const word of BOILERPLATE_HEADING_WORDS) {
      if (headingText.startsWith(word.toLowerCase())) {
        boilerplateLines.push([no, line.trim(), word]);
        break;
      }
    }
  }
  for (const [no, lineText, word] of boilerplateLines) {
    findings.push(
      makeFinding({
        line: no,
        category: "boilerplate_heading",
        excerpt: lineText.slice(0, 40),
        severity: "info",
        detail: `定型見出し「${word}」系での締め。予告・構成の型のみで中身を語らない教科書的なAI生成文に見られる傾向（実験的検出器）`,
      })
    );
  }

  const phaseHits = Array.from(rawText.matchAll(NUMBERED_PHASE_RE));
  if (phaseHits.length >= NUMBERED_PHASE_MIN_COUNT) {
    const firstLine = (rawText.slice(0, phaseHits[0].index).match(/\n/g) || []).length + 1;
    findings.push(
      makeFinding({
        line: firstLine,
        category: "numbered_phase_structure",
        excerpt: `番号付きフェーズ表現が${phaseHits.length}回出現`,
        severity: "info",
        detail: `「フェーズ/ステップ/段階+番号」の表現が閾値${NUMBERED_PHASE_MIN_COUNT}回以上。機械的な段階分割は教科書的なAI生成文に見られる傾向（実験的検出器）`,
      })
    );
  }

  const emojiHits = Array.from(rawText.matchAll(EMOJI_SYMBOL_RE));
  const emojiPer1000 = (emojiHits.length / totalChars) * 1000;
  if (emojiPer1000 >= EMOJI_SYMBOL_PER_1000_THRESHOLD && emojiHits.length >= 3) {
    const firstLine = (rawText.slice(0, emojiHits[0].index).match(/\n/g) || []).length + 1;
    findings.push(
      makeFinding({
        line: firstLine,
        category: "high_emoji_symbol_density",
        excerpt: `絵文字/装飾記号${emojiHits.length}箇所（1000字あたり${emojiPer1000.toFixed(2)}）`,
        severity: "info",
        detail: `絵文字・装飾記号の使用密度が閾値（1000字あたり${EMOJI_SYMBOL_PER_1000_THRESHOLD}）以上（実験的検出器、閾値は暫定）`,
      })
    );
  }

  const stats = {
    bold_span_count: boldHits.length,
    bold_per_1000_chars: boldPer1000,
    bullet_line_count: bulletLines.length,
    non_blank_line_count: nonBlankLines.length,
    boilerplate_heading_count: boilerplateLines.length,
    numbered_phase_hit_count: phaseHits.length,
    emoji_symbol_count: emojiHits.length,
    emoji_symbol_per_1000_chars: emojiPer1000,
  };
  return [findings, stats];
}

// ---------------------------------------------------------------------------
// 比喩動詞・疑似具体語・表記の不自然さ（出典: yomiyasu <https://github.com/nanaism/yomiyasu>、MIT）
//
// 太字密度等と同じく raw テキスト（HTMLコメントのみマスク済み）に対して働く。
// いずれも severity="info" 固定（当リポジトリのコーパス校正を経ていないため、
// 他の校正済み検出器の warn/critical とは信頼度が異なることを明示する）。
// 見出し行は（redundant_bracket を除き）スキャン対象から外す。元のPythonリンターの
// スキャン範囲（箇条書き行は対象、見出し行は対象外）をそのまま踏襲する。
// ---------------------------------------------------------------------------

// yomiyasu の SLOP_WORDS をそのまま踏襲した語彙（質感を装う疑似具体語・抽象比喩名詞・必殺技造語）。
const SLOP_WORDS: string[] = [
  "手触り",
  "肌感",
  "肌感覚",
  "体温",
  "温度感",
  "熱量",
  "血の通った",
  "泥臭い",
  "泥臭さ",
  "解像度",
  "腹落ち",
  "メンタルモデル",
  "本質的",
  "地に足のついた",
  "等身大",
  "営み",
  "装置",
  "意思決定OS",
  "土台",
  "羅針盤",
  "起爆剤",
  "触媒",
  "真理",
  "虚飾",
  "境地",
  "美学",
  "深淵",
  "冷徹",
  "禁欲的",
  "優美",
  "極致",
  "宿命",
  "正本",
];

// 比喩動詞・AI偏愛動詞パターン（yomiyasu の METAPHOR_VERB_PATTERNS を踏襲。
// 「1つずつ潰す」の原パターンは文字クラス化のバグがあったため修正して移植）。
const METAPHOR_VERB_PATTERNS: Array<[RegExp, string]> = [
  [/(地味に|よく|じわじわ)効[きくいた]/g, "比喩動詞「効く」の過剰使用"],
  [/静かに(壊れ|落ち|失敗|沈黙)/g, "英語直訳「静かに壊れる (silently fail)」"],
  [/黙って(無視|捨て|スキップ|破棄)/g, "英語直訳「黙って無視される」"],
  [/側に倒[すしせ]/g, "判断を方向で表現する「〜側に倒す」"],
  [/時間[をに]溶か[したす]/g, "比喩動詞「時間を溶かす」"],
  [/(1つずつ|一つずつ)潰(し|している|していく|した)/g, "比喩動詞「潰す」"],
  [/した瞬間に?/g, "英語直訳「〜した瞬間 (the moment ...)」"],
  [/(前提|基盤)が崩れ[るた]/g, "抽象比喩「前提が崩れる」"],
  [/文化が醸成/g, "非生物主語「文化が醸成される」"],
  [/プロセスが定着/g, "非生物主語「プロセスが定着する」"],
  [/事例が残した/g, "非生物主語「事例が残した」"],
];

const TRAILING_COLON_RE = /[：:]\s*$/;
const EM_DASH_RE = /[—―]{1,3}/g;
const HALFWIDTH_SPACE_AROUND_LATIN_RE = /([ぁ-んァ-ヶ一-龥])\s+([A-Za-z0-9_-]{2,})\s+([ぁ-ん])/;
const MARKDOWN_LINK_INLINE_RE = /\[.*?\]\(.*?\)/;
const REDUNDANT_HEADING_BRACKET_RE = /[（(](素の出力|いわゆる|概要|詳細)[）)]/;
const FENCE_LINE_RE = /^\s*(`{3,}|~{3,})/;

interface ScannableLine {
  no: number;
  raw: string;
  scan: string; // インラインコードスパンを除去した走査用テキスト
  isHeading: boolean;
}

/** 太字密度等と同じスキャン範囲（コードフェンス内・引用・表・画像・HTMLタグを除外）で
 * raw テキストを走査可能な行列へ変換する。箇条書き行は除外しない（yomiyasu 本家の
 * スキャン範囲に合わせる）。 */
function iterScannableLines(rawText: string): ScannableLine[] {
  const out: ScannableLine[] = [];
  const lines = rawText.split("\n");
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  lines.forEach((line, idx0) => {
    const no = idx0 + 1;
    const fenceMatch = line.match(FENCE_LINE_RE);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const fc = run[0];
      const fl = run.length;
      const closeEligible = line.slice(fenceMatch[0].length).trim() === "";
      if (!inFence) {
        inFence = true;
        fenceChar = fc;
        fenceLen = fl;
      } else if (fc === fenceChar && fl >= fenceLen && closeEligible) {
        inFence = false;
      }
      return;
    }
    if (inFence) return;

    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith(">") || trimmed.startsWith("|") || trimmed.startsWith("![") || trimmed.startsWith("<")) return;

    out.push({
      no,
      raw: trimmed,
      scan: trimmed.replace(/`[^`]+`/g, ""),
      isHeading: HEADING_RE.test(line),
    });
  });
  return out;
}

function detectMetaphorVerbs(rawText: string): Finding[] {
  const findings: Finding[] = [];
  for (const { no, raw, scan, isHeading } of iterScannableLines(rawText)) {
    if (isHeading) continue;
    for (const [pattern, desc] of METAPHOR_VERB_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(scan)) {
        findings.push(
          makeFinding({
            line: no,
            category: "metaphor_verb",
            excerpt: raw.slice(0, 40),
            severity: "info",
            detail: `${desc}が検出された。不自然な比喩動詞であれば、ふだん使う動詞や客観的な表現に書き直す（比喩が運んでいた含みは別のふだんの言葉で残す）。文字どおりの動作・状態変化（物理的な物体や身体が主語）であれば言い換える必要はない`,
          })
        );
      }
    }
  }
  return findings;
}

function detectSlopVocabulary(rawText: string): Finding[] {
  const findings: Finding[] = [];
  for (const { no, raw, scan, isHeading } of iterScannableLines(rawText)) {
    if (isHeading) continue;
    for (const word of SLOP_WORDS) {
      if (scan.includes(word)) {
        findings.push(
          makeFinding({
            line: no,
            category: "slop_vocabulary",
            excerpt: raw.slice(0, 40),
            severity: "info",
            detail: `AI頻出語彙「${word}」が含まれている。文脈上必要のない比喩や大げさな装飾であれば、ふだん使う自然な表現に置き換える。専門用語として正当に機能している場合や、文の主題そのものを担っている語は無理に排除しない`,
          })
        );
      }
    }
  }
  return findings;
}

function detectFormattingSmells(rawText: string): Finding[] {
  const findings: Finding[] = [];
  for (const { no, raw, scan, isHeading } of iterScannableLines(rawText)) {
    if (isHeading) {
      if (REDUNDANT_HEADING_BRACKET_RE.test(scan)) {
        findings.push(
          makeFinding({
            line: no,
            category: "redundant_bracket",
            excerpt: raw.slice(0, 40),
            severity: "info",
            detail: "見出しに情報量の増えない言い換えカッコが含まれている。平文で簡潔に記述する",
          })
        );
      }
      continue;
    }

    if (TRAILING_COLON_RE.test(scan) && !scan.startsWith("http")) {
      findings.push(
        makeFinding({
          line: no,
          category: "trailing_colon",
          excerpt: raw.slice(0, 40),
          severity: "info",
          detail: "文末にコロン（：/:）が使われている。英語直訳の記法を避け、句点（。）で終えるか前置きを省く",
        })
      );
    }

    EM_DASH_RE.lastIndex = 0;
    if (EM_DASH_RE.test(scan)) {
      findings.push(
        makeFinding({
          line: no,
          category: "em_dash",
          excerpt: raw.slice(0, 40),
          severity: "info",
          detail: "ダッシュ記号（—/―）が使われている。日本語の地の文では助詞や読点でつなぐか、括弧（同格・補足の挿入）か句点二文（言い換え・敷衍）に置き換える",
        })
      );
    }

    if (HALFWIDTH_SPACE_AROUND_LATIN_RE.test(scan) && !MARKDOWN_LINK_INLINE_RE.test(scan)) {
      findings.push(
        makeFinding({
          line: no,
          category: "unnatural_halfwidth_space",
          excerpt: raw.slice(0, 40),
          severity: "info",
          detail: "英単語の前後に不要な半角空白が空けられている。日本語の助詞・平仮名と自然に接続させる",
        })
      );
    }
  }
  return findings;
}

// 文末表現の型（yomiyasu の check_sentence_end_repetitions を踏襲）。
const SENTENCE_END_TYPES: Array<[RegExp, string]> = [
  [/です$/, "です"],
  [/ます$/, "ます"],
  [/でした$/, "でした"],
  [/ました$/, "ました"],
  [/である$/, "である"],
  [/だろう$/, "だろう"],
  [/だ$/, "だ"],
];

function classifySentenceEnd(sentence: string): string {
  const clean = sentence.replace(/[。！？\s]+$/, "");
  for (const [pattern, label] of SENTENCE_END_TYPES) {
    if (pattern.test(clean)) return label;
  }
  return "その他";
}

function detectSentenceEndRepetition(sentences: Array<[number, string, string]>): Finding[] {
  const findings: Finding[] = [];
  let count = 1;
  let prevType: string | null = null;
  sentences.forEach(([no, maskedText, rawText], i) => {
    const type = classifySentenceEnd(maskedText);
    if (i > 0 && type !== "その他" && type === prevType) {
      count += 1;
      if (count === 3) {
        findings.push(
          makeFinding({
            line: no,
            category: "sentence_end_repetition",
            excerpt: (rawText || maskedText).slice(0, 40),
            severity: "info",
            detail: `同一文末「${type}」が3文以上連続している。体言止め・動詞連用形中止・倒置などを交差させてリズムを調整する`,
          })
        );
      }
    } else {
      count = 1;
    }
    prevType = type;
  });
  return findings;
}

// --- 読解負荷レーン（推敲用の指さし。AI臭さスコアには含まれない） ---
const READING_LOAD_SENTENCE_MAX_CHARS = 90;
const READING_LOAD_BURIED_LIST_MIN_ITEMS = 3;
const READING_LOAD_BURIED_LIST_MIN_CHARS = 50;
const READING_LOAD_BURIED_LIST_3ITEM_MIN_CHARS = 80;
const READING_LOAD_KANJI_RUN_MAX = 6;
const READING_LOAD_NO_CHAIN_MIN = 3;
const READING_LOAD_NEGATION_MAX_GAP = 6;

const KANJI_RUN_RE = new RegExp(`[一-鿿々]{${READING_LOAD_KANJI_RUN_MAX + 1},}`, "g");

// kuromoji(IPADIC) の否定系正規化形。sudachipy の normalized_form 相当は無いため、
// dictionary_form ないし surface を候補集合と直接照合する近似実装。
const NEGATION_FORMS = new Set(["ない", "無い", "ぬ", "ず", "ん"]);
const NEGATION_POS = new Set(["助動詞", "形容詞"]);

const WHITESPACE_RUN_RE = /\s{2,}/g;

function readingLength(text: string): number {
  return text.replace(WHITESPACE_RUN_RE, " ").trim().length;
}

function spanContainsProperNoun(morphemes: Morpheme[], start: number, end: number): boolean {
  return morphemes.some((m) => morphemeEnd(m) > start && morphemeBegin(m) < end && m.pos_detail_1 === "固有名詞");
}

function isNegation(m: Morpheme): boolean {
  return NEGATION_POS.has(m.pos) && (NEGATION_FORMS.has(dictionaryForm(m)) || NEGATION_FORMS.has(m.surface_form));
}

const OBLIGATION_SPANS = [
  "といけ",
  "とだめ",
  "とダメ",
  "ばならな",
  "ばなりま",
  "ばいけな",
  "てはならな",
  "てはなりま",
  "てはいけな",
  "ざるを得",
  "ざるをえ",
];
function isObligationForm(span: string): boolean {
  return OBLIGATION_SPANS.some((s) => span.includes(s));
}

const CONDITIONAL_NEGATION_RE = /^(?:ない|なけれ|なく)(?:と(?!は)|ば|ければ)/;
function isConditionalNegation(span: string): boolean {
  return CONDITIONAL_NEGATION_RE.test(span);
}

const OPEN_PARENS = new Set(["（", "(", "「", "『", "【", "［", "["]);
const CLOSE_PARENS = new Set(["）", ")", "」", "』", "】", "］", "]"]);

function segmentEndsWithNoun(segment: Morpheme[]): boolean {
  let i = segment.length;
  while (i > 0) {
    const m = segment[i - 1];
    if (m.pos !== "記号") break;
    if (CLOSE_PARENS.has(m.surface_form)) {
      let depth = 1;
      let j = i - 1;
      while (j > 0 && depth) {
        j -= 1;
        const s = segment[j].surface_form;
        if (CLOSE_PARENS.has(s)) depth += 1;
        else if (OPEN_PARENS.has(s)) depth -= 1;
      }
      i = j;
    } else {
      i -= 1;
    }
  }
  return i > 0 && segment[i - 1].pos === "名詞";
}

function longestNounPhraseRun(morphemes: Morpheme[]): [number, number, number] | null {
  const bounds: Array<[number, number]> = [];
  let start = 0;
  morphemes.forEach((m, i) => {
    if (m.surface_form === "、") {
      bounds.push([start, i]);
      start = i + 1;
    }
  });
  bounds.push([start, morphemes.length]);

  const need = READING_LOAD_BURIED_LIST_MIN_ITEMS - 1;
  let best: [number, number, number] | null = null;
  let run: Array<[number, number]> = [];
  bounds.forEach(([s, e], idx) => {
    if (e > s && segmentEndsWithNoun(morphemes.slice(s, e))) {
      run.push([s, e]);
    } else {
      run = [];
    }
    const hasTail = idx + 1 < bounds.length;
    if (run.length >= need && hasTail) {
      const items = run.length + 1;
      if (best === null || items > best[2]) {
        best = [run[0][0], bounds[idx + 1][1], items];
      }
    }
  });
  return best;
}

function hasPunctuationBetween(morphemes: Morpheme[], i: number, j: number): boolean {
  return morphemes.slice(i + 1, j).some((m) => m.pos === "記号");
}

function detectReadingLoad(tokenized: TokenizedSentence[], sentenceMaxChars = READING_LOAD_SENTENCE_MAX_CHARS): Finding[] {
  const findings: Finding[] = [];
  for (const ts of tokenized) {
    const text = ts.text;
    const excerpt = (ts.rawText || text).trim().slice(0, 40);

    const readingLen = readingLength(text);
    if (readingLen > sentenceMaxChars) {
      findings.push(
        makeFinding({
          line: ts.line,
          category: "sentence_too_long",
          excerpt,
          severity: "info",
          detail: `一文が${readingLen}字（目安${sentenceMaxChars}字）。カタログ B1。一文一義になっているか確認する（分割の結果、字数が増えるのは正しい）`,
        })
      );
    }

    for (const m of text.matchAll(KANJI_RUN_RE)) {
      if (spanContainsProperNoun(ts.morphemes, m.index!, m.index! + m[0].length)) continue;
      findings.push(
        makeFinding({
          line: ts.line,
          category: "kanji_run",
          excerpt: m[0],
          severity: "info",
          detail: `漢字が${m[0].length}字連続（目安${READING_LOAD_KANJI_RUN_MAX}字）。カタログ C1。語の切れ目が読み取れるか確認する`,
        })
      );
    }

    const morphemes = ts.morphemes;

    const run = longestNounPhraseRun(morphemes);
    if (run !== null) {
      const [start, end, items] = run;
      const minChars = items <= 3 ? READING_LOAD_BURIED_LIST_3ITEM_MIN_CHARS : READING_LOAD_BURIED_LIST_MIN_CHARS;
      if (readingLen >= minChars) {
        findings.push(
          makeFinding({
            line: ts.line,
            category: "buried_list",
            excerpt: morphemes
              .slice(start, end)
              .map((m) => m.surface_form)
              .join("")
              .slice(0, 40),
            severity: "info",
            detail: `同格の名詞句が読点で${items}個並んでいる（一文${readingLen}字）。カタログ F1。箇条書きに開くと並列関係を読み手が再構成せずに済む（「**項目**: 説明」の定型にはしない）`,
          })
        );
      }
    }

    const negationIdx: number[] = [];
    morphemes.forEach((m, i) => {
      if (isNegation(m)) negationIdx.push(i);
    });
    for (let k = 0; k < negationIdx.length - 1; k++) {
      const a = negationIdx[k];
      const b = negationIdx[k + 1];
      const span = morphemes
        .slice(a, b + 1)
        .map((m) => m.surface_form)
        .join("");
      if (
        b - a <= READING_LOAD_NEGATION_MAX_GAP &&
        !hasPunctuationBetween(morphemes, a, b) &&
        !isObligationForm(span) &&
        !isConditionalNegation(span)
      ) {
        findings.push(
          makeFinding({
            line: ts.line,
            category: "double_negative",
            excerpt: span,
            severity: "info",
            detail:
              "否定が二重に掛かっている可能性。カタログ A1/A2。肯定に畳むなら真偽が反転していないか必ず確認する" +
              "（「招かないとは言えない」＝「招くことがある」）。控えめな肯定が本質的な箇所は触らない",
          })
        );
        break;
      }
    }

    const noIdx: number[] = [];
    morphemes.forEach((m, i) => {
      if (m.surface_form === "の" && m.pos === "助詞" && (m.pos_detail_1 === "格助詞" || m.pos_detail_1 === "連体化")) {
        noIdx.push(i);
      }
    });
    for (let k = 0; k <= noIdx.length - READING_LOAD_NO_CHAIN_MIN; k++) {
      const window = noIdx.slice(k, k + READING_LOAD_NO_CHAIN_MIN);
      const gapsOk = window.slice(1).every((y, idx) => y - window[idx] <= 3);
      if (gapsOk && !hasPunctuationBetween(morphemes, window[0], window[window.length - 1])) {
        findings.push(
          makeFinding({
            line: ts.line,
            category: "no_chain",
            excerpt: morphemes
              .slice(window[0], window[window.length - 1] + 1)
              .map((m) => m.surface_form)
              .join(""),
            severity: "info",
            detail: `格助詞「の」が${READING_LOAD_NO_CHAIN_MIN}連以上。カタログ C2。どこかを動詞・連用に開く（「上限の設定の検討」→「上限をどう設定するか検討する」）`,
          })
        );
        break;
      }
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return findings;
}

async function runReadingLoad(rawText: string, genre: string | null = null): Promise<[Finding[], Record<string, unknown>]> {
  const profile = (genre && GENRE_PROFILES[genre]) || {};
  const text = maskMarkdownStructure(rawText);
  const lines = iterLinesWithNo(text);
  const rawLinesByNo = new Map(iterLinesWithNo(rawText));
  const sentences = splitSentencesWithLines(lines, rawLinesByNo);
  const tokenized = await tokenizeSentences(sentences);

  const findings = detectReadingLoad(tokenized, profile.reading_load_sentence_max_chars ?? READING_LOAD_SENTENCE_MAX_CHARS);
  const stats: Record<string, any> = { total: findings.length, sentences: tokenized.length, genre, by_category: {} };
  for (const f of findings) stats.by_category[f.category] = (stats.by_category[f.category] ?? 0) + 1;
  return [findings, stats];
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------
const EXPERIMENTAL_CATEGORIES = new Set([
  "high_length_autocorrelation",
  "paragraph_lead_conjunction",
  "repeated_syntax_template",
  "english_syntax_cleft_because",
  "high_bold_density",
  "high_bullet_ratio",
  "boilerplate_heading",
  "numbered_phase_structure",
  "high_emoji_symbol_density",
]);

async function runLint(
  rawText: string,
  genre: string | null = null,
  experimental = false
): Promise<[Finding[], Record<string, unknown>]> {
  const profile = (genre && GENRE_PROFILES[genre]) || {};

  const [structuralFindings, structuralStats] = detectStructuralAiHabits(maskHtmlComments(rawText));
  const commentMaskedText = maskHtmlComments(rawText);
  const metaphorFindings = detectMetaphorVerbs(commentMaskedText);
  const slopFindings = detectSlopVocabulary(commentMaskedText);
  const formattingFindings = detectFormattingSmells(commentMaskedText);

  const text = maskMarkdownStructure(rawText);
  const lines = iterLinesWithNo(text);
  const rawLinesByNo = new Map(iterLinesWithNo(rawText));
  const sentences = splitSentencesWithLines(lines, rawLinesByNo);
  const tokenized = await tokenizeSentences(sentences);

  let findings: Finding[] = [];
  findings = findings.concat(structuralFindings);
  findings = findings.concat(detectForbiddenPhrases(lines, rawLinesByNo));
  findings = findings.concat(detectTranslationese(lines, rawLinesByNo));
  findings = findings.concat(
    detectAntithesisRepetition(
      lines,
      rawLinesByNo,
      ANTITHESIS_REPETITION_THRESHOLD,
      ANTITHESIS_RATE_INFO_BELOW,
      profile.antithesis_rate_critical_above ?? ANTITHESIS_RATE_CRITICAL_ABOVE
    )
  );
  findings = findings.concat(detectLowSentenceLengthVariance(sentences));
  findings = findings.concat(detectEnglishSyntaxSmell(lines, rawLinesByNo));
  findings = findings.concat(metaphorFindings);
  findings = findings.concat(slopFindings);
  findings = findings.concat(formattingFindings);
  findings = findings.concat(detectSentenceEndRepetition(sentences));

  const [nominalAndConjFindings, morphStats] = detectNominalEndingAndParagraphConjunctions(lines, tokenized, rawLinesByNo, {
    nominalMinChars: profile.nominal_min_chars ?? NOMINAL_ENDING_MIN_CHARS,
  });
  findings = findings.concat(nominalAndConjFindings);
  findings = findings.concat(detectTranslationeseMorph(tokenized));
  findings = findings.concat(detectInanimateSubjectMorph(tokenized));

  const [rhythmFindings, rhythmStats] = detectRhythmStatistics(tokenized);
  findings = findings.concat(rhythmFindings);

  const [ngramFindings, ngramStats] = detectNgramRepetition(tokenized, profile.lead_repeat_threshold ?? NGRAM_LEAD_REPEAT_THRESHOLD);
  findings = findings.concat(ngramFindings);

  const [lexdivFindings, lexdivStats] = detectLexicalDiversity(tokenized);
  findings = findings.concat(lexdivFindings);

  const [lowSpecFindings, lowSpecStats] = await detectLowSpecificity(lines, rawLinesByNo);
  findings = findings.concat(lowSpecFindings);

  if (!experimental) {
    findings = findings.filter((f) => !EXPERIMENTAL_CATEGORIES.has(f.category));
  }

  const disabledCategories = profile.disabled_categories;
  if (disabledCategories && disabledCategories.size) {
    findings = findings.filter((f) => !disabledCategories.has(f.category));
  }

  findings.sort((a, b) => a.line - b.line);

  const byCategory: Record<string, number> = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;

  const stats = {
    total_findings: findings.length,
    by_category: byCategory,
    genre,
    experimental,
    ...morphStats,
    rhythm: rhythmStats,
    ngram: ngramStats,
    lexical_diversity: lexdivStats,
    structural: structuralStats,
    low_specificity: lowSpecStats,
  };

  return [findings, stats];
}

const SEVERITY_LABEL: Record<string, string> = { info: "情報", warn: "警告", critical: "重大" };
const STATUS_LABEL: Record<string, string> = { new: "新規", persisting: "継続" };

function printHumanReport(
  filePath: string,
  findings: Finding[],
  stats: Record<string, any>,
  baselineSummary: Record<string, number> | null = null
): void {
  console.log(`=== lint: ${filePath} ===`);
  console.log(`検出件数: ${stats.total_findings}`);
  if (stats.by_category && Object.keys(stats.by_category).length) {
    console.log("カテゴリ別内訳:");
    const entries = Object.entries(stats.by_category as Record<string, number>).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of entries) console.log(`  - ${cat}: ${count}`);
  }
  if (baselineSummary !== null) {
    console.log(`ベースライン比較: 解消: ${baselineSummary.resolved}件 / 新規: ${baselineSummary.new}件 / 継続: ${baselineSummary.persisting}件`);
  }
  console.log();

  if (!findings.length) {
    console.log("検出なし。");
    return;
  }

  for (const f of findings) {
    const label = SEVERITY_LABEL[f.severity] ?? f.severity;
    const statusTag = f.status ? `[${STATUS_LABEL[f.status] ?? f.status}] ` : "";
    console.log(`${statusTag}[${label}] L${f.line} (${f.category})`);
    console.log(`    該当箇所: ${f.excerpt}`);
    if (f.detail) console.log(`    詳細    : ${f.detail}`);
    console.log();
  }
}

function printReadingLoadReport(findings: Finding[], stats: Record<string, any>): void {
  console.log("=== 読解負荷（推敲用の指さし・自然度スコアには含まない） ===");
  console.log(`指摘件数: ${stats.total ?? findings.length}（本文 ${stats.sentences ?? 0} 文）`);
  if (stats.by_category && Object.keys(stats.by_category).length) {
    console.log("カテゴリ別内訳:");
    const entries = Object.entries(stats.by_category as Record<string, number>).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of entries) console.log(`  - ${cat}: ${count}`);
  }
  console.log();

  if (!findings.length) {
    console.log("指摘なし。");
    return;
  }

  for (const f of findings) {
    console.log(`[指さし] L${f.line} (${f.category})`);
    console.log(`    該当箇所: ${f.excerpt}`);
    if (f.detail) console.log(`    詳細    : ${f.detail}`);
    console.log();
  }

  console.log("※ これらは「直すべき欠陥」ではなく「見るべき箇所」。読んで引っかからない文はいじらない。");
  console.log("※ 判断は references/readability-antipatterns.md の A〜J カタログに従う。");
}

function parseArgs(argv: string[]) {
  const args = {
    file: "" as string,
    json: false,
    baseline: null as string | null,
    genre: null as string | null,
    experimental: false,
    readingLoad: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--experimental") args.experimental = true;
    else if (a === "--reading-load") args.readingLoad = true;
    else if (a === "--baseline") args.baseline = argv[++i];
    else if (a === "--genre") args.genre = argv[++i];
    else positional.push(a);
  }
  args.file = positional[0] ?? "";
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("エラー: lint 対象の Markdown/テキストファイルを指定してください。");
    return 1;
  }
  if (args.genre && !(args.genre in GENRE_PROFILES)) {
    console.error(`エラー: --genre は ${Object.keys(GENRE_PROFILES).join("/")} のいずれかを指定してください。`);
    return 1;
  }

  const [text, err] = readSourceFile(args.file);
  if (err !== null) {
    console.error(err);
    return 1;
  }

  let baselineData: { findings: BaselineFinding[] } | null = null;
  if (args.baseline !== null) {
    if (!fs.existsSync(args.baseline)) {
      console.error(`エラー: --baseline ファイルが見つかりません: ${args.baseline}`);
      return 1;
    }
    let loadedBaseline: unknown;
    try {
      loadedBaseline = JSON.parse(fs.readFileSync(args.baseline, "utf-8"));
    } catch (exc: any) {
      console.error(`エラー: --baseline ファイルを読み込めません: ${args.baseline} (${exc?.message ?? exc})`);
      return 1;
    }
    const [validated, warnings] = validateBaselineData(loadedBaseline);
    baselineData = validated;
    for (const w of warnings) console.error(`警告: ${w}`);
  }

  const [findings, stats] = await runLint(text as string, args.genre, args.experimental);

  let readingLoadFindings: Finding[] | null = null;
  let readingLoadStats: Record<string, unknown> | null = null;
  if (args.readingLoad) {
    [readingLoadFindings, readingLoadStats] = await runReadingLoad(text as string, args.genre);
  }

  let resolved: BaselineFinding[] = [];
  let baselineSummary: Record<string, number> | null = null;
  if (baselineData !== null) {
    [resolved, baselineSummary] = computeBaselineDiff(findings, baselineData);
  }

  if (args.json) {
    const output: Record<string, unknown> = {
      file: args.file,
      stats,
      findings: findings.map(findingToDict),
    };
    if (baselineSummary !== null) {
      output.baseline = { file: args.baseline, summary: baselineSummary, resolved };
    }
    if (readingLoadFindings !== null) {
      output.reading_load = { stats: readingLoadStats, findings: readingLoadFindings.map(findingToDict) };
    }
    console.log(JSON.stringify(output, null, 2));
  } else {
    printHumanReport(args.file, findings, stats, baselineSummary);
    if (readingLoadFindings !== null) {
      printReadingLoadReport(readingLoadFindings, readingLoadStats ?? {});
    }
  }

  return 0;
}

main().then((code) => process.exit(code));
