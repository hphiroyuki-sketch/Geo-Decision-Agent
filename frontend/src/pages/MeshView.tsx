import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Layers,
  Play,
  Loader2,
  Satellite,
  Grid3x3,
  Sprout,
  TriangleAlert,
  ShieldCheck,
  Crosshair,
  MapPin,
  Box,
  Mountain,
} from "lucide-react";
import { api } from "../lib/api";
import MapView, {
  type Basemap,
  type CellProperties,
  type MapMarker,
  type MeshColorMode,
  type MeshHeightMode,
} from "../components/MapView";
import { Term, Hint, EmptyState } from "../components/Explain";

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

interface MeshContext {
  project: { name: string; centerLat: number | null; centerLng: number | null; areaHa: number | null };
  confirmedRecords: { id: string; lat: number; lng: number; species_guess: string | null }[];
  unreviewedCount: number;
  referenceCentroid: { lat: number; lng: number } | null;
  year: number;
  maxCells: number;
}

interface MeshStats {
  stats: {
    sampled: number;
    sim_min: number | null;
    sim_max: number | null;
    sim_avg: number | null;
    chg_max: number | null;
    chg_avg: number | null;
  } | null;
  byClass: { cell_class: string; n: number }[];
  thresholds: { priorityA: number; similar: number; changed: number };
}

const CLASS_ICON: Record<string, typeof Sprout> = {
  priority_a: ShieldCheck,
  similar: Sprout,
  changed: TriangleAlert,
};

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export default function MeshView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [meshes, setMeshes] = useState<MeshRow[]>([]);
  const [detail, setDetail] = useState<MeshDetail | null>(null);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const [context, setContext] = useState<MeshContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [meshVisible, setMeshVisible] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [opacity, setOpacity] = useState(0.6);
  const [colorMode, setColorMode] = useState<MeshColorMode>("class");
  const [terrain3d, setTerrain3d] = useState(false);
  const [heightMode, setHeightMode] = useState<MeshHeightMode>("flat");
  const [exaggeration, setExaggeration] = useState(1.5);
  const [selected, setSelected] = useState<CellProperties | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const [cellSizeM, setCellSizeM] = useState(10);
  const [extentM, setExtentM] = useState(200);
  const [detectChange, setDetectChange] = useState(true);
  const [centerMode, setCenterMode] = useState<"reference" | "project" | "manual">("reference");
  const [manualCenter, setManualCenter] = useState("");
  const [pickOnMap, setPickOnMap] = useState(false);
  const cancelRef = useRef(false);

  const activeMeshId = searchParams.get("mesh");

  const loadMeshes = useCallback(async () => {
    if (!id) return;
    const res = await api.get<{ meshes: MeshRow[] }>(`/projects/${id}/meshes`);
    setMeshes(res.meshes);
    if (!searchParams.get("mesh") && res.meshes[0]) setSearchParams({ mesh: res.meshes[0].id }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadDetail = useCallback(async (meshId: string) => {
    const [d, s] = await Promise.all([
      api.get<MeshDetail>(`/meshes/${meshId}`),
      api.get<MeshStats>(`/meshes/${meshId}/stats`),
    ]);
    setDetail(d);
    setStats(s);
  }, []);

  useEffect(() => {
    if (!id) return;
    loadMeshes();
    api.get<MeshContext>(`/projects/${id}/mesh-context`).then(setContext);
  }, [id, loadMeshes]);

  useEffect(() => {
    if (activeMeshId) loadDetail(activeMeshId);
  }, [activeMeshId, loadDetail]);

  // The centre the next run would use, given the current choice.
  const plannedCenter = useMemo((): { lat: number; lng: number } | null => {
    if (centerMode === "manual") {
      const parts = manualCenter.split(/[,\s]+/).filter(Boolean).map(Number);
      if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) return { lat: parts[0], lng: parts[1] };
      return null;
    }
    if (centerMode === "reference" && context?.referenceCentroid) return context.referenceCentroid;
    if (context?.project.centerLat != null && context?.project.centerLng != null) {
      return { lat: context.project.centerLat, lng: context.project.centerLng };
    }
    return null;
  }, [centerMode, manualCenter, context]);

  // The whole point of the pre-flight: similarity is meaningless when the
  // reference points sit in a different landscape entirely.
  const referenceDistanceKm = useMemo(() => {
    if (!plannedCenter || !context?.confirmedRecords.length) return null;
    return Math.min(...context.confirmedRecords.map((r) => distanceKm(plannedCenter, r)));
  }, [plannedCenter, context]);

  const cellCount = Math.round(extentM / cellSizeM) ** 2;
  const overLimit = cellCount > (context?.maxCells ?? 2500);
  const estimateSec = Math.ceil((cellCount / 16) * (detectChange ? 3 : 2));

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
    if (!id || !plannedCenter) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ meshId: string; cells: number }>(`/projects/${id}/meshes`, {
        cellSizeM,
        extentM,
        detectChange,
        centerLat: plannedCenter.lat,
        centerLng: plannedCenter.lng,
      });
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

  const markers: MapMarker[] = useMemo(() => {
    const hotspotMarkers = (detail?.hotspots ?? []).map((h) => ({
      lat: h.center_lat,
      lng: h.center_lng,
      label: `#${h.rank} ${h.area_ha.toFixed(2)}ha`,
      color: detail?.legend.find((l) => l.key === h.cell_class)?.color ?? "#1f7a4d",
    }));
    const referenceMarkers = (context?.confirmedRecords ?? []).map((r) => ({
      lat: r.lat,
      lng: r.lng,
      label: `基準地点（確認済み）: ${r.species_guess ?? "種未記入"}`,
      color: "#2563eb",
    }));
    return [...hotspotMarkers, ...referenceMarkers];
  }, [detail, context]);

  const noHotspots = detail && detail.hotspots.length === 0 && detail.geojson.features.length > 0;
  const simMax = stats?.stats?.sim_max ?? null;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem-4rem)] md:h-screen">
      <div className="lg:w-[400px] lg:shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-xs text-slate-400">FR-020 / FR-026</div>
          <h1 className="font-semibold text-slate-800 text-sm">10mメッシュ解析</h1>
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            対象地を10m四方に区切り、1マスずつ衛星データを取得します。「確認済みの生きものがいた場所」とどれだけ似ているか（
            <Term id="similarity">類似度</Term>）と、前年からどれだけ変わったか（<Term id="change">変化スコア</Term>
            ）を判定し、保全すべき場所と回復すべき場所を色分けします。
          </p>
        </div>

        {/* Pre-flight: everything that decides whether the run will be meaningful */}
        <div className="p-4 space-y-3 border-b border-slate-100">
          <div className="text-xs font-semibold text-slate-700">1. どこを解析するか</div>
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={() => setCenterMode("reference")}
              disabled={!context?.referenceCentroid}
              className={`text-[11px] py-1.5 rounded-lg border disabled:opacity-40 ${
                centerMode === "reference"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              現地記録の中心
            </button>
            <button
              onClick={() => setCenterMode("project")}
              className={`text-[11px] py-1.5 rounded-lg border ${
                centerMode === "project"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              プロジェクト中心
            </button>
            <button
              onClick={() => setCenterMode("manual")}
              className={`text-[11px] py-1.5 rounded-lg border ${
                centerMode === "manual"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              指定する
            </button>
          </div>

          {centerMode === "manual" && (
            <div className="flex gap-1.5">
              <input
                value={manualCenter}
                onChange={(e) => setManualCenter(e.target.value)}
                placeholder="緯度, 経度（例: 34.7241, 135.4894）"
                className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
              />
              <button
                onClick={() => setPickOnMap((v) => !v)}
                className={`text-[11px] px-2 rounded-lg border flex items-center gap-1 ${
                  pickOnMap ? "bg-[var(--gda-green)] text-white border-[var(--gda-green)]" : "border-slate-200 text-slate-600"
                }`}
              >
                <Crosshair size={12} /> 地図
              </button>
            </div>
          )}

          {plannedCenter && (
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              <MapPin size={11} /> {plannedCenter.lat.toFixed(5)}, {plannedCenter.lng.toFixed(5)}
            </div>
          )}

          {/* The warning that would have saved the last run */}
          {context && context.confirmedRecords.length === 0 && (
            <Hint tone="warn">
              <strong>確認済みの現地記録が0件です。</strong>
              このままだと「似ている場所」の判定ができず、前年との変化しか出ません。
              {context.unreviewedCount > 0 ? (
                <>
                  {" "}
                  未査読の記録が {context.unreviewedCount} 件あります。
                  <Link to={`/projects/${id}/field`} className="underline font-medium">
                    現地記録を確認済みにする
                  </Link>
                  と、保全優先・回復候補の判定が有効になります。
                </>
              ) : (
                <>
                  {" "}
                  <Link to={`/projects/${id}/field`} className="underline font-medium">
                    現地記録を登録
                  </Link>
                  し、査読して「確認済み」にしてください。
                </>
              )}
            </Hint>
          )}

          {referenceDistanceKm !== null && referenceDistanceKm > 5 && (
            <Hint tone="warn">
              <strong>基準地点がここから約 {referenceDistanceKm.toFixed(0)}km 離れています。</strong>
              これほど離れた場所は気候も地形も別物なので、類似度はどのマスでも低く出て、
              保全優先・回復候補は<strong>ほぼ抽出されません</strong>。
              「現地記録の中心」を選ぶか、解析したい場所の近くで現地記録を登録してください。
            </Hint>
          )}

          {referenceDistanceKm !== null && referenceDistanceKm <= 0.3 && (
            <Hint tone="info">
              基準地点までの距離が約 {(referenceDistanceKm * 1000).toFixed(0)}m と近いため、類似度が高く出ます。
              これが「環境が似ている」ためか「単に近い」ためかは区別できません。
              <Term id="referenceDistance" />
              離れた複数地点に現地記録があると、判定の信頼性が上がります。
            </Hint>
          )}
        </div>

        <div className="p-4 space-y-3 border-b border-slate-100">
          <div className="text-xs font-semibold text-slate-700">2. どのくらい細かく見るか</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-slate-500">1マスの大きさ</span>
              <select
                value={cellSizeM}
                onChange={(e) => setCellSizeM(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value={10}>10 m（最も詳細）</option>
                <option value={20}>20 m</option>
                <option value={50}>50 m（広範囲向け）</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">解析する範囲（一辺）</span>
              <select
                value={extentM}
                onChange={(e) => setExtentM(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value={100}>100 m</option>
                <option value={200}>200 m</option>
                <option value={400}>400 m</option>
                <option value={1000}>1 km</option>
                <option value={2000}>2 km</option>
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-[11px] text-slate-600">
            <input
              type="checkbox"
              checked={detectChange}
              onChange={(e) => setDetectChange(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              前年との変化も調べる
              <span className="text-slate-400">（取得時間は約2倍になります）</span>
            </span>
          </label>

          <div
            className={`text-[11px] rounded-lg px-2.5 py-2 ${
              overLimit ? "bg-red-50 text-red-700 border border-red-200" : "bg-slate-50 text-slate-600"
            }`}
          >
            {cellCount.toLocaleString()} マス
            {overLimit ? (
              <>
                {" "}
                — 上限 {context?.maxCells.toLocaleString()} マスを超えています。範囲を狭めるか、1マスを大きくしてください。
              </>
            ) : (
              <>
                {" "}
                / 所要時間の目安 約 {estimateSec < 60 ? `${estimateSec}秒` : `${Math.ceil(estimateSec / 60)}分`}
                <span className="block text-slate-400 mt-0.5">
                  一度取得した場所は保存されるため、2回目以降は大幅に速くなります。
                </span>
              </>
            )}
          </div>

          <button
            onClick={createMesh}
            disabled={busy || overLimit || !plannedCenter}
            className="w-full flex items-center justify-center gap-2 bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg"
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
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()} マス取得済み
                <span className="text-slate-400">（画面を開いたままお待ちください）</span>
              </div>
            </div>
          )}
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
        </div>

        {detail && (
          <div className="p-4 border-b border-slate-100">
            <div className="text-xs font-semibold text-slate-700 mb-2">3. 結果</div>

            {stats?.stats && (
              <div className="text-[11px] text-slate-600 space-y-1 bg-slate-50 rounded-lg p-2.5 mb-3">
                <div className="flex justify-between">
                  <span>取得マス</span>
                  <span className="font-medium">{stats.stats.sampled.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>基準地点</span>
                  <span className="font-medium">{detail.mesh.reference_points} 地点</span>
                </div>
                {stats.stats.sim_max !== null && (
                  <div className="flex justify-between">
                    <span>類似度（最小〜最大）</span>
                    <span className="font-medium">
                      {stats.stats.sim_min?.toFixed(2)} 〜 {stats.stats.sim_max.toFixed(2)}
                    </span>
                  </div>
                )}
                {stats.stats.chg_max !== null && (
                  <div className="flex justify-between">
                    <span>変化スコア（最大）</span>
                    <span className="font-medium">{stats.stats.chg_max.toFixed(3)}</span>
                  </div>
                )}
              </div>
            )}

            {/* When nothing crossed a threshold, say so in plain terms and say why */}
            {noHotspots && (
              <Hint tone="info">
                <strong>重要区域として抽出された場所はありませんでした。</strong>
                {simMax !== null && stats && (
                  <>
                    {" "}
                    類似度の最大値は {simMax.toFixed(2)} で、保全優先の判定基準 {stats.thresholds.priorityA} に届いていません。
                  </>
                )}
                {referenceDistanceKm !== null && referenceDistanceKm > 5 ? (
                  <> 基準地点が約{referenceDistanceKm.toFixed(0)}km離れているためです。近くで現地記録を取り直すと結果が変わります。</>
                ) : (
                  <> 下の「類似度で色分け」に切り替えると、しきい値に届かない範囲の濃淡も確認できます。</>
                )}
              </Hint>
            )}

            <div className="mt-3 space-y-2">
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
                          {h.area_ha.toFixed(2)} ha ・ {h.cell_count} マス ・ <Term id="compactness">連結度</Term>{" "}
                          {h.compactness.toFixed(2)}
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
        )}

        {!detail && !busy && (
          <EmptyState
            icon={Grid3x3}
            title="まだ解析していません"
            body="上の設定を確認して「メッシュ解析を実行」を押すと、対象地を10m四方に区切って1マスずつ衛星データを取得します。初回は数十秒〜数分かかります。"
          />
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
          center={
            detail
              ? [detail.mesh.center_lat, detail.mesh.center_lng]
              : plannedCenter
                ? [plannedCenter.lat, plannedCenter.lng]
                : [36.2048, 138.2529]
          }
          zoom={detail || plannedCenter ? 17 : 5}
          basemap={basemap}
          mesh={detail?.geojson ?? null}
          meshVisible={meshVisible}
          meshOpacity={opacity}
          meshColorMode={colorMode}
          gridVisible={gridVisible}
          labelsVisible={labelsVisible}
          markers={markers}
          fitBounds={bounds}
          maxFitZoom={18}
          terrain3d={terrain3d}
          terrainExaggeration={exaggeration}
          meshHeightMode={heightMode}
          onCellClick={setSelected}
          onMapClick={
            pickOnMap
              ? (lat, lng) => {
                  setManualCenter(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                  setCenterMode("manual");
                  setPickOnMap(false);
                }
              : undefined
          }
        />

        {pickOnMap && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-slate-900 text-white text-xs rounded-full px-3 py-1.5 shadow-lg">
            解析したい場所を地図上でクリックしてください
          </div>
        )}

        <div className="absolute top-3 left-3 z-10 w-60">
          <div className="bg-white/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700"
            >
              <span className="flex items-center gap-1.5">
                <Layers size={13} /> 表示
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
                    <Satellite size={11} /> 航空写真
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

                <div className="border-t border-slate-100 pt-2.5">
                  <label className="flex items-center justify-between text-[11px] font-medium text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <Mountain size={12} /> 3D地形表示
                    </span>
                    <input type="checkbox" checked={terrain3d} onChange={(e) => setTerrain3d(e.target.checked)} />
                  </label>
                  {terrain3d && (
                    <div className="mt-1.5">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>起伏の強調</span>
                        <span>×{exaggeration.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.1}
                        value={exaggeration}
                        onChange={(e) => setExaggeration(Number(e.target.value))}
                        className="w-full accent-[var(--gda-green)]"
                      />
                      <p className="text-[10px] text-slate-400 leading-snug">
                        右ドラッグ（またはCtrl+ドラッグ）で視点を傾け・回転できます。標高データは約30m解像度のため、
                        尾根・谷の把握には十分ですが、10mマス1つ分の起伏までは再現されません。
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
                    <Box size={11} /> マスの高さ
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ["flat", "平面"],
                        ["similarity", "類似度"],
                        ["change", "変化"],
                      ] as [MeshHeightMode, string][]
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => {
                          setHeightMode(mode);
                          if (mode !== "flat") setTerrain3d(true);
                        }}
                        className={`text-[11px] py-1 rounded-lg border ${
                          heightMode === mode
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-600 border-slate-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {heightMode !== "flat" && (
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      柱の高さ＝{heightMode === "similarity" ? "類似度（高いほど確認済み生息地に近い）" : "変化スコア（高いほど前年から変化）"}
                      。高さは表示用に強調しており、実際の標高ではありません。
                    </p>
                  )}
                </div>

                <div>
                  <div className="text-[11px] text-slate-500 mb-1">マスの色分け</div>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ["class", "判定"],
                        ["similarity", "類似度"],
                        ["change", "変化"],
                      ] as [MeshColorMode, string][]
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => setColorMode(mode)}
                        className={`text-[11px] py-1 rounded-lg border ${
                          colorMode === mode
                            ? "bg-[var(--gda-green)] text-white border-[var(--gda-green)]"
                            : "bg-white text-slate-600 border-slate-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between text-[11px] text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <Grid3x3 size={12} /> メッシュ
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
                  <span>マスの境界線</span>
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
              {colorMode === "class" ? (
                <div className="space-y-1">
                  {detail.legend.map((l) => (
                    <div key={l.key} className="flex items-center gap-2 text-[11px] text-slate-600">
                      <span className="w-3 h-3 rounded-sm" style={{ background: l.color }} />
                      {l.label}
                    </div>
                  ))}
                </div>
              ) : colorMode === "similarity" ? (
                <div>
                  <div className="h-2.5 rounded" style={{ background: "linear-gradient(90deg,#f1f8f4,#96ccae,#2f9e63,#0f5132)" }} />
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>0（似ていない）</span>
                    <span>1（同じ環境）</span>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="h-2.5 rounded" style={{ background: "linear-gradient(90deg,#fdf5f3,#f0b8a8,#d4623f,#8c2c14)" }} />
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>0（変化なし）</span>
                    <span>0.3（大きい）</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 text-[11px] text-slate-600 mt-2 pt-2 border-t border-slate-100">
                <span className="w-3 h-3 rounded-full bg-[#2563eb] border-2 border-white shadow" />
                基準地点（確認済みの現地記録）
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
                <dt>
                  <Term id="similarity">基準との類似度</Term>
                </dt>
                <dd className="font-medium">{selected.similarity?.toFixed(3) ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>
                  <Term id="change">前年比の変化</Term>
                </dt>
                <dd className="font-medium">{selected.change?.toFixed(3) ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>このマス内の現地記録</dt>
                <dd className="font-medium">{selected.fieldRecords} 件</dd>
              </div>
            </dl>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              Google Satellite Embedding の実測値です。変化の「原因」は衛星では判定できないため、現地確認が必要です。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
