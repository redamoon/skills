#!/usr/bin/env python3
"""フロントエンドの画面(ルート)を列挙し、画面ごとの事実(API呼び出し・フォーム・遷移・状態分岐など)を file:line 付きで集める。

使い方:
  python3 screen_inventory.py <対象ディレクトリ>                       # 画面一覧
  python3 screen_inventory.py <対象ディレクトリ> --screen <ルート|ファイル> [--follow N]  # 1画面の事実
  python3 screen_inventory.py <対象ディレクトリ> --transitions [--follow N]            # 画面遷移図(Mermaid)
  共通: --json

  --follow N    画面ファイルから UI 部品を N 段たどる(既定 2)。フック・ストア・サービス・ユーティリティなど
                ロジックのファイルは段数に関係なく最後までたどる

対応:
  ファイルベース: Next.js(app / pages), Nuxt(pages), Remix / React Router v7(app/routes), SvelteKit(src/routes)
  設定ベース:     React Router(<Route> / createBrowserRouter), Vue Router(routes 配列), TanStack Router(createFileRoute),
                  Angular(Routes 配列。templateUrl の HTML もたどる)
解析は正規表現による近似。結果は候補なので、必ず実コードで確認すること。
"""
import json
import os
import re
import sys
from collections import defaultdict

SKIP_DIRS = {
    ".git", "node_modules", "vendor", "dist", "build", ".next", ".nuxt", ".output",
    ".svelte-kit", "coverage", "out", "public", "storybook-static",
}
TEST_HINT = re.compile(r"(^|/)(tests?|spec|__tests__|__mocks__|e2e|cypress|playwright)(/|$)|\.(test|spec|stories)\.\w+$")
SRC_EXT = (".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".vue", ".svelte", ".mdx")
PAGE_EXT = r"(?:tsx|ts|jsx|js|mdx)"

# 画面ファイル内で拾う事実: 種別 → 正規表現
FACTS = [
    ("api", re.compile(
        r"\bfetch\(|\$fetch\(|\buse(?:Lazy)?Fetch\(|\buse(?:Lazy)?AsyncData\(|\baxios(?:\.\w+)?\(|"
        r"\buse(?:Suspense)?(?:Infinite)?Query\(|\buseMutation\(|\buseSWR\w*\(|"
        r"\b\w*[Aa]pi\w*\.(?:get|post|put|patch|delete)\(|\btrpc\.[\w.]+\.(?:useQuery|useMutation|query|mutate)\b|"
        r"\bgetServerSideProps\b|\bgetStaticProps\b|\bgetStaticPaths\b|"
        r"export\s+(?:async\s+)?(?:function|const)\s+(?:loader|action|clientLoader|clientAction)\b|"
        r"['\"]use server['\"]|\bgql`|\bgraphql\(|\bthis\.http\.(?:get|post|put|patch|delete)\(|"
        r"export\s+(?:async\s+)?(?:function|const)\s+load\b")),
    ("guard", re.compile(
        r"\bdefinePageMeta\(|\bmiddleware\s*:|\bbeforeEnter\b|\bbeforeEach\(|\buseSession\(|\bgetServerSession\(|"
        r"\bauth\(\)|\bRequireAuth\b|\bProtectedRoute\b|\bcanActivate\b|\bisAdmin\b|\bhasRole\(|\bhasPermission\(|"
        r"\bredirect\(\s*['\"`]/(?:login|signin|sign-in)")),
    ("form", re.compile(
        r"<(?:form|Form|input|Input|select|Select|textarea|Textarea|Checkbox|Radio\w*|Switch|DatePicker|Field|FormField|FormItem|el-form|v-form|v-text-field)\b|"
        r"\bv-model\b|\buseForm\(|\bregister\(\s*['\"]|\bFormData\(|\bbind:value\b|\[\(ngModel\)\]|\bformControlName=|\[formGroup\]")),
    ("validation", re.compile(
        r"\bz\.object\(|\byup\.object\(|\bv\.object\(|\brules\s*[:=]|\bresolver\s*:|\brequired(?:=|:|\b(?=\s*[/>]))|"
        r"\b(?:minLength|maxLength|min|max|pattern)(?:=|:)|\.refine\(|\bvalidate\w*\(")),
    ("action", re.compile(
        r"\bon(?:Click|Submit|Change|Blur)=\{|@(?:click|submit|change|input)(?:\.\w+)*=\"|\bv-on:(?:click|submit)|"
        r"\bon:(?:click|submit|change|input)\b|\bon(?:click|submit|change)=\{|\((?:click|submit|ngSubmit|change)\)=")),
    ("navigation", re.compile(
        r"\brouter\.(?:push|replace|back|go)\(|\bnavigate\(|\bnavigateTo\(|\bredirect\(|\bpermanentRedirect\(|\bnotFound\(|"
        r"<(?:Link|NuxtLink|RouterLink|router-link|Navigate)\b|\bhref=[\"'{]\s*[`'\"]?/|\bwindow\.location|"
        r"\bgoto\(|\brouter\.navigate(?:ByUrl)?\(|\brouterLink=")),
    ("condition", re.compile(
        r"\bv-(?:if|else-if|else|show)\b|\{\s*!?[\w.?]+\s*&&\s*\(?\s*<|\?\s*\(?\s*<[A-Za-z]|"
        r"\bif\s*\(\s*!?\s*(?:is)?(?:Loading|loading|Pending|pending|isFetching|error|isError|data|items|list)\b|"
        r"<Suspense\b|\bErrorBoundary\b|\bfallback=|\.length\s*===?\s*0|<(?:template\s+)?#(?:fallback|empty|error)|"
        r"\{#(?:if|each|await)\b|\{:(?:else|then|catch)\b|\*ng(?:If|For)=|@(?:if|for|switch|empty|defer)\b")),
    ("logic", re.compile(
        r"\b(?:computed|useMemo|useReducer|createMachine|derived|createSelector|createMemo)\s*(?:<[^()]*>)?\(|\$derived\(|"
        r"\bMath\.(?:round|floor|ceil|trunc)\(|\.toFixed\(|\.reduce\(|\bIntl\.(?:NumberFormat|DateTimeFormat)\b|"
        r"\.toLocale(?:Date)?String\(|\b(?:format|parse)(?:ISO)?\(\s*\w+\s*,\s*['\"]|^\s*\$:\s")),
    ("store", re.compile(
        r"\buse(?:App)?Selector\(|\buse(?:App)?Dispatch\(|\bdefineStore\(|\buse\w+Store\(|\buseAtom\w*\(|"
        r"\buseRecoil\w*\(|\buseContext\(|\buseState\(\s*['\"]|\bprovide\(|\binject\(")),
    ("text", re.compile(
        r"<h[1-3]\b|<title>|\buseHead\(|\buseSeoMeta\(|\bexport\s+(?:const|async\s+function)\s+(?:metadata|generateMetadata)\b|"
        r"\bdocument\.title\b|\$?\bt\(\s*['\"][\w.-]+['\"]")),
]
FACT_LABEL = {
    "api": "データ取得・API", "guard": "ガード・権限", "form": "フォーム・入力", "validation": "バリデーション",
    "action": "操作(イベントハンドラ)", "navigation": "画面遷移", "condition": "状態分岐(表示条件)",
    "logic": "派生値・計算・整形", "store": "状態管理", "text": "見出し・タイトル・文言キー",
}

IMPORT_RX = re.compile(r"""(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]""")
NAMED_IMPORT_RX = re.compile(r"""import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]""")
NAV_TARGET_RX = re.compile(
    r"""(?:\.(?:push|replace)|\bnavigate|\bnavigateTo|\bnavigateByUrl|\bredirect|\bpermanentRedirect|\bgoto)\(\s*\[?\s*[`'"](/[^`'"\s]*)[`'"]|"""
    r"""(?:\bhref|\bto|:to|\brouterLink)=\{?\s*[`'"](/[^`'"\s]*)[`'"]|\blocation(?:\.href)?\s*=\s*[`'"](/[^`'"\s]*)[`'"]""")
CONFIG_FILE_HINT = re.compile(
    r"createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|<Routes\b|useRoutes\(|"
    r"createRouter\(|RouteRecordRaw|new\s+VueRouter|createFileRoute\(|createRootRoute|RouterModule|:\s*Routes\s*=|provideRouter\(")
ROUTE_JSX_RX = re.compile(r"""<Route\b[^>]*?\bpath=\{?\s*['"`]([^'"`]*)['"`]""")
ROUTE_OBJ_RX = re.compile(r"""\bpath\s*:\s*['"`]([^'"`]*)['"`]""")
ROUTE_FILE_RX = re.compile(r"""\bcreateFileRoute\(\s*['"`]([^'"`]+)['"`]""")
COMPONENT_RX = re.compile(
    r"""element=\{\s*<(\w+)|element\s*:\s*<(\w+)|\bComponent\s*:\s*(\w+)|\bcomponent\s*:\s*(\w+)\b(?!\s*\()|"""
    r"""import\(\s*['"]([^'"]+)['"]""")


# ---------- ファイル走査 ----------

def walk(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
        for f in sorted(files):
            yield os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/")


def read_lines(root, rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", errors="ignore") as fh:
            return fh.readlines()
    except OSError:
        return []


def package_roots(root, files):
    """package.json のあるディレクトリ → 依存パッケージ名の集合"""
    out = {}
    for rel in files:
        if os.path.basename(rel) != "package.json":
            continue
        try:
            with open(os.path.join(root, rel), encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        deps = set()
        for k in ("dependencies", "devDependencies", "peerDependencies"):
            deps |= set((data.get(k) or {}).keys())
        out[os.path.dirname(rel)] = deps
    if not out:
        out[""] = set()
    return out


def frameworks_of(deps):
    fw = set()
    if "next" in deps:
        fw.add("next")
    if "nuxt" in deps or "nuxt3" in deps:
        fw.add("nuxt")
    if deps & {"@remix-run/react", "@remix-run/dev", "@react-router/dev"}:
        fw.add("remix")
    if "@sveltejs/kit" in deps:
        fw.add("sveltekit")
    if not deps:  # package.json が無い/読めない場合は規約を全部試す
        fw |= {"next", "nuxt", "remix", "sveltekit"}
    return fw


def under(pkg, rel):
    if not pkg:
        return rel
    return rel[len(pkg) + 1:] if rel.startswith(pkg + "/") else None


# ---------- ルートの組み立て ----------

def next_segment(seg):
    if seg.startswith("(") or seg.startswith("@"):  # ルートグループ / パラレルルート
        return None
    m = re.fullmatch(r"\[\[\.\.\.(\w+)\]\]", seg)
    if m:
        return f"*{m.group(1)}?"
    m = re.fullmatch(r"\[\[(\w+)\]\]", seg)
    if m:
        return f":{m.group(1)}?"
    m = re.fullmatch(r"\[\.\.\.(\w+)\]", seg)
    if m:
        return f"*{m.group(1)}"
    m = re.fullmatch(r"\[(\w+)\]", seg)
    if m:
        return f":{m.group(1)}"
    return seg


def join_route(segs):
    segs = [s for s in segs if s]
    return "/" + "/".join(segs)


def remix_route(name):
    segs = []
    for part in name.split("."):
        if part in ("_index", "index", "route"):
            continue
        if part.startswith("_"):  # パスなしレイアウト
            continue
        part = part.rstrip("_")
        m = re.fullmatch(r"\(\$?(\w+)\)", part)
        if part == "$":
            segs.append("*")
        elif m:
            segs.append(f":{m.group(1)}?" if part.startswith("($") else f"{m.group(1)}?")
        elif part.startswith("$"):
            segs.append(":" + part[1:])
        else:
            segs.append(part)
    return join_route(segs)


def file_routes(root, files, pkgs):
    screens = []
    for pkg, deps in pkgs.items():
        fw = frameworks_of(deps)
        for rel in files:
            sub = under(pkg, rel)
            if sub is None or TEST_HINT.search(rel):
                continue
            if "next" in fw:
                m = re.fullmatch(rf"(?:src/)?app/(?:(.*)/)?page\.{PAGE_EXT}", sub)
                if m:
                    segs = (m.group(1) or "").split("/")
                    route = join_route([next_segment(s) for s in segs if s])
                    screens.append(screen(route, rel, "next-app", extras=next_app_extras(files, rel)))
                    continue
                m = re.fullmatch(rf"(?:src/)?pages/(.+)\.{PAGE_EXT}", sub)
                if m and not m.group(1).startswith("api/") and os.path.basename(m.group(1)) not in ("_app", "_document"):
                    segs = [s for s in m.group(1).split("/") if s != "index"]
                    screens.append(screen(join_route([next_segment(s) for s in segs]), rel, "next-pages"))
                    continue
            if "nuxt" in fw:
                m = re.fullmatch(r"(?:app/|src/)?pages/(.+)\.vue", sub)
                if m:
                    segs = [s for s in m.group(1).split("/") if s != "index"]
                    screens.append(screen(join_route([next_segment(s) for s in segs]), rel, "nuxt"))
                    continue
            if "sveltekit" in fw:
                m = re.fullmatch(r"src/routes/(?:(.*)/)?\+page\.svelte", sub)
                if m:
                    segs = (m.group(1) or "").split("/")
                    route = join_route([next_segment(x) for x in segs if x])
                    screens.append(screen(route, rel, "sveltekit", extras=sveltekit_extras(files, rel)))
                    continue
            if "remix" in fw:
                m = re.fullmatch(r"app/routes/([^/]+?)(?:/route)?\.(?:tsx|ts|jsx|js)", sub)
                if m:
                    body = "".join(read_lines(root, rel))
                    kind = "remix" if re.search(r"export\s+default\b", body) else "remix-resource"
                    screens.append(screen(remix_route(m.group(1)), rel, kind))
    return screens


def next_app_extras(files, page_rel):
    """page.tsx の祖先にある layout / loading / error / not-found(状態の手がかり)"""
    fileset = set(files)
    extras = []
    d = os.path.dirname(page_rel)
    while True:
        for name in ("layout", "template", "loading", "error", "not-found"):
            for ext in ("tsx", "ts", "jsx", "js"):
                p = f"{d}/{name}.{ext}" if d else f"{name}.{ext}"
                if p in fileset:
                    extras.append(f"{name}: {p}")
        if not d or os.path.basename(d) == "app":
            break
        d = os.path.dirname(d)
    return extras


def sveltekit_extras(files, page_rel):
    """+page.svelte と同じ階層の load 関数・祖先の +layout / +error(状態の手がかり)"""
    fileset = set(files)
    d = os.path.dirname(page_rel)
    extras = [f"load: {d}/{n}" for n in ("+page.ts", "+page.js", "+page.server.ts", "+page.server.js") if f"{d}/{n}" in fileset]
    while True:
        for n in ("+layout.svelte", "+error.svelte"):
            if f"{d}/{n}" in fileset:
                extras.append(f"{n[1:-7]}: {d}/{n}")
        if not d or os.path.basename(d) == "routes":
            break
        d = os.path.dirname(d)
    return extras


def config_routes(root, files):
    screens = []
    for rel in files:
        if not rel.endswith(SRC_EXT) or TEST_HINT.search(rel):
            continue
        lines = read_lines(root, rel)
        body = "".join(lines)
        if not CONFIG_FILE_HINT.search(body):
            continue
        imports = imports_by_name(body)
        stack = []  # (インデント, 結合済みパス) — ネストした children をインデントから推定する
        for i, line in enumerate(lines):
            m = ROUTE_FILE_RX.search(line)
            if m:
                screens.append(screen(m.group(1), rel, "tanstack", line=i + 1))
                continue
            m = ROUTE_JSX_RX.search(line) or ROUTE_OBJ_RX.search(line)
            if not m:
                continue
            raw = m.group(1)
            indent = len(line) - len(line.lstrip())
            while stack and stack[-1][0] >= indent:
                stack.pop()
            if raw.startswith("/") or not stack:
                full = raw if raw.startswith("/") else "/" + raw
                nested = False
            else:
                full = stack[-1][1].rstrip("/") + "/" + raw if raw else stack[-1][1]
                nested = True
            stack.append((indent, full))
            target = None
            for look in lines[i:i + 5]:
                c = COMPONENT_RX.search(look)
                if c:
                    name = next(g for g in c.groups() if g)
                    target = imports.get(name, name) if not name.startswith((".", "@", "~")) else name
                    break
            file = resolve_import(rel, target, set(files)) if target else None
            note = "親パスと結合(インデントから推定)" if nested else ""
            screens.append(screen(full, file or rel, "config", line=i + 1, raw=raw, note=note,
                                  defined_at=f"{rel}:{i + 1}", component=target))
    return screens


def screen(route, file, kind, line=1, extras=None, defined_at=None, **kw):
    s = {"route": route or "/", "file": file, "kind": kind, "evidence": defined_at or f"{file}:{line}"}
    if extras:
        s["extras"] = extras
    s.update({k: v for k, v in kw.items() if v is not None and v != ""})
    return s


# ---------- import の解決と追跡 ----------

def imports_by_name(body):
    out = {}
    for m in NAMED_IMPORT_RX.finditer(body):
        default, named, spec = m.groups()
        if default:
            out[default] = spec
        for n in (named or "").split(","):
            n = n.strip().split(" as ")[-1].strip()
            if n:
                out[n] = spec
    return out


def resolve_import(rel, spec, fileset):
    if not spec:
        return None
    base_dirs = []
    if spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(rel), spec))
        cands = [base]
    elif spec.startswith(("@/", "~/", "~~/", "#/")):
        tail = spec.split("/", 1)[1]
        # 呼び出し元から上にたどり、src/・app/・直下のどこかで見つかるものを採用
        parts = rel.split("/")[:-1]
        for i in range(len(parts), -1, -1):
            prefix = "/".join(parts[:i])
            for sub in ("src", "app", ""):
                base_dirs.append("/".join(x for x in (prefix, sub) if x))
        cands = [os.path.normpath(os.path.join(b, tail)) if b else os.path.normpath(tail) for b in base_dirs]
    else:
        return None
    for c in cands:
        c = c.replace(os.sep, "/")
        for suffix in ("",) + SRC_EXT + tuple("/index" + e for e in SRC_EXT):
            if c + suffix in fileset:
                return c + suffix
    return None


def pascal(s):
    return "".join(p[:1].upper() + p[1:] for p in re.split(r"[-_]", s) if p)


def nuxt_auto_imports(files, pkgs):
    """Nuxt の自動インポート: コンポーネント名 / composable 名 → ファイル"""
    comps, funcs = {}, {}
    for pkg, deps in pkgs.items():
        if "nuxt" not in frameworks_of(deps):
            continue
        for rel in files:
            sub = under(pkg, rel)
            if sub is None:
                continue
            m = re.fullmatch(r"(?:app/|src/)?components/(.+)\.vue", sub)
            if m:
                parts = [pascal(p) for p in m.group(1).split("/")]
                name = ""
                for p in parts:  # components/base/BaseButton.vue → BaseButton(重複した接頭辞は省く)
                    name = p if p.startswith(name) and name else name + p
                comps[name] = rel
            if re.fullmatch(r"(?:app/|src/)?(?:composables|utils)/[^/]+\.(?:ts|js)", sub):
                funcs[rel] = None
    return comps, funcs


LOGIC_PATH = re.compile(r"(^|/)(hooks|composables|stores?|contexts?|providers?|state|services?|utils?|helpers?|lib|domain|models?)/|(^|/)use[A-Z]\w*\.\w+$")


def is_logic_file(rel):
    if rel.endswith(".d.ts"):
        return False
    return rel.endswith((".ts", ".js", ".mjs", ".cjs")) or bool(LOGIC_PATH.search(rel))


def companion_files(meta):
    """画面と組で動くファイル(SvelteKit の load、Next.js の loading / error / not-found)"""
    keys = ("load:", "loading:", "error:", "not-found:")
    return [e.split(": ", 1)[1] for e in (meta or {}).get("extras", []) if e.startswith(keys)]


def collect_facts(root, start, files, follow, auto, max_files=200, companions=()):
    fileset = set(files)
    comps, funcs = auto
    func_idx = {}
    for rel in funcs:
        for no, line in enumerate(read_lines(root, rel), 1):
            m = re.search(r"export\s+(?:async\s+)?(?:const|function)\s+(\w+)", line)
            if m:
                func_idx[m.group(1)] = rel
    visited = {start: 0}
    visited.update({c: 1 for c in companions if c != start})
    used = defaultdict(set)  # ファイル → import された名前("*" は全部)
    queue = [start] + [c for c in companions if c != start]
    order = []
    while queue and len(order) < max_files:
        rel = queue.pop(0)
        order.append(rel)
        depth = visited[rel]
        if depth >= follow and not is_logic_file(rel):
            continue
        body = "".join(read_lines(root, rel))
        nexts = []
        for spec in IMPORT_RX.findall(body):
            nexts.append(resolve_import(rel, spec, fileset))
        for m in NAMED_IMPORT_RX.finditer(body):
            default, named, spec = m.groups()
            t = resolve_import(rel, spec, fileset)
            if t:
                if default:
                    used[t].add("*")
                used[t] |= {n.strip().split(" as ")[0].strip() for n in (named or "").split(",") if n.strip()}
        # Angular: コンポーネントの templateUrl(HTML テンプレート)
        for url in re.findall(r"templateUrl\s*:\s*['\"]([^'\"]+)['\"]", body):
            t = os.path.normpath(os.path.join(os.path.dirname(rel), url)).replace(os.sep, "/")
            nexts.append(t if t in fileset else None)
        if comps:
            for tag in re.findall(r"<([A-Z]\w*|[a-z]+(?:-[a-z]+)+)\b", body):
                name = pascal(tag)
                name = name[4:] if name.startswith("Lazy") and name[4:] in comps else name
                nexts.append(comps.get(name))
        if func_idx:
            for fn in re.findall(r"\b(use[A-Z]\w*)\(", body):
                nexts.append(func_idx.get(fn))
        for n in nexts:
            if n and n not in visited and not TEST_HINT.search(n):
                visited[n] = depth + 1
                queue.append(n)

    facts = defaultdict(list)
    for rel in order:
        lines = read_lines(root, rel)
        names = used.get(rel, set())
        # GraphQL 定義ファイルのように export が並ぶファイルは、import された名前の定義だけを見る
        only = names if names and "*" not in names and rel != start else None
        current = None
        # const nav = useNavigate() のような別名の遷移関数
        aliases = set(re.findall(r"\b(?:const|let)\s+(\w+)\s*=\s*use(?:Navigate|Router)\(\)", "".join(lines)))
        aliases -= {"navigate", "router"}
        alias_rx = re.compile(rf"\b(?:{'|'.join(aliases)})(?:\.(?:push|replace))?\(\s*[`'\"](/[^`'\"\s]*)") if aliases else None
        for no, line in enumerate(lines, 1):
            if only is not None:
                m = re.match(r"(export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|function|class)\s+(\w+)", line)
                if m:
                    current = m.group(2) if m.group(1) else None
                if current and current not in only:
                    continue
            extra = alias_rx.findall(line) if alias_rx else []
            for kind, rx in FACTS:
                if rx.search(line) or (kind == "navigation" and extra):
                    row = {"location": f"{rel}:{no}", "depth": visited[rel], "code": line.strip()[:160]}
                    if kind == "navigation":
                        row["targets"] = nav_targets(line, extra)
                    facts[kind].append(row)
    return order, visited, facts


# ---------- 画面遷移 ----------

def route_regex(route):
    out = []
    for seg in route.strip("/").split("/"):
        if not seg:
            continue
        if seg.startswith("*"):
            out.append("(?:/.*)?" if seg.endswith("?") else "/.+")
        elif seg.startswith(":"):
            out.append("(?:/[^/]+)?" if seg.endswith("?") else "/[^/]+")
        else:
            out.append("/" + re.escape(seg.rstrip("?")))
    return re.compile("^" + "".join(out) + "/?$")


def nav_targets(code, extra=()):
    out = []
    raws = [next(g for g in groups if g) for groups in NAV_TARGET_RX.findall(code)] + list(extra)
    for raw in raws:
        t = re.sub(r"\$\{[^}]*\}", ":param", raw)
        t = re.split(r"[?#]", t)[0] or "/"
        if not t.startswith("//") and t not in out:
            out.append(t)
    return out


def transitions(root, screens, files, follow, auto):
    pages = [s for s in screens if s["kind"] != "remix-resource"]
    compiled = [(s, route_regex(s["route"])) for s in pages]
    edges = defaultdict(list)
    unresolved = []
    for s in pages:
        _, _, facts = collect_facts(root, s["file"], files, follow, auto, companions=companion_files(s))
        for f in facts.get("navigation", []):
            for t in f["targets"]:
                hits = [d for d, rx in compiled if rx.match(t)]
                # 静的ルートを動的ルートより優先する
                hits.sort(key=lambda d: (":" in d["route"] or "*" in d["route"], -len(d["route"])))
                if hits:
                    edges[(s["route"], hits[0]["route"])].append(f["location"])
                else:
                    unresolved.append({"from": s["route"], "target": t, "location": f["location"]})
    return pages, edges, unresolved


def node_id(route):
    return "s_" + (re.sub(r"[^A-Za-z0-9]", "_", route.strip("/")) or "root")


def transitions_mermaid(pages, edges):
    lines = ["```mermaid", "flowchart LR"]
    for r in sorted({p["route"] for p in pages}):
        lines.append(f'  {node_id(r)}["{r}"]')
    for (a, b), refs in sorted(edges.items()):
        lines.append(f"  {node_id(a)} -->|{len(refs)}| {node_id(b)}")
    lines.append("```")
    return "\n".join(lines)


# ---------- 出力 ----------

def find_screen(screens, files, key):
    for s in screens:
        if key in (s["route"], s["file"]):
            return s["file"], s
    if key in files:
        return key, None
    return None, None


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        print(__doc__)
        sys.exit(1)
    root = args[0]

    def opt(name, default=None):
        return args[args.index(name) + 1] if name in args else default

    follow = int(opt("--follow", 2))
    as_json = "--json" in args
    files = list(walk(root))
    pkgs = package_roots(root, files)
    screens = file_routes(root, files, pkgs) + config_routes(root, files)
    auto = nuxt_auto_imports(files, pkgs)

    if "--screen" in args:
        key = opt("--screen")
        start, meta = find_screen(screens, files, key)
        if not start:
            print(f"画面が見つからない: {key}。ルート(例 /users/:id)かファイルパスを指定すること。", file=sys.stderr)
            sys.exit(1)
        order, visited, facts = collect_facts(root, start, files, follow, auto, companions=companion_files(meta))
        if as_json:
            print(json.dumps({"screen": meta, "files": [{"file": f, "depth": visited[f]} for f in order],
                              "facts": facts}, ensure_ascii=False, indent=2))
            return
        print(f"# 画面ファクト: {meta['route'] if meta else start}\n")
        print(f"- 画面ファイル: `{start}`")
        if meta:
            print(f"- ルート定義: `{meta['evidence']}`({meta['kind']})")
            for e in meta.get("extras", []):
                print(f"- {e}")
        print(f"\n## 追跡したファイル(--follow {follow})\n")
        for f in order:
            print(f"{'  ' * visited[f]}- `{f}`")
        for kind, _ in FACTS:
            rows = facts.get(kind)
            if not rows:
                continue
            print(f"\n## {FACT_LABEL[kind]} ({len(rows)}件)\n")
            print("| 場所 | 深さ | コード |\n|---|---|---|")
            for r in rows:
                print(f"| `{r['location']}` | {r['depth']} | `{r['code'].replace('|', chr(92) + '|')}` |")
        return

    if "--transitions" in args:
        pages, edges, unresolved = transitions(root, screens, files, follow, auto)
        if as_json:
            print(json.dumps({"edges": [{"from": a, "to": b, "evidence": r} for (a, b), r in sorted(edges.items())],
                              "unresolved": unresolved}, ensure_ascii=False, indent=2))
            return
        print("## 画面遷移図\n")
        print("リテラルの遷移先(router.push / <Link> / redirect 等)を画面ルートに突き合わせたもの。矢印のラベルは参照箇所の数。\n")
        print(transitions_mermaid(pages, edges))
        print("\n## 遷移の根拠(各エッジ最大3件)\n")
        print("| From | To | 件数 | 根拠 |\n|---|---|---|---|")
        for (a, b), refs in sorted(edges.items()):
            print(f"| {a} | {b} | {len(refs)} | {', '.join(f'`{r}`' for r in refs[:3])} |")
        if unresolved:
            print("\n## 画面に対応しない遷移先(外部リンク・API・動的な組み立て・未検出のルート)\n")
            print("| From | 遷移先 | 根拠 |\n|---|---|---|")
            for u in unresolved:
                print(f"| {u['from']} | `{u['target']}` | `{u['location']}` |")
        return

    if as_json:
        print(json.dumps(screens, ensure_ascii=False, indent=2))
        return
    print(f"# 画面一覧 ({len(screens)}件)\n")
    print("| ルート | 種別 | 画面ファイル | 定義 | 備考 |\n|---|---|---|---|---|")
    for s in sorted(screens, key=lambda x: x["route"]):
        note = [s.get("note", "")]
        if s.get("raw") is not None and s.get("raw") != s["route"]:
            note.append(f"定義上の path: `{s['raw']}`")
        if s["kind"] == "config" and s["file"] == s["evidence"].rsplit(":", 1)[0]:
            note.append(f"コンポーネント未解決: `{s.get('component')}`" if s.get("component") else "コンポーネント未検出")
        if s["kind"] == "remix-resource":
            note.append("default export なし(リソースルート/API)")
        note += s.get("extras", [])
        print(f"| `{s['route']}` | {s['kind']} | `{s['file']}` | `{s['evidence']}` | {'<br>'.join(n for n in note if n)} |")


if __name__ == "__main__":
    main()
