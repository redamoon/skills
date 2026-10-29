# フロントエンド: Vue (Nuxt, Vue Router SPA)

画面仕様(画面一覧・画面ごとの表示・操作・状態・遷移)を取るための読み方。Nuxt の `server/` 配下は `typescript-node.md` を併用する。

## 機械的に取れる情報

- **画面一覧**: `python3 scripts/screen_inventory.py <対象>` で取る
  - Nuxt: `pages/**/*.vue`(Nuxt 4 は `app/pages/`)。`[id]` → `:id`、`[...slug]` → `*slug`。`pages/parent.vue` と `pages/parent/` が並ぶ場合は入れ子ルート(親が `<NuxtPage />` を持つ)
  - Vue Router: `createRouter({ routes })` の `routes` 配列。children の相対パスはインデントから親と結合した推定値なので、親子関係はコードで確かめる。`component: () => import(...)` の遅延読み込みも解決する
- **画面ごとの事実**: `--screen <ルート>` で、画面ファイルから import を `--follow` 段たどって集める。Nuxt は自動インポートされるコンポーネント(`components/` 配下、ディレクトリ名を前置した PascalCase 名)と composable(`composables/`・`utils/` の export)も名前から解決してたどる
- **画面遷移**: `--transitions` で `router.push` / `navigateTo` / `<NuxtLink to>` / `<RouterLink to>` のリテラルを画面ルートに突き合わせた図を出す
- **共通部品**: `python3 scripts/shared_logic.py <対象>` で、複数画面から使われる composable・Pinia / Vuex ストア・整形関数の候補を出す(Nuxt の自動インポート経由の利用も数える)。画面仕様に重複して書かず、モジュール仕様にまとめる
- **サーバ側の入口(Nuxt)**: `server/api/**`、`server/routes/**` の `defineEventHandler`。ファイル名の `.get.ts` / `.post.ts` が HTTP メソッド。`grep_entrypoints.py --stack frontend-vue` で拾える
- **データ取得**: `useFetch` / `useLazyFetch` / `useAsyncData` / `$fetch`(Nuxt)、axios、TanStack Query(`useQuery`)、Pinia ストアの action 内の API 呼び出し
- **フォームと入力検証**: `v-model`、VeeValidate(`useForm`、`defineField`、`rules`)、Vuelidate、zod / yup スキーマ、UI ライブラリのフォーム(`el-form` の `rules`、Vuetify の `:rules`)
- **ガード**: `definePageMeta({ middleware })`、`middleware/*.ts`(`*.global.ts` は全画面に適用)、Vue Router の `beforeEach` / `beforeEnter`、ルートの `meta`(`requiresAuth` など)
- **文言**: `<h1>`、`useHead` / `useSeoMeta`、vue-i18n の `$t("key")` / `t("key")` と辞書ファイル(`locales/*.json`)

## 読む順番

1. 画面一覧とレイアウト(`layouts/*.vue`、`app.vue`、`definePageMeta({ layout })`)で枠を掴む
2. グローバルミドルウェア(`middleware/*.global.ts`、`router.beforeEach`)で、全画面にかかる条件を先に把握する
3. 画面ごとに `--screen` を実行し、`<template>` → `<script setup>` → 子コンポーネント → composable / ストアの順に読む
4. フォームはバリデーションスキーマ(rules)を正として入力項目表を作る

## 画面仕様に落とす観点

- **表示項目**: テンプレートの `{{ }}` と props。フィルタ・computed・整形関数(日付・金額)の書式
- **状態(面×状態)**: `v-if` / `v-else-if` / `v-else` の連鎖がそのまま状態の一覧になる。`pending`、`error`、`status`(useFetch の戻り値)、`items.length === 0`、`<Suspense>` の `#fallback` を根拠に、状態ごとに何が見えるかを書く
- **操作**: `@click` / `@submit.prevent` のハンドラ → API → 結果(遷移・通知・`refresh()`)を1行で書く
- **親子間のやり取り**: `defineProps` / `defineEmits` / `v-model`(コンポーネント v-model)。子が emit したイベントで親が API を呼ぶ構成は、処理の起点が子にある
- **URL が持つ状態**: `route.params`、`route.query`(検索条件・ページ番号・タブ)

## 業務ルールが潜みやすい場所

- `v-if` / `:disabled` の条件式(ボタンが押せる・表示される条件)
- `computed` の計算(合計・税・割引)、整形関数
- Pinia ストアの getters / actions
- バリデーションの `rules` とカスタムルール

## 落とし穴

- Nuxt の自動インポートは import 文が無いので `dep_graph.py` の依存図に出ない。画面単位の依存は `screen_inventory.py --screen` の「追跡したファイル」を使う。`nuxt.config` の `components: { dirs }` や `pathPrefix: false` で命名規則が変わっている場合は、解決できない部品を手で開く
- `.nuxt/`(生成物)は読まない。型やルートの確認に使う場合も根拠にはしない
- Options API(`data()` / `methods` / `computed`)と Composition API が混在する。Options API はハンドラが `methods` にまとまっている
- 遷移先を変数で組み立てる(`router.push({ name: 'item', params })`)名前付きルートは遷移図に出ない。`name` からルート定義を引いて手で補う(点線)
- SSR とクライアントで実行場所が違う(`process.client`、`onMounted` 内のみの処理、`<ClientOnly>`)。データ取得がどちらで走るかを仕様に明記する
