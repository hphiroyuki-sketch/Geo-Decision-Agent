# 変更履歴（CHANGELOG）

このファイルには、利用者・関係者に関係する変更を**版ごとに、人が読む言葉で**残す。
形式は [Keep a Changelog 1.1.0](https://keepachangelog.com/ja/1.1.0/)、
版番号は [セマンティックバージョニング](https://semver.org/lang/ja/) に従う。
手順は `docs/DEVELOPMENT_WORKFLOW.md`。

分類：**追加**（新機能）／**変更**（既存機能の変更）／**非推奨**／**削除**／**修正**（不具合）／**セキュリティ**

## [Unreleased]

### 追加
- データの仕組みを説明する ER 図（`docs/er-diagram/`）。25 テーブルを7つの役割の区画に分け、
  中学生向けと専門家向けの説明を併記。マイグレーションから機械的に生成し、存在しない列や外部キーが図に載らないよう検査する
- システムのしくみ図（`docs/system-map/`）。Cloudflare・Claude・Google Earth Engine・公的データ・GitHub の
  組み合わせを7つの場面で説明。衛星エンベディングの測り方の図解つき
- 開発とリリースの手順書（`docs/DEVELOPMENT_WORKFLOW.md`）、この CHANGELOG、PR のひな形、
  PR 用の自動検査（`.github/workflows/ci.yml`。デプロイはしない）
- AI チームの定義（`.claude/agents/`）と、作業の記憶（`docs/memory/`）

## [0.1.0] - 2026-09-07

最初の基準版。2026-09-07 時点で本番に出ていた内容（コミット `620ca71`）。
これより前の経緯は `docs/HISTORY.md` を参照。

### 追加
- 招待制のログイン、Claude との対話（月 ¥5,000 の予算上限つき）
- 現地記録（写真・GPS・種の候補）と、Google Earth Engine の衛星エンベディング・植生指数の取得
- 10m メッシュ解析、重要エリアの抽出、回復施策（回避→低減→再生→代償）
- TNFD LEAP に沿ったスクリーニング帳票（A4 印刷／PDF・Markdown 出力）
- 公的データ接続：GBIF（生物の記録）、国土地理院ハザードマップ、OpenStreetMap の保護区
- 5分ごとの本番自己診断（`system_checks`）とアラート
- 引き継ぎ用の設計文書一式（`docs/`）と、初めての利用者向け操作ガイド（`docs/manual/`）
