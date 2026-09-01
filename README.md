# Geo Decision Agent (MVP)

生物多様性に配慮した立地・設備判断を支援する意思決定エージェント。要件定義書 v3.0 の UC-01（生物多様性配慮の立地・設備判断）を中心に、招待制の限定公開アプリとして実装した MVP です。

**公開URL**: https://geo-decision-agent.hphiroyuki.workers.dev（招待制ログインのため、招待コードなしではアカウント作成不可）

## この MVP でできること

- **招待制ログイン**: 管理者が発行した招待コードを持つ人だけがアカウントを作成できます。サインアップは公開されていません。
- **Claude API による実チャット**: `@anthropic-ai/sdk` を使い、Claude（既定: `claude-sonnet-5`）とストリーミングで会話します。
- **月次予算の自動停止**: 月間のAI利用コストを円換算で集計し、管理画面で設定した上限（既定 ¥5,000）に達すると、当月はチャットが自動的に停止します。
- **構造化ツール呼び出しによる分析**: LLM は生の数値を作文せず、`analyze_site_candidates` という構造化ツールを呼び出し、その結果だけを根拠に説明します（要件書 FR-004 に対応）。
- **4つの主要画面**: ホーム（プロジェクトマップ・ステータス）／AI調査チャット＋地図／分析結果（候補地ランキング・ミティゲーション案）／意思決定レポート（監査証跡・レビュー・PDF書き出し）。
- **現地記録（現地調査モバイル、V-05）**: スマホのカメラ・GPSで写真・位置・種候補を記録し、R2に保存。分析時に候補地から2km以内の現地記録を実データとして参照する。
- **Google Earth Engine連携（任意）**: `EE_SERVICE_ACCOUNT_JSON` を設定すると、Satellite Embeddingの実データを取得し、現地記録で確認済みの地点の埋め込みベクトルを平均した「基準ベクトル」との類似度を候補地ごとに算出する。未設定の場合は自動的にシミュレーション値にフォールバックする。
- **管理画面**: 招待コードの発行・失効、ユーザー管理、月次利用状況グラフ、予算上限の変更。

## ドキュメント

| 文書 | 内容 |
|---|---|
| `docs/BUILD_PLAN.md` | 想定利用者（担当者・開示実務・決裁者）と、その課題から導いたUI方針。実装順序とその根拠 |
| `docs/REQUIREMENTS_COVERAGE.md` | 要件定義書のFR・V番号ごとの実装状況（実装／部分／未実装）と、部分実装の制限内容 |
| `docs/ACCEPTANCE_REVIEW.md` | 受入確認の結果、意図的に実装しなかったことの記録、納品前に合意が必要な項目 |

## 実装していないこと（本番販売前に必要な作業）

要件定義書は Google Earth Engine 連携・TNFD/SSBJ自動出力・マルチテナントRBAC・SSO/SAMLなど、本格的なエンタープライズSaaSを要求しています。このMVPでは以下は**意図的に対象外**です。

| 項目 | 現状 | 本番化に必要なこと |
|---|---|---|
| Satellite Embedding以外の衛星指標（NDVI/NDRE/NBR、Sentinel-2、土地被覆） | `worker/src/lib/geoEngine.ts` の**シミュレーション値** | Sentinel-2等の追加データパイプライン |
| マルチテナント/RBAC | 単一テナント、ロールは admin/member/viewer の3段階のみ | 11章のデータモデルに沿ったテナント分離、ABAC |
| SSO/SAML/SCIM | メール＋パスワードのみ | OIDC/SAML連携 |
| TNFD/SSBJ自動出力 | なし | LEAP整合の自動書式変換 |
| 基盤地図タイル | CARTO の無料デモタイル | 商用利用条件を満たす地図タイル契約 |
| セキュリティ診断 | 未実施 | SAST/DAST/SCA、ペネトレーションテスト（14章・21章） |

## アーキテクチャ

- **Cloudflare Workers**（Hono） + **D1**（SQLite）+ **Workers Static Assets**（React SPA）の単一デプロイ。
- `worker/src/routes/chat.ts` がチャットのコア: Claude にツール `analyze_site_candidates` を渡し、Claude がツール利用を選ぶと `worker/src/lib/geoEngine.ts` の決定的シミュレーションエンジンを実行し、その結果だけをツール結果として返す。数値の作文は行わない。
- 認証は WebCrypto PBKDF2 によるパスワードハッシュ + HMAC 署名付きセッションCookie（`worker/src/lib/crypto.ts`, `worker/src/lib/auth.ts`）。
- 予算制御は `usage_log` テーブルに月次でトークン数・USD/JPYコストを記録し、月初からの合計が上限を超えるとチャットAPIが `budget_exceeded` イベントを返して停止する（`worker/src/lib/pricing.ts`, `worker/src/routes/chat.ts`）。

```
worker/src/
  index.ts            # Hono アプリのエントリポイント
  routes/             # auth / admin / projects / chat
  lib/                # crypto, db, auth, pricing, geoEngine, anthropicClient
frontend/src/
  pages/              # Login, Register, Home, ProjectChat, AnalysisResults, DecisionReport, Admin
  components/         # Layout（サイドバー）, MapView（MapLibre GL）
migrations/0001_init.sql  # D1 スキーマ
```

## セットアップ

```bash
npm install
```

### 必要なシークレット

```bash
npx wrangler secret put ANTHROPIC_API_KEY   # Claude APIキー（console.anthropic.com で発行）
npx wrangler secret put SESSION_SECRET      # ランダムな長い文字列（openssl rand -hex 32 等）
```

### ローカル開発

```bash
npm run build:frontend
npx wrangler d1 migrations apply geo-decision-agent-db --local
npm run dev   # http://localhost:8787
```

### デプロイ

**自分のPC・サーバーから**（Cloudflareへ直接ネットワーク到達できる環境):

```bash
npm run deploy
```

**GitHub Actions から**（サンドボックス環境からは Cloudflare API へ直接到達できないため、こちらを利用):

`.github/workflows/deploy.yml` が push / 手動実行でデプロイします。リポジトリの Settings → Secrets and variables → Actions で以下を登録してください。

| Secret名 | 値 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflareで発行したAPIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| `ANTHROPIC_API_KEY` | Claude APIキー |
| `APP_SESSION_SECRET` | セッション署名用のランダムな文字列（`openssl rand -hex 32` 等で生成） |
| `EE_SERVICE_ACCOUNT_JSON`（任意） | Earth Engine権限を持つGoogleサービスアカウントのJSON鍵の中身 |
| `EE_PROJECT_ID`（任意） | Earth Engine登録済みのGCPプロジェクトID（サービスアカウント自身のプロジェクトと同じなら省略可） |

R2バケット（現地記録の写真保存用）はCloudflareダッシュボードで一度R2を有効化した後、デプロイ時に自動作成されます。

### Earth Engine連携の診断（管理者のみ）

分析フローはEarth Engineの失敗時にシミュレーション値へ静かにフォールバックするため、連携が動いているかは以下のエンドポイントで確認する。

| エンドポイント | 用途 |
|---|---|
| `GET /api/admin/ee-test` | 鍵の有無→鍵の解析→OAuth→実際のサンプリング、と段階ごとに判定し、失敗した段階と上流の生エラーを返す（鍵の中身は返さない）。`?lat=&lng=&year=` で地点指定、`?nofilter=1` で日付フィルタを外して切り分け |
| `GET /api/admin/ee-algorithms?q=` | Earth Engineが実際に公開しているサーバー側関数名と引数名を検索する。式グラフはこの名前と完全一致する必要があり、クライアントライブラリのメソッド名（例 `filterDate`）とは異なるため、名前の食い違いはここで確定させる |

登録後、Actions タブから `Deploy to Cloudflare Workers` を手動実行（Run workflow）するか、このブランチへpushすると自動デプロイされます。

## 管理者アカウントの作成（初回のみ）

管理者にはあらかじめ 1 件だけ、`hphiroyuki@gmail.com` 宛の招待コードを D1 に登録済みです。`/register` からそのコードでアカウントを作成すると、ロール `admin` で登録されます。以後は管理画面（`/admin`）から追加の招待コードを発行してください。

## 予算・モデルの調整

`/admin` 画面、または D1 の `settings` テーブルで以下を変更できます。

- `monthly_budget_jpy`: 月間上限（円）。既定 5000。
- `usd_jpy_rate`: コスト換算に使う為替レート。既定 155。
- `claude_model`: 使用するモデルID。既定 `claude-sonnet-5`（コスト重視。より高精度が必要なら `claude-opus-5` 等に変更可能。ただし出力単価が2.5倍になるため、月間予算に対して利用可能なメッセージ数が大きく減ります）。
