import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Printer, FileDown, Building2, AlertTriangle, Check, Minus, X, ChevronLeft } from "lucide-react";
import { api } from "../lib/api";
import {
  BASIS_LABEL,
  COVERAGE_LABEL,
  PHASE_TITLE,
  SITE_VERDICT_LABEL,
  type Coverage,
  type LeapComponent,
  type LeapPhase,
  type LeapReport as Report,
  type SiteVerdict,
} from "../lib/leapTypes";
import { screeningToMarkdown } from "../lib/screeningDoc";

const COVERAGE_STYLE: Record<Coverage, { className: string; icon: typeof Check }> = {
  covered: { className: "bg-emerald-50 text-emerald-800 border-emerald-300", icon: Check },
  partial: { className: "bg-amber-50 text-amber-800 border-amber-300", icon: Minus },
  not_covered: { className: "bg-slate-100 text-slate-600 border-slate-300", icon: X },
};

const VERDICT_STYLE: Record<SiteVerdict, string> = {
  attention: "bg-rose-50 text-rose-800 border-rose-300",
  watch: "bg-amber-50 text-amber-800 border-amber-300",
  clear: "bg-emerald-50 text-emerald-800 border-emerald-300",
  insufficient: "bg-slate-100 text-slate-600 border-slate-300",
};

const PHASES: LeapPhase[] = ["scoping", "locate", "evaluate", "assess", "prepare"];

/**
 * The screening document (FR-053 / FR-034).
 *
 * Built to be printed. What a company keeps from a meeting is the paper, so the
 * page is laid out as A4 with its own page breaks rather than as a screen that
 * happens to be printable.
 *
 * The design carries one argument throughout: say what was established, and say
 * just as plainly what was not. A LEAP-shaped document whose headings are all
 * filled in reads as a completed assessment; this one shows 対応 / 部分対応 /
 * 対象外 per component, because a company acting on an overstated screening is
 * a worse outcome than one that knows where the gaps are.
 */
export default function LeapReport() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [savingClient, setSavingClient] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .get<Report>(`/projects/${id}/leap`)
      .then((r) => {
        setReport(r);
        setClientName(r.project.clientName ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const saveClientName = async () => {
    if (!id) return;
    setSavingClient(true);
    try {
      await api.patch(`/projects/${id}`, { clientName });
      const r = await api.get<Report>(`/projects/${id}/leap`);
      setReport(r);
    } finally {
      setSavingClient(false);
    }
  };

  const downloadMarkdown = () => {
    if (!report) return;
    const blob = new Blob([screeningToMarkdown(report)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);
    a.href = url;
    a.download = `生物多様性スクリーニング_${report.project.name}_${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600 mb-4">{error}</p>
          <Link to={`/projects/${id}`} className="text-sm text-[var(--gda-green)] underline">
            AI調査に戻る
          </Link>
        </div>
      </div>
    );
  }

  if (!report) return <div className="p-8 text-center text-sm text-slate-500">読み込み中...</div>;

  const r = report;
  const generated = new Date(r.generatedAt).toLocaleString("ja-JP");

  return (
    <div className="bg-slate-200 min-h-full print:bg-white">
      {/* Toolbar - never printed. */}
      <div className="print-hide sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-2.5">
        <div className="max-w-[210mm] mx-auto flex flex-wrap items-center gap-2">
          <Link to={`/projects/${id}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <ChevronLeft size={14} /> 戻る
          </Link>
          <div className="text-sm font-semibold text-slate-800 ml-1">簡易スクリーニング報告</div>

          <div className="flex items-center gap-1.5 ml-auto">
            <div className="flex items-center gap-1 border border-slate-300 rounded-lg px-2 py-1">
              <Building2 size={12} className="text-slate-400 shrink-0" />
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                onBlur={saveClientName}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && saveClientName()}
                placeholder="対象企業名を入力"
                className="text-xs w-40 focus:outline-none"
              />
            </div>
            <button
              onClick={downloadMarkdown}
              className="flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-3 py-2"
            >
              <FileDown size={13} /> ドキュメント
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs font-medium bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] text-white rounded-lg px-3 py-2"
            >
              <Printer size={13} /> PDFで保存
            </button>
          </div>
        </div>
        {savingClient && <div className="max-w-[210mm] mx-auto text-[10px] text-slate-400 mt-1">保存中...</div>}
      </div>

      <div className="report mx-auto my-4 print:my-0 bg-white text-slate-800 shadow-lg print:shadow-none">
        {/* --- Cover ------------------------------------------------------- */}
        <section className="page">
          <div className="flex items-center gap-2 pb-3 border-b-2 border-[var(--gda-green)]">
            <span className="w-7 h-7 rounded-md bg-[var(--gda-green)] text-white text-sm font-bold flex items-center justify-center">
              G
            </span>
            <div className="text-[11px] text-slate-500 leading-tight">
              Geo Decision Agent / ForestScope
              <br />
              生物多様性 意思決定エージェント
            </div>
          </div>

          <div className="mt-16">
            <div className="text-[13px] text-slate-500">TNFD LEAP アプローチ準拠</div>
            <h1 className="text-3xl font-bold mt-1 leading-tight">生物多様性 簡易スクリーニング報告</h1>
            <div className="mt-8 text-base">
              {r.project.clientName && (
                <div className="mb-1">
                  <span className="text-slate-500 text-sm mr-3">対象企業</span>
                  <span className="font-semibold text-lg">{r.project.clientName} 御中</span>
                </div>
              )}
              <div>
                <span className="text-slate-500 text-sm mr-3">対象案件</span>
                <span className="font-medium">{r.project.name}</span>
              </div>
              <div className="text-sm mt-1">
                <span className="text-slate-500 mr-3">対象面積</span>
                {r.project.areaHa ? `${r.project.areaHa.toLocaleString()} ha` : "未登録"}
                <span className="text-slate-500 ml-6 mr-3">スクリーニング対象</span>
                {r.sites.length} 地点
              </div>
              <div className="text-sm mt-1">
                <span className="text-slate-500 mr-3">作成日時</span>
                {generated}
              </div>
            </div>
          </div>

          <div className="mt-12 border border-amber-300 bg-amber-50 rounded-lg p-4">
            <div className="flex items-center gap-1.5 font-semibold text-amber-900 text-sm mb-2">
              <AlertTriangle size={15} /> 本書の位置づけ
            </div>
            <ul className="text-[12px] text-amber-900 leading-relaxed space-y-1.5 list-disc list-inside">
              <li>
                本書は衛星データによる<strong>一次スクリーニング</strong>です。
                環境影響評価法に基づく<strong>法定アセスメントの代替ではありません</strong>。
              </li>
              <li>立地の最終決定および法定アセスメントの要否判断は、所管行政庁および専門家の確認を経てください。</li>
              <li>
                各項目には根拠区分（衛星実測／現地確認済み／推定値／未取得）を付しています。
                <strong>「未取得」「判定不可」の項目は判定していません。</strong>
              </li>
              <li>
                TNFD LEAP の 16 コンポーネント（＋スコーピング）のうち、本システムが裏付けを提供できるのは
                対応 {r.coverageSummary.covered} ／ 部分対応 {r.coverageSummary.partial} です
                （対象外 {r.coverageSummary.notCovered}）。詳細は第2章に示します。
              </li>
            </ul>
          </div>

          <div className="mt-auto pt-8 text-[10px] text-slate-400">
            分析ID: {r.provenance.analysisId ?? "—"} ／ データ基準日:{" "}
            {r.dataAsOf ? new Date(r.dataAsOf).toLocaleDateString("ja-JP") : "—"}
          </div>
        </section>

        {/* --- 1. Screening result ----------------------------------------- */}
        <section className="page">
          <H n="1" title="スクリーニング結果" />
          <p className="text-[12px] text-slate-600 leading-relaxed mb-4">
            対象地点ごとの一次判定です。判定は本システムが取得した衛星実測値と現地記録に基づくもので、
            網羅的な環境調査の結果ではありません。
          </p>

          {r.sites.length === 0 ? (
            <Empty>スクリーニング対象の地点が登録されていません。</Empty>
          ) : (
            <div className="space-y-2.5">
              {r.sites.map((s, i) => (
                <div key={`${s.label}-${i}`} className="border border-slate-300 rounded-lg overflow-hidden break-inside-avoid">
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <span
                      className={`text-[11px] font-semibold border rounded px-2 py-1 shrink-0 ${VERDICT_STYLE[s.verdict]}`}
                    >
                      {SITE_VERDICT_LABEL[s.verdict]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">
                        {s.label}
                        {s.score != null && <span className="ml-2 text-slate-500 font-normal">総合スコア {s.score}</span>}
                      </div>
                      {s.lat != null && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          {s.lat.toFixed(5)}, {s.lng?.toFixed(5)}
                        </div>
                      )}
                      <p className="text-[11.5px] text-slate-700 leading-relaxed mt-1">{s.reason}</p>
                      {s.evidence.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {s.evidence.map((e) => (
                            <span key={e} className="text-[9.5px] border border-slate-300 rounded px-1.5 py-0.5 text-slate-600">
                              {e}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

        </section>

        {/* --- 2. LEAP coverage -------------------------------------------- */}
        <section className="page">
          <H n="2" title="TNFD LEAP 対応状況" />
          <p className="text-[12px] text-slate-600 leading-relaxed mb-3">
            LEAP は 4 フェーズ 16 コンポーネントで構成され、その前段にスコーピングが置かれます。
            本システムが各コンポーネントについて<strong>何を裏付けられ、何を裏付けられないか</strong>を示します。
          </p>
          <div className="flex gap-2 mb-3">
            {(
              [
                ["covered", r.coverageSummary.covered],
                ["partial", r.coverageSummary.partial],
                ["not_covered", r.coverageSummary.notCovered],
              ] as [Coverage, number][]
            ).map(([k, n]) => (
              <div key={k} className={`flex-1 border rounded-lg px-3 py-2 text-center ${COVERAGE_STYLE[k].className}`}>
                <div className="text-lg font-bold leading-none">{n}</div>
                <div className="text-[10px] mt-0.5">{COVERAGE_LABEL[k]}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-3 text-[10px] text-slate-600">
            <span className="font-medium">根拠区分の凡例：</span>
            <span className="border border-emerald-300 bg-emerald-50 text-emerald-800 rounded px-1.5 py-0.5">
              衛星実測／現地確認済み＝実データ
            </span>
            <span className="border border-sky-300 bg-sky-50 text-sky-800 rounded px-1.5 py-0.5">
              登録・設定値＝利用者が入力した条件
            </span>
            <span className="border border-amber-300 bg-amber-50 text-amber-800 rounded px-1.5 py-0.5">
              推定値＝シミュレーション
            </span>
            <span className="border border-slate-300 bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
              未取得＝判定していない
            </span>
          </div>

          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <Th className="w-14 whitespace-nowrap">コード</Th>
                <Th>コンポーネント</Th>
                <Th className="w-20 whitespace-nowrap">対応状況</Th>
              </tr>
            </thead>
            <tbody>
              {r.components.map((c) => (
                <tr key={c.code} className="border-b border-slate-200">
                  <Td className="font-mono font-semibold">{c.code}</Td>
                  <Td>
                    {c.title}
                    <span className="text-slate-400 ml-1.5 text-[10px]">{c.titleEn}</span>
                  </Td>
                  <Td>
                    <span
                      className={`inline-block text-[10px] border rounded px-1.5 py-0.5 whitespace-nowrap ${COVERAGE_STYLE[c.coverage].className}`}
                    >
                      {c.coverage === "not_covered" ? "対象外" : COVERAGE_LABEL[c.coverage]}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* --- 3. Sensitive locations -------------------------------------- */}
        <section className="page">
          <H n="3" title="感度の高い地域（sensitive locations）の5基準" />
          <p className="text-[12px] text-slate-600 leading-relaxed mb-3">
            TNFD は優先地域を「重要地域」と「感度の高い地域」で定義し、後者を5つの特性で判定します。
            本システムで判定できたものと、公的データ未接続により<strong>判定していない</strong>ものを区別して示します。
          </p>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <Th>基準</Th>
                <Th className="w-20">判定可否</Th>
                <Th>結果・備考</Th>
              </tr>
            </thead>
            <tbody>
              {r.sensitive.map((s) => (
                <tr key={s.key} className="border-b border-slate-200 align-top">
                  <Td className="font-medium">{s.title}</Td>
                  <Td>
                    <span
                      className={`inline-block text-[10px] border rounded px-1.5 py-0.5 ${
                        s.assessable
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                          : "bg-slate-100 text-slate-600 border-slate-300"
                      }`}
                    >
                      {s.assessable ? "判定済" : "判定不可"}
                    </span>
                  </Td>
                  <Td>
                    <div className={s.assessable ? "font-medium" : "text-slate-500"}>{s.result}</div>
                    {s.requires && <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{s.requires}</div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 border border-slate-300 bg-slate-50 rounded-lg p-3">
            <div className="text-[11px] font-semibold mb-1">この表の読み方</div>
            <p className="text-[11px] text-slate-700 leading-relaxed">
              「判定不可」は<strong>該当しないという意味ではありません</strong>。
              判定に必要な公的データが本システムに接続されていないため、判定を行っていないという意味です。
              開示や立地判断に用いる際は、これらの基準について別途照合が必要です。
            </p>
          </div>
        </section>

        {/* --- 4. Component detail ----------------------------------------- */}
        <section className="page">
          <H n="4" title="各コンポーネントの詳細" />
          {PHASES.map((phase) => {
            const items = r.components.filter((c) => c.phase === phase);
            if (items.length === 0) return null;
            return (
              <div key={phase} className="mb-5">
                <div className="text-[12px] font-semibold bg-slate-800 text-white px-2.5 py-1.5 rounded">
                  {PHASE_TITLE[phase]}
                </div>
                {items.map((c) => (
                  <ComponentBlock key={c.code} c={c} />
                ))}
              </div>
            );
          })}
        </section>

        {/* --- 5. Provenance & limits -------------------------------------- */}
        <section className="page">
          <H n="5" title="データソースと再現情報" />
          <table className="w-full text-[11px] border-collapse mb-6">
            <tbody>
              <KV k="衛星埋め込みデータ" v={r.provenance.embeddingDataset} />
              <KV k="衛星指標データ" v={r.provenance.indicesDataset} />
              <KV k="対象年" v={r.provenance.earthEngineYear ? `${r.provenance.earthEngineYear}年` : "—"} />
              <KV
                k="Earth Engine 接続"
                v={
                  r.provenance.earthEngineAvailable === null
                    ? "—"
                    : r.provenance.earthEngineAvailable
                      ? "接続あり（実データ）"
                      : "未接続（シミュレーション値）"
                }
              />
              <KV k="分析ID" v={r.provenance.analysisId ?? "—"} mono />
              <KV k="判定ロジック版" v={r.provenance.engineVersion ?? "—"} mono />
              <KV k="データ基準日" v={r.dataAsOf ? new Date(r.dataAsOf).toLocaleString("ja-JP") : "—"} />
              <KV k="作成日時" v={generated} />
            </tbody>
          </table>

          <H n="6" title="前提と限界" />
          <ul className="text-[11.5px] leading-relaxed space-y-1.5 list-disc list-inside text-slate-700">
            <li>
              本書は一次スクリーニングであり、環境影響評価法に基づく法定アセスメントの代替ではありません。
            </li>
            <li>
              衛星データは変化の<strong>有無</strong>を示しますが、<strong>原因</strong>
              （伐採・災害・病虫害・季節差）は判定できません。原因の特定には現地確認が必要です。
            </li>
            <li>
              感度の高い地域5基準のうち3基準（生物多様性重要地域・水リスク・生態系サービス）は、
              公的データ未接続のため判定していません。
            </li>
            <li>生態系サービスへの依存の評価、および重要性（materiality）の判定は本システムの対象外です。</li>
            <li>本書の内容は、社内の確認者による承認と専門家レビューを経てから開示にご利用ください。</li>
          </ul>

          {r.outstanding.length > 0 && (
            <>
              <div className="text-[12px] font-semibold mt-6 mb-2">次に必要な作業（{r.outstanding.length} 件）</div>
              <ul className="text-[11px] leading-relaxed space-y-1 list-disc list-inside text-slate-700">
                {r.outstanding.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </>
          )}

          <div className="text-[12px] font-semibold mt-6 mb-2">参照した枠組み</div>
          <ul className="text-[11px] leading-relaxed space-y-1 list-disc list-inside text-slate-600">
            <li>TNFD, Guidance on the identification and assessment of nature-related issues: the LEAP approach (v1.1)</li>
            <li>TNFD, Recommendations of the TNFD（4つの柱・14の推奨開示）</li>
            <li>SBTN, AR3T framework（緩和ヒエラルキー／IFC Performance Standard 6 由来）</li>
          </ul>

          <div className="mt-10 border-t border-slate-300 pt-4 grid grid-cols-2 gap-8 text-[11px]">
            <div>
              <div className="text-slate-500 mb-6">確認者</div>
              <div className="border-b border-slate-400" />
            </div>
            <div>
              <div className="text-slate-500 mb-6">承認日</div>
              <div className="border-b border-slate-400" />
            </div>
          </div>
        </section>
      </div>

      <style>{`
        .report { width: 210mm; }
        .page {
          min-height: 297mm;
          padding: 18mm 16mm;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        .page + .page { border-top: 1px dashed #cbd5e1; }
        @media print {
          @page { size: A4; margin: 0; }
          .report { width: auto; box-shadow: none; }
          .page { page-break-after: always; border-top: none !important; min-height: auto; }
          .page:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}

function ComponentBlock({ c }: { c: LeapComponent }) {
  const Icon = COVERAGE_STYLE[c.coverage].icon;
  return (
    <div className="border border-slate-300 border-t-0 px-3 py-2.5 break-inside-avoid">
      <div className="flex items-start gap-2">
        <span className="font-mono text-[11px] font-bold bg-slate-800 text-white rounded px-1.5 py-0.5 shrink-0">
          {c.code}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold">
            {c.title}
            <span className="text-slate-400 font-normal ml-1.5 text-[10px]">{c.titleEn}</span>
          </div>
          <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">問い：{c.question}</div>
        </div>
        <span
          className={`text-[10px] border rounded px-1.5 py-0.5 shrink-0 flex items-center gap-1 ${COVERAGE_STYLE[c.coverage].className}`}
        >
          <Icon size={9} strokeWidth={3} />
          {COVERAGE_LABEL[c.coverage]}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed mt-1.5 bg-slate-50 rounded px-2 py-1.5">{c.verdict}</p>

      {c.items.length > 0 && (
        <table className="w-full text-[10.5px] border-collapse mt-2">
          <tbody>
            {c.items.map((it) => (
              <tr key={it.label} className="border-b border-slate-100 align-top">
                <td className="py-1 pr-2 text-slate-500 w-36">{it.label}</td>
                <td className="py-1 pr-2">
                  {it.value}
                  {it.note && <div className="text-[9.5px] text-slate-500 leading-snug mt-0.5">※ {it.note}</div>}
                </td>
                <td className="py-1 w-24 text-right">
                  <span
                    className={`text-[9.5px] border rounded px-1 py-0.5 whitespace-nowrap ${
                      it.basis === "missing"
                        ? "bg-slate-100 text-slate-500 border-slate-300"
                        : it.basis === "estimated"
                          ? "bg-amber-50 text-amber-800 border-amber-300"
                          : it.basis === "configured" || it.basis === "map_designated"
                            ? "bg-sky-50 text-sky-800 border-sky-300"
                            : "bg-emerald-50 text-emerald-800 border-emerald-300"
                    }`}
                  >
                    {BASIS_LABEL[it.basis]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {c.gaps.length > 0 && (
        <div className="mt-2 text-[10.5px] text-slate-600 leading-snug">
          <span className="font-medium">次に必要なこと：</span>
          <ul className="list-disc list-inside mt-0.5 space-y-0.5">
            {c.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function H({ n, title, className = "" }: { n: string; title: string; className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 border-b-2 border-slate-800 pb-1.5 mb-3 ${className}`}>
      <span className="text-lg font-bold">{n}.</span>
      <h2 className="text-base font-bold">{title}</h2>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left font-semibold px-2 py-1.5 border-b-2 border-slate-300 ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 align-top ${className}`}>{children}</td>;
}

function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <tr className="border-b border-slate-200">
      <td className="py-1.5 pr-3 text-slate-500 w-44">{k}</td>
      <td className={`py-1.5 ${mono ? "font-mono text-[10px]" : ""}`}>{v}</td>
    </tr>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-slate-300 border-dashed rounded-lg px-4 py-8 text-center text-[11.5px] text-slate-500">
      {children}
    </div>
  );
}
