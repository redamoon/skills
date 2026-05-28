# skills

A Git-managed catalog of personal [Agent Skills](https://agentskills.io/specification) for blog writing and technical documentation workflows.

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
| `skills/documentation-writing` | Project technical documentation (README, guides, ADR) |

## Install (from GitHub)

Install with [GitHub CLI `gh skill`](https://cli.github.com/manual/gh_skill_install):

```bash
# Install one skill (example: Cursor, user scope)
gh skill install redamoon/skills zenn-blog-writing --agent cursor --scope user

# Pin a release tag (recommended)
gh skill install redamoon/skills blog-workflow --agent cursor --scope user --pin v1.0.0
```

### Avoid interactive agent picker (long terminal list)

Running `gh skill install` without flags opens prompts for repository, skill, and **agent**. The agent list is long and may not fit in the terminal.

Pass everything on the command line so prompts are skipped:

```bash
gh skill install redamoon/skills documentation-writing \
  --agent cursor \
  --scope user \
  --pin v1.0.0
```

| Flag | Common values |
|------|----------------|
| `--agent` | `cursor`, `claude-code`, `codex`, `github-copilot` |
| `--scope` | `user` (global) or `project` (current repo) |
| `--pin` | `v1.0.0` or a commit SHA |

Install to a known path without choosing an agent:

```bash
gh skill install redamoon/skills documentation-writing \
  --dir ~/.cursor/skills/documentation-writing \
  --pin v1.0.0
```

From a local clone:

```bash
gh skill install . documentation-writing --from-local --agent cursor --scope user
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
