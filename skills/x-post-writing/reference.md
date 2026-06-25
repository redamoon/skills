# x-algorithm リファレンス

出典: [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)（Apache-2.0）

## システム構成

| コンポーネント | 役割 | 文案への示唆 |
|--------------|------|-------------|
| **Thunder** | フォロー中アカウントの投稿（In-Network） | 既存フォロワー向け。フォロー関係の維持・返信が重要 |
| **Phoenix Retrieval** | Two-Tower 類似検索（Out-of-Network） | 新規リーチ。テーマの明確さ・エンゲージメント履歴との意味的類似が鍵 |
| **Phoenix Ranking** | Grok Transformer による engagement 予測 | 単一スコアではなく複数アクションの加重和 |
| **Home Mixer** | パイプライン統合・広告ブレンド | フィード内競合。冒頭のフック力が重要 |
| **Grox** | スパム検知・カテゴリ分類・ポリシー | スパム的・攻撃的・規約違反コンテンツは Post-Selection で除外 |

## パイプライン段階

1. Query Hydration — ユーザーのエンゲージメント履歴・フォロー・トピック
2. Candidate Sourcing — Thunder + Phoenix
3. Candidate Hydration — 本文・著者・メディア・言語・相互フォロー等
4. Pre-Scoring Filters — 重複・古さ・ミュートキーワード等
5. Scoring — Phoenix → Weighted → Author Diversity → OON
6. Selection — Top K
7. Post-Selection — VFFilter（spam/violence/gore 等）

## 予測されるアクション（Phoenix Scorer）

```
Positive（weight > 0 と推定）:
  P(favorite), P(reply), P(repost), P(quote), P(click),
  P(profile_click), P(video_view), P(photo_expand),
  P(share), P(dwell), P(follow_author)

Negative（weight < 0 と推定）:
  P(not_interested), P(block_author), P(mute_author), P(report)
```

Final Score = Σ (weight_i × P(action_i))

## 主要フィルタと文案への影響

| フィルタ | 影響 |
|---------|------|
| AgeFilter | 古い投稿は For You から落ちやすい → タイムリーな投稿 |
| PreviouslySeenPostsFilter | 既読は再表示されにくい → 新規切り口・スレッド続編 |
| AuthorSocialgraphFilter | ブロック/ミュートされた著者は表示されない |
| MutedKeywordFilter | ユーザーがミュートした語句を含むと除外 |
| VFFilter | スパム・暴力・ゴア等は除外 → 攻撃的・スパム的表現を避ける |
| Author Diversity Scorer | 同一著者の連続表示を減衰 → 連投より質の高い単発 |
| DedupConversationFilter | 同一スレッドの重複枝を整理 → 議論は1本のスレッドに集約 |

## 設計上の重要決定

### 手作り特徴量なし

「いいね率が高いキーワード」などのルールベース最適化は効きにくい。読者の**実際の行動履歴**に近いコンテンツが選ばれる。

### Candidate Isolation

各投稿のスコアは他の候補に依存しない。バッチ内の競合より、**その投稿単体の engagement 予測**が重要。

### Multi-Action Prediction

「バズる」= いいねだけ、ではない。reply + repost + dwell の組み合わせが総合スコアを押し上げる。

## Out-of-Network（OON）リーチの考え方

Phoenix Retrieval は User Tower（エンゲージメント履歴）と Candidate Tower（投稿 embedding）の類似度で候補を取得。

文案で意識すること:

- **テーマの一貫性** — 特定分野のエンゲージメント履歴を持つユーザーに届きやすい
- **明確な主張** — embedding がぼやけない
- **メディア付き** — video_view / photo_expand が加点されうる
- **相互フォロー・トピック** — Query Hydrator でトピック・starter packs 等が使われる

## 更新情報（2026-05-15 リリース）

- end-to-end inference pipeline（retrieval → ranking）
- Grox: spam / post-category / PTOS
- Ads blending（brand safety）
- Phoenix MoE, topics, prompts 等の新候補ソース

## 免責

本リファレンスは公開 README に基づく**執筆上のヒューリスティック**である。重み係数・閾値・本番設定は非公開。アルゴリズム変更の可能性あり。
