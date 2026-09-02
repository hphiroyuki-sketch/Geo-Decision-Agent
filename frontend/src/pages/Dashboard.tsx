import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Grid3x3, TriangleAlert, Sprout, ShieldCheck, ChevronRight, Satellite } from "lucide-react";
import { api } from "../lib/api";
import MapView, { type Basemap, type MapMarker } from "../components/MapView";
import { Hint, Term } from "../components/Explain";

interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  sub: string;
  tone: "info" | "warn" | "good" | "alert";
}

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  use_case: string;
  center_lat: number | null;
  center_lng: number | null;
  area_ha: number | null;
  updated_at: string;
  owner_name: string | null;
  sampled_cells: number;
  total_cells: number;
  candidates: number;
  field_records: number;
}

interface ActionItem {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  projectId: string | null;
  projectName: string | null;
  lat: number | null;
  lng: number | null;
  at: string;
  link: string;
}

const KPI_ICON: Record<string, typeof Grid3x3> = {
  monitored: Grid3x3,
  attention: TriangleAlert,
  recovery: Sprout,
  protect: ShieldCheck,
};

const TONE: Record<Kpi["tone"], string> = {
  info: "bg-sky-50 text-sky-700",
  warn: "bg-amber-50 text-amber-700",
  good: "bg-emerald-50 text-emerald-700",
  alert: "bg-rose-50 text-rose-700",
};

const SEVERITY: Record<ActionItem["severity"], { label: string; className: string }> = {
  high: { label: "高", className: "bg-rose-50 text-rose-700 border-rose-200" },
  medium: { label: "中", className: "bg-amber-50 text-amber-700 border-amber-200" },
  low: { label: "低", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

const STATUS_LABEL: Record<string, string> = {
  in_progress: "進行中",
  needs_review: "要確認",
  completed: "完了",
};

export default function Dashboard() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ kpis: Kpi[]; projects: ProjectRow[] }>("/dashboard"),
      api.get<{ items: ActionItem[] }>("/dashboard/action-items"),
    ])
      .then(([overview, actions]) => {
        setKpis(overview.kpis);
        setProjects(overview.projects);
        setItems(actions.items);
      })
      .finally(() => setLoading(false));
  }, []);

  const markers: MapMarker[] = useMemo(() => {
    const projectMarkers = projects
      .filter((p) => p.center_lat != null && p.center_lng != null)
      .map((p) => ({
        lat: p.center_lat as number,
        lng: p.center_lng as number,
        label: p.name,
        color: "#1f7a4d",
      }));
    const itemMarkers = items
      .filter((i) => i.lat != null && i.lng != null)
      .map((i) => ({
        lat: i.lat as number,
        lng: i.lng as number,
        label: i.title,
        color: i.severity === "high" ? "#b3432b" : i.severity === "medium" ? "#c98a1b" : "#6b7280",
      }));
    return [...projectMarkers, ...itemMarkers];
  }, [projects, items]);

  const center = useMemo((): [number, number] => {
    const withCoords = projects.filter((p) => p.center_lat != null && p.center_lng != null);
    if (withCoords.length === 0) return [36.2048, 138.2529];
    return [
      withCoords.reduce((s, p) => s + (p.center_lat as number), 0) / withCoords.length,
      withCoords.reduce((s, p) => s + (p.center_lng as number), 0) / withCoords.length,
    ];
  }, [projects]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">全社ダッシュボード</div>
          <h1 className="text-lg font-semibold text-slate-800">事業ダッシュボード / 全体リスク俯瞰</h1>
        </div>
        <div className="text-[11px] text-slate-400">{new Date().toLocaleString("ja-JP")}</div>
      </div>

      <Hint tone="info">
        この画面は<strong>全案件を横断した現在地</strong>です。左から順に「どれだけ見ているか」「今すぐ手当てが要るか」
        「回復の伸びしろがあるか」「守るべき場所があるか」を表します。数字はすべてシステムが実際に保持している記録を
        数えたもので、推計値ではありません。まず<strong>「要確認」</strong>を見て、0でなければ右の一覧から着手してください。
      </Hint>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = KPI_ICON[k.key] ?? Grid3x3;
          return (
            <div key={k.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2.5">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${TONE[k.tone]}`}>
                  <Icon size={17} />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500">
                    {k.key === "protect" || k.key === "recovery" ? <Term id="similarity">{k.label}</Term> : k.label}
                  </div>
                  <div className="text-xl font-semibold text-slate-800 leading-tight">
                    {k.value.toLocaleString()}
                    <span className="text-[11px] font-normal text-slate-400 ml-1">{k.unit}</span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-2 leading-snug">{k.sub}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <div className="text-sm font-medium text-slate-700">対象地とリスクの分布</div>
            <button
              onClick={() => setBasemap(basemap === "satellite" ? "streets" : "satellite")}
              className="flex items-center gap-1 text-[11px] text-slate-500 border border-slate-200 rounded-lg px-2 py-1"
            >
              <Satellite size={11} /> {basemap === "satellite" ? "地図に切替" : "衛星に切替"}
            </button>
          </div>
          <div className="h-[320px]">
            <MapView center={center} zoom={7} markers={markers} basemap={basemap} globe introFlight showUserLocation />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-medium text-slate-700">
            対応が必要な項目
            <span className="ml-1.5 text-[11px] text-slate-400">{items.length}件</span>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[320px] divide-y divide-slate-100">
            {items.map((item) => (
              <Link key={`${item.severity}-${item.id}`} to={item.link} className="block px-4 py-3 hover:bg-slate-50">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${SEVERITY[item.severity].className}`}
                  >
                    {SEVERITY[item.severity].label}
                  </span>
                  <span className="text-[10px] text-slate-400">{new Date(item.at).toLocaleString("ja-JP")}</span>
                </div>
                <div className="text-xs font-medium text-slate-800 mt-1">{item.title}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{item.detail}</div>
                {item.projectName && <div className="text-[10px] text-slate-400 mt-1">{item.projectName}</div>}
              </Link>
            ))}
            {!loading && items.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-slate-400">対応が必要な項目はありません。</div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
          <div className="text-sm font-medium text-slate-700">進行中のプロジェクト</div>
          <Link to="/" className="text-[11px] text-slate-500 flex items-center gap-0.5">
            すべて見る <ChevronRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4">
          {projects.slice(0, 8).map((p) => {
            const progress = p.total_cells > 0 ? Math.round((p.sampled_cells / p.total_cells) * 100) : 0;
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="border border-slate-200 rounded-xl p-3 hover:border-[var(--gda-green)] transition-colors"
              >
                <div className="text-xs font-semibold text-slate-800 truncate">{p.name}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{p.owner_name ?? "—"}</div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                  <span className="text-[10px] text-slate-400">{p.use_case}</span>
                </div>
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>メッシュ取得</span>
                    <span>{p.total_cells > 0 ? `${progress}%` : "未実施"}</span>
                  </div>
                  <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--gda-green)]" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 mt-2">
                  候補地 {p.candidates} ・ 現地記録 {p.field_records}
                </div>
              </Link>
            );
          })}
          {!loading && projects.length === 0 && (
            <div className="col-span-full text-center text-xs text-slate-400 py-8">
              プロジェクトがまだありません。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
