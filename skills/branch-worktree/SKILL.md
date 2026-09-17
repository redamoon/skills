---
name: ブランチ/worktreeスキル
description: 実装に入る前に、mainを最新化してからブランチを切り、Git worktreeで作業用ディレクトリを用意する手順をファイル化します。「実装を始めて」と依頼されたときの下準備として使用します。
license: MIT
---

# ブランチ/worktreeスキル

このスキルは、実装セッションを開始する前に、毎回同じ手順でブランチとworktreeを用意する際に使用します。手順を毎回同じ順で踏むことで、「うっかりmain上で直接作業する」「古いブランチから分岐する」という事故を防ぎます。

## When to Use

- 新しいSub-issueの実装に入る前
- 複数のSub-issueを並行して進めるため、作業ディレクトリを分けたいとき

## Instructions

### worktreeとは

worktreeは、1つのリポジトリから複数の作業ディレクトリを同時に用意できるGitの機能です。ブランチを切り替えずに、Sub-issueごとに別のディレクトリで並行して作業できます。

https://git-scm.com/docs/git-worktree

### 手順

1. mainを最新化する

```bash
git fetch origin main:main
```

2. Issue番号からブランチ名を決める

```text
feature/<issue番号>
```

3. mainから分岐したworktreeを作る

```bash
git worktree add ../<ブランチ名> -b <ブランチ名> main
```

4. 以降の実装は、このworktree内で行う

この4手順は、Sub-issueが1件だけの場合でも省略しません。

### 後片付け

Sub-issueがマージされたら、不要になったworktreeを削除します。

```bash
git worktree remove ../<ブランチ名>
```

worktreeを削除せずに放置すると、ディスクを圧迫し、古いブランチとの対応が分かりにくくなります。

## よくある問題

### 複数のSub-issueで同じディレクトリを使ってしまう

worktreeを作らずに同じチェックアウトで複数のSub-issueを進めると、ファイルの取り違えが起きます。Sub-issueごとに別のworktreeを割り当てます。

### 古いブランチから分岐してしまう

mainの最新化を省略すると、古いコードから分岐したブランチができます。手順の1を必ず先に実行します。

## 参考資料

- [git-worktree - Git公式ドキュメント](https://git-scm.com/docs/git-worktree)
