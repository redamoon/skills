# Perl (CGI, Mojolicious, Dancer2, Catalyst, Movable Type)

## 機械的に取れる情報

- **ルート**
  - Mojolicious: `startup` 内の `$r->get('/path')->to('controller#action')`。`under` でグループ化。アプリを起動できるなら `./script/app routes -v` が最も確実
  - Dancer2: `get '/path' => sub { ... }`、`prefix`
  - Catalyst: コントローラのメソッド属性 `:Path`、`:Local`、`:Chained`。起動ログ(デバッグモード)にルート表が出る
  - 素の CGI / PSGI: `.cgi` / `.psgi` ファイル1つが1エントリポイント。中で `param('mode')` などの値で処理を振り分けていることが多いので、その分岐を一覧化する
- **Movable Type プラグイン**: `config.yaml` が仕様の目次になる
  - `applications`(管理画面の画面・モード)、`callbacks`(保存前後などのフック)、`tags`(テンプレートタグ)、`tasks` / `task_workers`(定期処理・ジョブ)、`list_actions` / `page_actions`
  - 値の `$PluginID::Package::sub` がハンドラの実体。ここから `.pm` へたどる
  - `config.yaml` を使わない古いプラグインは `plugins/*/*.pl` の `MT::Plugin->new({ registry => ... })` を読む
- **データモデル**: DBIx::Class の `Result` クラス(`__PACKAGE__->add_columns`)、Teng / DBIx::Skinny のスキーマ、MT は `MT::Object` 継承クラスの `install_properties`(`column_defs`)、生の DDL
- **依存**: `cpanfile`、`Makefile.PL`、`Build.PL`。無い場合は `use` 文から推定(`dep_graph.py`)
- **設定**: `%ENV`、`*.conf`、`mt-config.cgi`、Mojolicious の `plugin('Config')`

## 読む順番

1. 起動点の特定(`.cgi` / `.psgi` / `script/*` / `config.yaml`)
2. ルーティングまたはモード分岐 → ハンドラ(sub) → モデル
3. MT プラグインは `config.yaml` → 各ハンドラ → `MT::Object` 派生クラス

## 業務ルールが潜みやすい場所

- `if` / `unless` の連鎖、ハッシュによるディスパッチテーブル(`my %dispatch = (mode => \&handler)`)
- 正規表現による入力検証(`=~ /^\d{7}$/` など)はバリデーション仕様そのもの
- `sprintf('%.0f', ...)`、`int()` による丸め(`int` は切り捨て、`%.0f` は偶数丸めになりうる)
- MT のコールバック(`cms_pre_save.*`、`cms_post_save.*`)は保存処理に暗黙に割り込む

## 落とし穴

- 文字列で関数名を組み立てる呼び出し(`$class->$method`、`&{"..."}`、`can()`)は grep で追えない。MT のレジストリ参照も文字列なので、`dep_graph.py` の依存図には出ない → `config.yaml` を根拠に点線で補う
- 1ファイルに複数 `package` が書かれることがある。ファイル名とパッケージ名が一致しない前提で読む
- `local $_`、グローバル変数(`our`、`$main::`)で状態が受け渡されている場合は、処理フローに明記する
- 文字コード: `use utf8` の有無、`Encode::decode` の位置で文字列の扱いが変わる。古いコードは EUC-JP / Shift_JIS のこともある
- `t/` のテスト(`.t`)は仕様の裏付けとして読む(エントリポイント抽出からは除外している)
