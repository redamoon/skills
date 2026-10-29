# Go (net/http, chi, gin, echo, gRPC)

## 機械的に取れる情報

- **ルート**: `mux.HandleFunc`、`r.Get(...)`(chi)、`r.GET(...)`(gin/echo)。グループ(`r.Route`、`r.Group`)のプレフィックスを連結する
- **gRPC**: `.proto` ファイルがそのまま API 仕様。`service` と `rpc` を一覧化する
- **OpenAPI**: `swag`(コメントアノテーション)や oapi-codegen の元定義があれば優先
- **データモデル**: struct タグ(`db:`、`gorm:`、`json:`)、sqlc の `query.sql` と `schema.sql`、マイグレーション(golang-migrate 等)
- **ジョブ**: `cobra.Command`、`cmd/` 配下の各 main、cron ライブラリ
- **設定**: `os.Getenv`、envconfig / viper の struct

## 読む順番

1. `cmd/*/main.go`(何個のバイナリがあるか＝サブシステムの数)
2. ルーター初期化 → ハンドラ → usecase/service → repository
3. `go doc` や `gopls` のシンボル一覧で公開 API を確認

## 業務ルールが潜みやすい場所

- `internal/domain`、`usecase` 層
- エラー値の定義(`var ErrXxx = errors.New(...)`)はエラー仕様の一覧になる

## 落とし穴

- インターフェース経由で実装が差し替わる。`wire` や手書きの DI 初期化コードで実体を特定する
- エラーを握りつぶす箇所(`_ =`)は仕様上の挙動に影響するので記録する
