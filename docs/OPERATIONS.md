# 運用ガイド

デプロイ、シークレット、本番確認、トラブル対応。**引き継ぎのときはここを最初に渡すこと。**

---

## 1. 本番環境

| 項目 | 値 |
|---|---|
| URL | `https://geo-decision-agent.hphiroyuki.workers.dev` |
| Worker名 | `geo-decision-agent` |
| D1 データベース | `geo-decision-agent-db` / ID `b66fbe2c-b2f0-411c-a38c-adcbaac3e003` |
| R2 バケット | `geo-decision-agent-photos`（現地記録の写真） |
| cron | `*/5 * * * *`（自己診断＋アラート生成） |
| 開発ブランチ | `claude/ai-chat-app-build-s7fut7` |

**公開はしていない。招待制。** `invites` テーブルにコードが無ければ誰もアカウントを作れない。

---

## 2. デプロイ

**このブランチへ push すると GitHub Actions が自動デプロイする。** これが通常経路。

`.github/workflows/deploy.yml` が行うこと：

```
npm ci
npm run build:frontend
wrangler d1 migrations apply geo-decision-agent-db --remote   ← マイグレーション自動適用
wrangler r2 bucket create geo-decision-agent-photos || true
wrangler deploy
wrangler secret put …（シークレットの再投入）
```

ローカルPCから直接デプロイする場合は `npm run deploy`。
**ただし開発サンドボックスからは Cloudflare API に到達できない**ので、そこでは使えない。

---

## 3. シークレット

### GitHub Actions（Settings → Secrets and variables → Actions）

| 名前 | 内容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare APIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| `ANTHROPIC_API_KEY` | Claude APIキー |
| `APP_SESSION_SECRET` | セッション署名用ランダム文字列（`openssl rand -hex 32`） |
| `EE_SERVICE_ACCOUNT_JSON`（任意） | Earth Engine権限を持つGoogleサービスアカウントのJSON鍵の中身 |
| `EE_PROJECT_ID`（任意） | EE登録済みGCPプロジェクトID |

### 🔴 絶対に守ること

- **シークレットをリポジトリにコミットしない。** `.dev.vars` は `.gitignore` 済み。
  コミット前に `git ls-files | grep -i "dev.vars\|\.env"` が空であることを確認する
- **シークレットをログに出さない。チャットに貼らない。**
- ワークフローで **`${{ }}` をシェルスクリプト内に展開しない。** 必ず `env:` 経由で渡す。
  サービスアカウント鍵はダブルクォート塗れのJSONで、インライン展開すると
  シェル構文が壊れ、**その失敗が `if` に飲まれて鍵が黙って設定されない**という事故が実際に起きた
  （`deploy.yml` のコメント参照）

---

## 4. 本番が正常か確かめる（最重要の手順）

**「画面が動いているから正常」は成り立たない。** Earth Engine が落ちても
アプリは静かにシミュレーション値へフォールバックし、普通に見える。

### 手順A：管理画面

`/admin` → 衛星データ連携の稼働状況、または `/alerts` の自己診断セクション。

### 手順B：D1を直接読む（確実）

```sql
SELECT check_name, ok, message, checked_at
FROM system_checks ORDER BY checked_at DESC LIMIT 7;
```

正常時は5分毎に7行が揃う：

| check_name | 期待される message |
|---|---|
| `cron_heartbeat` | `cron */5 * * * *` |
| `ee_embedding` | `ok (64次元)` |
| `ee_indices` | `ok` |
| `gbif` | `ok (87,678件)` のような件数つき |
| `gsi_hazard` | **`ok（判別可: 該当地=200/…、非該当地=404）`** |
| `osm_protected` | `ok (…件 / ホスト名)` **または** `混雑（全ミラーが応答不可／任意項目のため判定への影響なし）` |

### 🔴 `gsi_hazard` の読み方

**「該当地=200／非該当地=404」の両方が出ていること**を必ず確認する。
これが出ていない、あるいは両方200なら、**その判定は信用してはいけない**。
「どこでも該当あり」と企業向け文書に印字される状態になる。

### `osm_protected` の読み方

**「混雑」は正常。** Overpass は Cloudflare の共有IPに対してレート制限をかけるため、
繋がらないのが通常状態。**赤（ok=0）のときだけ調べる価値がある**
（429以外の4xx、DNSエラー、パースエラーのいずれか。WAFがUser-Agentを弾き始めた可能性を疑う）。

---

## 5. ローカル開発

```bash
npm install
npm run build:frontend
npx wrangler d1 migrations apply geo-decision-agent-db --local
npm run dev                    # http://localhost:8787
```

シークレットは `.dev.vars`（gitignore済み）に置く：

```
ANTHROPIC_API_KEY=...
SESSION_SECRET=...
EE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

**注意**: miniflare は CPU 10ms 制限を強制しない。
**ローカルで動いても本番で落ちることがある。** メッシュや暗号処理を触ったら本番で確認すること。

### 検証コマンド

```bash
npm run typecheck:worker    # Worker の型検査
npm run build:frontend      # フロントのビルド（tsc -b を含む）
```

**自動テストは無い。** 理由と、テストを足すならどこからかは `docs/ARCHITECTURE.md` §8。

---

## 6. 設定の変更（再デプロイ不要）

`/admin` 画面または D1 の `settings` テーブル：

| キー | 既定 | 内容 |
|---|---|---|
| `monthly_budget_jpy` | 5000 | **月間AI利用上限（円）。超えると当月チャット停止** |
| `usd_jpy_rate` | 155 | コスト換算レート |
| `claude_model` | `claude-sonnet-5` | 使用モデル |
| `earth_engine_year` | 2024 | 衛星データの対象年 |
| `mesh_cell_size_m` | 10 | メッシュ解像度 |
| `mesh_extent_m` | 200 | メッシュ範囲 |

> **モデルを変えるときは `worker/src/lib/pricing.ts` の単価表にも追加すること。**
> 表に無いモデルは `claude-sonnet-5` の単価で計算され、予算判定がずれる。

しきい値（`alert_rules`）は `/alerts` 画面から変更できる。

---

## 7. 管理者アカウント

初回、`hphiroyuki@gmail.com` 宛の招待コードを1件だけD1に登録済み。
`/register` からそのコードで作成すると `admin` ロールになる。
以後は `/admin` から招待コードを発行する。

---

## 8. トラブル対応

### 「メッシュが途中で止まる」

サンプリングは16件バッチで、失敗すると3回まで再試行してから残りを諦める。
**画面の「続きから再開」ボタン**で pending のマスから再開できる。
根本原因は `mesh_cells.error` 列に記録されている。

### 「解析しても全部同じ色になる／ホットスポットが0件」

基準地点の分布を疑う。**基準地点が全部同じ場所（数十m以内）に固まっていると、
そこだけが高類似度になり、意味のある差が出ない。**
また**基準地点が対象地から遠すぎる**（数百km）と、全マスが低類似度になる。
画面に距離の警告が出るようになっている。地図上でピンを置き直すのが対処。

### 「衛星データが取れていない気がする」

`GET /api/admin/ee-test` を段階診断として使う。失敗した段階と上流の生エラーが返る。
式グラフの関数名が原因の場合は `GET /api/admin/ee-algorithms?q=…` で正しい名前を確認する
（クライアントライブラリのメソッド名とは違う → `docs/EXTERNAL_SERVICES.md`）。

### 「チャットが応答しない」

予算上限に達している可能性。`/admin` の利用状況を確認。
SSEで `budget_exceeded` が返っていれば仕様どおりの停止。

### 「地図が真っ白／メッシュが表示されない」

`MapView.tsx` の待ち合わせロジックを疑う。**`isStyleLoaded()` は使ってはいけない**
（理由は `docs/DECISIONS.md` ADR-013）。目的のレイヤーが addressable かを直接聞くこと。

### 「デプロイは成功したのにcronの結果が更新されない」

`system_checks` の `cron_heartbeat` を見る。
**heartbeat があるのに他が無い＝チェックの途中でCPU上限に達している。**
heartbeat も無い＝cronトリガー自体が発火していない（Cloudflareダッシュボードで確認）。

---

## 9. 本番販売の前に必要なこと

| 項目 | 現状 | 必要なこと |
|---|---|---|
| セキュリティ診断 | 未実施 | SAST / DAST / SCA、ペネトレーションテスト（要件14章・21章） |
| 地図タイルの利用規約 | 無償枠を使用 | 商用提供時に各提供元の規約確認、または有償契約（`MapView.tsx` の1箇所で切替可能） |
| マルチテナント | 単一テナント | `projects` に `tenant_id` を追加し全クエリに通す |
| SSO / SAML / SCIM | メール＋パスワードのみ | OIDC / SAML連携 |
| 電力設備（FR-040〜047 / V-07） | 未実装 | 設備台帳・流域界・取水口データの受領 |
| 資料取込・文書検索（FR-010〜014） | 未実装 | RAG基盤の追加 |
| PBKDF2 反復回数 | 10,000（CPU制約） | 有料プラン移行時に引き上げ＋移行処理 |
| 自動テスト | 無し | `mesh.ts` の純関数から着手（`ARCHITECTURE.md` §8） |
