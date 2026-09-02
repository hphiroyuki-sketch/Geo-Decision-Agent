import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Compass, Camera, Grid3x3, Sprout, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import MapView from "../components/MapView";
import { EmptyState } from "../components/Explain";

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

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  in_progress: { label: "進行中", className: "bg-green-100 text-green-700" },
  needs_review: { label: "要確認", className: "bg-amber-100 text-amber-700" },
  completed: { label: "調査完了", className: "bg-blue-100 text-blue-700" },
};

export default function Home() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get<{ projects: ProjectRow[] }>("/projects").then((r) => setProjects(r.projects));

  useEffect(() => {
    load();
  }, []);

  const counts = {
    in_progress: projects.filter((p) => p.status === "in_progress").length,
    needs_review: projects.filter((p) => p.status === "needs_review").length,
    completed: projects.filter((p) => p.status === "completed").length,
  };

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-6">
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
          className="flex items-center justify-center gap-2 bg-[var(--gda-navy)] hover:bg-[var(--gda-navy-light)] text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap"
        >
          <Plus size={16} /> 新しい調査を開始
        </button>
      </div>

      {projects.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
          <div className="text-sm font-semibold text-slate-800 mb-1">はじめての方へ — 結果が出るまでの4ステップ</div>
          <p className="text-xs text-slate-500 mb-4">
            このシステムは「衛星から見た土地の特徴」と「現場で確認した生きもの」を重ね合わせて、
            保全すべき場所と回復すべき場所を示します。順番に進めてください。
          </p>
          <ol className="space-y-3">
            {[
              { icon: Plus, title: "調査を作成する", body: "案件名と対象地を登録します。" },
              {
                icon: Camera,
                title: "現地記録を登録し、査読する",
                body: "現場で撮った写真とGPSを登録し、「確認済み」にします。ここが後の判定の基準になるため、離れた複数地点で登録すると精度が上がります。",
              },
              {
                icon: Grid3x3,
                title: "10mメッシュ解析を実行する",
                body: "対象地を10m四方に区切り、1マスずつ衛星データを取得して、保全優先・回復候補・要確認に色分けします。",
              },
              {
                icon: Sprout,
                title: "回復計画とレポートを確認する",
                body: "どの区域に何をすべきかが自動で整理され、TNFD開示の形式でも出力できます。",
              },
            ].map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--gda-green)] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
                    <step.icon size={13} className="text-slate-400" />
                    {step.title}
                  </div>
                  <div className="text-[11px] text-slate-500 leading-relaxed mt-0.5">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <button
            onClick={() => setShowNew(true)}
            className="mt-4 w-full sm:w-auto flex items-center justify-center gap-2 bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] text-white text-sm font-medium px-4 py-2.5 rounded-xl"
          >
            <Plus size={15} /> 最初の調査を作成する
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
        {[
          { key: "in_progress", label: "進行中" },
          { key: "needs_review", label: "要確認" },
          { key: "completed", label: "調査完了" },
        ].map((s) => (
          <div key={s.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-2.5 sm:p-4 text-center">
            <div className="text-[11px] sm:text-xs text-slate-500 mb-1">{s.label}</div>
            <div className="text-xl sm:text-2xl font-semibold text-slate-800">{counts[s.key as keyof typeof counts]}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="font-medium text-sm text-slate-800">プロジェクトマップ</div>
          <div className="text-xs text-slate-500">
            衛星画像の地球儀から対象エリアへ。右上のボタンで現在地に移動できます。
          </div>
        </div>
        <div className="h-80">
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

      <div className="mb-3 font-medium text-sm text-slate-800">プロジェクト</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((p) => {
          const status = STATUS_LABEL[p.status] ?? STATUS_LABEL.in_progress;
          return (
            <button
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="text-left bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="h-28">
                <MapView
                  center={[p.center_lat, p.center_lng]}
                  zoom={9}
                  basemap="satellite"
                  globe={false}
                  markers={[{ lat: p.center_lat, lng: p.center_lng, label: p.name }]}
                />
              </div>
              <div className="p-4">
                <div className="font-medium text-slate-800 mb-1">{p.name}</div>
                <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${status.className}`}>
                  {status.label}
                </span>
                <div className="text-xs text-slate-400 mt-2">
                  最終更新日: {new Date(p.updated_at).toLocaleDateString("ja-JP")}
                </div>
                <div className="text-xs text-slate-400">候補地: {p.candidate_count}件</div>
                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center text-[11px] text-[var(--gda-green)] font-medium">
                  AI調査を開く <ChevronRight size={12} />
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Compass}
              title={query ? "該当するプロジェクトがありません" : "プロジェクトがまだありません"}
              body={
                query
                  ? "検索条件を変えてお試しください。"
                  : "「新しい調査を開始」から案件を作成すると、AIとの対話・10mメッシュ解析・回復計画が使えるようになります。"
              }
              action={
                !query && (
                  <button
                    onClick={() => setShowNew(true)}
                    className="inline-flex items-center gap-2 bg-[var(--gda-green)] text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    <Plus size={15} /> 新しい調査を開始
                  </button>
                )
              }
            />
          </div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowNew(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="font-medium text-slate-800 mb-4">新しい調査を開始</div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="案件名（例: 万波山林モニタリング）"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
              onKeyDown={(e) => e.key === "Enter" && createProject()}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-slate-600">
                キャンセル
              </button>
              <button
                onClick={createProject}
                disabled={busy}
                className="px-4 py-2 text-sm bg-[var(--gda-green)] text-white rounded-lg font-medium disabled:opacity-50"
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
