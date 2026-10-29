# PHP (Laravel、その他)

## 機械的に取れる情報

- **ルート**: `php artisan route:list --json` が最も確実。実行できない場合は `routes/*.php`
- **データモデル**: `database/migrations/`、Eloquent モデルの `$fillable`、`$casts`、リレーション
- **入力検証**: FormRequest の `rules()`、コントローラ内の `$request->validate(...)`
- **ジョブ**: `app/Jobs/`(`ShouldQueue`)、`app/Console/Kernel.php` または `routes/console.php` のスケジュール、`app/Console/Commands/`
- **イベント**: `app/Events/`、`app/Listeners/`、`EventServiceProvider`
- **設定**: `config/*.php`、`env(...)`

Laravel 以外(素の PHP、CakePHP、Symfony、Movable Type 等の CMS)は、フロントコントローラ(`index.php`)のディスパッチ処理か、フレームワークのルーティング定義から入る。Symfony は `bin/console debug:router`。

## 読む順番

1. ルート一覧 → コントローラ → サービス / モデル
2. FormRequest で入力仕様を確定
3. マイグレーションを時系列で読み、最終的なスキーマを確定

## 業務ルールが潜みやすい場所

- モデルのアクセサ / ミューテタ、Observer
- Policy / Gate(認可)
- `bcmath` や `round()` を使う計算処理

## 落とし穴

- Facade 経由の呼び出しは実体が `ServiceProvider` の bind 先にある
- Middleware(`app/Http/Kernel.php` または `bootstrap/app.php`)で認可・共通処理
