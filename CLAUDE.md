# Geo Decision Agent — 作業ガイド

このファイルは、このリポジトリで作業するすべての人（AIエージェントを含む）への指示。

---

## 最初にすること

**`docs/README.md` を読み、そこの読む順序に従うこと。**
特に `docs/ARCHITECTURE.md` と `docs/DECISIONS.md` は変更を加える前に必読。

このリポジトリは**過去のセッションの記憶に依存しない**よう文書化してある。
会話履歴が失われていても、`docs/` を読めば完全に理解できる状態を維持すること。
**したがって、設計判断を伴う変更をしたら `docs/` も同じコミットで更新する。**

---

## このシステムの性質（最重要）

出力は**企業に渡すスクリーニング文書**になる。営業の場で見せ、見込み客の拠点について
TNFD LEAP に沿った判定を返す。だから次は譲れない。

1. **推定を測定と偽らない。** 全項目に根拠区分（`BASIS_LABEL`）が付く
2. **取得失敗を「該当なし」にしない。** 失敗は事実として記録し「判定不可」と表示する
3. **判別できないチェックは、無いより危険。** 新しいデータ源は
   **必ず「該当する場所」と「該当しない場所」の両方**で確かめる（ADR-006）
4. **LLMに数値を作文させない。** 数値は決定的なエンジンが出す

---

## プラットフォーム制約（違反すると本番でだけ落ちる）

| 制約 | 意味 |
|---|---|
| **CPU 10ms／呼び出し** | 重いパース・暗号処理・画像デコードは不可 |
| **サブリクエスト 50／リクエスト** | メッシュは16件バッチ。外部API呼び出しを増やすときは数える |
| **miniflare は上限を強制しない** | **ローカルで動いても本番で落ちる。** 該当箇所を触ったら本番で確認 |

---

## 作業の進め方

### ブランチ

`claude/ai-chat-app-build-s7fut7` で作業し、ここへ push する。
**push すると GitHub Actions が自動でデプロイする**（マイグレーション適用を含む）。

### 検証

```bash
npm run typecheck:worker    # Worker の型検査
npm run build:frontend      # フロントのビルド（tsc -b 込み）
```

**自動テストは無い。** 外部API疎通はサンドボックスから確認できないので、
**デプロイ後に本番D1の `system_checks` を読んで確かめる**（`docs/OPERATIONS.md` §4）。

### 本番確認

```sql
SELECT check_name, ok, message, checked_at
FROM system_checks ORDER BY checked_at DESC LIMIT 7;
```

D1 ID: `b66fbe2c-b2f0-411c-a38c-adcbaac3e003`

**「画面が動いているから正常」は成り立たない。** Earth Engine が落ちても
アプリは静かにシミュレーション値へフォールバックし、普通に見える。

---

## 🔴 やってはいけないこと

- **シークレットをコミット・出力・ログ出力しない。** `.dev.vars` は gitignore 済み。
  コミット前に `git ls-files | grep -i "dev.vars\|\.env"` が空であることを確認
- **ワークフローのシェルスクリプト内で `${{ }}` を展開しない。** 必ず `env:` 経由
  （鍵JSONでシェル構文が壊れ、失敗が握り潰された事故がある）
- **`map.isStyleLoaded()` を使わない**（ADR-013）
- **マイグレーションファイルを書き換えない。** 追記のみ
- **判定しきい値を変えたら `ENGINE_VERSION` を上げる。**
  システムプロンプトを変えたら `PROMPT_VERSION` を上げる
- **`leap.ts` の型を変えたら `frontend/src/lib/leapTypes.ts` も変える。**
  型検査では検出されない
- **`settings.claude_model` に新しいモデルを設定するなら
  `worker/src/lib/pricing.ts` の単価表にも追加する**

---

## コードの書き方

- 既存コードのコメント密度・命名・書き方に合わせる。
  **このコードベースは「なぜそうしたか」をコメントに残す方針**で書かれている。踏襲すること
- ユーザー向けの文言はすべて日本語。専門用語は結論→理由→次の行動の順で
- コミットメッセージは**何を変えたかではなく、なぜ変えたか**を書く（既存の履歴を見ること）

---

## 主要なファイル

| やりたいこと | 見る場所 |
|---|---|
| 判定しきい値 | `worker/src/lib/mesh.ts`（`CHANGED_THRESHOLD` / `PRIORITY_A_THRESHOLD` / `SIMILAR_THRESHOLD`） |
| システムプロンプト・ツール定義 | `worker/src/lib/anthropicClient.ts` |
| Earth Engine の式グラフ | `worker/src/lib/earthEngine.ts` |
| 公的データ接続 | `worker/src/lib/publicData.ts` |
| LEAP帳票の中身 | `worker/src/lib/leap.ts` ＋ `frontend/src/pages/LeapReport.tsx` |
| 地図の挙動 | `frontend/src/components/MapView.tsx` |
| 予算上限 | `worker/src/lib/pricing.ts` ＋ `worker/src/routes/chat.ts` |
| 本番の自己診断 | `worker/src/lib/scheduled.ts` |
