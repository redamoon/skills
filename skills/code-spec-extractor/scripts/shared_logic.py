#!/usr/bin/env python3
"""共通部品(複数箇所から使われ、ロジックを持つファイル)と、プロジェクト間の共有ライブラリを機械的に検出する。

使い方:
  python3 shared_logic.py <対象ディレクトリ> [--min-consumers N] [--prefix P] [--json]
      ファイル単位の import 関係から、2つ以上の利用元(ディレクトリ単位)から使われ、
      ロジックの兆候(計算・日付・分岐・入力検証・状態管理・定数・外部I/O)を持つファイルを候補として出す
  python3 shared_logic.py <対象ディレクトリ> --projects [--json]
      複数プロジェクト構成(.NET のソリューション、Maven/Gradle のマルチモジュール、CMake、
      JS のワークスペース、Cargo のワークスペース)の参照関係を Mermaid 図にし、
      複数プロジェクトから参照される共有ライブラリ(DLL など)を示す

対応: TypeScript/JavaScript(.vue / .svelte 含む), Python, Java/Kotlin, PHP, C#, Go, Ruby(require_relative), Perl
C# と Go は名前空間・パッケージ単位(ディレクトリ)で数える。解析は正規表現による近似で、結果は候補。
"""
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dep_graph as dg  # noqa: E402
import screen_inventory as si  # noqa: E402

# ロジックの兆候: 種別 → 正規表現(言語をまたいで使えるものに絞る)
SIGNALS = [
    ("計算", re.compile(
        r"\bMath\.(?:round|floor|ceil|trunc)\(|\.toFixed\(|\bBigDecimal\b|\bRoundingMode\b|\bDecimal\(|"
        r"\b(?:round|floor|ceil|intdiv|bcadd|bcmul|bcdiv)\(|\bnumber_format\(|\bsprintf\(\s*['\"]%\.\d|"
        r"\bIntl\.NumberFormat\b|\.reduce\(|\bsum\(|[*/]\s*100\b|\*\s*0?\.\d+")),
    ("日付", re.compile(
        r"\bdate-fns\b|\bdayjs\b|\bmoment\(|\bLocalDate(?:Time)?\b|\bZonedDateTime\b|\bstrftime\b|\bCarbon\b|"
        r"\b(?:add|sub)(?:Days|Months|Years)\(|\b(?:startOf|endOf)(?:Month|Day|Week|Year)\b|\.get(?:Full)?(?:Month|Year|Date)\(|"
        r"\btimedelta\b|\bTimeZone|\btoISOString\(")),
    ("分岐ルール", re.compile(
        r"\b(?:status|state|type|role|plan|kind|category|level)\s*(?:===?|!==?|==|!=)\s*['\"A-Z]|"
        r"\bcase\s+['\"]?[A-Z][A-Z_]+|\bswitch\s*\(\s*\w*(?:status|type|kind|role|state)")),
    ("入力検証", re.compile(
        r"\bz\.object\(|\byup\.object\(|\bv\.object\(|\.refine\(|\bvalidates?\b|\bValidator\b|@(?:NotNull|NotBlank|Size|Min|Max|Pattern|Valid)\b|"
        r"\bvalidate\w*\(|\brules\s*[:=]|\bclass-validator\b|@Is[A-Z]\w*\(")),
    ("状態管理", re.compile(
        # 型引数付きの呼び出し(createContext<T>(...))も拾う
        r"\b(?:useReducer|createSlice|createStore|configureStore|defineStore|createReducer|atom|writable|readable|derived|"
        r"makeAutoObservable|createMachine|computed|useMemo|signal|createContext|createSignal|createEffect)\s*(?:<[^()]*>)?\(|"
        r"\bnew\s+Vuex\.Store\(|\bcreate(?:<[^()]*>)?\(\s*\(\s*set\b|\$state\(|\$derived\(")),
    ("定数", re.compile(
        r"^\s*(?:export\s+)?(?:const|final|public\s+(?:static\s+)?(?:final|const)|static\s+final|private\s+static\s+final)\s+(?:\w+\s+)?[A-Z][A-Z0-9_]{2,}\s*[:=]|"
        r"^\s*[A-Z][A-Z0-9_]{2,}\s*=\s*['\"\d]|\bdefine\(\s*['\"][A-Z_]{3,}|^\s*use\s+constant\b")),
    ("外部I/O", re.compile(
        r"\bfetch\(|\$fetch\(|\baxios\b|\bHttpClient\b|\bRestTemplate\b|\bWebClient\b|\brequests\.(?:get|post)|\bhttp\.(?:Get|Post|NewRequest)|"
        r"\bprisma\.\w+\.|\b\w*Repository\b|\.query\(|\bSELECT\s|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bgql`")),
]
ROLE = [
    ("API定義", re.compile(r"(^|/)(graphql|gql|api|apis|queries|mutations|openapi)/|\.(graphql|gql|api)\.\w+$")),
    ("ドメイン/モデル", re.compile(r"\.(model|entity|dto)\.\w+$|(Entity|Model|Dto)\.\w+$")),
    ("フック/composable", re.compile(r"(^|/)(hooks|composables)/|(^|/)use[A-Z]\w*\.\w+$")),
    ("ストア/コンテキスト", re.compile(r"(^|/)(stores?|state|redux|slices?|atoms?|contexts?|providers?)/|\.(store|slice|context)\.\w+$|-context\.\w+$")),
    ("サービス", re.compile(r"(^|/)services?/|Service\.\w+$|_service\.\w+$")),
    ("リポジトリ/DAO", re.compile(r"(^|/)(repositor(y|ies)|dao)/|(Repository|Dao|DAO)\.\w+$")),
    ("ドメイン/モデル", re.compile(r"(^|/)(domain|models?|entities|entity)/")),
    ("入力検証/スキーマ", re.compile(r"(^|/)(validators?|validations?|schemas?)/|(schema|validator)s?\.\w+$", re.I)),
    ("定数/設定", re.compile(r"(^|/)(constants?|config)/|(constants?|consts?|config)\.\w+$", re.I)),
    ("ユーティリティ", re.compile(r"(^|/)(utils?|helpers?|lib|libs|common|shared|core)/")),
    ("UIコンポーネント", re.compile(r"\.(tsx|jsx|vue|svelte)$")),
]


def role_of(rel):
    # リポジトリ直下のディレクトリ名(例: service/)に引きずられないよう、末尾3要素だけで判定する
    tail = "/".join(rel.split("/")[-3:])
    for name, rx in ROLE:
        if rx.search(tail):
            return name
    return "その他"


# ---------- ファイル単位の import 解決 ----------

def build_indexes(root, files):
    fileset = set(files)
    py = {}
    for f in files:
        if f.endswith(".py"):
            noext = f[:-3]
            parts = noext.split("/")
            for start in range(len(parts)):
                key = "/".join(parts[start:])
                py.setdefault(key, f)
                if key.endswith("/__init__"):
                    py.setdefault(key[: -len("/__init__")], f)
    ns_dir = dg.build_ns_index(root, [f for f in files if dg.lang_of(f)])
    pl_file = {}
    for f in files:
        if dg.lang_of(f) == "pl":
            for line in dg.read_lines(os.path.join(root, f)):
                m = dg.RX["pl_pkg"].match(line)
                if m:
                    pl_file.setdefault(m.group(1), f)
    return fileset, py, ns_dir, pl_file


def resolve(root, rel, lang, line, idx, gomod):
    """1行から (解決先: ファイル or 'dir/' , 生の名前, import した名前の集合) を返す"""
    fileset, py, ns_dir, pl_file = idx
    out = []
    if lang == "js":
        for m in si.NAMED_IMPORT_RX.finditer(line):
            default, named, spec = m.groups()
            names = {n.strip().split(" as ")[0].strip() for n in (named or "").split(",") if n.strip()}
            if default:
                names.add("default")
            out.append((si.resolve_import(rel, spec, fileset), spec, names))
        if not out:
            for spec in dg.RX["js"].findall(line):
                out.append((si.resolve_import(rel, spec, fileset), spec, set()))
    elif lang == "py":
        m = dg.RX["py"].match(line)
        if m:
            spec = m.group(1) or m.group(2)
            if spec.startswith("."):
                base = os.path.dirname(rel)
                for _ in range(len(spec) - len(spec.lstrip(".")) - 1):
                    base = os.path.dirname(base)
                key = "/".join(x for x in (base, spec.lstrip(".").replace(".", "/")) if x)
            else:
                key = spec.replace(".", "/")
            names = set()
            mm = re.search(r"import\s+(.+)$", line)
            if m.group(1) and mm:
                names = {n.strip().split(" as ")[0] for n in mm.group(1).strip("() \n").split(",") if n.strip()}
            target = next((py[k] for k in [key + "/" + n for n in names] + [key] if k in py), None)
            out.append((target, spec, names))
    elif lang == "jvm":
        m = dg.RX["jvm_import"].match(line)
        if m:
            name = m.group(1)
            pkg, _, cls = name.rpartition(".")
            d = ns_dir.get(pkg)
            target = None
            if d is not None:
                for ext in (".java", ".kt"):
                    cand = f"{d}/{cls}{ext}" if d else f"{cls}{ext}"
                    if cand in fileset:
                        target = cand
                if target is None and line.rstrip().endswith("*"):
                    target = (d or ".") + "/"
            out.append((target, name, {cls}))
    elif lang == "php":
        m = dg.RX["php_use"].match(line)
        if m:
            name = m.group(1)
            pkg, _, cls = name.rpartition("\\")
            d = ns_dir.get(pkg.replace("\\", "."))
            cand = (f"{d}/{cls}.php" if d else f"{cls}.php") if d is not None else None
            out.append((cand if cand in fileset else None, name, {cls}))
    elif lang == "cs":
        m = dg.RX["cs_using"].match(line)
        if m:
            d = ns_dir.get(m.group(1))
            out.append(((d or ".") + "/" if d is not None else None, m.group(1), set()))
    elif lang == "go":
        m = dg.RX["go"].match(line)
        if m and gomod and m.group(1).startswith(gomod + "/"):
            out.append((m.group(1)[len(gomod) + 1:] + "/", m.group(1), set()))
    elif lang == "rb":
        m = dg.RX["rb"].match(line)
        if m:
            p = os.path.normpath(os.path.join(os.path.dirname(rel), m.group(1))).replace(os.sep, "/")
            p = p if p.endswith(".rb") else p + ".rb"
            out.append((p if p in fileset else None, m.group(1), set()))
    elif lang == "pl":
        m = dg.RX["pl_parent"].match(line)
        names = []
        if m:
            names = [n for n in re.findall(r"[A-Za-z_][\w:]*", m.group(1)) if n not in ("qw", "norequire")]
        else:
            m = dg.RX["pl_use"].match(line)
            if m and m.group(1) not in dg.PERL_PRAGMAS:
                names = [m.group(1)]
        for n in names:
            out.append((pl_file.get(n), n, set()))
    return out


def unit_files(unit, files):
    if unit.endswith("/"):
        d = unit.rstrip("/")
        d = "" if d == "." else d
        return [f for f in files if os.path.dirname(f) == d and dg.lang_of(f)]
    return [unit]


def scan_signals(root, unit, files, names):
    """ロジックの兆候を数える。GraphQL 定義ファイルのように export が並ぶファイルは、使われている名前の定義だけを見る"""
    sig = defaultdict(list)
    for f in unit_files(unit, files):
        lines = dg.read_lines(os.path.join(root, f))
        current = None
        for no, line in enumerate(lines, 1):
            m = re.match(r"\s*export\s+(?:const|function|async\s+function|class)\s+(\w+)", line)
            if m:
                current = m.group(1)
            if names and current and current not in names:
                continue
            for kind, rx in SIGNALS:
                if rx.search(line):
                    sig[kind].append(f"{f}:{no}")
    return sig


def analyze(root, prefix, min_consumers):
    files = [f for f in dg.collect_files(root, prefix)]
    allfiles = list(si.walk(root))
    idx = build_indexes(root, files)
    gomod = dg.go_module_path(root)
    pkgs = si.package_roots(root, allfiles)
    comps, funcs = si.nuxt_auto_imports(allfiles, pkgs)
    func_idx = {}
    for f in funcs:
        for line in dg.read_lines(os.path.join(root, f)):
            m = re.search(r"export\s+(?:async\s+)?(?:const|function)\s+(\w+)", line)
            if m:
                func_idx[m.group(1)] = f

    users = defaultdict(lambda: {"consumers": set(), "evidence": [], "names": set()})
    for rel in files:
        lang = dg.lang_of(rel)
        consumer = os.path.dirname(rel) or "(root)"
        lines = dg.read_lines(os.path.join(root, rel))
        for no, line in enumerate(lines, 1):
            for target, _, names in resolve(root, rel, lang, line, idx, gomod):
                if not target or target == rel or (target.endswith("/") and os.path.dirname(rel) == target.rstrip("/")):
                    continue
                u = users[target]
                u["consumers"].add(consumer)
                u["evidence"].append(f"{rel}:{no}")
                u["names"] |= names
        if lang == "js" and (comps or func_idx):
            body = "".join(lines)
            for tag in set(re.findall(r"<([A-Z]\w*|[a-z]+(?:-[a-z]+)+)\b", body)):
                t = comps.get(si.pascal(tag))
                if t and t != rel:
                    users[t]["consumers"].add(consumer)
                    users[t]["evidence"].append(f"{rel}(<{tag}>)")
            for fn in set(re.findall(r"\b(use[A-Z]\w*)\(", body)):
                t = func_idx.get(fn)
                if t and t != rel:
                    users[t]["consumers"].add(consumer)
                    users[t]["evidence"].append(f"{rel}({fn})")
                    users[t]["names"].add(fn)

    rows = []
    for unit, u in users.items():
        if len(u["consumers"]) < min_consumers or dg.TEST_HINT.search(unit):
            continue
        names = {n for n in u["names"] if n != "default"} if all(n != "default" for n in u["names"]) else set()
        sig = scan_signals(root, unit, files, names)
        if not sig:
            continue
        rows.append({
            "unit": unit, "role": role_of(unit) if not unit.endswith("/") else "パッケージ/名前空間",
            "consumers": sorted(u["consumers"]), "used_names": sorted(names),
            "signals": {k: len(v) for k, v in sig.items()},
            "signal_evidence": [e for v in sig.values() for e in v[:2]][:6],
            "import_evidence": u["evidence"][:5],
        })
    rows.sort(key=lambda r: (-len(r["consumers"]), -sum(r["signals"].values()), r["unit"]))
    return rows


# ---------- プロジェクト間の参照(共有ライブラリ) ----------

def project_graph(root):
    files = list(si.walk(root))
    projects = {}  # id -> {name, kind, file}
    edges = []     # (from, to, evidence)

    def add(pid, name, kind, file, line=1):
        projects.setdefault(pid, {"name": name, "kind": kind, "evidence": f"{file}:{line}"})

    # .NET (.csproj / .vbproj / .fsproj)
    for f in files:
        if not f.endswith((".csproj", ".vbproj", ".fsproj")):
            continue
        lines = dg.read_lines(os.path.join(root, f))
        body = "".join(lines)
        out = re.search(r"<OutputType>\s*(\w+)\s*</OutputType>", body)
        kind = (out.group(1) if out else "Library").lower()
        if re.search(r"<Use(WindowsForms|WPF)>\s*true", body, re.I):
            kind += "+" + re.search(r"<Use(WindowsForms|WPF)>", body, re.I).group(1)
        add(f, os.path.splitext(os.path.basename(f))[0], kind, f)
        for no, line in enumerate(lines, 1):
            for ref in re.findall(r"<ProjectReference\s+Include=\"([^\"]+)\"", line):
                tgt = os.path.normpath(os.path.join(os.path.dirname(f), ref.replace("\\", "/"))).replace(os.sep, "/")
                edges.append((f, tgt, f"{f}:{no}"))

    # Maven(<module> と兄弟 artifactId への依存)
    poms = [f for f in files if os.path.basename(f) == "pom.xml"]
    artifact = {}
    for f in poms:
        body = "".join(dg.read_lines(os.path.join(root, f)))
        body_wo_parent = re.sub(r"<parent>.*?</parent>", "", body, flags=re.S)
        m = re.search(r"<artifactId>([^<]+)</artifactId>", body_wo_parent)
        if m:
            artifact[m.group(1)] = f
            pk = re.search(r"<packaging>([^<]+)</packaging>", body)
            add(f, m.group(1), pk.group(1) if pk else "jar", f)
    for f in poms:
        in_deps = False  # <parent> は継承なので依存に数えない。<dependencies> の中だけを見る
        for no, line in enumerate(dg.read_lines(os.path.join(root, f)), 1):
            if "<dependencies>" in line:
                in_deps = True
            if in_deps:
                for a in re.findall(r"<artifactId>([^<]+)</artifactId>", line):
                    if a in artifact and artifact[a] != f and f in projects:
                        edges.append((f, artifact[a], f"{f}:{no}"))
            if "</dependencies>" in line:
                in_deps = False

    # Gradle(settings の include と project(':x') 依存)
    for f in files:
        if os.path.basename(f) in ("build.gradle", "build.gradle.kts"):
            d = os.path.dirname(f)
            add(f, os.path.basename(d) or "(root)", "gradle", f)
            for no, line in enumerate(dg.read_lines(os.path.join(root, f)), 1):
                for p in re.findall(r"project\(\s*['\"]:?([\w:-]+)['\"]\s*\)", line):
                    tgt_dir = p.replace(":", "/")
                    for cand in ("build.gradle", "build.gradle.kts"):
                        t = f"{tgt_dir}/{cand}"
                        if t in files:
                            edges.append((f, t, f"{f}:{no}"))

    # CMake
    targets = {}
    cmakes = [f for f in files if os.path.basename(f) == "CMakeLists.txt"]
    for f in cmakes:  # 1周目: ターゲット定義を集める(定義より先に参照するファイルがあるため)
        for no, line in enumerate(dg.read_lines(os.path.join(root, f)), 1):
            m = re.search(r"\badd_(library|executable)\(\s*([\w.-]+)", line)
            if m:
                pid = f"cmake:{m.group(2)}"
                targets[m.group(2)] = pid
                add(pid, m.group(2), "lib" if m.group(1) == "library" else "exe", f, no)
    for f in cmakes:
        for no, line in enumerate(dg.read_lines(os.path.join(root, f)), 1):
            m = re.search(r"\btarget_link_libraries\(\s*([\w.-]+)\s+(.+?)\)?\s*$", line)
            if m:
                for dep in re.findall(r"[\w.-]+", m.group(2)):
                    if dep in targets:
                        edges.append((f"cmake:{m.group(1)}", targets[dep], f"{f}:{no}"))

    # JS ワークスペース / Cargo ワークスペース
    names = {}
    for f in files:
        if os.path.basename(f) == "package.json" and "/node_modules/" not in f:
            try:
                name = json.load(open(os.path.join(root, f), encoding="utf-8")).get("name")
            except (OSError, ValueError):
                name = None
            if name:
                names[name] = f
                add(f, name, "package", f)
    for name, f in names.items():
        for no, line in enumerate(dg.read_lines(os.path.join(root, f)), 1):
            for dep in re.findall(r"\"(@?[\w./-]+)\"\s*:", line):
                if dep in names and names[dep] != f:
                    edges.append((f, names[dep], f"{f}:{no}"))
    for f in files:
        if os.path.basename(f) == "Cargo.toml":
            lines = dg.read_lines(os.path.join(root, f))
            m = re.search(r"^name\s*=\s*\"([^\"]+)\"", "".join(lines), re.M)
            if m:
                add(f, m.group(1), "crate", f)
            for no, line in enumerate(lines, 1):
                p = re.search(r"path\s*=\s*\"([^\"]+)\"", line)
                if p:
                    t = os.path.normpath(os.path.join(os.path.dirname(f), p.group(1), "Cargo.toml")).replace(os.sep, "/")
                    edges.append((f, t, f"{f}:{no}"))

    edges = [(a, b, e) for a, b, e in edges if a in projects and b in projects and a != b]
    fan_in = defaultdict(set)
    for a, b, _ in edges:
        fan_in[b].add(a)
    return projects, edges, fan_in


def projects_mermaid(projects, edges, fan_in):
    nid = {p: f"p{i}" for i, p in enumerate(sorted(projects))}
    lines = ["```mermaid", "flowchart LR"]
    for p in sorted(projects):
        info = projects[p]
        label = f"{info['name']}<br/>({info['kind']})"
        shape = f'{nid[p]}[["{label}"]]' if len(fan_in.get(p, ())) >= 2 else f'{nid[p]}["{label}"]'
        lines.append(f"  {shape}")
    counts = defaultdict(int)
    for a, b, _ in edges:
        counts[(a, b)] += 1
    for (a, b) in sorted(counts):
        lines.append(f"  {nid[a]} --> {nid[b]}")
    shared = [nid[p] for p in projects if len(fan_in.get(p, ())) >= 2]
    if shared:
        lines.append("  classDef shared fill:#fff3cd,stroke:#b58900")
        lines.append(f"  class {','.join(shared)} shared")
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

    if "--projects" in args:
        projects, edges, fan_in = project_graph(root)
        if "--json" in args:
            print(json.dumps({"projects": projects, "edges": [{"from": a, "to": b, "evidence": e} for a, b, e in edges],
                              "shared": sorted(p for p in projects if len(fan_in.get(p, ())) >= 2)},
                             ensure_ascii=False, indent=2))
            return
        if not projects:
            print("プロジェクト定義(.csproj / pom.xml / build.gradle / CMakeLists.txt / package.json / Cargo.toml)が見つからない")
            return
        print("## プロジェクト参照図\n")
        print("二重枠・黄色は2つ以上のプロジェクトから参照される共有ライブラリ。\n")
        print(projects_mermaid(projects, edges, fan_in))
        print("\n## プロジェクト一覧\n")
        print("| プロジェクト | 種別 | 参照元の数 | 定義 |\n|---|---|---|---|")
        for p in sorted(projects, key=lambda x: (-len(fan_in.get(x, ())), x)):
            info = projects[p]
            print(f"| {info['name']} | {info['kind']} | {len(fan_in.get(p, ()))} | `{info['evidence']}` |")
        print("\n## 参照の根拠\n")
        print("| From | To | 根拠 |\n|---|---|---|")
        for a, b, e in edges:
            print(f"| {projects[a]['name']} | {projects[b]['name']} | `{e}` |")
        return

    min_c = int(opt("--min-consumers", 2))
    rows = analyze(root, opt("--prefix", ""), min_c)
    if "--json" in args:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    print(f"# 共通部品の候補 ({len(rows)}件)\n")
    print(f"{min_c}つ以上の利用元(ディレクトリ単位)から import され、ロジックの兆候を持つもの。"
          "モジュールとして別に仕様化するかは、ユーザーと合意して決める。\n")
    print("| 候補 | 役割(推定) | 利用元 | 兆候 | 兆候の根拠 | 利用の根拠 |\n|---|---|---|---|---|---|")
    for r in rows:
        sig = ", ".join(f"{k}{v}" for k, v in sorted(r["signals"].items(), key=lambda x: -x[1]))
        cons = "<br>".join(f"`{c}`" for c in r["consumers"][:5]) + (f"<br>ほか{len(r['consumers']) - 5}" if len(r["consumers"]) > 5 else "")
        unit = f"`{r['unit']}`" + (f"<br>使用: {', '.join(r['used_names'][:6])}" if r["used_names"] else "")
        print(f"| {unit} | {r['role']} | {len(r['consumers'])}<br>{cons} | {sig} | "
              f"{', '.join(f'`{e}`' for e in r['signal_evidence'][:3])} | {', '.join(f'`{e}`' for e in r['import_evidence'][:2])} |")


if __name__ == "__main__":
    main()
