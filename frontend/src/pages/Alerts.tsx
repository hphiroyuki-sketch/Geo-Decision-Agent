import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { api } from "../lib/api";

interface ActionItem {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  projectName: string | null;
  lat: number | null;
  lng: number | null;
  at: string;
  link: string;
}

const SEVERITY: Record<ActionItem["severity"], { label: string; className: string }> = {
  high: { label: "高", className: "bg-rose-50 text-rose-700 border-rose-200" },
  medium: { label: "中", className: "bg-amber-50 text-amber-700 border-amber-200" },
  low: { label: "低", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

export default function Alerts() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [filter, setFilter] = useState<"all" | ActionItem["severity"]>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ items: ActionItem[] }>("/dashboard/action-items")
      .then((r) => setItems(r.items))
      .finally(() => setLoading(false));
  }, []);

  const shown = filter === "all" ? items : items.filter((i) => i.severity === filter);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <div className="text-xs text-slate-400">アラート</div>
        <h1 className="text-lg font-semibold text-slate-800">対応が必要な項目</h1>
        <p className="text-xs text-slate-500 mt-1">
          変化検出、未査読の現地記録、担当者未設定の施策を重要度順にまとめています。
        </p>
      </div>

      <div className="flex gap-1.5">
        {(["all", "high", "medium", "low"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border ${
              filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
            }`}
          >
            {f === "all" ? `すべて (${items.length})` : `${SEVERITY[f].label} (${items.filter((i) => i.severity === f).length})`}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {shown.map((item) => (
          <Link key={`${item.severity}-${item.id}`} to={item.link} className="block px-4 py-3 hover:bg-slate-50">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${SEVERITY[item.severity].className}`}>
                {SEVERITY[item.severity].label}
              </span>
              <span className="text-[10px] text-slate-400">{new Date(item.at).toLocaleString("ja-JP")}</span>
              {item.projectName && <span className="text-[10px] text-slate-400">・ {item.projectName}</span>}
            </div>
            <div className="text-sm font-medium text-slate-800 mt-1">{item.title}</div>
            <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.detail}</div>
            {item.lat != null && item.lng != null && (
              <div className="text-[10px] text-slate-400 mt-1">
                {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
              </div>
            )}
          </Link>
        ))}
        {!loading && shown.length === 0 && (
          <div className="px-4 py-16 text-center text-slate-400">
            <Bell size={22} className="mx-auto mb-2 opacity-40" />
            <div className="text-sm">対応が必要な項目はありません。</div>
          </div>
        )}
      </div>
    </div>
  );
}
