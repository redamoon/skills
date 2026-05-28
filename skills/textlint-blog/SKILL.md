---
name: textlint-blog
description: ブログ記事のMarkdownに対してtextlintを実行し、技術文書の品質向上とAI生成テキスト特有の表現（AIっぽさ）を検出・修正する。
license: MIT
---

# Textlint for Blog

## When to Use

- ブログ記事のMarkdownを執筆・編集した直後
- ブログ記事の品質チェックや校正を依頼されたとき
- AIっぽい表現を検出・修正したいとき

## Instructions

### 概要

ブログ記事のMarkdownを編集・作成する際は、必ず以下のtextlintルールを使用してテキストの品質をチェックします。

- `textlint-rule-preset-ja-technical-writing`: 技術文書の品質向上
- `textlint-rule-preset-ai-writing`: AI生成テキスト特有の表現を検出・修正（AIっぽさをなくすため）

### ファイル編集・作成時の手順

対象のMarkdownファイルを編集または作成する際は、以下の手順を必ず実行してください。

1. **編集前**: 現在のファイルの内容を確認
2. **編集後**: textlintを実行してチェック
3. **エラーがある場合**: 自動修正可能なものは`textlint --fix`で修正し、手動修正が必要なものはユーザーに報告

### textlint実行コマンド

```bash
# 対象ファイルをチェック
npx textlint "対象ファイルパス"

# 複数ファイル・glob でまとめてチェックする場合
npx textlint "**/*.md"

# 自動修正可能な問題を修正
npx textlint --fix "対象ファイルパス"
```

### 使用するtextlint設定

ブログ記事用の設定として、以下のルールを必ず適用します。

```json
{
  "rules": {
    "preset-ja-technical-writing": {
      "ja-no-mixed-period": true,
      "ja-no-weak-phrase": true,
      "ja-no-abusage": true,
      "ja-no-redundant-expression": true,
      "ja-no-successive-word": true,
      "ja-no-orthographic-variants": true,
      "max-kanji-continuous-len": {
        "max": 5
      },
      "sentence-length": {
        "max": 100
      }
    },
    "preset-ai-writing": true
  }
}
```

**重要**: `preset-ai-writing`は、AI生成テキスト特有の表現（AIっぽさ）を検出・修正するために必須です。

### ファイル編集時の自動チェック

ブログ記事のMarkdownを編集する際は、以下のように動作してください。

1. ユーザーが対象の`.md`ファイルを編集・作成する
2. 編集内容を反映する前に、textlintでチェックを実行
3. エラーがある場合は以下を実行
   - 自動修正可能なエラーは修正してから保存
   - 手動修正が必要なエラーはユーザーに報告し、修正案を提示
4. エラーがない場合、または修正完了後にファイルを保存

### チェック項目

#### `textlint-rule-preset-ja-technical-writing`がチェックする主な項目：

- 句読点の統一（。と.の混在）
- 弱い表現の使用（〜かもしれない、〜と思います など）
- 誤用・誤字（よくある間違い）
- 冗長な表現
- 連続する同じ単語
- 表記ゆれ
- 漢字の連続（最大5文字まで）
- 文の長さ（最大100文字）

#### `textlint-rule-preset-ai-writing`がチェックする主な項目（AIっぽさをなくすため）：

- AI生成テキスト特有の表現パターン
- 過度に丁寧すぎる表現
- 不自然な接続詞の使用
- 機械的な文章構造
- AIがよく使うフレーズや表現

#### ダッシュ区切りの禁止（AIっぽさをなくすため）

文中やタイトルで `──`（全角ダッシュ）や `—`（emダッシュ）を区切りとして使ってはいけない。AI生成テキスト特有の表現パターンであり、自然な日本語ではあまり使われない。

- ❌ `AIツールの選び方──本書を読んだ`
- ✅ `AIツールの選び方を学ぶ本書を読んだ`
- ✅ 文を分ける、「。」で区切る、括弧を使う、接続詞でつなぐ

### 注意事項

1. **必須実行**: ブログ記事のMarkdownに対しては、textlintチェックを省略してはいけない
2. **自動修正**: 可能な限り自動修正を実行し、ユーザーの作業を妨げないようにする
3. **エラー報告**: 手動修正が必要なエラーは、具体的な修正案とともに報告する
4. **パフォーマンス**: チェックは非同期で実行し、ユーザーの作業フローを阻害しない
5. **AIっぽさの除去**: `preset-ai-writing`を必ず適用し、AI生成テキスト特有の表現を検出・修正する

### はてなブログのMarkdown記法ルール

はてなブログに投稿する記事である場合、以下のスキルも参照してください。

- **`hatena-blog-markdown`**: はてなブログのMarkdown記法ルールとベストプラクティス

主なルール：
- 見出しはh3（`###`）から始める（h1、h2は使用しない）
- 見出しの階層構造を守る（h3 → h4 → h5）
- 目次記法 `[:contents]` の使い方
- フォトライフ記法、TeX数式記法など、はてなブログ独自の記法

### 例

#### 編集前のチェック

```markdown
# ブログ記事のタイトル

これはサンプルの文章です。これは長い文章で、100文字を超える可能性があります。このような場合は、textlintが警告を出します。
```

#### textlint実行後

```bash
$ npx textlint "article.md"

article.md
  3:1  error  文が長すぎます（100文字を超えています）  sentence-length
```

#### 修正後

```markdown
# ブログ記事のタイトル

これはサンプルの文章です。このような場合は、textlintが警告を出します。
```
