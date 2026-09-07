# Geo Decision Agent（ForestScope）

衛星データ × 現地データで、**TNFDのLEAPに沿った立地・設備の生物多様性影響を判定する**
AI意思決定支援エージェント。

要件定義書 v3.0 の UC-01（生物多様性配慮の立地・設備判断）を中心に実装。
**招待制の限定公開アプリ**であり、一般には公開していない。

**本番URL**: https://geo-decision-agent.hphiroyuki.workers.dev
（招待コードなしではアカウントを作成できない）

---

## 📖 ドキュメント

**初めて触る方（人間・AIを問わず）は [`docs/README.md`](docs/README.md) から読んでください。**
システムの全体像・設計判断・過去の不具合まで、会話履歴に依存せず理解できるよう書いてあります。

| 文書 | 内容 |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **何のシステムか／なぜこの形か／モジュール地図。まずこれ** |
| [`docs/DOMAIN.md`](docs/DOMAIN.md) | TNFD・LEAP・感度の高い地域5基準 |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | D1の全テーブルと存在理由 |
| [`docs/EXTERNAL_SERVICES.md`](docs/EXTERNAL_SERVICES.md) | 外部API6種の制限と失敗時の挙動 |
| [`docs/API.md`](docs/API.md) | 全エンドポイントと画面ルート |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | **ADR。変更する前に必ず読む** |
| [`docs/HISTORY.md`](docs/HISTORY.md) | 実際に踏んだ不具合と根本原因 |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | デプロイ・本番確認・トラブル対応 |
| [`docs/manual/`](docs/manual/) | **操作ガイド（利用者向け・HTML）。** 画面写真と遷移図つき |
| [`CLAUDE.md`](CLAUDE.md) | AIエージェント／開発者向けの作業ガイド |

---

## できること

### 中核

- **10mメッシュ解析** — 対象地を10m四方に区切り、Google Satellite Embedding（64次元）を
  1マスずつ実取得。確認済み現地記録との類似度と前年比の変化から、
  保全優先／類似／変化あり／一般区域に色分けし、隣接マスを重要区域としてまとめて順位付け。
  航空写真・3D地形表示・年代スライダーに対応
- **今見ている画面の範囲で解析** — 地図をパン／ズームして、その範囲に対して直接メッシュを生成できる
  （Googleマップの「周辺で探す」相当）。基準点も地図上のクリックで指定できる
- **TNFD LEAP スクリーニング** — **16コンポーネント＋スコーピング**と
  **感度の高い地域5基準**を判定し、A4印刷対応のPDFまたはMarkdownで出力。
  全項目に根拠区分（衛星実測／現地確認済み／地図上で指定／登録・設定値／推定値／未取得）が付く
- **公的データとの照合** — GBIF（生物記録・IUCN絶滅危惧カテゴリ）、
  国土地理院ハザードマップ（洪水・高潮・津波・土砂災害3種）、OpenStreetMap（保護区域）

### 支援機能

- **AI対話** — Claude（既定 `claude-sonnet-5`）とのストリーミング対話。
  **数値はLLMが作文せず**、構造化ツール `analyze_site_candidates` の結果だけを根拠に説明する
- **月次予算の自動停止** — 上限（既定 ¥5,000）に達すると当月はチャットが停止
- **現地調査（モバイル）** — スマホのカメラ・GPS・種候補を記録しR2へ保存。査読フロー付き
- **回復計画** — 重要区域ごとに 回避→低減→回復→オフセット の順で施策を生成
- **アラート** — しきい値超過・査読滞留を、重要度と次アクション付きで通知
- **意思決定レポート** — 監査証跡・レビュー・承認・PDF書き出し
- **表示モード** — かんたん／ビジネス／エキスパートで出す情報の粒度を切り替え
- **PWA** — ホーム画面追加、更新通知、オフライン表示。**API応答は意図的にキャッシュしない**
- **管理画面** — 招待発行、ユーザー管理、利用状況、予算設定、衛星連携の稼働状況

---

## アーキテクチャ（概要）

**Cloudflare Workers（Hono）＋ D1（SQLite）＋ R2 ＋ Workers Static Assets（React SPA）の単一デプロイ。**

```
worker/src/
  index.ts        Honoアプリ／ルート単位の認証／cronエントリ
  routes/         auth, admin, projects, chat, fieldRecords, mesh, alerts, dashboard
  lib/            crypto, auth, db, pricing, anthropicClient, googleAuth,
                  earthEngine, fieldData, mesh, geoEngine, recoveryPlan,
                  publicData, leap, scheduled
frontend/src/
  pages/          16画面（MeshView と LeapReport が最大）
  components/     Layout, MapView(MapLibre GL), MapControlPanel, Explain, ui/*
  lib/            api, auth, displayMode, leapTypes, screeningDoc, pwa
migrations/       0001〜0009（追記のみ）
```

詳細は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## セットアップ

```bash
npm install
npm run build:frontend
npx wrangler d1 migrations apply geo-decision-agent-db --local
npm run dev                    # http://localhost:8787
```

シークレットは `.dev.vars`（gitignore済み）に置く。
必要な値とデプロイ手順は [`docs/OPERATIONS.md`](docs/OPERATIONS.md) を参照。

### 検証

```bash
npm run typecheck:worker
npm run build:frontend
```

**自動テストはありません。** 理由と、足すならどこからかは
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §8。

---

## 本番が正常か確かめる

**「画面が動いているから正常」は成り立ちません。**
Earth Engine が落ちてもアプリは静かにシミュレーション値へフォールバックします。

`/admin` の稼働状況、または D1 を直接：

```sql
SELECT check_name, ok, message, checked_at
FROM system_checks ORDER BY checked_at DESC LIMIT 7;
```

読み方は [`docs/OPERATIONS.md`](docs/OPERATIONS.md) §4。
特に **`gsi_hazard` が「該当地=200／非該当地=404」の両方を報告していること**を必ず確認してください。

---

## 現在の到達点と、残っていること

### 感度の高い地域 5基準（TNFD）

| 基準 | 状態 | 根拠 |
|---|---|---|
| 生物多様性にとって重要な地域 | **判定済** | GBIF ＋ OSM保護区域 |
| 生態系の完全性が高い地域 | **判定済** | 自システム10mメッシュ |
| 完全性が急速に低下している地域 | **判定済** | 自システム10mメッシュ（前年比） |
| 物理的な水リスクが高い地域 | **判定済** | 国土地理院ハザードタイル |
| 生態系サービス供給上、重要な地域 | **代理指標** | 全国規模の権威データが存在しないため |

**「判定不可」はゼロ。** 5番を「判定済」と表示しないのは、
代理指標を評価と偽ることが、この帳票が存在する理由に反するため。

### 本番販売の前に必要なこと

| 項目 | 現状 | 必要なこと |
|---|---|---|
| セキュリティ診断 | 未実施 | SAST/DAST/SCA、ペネトレーションテスト（要件14章・21章） |
| 地図タイルの利用規約 | 無償枠 | 商用提供時に各提供元の規約確認、または有償契約（`MapView.tsx` の1箇所で切替可能） |
| マルチテナント／RBAC | 単一テナント、3ロールのみ | `tenant_id` の追加と全クエリへの適用 |
| SSO / SAML / SCIM | メール＋パスワードのみ | OIDC / SAML連携 |
| 電力設備（FR-040〜047 / V-07） | 未実装 | 設備台帳・流域界・取水口データの受領 |
| 資料取込・文書検索（FR-010〜014） | 未実装 | RAG基盤の追加 |
| 自動テスト | 無し | `mesh.ts` の純関数から着手 |
| OpenStreetMap（保護区域） | 接続済みだが恒常的に混雑 | Cloudflare共有IPへのレート制限。任意項目のため他の判定に影響なし |

FR・V番号ごとの詳細は [`docs/REQUIREMENTS_COVERAGE.md`](docs/REQUIREMENTS_COVERAGE.md)。

---

## 🔴 セキュリティ

- **シークレットは絶対にコミットしない。** `.dev.vars` は `.gitignore` 済み
- コミット前に `git ls-files | grep -i "dev.vars\|\.env"` が空であることを確認
- ワークフローのシェルスクリプト内で `${{ }}` を展開しない（必ず `env:` 経由）
