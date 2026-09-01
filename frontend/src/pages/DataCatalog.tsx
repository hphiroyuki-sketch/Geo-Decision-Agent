import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Database, CheckCircle2, Clock, XCircle } from "lucide-react";
import { api } from "../lib/api";

interface RecordRow {
  id: string;
  lat: number;
  lng: number;
  species_guess: string | null;
  taxon_confidence: string | null;
  notes: string | null;
  photo_key: string | null;
  captured_at: string;
  review_status: string;
  project_id: string;
  project_name: string;
  observer_name: string;
}

const STATUS: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  confirmed: { label: "確認済み", icon: CheckCircle2, className: "text-green-700" },
  rejected: { label: "却下", icon: XCircle, className: "text-red-600" },
  unreviewed: { label: "未確認", icon: Clock, className: "text-slate-400" },
};

export default function DataCatalog() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ records: RecordRow[] }>("/dashboard/field-records")
      .then((r) => setRecords(r.records))
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    confirmed: records.filter((r) => r.review_status === "confirmed").length,
    unreviewed: records.filter((r) => r.review_status === "unreviewed").length,
    rejected: records.filter((r) => r.review_status === "rejected").length,
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <div className="text-xs text-slate-400">データ</div>
        <h1 className="text-lg font-semibold text-slate-800">現地データカタログ</h1>
        <p className="text-xs text-slate-500 mt-1">
          全プロジェクトの現地記録（写真・GPS・種）。確認済みの記録だけが、衛星エンベディングの基準ベクトルと分析の根拠に使われます。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] text-slate-500">確認済み（分析に反映）</div>
          <div className="text-xl font-semibold text-green-700">{counts.confirmed}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] text-slate-500">未確認</div>
          <div className="text-xl font-semibold text-slate-800">{counts.unreviewed}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] text-slate-500">却下</div>
          <div className="text-xl font-semibold text-slate-400">{counts.rejected}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {records.map((r) => {
          const status = STATUS[r.review_status] ?? STATUS.unreviewed;
          const Icon = status.icon;
          return (
            <div key={r.id} className="flex gap-3 p-3">
              {r.photo_key && (
                <img
                  src={`/api/field-records/${r.id}/photo`}
                  alt={r.species_guess ?? "現地写真"}
                  className="w-14 h-14 rounded-lg object-cover shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800 truncate">{r.species_guess ?? "種未記入"}</div>
                  <span className={`shrink-0 text-[11px] flex items-center gap-1 font-medium ${status.className}`}>
                    <Icon size={13} />
                    {status.label}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  <Link to={`/projects/${r.project_id}/field`} className="hover:underline">
                    {r.project_name}
                  </Link>
                  {" ・ "}
                  {r.observer_name} ・ {new Date(r.captured_at).toLocaleString("ja-JP")} ・{" "}
                  {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                </div>
                {r.notes && <div className="text-xs text-slate-600 mt-1">{r.notes}</div>}
              </div>
            </div>
          );
        })}
        {!loading && records.length === 0 && (
          <div className="px-4 py-16 text-center text-slate-400">
            <Database size={22} className="mx-auto mb-2 opacity-40" />
            <div className="text-sm">まだ現地データがありません。</div>
          </div>
        )}
      </div>
    </div>
  );
}
