#!/usr/bin/env python3
"""一括モード: リポジトリ(ローカルパス or Git URL)を受け取り、スタック判定から事実収集までを全部実行する。

使い方:
  python3 run_all.py <ローカルパス | Git URL> [--out <出力先>] [--ref <ブランチ/タグ>] [--max-screens N]

  ローカルパス: 事実を <パス>/spec-work/facts/ に保存する(--out で変更可)
  Git URL:      <出力先>/source/ に浅く clone し、<出力先>/spec-work/facts/ に保存する
                (--out 省略時は ./<リポジトリ名>-spec/)

clone したコードは読むだけで、ビルド・依存のインストール・スクリプトの実行はしない。
最後に spec-work/facts/index.md(作業計画: モジュール・画面・共通部品の一覧と抽出時のコミット)を出す。
"""
import json
import os
import re
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
URL_RX = re.compile(r"^(?:https?://|git@|ssh://|file://)|\.git$")


def run(script, *args):
    cmd = [sys.executable, os.path.join(HERE, script), *args]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        return None, (res.stderr or res.stdout).strip()
    return res.stdout, None


def save(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def clone(url, dest, ref):
    if os.path.isdir(os.path.join(dest, ".git")):
        print(f"既存の clone を使う: {dest}", file=sys.stderr)
        return
    cmd = ["git", "clone", "--depth", "1", "--no-recurse-submodules"]
    if ref:
        cmd += ["--branch", ref]
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")  # 認証プロンプトで止まらないようにする
    res = subprocess.run(cmd + [url, dest], capture_output=True, text=True, env=env)
    if res.returncode != 0:
        sys.exit(f"clone に失敗: {res.stderr.strip()}")


def git_head(root):
    res = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"], capture_output=True, text=True)
    return res.stdout.strip() if res.returncode == 0 else "(git 管理外)"


def slug(route):
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", route.strip("/")).strip("_")
    return s or "root"


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        print(__doc__)
        sys.exit(1)

    def opt(name, default=None):
        return args[args.index(name) + 1] if name in args else default

    target = args[0]
    max_screens = int(opt("--max-screens", 100))
    if URL_RX.search(target) and not os.path.isdir(target):
        name = re.sub(r"\.git$", "", target.rstrip("/").split("/")[-1].split(":")[-1])
        out = os.path.abspath(opt("--out", f"{name}-spec"))
        root = os.path.join(out, "source")
        clone(target, root, opt("--ref"))
        facts = os.path.join(out, "spec-work", "facts")
        source_label = target
    else:
        root = os.path.abspath(target)
        out = os.path.abspath(opt("--out", root))
        facts = os.path.join(out, "spec-work", "facts")
        source_label = root
    log = []

    def step(label, path, script, *a):
        text, err = run(script, *a)
        if err:
            log.append(f"- {label}: 失敗({err.splitlines()[-1][:120]})")
            return None
        if path:
            save(os.path.join(facts, path), text)
            log.append(f"- {label}: `{path}`")
        return text

    # 1. スタック判定
    stack_json = step("スタック判定", None, "detect_stack.py", root, "--json")
    stack = json.loads(stack_json) if stack_json else {"languages": {}, "stacks": {}, "references": []}
    step("スタック判定", "stack.md", "detect_stack.py", root)
    refs = [os.path.splitext(os.path.basename(r))[0] for r in stack["references"]]

    # 2. エントリポイント
    ep_refs = [r for r in refs if r != "_generic"]
    entry = []
    if ep_refs:
        step("エントリポイント", "entrypoints.md", "grep_entrypoints.py", root, "--stack", ",".join(ep_refs))
        text = step("エントリポイント(JSON)", None, "grep_entrypoints.py", root, "--stack", ",".join(ep_refs), "--json")
        entry = json.loads(text) if text else []

    # 3. モジュール依存(全体 + サブシステムごと)
    step("モジュール依存(全体)", "module-deps.md", "dep_graph.py", root, "--depth", "2")
    subsystems = sorted({loc for locs in stack["stacks"].values() for loc in locs if loc not in (".", "(拡張子から推定)")})
    for sub in subsystems:
        step(f"モジュール依存({sub})", f"module-deps-{slug(sub)}.md", "dep_graph.py", root, "--prefix", sub, "--depth", "2")

    # 4. 共通部品・プロジェクト参照
    step("共通部品の候補", "shared-logic.md", "shared_logic.py", root)
    text = step("共通部品(JSON)", None, "shared_logic.py", root, "--json")
    shared = json.loads(text) if text else []
    text = step("プロジェクト参照(JSON)", None, "shared_logic.py", root, "--projects", "--json")
    projects = json.loads(text) if text else {"projects": {}}
    if len(projects.get("projects", {})) > 1:
        step("プロジェクト参照図", "projects.md", "shared_logic.py", root, "--projects")

    # 5. 画面(フロントエンドがある場合)
    screens = []
    if any(r.startswith("frontend-") for r in refs):
        step("画面一覧", "screens.md", "screen_inventory.py", root)
        step("画面遷移図", "screen-transitions.md", "screen_inventory.py", root, "--transitions")
        text = step("画面一覧(JSON)", None, "screen_inventory.py", root, "--json")
        screens = [s for s in (json.loads(text) if text else []) if s["kind"] != "remix-resource"]
        for s in screens[:max_screens]:
            step(f"画面ファクト {s['route']}", f"screens/{slug(s['route'])}.md", "screen_inventory.py", root, "--screen", s["route"])

    # 6. 作業計画(index.md)
    by_module = Counter()
    for e in entry:
        parts = e["location"].split(":")[0].split("/")
        by_module["/".join(parts[:-1][:3]) or "(root)"] += 1
    lines = [
        "# 一括抽出の作業計画",
        "",
        f"- 対象: `{source_label}`",
        f"- ソースのパス: `{root}`",
        f"- 抽出時のコミット: `{git_head(root)}`",
        f"- 言語(ファイル数): {', '.join(f'{k} {v}' for k, v in stack['languages'].items()) or 'なし'}",
        "- スタック: " + (", ".join(k + "(" + ", ".join(v) + ")" for k, v in stack["stacks"].items()) or "検出できず"),
        f"- 読むべき参照ファイル: {', '.join(f'`{r}`' for r in stack['references'])}",
        "",
        "## 実行したスクリプトと出力",
        "",
        *log,
        "",
        f"## モジュール(エントリポイントのあるディレクトリ、{len(by_module)}件)",
        "",
        "| モジュール | エントリポイント数 |",
        "|---|---|",
        *[f"| `{m}` | {c} |" for m, c in by_module.most_common()],
        "",
        f"## 画面({len(screens)}件)",
        "",
        *[f"- `{s['route']}` — `{s['file']}`" for s in screens],
        *([f"- (ファクト収集は先頭 {max_screens} 件まで)"] if len(screens) > max_screens else []),
        "",
        f"## 共通部品の候補({len(shared)}件)",
        "",
        *[f"- `{r['unit']}`({r['role']}、利用元 {len(r['consumers'])})" for r in shared],
        "",
        "## 共有ライブラリ(複数プロジェクトから参照)",
        "",
        *([f"- `{p}`" for p in projects.get("shared", [])] or ["- なし"]),
        "",
    ]
    save(os.path.join(facts, "index.md"), "\n".join(lines))
    print(os.path.join(facts, "index.md"))


if __name__ == "__main__":
    main()
