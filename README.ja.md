# skills

個人用の [Agent Skills](https://agentskills.io/specification) を Git で管理するリポジトリです（ブログ執筆・技術ドキュメント）。

**English**: [README.md](./README.md)

## 含まれるスキル（執筆まわり）

| ディレクトリ | 用途 |
|-------------|------|
| `skills/blog-workflow` | ブログ記事の品質チェック（textlint・プラットフォーム別確認・レビュー） |
| `skills/hatena-blog-markdown` | はてなブログ Markdown 記法 |
| `skills/hatena-syntax-highlight` | はてなブログのコードハイライト記法 |
| `skills/note-book-reading-memo` | note 向けビジネス・技術書の読書メモ |
| `skills/note-novel-reading-memo` | note 向け小説の読書メモ |
| `skills/textlint-blog` | ブログ Markdown の textlint 実行 |
| `skills/textlint-setup` | textlint のインストール・設定 |
| `skills/zenn-blog-writing` | Zenn 技術ブログ執筆ガイド |
| `skills/documentation-writing` | プロジェクト技術ドキュメント（README、手順書、ADR など） |

## インストール（GitHub から）

[GitHub CLI の `gh skill`](https://cli.github.com/manual/gh_skill_install) でインストールできます。

```bash
# リポジトリ内のスキルを対話的に選択
gh skill install redamoon/skills

# 特定スキル（例: Cursor）
gh skill install redamoon/skills zenn-blog-writing --agent cursor

# バージョン固定（推奨）
gh skill install redamoon/skills blog-workflow --agent cursor --pin v1.0.0
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
