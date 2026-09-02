import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Satellite, Grid3x3 } from "lucide-react";
import { api } from "../lib/api";
import MapView, { type Basemap, type CellProperties, type MapMarker } from "../components/MapView";

interface ProjectRow {
  id: string;
  name: string;
  center_lat: number | null;
  center_lng: number | null;
  sampled_cells: number;
  total_cells: number;
  field_records: number;
}

interface MeshRow {
  id: string;
  cell_size_m: number;
  extent_m: number;
  created_at: string;
  status: string;
}

interface MeshDetail {
  mesh: { center_lat: number; center_lng: number; extent_m: number };
  geojson: GeoJSON.FeatureCollection;
  legend: { key: string; label: string; color: string }[];
}

/** The cross-project map: pick a project, overlay its latest 10m mesh. */
export default function MapExplorer() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [detail, setDetail] = useState<MeshDetail | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [meshVisible, setMeshVisible] = useState(true);
  const [selected, setSelected] = useState<CellProperties | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ projects: ProjectRow[] }>("/dashboard").then((r) => {
      setProjects(r.projects);
      const withMesh = r.projects.find((p) => p.sampled_cells > 0) ?? r.projects[0];
      if (withMesh) setProjectId(withMesh.id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setDetail(null);
    setNote(null);
    (async () => {
      const list = await api.get<{ meshes: MeshRow[] }>(`/projects/${projectId}/meshes`);
      const latest = list.meshes[0];
      if (!latest) {
        setNote("このプロジェクトにはまだ10mメッシュがありません。");
        return;
      }
      setDetail(await api.get<MeshDetail>(`/meshes/${latest.id}`));
    })();
  }, [projectId]);

  const project = projects.find((p) => p.id === projectId);

  const bounds = useMemo((): [[number, number], [number, number]] | null => {
    if (!detail) return null;
    const { center_lat, center_lng, extent_m } = detail.mesh;
    const dLat = extent_m / 111320 / 2;
    const dLng = dLat / Math.cos((center_lat * Math.PI) / 180);
    return [
      [center_lng - dLng, center_lat - dLat],
      [center_lng + dLng, center_lat + dLat],
    ];
  }, [detail]);

  const markers: MapMarker[] = useMemo(
    () =>
      projects
        .filter((p) => p.center_lat != null && p.center_lng != null)
        .map((p) => ({
          lat: p.center_lat as number,
          lng: p.center_lng as number,
          label: p.name,
          color: p.id === projectId ? "#1f7a4d" : "#94a3b8",
        })),
    [projects, projectId],
  );

  return (
    <div className="relative h-[calc(100vh-3.5rem-4rem)] md:h-screen">
      <MapView
        center={
          project?.center_lat != null && project?.center_lng != null
            ? [project.center_lat, project.center_lng]
            : [36.2048, 138.2529]
        }
        zoom={detail ? 17 : 7}
        basemap={basemap}
        mesh={detail?.geojson ?? null}
        meshVisible={meshVisible}
        markers={markers}
        fitBounds={bounds}
        globe={!detail}
        introFlight
        showUserLocation
        onCellClick={setSelected}
      />

      <div className="absolute top-3 left-3 z-10 w-64 space-y-2">
        <div className="bg-white/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-700">地図ビュー</div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              onClick={() => setBasemap("satellite")}
              className={`flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg border ${
                basemap === "satellite"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              <Satellite size={11} /> 衛星
            </button>
            <button
              onClick={() => setBasemap("streets")}
              className={`flex-1 text-[11px] py-1.5 rounded-lg border ${
                basemap === "streets"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              地図
            </button>
          </div>
          <label className="flex items-center justify-between text-[11px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <Grid3x3 size={12} /> 10mメッシュ
            </span>
            <input type="checkbox" checked={meshVisible} onChange={(e) => setMeshVisible(e.target.checked)} />
          </label>
          {note && (
            <div className="text-[11px] text-slate-500 leading-snug">
              {note}
              {projectId && (
                <Link to={`/projects/${projectId}/mesh`} className="text-[var(--gda-green)] underline ml-1">
                  解析する
                </Link>
              )}
            </div>
          )}
        </div>

        {detail && (
          <div className="bg-white/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-1.5">凡例</div>
            <div className="space-y-1">
              {detail.legend.map((l) => (
                <div key={l.key} className="flex items-center gap-2 text-[11px] text-slate-600">
                  <span className="w-3 h-3 rounded-sm" style={{ background: l.color }} />
                  {l.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-72 z-10 bg-white/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-semibold text-slate-800">{selected.label}</div>
            <button onClick={() => setSelected(null)} className="text-slate-400 text-xs">
              ×
            </button>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-600">
            類似度 {selected.similarity?.toFixed(3) ?? "—"} ／ 変化 {selected.change?.toFixed(3) ?? "—"} ／ 現地記録{" "}
            {selected.fieldRecords} 件
          </div>
        </div>
      )}
    </div>
  );
}
