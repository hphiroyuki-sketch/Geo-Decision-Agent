# アーキテクチャ

このシステムが何であり、なぜこの形をしているか。コードを読む前にこれを読むこと。

---

## 1. これは何のシステムか

**Geo Decision Agent（ForestScope）** は、法人が発電所・工場・物流拠点・不動産・送電線などを
**新設／拡張／改修するとき、生物多様性への影響が最小になる選択肢を提示する**意思決定支援エージェント。

要件定義書 v3.0（日本語・全49ページ・リポジトリ外）の UC-01 を中心に実装した MVP。

**現在の主用途は営業。** 見込み客に画面を見せ、その企業の拠点について
**TNFD LEAPに沿った簡易スクリーニング**をPDF／Markdownで返す。
つまり出力は**社外に出る文書**であり、これがシステム全体の設計を規定している（§3）。

### 中核となる技術的アイデア

Google の **Satellite Embedding**（`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`）は、
地表10m四方ごとに **64次元のベクトル**を年次で提供する。似た環境は似たベクトルになる。

そこで：

1. ユーザーが「ここは確かに守りたい生息環境だ」という地点を指定する（現地記録 or 地図上のピン）
2. その地点のベクトルを平均して**基準ベクトル**を作る
3. 対象エリアを10mメッシュに切り、各マスのベクトルと基準ベクトルの**コサイン類似度**を測る
4. 類似度が高いマス＝**保全優先候補**、前年ベクトルとの差が大きいマス＝**変化検出**

分類しきい値は `worker/src/lib/mesh.ts` に定数として置いてある：

```
CHANGED_THRESHOLD    = 0.15   // 1 - cos(今年, 前年)。これ以上で「変化あり」
PRIORITY_A_THRESHOLD = 0.85   // cos(マス, 基準)。これ以上で「保全優先」
SIMILAR_THRESHOLD    = 0.70   // これ以上で「類似」
```

**この3つの数値がシステム全体の判定の根幹である。** 変更するときは、
既存の分析結果との比較可能性が失われることを理解した上で行うこと
（`analyses.engine_version` がこのために存在する → `docs/DATA_MODEL.md`）。

---

## 2. 実行環境とデプロイ形態

```
                    ┌─────────────────────────────────────┐
  ブラウザ / PWA ──▶ │  Cloudflare Worker (単一デプロイ)    │
                    │                                     │
                    │  /api/*  → Hono ルーター (worker/)   │
                    │  それ以外 → Static Assets (React SPA)│
                    └───┬──────────┬──────────┬───────────┘
                        │          │          │
                    ┌───▼───┐  ┌───▼───┐  ┌───▼──────────────┐
                    │  D1   │  │  R2   │  │ 外部API           │
                    │SQLite │  │写真   │  │ Earth Engine      │
                    └───────┘  └───────┘  │ Anthropic         │
                                          │ GBIF / GSI / OSM  │
                                          └──────────────────┘
```

- **フロントとバックが同一 Worker**。`wrangler.toml` の `run_worker_first = ["/api/*"]` が振り分ける。
  CORS も別オリジンも存在しない。Cookie は同一オリジンなので `SameSite=Lax` で足りる。
- **本番URL**: `https://geo-decision-agent.hphiroyuki.workers.dev`
- **cron**: `*/5 * * * *` で自己診断とアラート生成が走る（`worker/src/index.ts` の `scheduled`）。

### Cloudflare Workers 無料プランの制約 ── 設計の大半はここから来ている

| 制約 | 実測される影響 | 本システムでの対処 |
|---|---|---|
| **CPU 10ms／呼び出し** | PBKDF2の反復回数、PNGのデコード、巨大JSONのパースが即死する | パスワードハッシュは10,000反復（`crypto.ts`）／ハザードタイルはHTTPステータスだけ見てPNGを展開しない（§ EXTERNAL_SERVICES）／EEアルゴリズム一覧はcronから外し管理画面の明示操作のみ |
| **サブリクエスト 50／リクエスト** | 400マスのメッシュを1リクエストで処理できない | メッシュは **16マス／バッチ**（`SAMPLE_BATCH`）でフロントから繰り返し呼ぶ。変化検知ONだと1マスにつき2リクエスト（今年＋前年）なので 16×2=32 で収まる |
| **cron実行にも同じCPU上限** | 自己診断の途中で isolate が殺されうる | 各チェックを**1件ずつ即座にD1へ書く**（バッチ書き込みだと途中死で全部消える）／最初に `cron_heartbeat` を書き、cronが発火したこと自体は必ず残す |

**この表を無視して機能を足すと、本番でだけ落ちる。** ローカルの miniflare は CPU 上限を強制しない。

---

## 3. 最重要の設計原則：出力は社外に出る

このシステムの出力は企業へ渡すスクリーニング文書になる。したがって次を全レイヤーで守っている。

1. **推定を測定と偽らない。** すべての値に**根拠区分**が付く
   （`衛星実測 / 現地確認済み / 地図上で指定（現地未確認） / 登録・設定値 / 推定値 / 未取得`）。
   定義は `worker/src/lib/leap.ts` の `BASIS_LABEL`。

2. **「取得できなかった」を「該当なし」にしない。** 外部データ取得の失敗は
   `public_data_cache.status` に**事実として記録**される。文書には「判定不可」と出る。
   取得できなかった源を黙って落とすと「そこには何も無い」と読めてしまい、真実の逆になる。

3. **判別できないチェックは、無いより危険。** ハザード判定は「該当地で200・非該当地で404」に
   全面依存する。正例しか検証していなければ、*どこでも200を返すサービス*でも診断は緑になり、
   全拠点が「該当あり」と印字される。よって**正例（東京都心）と負例（富士山頂）の両方**を
   自己診断で叩き、**区別できなければ診断を失敗させる**（`scheduled.ts` の `gsi_hazard`）。

4. **LLMに数値を作文させない。** Claude は `analyze_site_candidates` ツールを呼ぶだけで、
   数値は決定的なエンジン（`geoEngine.ts` / `mesh.ts`）が出す。
   システムプロンプトにも明記（`anthropicClient.ts`）。

5. **「混雑」と「失敗」を区別する。** レート制限された任意データ源に「取得失敗」と印字すると、
   企業に渡す文書で不具合に見える。詳細は `docs/DECISIONS.md` の ADR-008。

---

## 4. モジュール地図

### worker/src

| ファイル | 責務 | 読む優先度 |
|---|---|---|
| `index.ts` | Honoアプリの組み立て、ルート単位の認証ミドルウェア、cronエントリ | **最初** |
| `types.ts` | `Env`（バインディング＋シークレット）、`AuthUser`、`Role` | **最初** |
| `routes/auth.ts` | 招待コード確認・登録・ログイン・ログアウト・`/me` | |
| `routes/admin.ts` | 招待発行、ユーザー管理、利用状況、設定、監査ログ、**EE診断エンドポイント** | |
| `routes/projects.ts` | プロジェクトCRUD、候補地一覧、分析履歴、意思決定レポート | |
| `routes/chat.ts` | **Claudeとの対話（SSEストリーミング）＋予算ガード＋ツール実行** | **重要** |
| `routes/fieldRecords.ts` | 現地記録の登録・査読・写真配信（R2） | |
| `routes/mesh.ts` | **メッシュ生成・サンプリング・解析・統計・公的データ照合・LEAP帳票** | **重要** |
| `routes/alerts.ts` | アラート一覧・既読・ルール変更・自己診断結果の閲覧と手動実行 | |
| `routes/dashboard.ts` | 横断ダッシュボード（V-06）の集計 | |
| `lib/crypto.ts` | PBKDF2パスワードハッシュ、HMAC署名セッショントークン、ID採番 | |
| `lib/auth.ts` | セッションCookieの発行・検証、`requireAuth` / `requireAdmin` | |
| `lib/db.ts` | `settings` の読み書き、監査ログ、当月キー | |
| `lib/pricing.ts` | **モデル別単価表と月次予算判定** | |
| `lib/anthropicClient.ts` | **システムプロンプト、ツール定義、PROMPT_VERSION** | **重要** |
| `lib/googleAuth.ts` | サービスアカウントのJWT自己署名 → OAuth2トークン交換（RS256をWebCryptoで実装） | |
| `lib/earthEngine.ts` | **EE REST `value:compute` の式グラフ構築**（埋め込み64次元／S2の4指標） | **重要** |
| `lib/fieldData.ts` | 埋め込み・指標のキャッシュ付き取得、基準ベクトル生成、近傍現地記録 | **重要** |
| `lib/mesh.ts` | **グリッド生成、バッチサンプリング、分類、ホットスポット抽出、AI向けコンテキスト生成** | **重要** |
| `lib/geoEngine.ts` | 候補地スコアリング（実データがある項目は実データ、無い項目は決定的な擬似乱数） | **重要** |
| `lib/recoveryPlan.ts` | ホットスポットごとの回避→低減→回復→オフセット施策生成 | |
| `lib/publicData.ts` | **GBIF / Overpass / 国土地理院ハザードタイルの接続とキャッシュ** | **重要** |
| `lib/leap.ts` | **TNFD LEAP 16コンポーネント帳票の生成（1,000行超）** | **重要** |
| `lib/scheduled.ts` | cronで走る自己診断とアラート生成 | |

### frontend/src

| パス | 内容 |
|---|---|
| `App.tsx` | ルーティング、PWA更新バナー、オフラインバナー |
| `main.tsx` | エントリ、Providerの積み上げ |
| `lib/api.ts` | `fetch` ラッパ（Cookie同送・エラー整形） |
| `lib/auth.tsx` | 認証コンテキスト |
| `lib/displayMode.tsx` | **かんたん／ビジネス／エキスパート**の表示モード（要件9章） |
| `lib/leapTypes.ts` | **`worker/src/lib/leap.ts` の型のミラー**（後述の注意） |
| `lib/screeningDoc.ts` | スクリーニングのMarkdown書き出し |
| `lib/pwa.ts` | Service Worker登録・更新適用 |
| `components/Layout.tsx` | サイドバー、ヘッダー、モバイルナビ |
| `components/MapView.tsx` | **MapLibre GLラッパ（683行）。地図の全挙動がここ** |
| `components/MapControlPanel.tsx` | レイヤー・年代・不透明度・3Dの操作 |
| `components/Explain.tsx` | 用語のインライン解説 |
| `pages/MeshView.tsx` | **最大画面（1,336行）。メッシュ生成〜解析〜色分け表示** |
| `pages/LeapReport.tsx` | **A4印刷対応のスクリーニング帳票（817行）** |
| `pages/ProjectChat.tsx` | AI対話＋地図 |
| `pages/AnalysisResults.tsx` | 候補地ランキングとトレードオフ |
| その他 | Home / Dashboard / MapExplorer / DataCatalog / ReportsIndex / Alerts / RecoveryPlan / FieldSurvey / DecisionReport / Admin / Login / Register |

> **注意：型が2箇所にある。**
> `worker/src/lib/leap.ts` と `frontend/src/lib/leapTypes.ts` は同じ型を別々に定義している。
> Worker と フロントで tsconfig が分かれており（Workers型 vs DOM型）、共有パッケージを作るほどの
> 規模ではないと判断した。**片方を変えたらもう片方も変えること。** 型検査では検出されない。

---

## 5. 主要な処理の流れ

### 5.1 AI対話（`POST /api/conversations/:id/messages`）

```
1. 当月の usage_log を合計 → 予算超過なら SSE で budget_exceeded を返して終了
2. 会話履歴を読み、メッシュ結果があれば buildMeshContext() でテキスト化して system に添付
3. Claude を stream 呼び出し（ツール: analyze_site_candidates のみ）
4. ツール使用が返ったら:
     - 各候補地について Earth Engine の埋め込みを実取得
     - 確認済み現地記録／地図ピンから基準ベクトルを作り、コサイン類似度を計算
     - NDVI/NDRE/NDMI/NBR を当年・前年で実取得し、NDRE変化を実測値として採用
     - 実データが無い項目のみ geoEngine.ts の決定的擬似乱数で埋める
     - 結果を analyses テーブルにスナップショットとして記録
     - ツール結果として Claude に返す（最大3ホップ）
5. トークン数からコストを算出し usage_log に記録
```

**ホップ上限は3。** 無限ループとコスト暴走の両方を防ぐ。

### 5.2 10mメッシュ解析

```
POST /api/projects/:id/meshes      → グリッドを生成し mesh_cells を pending で全件作成
POST /api/meshes/:id/sample        → pending を16件取り、EEで埋め込み取得・分類（何度も呼ぶ）
POST /api/meshes/:id/analyze       → 全マスを読み、隣接同クラスをホットスポットに集約・順位付け
                                     → 施策を生成し recovery_actions へ
GET  /api/meshes/:id               → セル・ホットスポット・統計を返す
```

フロントは `sample` を `remaining === 0` になるまで繰り返す。
**失敗したバッチは3回まで指数バックオフで再試行し、それでも駄目なら残りを諦めて必ず `analyze` を呼ぶ。**
（初期実装では1バッチの失敗でループ全体が中断し「64/400で止まる」不具合になった → `docs/HISTORY.md`）

`MAX_CELLS = 2500`。10m×10mで50×50＝500m四方が上限。

### 5.3 公的データ照合（`POST /api/projects/:id/public-data`）

3源を `Promise.all` で並列取得（約9サブリクエスト）。各源は独立に成功／失敗し、
結果は `public_data_cache` に**状態つきで**保存される。詳細は `docs/EXTERNAL_SERVICES.md`。

### 5.4 LEAP帳票（`GET /api/projects/:id/leap`）

`buildLeapReport()` がD1の全材料（プロジェクト、メッシュ、統計、現地記録、分析スナップショット、
公的データキャッシュ）を読み、TNFDの**16コンポーネント＋スコーピング**と
**感度の高い地域5基準**を組み立てて返す。1,028行の大半はこの帳票文の生成。

---

## 6. 認証とアクセス制御

- **招待制のみ。** 公開サインアップは存在しない。`invites` テーブルにコードが無ければ登録できない。
- パスワードは **PBKDF2-SHA256 / 10,000反復**（`crypto.ts`）。
  Workers に bcrypt/scrypt のネイティブモジュールが無いため。反復回数は CPU 10ms の制約で決まっている
  （初期は既定値が高すぎて register/login が500になった → `HISTORY.md`）。
- セッションは D1 の `sessions` 行 ＋ **HMAC-SHA256署名付きCookie**（`gda_session`、httpOnly / secure / Lax / 30日）。
- ロールは `admin | member | viewer` の3段階のみ。**マルチテナント分離は無い**（単一テナント前提）。

---

## 7. 意図的にやっていないこと

| 項目 | 理由 |
|---|---|
| マルチテナント／テナント分離 | 単一顧客向けMVP。導入時に `projects` へ `tenant_id` を足し全クエリを通す必要がある |
| SSO / SAML / SCIM | 招待制メール＋パスワードで足りている |
| テストコード | **存在しない。** 検証は型検査・ビルド・本番の自己診断で行っている。§8参照 |
| 資料取込・全文検索（FR-010〜014） | RAG基盤を1つ増やす規模。他の是正と同じ回に入れなかった |
| 電力設備台帳（FR-040〜047） | 設備台帳・流域界・取水口データの受領待ち |
| 対話からの書き込み系ツール | 誤操作時の取り消し設計とセットでないと危険。読み取り（メッシュ結果の注入）のみ実装 |

## 8. テストが無いことについて（新しく入る人が最初に驚く点）

自動テストは1本も無い。代わりに次で担保している。

1. `npm run typecheck:worker` と `npm run build:frontend`（フロントは `tsc -b` を含む）
2. **本番の定時自己診断**（5分毎）。EE埋め込み・EE指標・GBIF・ハザードタイル・OSMを実際に叩き、
   結果を `system_checks` に記録する。**正例と負例の両方**を叩くものがある（§3-3）
3. 本番D1への直接クエリによる実測値確認

**なぜこの形か：** ビルド環境（サンドボックス）から `earthengine.googleapis.com`、`api.gbif.org`、
`disaportaldata.gsi.go.jp`、`overpass-api.de`、Cloudflare API のいずれにも到達できない。
外部APIの疎通を確認できるのは**デプロイ後の本番だけ**。よって「本番が自分を診断して結果をDBに書く」形にした。

**単体テストを足すなら、まず `mesh.ts` の `classifyCell` / `findHotspots` / `buildGrid` と
`geoEngine.ts` の決定性、`pricing.ts` の予算判定から。** いずれも外部依存が無く純関数に近い。
EEやGBIFを叩く部分はモックより本番自己診断のほうが実態を捉える。
