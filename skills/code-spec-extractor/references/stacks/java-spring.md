# Java / Kotlin (Spring Boot)

## 機械的に取れる情報

- **ルート**: `@RestController` / `@Controller` クラスの `@RequestMapping`(クラス側)＋ `@GetMapping` 等(メソッド側)を連結したものが実パス
- **OpenAPI**: `springdoc-openapi` があれば起動して `/v3/api-docs`
- **ルート一覧**: Actuator の `/actuator/mappings` が有効なら最も確実
- **データモデル**: JPA `@Entity`、MyBatis の Mapper XML、Flyway / Liquibase マイグレーション
- **入力検証**: Bean Validation(`@NotNull`、`@Size`、`@Pattern`)、カスタム `ConstraintValidator`
- **ジョブ/イベント**: `@Scheduled`、Spring Batch の `Job`/`Step`、`@KafkaListener`、`@RabbitListener`、`@EventListener`
- **設定**: `application*.yml` / `.properties`、`@Value`、`@ConfigurationProperties`、プロファイル別設定

## 読む順番

1. Controller → Service → Repository / Mapper
2. Entity と DTO で入出力を確定
3. `@Transactional` の位置でトランザクション境界を記録

## 業務ルールが潜みやすい場所

- Service 層、ドメインオブジェクトのメソッド
- MyBatis の XML 内の動的 SQL(`<if>`、`<choose>`)
- `BigDecimal` の `setScale` / `RoundingMode`

## 落とし穴

- AOP(`@Aspect`)、`Filter`、`HandlerInterceptor` で認可や共通処理が差し込まれている
- プロファイル(`@Profile`)で実装が切り替わる。本番プロファイルを確認する
- Lombok で getter/setter 等が生成されるため、ソース上に見えないメソッドがある
