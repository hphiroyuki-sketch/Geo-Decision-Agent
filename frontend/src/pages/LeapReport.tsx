import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Printer, MapPin, Search, Microscope, Scale, ClipboardCheck, TriangleAlert, FileText } from "lucide-react";
import { api } from "../lib/api";
import { Term, Hint, EmptyState } from "../components/Explain";

interface LeapItem {
  label: string;
  value: string;
  basis: "measured" | "field_confirmed" | "estimated" | "missing";
  note?: string;
}

interface LeapSection {
  stage: "locate" | "evaluate" | "assess" | "prepare";
  summary: string;
  items: LeapItem[];
  gaps: string[];
}

interface LeapReportData {
  project: { id: string; name: string; useCase: string; areaHa: number | null };
  generatedAt: string;
  dataAsOf: string | null;
  meshId: string | null;
  sections: LeapSection[];
  outstanding: string[];
}

const STAGE_META = {
  locate: {
    code: "L",
    title: "Locate — 自然との接点を特定する",
    question: "事業はどこで自然と接しているか。優先的に注意すべき場所はどこか。",
    icon: MapPin,
  },
  evaluate: {
    code: "E",
    title: "Evaluate — 依存と影響を診断する",
    question: "その場所で、事業は自然に何を依存し、何の影響を与えているか。",
    icon: Microscope,
  },
  assess: {
    code: "A",
    title: "Assess — リスクと機会を評価する",
    question: "そこから生じるリスクと機会は何か。重要なものはどれか。",
    icon: Scale,
  },
  prepare: {
    code: "P",
    title: "Prepare — 対応と開示を準備する",
    question: "何に取り組み、何を開示し、どう測るか。",
    icon: ClipboardCheck,
  },
} as const;

const BASIS_STYLE: Record<LeapItem["basis"], { label: string; className: string }> = {
  measured: { label: "衛星実データ", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  field_confirmed: { label: "現地確認済み", className: "bg-sky-50 text-sky-700 border-sky-200" },
  estimated: { label: "推定値", className: "bg-amber-50 text-amber-700 border-amber-200" },
  missing: { label: "未取得", className: "bg-slate-100 text-slate-500 border-slate-200" },
};

export default function LeapReport() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<LeapReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api
      .get<LeapReportData>(`/projects/${id}/leap`)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-10 text-center text-sm text-slate-400">読み込み中...</div>;
  if (error || !report)
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="レポートを生成できません" body={error ?? "データが不足しています。"} />
      </div>
    );

  const measuredCount = report.sections.flatMap((s) => s.items).filter((i) => i.basis !== "missing").length;
  const totalCount = report.sections.flatMap((s) => s.items).length;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 print:p-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">FR-053 ／ TNFD LEAPアプローチ</div>
          <h1 className="text-lg font-semibold text-slate-800">{report.project.name}｜自然関連情報開示（案）</h1>
          <p className="text-[11px] text-slate-500 mt-1">
            生成 {new Date(report.generatedAt).toLocaleString("ja-JP")}
            {report.dataAsOf && ` ／ データ時点 ${new Date(report.dataAsOf).toLocaleString("ja-JP")}`}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="print:hidden flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-3 py-2 shrink-0"
        >
          <Printer size={14} /> 印刷 / PDF
        </button>
      </div>

      <Hint tone="warn">
        <strong>この文書は「案」です。</strong>
        <Term id="leap">TNFD LEAPアプローチ</Term>
        の4段階に沿って、本システムが保持しているデータのみから自動生成しています。
        開示にあたっては、社内の確認者による承認と専門家レビューを必ず経てください。
        データが無い項目は創作せず「未取得」と表示し、取得方法を併記しています（
        {totalCount - measuredCount} / {totalCount} 項目が未取得）。
      </Hint>

      {report.sections.map((section) => {
        const meta = STAGE_META[section.stage];
        const Icon = meta.icon;
        return (
          <section key={section.stage} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
              <span className="w-8 h-8 rounded-lg bg-[var(--gda-navy)] text-white flex items-center justify-center font-semibold text-sm shrink-0">
                {meta.code}
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  <Icon size={14} className="text-slate-400" />
                  {meta.title}
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">{meta.question}</p>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-slate-100">
              <div className="text-[11px] text-slate-400 mb-1">要約</div>
              <p className="text-sm text-slate-700 leading-relaxed">{section.summary}</p>
            </div>

            <dl className="divide-y divide-slate-100">
              {section.items.map((item) => {
                const basis = BASIS_STYLE[item.basis];
                return (
                  <div key={item.label} className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-3">
                    <dt className="text-[11px] text-slate-500 flex items-start gap-1.5">
                      <span>{item.label}</span>
                    </dt>
                    <dd className="text-xs text-slate-700 leading-relaxed">
                      <span className={`inline-block text-[10px] font-medium border rounded px-1.5 py-0.5 mr-2 align-middle ${basis.className}`}>
                        {basis.label}
                      </span>
                      {item.value}
                      {item.note && <div className="text-[11px] text-amber-700 mt-1">{item.note}</div>}
                    </dd>
                  </div>
                );
              })}
            </dl>

            {section.gaps.length > 0 && (
              <div className="px-4 py-3 bg-amber-50/50 border-t border-amber-100">
                <div className="text-[11px] font-medium text-amber-900 flex items-center gap-1 mb-1">
                  <TriangleAlert size={12} /> この段階で不足していること
                </div>
                <ul className="space-y-1">
                  {section.gaps.map((gap, i) => (
                    <li key={i} className="text-[11px] text-amber-900 leading-relaxed">
                      ・{gap}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}

      <div className="print:hidden flex flex-wrap gap-2">
        <Link
          to={`/projects/${id}/mesh`}
          className="flex-1 min-w-[140px] text-center text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2.5"
        >
          <Search size={13} className="inline mr-1" />
          10mメッシュ解析へ
        </Link>
        <Link
          to={`/projects/${id}/recovery`}
          className="flex-1 min-w-[140px] text-center text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2.5"
        >
          回復計画へ
        </Link>
        <Link
          to={`/projects/${id}/report`}
          className="flex-1 min-w-[140px] text-center text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2.5"
        >
          意思決定レポートへ
        </Link>
      </div>
    </div>
  );
}
