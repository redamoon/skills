#!/usr/bin/env python3
"""ソースの import / use / require を解析し、モジュール間の依存をMermaid図として出力する。

使い方:
  python3 dep_graph.py <対象ディレクトリ> [--depth N] [--prefix <パス>] [--external] [--json]

  --depth N     何階層目のディレクトリを1モジュールとみなすか(既定 2。例: src/billing)
  --prefix P    P 配下だけを対象にし、P をモジュール名から省く(例: --prefix src)
  --external    外部パッケージへの依存も(上位名で)ノードとして出す
  --json        エッジ一覧(根拠 file:line 付き)をJSONで出す

対応: TypeScript/JavaScript(.vue / .svelte の <script> 含む), Python, Go, Java/Kotlin, PHP, C#, Ruby(require_relative), Perl
解析は正規表現による近似。動的import、DIによる差し替え、リフレクションは拾えない。
"""
import json
import os
import re
import sys
from collections import defaultdict

SKIP_DIRS = {
    ".git", "node_modules", "vendor", "dist", "build", "target", "bin", "obj",
    ".venv", "venv", "__pycache__", ".next", ".nuxt", ".output", "coverage",
}
TEST_HINT = re.compile(r"(^|/)(tests?|spec|__tests__|__mocks__)(/|$)|(_test|\.test|\.spec|Test|Tests)\.\w+$")

JS_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte")
RX = {
    "js": re.compile(r"""(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]"""),
    "py": re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))"),
    "go": re.compile(r'^\s*(?:import\s+)?(?:\w+\s+)?"([^"]+)"\s*$'),
    "jvm_import": re.compile(r"^\s*import\s+(?:static\s+)?([\w.]+)"),
    "jvm_pkg": re.compile(r"^\s*package\s+([\w.]+)"),
    "php_use": re.compile(r"^\s*use\s+([\w\\]+)"),
    "php_ns": re.compile(r"^\s*namespace\s+([\w\\]+)"),
    "cs_using": re.compile(r"^\s*using\s+(?:static\s+)?([\w.]+)\s*;"),
    "cs_ns": re.compile(r"^\s*namespace\s+([\w.]+)"),
    "rb": re.compile(r"""^\s*require_relative\s+['"]([^'"]+)['"]"""),
    "pl_pkg": re.compile(r"^\s*package\s+([\w:]+)\s*[;{]"),
    "pl_use": re.compile(r"^\s*(?:use|require)\s+([A-Z][\w:]*)"),
    "pl_parent": re.compile(r"^\s*use\s+(?:parent|base)\s+(.+?);"),
}
PERL_PRAGMAS = {"strict", "warnings", "utf8", "constant", "lib", "vars", "parent", "base",
                "feature", "integer", "overload", "bytes", "open", "encoding", "POSIX"}


def lang_of(path):
    if path.endswith(JS_EXT):
        return "js"
    return {".py": "py", ".go": "go", ".java": "jvm", ".kt": "jvm", ".php": "php",
            ".cs": "cs", ".rb": "rb", ".pl": "pl", ".pm": "pl", ".cgi": "pl",
            ".psgi": "pl", ".fcgi": "pl"}.get(os.path.splitext(path)[1])


def read_lines(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            return fh.readlines()
    except OSError:
        return []


def collect_files(root, prefix):
    base = os.path.join(root, prefix) if prefix else root
    out = []
    for d, dirs, files in os.walk(base):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
        for f in files:
            p = os.path.join(d, f)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            if lang_of(p) and not TEST_HINT.search(rel):
                out.append(rel)
    return out


def module_of(rel, depth, prefix):
    parts = rel.split("/")
    if prefix:
        pp = prefix.strip("/").split("/")
        if parts[: len(pp)] == pp:
            parts = parts[len(pp):]
    dirs = parts[:-1]
    if not dirs:
        return "(root)"
    return "/".join(dirs[:depth])


def go_module_path(root):
    for line in read_lines(os.path.join(root, "go.mod")):
        m = re.match(r"^module\s+(\S+)", line)
        if m:
            return m.group(1)
    return None


def build_ns_index(root, files):
    """Java/Kotlin/PHP/C# の名前空間 → 宣言しているファイルのディレクトリ"""
    idx = {}
    for rel in files:
        lang = lang_of(rel)
        rx = {"jvm": RX["jvm_pkg"], "php": RX["php_ns"], "cs": RX["cs_ns"], "pl": RX["pl_pkg"]}.get(lang)
        if not rx:
            continue
        if lang == "pl":
            # Perl は1ファイルに複数 package を書けるので全行を見る
            for line in read_lines(os.path.join(root, rel)):
                m = rx.match(line)
                if m:
                    idx.setdefault(m.group(1).replace("::", "."), os.path.dirname(rel))
            continue
        for line in read_lines(os.path.join(root, rel))[:60]:
            m = rx.match(line)
            if m:
                ns = m.group(1).replace("\\", ".")
                idx.setdefault(ns, os.path.dirname(rel))
                break
    return idx


def resolve_ns(name, idx):
    """最長一致で名前空間を引く(クラス名付きimportにも対応)"""
    parts = name.replace("\\", ".").replace("::", ".").split(".")
    for i in range(len(parts), 0, -1):
        key = ".".join(parts[:i])
        if key in idx:
            return idx[key]
    return None


def resolve_js(rel, spec, fileset):
    if spec.startswith(("@/", "~/", "~~/")):
        tail = spec.split("/", 1)[1]
        cands = [os.path.normpath(os.path.join(b, tail)) for b in ("src", "app", "")]
    elif spec.startswith("."):
        cands = [os.path.normpath(os.path.join(os.path.dirname(rel), spec))]
    else:
        return None
    for c in cands:
        c = c.replace(os.sep, "/")
        for suffix in ("",) + JS_EXT + tuple("/index" + e for e in JS_EXT):
            if c + suffix in fileset:
                return os.path.dirname(c + suffix)
        if any(f.startswith(c + "/") for f in fileset):
            return c
    return None


def resolve_py(spec, pyindex):
    parts = spec.lstrip(".").split(".")
    for i in range(len(parts), 0, -1):
        key = "/".join(parts[:i])
        if key in pyindex:
            return pyindex[key]
    return None


def analyze(root, depth, prefix, external):
    files = collect_files(root, prefix)
    fileset = set(files)
    ns_idx = build_ns_index(root, files)
    gomod = go_module_path(root)
    # Python: "pkg/sub" → ディレクトリ(ファイル/パッケージ)
    pyindex = {}
    for f in files:
        if f.endswith(".py"):
            noext = f[:-3]
            for start in range(0, noext.count("/") + 1):
                key = "/".join(noext.split("/")[start:])
                pyindex.setdefault(key, os.path.dirname(f))
                if key.endswith("/__init__"):
                    pyindex.setdefault(key[: -len("/__init__")], os.path.dirname(f))

    edges = defaultdict(list)  # (from_mod, to_mod) -> [file:line]
    nodes = set()
    for rel in files:
        lang = lang_of(rel)
        src_mod = module_of(rel, depth, prefix)
        nodes.add(src_mod)
        for no, line in enumerate(read_lines(os.path.join(root, rel)), 1):
            targets = []  # (resolved_dir or None, raw_name)
            if lang == "js":
                for spec in RX["js"].findall(line):
                    targets.append((resolve_js(rel, spec, fileset), spec))
            elif lang == "py":
                m = RX["py"].match(line)
                if m:
                    spec = m.group(1) or m.group(2)
                    if spec.startswith("."):
                        base = os.path.dirname(rel)
                        ups = len(spec) - len(spec.lstrip("."))
                        for _ in range(ups - 1):
                            base = os.path.dirname(base)
                        rest = spec.lstrip(".").replace(".", "/")
                        d = os.path.normpath(os.path.join(base, rest)).replace(os.sep, "/") if rest else base
                        targets.append((os.path.dirname(d) if d + ".py" in fileset else d, spec))
                    else:
                        targets.append((resolve_py(spec, pyindex), spec))
            elif lang == "go":
                m = RX["go"].match(line)
                if m:
                    spec = m.group(1)
                    d = spec[len(gomod) + 1:] if gomod and spec.startswith(gomod + "/") else None
                    targets.append((d, spec))
            elif lang in ("jvm", "php", "cs"):
                rx = {"jvm": RX["jvm_import"], "php": RX["php_use"], "cs": RX["cs_using"]}[lang]
                m = rx.match(line)
                if m:
                    targets.append((resolve_ns(m.group(1), ns_idx), m.group(1)))
            elif lang == "pl":
                names = []
                m = RX["pl_parent"].match(line)
                if m:
                    names = [n for n in re.findall(r"[A-Za-z_][\w:]*", m.group(1)) if n not in ("qw", "norequire")]
                else:
                    m = RX["pl_use"].match(line)
                    if m and m.group(1) not in PERL_PRAGMAS:
                        names = [m.group(1)]
                for n in names:
                    targets.append((resolve_ns(n, ns_idx), n.replace("::", ".")))
            elif lang == "rb":
                m = RX["rb"].match(line)
                if m:
                    d = os.path.normpath(os.path.join(os.path.dirname(rel), m.group(1))).replace(os.sep, "/")
                    targets.append((os.path.dirname(d), m.group(1)))

            for d, raw in targets:
                if d is not None:
                    dst = module_of(d + "/x", depth, prefix)
                    if prefix and not (d + "/").startswith(prefix.strip("/") + "/"):
                        continue
                elif external:
                    top = re.split(r"[/.\\]", raw.lstrip("@"))[0]
                    if raw.startswith("@"):
                        top = "@" + "/".join(raw.lstrip("@").split("/")[:2])
                    dst = f"ext:{top}"
                else:
                    continue
                if dst != src_mod:
                    nodes.add(dst)
                    edges[(src_mod, dst)].append(f"{rel}:{no}")
    return nodes, edges


def find_cycles(edges):
    graph = defaultdict(set)
    for a, b in edges:
        if not b.startswith("ext:"):
            graph[a].add(b)
    cycles, seen = [], set()
    for a in list(graph):
        for b in graph[a]:
            if a in graph.get(b, ()) and (b, a) not in seen:
                seen.add((a, b))
                cycles.append((a, b))
    return cycles


def node_id(name):
    return "n_" + re.sub(r"[^A-Za-z0-9_]", "_", name)


def to_mermaid(nodes, edges, cycles):
    lines = ["```mermaid", "flowchart LR"]
    for n in sorted(nodes):
        label = n[4:] if n.startswith("ext:") else n
        shape = f'{node_id(n)}(["{label}"])' if n.startswith("ext:") else f'{node_id(n)}["{label}"]'
        lines.append(f"  {shape}")
    cyc = {frozenset(c) for c in cycles}
    link_styles = []
    for i, ((a, b), refs) in enumerate(sorted(edges.items())):
        lines.append(f"  {node_id(a)} -->|{len(refs)}| {node_id(b)}")
        if frozenset((a, b)) in cyc:
            link_styles.append(str(i))
    if link_styles:
        lines.append(f"  linkStyle {','.join(link_styles)} stroke:#d33,stroke-width:2px")
    ext = [node_id(n) for n in nodes if n.startswith("ext:")]
    if ext:
        lines.append("  classDef ext fill:#eee,stroke:#999,color:#555")
        lines.append(f"  class {','.join(ext)} ext")
    lines.append("```")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        print(__doc__)
        sys.exit(1)
    root = args[0]

    def opt(name, default=None):
        return args[args.index(name) + 1] if name in args else default

    depth = int(opt("--depth", 2))
    prefix = opt("--prefix", "")
    nodes, edges = analyze(root, depth, prefix, "--external" in args)
    cycles = find_cycles(edges)

    if "--json" in args:
        print(json.dumps({
            "edges": [{"from": a, "to": b, "count": len(r), "evidence": r[:20]} for (a, b), r in sorted(edges.items())],
            "cycles": cycles,
        }, ensure_ascii=False, indent=2))
        return

    print("## モジュール依存図\n")
    print("矢印のラベルは参照箇所の数。赤線は相互依存(循環)。\n")
    print(to_mermaid(nodes, edges, cycles))
    print("\n## 依存の根拠(各エッジ最大3件)\n")
    print("| From | To | 件数 | 根拠 |\n|---|---|---|---|")
    for (a, b), refs in sorted(edges.items()):
        ev = ", ".join(f"`{r}`" for r in refs[:3])
        print(f"| {a} | {b.replace('ext:', '(外部) ')} | {len(refs)} | {ev} |")
    if cycles:
        print("\n## 相互依存\n")
        for a, b in cycles:
            print(f"- {a} ⇄ {b}")


if __name__ == "__main__":
    main()
