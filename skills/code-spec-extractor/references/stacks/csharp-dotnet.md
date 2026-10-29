# C# / .NET (ASP.NET Core、デスクトップ)

## 機械的に取れる情報

- **ルート**: Controller の `[Route]` ＋ `[HttpGet]` 等、Minimal API の `app.MapGet(...)`
- **OpenAPI**: Swashbuckle / NSwag があれば起動して `/swagger/v1/swagger.json`
- **データモデル**: EF Core の `DbContext` と `DbSet<T>`、`Migrations/` の `ModelSnapshot`(最新スキーマ)、Fluent API(`OnModelCreating`)
- **入力検証**: DataAnnotations(`[Required]`、`[Range]`)、FluentValidation
- **ジョブ**: `BackgroundService`、Hangfire、Quartz.NET、Azure Functions のトリガー
- **設定**: `appsettings*.json`、`IOptions<T>`
- **デスクトップ(WPF/WinForms/MAUI)**: 画面(View)とイベントハンドラ / ViewModel のコマンドがエントリポイント
  - 画面一覧: WinForms は `: Form` を継承するクラス(`*.Designer.cs` に部品配置)、WPF は `.xaml` のルート要素(`<Window>` / `<Page>` / `<UserControl>`)。`grep -rn ": Form\b" --include=*.cs`、`grep -rln "<Window" --include=*.xaml` で列挙する
  - 画面遷移: `new XxxForm().Show()` / `ShowDialog()`、`NavigationService.Navigate(...)`、`Frame.Navigate(...)`
- **プロジェクト構成(共有 DLL)**: `python3 scripts/shared_logic.py <対象> --projects` で `.csproj` / `.vbproj` の `ProjectReference` から参照図を作る。`OutputType`(`WinExe` / `Exe` / `Library`)と `UseWindowsForms` / `UseWPF` も出る。2つ以上から参照される Library が共有 DLL

## 読む順番

1. `Program.cs` / `Startup.cs`(DI 登録、ミドルウェア、ルート)
2. Controller → Service → Repository / DbContext
3. `ModelSnapshot` で最終スキーマ確認

## 業務ルールが潜みやすい場所

- ドメインモデル、Service 層
- FluentValidation のルール
- `decimal` と `Math.Round(…, MidpointRounding.…)` の指定(既定は銀行丸め)

## 落とし穴

- `MidpointRounding` を省略した `Math.Round` は偶数丸め。業務上の四捨五入と食い違っていないか記録する
- Filter(`IActionFilter`、`IAuthorizationFilter`)で共通処理が入る
- 部分クラス(`partial`)とソースジェネレータで定義が分散する
- 参照が `ProjectReference` ではなく `<Reference Include="...">` + `HintPath`(ビルド済み DLL の直接参照)の場合、ソースが別リポジトリにあることが多い。参照図には出ないので、DLL 名を未確認事項に積む
- `using` は名前空間単位なので、`shared_logic.py` の共通部品はディレクトリ(名前空間)単位で出る
