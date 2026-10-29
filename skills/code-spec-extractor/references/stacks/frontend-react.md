# フロントエンド: React (Next.js, Remix / React Router, Vite SPA)

画面仕様(画面一覧・画面ごとの表示・操作・状態・遷移)を取るための読み方。API ルートやサーバ処理は `typescript-node.md` を併用する。

## 機械的に取れる情報

- **画面一覧**: `python3 scripts/screen_inventory.py <対象>` で取る
  - Next.js App Router: `app/**/page.tsx`。`(group)` と `@slot` は URL に出ない。`[id]` → `:id`、`[...slug]` → `*slug`
  - Next.js Pages Router: `pages/**`(`pages/api/` と `_app` / `_document` は画面ではない)
  - Remix / React Router v7(ファイルルート): `app/routes/*.tsx`。`.` が `/`、`$id` が `:id`、`_` 始まりはパスなしレイアウト。default export の無いファイルはリソースルート(API)
  - 設定ベース: `createBrowserRouter([...])`、`<Routes><Route path=...>`、`useRoutes`、TanStack Router の `createFileRoute('/path')`。children の相対パスはインデントから親と結合した推定値なので、親子関係はコードで確かめる
  - React Router v7 で `app/routes.ts` がある場合は設定ベース(`route("path", "file")`)。スクリプトで拾えないときは手で一覧化する
- **画面ごとの事実**: `--screen <ルート>` で、画面ファイルから import を `--follow` 段たどって API 呼び出し・フォーム・バリデーション・イベントハンドラ・遷移・表示分岐・状態管理・見出しを集める
- **画面遷移**: `--transitions` で `router.push` / `navigate` / `<Link href>` / `redirect` のリテラルを画面ルートに突き合わせた図を出す
- **状態の手がかり(Next.js App Router)**: 同じ階層や祖先の `loading.tsx`(読み込み中)、`error.tsx`(エラー)、`not-found.tsx`(該当なし)、`layout.tsx`(共通枠)。画面一覧の備考に出る
- **データ取得**: `fetch`、axios、TanStack Query(`useQuery` / `useMutation`)、SWR、tRPC、GraphQL(`gql`)、Server Components の `async` 関数内 fetch、Server Actions(`"use server"`)、Remix の `loader` / `action`、Pages Router の `getServerSideProps`
- **フォームと入力検証**: React Hook Form(`register("name")`、`resolver: zodResolver(schema)`)、Formik、zod / yup / valibot スキーマ、HTML 属性(`required`、`maxLength`、`pattern`)
- **文言**: `<h1>`、`metadata` / `generateMetadata`(タイトル)、i18n の `t("key")` と辞書ファイル(`locales/**/*.json`、`messages/*.json`)

## 読む順番

1. 画面一覧(`screen_inventory.py`)とレイアウト(`layout.tsx`、ルートの親要素)で、画面の枠と共通ナビゲーションを掴む
2. 画面ごとに `--screen` を実行し、出てきたファイルを深さ0→1→2の順に読む
3. データ取得の関数から API のパス・メソッド・パラメータを確定し、バックエンドの仕様(あれば)と突き合わせる
4. フォームはスキーマ(zod 等)を正として入力項目表を作る。JSX 側の `required` などと食い違えば未確認事項へ

## 画面仕様に落とす観点

- **表示項目**: どのデータのどのフィールドを、どの書式(日付・金額・丸め)で出しているか。`toLocaleString`、`Intl.NumberFormat`、`date-fns` の format 文字列は仕様そのもの
- **状態(面×状態)**: 読み込み中・空・エラー・成功・権限なし。`isLoading` / `isPending`、`data.length === 0`、`error &&`、`<Suspense fallback>`、`ErrorBoundary`、`loading.tsx` を根拠に、状態ごとに何が見えるかを書く
- **操作**: ボタン・リンクごとに「ハンドラ → API → 結果(遷移・トースト・再取得)」を1行で書く。`onClick` / `onSubmit` から追う
- **権限・ガード**: `middleware.ts`(Next.js)、レイアウトでのセッション確認、`<RequireAuth>` 等のラッパー、ロールによる表示出し分け
- **URL が持つ状態**: パスパラメータ、`useSearchParams` のクエリ(検索条件・ページ番号・タブ)

## 業務ルールが潜みやすい場所

- 表示の出し分け条件(`status === "approved" && <Button>`)。ボタンが押せる条件は業務ルールそのもの
- zod の `.refine()` / `.superRefine()`、カスタムバリデータ
- 金額・日付の整形関数(`utils/format.ts` など)、定数ファイル(`constants.ts`)
- カスタムフック(`useXxx`)。画面の振る舞いがフックに寄せられていることが多い

## 落とし穴

- Server Component と Client Component(`"use client"`)で実行場所が違う。データ取得がサーバ側かブラウザ側かを仕様に明記する
- 遷移先を変数で組み立てる(`router.push(path)`)と遷移図に出ない。`--transitions` の「画面に対応しない遷移先」と、`--screen` の画面遷移欄を読んで補う(推測の遷移は点線)
- `next.config.js` の `rewrites` / `redirects`、`middleware.ts` のリダイレクトは画面一覧に出ない経路を作る
- tsconfig の `paths` が `@/` 以外の別名を定義していると import を追えない。追跡したファイル一覧に出てこない部品は手で開く
- 共通コンポーネント(`components/ui/`)の中身まで読み込むと事実が膨らむ。画面固有の部品を優先し、`--follow` を 1〜2 に保つ
- Storybook(`*.stories.tsx`)は画面仕様の裏付けに使える(状態のバリエーションが列挙されている)。エントリポイント抽出からは除外している
