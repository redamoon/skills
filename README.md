# skills

A Git-managed catalog of personal [Agent Skills](https://agentskills.io/specification) for blog writing, technical documentation, and UX thinking workflows.

**日本語**: [README.ja.md](./README.ja.md)

## Skills (writing)

| Directory | Purpose |
|-----------|---------|
| `skills/blog-workflow` | End-to-end blog workflow: writer / reader / editor subagent loop, then textlint and platform formatting |
| `skills/hatena-blog-markdown` | Hatena Blog Markdown conventions |
| `skills/hatena-syntax-highlight` | Hatena Blog code block syntax highlighting |
| `skills/note-book-reading-memo` | note reading notes for business and technical books |
| `skills/note-novel-reading-memo` | note reading notes for fiction |
| `skills/textlint-blog` | Run textlint on blog Markdown |
| `skills/textlint-setup` | Install and configure textlint |
| `skills/zenn-blog-writing` | Zenn technical blog writing guide |
| `skills/x-post-writing` | X post copywriting for For You feed (x-algorithm) |
| `skills/documentation-writing` | Project technical documentation (README, guides, ADR) |
| `skills/japanese-prose-revision` | Editor-grade Japanese revision norms (argument rigor, redundancy, LLM-style phrasing) |
| `skills/cognitive-rhythm-writing` | Designing pacing and reading momentum in Japanese explanatory prose |
| `skills/natural-japanese` | Writing/revising Japanese business documents (minutes, reports, guides, memos, slides) with machine-detected AI-smell linting (TypeScript port of [coji/natural-japanese](https://github.com/coji/natural-japanese)) |

## Skills (UX)

| Directory | Purpose |
|-----------|---------|
| `skills/ux-thinking` | Define the work to finish and an event scenario, write screen drafts in words (surface × state), then optionally hand off lo-fi frames to Figma |

## Skills (issue-driven development)

| Directory | Purpose |
|-----------|---------|
| `skills/sub-issue-instruction-template` | Write a Sub-issue instruction (scope, out-of-scope, allowed/forbidden files, completion criteria) in a fixed 5-item template |
| `skills/adversarial-validation-checker` | Adversarially validate a Sub-issue instruction before implementation, from a separate reviewer stance |
| `skills/ai-ready-checker` | Check whether an Issue meets the 3 AI-Ready conditions (explicit completion criteria, automated verification, scoped file boundaries) |
| `skills/code-review` | Review a pull request against project-specific rules only, leaving general code quality to the model |
| `skills/branch-worktree` | Refresh main, cut a branch, and create a Git worktree before starting implementation |
| `skills/issue-management` | Create issues, link them to a parent epic, and sweep for orphaned issues with no parent |
| `skills/learning-loop` | Mechanize a recurring correction in priority order: test/lint, then rule docs, then a SKILL |

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
