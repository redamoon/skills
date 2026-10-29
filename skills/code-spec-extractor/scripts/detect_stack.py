#!/usr/bin/env python3
"""対象ディレクトリの言語・フレームワークを推定し、読むべき references/stacks/*.md を示す。

使い方: python3 detect_stack.py <対象ディレクトリ> [--json]
外部ライブラリ不要(標準ライブラリのみ)。
"""
import json
import os
import sys
from collections import Counter

SKIP_DIRS = {
    ".git", "node_modules", "vendor", "dist", "build", "target", "bin", "obj",
    ".venv", "venv", "__pycache__", ".next", ".nuxt", "coverage", ".idea", ".gradle",
}

EXT_LANG = {
    ".ts": "typescript", ".tsx": "typescript", ".vue": "vue", ".svelte": "svelte", ".js": "javascript", ".jsx": "javascript",
    ".mjs": "javascript", ".cjs": "javascript", ".py": "python", ".java": "java",
    ".kt": "kotlin", ".go": "go", ".rb": "ruby", ".php": "php", ".cs": "csharp",
    ".vb": "vbnet", ".rs": "rust", ".scala": "scala", ".swift": "swift",
    ".cbl": "cobol", ".cob": "cobol", ".sql": "sql", ".pls": "plsql", ".pkb": "plsql",
    ".pl": "perl", ".pm": "perl", ".cgi": "perl", ".psgi": "perl", ".fcgi": "perl",
}

# (マーカーファイル, ファイル内に含まれる文字列 or None, スタック名)
MARKERS = [
    ("package.json", '"@nestjs/core"', "nestjs"),
    ("package.json", '"next"', "nextjs"),
    ("package.json", '"nuxt"', "nuxt"),
    ("package.json", '"@remix-run/react"', "remix"),
    ("package.json", '"@react-router/dev"', "remix"),
    ("package.json", '"react"', "react"),
    ("package.json", '"vue"', "vue"),
    ("package.json", '"express"', "node-express"),
    ("package.json", '"fastify"', "node-express"),
    ("package.json", '"hono"', "node-express"),
    ("package.json", None, "node"),
    ("pyproject.toml", "django", "django"),
    ("requirements.txt", "django", "django"),
    ("pyproject.toml", "fastapi", "fastapi"),
    ("requirements.txt", "fastapi", "fastapi"),
    ("requirements.txt", "flask", "flask"),
    ("pyproject.toml", "flask", "flask"),
    ("pom.xml", "spring-boot", "spring"),
    ("build.gradle", "springframework", "spring"),
    ("build.gradle.kts", "springframework", "spring"),
    ("go.mod", None, "go"),
    ("Gemfile", "rails", "rails"),
    ("composer.json", "laravel/framework", "laravel"),
    ("composer.json", None, "php"),
    ("*.csproj", "Microsoft.NET.Sdk.Web", "aspnetcore"),
    ("*.csproj", None, "dotnet"),
    ("Cargo.toml", None, "rust"),
    ("mt.cgi", None, "movabletype"),
    ("MT.pm", "package MT;", "movabletype"),
    ("config.yaml", "callbacks:", "mt-plugin"),
    ("config.yaml", "tags:", "mt-plugin"),
    ("config.yaml", "applications:", "mt-plugin"),
    ("cpanfile", "Mojolicious", "mojolicious"),
    ("cpanfile", "Dancer2", "dancer"),
    ("cpanfile", "Catalyst", "catalyst"),
    ("cpanfile", None, "perl"),
    ("Makefile.PL", "Catalyst", "catalyst"),
    ("Makefile.PL", None, "perl"),
    ("Build.PL", None, "perl"),
]
PERL_STACKS = {"movabletype", "mt-plugin", "mojolicious", "dancer", "catalyst", "perl"}

# スタック名 → 参照ファイル名(フルスタックFWは複数)
STACK_REF = {
    "nestjs": "typescript-node", "nextjs": ["typescript-node", "frontend-react"], "node-express": "typescript-node",
    "remix": ["typescript-node", "frontend-react"], "react": "frontend-react",
    "nuxt": ["typescript-node", "frontend-vue"], "vue": "frontend-vue",
    "node": "typescript-node", "django": "python", "fastapi": "python", "flask": "python",
    "spring": "java-spring", "go": "go", "rails": "ruby-rails", "laravel": "php-laravel",
    "php": "php-laravel", "aspnetcore": "csharp-dotnet", "dotnet": "csharp-dotnet",
    **{k: "perl" for k in ("movabletype", "mt-plugin", "mojolicious", "dancer", "catalyst", "perl")},
}


def walk(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
        for f in files:
            yield d, f


def read(path, limit=200_000):
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            return fh.read(limit)
    except OSError:
        return ""


def match_marker(fname, pattern):
    if pattern.startswith("*"):
        return fname.endswith(pattern[1:])
    return fname == pattern


def detect(root):
    langs = Counter()
    stacks = {}  # stack -> 検出された場所(サブシステム)
    for d, f in walk(root):
        ext = os.path.splitext(f)[1].lower()
        if ext in EXT_LANG:
            langs[EXT_LANG[ext]] += 1
        # 同じファイルで内容が一致したものはすべて採用(例: next + react)。
        # どれも一致しなければ、内容を問わないマーカー(None)を採用する
        hit, fallback = [], None
        for marker, needle, stack in MARKERS:
            if not match_marker(f, marker):
                continue
            if needle is None:
                fallback = fallback or stack
            elif needle.lower() in read(os.path.join(d, f)).lower():
                hit.append(stack)
        for stack in hit or ([fallback] if fallback else []):
            stacks.setdefault(stack, set()).add(os.path.relpath(d, root))
    # 同じディレクトリで汎用スタックと具体スタックが両方出たら汎用側を落とす
    # config.yaml は汎用的な名前なので、Perl ソースが無ければ MT プラグイン扱いしない
    if "mt-plugin" in stacks and not langs.get("perl"):
        del stacks["mt-plugin"]
    # マーカーが無くても Perl ソースがあれば perl として扱う(古いCGIアプリ等)
    if langs.get("perl") and not (PERL_STACKS & set(stacks)):
        stacks["perl"] = {"(拡張子から推定)"}
    # フルスタックFWが出たら、同じ場所の素の react / vue は内包されるので落とす
    for full, base in (("nextjs", "react"), ("remix", "react"), ("nuxt", "vue")):
        if full in stacks and base in stacks:
            stacks[base] -= stacks[full]
            if not stacks[base]:
                del stacks[base]
    generic = {"node", "php", "dotnet", "perl"}
    for g in generic:
        if g in stacks:
            others = set().union(*(v for k, v in stacks.items() if k not in generic)) if len(stacks) > 1 else set()
            stacks[g] -= others
            if not stacks[g]:
                del stacks[g]
    refs = set()
    for s in stacks:
        r = STACK_REF.get(s, "_generic")
        refs |= set(r) if isinstance(r, list) else {r}
    refs = sorted(refs) or ["_generic"]
    # マーカーが無いのにソースがある言語(COBOL, PL/SQL など)は汎用参照
    known = {"typescript", "javascript", "vue", "python", "java", "kotlin", "go", "ruby", "php", "csharp", "perl"}
    if any(l not in known and l != "sql" for l in langs):
        refs = sorted(set(refs) | {"_generic"})
    return {
        "languages": dict(langs.most_common()),
        "stacks": {k: sorted(v) for k, v in stacks.items()},
        "references": [f"references/stacks/{r}.md" for r in refs],
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    result = detect(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    print("## 言語(ファイル数)")
    for k, v in result["languages"].items():
        print(f"- {k}: {v}")
    print("\n## スタック(検出場所)")
    for k, v in result["stacks"].items():
        print(f"- {k}: {', '.join(v)}")
    if not result["stacks"]:
        print("- 検出できず")
    print("\n## 読むべき参照ファイル")
    for r in result["references"]:
        print(f"- {r}")


if __name__ == "__main__":
    main()
