# TypeScript / Node.js (Express, NestJS, Next.js, Fastify, Hono)

## 機械的に取れる情報

- **ルート**: NestJS は `@Controller` + `@Get` 等。Express/Fastify/Hono は `app.get(...)`、`router.post(...)`。Next.js App Router は `app/**/route.ts` の `export function GET`、Pages Router は `pages/api/**`
- **GraphQL**: NestJS の `@Resolver` + `@Query` / `@Mutation`、Apollo / graphql-yoga のリゾルバマップ(`Query: { ... }`)、スキーマファイル(`*.graphql`、code-first なら生成された `schema.gql`)。スキーマ全体が API 仕様の骨格になる
- **OpenAPI**: `@nestjs/swagger` があればアプリ起動して `/api-json` 等から取得。`zod-to-openapi`、`tsoa` も確認
- **データモデル**: Prisma `schema.prisma`、TypeORM `@Entity`、Drizzle `pgTable(...)`、Sequelize `define`、マイグレーションディレクトリ
- **入力検証**: `class-validator` デコレータ、zod スキーマ、DTO クラス
- **ジョブ/イベント**: `@Cron`、BullMQ `Worker`/`@Process`、`@EventPattern`、`@OnEvent`
- **設定**: `process.env.*`、`ConfigService.get(...)`、`.env.example`
- **型**: `tsc --noEmit` が通るなら型情報は信頼できる。型定義(`types/`、`*.d.ts`)は仕様の骨格になる

## 読む順番

1. `package.json` の scripts(起動・ビルド・ジョブ実行コマンド)
2. ルート定義 → コントローラ/ハンドラ → サービス → リポジトリ
3. DTO・zod スキーマで入力仕様を確定

## 業務ルールが潜みやすい場所

- サービス層、`domain/`、`usecases/`
- zod の `.refine()`、`class-validator` のカスタムバリデータ
- Guard / Middleware / Interceptor(認可・共通処理)

## 落とし穴

- DIコンテナ経由の差し替え(NestJS の `useClass` / `useFactory`)で実装が別ファイルにある
- フロントエンド(React等)とバックエンドが同居するモノレポでは、`apps/`、`packages/` ごとにサブシステムとして分ける。画面側は `frontend-react.md` / `frontend-vue.md` を読む
- `any` が多いコードでは型を根拠にしない
