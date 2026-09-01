import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Layers, Play, Loader2, Satellite, Grid3x3, Sprout, TriangleAlert, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import MapView, { type Basemap, type CellProperties, type MapMarker } from "../components/MapView";

interface MeshRow {
  id: string;
  project_id: string;
  center_lat: number;
  center_lng: number;
  cell_size_m: number;
  extent_m: number;
  year: number;
  detect_change: number;
  status: string;
  reference_points: number;
  created_at: string;
  sampled_cells?: number;
}

interface Hotspot {
  id: string;
  cell_class: string;
  rank: number;
  cell_count: number;
  area_ha: number;
  center_lat: number;
  center_lng: number;
  mean_similarity: number | null;
  mean_change: number | null;
  compactness: number;
  importance: number;
  field_records: number;
}

interface RecoveryActionRow {
  id: string;
  hotspot_id: string;
  stage: string;
  title: string;
  description: string;
  expected_change: string;
  indicator: string;
  frequency: string;
  area_ha: number;
  priority: number;
  status: string;
}

interface LegendEntry {
  key: string;
  label: string;
  color: string;
}

interface MeshDetail {
  mesh: MeshRow;
  pending: number;
  geojson: GeoJSON.FeatureCollection;
  hotspots: Hotspot[];
  actions: RecoveryActionRow[];
  legend: LegendEntry[];
}

const CLASS_ICON: Record<string, typeof Sprout> = {
  priority_a: ShieldCheck,
  similar: Sprout,
  changed: TriangleAlert,
};

export default function MeshView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [meshes, setMeshes] = useState<MeshRow[]>([]);
  const [detail, setDetail] = useState<MeshDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [meshVisible, setMeshVisible] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [opacity, setOpacity] = useState(0.55);
  const [selected, setSelected] = useState<CellProperties | null>(null);
  const [cellSizeM, setCellSizeM] = useState(10);
  const [extentM, setExtentM] = useState(200);
  const [detectChange, setDetectChange] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const cancelRef = useRef(false);

  const activeMeshId = searchParams.get("mesh");

  const loadMeshes = async () => {
    if (!id) return;
    const res = await api.get<{ meshes: MeshRow[] }>(`/projects/${id}/meshes`);
    setMeshes(res.meshes);
    if (!activeMeshId && res.meshes[0]) setSearchParams({ mesh: res.meshes[0].id }, { replace: true });
  };

  const loadDetail = async (meshId: string) => {
    const res = await api.get<MeshDetail>(`/meshes/${meshId}`);
    setDetail(res);
  };

  useEffect(() => {
    loadMeshes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (activeMeshId) loadDetail(activeMeshId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeshId]);

  // Sampling drains in batches because each cell costs an Earth Engine call and
  // a Worker request can only make so many; the loop is what turns that limit
  // into a progress bar instead of a failure.
  const runSampling = async (meshId: string, total: number) => {
    cancelRef.current = false;
    let remaining = total;
    let guard = 0;
    while (remaining > 0 && !cancelRef.current && guard < 400) {
      guard++;
      const res = await api.post<{ sampled: number; failed: number; remaining: number }>(
        `/meshes/${meshId}/sample`,
        {},
      );
      remaining = res.remaining;
      setProgress({ done: total - remaining, total });
      if (res.sampled === 0 && res.failed === 0) break;
    }
    await api.post(`/meshes/${meshId}/analyze`, {});
    await loadDetail(meshId);
    setProgress(null);
  };

  const createMesh = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ meshId: string; cells: number; referencePoints: number }>(
        `/projects/${id}/meshes`,
        { cellSizeM, extentM, detectChange },
      );
      setSearchParams({ mesh: res.meshId }, { replace: true });
      await loadMeshes();
      setProgress({ done: 0, total: res.cells });
      await runSampling(res.meshId, res.cells);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const resumeSampling = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await runSampling(detail.mesh.id, detail.pending);
    } finally {
      setBusy(false);
    }
  };

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
      (detail?.hotspots ?? []).map((h) => ({
        lat: h.center_lat,
        lng: h.center_lng,
        label: `#${h.rank} ${h.area_ha.toFixed(2)}ha`,
        color: detail?.legend.find((l) => l.key === h.cell_class)?.color ?? "#1f7a4d",
      })),
    [detail],
  );

  const cellCount = Math.round(extentM / cellSizeM) ** 2;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem-4rem)] md:h-screen">
      <div className="lg:w-[380px] lg:shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-xs text-slate-400">FR-020 / FR-026</div>
          <h1 className="font-semibold text-slate-800 text-sm">10mメッシュ解析</h1>
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            対象地を10m四方のセルに分割し、各セルの衛星エンベディングを取得して、確認済み現地記録との類似度と前年比の変化を判定します。
          </p>
        </div>

        <div className="p-4 space-y-3 border-b border-slate-100">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-slate-500">セルサイズ</span>
              <select
                value={cellSizeM}
                onChange={(e) => setCellSizeM(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value={10}>10 m</option>
                <option value={20}>20 m</option>
                <option value={50}>50 m</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">対象範囲（一辺）</span>
              <select
                value={extentM}
                onChange={(e) => setExtentM(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value={100}>100 m</option>
                <option value={200}>200 m</option>
                <option value={400}>400 m</option>
                <option value={1000}>1 km</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={detectChange} onChange={(e) => setDetectChange(e.target.checked)} />
            前年との変化を検出する（取得時間は約2倍）
          </label>
          <div className="text-[11px] text-slate-500">
            セル数 {cellCount.toLocaleString()}
            {cellCount > 2500 ? (
              <span className="text-red-600">上限2,500を超えています</span>
            ) : (
              <span>目安 {Math.ceil((cellCount / 16) * (detectChange ? 3 : 2))} 秒程度</span>
            )}
          </div>
          <button
            onClick={createMesh}
            disabled={busy || cellCount > 2500}
            className="w-full flex items-center justify-center gap-2 bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {busy ? "解析中..." : "メッシュ解析を実行"}
          </button>
          {progress && (
            <div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--gda-green)] transition-all"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()} セル取得済み
              </div>
            </div>
          )}
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
        </div>

        {detail && (
          <>
            <div className="p-4 border-b border-slate-100 space-y-1.5 text-[11px] text-slate-600">
              <div className="flex justify-between">
                <span>基準地点（確認済み現地記録）</span>
                <span className="font-medium">{detail.mesh.reference_points} 地点</span>
              </div>
              <div className="flex justify-between">
                <span>対象年</span>
                <span className="font-medium">{detail.mesh.year}</span>
              </div>
              <div className="flex justify-between">
                <span>取得済みセル</span>
                <span className="font-medium">{detail.geojson.features.length.toLocaleString()}</span>
              </div>
              {detail.pending > 0 && (
                <button onClick={resumeSampling} disabled={busy} className="text-[var(--gda-green)] underline">
                  未取得 {detail.pending} セルの取得を再開する
                </button>
              )}
              {detail.mesh.reference_points === 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2 mt-2 leading-relaxed">
                  確認済みの現地記録がないため、類似度が算出できません（変化検出のみ）。現地記録を登録し「確認済み」にすると、保全優先・回復候補の判定が有効になります。
                </div>
              )}
            </div>

            <div className="p-4">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                重要区域 {detail.hotspots.length} 件（FR-026）
              </div>
              <div className="space-y-2">
                {detail.hotspots.map((h) => {
                  const legend = detail.legend.find((l) => l.key === h.cell_class);
                  const Icon = CLASS_ICON[h.cell_class] ?? Sprout;
                  const actions = detail.actions.filter((a) => a.hotspot_id === h.id);
                  return (
                    <div key={h.id} className="border border-slate-200 rounded-xl p-3">
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: `${legend?.color}22`, color: legend?.color }}
                        >
                          <Icon size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-800">
                            #{h.rank} {legend?.label}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {h.area_ha.toFixed(2)} ha ・ {h.cell_count} セル ・ 連結度 {h.compactness.toFixed(2)}
                            {h.mean_similarity !== null && ` ・ 類似度 ${h.mean_similarity.toFixed(2)}`}
                            {h.mean_change !== null && ` ・ 変化 ${h.mean_change.toFixed(3)}`}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {h.center_lat.toFixed(5)}, {h.center_lng.toFixed(5)}
                          </div>
                          {actions.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {actions.map((a) => (
                                <li key={a.id} className="text-[11px] text-slate-600 leading-snug">
                                  <span className="text-slate-400">[{a.stage}]</span> {a.title}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {detail.hotspots.length === 0 && (
                  <div className="text-xs text-slate-400 py-6 text-center">
                    まだ重要区域が抽出されていません。メッシュ解析を実行してください。
                  </div>
                )}
              </div>
              {detail.actions.length > 0 && (
                <Link
                  to={`/projects/${id}/recovery`}
                  className="mt-3 block text-center text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2"
                >
                  回復計画 {detail.actions.length} 件を開く
                </Link>
              )}
            </div>
          </>
        )}

        {meshes.length > 1 && (
          <div className="p-4 border-t border-slate-100">
            <div className="text-[11px] text-slate-500 mb-1">過去の解析</div>
            <select
              value={activeMeshId ?? ""}
              onChange={(e) => setSearchParams({ mesh: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
            >
              {meshes.map((m) => (
                <option key={m.id} value={m.id}>
                  {new Date(m.created_at).toLocaleString("ja-JP")} ・ {m.cell_size_m}m ・ {m.extent_m}m
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
        <MapView
          center={detail ? [detail.mesh.center_lat, detail.mesh.center_lng] : [36.2048, 138.2529]}
          zoom={17}
          basemap={basemap}
          mesh={detail?.geojson ?? null}
          meshVisible={meshVisible}
          meshOpacity={opacity}
          gridVisible={gridVisible}
          labelsVisible={labelsVisible}
          markers={markers}
          fitBounds={bounds}
          onCellClick={setSelected}
        />

        <div className="absolute top-3 left-3 z-10 w-56">
          <div className="bg-white/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700"
            >
              <span className="flex items-center gap-1.5">
                <Layers size={13} /> レイヤー
              </span>
              <span className="text-slate-400">{panelOpen ? "−" : "+"}</span>
            </button>
            {panelOpen && (
              <div className="px-3 pb-3 space-y-2.5">
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
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="w-full accent-[var(--gda-green)]"
                />
                <label className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>セル境界線</span>
                  <input type="checkbox" checked={gridVisible} onChange={(e) => setGridVisible(e.target.checked)} />
                </label>
                <label className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>地名ラベル</span>
                  <input
                    type="checkbox"
                    checked={labelsVisible}
                    onChange={(e) => setLabelsVisible(e.target.checked)}
                  />
                </label>
              </div>
            )}
          </div>

          {detail && (
            <div className="mt-2 bg-white/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-700 mb-1.5">凡例</div>
              <div className="space-y-1">
                {detail.legend
                  .filter((l) => l.key !== "unscored" || detail.mesh.reference_points === 0)
                  .map((l) => (
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
            <dl className="mt-2 space-y-1 text-[11px] text-slate-600">
              <div className="flex justify-between">
                <dt>基準との類似度</dt>
                <dd className="font-medium">{selected.similarity?.toFixed(3) ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>前年比の変化</dt>
                <dd className="font-medium">{selected.change?.toFixed(3) ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>セル内の現地記録</dt>
                <dd className="font-medium">{selected.fieldRecords} 件</dd>
              </div>
            </dl>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              値は Google Satellite Embedding の実測ベクトルから算出。変化の「原因」は衛星では判定できないため、現地確認が必要です。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
