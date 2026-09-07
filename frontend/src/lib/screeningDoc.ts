import type { LeapReport } from "./leapTypes";
import { COVERAGE_LABEL, BASIS_LABEL, SITE_VERDICT_LABEL } from "./leapTypes";

/**
 * The screening as a Markdown document.
 *
 * The PDF route is browser printing, which produces a fixed artefact. This one
 * exists so the content can be pasted into a client's own template and edited -
 * which is what actually happens to a screening once it reaches a company.
 *
 * It carries the same caveats as the screen. A document that drops the "this is
 * not a statutory assessment" line the moment it leaves the app would be the
 * most dangerous version of this output.
 */
export function screeningToMarkdown(r: LeapReport): string {
  const L: string[] = [];
  const date = new Date(r.generatedAt).toLocaleString("ja-JP");

  L.push(`# 生物多様性 簡易スクリーニング報告`);
  L.push("");
  if (r.project.clientName) L.push(`**対象企業**：${r.project.clientName}`);
  L.push(`**対象案件**：${r.project.name}`);
  L.push(`**作成日時**：${date}`);
  L.push(`**作成**：Geo Decision Agent（ForestScope）`);
  L.push("");
  L.push("> **本書の位置づけ**");
  L.push(">");
  L.push("> 本書は衛星データによる**一次スクリーニング**です。環境影響評価法に基づく法定アセスメントの代替ではありません。");
  L.push("> 立地の最終決定、法定アセスメントの要否判断は、必ず所管行政庁および専門家の確認を経てください。");
  L.push(
    "> 各項目には根拠区分（衛星実測／現地確認済み／地図上で指定／登録・設定値／推定値／未取得）を付しています。**「未取得」「判定不可」の項目は判定していません。**",
  );
  L.push("");

  L.push(`## 1. スクリーニング結果`);
  L.push("");
  if (r.sites.length === 0) {
    L.push("スクリーニング対象の地点が登録されていません。");
  } else {
    L.push("| 地点 | 判定 | 根拠 |");
    L.push("|---|---|---|");
    for (const s of r.sites) {
      L.push(`| ${s.label} | ${SITE_VERDICT_LABEL[s.verdict]} | ${s.reason.replace(/\|/g, "／")} |`);
    }
  }
  L.push("");

  L.push(`## 2. TNFD LEAP 対応状況`);
  L.push("");
  L.push(
    `LEAP 16 コンポーネント（＋スコーピング）のうち、対応 ${r.coverageSummary.covered}／部分対応 ${r.coverageSummary.partial}／本システム対象外 ${r.coverageSummary.notCovered}。`,
  );
  L.push("");
  L.push("| コード | コンポーネント | 対応状況 | 本システムで言えること |");
  L.push("|---|---|---|---|");
  for (const c of r.components) {
    L.push(`| ${c.code} | ${c.title}（${c.titleEn}） | ${COVERAGE_LABEL[c.coverage]} | ${c.verdict.replace(/\|/g, "／")} |`);
  }
  L.push("");

  L.push(`## 3. 感度の高い地域（sensitive locations）の5基準`);
  L.push("");
  L.push("TNFDが定める5つの特性について、本システムで判定できたものと、公的データ未接続により判定していないものを区別して示します。");
  L.push("");
  L.push("| 基準 | 判定可否 | 結果 | 出典 | 備考 |");
  L.push("|---|---|---|---|---|");
  for (const s of r.sensitive) {
    const verdict = s.assessable ? "判定済" : s.proxy ? "代理指標" : "**判定不可**";
    const src = s.source ? `${s.source}${s.fetchedAt ? `（取得 ${new Date(s.fetchedAt).toLocaleString("ja-JP")}）` : ""}` : "—";
    L.push(
      `| ${s.title} | ${verdict} | ${s.result.replace(/\|/g, "／")} | ${src} | ${(s.requires ?? "").replace(/\|/g, "／")} |`,
    );
  }
  L.push("");
  L.push("**判定可否の意味**");
  L.push("");
  L.push("- **判定済**：公的データに照会し、結果を得た項目です。");
  L.push("- **代理指標**：直接の権威データが存在しないため、他のデータから推し量った参考値です。判定ではありません。");
  L.push("- **判定不可**：該当しないという意味ではありません。データを取得していない、または取得に失敗したため、判定を行っていないという意味です。");
  L.push("");

  L.push("### 参照した公的データ");
  L.push("");
  L.push("| データ源 | 取得範囲 | 取得状況 | 留意点 |");
  L.push("|---|---|---|---|");
  for (const p of r.publicData) {
    const st =
      p.status === "ok"
        ? `取得成功${p.fetchedAt ? `（${new Date(p.fetchedAt).toLocaleString("ja-JP")}）` : ""}`
        : p.status === "busy"
          ? "提供元が混雑のため未取得"
          : p.status === "failed"
            ? `**取得失敗**${p.error ? `（${p.error}）` : ""}`
            : "未取得";
    L.push(`| ${p.label} | ${p.covers.replace(/\|/g, "／")} | ${st} | ${p.caveat.replace(/\|/g, "／")} |`);
  }
  L.push("");

  L.push(`## 4. 各コンポーネントの詳細`);
  L.push("");
  for (const c of r.components) {
    L.push(`### ${c.code} ${c.title}`);
    L.push("");
    L.push(`*${c.titleEn}*`);
    L.push("");
    L.push(`**導きの問い**：${c.question}`);
    L.push("");
    L.push(`**対応状況**：${COVERAGE_LABEL[c.coverage]} — ${c.verdict}`);
    L.push("");
    if (c.items.length) {
      L.push("| 項目 | 内容 | 根拠区分 |");
      L.push("|---|---|---|");
      for (const it of c.items) {
        const note = it.note ? `<br>※${it.note.replace(/\|/g, "／")}` : "";
        L.push(`| ${it.label} | ${it.value.replace(/\|/g, "／")}${note} | ${BASIS_LABEL[it.basis]} |`);
      }
      L.push("");
    }
    if (c.gaps.length) {
      L.push("**次に必要なこと**");
      L.push("");
      for (const g of c.gaps) L.push(`- ${g}`);
      L.push("");
    }
  }

  L.push(`## 5. データソースと再現情報`);
  L.push("");
  L.push("| 項目 | 内容 |");
  L.push("|---|---|");
  L.push(`| 衛星埋め込みデータ | ${r.provenance.embeddingDataset} |`);
  L.push(`| 衛星指標データ | ${r.provenance.indicesDataset} |`);
  L.push(`| 対象年 | ${r.provenance.earthEngineYear ?? "—"} |`);
  L.push(
    `| Earth Engine接続 | ${r.provenance.earthEngineAvailable === null ? "—" : r.provenance.earthEngineAvailable ? "接続あり（実データ）" : "未接続（シミュレーション）"} |`,
  );
  L.push(`| 分析ID | ${r.provenance.analysisId ?? "—"} |`);
  L.push(`| 判定ロジック版 | ${r.provenance.engineVersion ?? "—"} |`);
  L.push(`| データ基準日 | ${r.dataAsOf ? new Date(r.dataAsOf).toLocaleString("ja-JP") : "—"} |`);
  L.push("");

  L.push(`## 6. 前提と限界`);
  L.push("");
  L.push("- 本書は一次スクリーニングであり、環境影響評価法に基づく法定アセスメントの代替ではありません。");
  L.push("- 衛星データは変化の**有無**を示しますが、**原因**（伐採・災害・病虫害・季節差）は判定できません。原因の特定には現地確認が必要です。");
  L.push(
    "- 保護区域の情報はOpenStreetMap由来の参考値です。正式な指定範囲は所管行政庁でご確認ください。",
  );
  L.push(
    "- ハザードマップの判定はタイル単位（約600m四方）での該当有無であり、地点そのものが区域内にあるかを示すものではありません。",
  );
  L.push(
    "- 生態系サービス供給上の重要性は、全国規模の権威データが存在しないため代理指標にとどめています。",
  );
  L.push("- 生態系サービスへの依存の評価、および重要性（materiality）の判定は本システムの対象外です。");
  L.push("- 本書の内容は、社内の確認者による承認と専門家レビューを経てから開示にご利用ください。");
  L.push("");
  L.push("### 参照した枠組み");
  L.push("");
  L.push("- TNFD, Guidance on the identification and assessment of nature-related issues: the LEAP approach (v1.1)");
  L.push("- TNFD, Recommendations of the TNFD（4つの柱・14の推奨開示）");
  L.push("- SBTN, AR3T framework（緩和ヒエラルキー／IFC Performance Standard 6 由来）");
  L.push("");
  L.push("---");
  L.push("");
  L.push(`確認者：＿＿＿＿＿＿＿＿＿＿　　承認日：＿＿＿＿年＿＿月＿＿日`);
  L.push("");
  return L.join("\n");
}
