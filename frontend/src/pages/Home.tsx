import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Compass,
  Camera,
  Grid3x3,
  Sprout,
  ChevronRight,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  FileText,
  ArrowRight,
} from "lucide-react";
import { api } from "../lib/api";
import MapView from "../components/MapView";
import { EmptyState } from "../components/Explain";
import StatTile from "../components/ui/StatTile";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  use_case: string;
  candidate_count: number;
  center_lat: number;
  center_lng: number;
  updated_at: string;
  created_by_name: string;
}

interface ActivityItem {
  id: string;
  kind: "analysis" | "mesh" | "report";
  title: string;
  projectId: string;
  projectName: string;
  at: string;
  link: string;
  note: string | null;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  in_progress: { label: "進行中", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  needs_review: { label: "要確認", className: "bg-amber-50 text-amber-700 border-amber-200" },
  completed: { label: "調査完了", className: "bg-blue-50 text-blue-700 border-blue-200" },
};

const ACTIVITY_STYLE = {
  analysis: { icon: BarChart3, bg: "bg-emerald-50", fg: "text-emerald-600" },
  mesh: { icon: Grid3x3, bg: "bg-amber-50", fg: "text-amber-600" },
  report: { icon: FileText, bg: "bg-blue-50", fg: "text-blue-600" },
};

/**
 * V-01 ユニバーサルホーム / プロジェクトポートフォリオ.
 *
 * The screen's job, per the requirements, is to let someone see every case the
 * organisation holds, where those cases are, how far along they are, and what
 * needs attention - then start an analysis. So it is laid out as: map + counters
 * on top (where and how much), recent activity beside them (is anything moving),
 * project cards below (what specifically). Search sits above all of it because
 * on a portfolio of any size, finding is the first act.
 */
export default function Home() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const load = () => api.get<{ projects: ProjectRow[] }>("/projects").then((r) => setProjects(r.projects));

  useEffect(() => {
    load();
    api
      .get<{ items: ActivityItem[] }>("/dashboard/recent-activity")
      .then((r) => setActivity(r.items))
      .catch(() => setActivity([]));
  }, []);

  const counts = {
    in_progress: projects.filter((p) => p.status === "in_progress").length,
    needs_review: projects.filter((p) => p.status === "needs_review").length,
    completed: projects.filter((p) => p.status === "completed").length,
  };

  const filtered = projects.filter(
    (p) => p.name.toLowerCase().includes(query.toLowerCase()) && (!statusFilter || p.status === statusFilter),
  );

  const createProject = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ id: string }>("/projects", { name: newName.trim() });
      setShowNew(false);
      setNewName("");
      navigate(`/projects/${res.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 sm:p-5 lg:p-6 max-w-[1400px] mx-auto">
      {/* Search + primary action. On a phone the action drops below and goes
          full width, because it is the one thing a first-time user must find. */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="プロジェクト、エリア、データ、レポートを検索"
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
          />
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center justify-center gap-2 bg-[var(--gda-navy)] hover:bg-[var(--gda-navy-light)] text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap shadow-sm"
        >
          <Plus size={16} /> 新しい調査を開始
        </button>
      </div>

      {projects.length === 0 && <FirstRun onStart={() => setShowNew(true)} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
        {/* Map: where the organisation's cases actually are. */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden order-2 lg:order-1">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm text-slate-800">プロジェクトマップ</div>
              <div className="text-[11px] text-slate-500 truncate">プロジェクトの俯瞰と対象エリア</div>
            </div>
            <Link to="/map" className="text-[11px] text-[var(--gda-green)] font-medium flex items-center gap-0.5 shrink-0">
              地図ビュー <ChevronRight size={12} />
            </Link>
          </div>
          <div className="h-56 sm:h-72 lg:h-[340px]">
            <MapView
              center={[36.2048, 138.2529]}
              zoom={5}
              basemap="satellite"
              globe
              introFlight
              showUserLocation
              markers={projects
                .filter((p) => p.center_lat && p.center_lng)
                .map((p) => ({ lat: p.center_lat, lng: p.center_lng, label: p.name }))}
            />
          </div>
        </div>

        <div className="space-y-3 sm:space-y-4 order-1 lg:order-2">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <StatTile
              icon={PlayCircle}
              label="進行中"
              value={counts.in_progress}
              tone="info"
              onClick={() => setStatusFilter(statusFilter === "in_progress" ? null : "in_progress")}
            />
            <StatTile
              icon={AlertTriangle}
              label="要確認"
              value={counts.needs_review}
              tone="warn"
              onClick={() => setStatusFilter(statusFilter === "needs_review" ? null : "needs_review")}
            />
            <StatTile
              icon={CheckCircle2}
              label="調査完了"
              value={counts.completed}
              tone="done"
              onClick={() => setStatusFilter(statusFilter === "completed" ? null : "completed")}
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
              <div className="text-sm font-medium text-slate-800">最近の分析</div>
              <Link to="/reports" className="text-[11px] text-slate-500">
                すべて表示
              </Link>
            </div>
            <div className="divide-y divide-slate-50 max-h-[260px] overflow-y-auto scrollbar-thin">
              {activity.map((item) => {
                const style = ACTIVITY_STYLE[item.kind];
                const Icon = style.icon;
                return (
                  <Link key={item.id} to={item.link} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${style.bg}`}>
                      <Icon size={15} className={style.fg} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-medium text-slate-800 truncate">{item.title}</div>
                      <div className="text-[10px] text-slate-400 truncate">{item.projectName}</div>
                    </div>
                    <div className="text-[9.5px] text-slate-400 text-right shrink-0 leading-tight">
                      {new Date(item.at).toLocaleDateString("ja-JP")}
                      <br />
                      {new Date(item.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </Link>
                );
              })}
              {activity.length === 0 && (
                <div className="px-4 py-8 text-center text-[11px] text-slate-400">
                  まだ分析の記録がありません。
                  <br />
                  調査を開始すると、ここに履歴が並びます。
                </div>
              )}
            </div>
            <Link
              to="/dashboard"
              className="flex items-center justify-center gap-1 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              すべてのアクティビティを表示 <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2.5">
        <div className="font-medium text-sm text-slate-800">
          プロジェクト
          <span className="text-[11px] text-slate-400 font-normal ml-1.5">{filtered.length}件</span>
        </div>
        {statusFilter && (
          <button onClick={() => setStatusFilter(null)} className="text-[11px] text-[var(--gda-green)] font-medium">
            絞り込みを解除（{STATUS_LABEL[statusFilter]?.label}）
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {filtered.map((p) => {
          const status = STATUS_LABEL[p.status] ?? STATUS_LABEL.in_progress;
          return (
            <button
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="text-left bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md hover:border-slate-300 transition-all"
            >
              <div className="h-28 sm:h-32 relative">
                <MapView
                  center={[p.center_lat, p.center_lng]}
                  zoom={9}
                  basemap="satellite"
                  globe={false}
                  chrome={false}
                  markers={[{ lat: p.center_lat, lng: p.center_lng, label: p.name }]}
                />
                <span
                  className={`absolute top-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full border shadow-sm ${status.className}`}
                >
                  {status.label}
                </span>
              </div>
              <div className="p-3.5">
                <div className="font-semibold text-sm text-slate-800 truncate">{p.name}</div>
                <div className="text-[10.5px] text-slate-400 mt-1">
                  最終更新日: {new Date(p.updated_at).toLocaleDateString("ja-JP")}
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10.5px] text-slate-500">
                    担当 {p.created_by_name} ・ 候補地 {p.candidate_count}件
                  </span>
                  <span className="text-[11px] text-[var(--gda-green)] font-medium flex items-center shrink-0">
                    開く <ChevronRight size={12} />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && projects.length > 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Compass}
              title="該当するプロジェクトがありません"
              body="検索条件や絞り込みを変えてお試しください。"
            />
          </div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" onClick={() => setShowNew(false)}>
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-medium text-slate-800 mb-1">新しい調査を開始</div>
            <p className="text-[11px] text-slate-500 mb-4">
              案件名だけで始められます。対象地はあとから地図で指定できます。
            </p>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="案件名（例: 万波山林モニタリング）"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && createProject()}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-600">
                キャンセル
              </button>
              <button
                onClick={createProject}
                disabled={busy}
                className="px-4 py-2.5 text-sm bg-[var(--gda-green)] text-white rounded-lg font-medium disabled:opacity-50"
              >
                {busy ? "作成中..." : "作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown only while the portfolio is empty: the four steps to a first result. */
function FirstRun({ onStart }: { onStart: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 mb-4">
      <div className="text-sm font-semibold text-slate-800 mb-1">はじめての方へ — 結果が出るまでの4ステップ</div>
      <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
        このシステムは「衛星から見た土地の特徴」と「現場で確認した生きもの」を重ね合わせて、
        保全すべき場所と回復すべき場所を示します。順番に進めてください。
      </p>
      <ol className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { icon: Plus, title: "調査を作成する", body: "案件名と対象地を登録します。" },
          {
            icon: Camera,
            title: "現地記録を登録し、査読する",
            body: "現場の写真とGPSを登録して「確認済み」にします。ここが後の判定の基準になるため、離れた複数地点で登録すると精度が上がります。",
          },
          {
            icon: Grid3x3,
            title: "10mメッシュ解析を実行する",
            body: "対象地を10m四方に区切り、1マスずつ衛星データを取得して、保全優先・回復候補・要確認に色分けします。",
          },
          {
            icon: Sprout,
            title: "回復計画とレポートを確認する",
            body: "どの区域に何をすべきかが整理され、TNFD開示の形式でも出力できます。",
          },
        ].map((step, i) => (
          <li key={step.title} className="flex gap-2.5">
            <span className="w-6 h-6 rounded-full bg-[var(--gda-green)] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
                <step.icon size={13} className="text-slate-400 shrink-0" />
                {step.title}
              </div>
              <div className="text-[11px] text-slate-500 leading-relaxed mt-0.5">{step.body}</div>
            </div>
          </li>
        ))}
      </ol>
      <button
        onClick={onStart}
        className="mt-4 w-full sm:w-auto flex items-center justify-center gap-2 bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] text-white text-sm font-medium px-4 py-2.5 rounded-xl"
      >
        <Plus size={15} /> 最初の調査を作成する
      </button>
    </div>
  );
}
