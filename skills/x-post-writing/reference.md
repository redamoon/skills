# x-algorithm リファレンス

出典: [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)（Apache-2.0）

重みの数値は `home-mixer/params/param.rs` のデフォルト（コメント上の最終同期 2026-08-12）。本番は feature switch で上書きされうる。

## システム構成

| コンポーネント | 役割 | 文案への示唆 |
|--------------|------|-------------|
| **Thunder** | フォロー中アカウントの投稿（In-Network） | 既存フォロワー向け。相互フォローからの返信が特に強い |
| **Phoenix Retrieval** | Two-Tower 類似検索（Out-of-Network） | 新規リーチ。テーマの明確さ・エンゲージメント履歴との意味的類似が鍵 |
| **SimClusters** | クラスタ類似による OON 候補 | 同じ関心クラスタに届く主張の明確さ |
| **Phoenix Ranking** | 各アクション確率の予測 | 単一スコアではなく複数アクションの加重和 |
| **RankingScorer** | 重み付き合計 → Author Diversity → OON 割引 → 新規著者ブースト | 連投減衰・非フォローは 0.75 倍 |
| **VMRanker** | embedding 類似で近傍を少し下げて並べ替え | 同じ切り口の連投は並びにくい |
| **visibility-filtering** | ALLOW / INTERSTITIAL / DROP | スパム・攻撃・規約際どい投稿は順位以前に落ちる |
| **Home Mixer** | パイプライン統合・広告ブレンド | フィード内競合。冒頭のフック力が重要 |

## パイプライン段階

1. Query Hydration — ユーザーのエンゲージメント履歴・フォロー・トピック
2. Candidate Sourcing — Thunder + Phoenix Retrieval + SimClusters
3. Candidate Hydration — 本文・著者・メディア・言語・相互フォロー等
4. Pre-Scoring Filters — 重複・**48時間超**・ミュートキーワード等
5. Scoring — Phoenix → Weighted → Author Diversity → OON → 新規著者
6. Selection — Top K
7. Post-Selection — VFFilter（visibility-filtering）・会話重複の整理

## 公開デフォルト重み（2026-08-12 sync）

`Final Score = Σ (weight_i × P(action_i))`

コメント原文: 重みは「その行動をランキングでどれだけ価値づけるか」と「ネットワーク全体での発生しやすさ（負のフィードバックは稀）」の組み合わせ。

### ポジティブ

| パラメータ | 重み | 文案への示唆 |
|-----------|------|-------------|
| ShareViaCopyLinkWeight | 20.0 | 外へ持ち出したくなる保存価値が最強クラス |
| BidirectionalFollowReplyWeightBoost | +15.0 | 相互フォローからの返信時、reply 重みに加算（実質 reply 20.0） |
| ReplyWeight | 5.0 | いいねの 10 倍。会話が起きる投稿 |
| QuoteWeight | 5.0 | リポストより強い。自分のコメントを付けて発信 |
| ShareViaDmWeight | 5.0 | 特定の誰かに見せたい投稿 |
| FollowAuthorWeight | 4.0 | 「今後も見たい」と思わせる |
| ShareWeight | 2.0 | 通常リポストより高い |
| RetweetWeight | 1.0 | 拡散単体は会話・引用より弱い |
| FavoriteWeight | 0.5 | 主目標にしない |
| ClickWeight | 0.4 | 投稿クリック。興味までは示すが満足の証拠ではない |
| OpenLinkWeight | 0.2 | **URL は減点ではない**（誤情報に注意） |
| PhotoExpandWeight | 0.05 | 画像を開かせるだけでは弱い |
| VideoOpenWeight | 0.05 | 同上 |
| VqvWeight | 0.05 | 動画品質視聴も弱い |
| QuotedClickWeight | 0.05 | 引用先クリックは弱い |
| PostUnexploredWeight | 0.02 | 未探索投稿へのわずかな加点。`InNetworkOnly=true` なのでネットワーク内限定 |
| ContDwellTimeWeight | 0.004 | 連続滞在の微加点。見る時間が長いほどわずかにプラスになりうる |
| DwellWeight | 0.0 | 単純な滞在イベントは加点しない |
| ProfileClickWeight | 0.0 | プロフィールクリックだけではプラスにならない |
| BidirectionalFollowDwellWeightBoost | 0.0 | 相互フォローの滞在ブーストは現状オフ |
| QuotedVqvWeight | 0.0 | |

### ネガティブ

| パラメータ | 重み | 文案への示唆 |
|-----------|------|-------------|
| ReportWeight | −234.0 | 通報は圧倒的。いいねや返信では相殺できない |
| MuteAuthorWeight | −58.8 | ブロックより大きい。不快な連投・しつこいベイト |
| NotInterestedWeight | −43.2 | 数回のいいねを軽く吹き飛ばす |
| BlockAuthorWeight | −31.2 | 強い拒否。おすすめから外すシグナル |
| NotDwelledWeight | −0.02 | 流し見。マイナスだが極めて小さい |

炎上で reply が増えても、興味なし・ミュート・ブロック・報告が同時に起きるとネットでは不利。

### スコア後の係数（参考）

| パラメータ | 値 | 意味 |
|-----------|-----|------|
| AuthorDiversityDecay | 0.5 | 同一著者の2本目以降を減衰 |
| AuthorDiversityFloor | 0.25 | 減衰の下限 |
| OonWeightFactor | 0.75 | 非フォロー投稿の割引 |
| PostUnexploredWeightInNetworkOnly | true | 未探索加点は In-Network のみ |
| ValueModelMode | weighted | 上記の加重和モードがデフォルト |

## 主要フィルタと文案への影響

| フィルタ | 影響 |
|---------|------|
| Age（48時間） | 古い投稿は Pre-Scoring で落ちやすい → タイムリーな投稿 |
| PreviouslySeen / Served | 既読・配信済みは再表示されにくい → 新規切り口 |
| AuthorSocialgraphFilter | ブロック/ミュートされた著者は表示されない |
| MutedKeywordFilter | ユーザーがミュートした語句を含むと除外 |
| visibility-filtering | DROP / INTERSTITIAL。スパム・暴力・成人向け等 |
| Author Diversity | 同一著者の連続表示を減衰 → 連投より質の高い単発 |
| DedupConversationFilter | 同一スレッドの重複枝を整理 → 議論は1本のスレッドに集約 |

## 設計上の重要決定

### 手作り特徴量なし

「いいね率が高いキーワード」などのルールベース最適化は効きにくい。読者の**実際の行動履歴**に近いコンテンツが選ばれる。

### Candidate Isolation

各投稿のスコアは他の候補に依存しない。バッチ内の競合より、**その投稿単体の engagement 予測**が重要。

### Multi-Action Prediction

「バズる」= いいねだけ、ではない。優先順位は概ね:

**copy link 共有 > 相互フォローからの返信 > 返信 / 引用 / DM 共有 > フォロー > 共有 > リポスト > いいね**

メディアを開く・プロフィールをクリックする・ただ止まる、は主戦場ではない。

## Out-of-Network（OON）リーチの考え方

Phoenix Retrieval は User Tower（エンゲージメント履歴）と Candidate Tower（投稿 embedding）の類似度で候補を取得。SimClusters も並行。OON は `OonWeightFactor` 0.75 で割引される。

文案で意識すること:

- **テーマの一貫性** — 特定分野のエンゲージメント履歴を持つユーザーに届きやすい
- **明確な主張** — embedding がぼやけない
- **メディアは補助** — video_open / photo_expand の重みは小さい。会話・共有につながる図があるときだけ
- **相互フォロー** — 返信ブーストの対象。コミュニティ内で会話が起きる投稿

## 更新情報（2026-08-13 リリース）

- ランキング重みなど key configuration を公開（`home-mixer/params/param.rs`）
- visibility-filtering とラベル生成系（botmaker, scarecrow, agatha 等）
- Phoenix の学習・推論コードと合成データ
- SimClusters を OON 候補ソースとして追加
- Under the Hood（アカウント/投稿ラベルの透明度ツール）

## 免責

本リファレンスは公開リポジトリのデフォルト値に基づく**執筆上のヒューリスティック**である。feature switch により本番値が変わりうる。
