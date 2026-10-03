# -*- coding: utf-8 -*-
"""Human-written annotations. build.py checks every column named here exists in
the real schema, so this file cannot drift from the migrations unnoticed."""

STEPS = [
 dict(n=1, id="people", title="使う人", color="c1",
  plain="まず「誰が使えるか」。名簿（users）に載っていて、招待コード（invites）で入った人だけが、ログイン中の印（sessions）をもらえます。AIを使うと料金が家計簿（usage_log）に積み上がり、月の上限に着いたら止まります。",
  expert="招待制の認証基盤と費用統制。パスワードは PBKDF2-SHA256 のハッシュ、セッションは D1 の行＋HMAC 署名 Cookie。月次予算は usage_log の当月合計だけで判定し、他に状態を持たない。"),
 dict(n=2, id="project", title="調べる場所", color="c2",
  plain="図の真ん中が「案件（projects）」です。物流センターの候補地など、調べる場所1つにつきノート1冊。このあとの記録は、ほぼ全部このノートにぶら下がります。",
  expert="projects が集約ルート。field_records / meshes / conversations / analyses / decision_reports / recovery_actions / alerts / site_candidates が project_id で束ねられる。client_name は報告書の表紙（◯◯ 御中）に使う。"),
 dict(n=3, id="ground", title="地上の証拠", color="c3",
  plain="人が現地で撮った写真・場所・見つけた生き物のメモ（field_records）。「確認済み」になったものだけが、衛星の数字と比べるときの“お手本”になります。",
  expert="地上の真実（ground truth）。review_status='confirmed' のみが基準ベクトルの元。demo と source を列にして、デモ行や地図上のピンが現地確認済みの証拠として数えられないようにしている。"),
 dict(n=4, id="space", title="宇宙からの測定", color="c4",
  plain="調べる範囲を10メートル四方の方眼紙（meshes）に区切り、1マス（mesh_cells）ずつ「お手本にどれだけ似ているか」「去年からどれだけ変わったか」を測ります。一度測った場所は、メモ（キャッシュ）に残して二度手間を避けます。",
  expert="Google Satellite Embedding（64次元）のコサイン類似度と前年比の変化量を 10m セルごとに算出。取得結果は (lat,lng,year) でキャッシュし、Workers 無料枠のサブリクエスト上限（50）の内側で回す。キャッシュは座標キーで引くため外部キーを持たない。"),
 dict(n=5, id="action", title="結果を行動に", color="c5",
  plain="同じ色のマスが固まっている場所を「重要エリア（mesh_hotspots）」にまとめ、エリアごとに「避ける→減らす→戻す→別の場所で補う」のやることリスト（recovery_actions）を作ります。",
  expert="隣接する同一クラスのセルを塗りつぶし探索で集約し、連続性（compactness）と重要度で順位付け。施策は必ず hotspot_id に紐づく（どの土地への施策か言えない提案は実行できないため）。"),
 dict(n=6, id="decide", title="AIと比べて決める", color="c6",
  plain="AIとの会話（conversations / messages）で候補地と、成績表（site_candidates）と「影響を減らす案」（mitigation_measures）ができ、そのとき使った条件が記録（analyses）されます。最後に、人が確認して承認するレポート（decision_reports / report_reviewers）になります。",
  expert="数値は決定的なエンジンが出し、LLM はツールを呼んで言葉にするだけ。analyses に model / prompt_version / engine_version / データセットID / 衛星年を残すので、同じ分析IDで再現できる（FR-007 / NFR-010）。"),
 dict(n=7, id="watch", title="見守りと記録", color="c7",
  plain="「確認してください」の通知（alerts）と、そのしきい値（alert_rules）。システム自身の健康診断（system_checks）。誰がいつ何をしたかの履歴（audit_events）。設定の引き出し（settings）。他の表とは線でつながっていません。",
  expert="alerts は (category, source_id) の UNIQUE で重複通知を防ぐ。system_checks が本番の健全性を知る唯一の場所（外部APIの疎通を本番自身が5分毎に診断して記録）。settings は再デプロイ不要の KV。"),
]

# id -> annotation. 'cols' maps column -> plain meaning (must exist in schema).
T = {}

def t(id, step, jp, plain, expert, why, example, cols, logical=None):
    T[id] = dict(id=id, step=step, jp=jp, plain=plain, expert=expert, why=why,
                 example=example, cols=cols, logical=logical or {})

t("users", 1, "利用者",
  "このアプリを使える人の名簿。名前・メール・役割（管理者／メンバー／閲覧のみ）が入っています。",
  "認証主体。パスワードは平文ではなく PBKDF2-SHA256 のハッシュ＋ソルトで保存。disabled_at を立てるとログイン不可になるが、行は消さない。",
  "行を消さずに無効化するのは、過去の判断が「誰の操作だったか」を後から追えるようにするため。",
  "山田 太郎 / admin",
  {"id":"利用者を区別する番号","email":"ログインに使うメール（重複不可）","name":"表示名","password_hash":"パスワードを元に戻せない形にした値","password_salt":"ハッシュを強くする使い捨ての値","role":"admin / member / viewer の3段階","disabled_at":"入っていたらログインできない"})
t("invites", 1, "招待コード",
  "入場券です。管理者が発行した招待コードを持つ人だけが、アカウントを作れます。",
  "招待制の実体。この表にコードが無ければ誰も登録できない（公開サインアップは存在しない）。used_by / used_at で使用済みを管理し、expires_at で期限を切る。",
  "限定公開（招待制）という要件を、画面ではなくデータで担保している。",
  "MANUAL-2026-B（説明書作成用）",
  {"code":"招待コード本体（重複不可）","email":"この人専用にしたい場合のメール","role":"登録後に付く役割","created_by":"発行した管理者","used_by":"使った人","used_at":"使われた日時","expires_at":"期限"},
  logical={"created_by":"users","used_by":"users"})
t("sessions", 1, "ログイン状態",
  "「ログイン中です」という印。ログインすると作られ、30日で切れます。",
  "セッションID＋HMAC-SHA256 署名付き Cookie（httpOnly / secure / SameSite=Lax）。Cookie に入るのは署名付きトークンで、D1 の行が消えれば即座に無効になる。",
  "Cookie だけで有効としないので、サインアウトや無効化が即時に効く。",
  "有効期限は作成から30日",
  {"id":"セッションID","user_id":"誰のログインか","created_at":"作った日時","expires_at":"切れる日時"})
t("usage_log", 1, "AI利用料の記録",
  "AIを使った分の家計簿。月の合計が上限（初期は5,000円）に着くと、その月のAIは止まります。",
  "トークン数と USD/JPY コストを月次（YYYY-MM）で記録。予算判定はこの表の当月 SUM(cost_jpy) だけを見る。",
  "状態を1か所に集めているので、「止める」判定がずれない。",
  "2026-09 / claude-sonnet-5 / 入力 12,400 tok",
  {"user_id":"誰が使ったか","month":"集計する月（YYYY-MM）","model":"使ったAIモデル","input_tokens":"AIに送った量","output_tokens":"AIが返した量","cost_usd":"ドル換算の料金","cost_jpy":"円換算の料金（上限判定に使う）"})

t("projects", 2, "案件",
  "調べる場所1つにつきノート1冊。「広島県東広島市 物流拠点 新設検討」のように、案件ごとに作ります。",
  "ドメインの集約ルート。ほぼ全テーブルが project_id でぶら下がる。client_name は報告書の表紙（◯◯ 御中）に出す。",
  "ほとんどの記録が案件に紐づくので、案件単位で権限・集計・報告を切り出せる。",
  "広島県東広島市 物流拠点 新設検討 / 株式会社サンプル物流",
  {"id":"案件の番号","name":"案件名","use_case":"UC-01 など、何のための調べものか","status":"進行中 / 要確認 / 完了","center_lat":"中心の緯度","center_lng":"中心の経度","client_name":"報告書の宛先の会社名","created_by":"作った人"})

t("field_records", 3, "現地記録",
  "現地で撮った写真・場所・見つけた生き物のメモ。地面の「本物の証拠」です。",
  "地上の真実（ground truth）。review_status='confirmed' のものだけが基準ベクトルの元になる。demo（デモ行か）と source（field=現地 / pin=地図上で指定）は、証拠として数えるか・どう表示するかを決めるため、命名規則ではなく列にしてある。",
  "デモ行や、衛星写真の上でクリックしただけのピンが「現地確認済み」として通ると、立地判断の根拠を偽ることになる。列にしておけば、数える所・表示する所の全部で区別できる。",
  "東広島・里山の林縁 / ホンドタヌキ（中）/ 査読待ち",
  {"project_id":"どの案件の記録か","observer_id":"撮った人","lat":"緯度","lng":"経度","gps_accuracy_m":"GPSの誤差（m）","species_guess":"見つけた生き物（候補）","review_status":"unreviewed / confirmed / rejected","photo_key":"写真の保管場所（R2）","demo":"1ならデモ用。実観察と取り違えない","source":"field=現地で記録 / pin=地図上で指定"})

t("meshes", 4, "メッシュ（方眼紙）",
  "調べる範囲を10メートル四方のマス目に区切る「方眼紙」の設定です。",
  "メッシュ解析1回分。cell_size_m（既定10）× extent_m から row_count × col_count が決まる。status は sampling → ready。reference_points は基準ベクトルを作った確認済み記録の数で、0だと類似度は計算できない。",
  "一度に全部を取りに行かず16マスずつ繰り返す設計（サブリクエスト上限のため）。途中で止まっても残りから再開できる。",
  "200m四方 / 10mマス / 400マス / 2024年",
  {"project_id":"どの案件の解析か","cell_size_m":"1マスの大きさ（既定10m）","extent_m":"解析範囲の一辺（m）","row_count":"縦のマス数","col_count":"横のマス数","year":"どの年の衛星データか","detect_change":"1なら前年との変化も調べる","status":"sampling / ready / failed","reference_points":"お手本に使った確認済み記録の数"})
t("mesh_cells", 4, "メッシュのマス",
  "方眼紙の1マス。そのマスが「お手本」にどれだけ似ているか、去年からどれだけ変わったかを持ちます。",
  "row_idx / col_idx の整数座標を持つので、隣接判定が算術になる（ホットスポットの探索用）。cell_class は priority_a（類似度≥0.85）/ similar（≥0.70）/ changed（変化≥0.15）/ baseline / unscored。",
  "しきい値（0.85 / 0.70 / 0.15）は判定の根幹。変えたら ENGINE_VERSION を上げ、過去の結果と混ざらないようにする。",
  "類似度 0.91 → 優先度A（緑）",
  {"mesh_id":"どの方眼紙のマスか","row_idx":"縦の位置（整数）","col_idx":"横の位置（整数）","reference_similarity":"お手本との似ている度合い（0〜1）","change_score":"前年からの変化（大きいほど変わった）","cell_class":"色分けの種類","status":"pending / sampled / failed","hotspot_id":"所属する重要エリア","error":"取れなかった場合の理由"},
  logical={"hotspot_id":"mesh_hotspots"})
t("embedding_cache", 4, "衛星特徴量のメモ",
  "衛星から取ってきた「その場所の特徴の数字（64個）」のメモ。同じ場所・同じ年は二度取りに行きません。",
  "Google Satellite Embedding（64次元 A00–A63）のキャッシュ。(lat, lng, year) で引く。外部キーなし。Earth Engine は遅く、Workers 無料枠のサブリクエスト上限にも効くため、性能というより「動作可能性」のためのキャッシュ。",
  "同じ点・同じ年は同じ答えなので、再取得しても得るものがない。",
  "(34.4267, 132.7433, 2024) → 64個の数字",
  {"lat":"緯度","lng":"経度","year":"対象年","vector_json":"64個の数字（JSON）","source":"earth_engine か simulated か","fetched_at":"取得した日時"})
t("indices_cache", 4, "植生指数のメモ",
  "「植物の元気さ」などを表す数字（NDVI など）のメモです。",
  "Sentinel-2 由来の NDVI / NDRE / NDMI / NBR。(lat, lng, year) に UNIQUE。外部キーなし。",
  "埋め込みと同じ理由で、座標＋年をキーにして再取得を避ける。",
  "NDVI 0.72 / NDRE 0.41（2024年）",
  {"lat":"緯度","lng":"経度","year":"対象年","ndvi":"植物の量","ndre":"葉の元気さ","ndmi":"水分","nbr":"焼けや伐採の目安","source":"earth_engine か simulated か"})
t("public_data_cache", 4, "公的データのメモ",
  "国や研究機関の公開データ（生き物の記録・ハザードマップ・保護区）に聞いた答えのメモ。「聞けなかった」ことも記録します。",
  "source は gbif / osm_protected / gsi_hazard。status は ok / failed / busy / empty を事実として保存する。失敗・混雑のキャッシュは1時間、成功は30日で失効。座標は約100mに丸めるので、近い拠点は同じ行を共有する。",
  "取れなかった源を黙って落とすと、報告書が「そこには何もない」と読めてしまう。失敗を事実として残し、報告書では「判定不可」と表示する。",
  "GBIF / ok / 絶滅危惧種の記録 9件",
  {"source":"どの公開データか","lat":"約100mに丸めた緯度","lng":"約100mに丸めた経度","payload_json":"返ってきた中身","status":"ok / failed / busy / empty","error":"失敗した理由","fetched_at":"取得した日時"})

t("mesh_hotspots", 5, "重要エリア",
  "同じ色のマスが固まっている場所を1つにまとめた「重要エリア」。広い順に番号がつきます。",
  "隣接する同一クラスのセルを塗りつぶし探索で集約したもの。compactness（0〜1）は連続性、importance は順位付けの指標。",
  "ばらばらの点ではなく「かたまり」で扱うので、現地調査や施策を打つ単位になる。",
  "#1 優先度A 0.58ha・58マス",
  {"mesh_id":"どの方眼紙の重要エリアか","cell_class":"どの色のかたまりか","rank":"順位","cell_count":"含むマス数","area_ha":"面積（ヘクタール）","mean_similarity":"平均の類似度","mean_change":"平均の変化","compactness":"まとまり具合（0〜1）","importance":"重要度"})
t("recovery_actions", 5, "回復施策",
  "重要エリアごとの「やることリスト」。避ける→減らす→戻す→別の場所で補う、の順に並び、担当者と期限をつけられます。",
  "FR-052 / 054。必ず hotspot_id に紐づく。stage は avoid / reduce / restore / offset（ミティゲーション・ヒエラルキー）。status は proposed → accepted → in_progress → done / rejected。",
  "場所に結びつかない提案は実行できない。施策が必ずホットスポットを指すので「どの土地の話か」が曖昧にならない。",
  "避ける：造成範囲から除外する（0.58ha）",
  {"hotspot_id":"どの重要エリアへの施策か","mesh_id":"どの方眼紙か","project_id":"どの案件か","stage":"avoid / reduce / restore / offset","title":"施策の名前","expected_change":"期待する変化","indicator":"測る指標","frequency":"測る頻度","owner_user_id":"担当者","due_date":"期限","status":"提案中〜完了"})

t("conversations", 6, "AIとの会話",
  "AIと話した1本ぶんの会話です。",
  "project_id と user_id を持つ。1 conversation に N messages。",
  "案件単位で会話を束ねるので、後から「この判断のとき何を聞いたか」を辿れる。",
  "「候補地AとBはどちらが良い？」",
  {"project_id":"どの案件の会話か","user_id":"話した人","title":"会話の題名","updated_at":"最後に動いた日時"})
t("messages", 6, "発言",
  "会話の中の1回の発言。AIに払った料金もここに残ります。",
  "role は user / assistant / system。steps_json は画面に出す分析ステップ。input_tokens / output_tokens / cost_usd を保持する。",
  "発言ごとにコストを残すと、どの質問が高かったかも後で分かる。",
  "assistant：「最も影響が小さいのは候補地Aです」",
  {"conversation_id":"どの会話の発言か","role":"user / assistant / system","content":"本文","steps_json":"分析の途中経過（画面表示用）","input_tokens":"送ったトークン数","output_tokens":"返ってきたトークン数","cost_usd":"この発言の料金"})
t("analyses", 6, "分析の記録",
  "「その計算をしたときの条件」の記録。AIモデル・ルールの版・使った衛星データなどを残し、あとで同じ結果を再現できるようにします。",
  "FR-007 / NFR-010 / UAT-08。model / prompt_version / engine_version / earth_engine_year / embedding_dataset / indices_dataset / earth_engine_available / reference_points / inputs_json を保持。replay_of は再実行の連鎖。",
  "モデルやプロンプトや判定ロジックを変えると答えが変わる。何を使ったかを記録しないと、「同じIDなら同じ答え」は守れない。",
  "claude-sonnet-5 / engine 3.0.1 / 衛星2024年 / EE接続あり",
  {"project_id":"どの案件の分析か","conversation_id":"どの会話から実行されたか","run_by":"実行した人","model":"AIモデル","prompt_version":"システムプロンプトの版","engine_version":"判定ロジックの版","earth_engine_year":"衛星データの年","earth_engine_available":"1なら衛星の実データ、0なら推定","reference_points":"お手本の数","inputs_json":"AIが指定した入力そのもの","replay_of":"再実行の元になった分析"})
t("site_candidates", 6, "候補地の成績表",
  "比べた候補地1か所ぶんの成績表。順位・スコア・信頼度・根拠などが入ります。",
  "ndre_measured が「実測か推定か」のフラグ。analysis_id で analyses に論理的に紐づく（外部キー宣言はない）。evidence_basis は根拠の内訳。",
  "「実測」と「シミュレーション」を同じ数字として並べないため、フラグを持たせている。",
  "候補地A（北側の造成地）/ 82点 / 信頼度：高",
  {"project_id":"どの案件か","label":"候補地の名前","rank":"順位","score":"総合スコア","alphaearth_similarity":"お手本との類似度（実測）","ndre_change_pct":"NDREの前年比","ndre_measured":"1=実測 / 0=推定","confidence":"高 / 中 / 低","evidence_basis":"根拠の内訳","analysis_id":"どの分析の結果か"},
  logical={"analysis_id":"analyses"})
t("mitigation_measures", 6, "影響を減らす案",
  "候補地ごとの「影響を減らす案」です。",
  "hierarchy_stage は avoid | reduce | restore | offset。国際的なミティゲーション・ヒエラルキー（回避を最優先）に対応。",
  "必ず「回避」から検討する順序を、データ上の段階として持っている。",
  "回避：候補地Bを南へ100m動かす",
  {"candidate_id":"どの候補地への案か","hierarchy_stage":"avoid / reduce / restore / offset","description":"案の内容","priority":"優先順位","cost_impact":"費用への影響"})
t("decision_reports", 6, "意思決定レポート",
  "人が確認して承認する、最終のレポートです。下書き→確認済み→承認済みと進みます。",
  "status は draft | reviewed | approved。1 report に N reviewers。",
  "AIの提案から決定までの流れを、承認という形で人に戻している。",
  "東広島 物流拠点 立地比較 / 下書き",
  {"project_id":"どの案件か","title":"題名","period_start":"対象期間の始まり","period_end":"対象期間の終わり","summary":"要約","status":"draft / reviewed / approved","created_by":"作った人"})
t("report_reviewers", 6, "レポートの確認者",
  "レポートを確認する人と、その判断（承認／却下）です。",
  "status は pending | approved | rejected。decided_at に判断日時。",
  "誰がいつ承認したかが残るので、責任の所在が追える。",
  "確認者：環境担当 / 承認",
  {"report_id":"どのレポートの確認者か","user_id":"確認する人（任意）","name":"確認者の名前","status":"pending / approved / rejected","decided_at":"判断した日時"})

t("alerts", 7, "通知",
  "「確認してください」というお知らせ。何が起きたかだけでなく、次に何をすればよいかも書きます。",
  "severity は high | medium | low。(category, source_id) に UNIQUE で重複通知を防ぐ。next_action を持つのは、事象だけを告げる通知は無視されるため。",
  "同じ出来事で何度も鳴らさない。鳴ったら次の一手が分かる。",
  "高：大きな変化を検出 → 現地で確認してください",
  {"project_id":"どの案件の通知か","severity":"high / medium / low","category":"threshold / review / data / system","title":"見出し","detail":"詳しい内容","next_action":"次にやること","read_at":"読んだ日時","source_id":"通知のもとになった行（重複防止）"})
t("alert_rules", 7, "通知の条件",
  "通知を出す条件（しきい値）の設定。画面から変えられます。",
  "metric / comparator / threshold / severity / enabled。初期値：変化スコア≧0.15（高）、NDVI低下≧0.15（中）、類似度≧0.85（低）。",
  "感度を顧客自身が調整できるので、再デプロイ不要。",
  "前年比の変化が0.15以上なら「高」",
  {"name":"ルールの名前","metric":"change_score / ndvi_drop / similarity","comparator":"gte（以上）/ lte（以下）","threshold":"しきい値","severity":"通知の重さ","enabled":"1ならオン"})
t("system_checks", 7, "健康診断",
  "システム自身の健康診断の結果。5分ごとに記録されます。",
  "check_name は cron_heartbeat / ee_embedding / ee_indices / ee_algorithms / gbif / gsi_hazard / osm_protected。本番が正常かを知る唯一の場所。ハザードは「該当地」と「非該当地」の両方で判別できるかを確かめる。",
  "画面が動いていても、衛星が落ちていれば推定値で動いている。だから自己診断の結果を残す。",
  "gsi_hazard / ok（該当地=200、非該当地=404）",
  {"check_name":"何を診断したか","ok":"1=正常 / 0=異常","message":"結果の一言","detail":"詳しい中身","duration_ms":"かかった時間","checked_at":"診断した日時"})
t("audit_events", 7, "操作履歴",
  "誰がいつ何をしたかの記録です。",
  "actor_id / action / target / detail / created_at。意思決定レポートの監査証跡の材料。",
  "後から「誰の判断か」を追えるようにする。",
  "public_data.fetch / 案件 proj_… / 2026-09-07",
  {"actor_id":"した人","action":"した操作","target":"対象","detail":"詳しい中身","created_at":"日時"},
  logical={"actor_id":"users"})
t("settings", 7, "設定",
  "設定の引き出しです。予算の上限・為替・AIモデル名などが入っています。",
  "key-value の表。monthly_budget_jpy / usd_jpy_rate / claude_model / earth_engine_year / mesh_cell_size_m / mesh_extent_m。",
  "再デプロイせずに変えられる設定は、ここに置く。",
  "monthly_budget_jpy = 5000",
  {"key":"設定の名前","value":"設定の値"})

# Layout (top-left of each box). Box is W x H.
POS = {
 "sessions":(30,100),"users":(250,230),"invites":(30,230),"usage_log":(30,360),
 "messages":(500,100),"conversations":(500,230),"analyses":(500,400),
 "projects":(780,320),"alerts":(780,500),
 "site_candidates":(1060,50),"mitigation_measures":(1290,50),
 "decision_reports":(1060,170),"report_reviewers":(1290,170),
 "field_records":(1060,310),
 "meshes":(1060,450),"mesh_cells":(1290,400),"mesh_hotspots":(1290,520),"recovery_actions":(1520,520),
 "public_data_cache":(1060,680),"embedding_cache":(1290,680),"indices_cache":(1520,680),
 "audit_events":(30,640),"settings":(250,640),"alert_rules":(30,740),"system_checks":(250,740),
}

# (parent, child, kind, plain label, "1:N")  kind: fk | logical | cache
RELS = [
 ("users","sessions","fk","ログインの印を持つ"),
 ("users","invites","logical","招待"),
 ("users","usage_log","fk","AI料金を使う"),
 ("users","conversations","fk","AIと話す"),
 ("users","projects","fk","案件を作る"),
 ("projects","conversations","fk","会話"),
 ("conversations","messages","fk","発言が並ぶ"),
 ("conversations","analyses","fk","分析する"),
 ("projects","analyses","fk","分析条件"),
 ("projects","site_candidates","fk","候補地"),
 ("site_candidates","mitigation_measures","fk","対策案"),
 ("projects","decision_reports","fk","レポート"),
 ("decision_reports","report_reviewers","fk","確認者"),
 ("projects","field_records","fk","現地記録"),
 ("projects","meshes","fk","解析"),
 ("meshes","mesh_cells","fk","区切る"),
 ("meshes","mesh_hotspots","fk","集約"),
 ("mesh_cells","mesh_hotspots","logical","属する"),
 ("mesh_hotspots","recovery_actions","fk","施策"),
 ("projects","alerts","fk","通知する"),
 ("meshes","public_data_cache","cache","座標で引く"),
 ("meshes","embedding_cache","cache","座標＋年で引く"),
 ("meshes","indices_cache","cache","座標＋年で引く"),
]
# Logical links whose line is omitted to keep the picture legible.
OMITTED = [("analyses","site_candidates","site_candidates.analysis_id → analyses.id（外部キー宣言なし）")]
# Schema-level FKs deliberately not drawn (every "who did it" column).
NOT_DRAWN_NOTE = "created_by / observer_id / reviewed_by / run_by / owner_user_id / acknowledged_by など「誰が」を表す列は users へ向かいますが、線が多すぎて読めなくなるため図では省略しています。"
