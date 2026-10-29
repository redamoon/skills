#!/usr/bin/env python3
"""エントリポイント候補(ルート、ジョブ、イベントハンドラ等)を正規表現で拾い、file:line 付きで出力する。

使い方: python3 grep_entrypoints.py <対象ディレクトリ> [--stack <名前>[,<名前>]] [--json]
--stack を省略すると全パターンで探す。結果は「候補」であり、必ず実コードで確認すること。
フレームワーク公式のルート一覧コマンドが使えるなら、そちらを優先する。
"""
import json
import os
import re
import sys

SKIP_DIRS = {
    ".git", "node_modules", "vendor", "dist", "build", "target", "obj",
    ".venv", "venv", "__pycache__", ".next", ".nuxt", ".output", "coverage",
}

# スタック → [(種別, 対象拡張子, 正規表現)]
PATTERNS = {
    "typescript-node": [
        ("http", (".ts", ".js", ".mjs"), r"\b(?:app|router|server|r)\.(get|post|put|patch|delete|all)\(\s*['\"`]([^'\"`]+)"),
        ("http", (".ts",), r"@(Get|Post|Put|Patch|Delete|All)\(\s*['\"]?([^'\")]*)"),
        ("http", (".ts",), r"@Controller\(\s*['\"]?([^'\")]*)"),
        ("http", (".ts", ".tsx", ".js"), r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b"),
        ("job", (".ts", ".js"), r"@(Cron|Interval|Process|EventPattern|MessagePattern|OnEvent)\("),
        ("job", (".ts", ".js"), r"\b(?:cron\.schedule|new\s+Worker|\.process)\("),
    ],
    "python": [
        ("http", (".py",), r"@(?:app|router|bp|blueprint)\.(get|post|put|patch|delete|route)\(\s*['\"]([^'\"]+)"),
        ("http", (".py",), r"\b(?:re_)?path\(\s*r?['\"]([^'\"]*)"),
        ("job", (".py",), r"@(?:shared_task|app\.task|celery\.task|periodic_task)"),
        ("cli", (".py",), r"class\s+Command\(BaseCommand\)|@click\.command|@app\.command"),
    ],
    "java-spring": [
        ("http", (".java", ".kt"), r"@(Get|Post|Put|Patch|Delete|Request)Mapping\(?([^)]*)"),
        ("job", (".java", ".kt"), r"@(Scheduled|KafkaListener|RabbitListener|JmsListener|SqsListener|EventListener)\b"),
    ],
    "go": [
        ("http", (".go",), r"\.(GET|POST|PUT|PATCH|DELETE|Handle|HandleFunc|Get|Post|Put|Patch|Delete)\(\s*\"([^\"]+)"),
        ("cli", (".go",), r"&cobra\.Command\{"),
    ],
    "ruby-rails": [
        ("http", (".rb",), r"^\s*(get|post|put|patch|delete|resources?|namespace|scope)\s+[:'\"]([^'\",\s]+)"),
        ("job", (".rb",), r"class\s+\w+\s*<\s*(ApplicationJob|ActiveJob::Base)|include\s+Sidekiq::(Worker|Job)"),
    ],
    "php-laravel": [
        ("http", (".php",), r"Route::(get|post|put|patch|delete|any|match|resource|apiResource)\(\s*['\"]([^'\"]+)"),
        ("job", (".php",), r"implements\s+ShouldQueue|->(?:daily|hourly|cron|everyMinute)\("),
        ("cli", (".php",), r"protected\s+\$signature\s*=\s*['\"]([^'\"]+)"),
    ],
    "csharp-dotnet": [
        ("http", (".cs",), r"\[(Http(Get|Post|Put|Patch|Delete)|Route)\(?\"?([^\")\]]*)"),
        ("http", (".cs",), r"\.Map(Get|Post|Put|Patch|Delete)\(\s*\"([^\"]+)"),
        ("job", (".cs",), r":\s*(BackgroundService|IHostedService|IJob)\b|RecurringJob\.AddOrUpdate"),
    ],
    "perl": [
        # Mojolicious: $r->get('/path')->to(...) / Dancer2: get '/path' => sub
        ("http", (".pm", ".pl"), r"->(get|post|put|patch|delete|any|under|route)\(\s*['\"]([^'\"]+)"),
        ("http", (".pm", ".pl"), r"^\s*(get|post|put|patch|del|any|prefix)\s+['\"]([^'\"]+)['\"]\s*=>"),
        # Catalyst: sub foo :Path('...') / :Local / :Chained / :Global
        ("http", (".pm",), r"^\s*sub\s+(\w+)\s*:\s*(Path|Local|Global|Chained|Regex|LocalRegex)\b"),
        # CGI / PSGI の直接実行ファイル
        ("http", (".cgi", ".psgi", ".fcgi"), r"^#!.*perl|\bbuilder\s*\{|\bmy\s+\$app\s*="),
        # Movable Type プラグイン: config.yaml の methods / callbacks / tasks / tags / applications
        ("mt", (".yaml", ".yml"), r"^\s*(applications|methods|callbacks|tasks|task_workers|tags|block|function|modifier|list_actions|page_actions|content_actions|api_post_save|init_app)\s*:"),
        ("mt", (".pm", ".pl"), r"MT->add_callback\(|->add_callback\(|registry\s*\(|sub\s+init_registry\b"),
        # ジョブ・CLI
        ("job", (".pm", ".pl"), r"TheSchwartz::Worker|Minion\b.*add_task|->add_task\(|Proclet|Schedule::Cron"),
        # 拡張子なしの実行スクリプトは bin/ ・ script/ 配下だけを見る(NO_EXT_DIRS)
        ("cli", (".pl", ""), r"^#!.*perl"),
    ],
    # 画面そのものは screen_inventory.py で列挙する。ここではサーバ側の入口だけを拾う
    "frontend-react": [
        ("http", (".ts", ".tsx", ".js", ".jsx"), r"^\s*['\"]use server['\"]"),
        ("http", (".ts", ".tsx", ".js", ".jsx"), r"export\s+(?:async\s+)?(?:function|const)\s+(loader|action)\b"),
        ("http", (".ts", ".tsx", ".js", ".jsx"), r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b"),
        ("http", (".ts", ".tsx", ".js", ".jsx"), r"export\s+(?:async\s+)?function\s+(getServerSideProps|getStaticProps)\b"),
    ],
    "frontend-vue": [
        ("http", (".ts", ".js"), r"\bdefine(?:Cached)?EventHandler\("),
        ("job", (".ts", ".js"), r"\bdefineTask\(|\bdefineNitroPlugin\("),
    ],
}

NO_EXT_DIRS = re.compile(r"(^|/)(bin|script|scripts)/[^/.]+$")
TEST_HINT = re.compile(r"(^|/)(tests?|t|spec|__tests__)(/|$)|(_test|\.test|\.spec|Test|Tests)\.\w+$|\.t$")


def iter_files(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
        for f in files:
            yield os.path.join(d, f)


def ext_match(rel, exts):
    if os.path.splitext(rel)[1]:
        return rel.endswith(tuple(e for e in exts if e))
    return "" in exts and bool(NO_EXT_DIRS.search(rel))


def scan(root, stacks):
    compiled = []
    for s in stacks:
        for kind, exts, pat in PATTERNS.get(s, []):
            compiled.append((s, kind, exts, re.compile(pat)))
    results = []
    for path in iter_files(root):
        rel = os.path.relpath(path, root)
        if TEST_HINT.search(rel.replace(os.sep, "/")):
            continue
        relp = rel.replace(os.sep, "/")
        targets = [c for c in compiled if ext_match(relp, c[2])]
        if not targets:
            continue
        try:
            with open(path, encoding="utf-8", errors="ignore") as fh:
                for no, line in enumerate(fh, 1):
                    for stack, kind, _, rx in targets:
                        hits = list(rx.finditer(line))
                        if not hits:
                            continue
                        # 1行に複数ルートがある場合(Mojolicious のチェーン等)は一致ごとに出す
                        for m in hits:
                            code = line.strip() if len(hits) == 1 else m.group(0).strip()
                            results.append({"kind": kind, "stack": stack, "location": f"{rel}:{no}", "code": code[:160]})
                        break
        except OSError:
            pass
    return results


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    root = sys.argv[1]
    stacks = list(PATTERNS)
    if "--stack" in sys.argv:
        i = sys.argv.index("--stack")
        stacks = [s.strip() for s in sys.argv[i + 1].split(",")]
        unknown = [s for s in stacks if s not in PATTERNS]
        if unknown:
            print(f"未対応のスタック: {unknown}。references/stacks/_generic.md の手順で手動抽出すること。", file=sys.stderr)
            stacks = [s for s in stacks if s in PATTERNS]
    res = scan(root, stacks)
    if "--json" in sys.argv:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return
    print(f"# エントリポイント候補 ({len(res)}件)\n")
    print("| 種別 | 場所 | コード |\n|---|---|---|")
    for r in res:
        code = r["code"].replace("|", "\\|")
        print(f"| {r['kind']} | `{r['location']}` | `{code}` |")


if __name__ == "__main__":
    main()
