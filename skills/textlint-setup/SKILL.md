---
name: textlintセットアップスキル
description: textlintのインストールと設定を行います。AI文章検出ルールを含む日本語技術文書向けの設定を適用します。
license: MIT
---

# textlintセットアップスキル

このスキルは、プロジェクトにtextlintをセットアップする際に使用します。AI文章検出ルールを含む日本語技術文書向けの設定を適用します。

## When to Use

- 新規プロジェクトにtextlintを導入する際
- textlintがインストールされていない環境で記事を執筆する際
- textlintの設定を確認・修正する際
- AIっぽい文章を検出するルールを追加したい際

## Instructions

### 1. 前提条件の確認

textlintを使用するには、以下が必要です。

- Node.js（v18以上推奨）
- npm または yarn

確認コマンドを実行してください。

```bash
node -v
npm -v
```

### 2. インストール状況の確認

まず、textlintがインストールされているか確認します。

```bash
npm ls textlint
```

エラーが出る場合はインストールが必要です。

### 3. textlintのインストール

以下のパッケージをインストールします。

```bash
npm install -D textlint @textlint-ja/textlint-rule-preset-ai-writing
```

#### パッケージの説明

- `textlint` - 日本語文章校正ツール本体
- `@textlint-ja/textlint-rule-preset-ai-writing` - AI文章検出ルールセット

### 4. 設定ファイルの作成

プロジェクトルートに `.textlintrc.json` を作成します。

```json
{
  "filters": {},
  "rules": {
    "@textlint-ja/preset-ai-writing": {
      "no-ai-list-formatting": true,
      "no-ai-hype-expressions": true,
      "no-ai-emphasis-patterns": true,
      "no-ai-colon-continuation": true,
      "ai-tech-writing-guideline": {
        "severity": "warning"
      }
    }
  }
}
```

#### ルールの説明

- `no-ai-list-formatting` - AIっぽいリスト形式を検出
- `no-ai-hype-expressions` - 誇張表現を検出
- `no-ai-emphasis-patterns` - 過剰な強調パターンを検出
- `no-ai-colon-continuation` - コロン後のブロック形式を検出
- `ai-tech-writing-guideline` - 技術文書のガイドライン違反を検出

### 5. npm scriptsの追加

`package.json` に以下のスクリプトを追加します。

```json
{
  "scripts": {
    "textlint": "textlint 'articles/**/*.md'",
    "textlint:fix": "textlint --fix 'articles/**/*.md'"
  }
}
```

パスは対象のマークダウンファイルに合わせて変更してください。

### 6. Git hooks の設定（任意）

コミット時に自動チェックを実行したい場合は、huskyとlint-stagedを追加します。

```bash
npm install -D husky lint-staged
npx husky init
```

`package.json` に lint-staged の設定を追加します。

```json
{
  "lint-staged": {
    "articles/**/*.md": [
      "textlint"
    ]
  }
}
```

`.husky/pre-commit` ファイルを編集します。

```bash
npx lint-staged
```

### 7. 動作確認

インストールと設定が完了したら、以下のコマンドで動作を確認します。

```bash
npm run textlint
```

エラーがある場合は修正するか、自動修正を試します。

```bash
npm run textlint:fix
```

## よくある問題

### textlintコマンドが見つからない

`node_modules` が正しくインストールされていない可能性があります。

```bash
rm -rf node_modules package-lock.json
npm install
```

### ルールが適用されない

`.textlintrc.json` のパスと内容を確認してください。設定ファイルはプロジェクトルートに配置する必要があります。

### 特定のファイルを除外したい

`.textlintrc.json` の `filters` セクションで除外設定を行います。

```json
{
  "filters": {
    "comments": true
  }
}
```

または `.textlintignore` ファイルを作成します。

```
drafts/
*.draft.md
```

## 参考資料

- [textlint公式ドキュメント](https://textlint.github.io/)
- [textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing)
