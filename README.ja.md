# skills

個人用の [Agent Skills](https://agentskills.io/specification) を Git で管理するリポジトリです（ブログ執筆・技術ドキュメント・UX 思考）。

**English**: [README.md](./README.md)

## 含まれるスキル（執筆まわり）

| ディレクトリ | 用途 |
|-------------|------|
| `skills/blog-workflow` | ブログ記事の執筆〜仕上げ（執筆・読者・編集者モードのサブエージェント周回 → textlint・プラットフォーム別確認） |
| `skills/hatena-blog-markdown` | はてなブログ Markdown 記法 |
| `skills/hatena-syntax-highlight` | はてなブログのコードハイライト記法 |
| `skills/note-book-reading-memo` | note 向けビジネス・技術書の読書メモ |
| `skills/note-novel-reading-memo` | note 向け小説の読書メモ |
| `skills/textlint-blog` | ブログ Markdown の textlint 実行 |
| `skills/textlint-setup` | textlint のインストール・設定 |
| `skills/zenn-blog-writing` | Zenn 技術ブログ執筆ガイド |
| `skills/x-post-writing` | X 向けポスト文案の作成・推敲（For You / x-algorithm 準拠） |
| `skills/documentation-writing` | プロジェクト技術ドキュメント（README、手順書、ADR など） |
| `skills/japanese-prose-revision` | 編集者水準の日本語推敲規範（論証の厳密さ・冗長の排除・LLM っぽい表現） |
| `skills/cognitive-rhythm-writing` | 日本語の説明文に緩急（認知リズム）を設計する規範 |
| `skills/natural-japanese` | 議事録・レポート・ガイド等のビジネス日本語を書く・直す（AI臭さの機械検出付き、[coji/natural-japanese](https://github.com/coji/natural-japanese) の TypeScript 移植） |

## 含まれるスキル（UX）

| ディレクトリ | 用途 |
|-------------|------|
| `skills/ux-thinking` | ワイヤー前に仕事と画面の役割を固め、面×状態の画面の下書きを書いてから、任意で Figma の低忠実度ワイヤーに渡す |

## 含まれるスキル（Issue駆動開発）

| ディレクトリ | 用途 |
|-------------|------|
| `skills/sub-issue-instruction-template` | Sub-issueの指示文（範囲・やらないこと・触ってよい/いけないファイル・完了条件）を5項目の型で書く |
| `skills/adversarial-validation-checker` | 実装前のSub-issue指示文を、別の立場から敵対的に検証する |
| `skills/ai-ready-checker` | Issueが完了条件の明文化・自動検証・触ってよい範囲の3条件（AI Ready）を満たしているか判定する |
| `skills/code-review` | プルリクエストのレビューをプロジェクト固有のルールに絞って実行する |
| `skills/branch-worktree` | 実装前にmainを最新化し、ブランチを切ってGit worktreeを用意する |
| `skills/issue-management` | Issueの作成・親Issue（エピック）への紐づけ・孤立Issueの棚卸しを行う |
| `skills/learning-loop` | 再発した指摘を、テスト・lint→ルール文書→SKILLの優先順で仕組み化する |

## インストール（GitHub から）

[GitHub CLI の `gh skill`](https://cli.github.com/manual/gh_skill_install) でインストールできます。

```bash
# 特定スキル（例: Cursor、ユーザー全体）
gh skill install redamoon/skills zenn-blog-writing --agent cursor --scope user

# バージョン固定（推奨）
gh skill install redamoon/skills blog-workflow --agent cursor --scope user --pin v1.0.0
```

### 対話式のエージェント選択を避ける（ターミナルで見切れる場合）

`gh skill install` だけ実行すると、リポジトリ・スキル・**エージェント**を順に聞かれます。エージェント一覧が長く、ターミナルから見切れることがあります。

フラグをすべて指定するとプロンプトを省略できます。

```bash
gh skill install redamoon/skills documentation-writing \
  --agent cursor \
  --scope user \
  --pin v1.0.0
```

| フラグ | よく使う値 |
|--------|------------|
| `--agent` | `cursor`, `claude-code`, `codex`, `github-copilot` |
| `--scope` | `user`（全体）または `project`（現在のリポジトリ） |
| `--pin` | `v1.0.0` やコミット SHA |

エージェント選択をスキップしてパスを直接指定する場合:

```bash
gh skill install redamoon/skills documentation-writing \
  --dir ~/.cursor/skills/documentation-writing \
  --pin v1.0.0
```

ローカルクローンから入れる場合:

```bash
gh skill install . documentation-writing --from-local --agent cursor --scope user
```

手動で置く場合:

```bash
ln -s "$(pwd)/skills/zenn-blog-writing" ~/.cursor/skills/zenn-blog-writing
ln -s "$(pwd)/skills/zenn-blog-writing" ~/.claude/skills/zenn-blog-writing
```

## 公開（メンテナ）

```bash
gh skill publish --dry-run   # 検証
gh skill publish             # リリース作成
```

詳細は [AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

リポジトリ全体は [MIT License](./LICENSE) です。各スキルの `SKILL.md` frontmatter にも `license: MIT` を記載しています。

## 除外

`*-workspace/` と `evals/` は skill のベンチマーク・評価用のため `.gitignore` で除外しています。
