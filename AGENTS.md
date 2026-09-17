# Agent Instructions

このリポジトリは、ブログ執筆・技術ドキュメント・UX 思考向けの [Agent Skills](https://agentskills.io/specification) を GitHub 経由で配布するためのカタログです。`gh skill publish` で公開し、利用者は `gh skill install` で各エージェントに導入します。

## リポジトリ構成

```
skills/<skill-name>/SKILL.md   # 必須。スキル本体
skills/<skill-name>/           # 任意: reference.md, scripts/ など
```

- スキルは必ず `skills/` 直下のディレクトリに置く（`gh skill` の discovery 規約）
- ディレクトリ名と frontmatter の `name` は一致させる（kebab-case 推奨）
- `evals/` と `*-workspace/` はベンチマーク用のためコミットしない（`.gitignore` 参照）

## スキル一覧

| スキル | 用途 |
|--------|------|
| `blog-workflow` | ブログ記事の執筆〜仕上げ（3モードのサブエージェント周回 → textlint・プラットフォーム別確認） |
| `hatena-blog-markdown` | はてなブログ Markdown 記法 |
| `hatena-syntax-highlight` | はてなブログのコードシンタックスハイライト |
| `note-book-reading-memo` | note 向けビジネス・技術書の読書メモ |
| `note-novel-reading-memo` | note 向け小説の読書メモ |
| `textlint-blog` | ブログ Markdown の textlint 実行 |
| `textlint-setup` | textlint のインストール・設定 |
| `zenn-blog-writing` | Zenn 技術ブログ執筆ガイド |
| `x-post-writing` | X 向けポスト文案の作成・推敲（For You / x-algorithm 準拠） |
| `documentation-writing` | プロジェクト技術ドキュメント執筆 |
| `japanese-prose-revision` | 編集者水準の日本語推敲規範（論証・冗長・LLM っぽい表現） |
| `cognitive-rhythm-writing` | 日本語の説明文の緩急（認知リズム）設計 |
| `natural-japanese` | 議事録・レポート・ガイド等ビジネス日本語の執筆・推敲（AI臭さの機械検出付き。coji/natural-japanese の TypeScript 移植） |
| `ux-thinking` | ワイヤー前の質問で仕様を固め、合意後に Figma へ低忠実度ワイヤーを引き渡す |
| `sub-issue-instruction-template` | Sub-issueの指示文（範囲・やらないこと・触ってよい/いけないファイル・完了条件）を5項目の型で書く |
| `adversarial-validation-checker` | 実装前のSub-issue指示文を、別の立場から敵対的に検証する |
| `ai-ready-checker` | IssueがAI Readyの3条件（完了条件・自動検証・触ってよい範囲）を満たしているか判定する |
| `code-review` | プルリクエストのレビューをプロジェクト固有のルールに絞って実行する |
| `branch-worktree` | 実装前にmainを最新化し、ブランチを切ってGit worktreeを用意する |
| `issue-management` | Issueの作成・親Issue（エピック）への紐づけ・孤立Issueの棚卸しを行う |
| `learning-loop` | 再発した指摘を、テスト・lint→ルール文書→SKILLの優先順で仕組み化する |

## スキル執筆ルール（メンテナ向け）

このリポジトリのスキルは **公開・再利用** を前提とする。プロジェクト固有のパスは書かない。

1. **`When to Use`**: プラットフォーム・タスク・依頼文で書く。`06-Blog/` や `articles/*.md` などのディレクトリ指定は入れない
2. **フォルダ前提のセクション**: 「対象フォルダの設定」のような記述は置かない。実行対象はユーザーが開いているファイルや指定パスに委ねる
3. **`description`**: 第三者が読んでもトリガーが分かる一文にする（frontmatter はエージェントの自動選択に使われる）
4. **ベンチマーク成果物**: `evals/`・`*-workspace/` はローカルのみ。リポジトリには含めない
5. **変更時**: 該当 `SKILL.md` を編集したら `gh skill publish --dry-run` で検証してから publish

## 公開（メンテナ）

```bash
# 検証のみ
gh skill publish --dry-run

# 対話的にリリース作成
gh skill publish

# タグ指定で非対話
gh skill publish --tag v1.0.0
```

公開前の推奨: リポジトリに `agent-skills` トピック、タグ保護、immutable releases（`gh skill publish` が案内する）。

## インストール（利用者）

```bash
# 一覧から選んでインストール
gh skill install redamoon/skills

# 特定スキルのみ（例: Cursor）
gh skill install redamoon/skills zenn-blog-writing --agent cursor

# 本番・CI ではタグでピン留め
gh skill install redamoon/skills blog-workflow --agent cursor --pin v1.0.0
```

手動で置く場合の例:

```bash
ln -s "$(pwd)/skills/zenn-blog-writing" ~/.cursor/skills/zenn-blog-writing
# Claude Code
ln -s "$(pwd)/skills/zenn-blog-writing" ~/.claude/skills/zenn-blog-writing
```

## このリポジトリで作業するとき

- 新規スキル追加: `skills/<name>/SKILL.md` を作成し、上記一覧と README を更新
- スキル削除・改名: `gh skill` の discovery に合わせディレクトリ名を変更し、README / 本ファイルを同期
- コミットメッセージは変更の意図（追加・修正・削除）が分かるように書く
