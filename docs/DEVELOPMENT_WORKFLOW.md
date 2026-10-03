# 開発とリリースの手順（バージョン管理・ロールバック）

**何かあったときに、1つ前の版へ数分で戻せるようにするための手順書。**
プロのアプリ開発で一般的なやり方（GitHub Flow・セマンティックバージョニング・
CHANGELOG・Cloudflare のロールバック・D1 の Time Travel）を、このプロジェクトに合わせて決めたもの。

調査日：2026-10-03。出典は末尾。Cloudflare と GitHub の公式ドキュメント本体はサンドボックスから
直接開けなかったため、**各ドキュメントの公式ソースリポジトリ（GitHub 上）**で文言を確認した。

---

## 0. まず言葉をそろえる（中学生向け）

| 言葉 | たとえると | このプロジェクトでは |
|---|---|---|
| **コミット** | セーブポイント | 変更のひとかたまり。「なぜ変えたか」を書いて残す |
| **ブランチ** | 下書き用のコピー | 本番に影響させずに作業する場所 |
| **main** | 清書（本番の正本） | ここにある内容が本番で動く（※移行後） |
| **プルリクエスト（PR）** | 「清書に写していいですか？」の申請書 | 自動検査が通り、内容を確認してから main に入れる |
| **タグ／バージョン** | 版番号のしおり | `v0.1.0` のように、出荷した版に印をつける |
| **CHANGELOG** | 版ごとの「何が変わったか」表 | 人が読む言葉で書く（git の履歴の丸写しはしない） |
| **ロールバック** | 1つ前のセーブポイントに戻る | Cloudflare の機能で、プログラムを前の版に戻す |
| **Time Travel** | データベースのタイムマシン | 過去の時刻の状態にデータベースを巻き戻す（最終手段） |

---

## 1. 現状と問題（2026-10-03 時点）

- ブランチは `claude/ai-chat-app-build-s7fut7` の1本だけ。**ここへ push すると、そのまま本番にデプロイされる**
- タグも CHANGELOG も無いので、「どの版が本番で動いているか」「どこへ戻せばいいか」が名前で言えない
- デプロイ前の自動検査が無い（型検査・ビルドは人が手で走らせている）
- `deploy.yml` は `wrangler deploy` のあと `wrangler secret put` を最大4回呼ぶ。
  **`secret put` は1回ごとに Worker の新しい版を作ってデプロイする**ため、1回の push で版が3〜5個できる。
  このまま引数なしの `wrangler rollback` を打つと、**同じコードの「鍵を入れただけの版」に戻るだけ**になる
- リポジトリは**公開（public）**。誰でも中身を読める（→ 会話記録の置き場所に影響。ADR-016）

---

## 2. 目標の形：GitHub Flow

```
作業ブランチ（claude/…） ──PR──▶ main ──自動──▶ 本番（Cloudflare）
        │                    │
   自動検査（CI）         タグ vX.Y.Z ＋ CHANGELOG
```

- **main ＝ 本番の正本。** main へ直接 push しない。必ず PR を通す
- 作業は短命のブランチで行い、PR で main に入れる
- PR では自動検査（型検査・フロントのビルド・`wrangler deploy --dry-run`）が通らないとマージできない
- マージすると本番にデプロイされる。出荷の区切りごとにタグ `vX.Y.Z` と GitHub Release を作る

Git Flow（develop・release ブランチを持つ方式）は採らない。常に1つの版だけを本番で動かすウェブアプリには重すぎる。

---

## 3. 版番号の決め方（セマンティックバージョニング）

`v メジャー . マイナー . パッチ`

| 上げる番号 | いつ | 例 |
|---|---|---|
| パッチ（0.1.**1**） | 不具合の修正だけ | 表示崩れを直した |
| マイナー（0.**2**.0） | 後方互換のある機能追加 | 新しい公的データ源を足した |
| メジャー（**1**.0.0） | 互換性が崩れる変更 | 帳票の形式を変えて、過去の帳票と並べられなくなった |

- **0.x.y の間は開発初期**（何が変わってもよい）。LEAP 帳票の形式を顧客向けに固定した時点で `1.0.0` にする
- **`v0.1.0` ＝ 2026-09-07 時点の本番（コミット `620ca71`）。** ここを最初の戻り先にする
- アプリの版とは別に、判定ロジックの `ENGINE_VERSION`、システムプロンプトの `PROMPT_VERSION` がある。
  しきい値やプロンプトを変えたら、そちらも上げる（CLAUDE.md）

コミットメッセージは、これまでどおり**「なぜ変えたか」**を書く。
Conventional Commits（`feat:` `fix:` などの接頭辞）は任意とし、強制しない。

---

## 4. 日々の作業の流れ（移行後）

1. Claude Code が作業ブランチ（`claude/…`）で作業し、コミットする
2. `docs/` と `CHANGELOG.md` の **[Unreleased]** に、何がなぜ変わったかを同じコミットで書く
3. PR を作る（`.github/pull_request_template.md` の項目を埋める）
4. CI（`.github/workflows/ci.yml`）が型検査・ビルド・dry-run を実行する。赤なら直す
5. 創業者が PR の要約を読み、**Squash and merge** する → 本番に自動デプロイ
6. デプロイ後、本番 D1 の `system_checks` を確認する（OPERATIONS.md §4）。**画面が動いているだけでは正常とみなさない**

## 5. 出荷（リリース）の手順

1. `CHANGELOG.md` の [Unreleased] を `## [0.x.y] - YYYY-MM-DD` に移す
2. main の該当コミットにタグを打つ：`git tag -a v0.x.y -m "v0.x.y"` → `git push origin v0.x.y`
3. GitHub の Releases に、CHANGELOG の該当節を貼って公開する

## 6. 緊急の修正（ホットフィックス）

main からブランチを切る → 直す → PR → CI → マージ（自動デプロイ）→ パッチ版のタグ。
**main に直接コミットしない**のは緊急時も同じ。

---

## 7. ロールバック：プログラムを1つ前の版に戻す（数分）

Cloudflare は Worker の版（コード・静的ファイル・バインディング・互換性設定を丸ごと）を保存している。
直近 **100版**まで戻せる。**画面（React）も API と一緒に戻る。**

```bash
# 1. 版の一覧を見て、最後に正常だった版の ID を探す（タグにコミットSHAが入っている版）
npx wrangler deployments list
npx wrangler versions list

# 2. ID を必ず明示して戻す（引数なしだと「直前の版」＝鍵を入れただけの版、になりうる）
npx wrangler rollback <VERSION_ID> --message "rollback: <理由>"
```

3. **必ず `git revert` で悪いコミットを打ち消す PR を出す。** やらないと、次のマージで同じ不具合が再デプロイされる
4. 本番の `system_checks` を確認する

**ロールバックで戻らないもの：** D1 のデータとスキーマ、R2 の写真、Cron のスケジュール。
だから次の §9（マイグレーションの規則）を守る。

ダッシュボードからも戻せる：Workers & Pages → `geo-decision-agent` → Deployments。

## 8. データの復旧：D1 Time Travel（最終手段）

**選んだ時刻より後の書き込みはすべて消える。** 本当に必要なときだけ使う。

```bash
# 戻したい時刻の「しおり（bookmark）」を調べる
npx wrangler d1 time-travel info geo-decision-agent-db --timestamp=2026-10-03T09:00:00+09:00

# 巻き戻す（出力される「取り消し用 bookmark」を必ず控える）
npx wrangler d1 time-travel restore geo-decision-agent-db --bookmark=<BOOKMARK>
```

- 保持期間：**無料プランは7日、有料（Workers Paid）は30日**
- 先にプログラムをロールバックして、書き込みを止めてから行う
- マイグレーション管理表（`d1_migrations`）も一緒に戻るので、次のデプロイで以降のマイグレーションが再適用される。
  デプロイするコードが戻したスキーマと合っているか確認する
- 7日（または30日）より前に戻る必要に備え、定期的に `npx wrangler d1 export geo-decision-agent-db --remote --output=backup.sql` で書き出して保管する（実行中は他の DB リクエストを止めるので、利用の少ない時間に）

## 9. マイグレーションの規則（ロールバックできる状態を保つ）

D1 のマイグレーションは**前にしか進めない**（wrangler に down コマンドは無い）。
プログラムを古い版に戻しても、データベースは新しい形のまま。だから：

1. **足すだけにする**：テーブル・列の追加はよい。古いコードが新しい列を無視しても動くようにする
2. **消す・名前を変えるのは、次の次の版で**：ロールバックの可能性が無くなってから
3. **壊す変更と、それに依存するコードを同じ版で出さない**
4. マイグレーションファイルは**書き換えない。追記のみ**（CLAUDE.md）

---

## 10. 導入状況

### このコミットで導入済み（本番の動きは変えていない）

- [x] `CHANGELOG.md`（Keep a Changelog 形式）
- [x] `.github/pull_request_template.md`
- [x] `.github/workflows/ci.yml`：PR と手動実行で、型検査・ビルド・`wrangler deploy --dry-run`。**デプロイはしない**
- [x] `v0.1.0` タグ（`620ca71`＝2026-09-07 時点の本番）をローカルに作成（push は創業者の了承後）
- [x] チーム（`.claude/agents/`）と記憶（`docs/memory/`）

### 🟡 創業者の判断が必要（1回だけ）

1. **`main` ブランチを作り、既定ブランチにする**（GitHub → Settings → General → Default branch）
2. **本番デプロイのきっかけを `claude/ai-chat-app-build-s7fut7` への push から `main` へのマージに切り替える**
   （`deploy.yml` の `on.push.branches` を `main` に変える。下の §11 の改善と一緒に行う）
3. **main を保護する**（Settings → Branches → Add rule、対象 `main`）
   - Require a pull request before merging ／ **Required approvals は 0**（PR を作るのも承認するのも同じアカウントなので、1以上にすると誰もマージできない）
   - Require status checks to pass（`CI / verify` を指定）
   - Require linear history
   - **Do not allow bypassing the above settings**（管理者にも適用。これが無いと検査は“お願い”にしかならない）
   - 強制 push と削除を禁止
   - ※ 無料プランでブランチ保護が使えるのは**公開リポジトリだから**。非公開にすると使えなくなる
4. **Workers Paid（月5ドル〜）にするか**：D1 の巻き戻し可能期間が 7日 → 30日 になる
5. **検証環境（staging）を持つか**：`wrangler.toml` に `[env.staging]` を足し、専用の D1 を作る方式を推奨（Cron も動くので自己診断まで試せる）

## 11. `deploy.yml` の改善案（2. の切り替えと同時に適用する）

| 変更 | 理由 |
|---|---|
| `on.push.branches: [main]` | main ＝ 本番 にする |
| `concurrency: {group: production-deploy, cancel-in-progress: false}` | デプロイの同時実行を防ぐ。実行中のマイグレーションを途中で止めない |
| 鍵は `wrangler deploy --secrets-file "$RUNNER_TEMP/secrets.json"` で**コードと同じ版**に入れる（ファイルは `env:` の値から作り、終わったら消す） | 1回の push で版が1つだけになり、ロールバック先が分かりやすくなる |
| `wrangler deploy --tag "$GITHUB_SHA" --message "..."`（値は `env:` 経由） | 版の一覧にコミット SHA が出るので、「どの版がどのコミットか」が分かる |
| マイグレーションの前に `wrangler d1 time-travel info ... --json` を実行してログに残す | デプロイ直前の復元点（bookmark）が記録される |

※ `${{ }}` をシェルの中で展開しない規則（CLAUDE.md）は、ここでも守る。

---

## 出典

- Cloudflare：Versions & Deployments／Rollbacks／Wrangler commands（deploy・rollback・versions・secret）／Secrets／D1 Time Travel／D1 limits／D1 import-export／D1 migrations／Wrangler environments／GitHub Actions での CI/CD（いずれも developers.cloudflare.com。本文は `cloudflare/cloudflare-docs` リポジトリで確認）
- Cloudflare changelog：ロールバック上限 10→100 版（2025-09-11）
- GitHub Docs：GitHub flow／About protected branches／Deployments and environments／Concurrency（本文は `github/docs` リポジトリで確認）
- Semantic Versioning 2.0.0（semver.org）／Keep a Changelog 1.1.0（keepachangelog.com）／Conventional Commits 1.0.0
- wrangler 4.127.1（このリポジトリで固定している版）で、`deploy --secrets-file`・`rollback`・`d1 time-travel` の引数を確認

**未確認の点**：ロールバックで「古い鍵の値」まで戻るか（鍵もバインディングなので戻る可能性が高い）。
ロールバックで Cron のスケジュールが変わらないこと（推測）。
