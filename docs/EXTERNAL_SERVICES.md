# 外部サービス連携

このシステムは6つの外部サービスに依存する。**それぞれの認証方式・制限・失敗時の挙動**を記す。
新しく入る人が最も時間を溶かすのはここなので、実測で分かったことを全部書いてある。

---

## 1. Google Earth Engine ★中核

**用途**: 衛星データの実取得。このシステムの判定の根拠そのもの。

| 項目 | 内容 |
|---|---|
| API | REST `POST https://earthengine.googleapis.com/v1/projects/{project}/value:compute` |
| 認証 | サービスアカウントの **RFC 7523 JWT bearer flow**（`lib/googleAuth.ts`） |
| シークレット | `EE_SERVICE_ACCOUNT_JSON`（鍵JSONの中身）、`EE_PROJECT_ID`（任意） |
| データセット | `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`（64次元 A00–A63）／`COPERNICUS/S2_SR_HARMONIZED`（NDVI/NDRE/NDMI/NBR） |
| 未設定時 | **静かにシミュレーション値へフォールバックする**（後述の注意） |

### JWT署名をWebCryptoで自前実装している理由

Workers に Node の `crypto` が無く、`googleapis` も動かない。よって
`{alg:RS256}` ヘッダ＋クレームを自分でbase64url化し、`crypto.subtle` の RSASSA-PKCS1-v1_5 で署名して
`https://oauth2.googleapis.com/token` に投げている。トークンはモジュールスコープで
有効期限までキャッシュ（`cachedToken`）。

### 式グラフの落とし穴（ここで何日も溶かした）

`value:compute` に渡すのは**サーバー側関数名の完全一致**を要求する式グラフであり、
Python/JS クライアントライブラリのメソッド名とは**違う**。

- ❌ `filterDate` → ✅ `Collection.filter` ＋ `Filter.dateRangeContains` 相当
- ❌ `Collection.filterBounds` → **サーバー側に存在しない**（実装当初これで落ちていた）
- 式グラフ全体を **`Expression` でラップ**する必要がある（`asExpression()`）

**名前を確定させる手段**: `GET /api/admin/ee-algorithms?q=filter`（管理者のみ）。
EEが実際に公開している関数名と引数名を検索できる。**推測せずここで確認すること。**
このエンドポイントは応答が約1MBあり、CPU 10ms 制約に触れるため **cronからは外してある**。

### 診断

`GET /api/admin/ee-test?lat=&lng=&year=&nofilter=1`（管理者のみ）
鍵の有無 → 鍵の解析 → OAuth → 実サンプリング、と**段階ごとに**判定し、
失敗した段階と上流の生エラーを返す（鍵の中身は返さない）。`nofilter=1` で日付フィルタを外して切り分ける。

### ⚠️ 最も危険な性質

**EEが失敗すると、分析フローは静かにシミュレーション値へフォールバックする。**
画面は普通に動き、数字も出る。**それが実測かシミュレーションかは
`analyses.earth_engine_available` と `site_candidates.ndre_measured` を見ないと分からない。**

だから定時自己診断（`ee_embedding` / `ee_indices`）が存在する。
**「動いているように見えるから動いている」と判断してはいけない。**

---

## 2. Anthropic Claude API

| 項目 | 内容 |
|---|---|
| SDK | `@anthropic-ai/sdk` |
| モデル | `settings.claude_model`（既定 `claude-sonnet-5`） |
| シークレット | `ANTHROPIC_API_KEY` |
| 呼び出し | `messages.stream()`、`max_tokens: 4096`、`thinking: disabled`、ツールは `analyze_site_candidates` 1本のみ |
| ホップ上限 | **3**（無限ループとコスト暴走の防止） |
| プロンプトキャッシュ | システムプロンプトに `cache_control: ephemeral` |

### 予算上限 ── ¥5,000/月で自動停止

```
usage_log の当月 cost_jpy 合計 ≧ settings.monthly_budget_jpy
  → SSE で budget_exceeded を返し、Claudeを呼ばずに終了
```

単価表は `lib/pricing.ts` の静的テーブル。**外部から取らない**（価格改定は再デプロイで足りる頻度）。
USD→JPY は `settings.usd_jpy_rate`（既定155）。

**上限に達したら当月はチャットが止まる。** これは仕様であり不具合ではない。
管理画面から上限を上げれば再開する。

---

## 3. GBIF（地球規模生物多様性情報機構）★接続済み

| 項目 | 内容 |
|---|---|
| API | `https://api.gbif.org/v1/occurrence/search` |
| 認証 | **不要** |
| クエリ | `geoDistance=<lat>,<lng>,3km`、`facet=iucnRedListCategory` |
| 用途 | 半径3km以内の生物記録数と、IUCN絶滅危惧カテゴリ（CR/EN/VU）別の件数 |
| 本番実測 | `ok (87,678件)` / 125–192ms（東京駅） |

**留保**: 研究者・市民による観察記録の集積。**記録が無いことは生息していないことを意味しない。**
帳票にこの注記が必ず付く。

---

## 4. 国土地理院 ハザードマップポータル ★接続済み

| 項目 | 内容 |
|---|---|
| API | `https://disaportaldata.gsi.go.jp/raster/<layer>/{z}/{x}/{y}.png` |
| 認証 | **不要** |
| ズーム | **16 固定**（1タイル ≒ 600m四方） |
| 本番実測 | `ok（判別可: 該当地=200/3977B、非該当地=404）` / 1.1–2.3秒 |

### レイヤー

| キー | レイヤーパス | 種別 |
|---|---|---|
| `flood` | `01_flood_l2_shinsuishin_data` | 洪水浸水想定（想定最大規模） |
| `hightide` | `03_hightide_l2_shinsuishin_data` | 高潮浸水想定 |
| `tsunami` | `04_tsunami_newlegend_data` | 津波浸水想定 |
| `steep` | `05_kyukeishakeikaikuiki` | 土砂災害警戒区域（急傾斜地の崩壊） |
| `debris` | `05_dosekiryukeikaikuiki` | 同（土石流） |
| `slide` | `05_jisuberikeikaikuiki` | 同（地すべり） |

### PNGをデコードしていない理由

タイルの1ピクセルを読むには PNG 全体の inflate と unfilter が必要で、**CPU 10ms に収まらない。**
そして不要でもある — **この配信はデータの無い場所で 404 を返す**ので、
「該当区域が存在するか」は HTTP ステータスだけで答えられる。

```
404      → present: false
!ok      → present: null（判定不可）
ok       → present: (バイト数 > 1000)
```

**代償は粒度。** z16タイルは約600m四方なので、帳票は
「この約600m四方の範囲内に指定区域がある」と書き、
「この地点が区域内にある」とは**書かない**。実際に計算した範囲の数値もそのまま印字する。

### 自己診断が正例と負例の両方を叩く理由

水リスク判定はこの「200/404の区別」に全面依存する。
**正例（東京都心 z16/58205/25807＝荒川浸水想定区域内）だけを確認していたら、
どこでも200を返すサービスでも診断は緑になり、全拠点が「該当あり」と印字される。**
よって負例（富士山頂 z16/58022/25882）も叩き、**両者を区別できなければ診断を失敗させる。**

---

## 5. OpenStreetMap / Overpass ★接続済みだが恒常的に混雑

| 項目 | 内容 |
|---|---|
| API | Overpass QL を POST |
| 認証 | **不要** |
| クエリ | 半径10km以内の `boundary=national_park` / `leisure=nature_reserve` / `boundary=protected_area` |
| ミラー | `overpass-api.de` → `overpass.kumi.systems` → `overpass.private.coffee`（順に試す） |
| タイムアウト | 20秒 |
| 本番実測 | **3ミラーとも 521 / 429 / 429**。時間帯により 406＋タイムアウト×2 |

### なぜ繋がらないか（構造的な問題）

**Overpass の各インスタンスは送信元IP単位でレート制限をかける。
Cloudflare Workers はプラットフォーム全体で共有の送信元IPから外へ出る。**
つまり我々のリクエスト量とは無関係に 429 が返る。ミラーを3つにしても解決しない。

### だから「失敗」と「混雑」を分けた

`isProviderSideStatus()` / `isProviderSideError()`（`publicData.ts`）が判定する：

| 条件 | 分類 | 帳票の表示 |
|---|---|---|
| HTTP 429、HTTP 5xx、タイムアウト | **提供側の事情** | 琥珀色「提供元が混雑」＋「他の判定には影響しません」 |
| 429以外の4xx、DNSエラー、パースエラー | **こちら側の事情** | 赤「取得失敗」 |

**同じ関数をライブ取得と定時自己診断の両方で使う。** 別々に書くと必ず食い違う
（実際に一度食い違った → `docs/HISTORY.md`）。

定時診断も、全ミラーが提供側事情で応答不可なら**緑**にする。
毎日赤い行が出る管理画面は、担当者が読まなくなるため。

**重要**: この源が取れなくても、生物多様性基準の判定は **GBIF単独で成立する**。
保護区域は判定を補強する任意項目であり、依存項目ではない（`PUBLIC_DATA_SOURCES` の `optional: true`）。

### 接続していない代替: Protected Planet / WDPA

OSMより権威あるが**トークン申請が必要**。機能を書類手続きに依存させたくないため必須にしていない。
設定にトークンを登録したときだけ有効化する任意接続とするのが将来の形。

---

## 6. 地図タイル（フロントエンド）

`frontend/src/components/MapView.tsx` の **1箇所**で定義。商用提供時はここを差し替える。

| 用途 | 提供元 |
|---|---|
| 航空写真（日本） | 国土地理院 `cyberjapandata.gsi.go.jp/xyz/{path}/{z}/{x}/{y}.jpg`（年代切替あり） |
| 道路地図 | OpenStreetMap `tile.openstreetmap.org` |
| 衛星画像（全球） | Esri `server.arcgisonline.com/.../World_Imagery` |
| 地名ラベル | Esri `World_Boundaries_and_Places` |
| 標高（3D地形） | AWS `s3.amazonaws.com/elevation-tiles-prod/terrarium`（Terrarium形式） |

いずれも無償枠。**商用提供の前に各提供元の利用規約を確認すること。**

---

## 7. サンドボックス（開発環境）からは外部に出られない

ビルド環境からは以下すべてに到達できない：

`earthengine.googleapis.com` / `api.gbif.org` / `disaportaldata.gsi.go.jp` /
`overpass-api.de` / `api.cloudflare.com` / `*.workers.dev`

**帰結：**
1. デプロイは **GitHub Actions 経由のみ**（`npm run deploy` はローカルPCからしか使えない）
2. 外部API疎通の確認は**本番の定時自己診断＋D1直読み**でしか行えない
3. ヘッドレスChromiumはWebGLを初期化するが **MapLibreが何も描画しない**ため、
   地図表示はこの環境では目視検証できない

**これがアーキテクチャの形を決めている。** 「本番が自分を診断して結果をDBに書く」設計は
好みではなく、この制約への対応。
