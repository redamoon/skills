# フロントエンド: Svelte (SvelteKit) / Angular

画面仕様を取るための読み方。手順と観点は `frontend-react.md` / `frontend-vue.md` と共通なので、ここでは差分だけを書く。SvelteKit のサーバ側(`+server.ts`、`+page.server.ts`)は `typescript-node.md` を併用する。

## 機械的に取れる情報

- **画面一覧**: `python3 scripts/screen_inventory.py <対象>`
  - SvelteKit: `src/routes/**/+page.svelte`。`[id]` → `:id`、`[[lang]]` → `:lang?`、`[...rest]` → `*rest`、`(group)` は URL に出ない。同じ階層の `+page.ts` / `+page.server.ts`(load)は画面のファクトに含めてたどる。祖先の `+layout.svelte` / `+error.svelte` は備考に出る
  - Angular: `Routes` 配列(`provideRouter(routes)` / `RouterModule.forRoot`)。`component:` と `loadComponent: () => import(...)` を解決する。コンポーネントの `templateUrl` の HTML もたどる
- **画面ごとの事実**: `--screen <ルート>`。拾う構文
  - Svelte: `{#if}` / `{:else}` / `{#each}` / `{#await}`(状態分岐)、`bind:value`(入力)、`on:click` / `onclick={...}`(操作)、`goto(...)`(遷移)、`$:` / `$derived`(派生値)、`writable` / `derived` ストア
  - Angular: `*ngIf` / `*ngFor` / `@if` / `@for` / `@defer`(状態分岐)、`[(ngModel)]` / `formControlName`(入力)、`(click)` / `(ngSubmit)`(操作)、`routerLink` / `router.navigate([...])`(遷移)、`this.http.get(...)`(API)
- **サーバ側の入口(SvelteKit)**: `+server.ts` の `GET` / `POST`、`+page.server.ts` の `load` / `actions`、`hooks.server.ts` の `handle`。`grep_entrypoints.py --stack frontend-svelte-angular` で拾える
- **共通部品**: `python3 scripts/shared_logic.py <対象>`。Svelte のストア(`src/lib/stores/`)、Angular のサービス(`@Injectable`)が候補に出る

## 業務ルールが潜みやすい場所

- Svelte: `$:` のリアクティブ文、`derived` ストア、`+page.server.ts` の `actions`(フォーム送信の処理本体)
- Angular: サービスクラス、`Validators` と カスタムバリデータ、`pipe`(表示整形)、Guard(`canActivate`)と Resolver

## 落とし穴

- SvelteKit の `load` はサーバとブラウザのどちらで動くかがファイル名で決まる(`+page.server.ts` はサーバのみ)。仕様に明記する
- SvelteKit のフォームは `actions` + `use:enhance` で JS なしでも動く。送信先は `action="?/name"` で、`goto` には出ない
- Angular の DI(`providers`、`providedIn`)で実装が差し替わる。モジュール単位の `providers` を確認する
- Angular の `routerLink` に配列(`[routerLink]="['/orders', id]"`)を渡すと遷移図に出ない。読んで点線で補う
