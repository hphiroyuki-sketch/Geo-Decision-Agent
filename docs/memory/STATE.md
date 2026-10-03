# 現在地（STATE）

**最終更新：2026-10-03（説明資料2点の作成、バージョン管理の手順導入、チームと記憶の仕組みを追加）**

このファイルは上書きで保つ。経緯は `docs/HISTORY.md`、会話の全記録は Google Drive「Geo Decision Agent — 会話と作業の記録」。

---

## 本番

- URL：`geo-decision-agent.hphiroyuki.workers.dev`（Cloudflare Workers 無料プラン）
- 本番で動いている版：**v0.1.0 相当（コミット `620ca71`、2026-09-07）**
- デプロイの仕組み：`claude/ai-chat-app-build-s7fut7` へ push すると自動デプロイ（**main への切り替えは未実施・創業者の判断待ち**）
- 健全性の確認：本番 D1 の `system_checks`（`docs/OPERATIONS.md` §4）

## リポジトリ

- `hphiroyuki-sketch/geo-decision-agent`、**公開（public）**
- ブランチは `claude/ai-chat-app-build-s7fut7` の1本。タグ `v0.1.0`（`620ca71`）をローカルに作成（push 待ち）
- 2026-10-03 の作業はローカルにコミット（このファイルと同じコミット）。**push は本番デプロイを伴うため、創業者の了承待ち**

## 2026-10-03 にできたもの

| もの | 場所 | 公開先（非公開アーティファクト） |
|---|---|---|
| ER 図（データの仕組み） | `docs/er-diagram/` | https://claude.ai/artifact/LXctZTR9N7p9aK5eWoGPv4 |
| しくみ図（技術構成） | `docs/system-map/` | https://claude.ai/artifact/Pa4kvk7MTwLQV7zmbaw2yh |
| 開発とリリースの手順 | `docs/DEVELOPMENT_WORKFLOW.md` | — |
| 変更履歴 | `CHANGELOG.md` | — |
| PR 用の自動検査（デプロイしない） | `.github/workflows/ci.yml` | — |
| AI チーム | `.claude/agents/`（researcher・code-auditor・reviewer・recorder） | — |
| 記憶の置き場所 | `docs/memory/` | — |
| 操作ガイド（既存） | `docs/manual/` | https://claude.ai/code/artifact/f4df6931-8fff-4f68-8aec-44cd67f85dc1 |

## 🟡 創業者の判断待ち

1. **push してよいか**（＝今のブランチへの push は本番デプロイになる。中身は文書と CI の追加のみで、本番の動作は変わらない）
2. **main への移行**：main を作って既定ブランチにし、本番デプロイのきっかけを main へのマージに切り替える（`DEVELOPMENT_WORKFLOW.md` §10）
3. main のブランチ保護の設定（同 §10-3。GitHub の画面で創業者が行う）
4. Workers Paid にするか（D1 の巻き戻し期間 7日 → 30日）
5. 検証環境（staging）を持つか

## 直す候補（棚卸しで見つかったずれ。`docs/system-map/` の末尾にも掲載）

- 植生指数：コメントは SCL による雲マスクに触れているが、実装は単純な年間メディアン（`worker/src/lib/earthEngine.ts:330`）
- Earth Engine 呼び出しにタイムアウトと再試行が無い（`earthEngine.ts:127`）
- ARCHITECTURE.md の「指数的バックオフ」は実装と違う（線形・3回で停止、`MeshView.tsx:299-303`）
- ARCHITECTURE.md のサブリクエスト数（32）は、お手本作成と認証を数えていない（最悪で約38）
- EXTERNAL_SERVICES.md の GBIF の説明に `facet=speciesKey` の呼び出しが無い
- 操作ガイドの地図の画面写真3枚は、実ブラウザで撮り直しが必要（サンドボックスでは地図タイルが出ない）

## 次の一手

- 創業者の判断（上の 1〜2）を受けて、push → main 化 → `deploy.yml` の改善（`DEVELOPMENT_WORKFLOW.md` §11）
- 上の「直す候補」を1つずつ PR で直す（しきい値に触れる場合は `ENGINE_VERSION` を上げる）
