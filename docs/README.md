# ドキュメント一覧

**Geo Decision Agent（ForestScope）** のドキュメント。
初めてこのリポジトリに触る人（人間・AIを問わず）は、この順で読むこと。

---

## 読む順序

| # | 文書 | 内容 | 目安 |
|---|---|---|---|
| 1 | **[ARCHITECTURE.md](ARCHITECTURE.md)** | **何のシステムか／なぜこの形か／モジュール地図／主要な処理の流れ。まずこれ** | 15分 |
| 2 | [DOMAIN.md](DOMAIN.md) | TNFD・LEAP・感度の高い地域5基準・根拠区分。**これを読まないと `leap.ts` が意味不明に見える** | 10分 |
| 3 | [DATA_MODEL.md](DATA_MODEL.md) | D1の全テーブルと、各カラムがなぜ存在するか | 10分 |
| 4 | [EXTERNAL_SERVICES.md](EXTERNAL_SERVICES.md) | Earth Engine / Anthropic / GBIF / 国土地理院 / Overpass / 地図タイル。**制限と失敗時の挙動** | 15分 |
| 5 | [API.md](API.md) | 全エンドポイントと画面ルート | 参照用 |
| 6 | **[DECISIONS.md](DECISIONS.md)** | **ADR。「なぜこうなっているのか」。変更する前に必ず読む** | 15分 |
| 7 | [HISTORY.md](HISTORY.md) | 実際に踏んだ不具合と根本原因。**同じ罠を踏まないため** | 15分 |
| 8 | [OPERATIONS.md](OPERATIONS.md) | デプロイ・シークレット・本番確認・トラブル対応 | 実務時 |

## 目的別

| やりたいこと | 読むもの |
|---|---|
| システムの全体像を掴む | ARCHITECTURE §1〜§4 |
| コードを変更する | DECISIONS 全部 ＋ 該当箇所の ARCHITECTURE §4 |
| 本番の状態を確認する | OPERATIONS §4 |
| デプロイする | OPERATIONS §2〜§3 |
| 帳票の内容を変える | DOMAIN ＋ `worker/src/lib/leap.ts` ＋ `frontend/src/pages/LeapReport.tsx` |
| 外部データ源を足す | EXTERNAL_SERVICES ＋ **DECISIONS ADR-006（負例の必須化）** |
| 不具合を調べる | HISTORY ＋ OPERATIONS §8 |
| 要件との対応を確認する | REQUIREMENTS_COVERAGE.md |

## 経緯の記録（当時の判断のまま残してある文書）

| 文書 | 内容 |
|---|---|
| [BUILD_PLAN.md](BUILD_PLAN.md) | 想定利用者と、その課題から導いたUI方針。実装順序の根拠 |
| [REQUIREMENTS_COVERAGE.md](REQUIREMENTS_COVERAGE.md) | 要件定義書v3.0のFR・V番号ごとの実装状況。§6にv3.0再監査、§7に公的データ接続 |
| [ACCEPTANCE_REVIEW.md](ACCEPTANCE_REVIEW.md) | 受入確認の結果と、意図的に実装しなかったことの記録 |
| [LEAP_SCREENING_PLAN.md](LEAP_SCREENING_PLAN.md) | LEAP調査と帳票設計の計画 |
| [PUBLIC_DATA_PLAN.md](PUBLIC_DATA_PLAN.md) | 公的データ接続の計画。**§6に本番実測値** |

---

## 🔴 変更する前に必ず知っておくこと

1. **Cloudflare Workers 無料プラン：CPU 10ms／サブリクエスト50。**
   設計の大半がここから来ている。miniflare は強制しないので**ローカルで動いても本番で落ちる**
2. **自動テストは無い。** 検証は型検査・ビルド・**本番の定時自己診断**
3. **型が2箇所にある**（`worker/src/lib/leap.ts` と `frontend/src/lib/leapTypes.ts`）。
   片方を変えたらもう片方も変える。型検査では検出されない
4. **出力は企業に渡る文書になる。** 推定を測定と偽らない。取得失敗を「該当なし」にしない
5. **判別できないチェックは、無いより危険**（ADR-006）
6. **シークレットは絶対にコミットしない**（`.dev.vars` は gitignore 済み）
