# Ruby on Rails

## 機械的に取れる情報

- **ルート**: `bin/rails routes` が最も確実(`--expanded` で詳細)。実行できない場合は `config/routes.rb` を読む
- **データモデル**: `db/schema.rb` または `db/structure.sql` が現状のスキーマ。`app/models/` の関連(`has_many` 等)とバリデーション
- **入力**: Strong Parameters(`params.require(...).permit(...)`)
- **ジョブ**: `app/jobs/`(ActiveJob)、Sidekiq Worker、`config/schedule.rb`(whenever)、`sidekiq-cron` 設定
- **設定**: `config/`、`credentials`、`ENV[...]`

## 読む順番

1. `rails routes` → コントローラ → モデル / サービスオブジェクト
2. `schema.rb` で全テーブルを把握
3. モデルのコールバックとバリデーションを確認

## 業務ルールが潜みやすい場所

- モデルの `validates`、コールバック(`before_save`、`after_commit` 等)
- `app/services/`、`app/interactors/`、Concern
- `enum` 定義(ステータス値)

## 落とし穴

- コールバックとConcernで処理が暗黙に連鎖する。モデルの `include` を必ず追う
- メタプログラミング(`define_method`、`method_missing`)はgrepで見つからない
- `before_action` で認可が入る。親コントローラ(`ApplicationController`)も確認する
