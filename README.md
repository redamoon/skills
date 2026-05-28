# skills

A Git-managed catalog of personal [Agent Skills](https://agentskills.io/specification) for blog writing workflows.

**日本語**: [README.ja.md](./README.ja.md)

## Skills (writing)

| Directory | Purpose |
|-----------|---------|
| `skills/blog-workflow` | End-to-end blog quality checks (textlint, platform formatting, reader review) |
| `skills/hatena-blog-markdown` | Hatena Blog Markdown conventions |
| `skills/hatena-syntax-highlight` | Hatena Blog code block syntax highlighting |
| `skills/note-book-reading-memo` | note reading notes for business and technical books |
| `skills/note-novel-reading-memo` | note reading notes for fiction |
| `skills/textlint-blog` | Run textlint on blog Markdown |
| `skills/textlint-setup` | Install and configure textlint |
| `skills/zenn-blog-writing` | Zenn technical blog writing guide |

## Install (from GitHub)

Install with [GitHub CLI `gh skill`](https://cli.github.com/manual/gh_skill_install):

```bash
# Pick skills interactively from the repository
gh skill install redamoon/skills

# Install one skill (example: Cursor)
gh skill install redamoon/skills zenn-blog-writing --agent cursor

# Pin a release tag (recommended)
gh skill install redamoon/skills blog-workflow --agent cursor --pin v1.0.0
```

Manual install:

```bash
ln -s "$(pwd)/skills/zenn-blog-writing" ~/.cursor/skills/zenn-blog-writing
ln -s "$(pwd)/skills/zenn-blog-writing" ~/.claude/skills/zenn-blog-writing
```

## Publish (maintainers)

```bash
gh skill publish --dry-run   # validate only
gh skill publish             # create a release
```

See [AGENTS.md](./AGENTS.md) for repository conventions.

## License

This repository is [MIT](./LICENSE). Each skill declares `license: MIT` in `SKILL.md` frontmatter.

## Ignored paths

`*-workspace/` and `evals/` are benchmark artifacts and excluded via `.gitignore`.
