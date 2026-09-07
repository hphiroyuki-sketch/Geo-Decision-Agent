# ドメイン知識：TNFD / LEAP と、それがコードのどこに対応するか

このシステムのコードは TNFD の枠組みをそのまま構造として持っている。
**この章を読まずに `worker/src/lib/leap.ts` を読むと、1,000行が意味不明な文字列生成に見える。**

---

## 1. TNFD とは

**TNFD（Taskforce on Nature-related Financial Disclosures／自然関連財務情報開示タスクフォース）**。
企業が「自然（生物多様性・生態系）に関するリスクと機会」をどう開示すべきかの国際枠組み。
気候版のTCFDに対応する自然版。

- **4つの柱**: ガバナンス／戦略／リスクと影響の管理／指標と目標
- **14の推奨開示項目**

日本では **SSBJ基準**が FY2027/3 から段階的に義務化（FY2026/3 から任意適用）。
**これが本システムの営業上の追い風であり、顧客が今この話を聞く理由。**

---

## 2. LEAP アプローチ

TNFD が示す評価手順。**スコーピング**の後、4フェーズ・**16コンポーネント**で構成される。

| フェーズ | 意味 | コンポーネント |
|---|---|---|
| **L** — Locate | 自然との接点はどこか | L1–L4 |
| **E** — Evaluate | 何に依存し、何に影響しているか | E1–E4 |
| **A** — Assess | それは重要（material）なリスク・機会か | A1–A4 |
| **P** — Prepare | 何を開示し、何に取り組むか | P1–P4 |

### 16コンポーネントの正式名称（`leap.ts` の `titleEn` と完全一致）

| コード | 英語正式名称 |
|---|---|
| S | Scoping |
| L1 | Business footprint |
| L2 | Nature interface |
| L3 | Priority location identification |
| L4 | Sector identification |
| E1 | Identification of relevant environmental assets and ecosystem services |
| E2 | Identification of dependencies and impacts |
| E3 | Dependency and impact measurement |
| E4 | Impact materiality assessment |
| A1 | Risk and opportunity identification |
| A2 | Existing risk mitigation and management |
| A3 | Risk and opportunity measurement and prioritisation |
| A4 | Risk and opportunity materiality assessment |
| P1 | Strategy and resource allocation plans |
| P2 | Target setting and performance management |
| P3 | Reporting |
| P4 | Presentation |

**英語名を正式名称のまま持っているのは意図的。** 顧客の開示実務担当者やコンサルタントが
TNFDの原文と突き合わせるため。**勝手に意訳・省略しないこと。**

---

## 3. 優先地域（priority locations）と 感度の高い地域（sensitive locations）

TNFD の定義：

> **優先地域 = 重要（material）である ＋ 感度が高い（sensitive）**

「感度の高い地域」には **5つの特性**があり、本システムはこの5つを**明示的に1つずつ**判定する。
これがスクリーニング帳票の第3章。

| # | 特性 | 本システムの状態 | 根拠 |
|---|---|---|---|
| 1 | 生物多様性にとって重要な地域 | **判定済** | GBIF（IUCN絶滅危惧カテゴリ別）＋ OSM保護区域（取得できた場合） |
| 2 | 生態系の完全性が高い地域 | **判定済** | 自システム10mメッシュ（基準ベクトルとの類似度） |
| 3 | 生態系の完全性が急速に低下している地域 | **判定済** | 自システム10mメッシュ（前年比の変化スコア） |
| 4 | 物理的な水リスクが高い地域 | **判定済** | 国土地理院ハザードタイル（洪水・高潮・津波） |
| 5 | 生態系サービス供給上、重要な地域 | **代理指標** | 全国規模の権威データが存在しないため |

### 「判定済／代理指標／判定不可」の区別が本システムの倫理的中核

- **判定済** — 公的データに照会し結果を得た
- **代理指標** — 直接の権威データが無いため他データから推し量った参考値。**判定ではない**
- **判定不可** — 「該当しない」ではない。**データを取得していない／失敗したので判定していない**

**5番を「判定済」と表示しないのは、代理指標を評価と偽ることが、
この帳票が存在する理由そのものに反するから。** コードにもその旨のコメントがある
（`leap.ts` の `ecosystem_services` のブロック）。

---

## 4. ミティゲーション・ヒエラルキー / SBTN AR3T

施策は必ずこの順で提示する。**「回避」が常に最初の選択肢。**

| 段階 | 英語 | 意味 |
|---|---|---|
| 回避 | Avoid | そもそも影響を発生させない（立地を変える等） |
| 低減 | Reduce | 発生する影響を小さくする |
| 回復 | Restore | 損なわれたものを元に戻す |
| オフセット | Offset | 他所での創出で埋め合わせる（**最後の手段**） |

SBTN の **AR3T**（Avoid / Reduce / Restore / Regenerate / Transform）はこれを拡張したもの。
起源は **IFC パフォーマンススタンダード6**。

コード上の対応：`worker/src/lib/recoveryPlan.ts` の `MitigationStage` と `STAGE_LABEL`、
`mitigation_measures.hierarchy_stage`、`recovery_actions.stage`。
システムプロンプト（`anthropicClient.ts`）にも「回避を常に最初に」と明記してある。

---

## 5. 根拠区分（basis）── 全項目に必ず付く

`leap.ts` の `BASIS_LABEL`：

| 値 | 表示 | 意味 |
|---|---|---|
| `measured` | 衛星実測 | Earth Engine から実際に取得した値 |
| `field_confirmed` | 現地確認済み | 査読で confirmed になった現地記録 |
| `map_designated` | 地図上で指定（現地未確認） | 衛星画像上でクリックしたピン |
| `configured` | 登録・設定値 | ユースケース、対象年、メッシュ解像度など人が設定した値 |
| `estimated` | 推定値 | 実データが無く決定的擬似乱数で埋めた値 |
| `missing` | 未取得 | 取得していない／失敗した |

> **`configured` を後から追加した経緯**：当初、ユースケース名や対象年やメッシュ解像度まで
> 「衛星実測」と表示していた。**設定値を測定値と偽っていた。** 実害のある誤りだったので区分を足した。

---

## 6. 対応状況（coverage）── コンポーネント単位

| 値 | 表示 |
|---|---|
| `covered` | 対応 |
| `partial` | 部分対応 |
| `not_covered` | **本システム対象外** |

**「本システム対象外」を正直に書く。** LEAPの16コンポーネントのうち、
衛星データと現地記録から言えることには限りがある。特に
**生態系サービスへの依存の評価**と**重要性（materiality）の判定**は本システムの対象外であり、
帳票の第6章「前提と限界」に明記している。

---

## 7. 帳票の構成（`frontend/src/pages/LeapReport.tsx`）

A4印刷を前提とした6セクション。

```
表紙        対象企業 / 対象案件 / 作成日時 / 本書の位置づけ（法定アセスの代替ではない旨）
1章  スクリーニング結果       地点ごとの判定と根拠
2章  LEAP対応状況            16コンポーネントの対応／部分対応／対象外
3章  感度の高い地域5基準      判定済／代理指標／判定不可 ＋ 参照した公的データの取得状況
4章  各コンポーネント詳細      導きの問い・対応状況・項目ごとの根拠区分・次に必要なこと
5章  データソースと再現情報    データセットID・対象年・EE接続有無・分析ID・ロジック版
6章  前提と限界              ＋ 参照した枠組み ＋ 確認者/承認日の記入欄
```

**書き出しは2経路**：ブラウザ印刷によるPDF（`@media print` で制御）と、
Markdown（`frontend/src/lib/screeningDoc.ts`）。
Markdown経路があるのは、**スクリーニングが企業に届いた後、必ず先方のテンプレートに貼られて編集されるから。**

**両経路とも同じ留保文を必ず運ぶ。** 「法定アセスメントの代替ではない」の一文が
アプリを出た瞬間に落ちる版が存在すると、それが最も危険な出力になる。

---

## 8. 参照した枠組み（帳票にも記載）

- TNFD, *Guidance on the identification and assessment of nature-related issues: the LEAP approach* (v1.1)
- TNFD, *Recommendations of the TNFD*（4つの柱・14の推奨開示）
- SBTN, *AR3T framework*（緩和ヒエラルキー／IFC Performance Standard 6 由来）
