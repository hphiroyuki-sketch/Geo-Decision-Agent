# API リファレンス

すべて `/api/` 配下。認証はセッションCookie（`gda_session`）。
ミドルウェアの適用は `worker/src/index.ts` を見ること。

| 記号 | 意味 |
|---|---|
| 〇 | 認証不要 |
| ● | 要ログイン |
| ★ | **要管理者** |

---

## 認証 `worker/src/routes/auth.ts`

| | メソッド / パス | 内容 |
|---|---|---|
| 〇 | `GET /api/auth/invite/:code` | 招待コードの有効性を確認（登録画面が使う） |
| 〇 | `POST /api/auth/register` | **招待コード必須**。コードが無効なら登録できない |
| 〇 | `POST /api/auth/login` | メール＋パスワード。成功でセッションCookie発行 |
| ● | `POST /api/auth/logout` | セッション行を削除しCookieを消す |
| ● | `GET /api/auth/me` | 現在のユーザー |

## 管理 `worker/src/routes/admin.ts` ★すべて管理者

| メソッド / パス | 内容 |
|---|---|
| `GET /api/admin/ee-test` | **Earth Engine 段階診断**。`?lat=&lng=&year=&nofilter=1`。鍵の有無→解析→OAuth→サンプリングの順に判定し、失敗段階と上流の生エラーを返す（鍵の中身は返さない） |
| `GET /api/admin/ee-algorithms?q=` | **EEのサーバー側関数名を検索**。式グラフはこの名前と完全一致が必要。応答約1MBなのでcronからは呼ばない |
| `GET/POST /api/admin/invites`, `DELETE /api/admin/invites/:id` | 招待コードの一覧・発行・失効 |
| `GET /api/admin/users`, `POST /api/admin/users/:id/role`, `.../disable`, `.../enable` | ユーザー管理 |
| `GET /api/admin/usage` | 月次のトークン数・コスト・予算消化率 |
| `GET/POST /api/admin/settings` | `settings` テーブルの読み書き（予算・為替・モデル等） |
| `GET /api/admin/audit` | 監査ログ |

## プロジェクト `worker/src/routes/projects.ts` ●

| メソッド / パス | 内容 |
|---|---|
| `GET /api/projects` / `POST /api/projects` | 一覧・作成 |
| `GET /api/projects/:id` / `PATCH /api/projects/:id` | 取得・更新（`client_name` もここ） |
| `GET /api/projects/:id/candidates` | 候補地ランキング |
| `GET /api/projects/:id/analyses` | **分析スナップショットの履歴**（再現情報） |
| `POST /api/projects/:id/conversations` | 会話の開始 |
| `GET/POST /api/projects/:id/report` | 意思決定レポート |
| `POST /api/projects/:id/report/:reportId/reviewers` | 承認者の追加 |
| `POST /api/projects/:id/report/:reportId/reviewers/:reviewerId/decision` | 承認／却下 |

## AI対話 `worker/src/routes/chat.ts` ●

| メソッド / パス | 内容 |
|---|---|
| `GET /api/conversations/:conversationId/messages` | 履歴 |
| `POST /api/conversations/:conversationId/messages` | **SSEストリーミング**。予算超過時は `budget_exceeded` イベントを返してClaudeを呼ばない |

**SSEイベント**: `delta`（本文）／`step`（分析ステップ）／`budget_exceeded`／`done`／`error`

## 現地記録 `worker/src/routes/fieldRecords.ts` ●

| メソッド / パス | 内容 |
|---|---|
| `GET /api/projects/:id/field-records` | 一覧 |
| `POST /api/projects/:id/field-records` | 登録（写真は**8MB上限**でR2へ） |
| `POST /api/field-records/:id/review` | 査読。**`confirmed` になったものだけが基準ベクトルに使われる** |
| `GET /api/field-records/:id/photo` | R2から写真を配信 |

## メッシュ・公的データ・LEAP `worker/src/routes/mesh.ts` ●

| メソッド / パス | 内容 |
|---|---|
| `POST /api/projects/:id/meshes` | グリッド生成。全マスを `pending` で作る |
| `POST /api/meshes/:meshId/sample` | **16マス分をサンプリング**。`remaining` を返すので0になるまで呼ぶ |
| `POST /api/meshes/:meshId/analyze` | ホットスポット抽出・順位付け・施策生成 |
| `GET /api/meshes/:meshId` | セル・ホットスポット・統計 |
| `GET /api/meshes/:meshId/stats` | 統計のみ（軽量） |
| `GET /api/projects/:id/meshes` | プロジェクトのメッシュ一覧 |
| `GET /api/projects/:id/mesh-context` | AIに渡すテキスト化された所見 |
| `POST /api/recovery-actions/:actionId` | 施策の担当者・期限・状態の更新 |
| `POST /api/projects/:id/demo-field-records` | **デモ現地記録の生成**（`demo=1` で作られる） |
| `DELETE /api/projects/:id/demo-field-records` | デモ記録の一括削除 |
| `POST /api/projects/:id/reference-pins` | **地図上で基準点を指定**（`source='pin'` で作られる） |
| `DELETE /api/projects/:id/reference-pins` | ピンの一括削除 |
| `POST /api/projects/:id/public-data` | **GBIF / OSM / 国土地理院への照合**。`?force=1` でキャッシュを捨てて再取得 |
| `GET /api/projects/:id/leap` | **TNFD LEAP スクリーニング帳票（16コンポーネント＋5基準）** |
| `GET /api/projects/:id/survey-targets` | メッシュ所見から導いた現地調査の目標地点（V-05） |

## アラート・自己診断 `worker/src/routes/alerts.ts` ●

| メソッド / パス | 内容 |
|---|---|
| `GET /api/alerts` / `GET /api/alerts/unread-count` | 一覧・未読数（バッジ） |
| `POST /api/alerts/:id/read` / `POST /api/alerts/read-all` | 既読化 |
| `POST /api/alerts/refresh` | アラート再評価 |
| `GET /api/alerts/rules` / `POST /api/alerts/rules/:id` | しきい値の閲覧・変更 |
| `GET /api/alerts/system-checks` | **本番の自己診断結果**。ここが本番の健康状態を知る場所 |
| `POST /api/alerts/system-checks/run` | 自己診断の手動実行 |

## ダッシュボード `worker/src/routes/dashboard.ts` ●

| メソッド / パス | 内容 |
|---|---|
| `GET /api/dashboard` | 横断サマリ（V-06） |
| `GET /api/dashboard/recent-activity` | 最近の活動 |
| `GET /api/dashboard/action-items` | 対応が必要な項目 |
| `GET /api/dashboard/recovery-actions` / `field-records` / `reports` | 各種一覧 |

## その他

| | メソッド / パス | 内容 |
|---|---|---|
| 〇 | `GET /api/health` | 死活確認 |

---

## 画面ルート（`frontend/src/App.tsx`）

| パス | 画面 |
|---|---|
| `/login` `/register` | 認証（未ログインで到達可能） |
| `/` | ホーム（プロジェクト一覧・地図） |
| `/dashboard` | 横断ダッシュボード（V-06） |
| `/map` | 地図エクスプローラ |
| `/data` | データカタログ |
| `/reports` | レポート一覧 |
| `/alerts` | アラート |
| `/recovery` | 回復計画 |
| `/projects/:id` | **AI対話＋地図** |
| `/projects/:id/analysis` | 分析結果（候補地ランキング・トレードオフ） |
| `/projects/:id/report` | 意思決定レポート |
| `/projects/:id/field` | 現地調査（モバイル） |
| `/projects/:id/mesh` | **10mメッシュ解析（最大画面）** |
| `/projects/:id/leap` | **LEAPスクリーニング帳票（A4印刷対応）** |
| `/projects/:id/recovery` | 回復計画 |
| `/admin` | 管理画面 |
