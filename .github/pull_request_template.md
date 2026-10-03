## なぜ変えるのか
<!-- 何を変えたかではなく、なぜ変えたか。利用者や本番にどう効くか -->

## 何を変えたか
-

## 確認したこと
- [ ] `npm run typecheck:worker`
- [ ] `npm run build:frontend`
- [ ] 新しいデータ源・判定は「該当する場所」と「該当しない場所」の両方で確かめた（ADR-006）／該当なし
- [ ] デプロイ後に本番 D1 の `system_checks` を確認する（外部 API に触れた場合）

## 守るべき約束（該当するものにチェック）
- [ ] 判定しきい値を変えた → `ENGINE_VERSION` を上げた
- [ ] システムプロンプトを変えた → `PROMPT_VERSION` を上げた
- [ ] `worker/src/lib/leap.ts` の型を変えた → `frontend/src/lib/leapTypes.ts` も変えた
- [ ] マイグレーションを足した → 既存ファイルは書き換えず、古いコードでも動く「足すだけ」の変更にした
- [ ] 鍵・トークンをコミットしていない（`git ls-files | grep -i "dev.vars\|\.env"` が空）

## 記録
- [ ] `CHANGELOG.md` の [Unreleased] に書いた
- [ ] 設計判断があれば `docs/DECISIONS.md` に ADR を足した
- [ ] `docs/memory/STATE.md` を更新した

## 戻し方
<!-- 不具合が出たときの戻し方。通常は「wrangler rollback <版ID> ＋ このPRを revert」。マイグレーションを含む場合は特記 -->
