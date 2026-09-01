import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { api } from "../lib/api";

interface ReportRow {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  summary: string | null;
  status: string;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = { draft: "下書き", reviewed: "レビュー済み", approved: "承認済み" };

export default function ReportsIndex() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ reports: ReportRow[] }>("/dashboard/reports")
      .then((r) => setReports(r.reports))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <div className="text-xs text-slate-400">レポート</div>
        <h1 className="text-lg font-semibold text-slate-800">意思決定レポート</h1>
        <p className="text-xs text-slate-500 mt-1">
          全プロジェクトのレポート一覧。各レポートは分析時点のデータ・条件・レビュー記録に紐づいています。
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {reports.map((r) => (
          <Link key={r.id} to={`/projects/${r.project_id}/report`} className="block px-4 py-3 hover:bg-slate-50">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-800 truncate">{r.title}</div>
              <span className="shrink-0 text-[11px] bg-slate-100 text-slate-600 rounded px-2 py-0.5">
                {STATUS_LABEL[r.status] ?? r.status}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {r.project_name} ・ {new Date(r.created_at).toLocaleString("ja-JP")}
            </div>
            {r.summary && <div className="text-xs text-slate-600 mt-1 line-clamp-2">{r.summary}</div>}
          </Link>
        ))}
        {!loading && reports.length === 0 && (
          <div className="px-4 py-16 text-center text-slate-400">
            <FileText size={22} className="mx-auto mb-2 opacity-40" />
            <div className="text-sm">まだレポートがありません。</div>
          </div>
        )}
      </div>
    </div>
  );
}
