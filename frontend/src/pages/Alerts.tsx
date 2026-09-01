import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, RefreshCw, SlidersHorizontal, MapPin } from "lucide-react";
import { api } from "../lib/api";
import { Hint, EmptyState } from "../components/Explain";

interface AlertRow {
  id: string;
  project_id: string | null;
  project_name: string | null;
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  detail: string;
  next_action: string | null;
  lat: number | null;
  lng: number | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

interface RuleRow {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  severity: string;
  enabled: number;
}

const SEVERITY: Record<AlertRow["severity"], { label: string; className: string }> = {
  high: { label: "高", className: "bg-rose-50 text-rose-700 border-rose-200" },
  medium: { label: "中", className: "bg-amber-50 text-amber-700 border-amber-200" },
  low: { label: "低", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

const CATEGORY_LABEL: Record<string, string> = {
  threshold: "判定基準の超過",
  review: "査読待ち",
  data: "データ更新",
  system: "システム",
};

export default function Alerts() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [filter, setFilter] = useState<"unread" | "all" | AlertRow["severity"]>("unread");
  const [showRules, setShowRules] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [a, r] = await Promise.all([
      api.get<{ alerts: AlertRow[]; unread: number }>("/alerts"),
      api.get<{ rules: RuleRow[] }>("/alerts/rules"),
    ]);
    setAlerts(a.alerts);
    setRules(r.rules);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.post("/alerts/refresh", {});
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const markRead = async (id: string) => {
    await api.post(`/alerts/${id}/read`, {});
    load();
  };

  const markAllRead = async () => {
    await api.post("/alerts/read-all", {});
    load();
  };

  const updateRule = async (id: string, patch: Record<string, unknown>) => {
    await api.post(`/alerts/rules/${id}`, patch);
    load();
  };

  const unreadCount = alerts.filter((a) => !a.read_at).length;
  const shown = alerts.filter((a) => {
    if (filter === "all") return true;
    if (filter === "unread") return !a.read_at;
    return a.severity === filter;
  });

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">FR-060 ／ アラート</div>
          <h1 className="text-lg font-semibold text-slate-800">対応が必要な項目</h1>
          <p className="text-xs text-slate-500 mt-1">
            判定基準を超えた変化、査読待ちの現地記録などを重要度順に表示します。各項目には「次に何をすべきか」が付いています。
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-2.5 py-2"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> 再判定
          </button>
          <button
            onClick={() => setShowRules((v) => !v)}
            className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-2.5 py-2"
          >
            <SlidersHorizontal size={13} /> 基準
          </button>
        </div>
      </div>

      {showRules && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="text-sm font-medium text-slate-700">判定基準（しきい値）</div>
          <Hint tone="info">
            しきい値を下げるほど多くの項目が上がってきます。通知が多すぎると読まれなくなるため、
            まずは既定値で運用し、見逃しが出た場合に少しずつ下げることをおすすめします。
          </Hint>
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 text-xs border-t border-slate-100 pt-3">
              <input
                type="checkbox"
                checked={rule.enabled === 1}
                onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800">{rule.name}</div>
                <div className="text-[11px] text-slate-400">
                  {rule.metric} が {rule.threshold} {rule.comparator === "gte" ? "以上" : "以下"} のとき
                </div>
              </div>
              <input
                type="number"
                step={0.01}
                value={rule.threshold}
                onChange={(e) => updateRule(rule.id, { threshold: Number(e.target.value) })}
                className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-xs"
              />
              <span className={`text-[10px] border rounded px-1.5 py-0.5 ${SEVERITY[rule.severity as AlertRow["severity"]]?.className}`}>
                {SEVERITY[rule.severity as AlertRow["severity"]]?.label}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {(["unread", "all", "high", "medium", "low"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              {f === "unread"
                ? `未読 (${unreadCount})`
                : f === "all"
                  ? `すべて (${alerts.length})`
                  : `${SEVERITY[f].label} (${alerts.filter((a) => a.severity === f).length})`}
            </button>
          ))}
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-xs text-slate-500 underline">
            すべて既読にする
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {shown.map((alert) => (
          <div key={alert.id} className={`px-4 py-3 ${alert.read_at ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${SEVERITY[alert.severity].className}`}>
                {SEVERITY[alert.severity].label}
              </span>
              <span className="text-[10px] text-slate-400">{CATEGORY_LABEL[alert.category] ?? alert.category}</span>
              <span className="text-[10px] text-slate-400">{new Date(alert.created_at).toLocaleString("ja-JP")}</span>
              {alert.project_name && <span className="text-[10px] text-slate-400">・ {alert.project_name}</span>}
            </div>
            <div className="text-sm font-medium text-slate-800 mt-1">{alert.title}</div>
            <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{alert.detail}</div>
            {alert.next_action && (
              <div className="mt-2 bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed">
                <span className="font-medium">次にすること：</span>
                {alert.next_action}
              </div>
            )}
            <div className="flex items-center gap-3 mt-2">
              {alert.link && (
                <Link to={alert.link} className="text-[11px] font-medium text-[var(--gda-green)] underline">
                  該当箇所を開く
                </Link>
              )}
              {alert.lat != null && alert.lng != null && (
                <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                  <MapPin size={10} />
                  {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)}
                </span>
              )}
              {!alert.read_at && (
                <button onClick={() => markRead(alert.id)} className="text-[11px] text-slate-500 flex items-center gap-0.5 ml-auto">
                  <Check size={11} /> 既読
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && shown.length === 0 && (
          <EmptyState
            icon={Bell}
            title={filter === "unread" ? "未読の項目はありません" : "アラートはありません"}
            body="変化の検出や査読待ちが発生すると、ここに重要度順で表示されます。判定は5分ごとに自動実行され、「再判定」でその場でも実行できます。"
          />
        )}
      </div>
    </div>
  );
}
