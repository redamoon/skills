# Python (Django, FastAPI, Flask)

## 機械的に取れる情報

- **ルート**: Django `urls.py` の `path()`、DRF の `router.register`。FastAPI/Flask は `@app.get`、`@router.post`、`@bp.route`
- **OpenAPI**: FastAPI はアプリを import して `app.openapi()` を JSON 出力するのが最も確実。DRF は `drf-spectacular` があれば `manage.py spectacular`
- **ルート一覧**: Django は `django-extensions` があれば `manage.py show_urls`
- **データモデル**: Django `models.py`、SQLAlchemy `Base` 継承クラス、Alembic / Django マイグレーション
- **入力検証**: Pydantic モデル、DRF Serializer、Django Form
- **ジョブ**: Celery `@shared_task`、beat スケジュール、`management/commands/`
- **設定**: `settings.py`、`os.environ`、Pydantic `BaseSettings`

## 読む順番

1. `urls.py` / ルーター → ビュー / エンドポイント関数
2. Serializer / Pydantic モデルで入出力を確定
3. サービス・モデルメソッドへ

## 業務ルールが潜みやすい場所

- Django モデルの `save()` オーバーライド、`clean()`、シグナル(`post_save` 等)
- Serializer の `validate_*`
- `Decimal` の丸め(`quantize`)、日付計算(`relativedelta`)

## 落とし穴

- シグナルやミドルウェアで暗黙に処理が走る。`signals.py`、`apps.py` の `ready()` を必ず見る
- 動的型付けのため、型ヒントがない関数は呼び出し元から型を推定する(推測扱い)
