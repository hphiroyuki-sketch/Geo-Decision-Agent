# データモデル

D1（Cloudflare の SQLite）。マイグレーションは `migrations/` に連番で置き、
`wrangler d1 migrations apply geo-decision-agent-db --remote` で適用される（CIが自動実行）。

**マイグレーションは追記のみ。** 既存ファイルを書き換えると本番と乖離する。

---

## 1. マイグレーション履歴

| ファイル | 追加したもの | 背景 |
|---|---|---|
| `0001_init.sql` | users, invites, sessions, projects, site_candidates, mitigation_measures, conversations, messages, usage_log, decision_reports, report_reviewers, audit_events, settings | 初期スキーマ |
| `0002_field_records.sql` | field_records, embedding_cache | 現地記録の取得と、EE埋め込みのキャッシュ |
| `0003_mesh.sql` | meshes, mesh_cells, mesh_hotspots, recovery_actions | 10mメッシュ（FR-020/026）と回復計画（FR-054） |
| `0004_indices_and_alerts.sql` | indices_cache, alerts, alert_rules, system_checks ＋ mesh_cells に4指標カラム | 分光指標（FR-022）、通知（FR-060）、自己診断 |
| `0005_analyses_and_indices.sql` | analyses ＋ site_candidates に実測指標カラム | 再現性（FR-007 / NFR-010 / UAT-08）とFR-022の実配線 |
| `0006_demo_records.sql` | field_records.demo | デモ用の現地記録を、実観察と決して取り違えられない形で持つ |
| `0007_reference_pins.sql` | field_records.source | 地図上で指定したピンを、現地で撮った写真と区別する |
| `0008_client_name.sql` | projects.client_name | 帳票の表紙に「どの企業向けか」を出す |
| `0009_public_data_cache.sql` | public_data_cache | GBIF / OSM / 国土地理院の応答を状態つきでキャッシュ |

---

## 2. テーブル詳解

### 認証・組織

**`users`** — `id / email(UNIQUE) / name / password_hash / password_salt / role / title / created_at / disabled_at`
`role` は `admin | member | viewer`。`disabled_at` が非NULLならログインできない（行は消さない＝監査のため）。

**`invites`** — `id / code(UNIQUE) / email / role / note / created_by / expires_at / used_by / used_at / created_at`
**このテーブルにコードが無ければ誰もアカウントを作れない。** これが「招待制」の実体。

**`sessions`** — `id / user_id / created_at / expires_at`
Cookie に入るのは `id` そのものではなく **HMAC署名付きトークン**。DB行が消えれば即座に無効。

**`settings`** — `key / value`（KV）
`monthly_budget_jpy`(5000) / `usd_jpy_rate`(155) / `claude_model`(claude-sonnet-5) /
`earth_engine_year`(2024) / `mesh_cell_size_m`(10) / `mesh_extent_m`(200)。
**再デプロイなしで変えられる設定はここに置く**という方針。

**`audit_events`** — `id / actor_id / action / target / detail / created_at`
「誰が何をしたか」。意思決定レポートの監査証跡になる。

---

### 案件と判断

**`projects`** — 案件。`use_case`(UC-01..UC-10) / `status` / `area_ha` / `elevation_min|max` /
`center_lat|lng` / `boundary_geojson` / **`client_name`**（帳票表紙用）

**`site_candidates`** — 比較対象の候補地。AI対話のツール実行が書き込む。

| 主なカラム | 意味 |
|---|---|
| `rank` / `score` | 総合順位とスコア |
| `habitat_overlap` / `protected_area_distance_km` / `connectivity_impact` / `access_distance_km` | 各評価軸 |
| `alphaearth_similarity` | 基準ベクトルとのコサイン類似度（**実測**） |
| `ndre_change_pct` | NDREの前年比変化 |
| **`ndre_measured`** | **0/1。この値が実測かシミュレーションかのフラグ。画面の「実測／推定」表示はこれ** |
| `ndvi / ndre / ndmi / nbr` | Sentinel-2 実測値 |
| `confidence` | 高／中／低。要件9.2の定義（実測データ源の数）で決まる |
| `evidence_basis` | 根拠の内訳（カンマ区切り文字列） |
| `analysis_id` | どの分析run由来か → `analyses` |

**`analyses`** — **再現性の中核。1 run = 1行。**

```
model, prompt_version, engine_version, earth_engine_year,
embedding_dataset, indices_dataset, earth_engine_available,
reference_points, inputs_json, executed_at, replay_of
```

**なぜ必要か：** 「同じIDなら同じ答え」（FR-007 / NFR-010 / UAT-08）を満たすには、
答えを変えうるものを全部記録しておく必要がある。モデルを変えれば答えは変わる。
プロンプトを直しても変わる。判定ロジックを直しても、EEの対象年を変えても変わる。
`analysis_id` は初期からあったが**何を使ったかは記録していなかった**ため、後から追加した。

**`prompt_version` は `anthropicClient.ts` の定数。システムプロンプトを
答えが変わりうる形で書き換えたら必ず上げること。** 上げないと、古い結果が今日の文言で説明されてしまう。

**`mitigation_measures`** — 候補地ごとの回避／低減／回復／オフセット施策
**`decision_reports` / `report_reviewers`** — 意思決定レポートと承認者
**`conversations` / `messages`** — AI対話。`messages` にトークン数・コストも入る

**`usage_log`** — `month(YYYY-MM) / model / input_tokens / output_tokens / cost_usd / cost_jpy`
**予算上限の判定はこのテーブルの当月合計だけを見る。** 他に状態は持たない。

---

### 現地データ

**`field_records`** — 現地記録。**このシステムの「地上の真実」**

| カラム | 注意点 |
|---|---|
| `lat / lng / gps_accuracy_m` | |
| `species_guess / taxon_confidence` | 観察者自身の同定確度 |
| `photo_key / photo_content_type` | R2 のオブジェクトキー |
| `review_status` | `unreviewed / confirmed / rejected`。**`confirmed` のものだけが基準ベクトルに使われる** |
| **`demo`** | **0/1。デモ用に生成した行。** 画面・帳票のあらゆる場所でラベル表示され、一括削除できる |
| **`source`** | **`field`（現地で記録）または `pin`（地図上で指定）** |

> **`demo` と `source` がカラムとして存在する理由**
>
> どちらも「命名規則で済ませず、スキーマに刻む」という判断。
> デモ行が「現地確認済み」として通れば、立地判断の根拠を偽ることになる。
> 衛星画像上でクリックしたピンは、そこに立って撮った写真と同じ証拠ではない。
> **カラムにしてあるので、証拠を数える・ラベルを出すすべての箇所が両者を区別できる。**
> 文字列の接頭辞にしていたら、どこか1箇所で必ず取り違える。

**`embedding_cache`** — `lat / lng / year / vector_json(64要素) / source(earth_engine|simulated) / fetched_at`
**`indices_cache`** — `lat / lng / year / ndvi / ndre / ndmi / nbr / source / fetched_at`（`(lat,lng,year)` UNIQUE）

同じ地点・同じ年は同じ答えなので再取得しない。EEは呼び出しが遅く（数百ms〜数秒）、
サブリクエスト上限にも効くため、キャッシュは性能ではなく**動作可能性**の問題。

---

### メッシュ

**`meshes`** — 1回のメッシュ解析
`center_lat|lng / cell_size_m(10) / extent_m / row_count / col_count / year / detect_change /
with_indices / status(sampling|ready|failed) / reference_points / completed_at`

`reference_points` は基準ベクトルの元になった確認済み記録の数。**0だと類似度が計算できない。**

**`mesh_cells`** — 1マス。`row_idx / col_idx` の整数座標を持つので、
**隣接判定が単純な算術になる**（ホットスポットの塗りつぶし探索のため）

| カラム | 意味 |
|---|---|
| `status` | `pending / sampled / failed` |
| `reference_similarity` | 基準ベクトルとのコサイン |
| `change_score` | `1 - cos(今年, 前年)` |
| `cell_class` | `priority_a / similar / changed / baseline / unscored` |
| `ndvi/ndre/ndmi/nbr` | 任意（`with_indices` が1のとき） |
| `hotspot_id` | 所属ホットスポット |

**`mesh_hotspots`** — 隣接する同クラスのマスをまとめたもの
`cell_class / rank / cell_count / area_ha / center_lat|lng / mean_similarity / mean_change /
compactness(0-1, 高いほど連続) / importance`

**`recovery_actions`** — ホットスポットに紐づく施策
`stage(avoid|reduce|restore|offset) / title / description / expected_change / indicator /
frequency / area_ha / priority / owner_user_id / due_date / status`

**施策が必ずホットスポットに紐づくのは意図的。** 「どの土地に対する施策か」を言えない提案は、
実行できないので価値がない。

---

### 監視

**`alerts`** — `severity(high|medium|low) / category(threshold|review|data|system) /
title / detail / next_action / lat|lng / link / source_id / read_at / acknowledged_by`

`(category, source_id)` に UNIQUE。**同じ事象で何度も鳴らないための重複排除。**
`next_action` があるのは、**何が起きたかだけ告げるアラートは無視されるから。**

**`alert_rules`** — 画面から変更できるしきい値。初期値：

| id | metric | 比較 | 閾値 | 重要度 |
|---|---|---|---|---|
| `rule_change_high` | change_score | ≧ | 0.15 | high |
| `rule_ndvi_drop` | ndvi_drop | ≧ | 0.15 | medium |
| `rule_similarity_high` | similarity | ≧ | 0.85 | low |

**`system_checks`** — `check_name / ok / message / detail / duration_ms / checked_at`
定時自己診断の結果。`cron_heartbeat / ee_embedding / ee_indices / ee_algorithms / gbif / gsi_hazard / osm_protected`。
**本番の健康状態を知る唯一の場所。** ここを見ずに「動いているはず」と言ってはいけない。

**`public_data_cache`** — `source / lat / lng / payload_json / status / error / fetched_at`
`(source, lat, lng)` に UNIQUE。座標は約100mに丸めてあるので近い拠点は同じ行を共有する。

`status` は `ok | failed | busy | empty`。
**失敗を payload の欠如ではなく「記録された事実」として持つ。** 到達できなかった源を
黙って落とした帳票は「そこには何も無い」と読め、真実の逆になるため。
`failed` / `busy` のキャッシュ寿命は **1時間**、`ok` は 30日（`readCache` の `maxAge` 分岐）。

---

## 3. 参照関係（主要なものだけ）

```
users ──< projects ──< site_candidates ──< mitigation_measures
                   │                └── analyses (analysis_id)
                   ├─< conversations ──< messages
                   ├─< field_records          (confirmed のみ基準ベクトルへ)
                   ├─< meshes ──< mesh_cells
                   │           └─< mesh_hotspots ──< recovery_actions
                   ├─< decision_reports ──< report_reviewers
                   └─< alerts

（座標キーで参照するのみ、外部キー無し）
  embedding_cache / indices_cache / public_data_cache
```

---

## 4. 変更するときの注意

- **しきい値を変えたら `geoEngine.ts` の `ENGINE_VERSION` を上げる。** 上げないと、
  異なるロジックの結果が同じバージョンとして並び、比較できなくなる。
- **システムプロンプトを変えたら `PROMPT_VERSION` を上げる。** 同上。
- **`cell_class` の値を増やすなら**、`mesh.ts` の `CELL_CLASS_LABEL` / `CELL_CLASS_COLOR`、
  フロントの凡例、`leap.ts` の集計の3箇所を必ず揃える。
- **`field_records` に「証拠として数えるかどうか」に関わる列を足すときは**、
  `fieldData.ts` の `getReferenceEmbedding()` と `leap.ts` の根拠区分の両方を見直すこと。
