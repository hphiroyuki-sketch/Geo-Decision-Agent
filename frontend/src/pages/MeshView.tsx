import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Play,
  Loader2,
  Grid3x3,
  Sprout,
  TriangleAlert,
  ShieldCheck,
  Crosshair,
  MapPin,
  SlidersHorizontal,
  Map as MapIcon,
  Mountain,
  Maximize2,
  Printer,
  Ruler,
} from "lucide-react";
import { api } from "../lib/api";
import MapView, { type CellProperties, type MapMarker } from "../components/MapView";
import { DEFAULT_MAP_CONTROLS, type MapControlState } from "../components/MapControlPanel";
import { Term, Hint, EmptyState } from "../components/Explain";
import LayerRail, { type LayerSpec } from "../components/ui/LayerRail";
import Legend from "../components/ui/Legend";
import SourceChips from "../components/ui/SourceChips";
import AgentSteps, { type AgentStep } from "../components/ui/AgentSteps";

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

const CLASS_TEXT: Record<string, string> = {
  priority_a: "優先度A（保全優先）",
  similar: "類似環境（回復候補）",
  changed: "大きな変化（要現地確認）",
  baseline: "一般区域",
  unscored: "未評価",
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

/**
 * V-03 AI調査と10mメッシュ.
 *
 * Dark ground, map dominant, panels floating over it: the imagery is the
 * evidence and everything else is annotation on top of it. The layer rail gives
 * each overlay its own opacity because the reason to fade the mesh is to see
 * what is underneath - one global slider cannot do that.
 */
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

  const [controls, setControls] = useState<MapControlState>(DEFAULT_MAP_CONTROLS);
  const [recordsVisible, setRecordsVisible] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [mobileView, setMobileView] = useState<"settings" | "map">("settings");
  const [selected, setSelected] = useState<CellProperties | null>(null);
  const [overlayOk, setOverlayOk] = useState<boolean | null>(null);

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

  /** The run, shown as stages so a long wait reads as progress, not a hang. */
  const runSteps: AgentStep[] | null = useMemo(() => {
    if (!busy && !progress) return null;
    const sampling = progress ? progress.done / Math.max(1, progress.total) : 0;
    return [
      { label: "解析範囲をグリッド化", detail: `${cellCount.toLocaleString()}マス（1マス${cellSizeM}m）`, status: "done" },
      {
        label: "衛星データを1マスずつ取得",
        detail: progress ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} マス取得済み` : "開始しています",
        status: sampling >= 1 ? "done" : "running",
      },
      {
        label: detectChange ? "前年と比較し変化を算出" : "類似度を算出",
        status: sampling >= 1 ? "running" : "waiting",
      },
      { label: "隣接マスを区域化し優先順位を決定", status: sampling >= 1 ? "running" : "waiting" },
    ];
  }, [busy, progress, cellCount, cellSizeM, detectChange]);

  const runSampling = async (meshId: string, total: number) => {
    cancelRef.current = false;
    let remaining = total;
    let guard = 0;
    while (remaining > 0 && !cancelRef.current && guard < 400) {
      guard++;
      const res = await api.post<{ sampled: number; failed: number; remaining: number }>(`/meshes/${meshId}/sample`, {});
      remaining = res.remaining;
      setProgress({ done: total - remaining, total });
      if (res.sampled === 0 && res.failed === 0) break;
    }
    await api.post(`/meshes/${meshId}/analyze`, {});
    await loadDetail(meshId);
    setProgress(null);
    setMobileView("map");
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
      label: `#${h.rank} ${CLASS_TEXT[h.cell_class] ?? h.cell_class} ${h.area_ha.toFixed(2)}ha`,
      color: detail?.legend.find((l) => l.key === h.cell_class)?.color ?? "#1f7a4d",
    }));
    if (!recordsVisible) return hotspotMarkers;
    const referenceMarkers = (context?.confirmedRecords ?? []).map((r) => ({
      lat: r.lat,
      lng: r.lng,
      label: `基準地点（確認済み）: ${r.species_guess ?? "種未記入"}`,
      color: "#2563eb",
    }));
    return [...hotspotMarkers, ...referenceMarkers];
  }, [detail, context, recordsVisible]);

  const noHotspots = detail && detail.hotspots.length === 0 && detail.geojson.features.length > 0;
  const simMax = stats?.stats?.sim_max ?? null;

  // A mesh where nearly every cell lands in one class cannot rank anything.
  const dominant = useMemo(() => {
    if (!stats?.byClass?.length || !stats.stats?.sampled) return null;
    const top = [...stats.byClass].sort((a, b) => b.n - a.n)[0];
    const share = top.n / stats.stats.sampled;
    return share >= 0.9 ? { cellClass: top.cell_class, share } : null;
  }, [stats]);

  const layers: LayerSpec[] = [
    {
      id: "imagery",
      label: "衛星画像",
      swatch: "linear-gradient(135deg,#2d4a35,#5d7a4a,#8a9b6d)",
      visible: controls.basemap === "satellite",
      opacity: controls.imageryOpacity,
      hint: "下げると道路・地名の地図が透けて、写真に何が写っているか確認できます。",
    },
    {
      id: "mesh",
      label: `${detail?.mesh.cell_size_m ?? 10}mメッシュ`,
      swatch: "linear-gradient(135deg,#3f9f5e,#c9a227,#c0392b)",
      visible: controls.meshVisible,
      opacity: controls.meshOpacity,
    },
    {
      id: "grid",
      label: "マスの境界線",
      swatch: "linear-gradient(#8ba0b4 1px, transparent 1px), linear-gradient(90deg,#8ba0b4 1px, transparent 1px)",
      visible: controls.gridVisible,
      opacity: 1,
      fixedOpacity: true,
    },
    {
      id: "records",
      label: "現地記録（基準地点）",
      swatch: "#2563eb",
      visible: recordsVisible,
      opacity: 1,
      fixedOpacity: true,
    },
    {
      id: "labels",
      label: "地名ラベル",
      swatch: "#e6edf3",
      visible: controls.labelsVisible,
      opacity: 1,
      fixedOpacity: true,
    },
  ];

  const onLayerChange = (layerId: string, patch: Partial<LayerSpec>) => {
    if (layerId === "imagery") {
      setControls((c) => ({
        ...c,
        basemap: patch.visible === undefined ? c.basemap : patch.visible ? "satellite" : "streets",
        imageryOpacity: patch.opacity ?? c.imageryOpacity,
      }));
    } else if (layerId === "mesh") {
      setControls((c) => ({
        ...c,
        meshVisible: patch.visible ?? c.meshVisible,
        meshOpacity: patch.opacity ?? c.meshOpacity,
      }));
    } else if (layerId === "grid") {
      setControls((c) => ({ ...c, gridVisible: patch.visible ?? c.gridVisible }));
    } else if (layerId === "labels") {
      setControls((c) => ({ ...c, labelsVisible: patch.visible ?? c.labelsVisible }));
    } else if (layerId === "records") {
      setRecordsVisible((v) => patch.visible ?? v);
    }
  };

  const legendEntries = detail
    ? [
        ...detail.legend.map((l) => ({ key: l.key, label: l.label, color: l.color })),
        { key: "ref", label: "現地確認済み地点", color: "#2563eb", shape: "dot" as const },
        { key: "grid", label: `${detail.mesh.cell_size_m}mグリッド`, color: "#8ba0b4", shape: "grid" as const },
      ]
    : [];

  return (
    <div className="theme-dark flex flex-col lg:flex-row h-[calc(100vh-3.5rem-4rem)] md:h-screen bg-[var(--gda-ink)] text-[var(--gda-ink-text)]">
      <div className="lg:hidden flex border-b border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)] shrink-0">
        {(
          [
            ["settings", "調査条件・結果", SlidersHorizontal],
            ["map", "地図", MapIcon],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setMobileView(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 ${
              mobileView === key
                ? "border-[var(--gda-green)] text-[var(--gda-ink-text)]"
                : "border-transparent text-[var(--gda-ink-muted)]"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Left column: what to analyse, then what came back. */}
      <div
        className={`${mobileView === "settings" ? "block" : "hidden"} lg:block lg:w-[380px] xl:w-[400px] lg:shrink-0 border-r border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)] overflow-y-auto flex-1 lg:flex-none scrollbar-dark`}
      >
        <div className="px-4 py-3 border-b border-[var(--gda-ink-line)]">
          <div className="text-[10px] text-[var(--gda-ink-muted)]">AI調査 / FR-020・FR-026</div>
          <h1 className="font-semibold text-sm">10mメッシュ解析</h1>
          <p className="text-[11px] text-[var(--gda-ink-muted)] mt-1 leading-relaxed">
            対象地を10m四方に区切り、1マスずつ衛星データを取得します。「確認済みの生きものがいた場所」とどれだけ似ているか（
            <Term id="similarity">類似度</Term>）と、前年からどれだけ変わったか（<Term id="change">変化スコア</Term>
            ）を判定し、保全すべき場所と回復すべき場所を色分けします。
          </p>
        </div>

        {runSteps && (
          <div className="p-4 border-b border-[var(--gda-ink-line)]">
            <div className="text-[11px] font-medium mb-2">解析を実行しています</div>
            <AgentSteps dark steps={runSteps} />
            {progress && (
              <div className="mt-2">
                <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--gda-green)] transition-all"
                    style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                  />
                </div>
                <div className="text-[10px] text-[var(--gda-ink-muted)] mt-1">
                  画面を開いたままお待ちください。一度取得した場所は保存されるため、2回目以降は大幅に速くなります。
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-4 space-y-3 border-b border-[var(--gda-ink-line)]">
          <div className="text-xs font-semibold">1. どこを解析するか</div>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ["reference", "現地記録の中心"],
                ["project", "プロジェクト中心"],
                ["manual", "指定する"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setCenterMode(mode)}
                disabled={mode === "reference" && !context?.referenceCentroid}
                className={`text-[11px] py-1.5 rounded-lg border disabled:opacity-30 ${
                  centerMode === mode
                    ? "bg-white text-slate-900 border-white font-medium"
                    : "bg-white/5 text-[var(--gda-ink-text)] border-[var(--gda-ink-line)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {centerMode === "manual" && (
            <div className="flex gap-1.5">
              <input
                value={manualCenter}
                onChange={(e) => setManualCenter(e.target.value)}
                placeholder="緯度, 経度（例: 34.7241, 135.4894）"
                className="flex-1 bg-black/25 border border-[var(--gda-ink-line)] rounded-lg px-2 py-1.5 text-xs text-[var(--gda-ink-text)] placeholder:text-[var(--gda-ink-muted)]"
              />
              <button
                onClick={() => setPickOnMap((v) => !v)}
                className={`text-[11px] px-2 rounded-lg border flex items-center gap-1 ${
                  pickOnMap
                    ? "bg-[var(--gda-green)] text-white border-[var(--gda-green)]"
                    : "border-[var(--gda-ink-line)] text-[var(--gda-ink-text)]"
                }`}
              >
                <Crosshair size={12} /> 地図
              </button>
            </div>
          )}

          {plannedCenter && (
            <div className="text-[11px] text-[var(--gda-ink-muted)] flex items-center gap-1">
              <MapPin size={11} /> {plannedCenter.lat.toFixed(5)}, {plannedCenter.lng.toFixed(5)}
            </div>
          )}

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
              これほど離れた場所は気候も地形も別物なので、類似度はどのマスでも低く出て、 保全優先・回復候補は
              <strong>ほぼ抽出されません</strong>。 「現地記録の中心」を選ぶか、解析したい場所の近くで現地記録を登録してください。
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

        <div className="p-4 space-y-3 border-b border-[var(--gda-ink-line)]">
          <div className="text-xs font-semibold">2. どのくらい細かく見るか</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-[var(--gda-ink-muted)]">1マスの大きさ</span>
              <select
                value={cellSizeM}
                onChange={(e) => setCellSizeM(Number(e.target.value))}
                className="w-full bg-black/25 border border-[var(--gda-ink-line)] rounded-lg px-2 py-1.5 text-sm text-[var(--gda-ink-text)]"
              >
                <option value={10}>10 m（最も詳細）</option>
                <option value={20}>20 m</option>
                <option value={50}>50 m（広範囲向け）</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-[var(--gda-ink-muted)]">解析する範囲（一辺）</span>
              <select
                value={extentM}
                onChange={(e) => setExtentM(Number(e.target.value))}
                className="w-full bg-black/25 border border-[var(--gda-ink-line)] rounded-lg px-2 py-1.5 text-sm text-[var(--gda-ink-text)]"
              >
                <option value={100}>100 m</option>
                <option value={200}>200 m</option>
                <option value={400}>400 m</option>
                <option value={1000}>1 km</option>
                <option value={2000}>2 km</option>
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-[11px] text-[var(--gda-ink-text)]">
            <input
              type="checkbox"
              checked={detectChange}
              onChange={(e) => setDetectChange(e.target.checked)}
              className="mt-0.5 accent-[var(--gda-green)]"
            />
            <span>
              前年との変化も調べる
              <span className="text-[var(--gda-ink-muted)]">（取得時間は約2倍になります）</span>
            </span>
          </label>

          <div
            className={`text-[11px] rounded-lg px-2.5 py-2 ${
              overLimit ? "bg-rose-500/10 text-rose-300 border border-rose-500/40" : "bg-black/25 text-[var(--gda-ink-text)]"
            }`}
          >
            {cellCount.toLocaleString()} マス
            {overLimit ? (
              <> — 上限 {context?.maxCells.toLocaleString()} マスを超えています。範囲を狭めるか、1マスを大きくしてください。</>
            ) : (
              <>
                {" "}
                / 所要時間の目安 約 {estimateSec < 60 ? `${estimateSec}秒` : `${Math.ceil(estimateSec / 60)}分`}
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
          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/40 rounded-lg p-2">{error}</div>
          )}
        </div>

        {detail && (
          <div className="p-4 border-b border-[var(--gda-ink-line)]">
            <div className="text-xs font-semibold mb-2">3. 結果</div>

            {stats?.stats && (
              <div className="text-[11px] space-y-1 bg-black/25 rounded-lg p-2.5 mb-3">
                <div className="flex justify-between">
                  <span className="text-[var(--gda-ink-muted)]">取得マス</span>
                  <span className="font-medium tabular-nums">{stats.stats.sampled.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--gda-ink-muted)]">基準地点</span>
                  <span className="font-medium tabular-nums">{detail.mesh.reference_points} 地点</span>
                </div>
                {stats.stats.sim_max !== null && (
                  <div className="flex justify-between">
                    <span className="text-[var(--gda-ink-muted)]">類似度（最小〜最大）</span>
                    <span className="font-medium tabular-nums">
                      {stats.stats.sim_min?.toFixed(2)} 〜 {stats.stats.sim_max.toFixed(2)}
                    </span>
                  </div>
                )}
                {stats.stats.chg_max !== null && (
                  <div className="flex justify-between">
                    <span className="text-[var(--gda-ink-muted)]">変化スコア（最大）</span>
                    <span className="font-medium tabular-nums">{stats.stats.chg_max.toFixed(3)}</span>
                  </div>
                )}
              </div>
            )}

            {overlayOk === false && detail.geojson.features.length > 0 && (
              <Hint tone="warn">
                <strong>解析結果はありますが、地図に描画できませんでした。</strong>
                データの問題ではなく表示側の問題です。ページを再読み込みしても直らない場合はお知らせください。
              </Hint>
            )}

            {dominant && (
              <Hint tone="warn">
                <strong>
                  取得したマスの {Math.round(dominant.share * 100)}% が「{CLASS_TEXT[dominant.cellClass] ?? dominant.cellClass}
                  」に偏っています。
                </strong>
                この状態では区域どうしの優劣がつかず、「どこを優先すべきか」を示せません。
                {referenceDistanceKm !== null && referenceDistanceKm < 0.2 ? (
                  <>
                    {" "}
                    基準地点が解析範囲の内側（約{(referenceDistanceKm * 1000).toFixed(0)}m）にあるためです。
                    <strong>解析する範囲を 1km 以上に広げる</strong>か、
                    <strong>基準地点から離れた場所を中心に指定</strong>すると、差が出て順位づけができるようになります。
                  </>
                ) : (
                  <> 解析範囲を広げて環境の異なる場所を含めるか、性質の違う複数地点で現地記録を登録してください。</>
                )}
              </Hint>
            )}

            {noHotspots && (
              <Hint tone="info">
                <strong>重要区域として抽出された場所はありませんでした。</strong>
                {simMax !== null && stats && (
                  <>
                    {" "}
                    類似度の最大値は {simMax.toFixed(2)} で、保全優先の判定基準 {stats.thresholds.priorityA}{" "}
                    に届いていません。
                  </>
                )}
                {referenceDistanceKm !== null && referenceDistanceKm > 5 ? (
                  <> 基準地点が約{referenceDistanceKm.toFixed(0)}km離れているためです。近くで現地記録を取り直すと結果が変わります。</>
                ) : (
                  <> 「類似度で色分け」に切り替えると、しきい値に届かない範囲の濃淡も確認できます。</>
                )}
              </Hint>
            )}

            <div className="mt-3 space-y-2">
              {detail.hotspots.map((h) => {
                const legend = detail.legend.find((l) => l.key === h.cell_class);
                const Icon = CLASS_ICON[h.cell_class] ?? Sprout;
                const actions = detail.actions.filter((a) => a.hotspot_id === h.id);
                return (
                  <div key={h.id} className="border border-[var(--gda-ink-line)] bg-[var(--gda-ink-3)] rounded-xl p-3">
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${legend?.color}33`, color: legend?.color }}
                      >
                        <Icon size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold">
                          #{h.rank} {legend?.label}
                        </div>
                        <div className="text-[11px] text-[var(--gda-ink-muted)] mt-0.5">
                          {h.area_ha.toFixed(2)} ha ・ {h.cell_count} マス ・ <Term id="compactness">連結度</Term>{" "}
                          {h.compactness.toFixed(2)}
                          {h.mean_similarity !== null && ` ・ 類似度 ${h.mean_similarity.toFixed(2)}`}
                          {h.mean_change !== null && ` ・ 変化 ${h.mean_change.toFixed(3)}`}
                        </div>
                        <div className="text-[10.5px] text-[var(--gda-ink-muted)] mt-0.5 font-mono">
                          {h.center_lat.toFixed(5)}, {h.center_lng.toFixed(5)}
                        </div>
                        {actions.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {actions.map((a) => (
                              <li key={a.id} className="text-[11px] leading-snug">
                                <span className="text-[var(--gda-ink-muted)]">[{a.stage}]</span> {a.title}
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
                className="mt-3 block text-center text-xs font-medium bg-white/5 hover:bg-white/10 border border-[var(--gda-ink-line)] rounded-lg py-2"
              >
                回復計画 {detail.actions.length} 件を開く
              </Link>
            )}
          </div>
        )}

        {!detail && !busy && (
          <div className="[&_*]:!text-[var(--gda-ink-muted)]">
            <EmptyState
              icon={Grid3x3}
              title="まだ解析していません"
              body="上の設定を確認して「メッシュ解析を実行」を押すと、対象地を10m四方に区切って1マスずつ衛星データを取得します。初回は数十秒〜数分かかります。"
            />
          </div>
        )}

        {meshes.length > 1 && (
          <div className="p-4 border-t border-[var(--gda-ink-line)]">
            <div className="text-[11px] text-[var(--gda-ink-muted)] mb-1">過去の解析</div>
            <select
              value={activeMeshId ?? ""}
              onChange={(e) => setSearchParams({ mesh: e.target.value })}
              className="w-full bg-black/25 border border-[var(--gda-ink-line)] rounded-lg px-2 py-1.5 text-xs text-[var(--gda-ink-text)]"
            >
              {meshes.map((m) => (
                <option key={m.id} value={m.id}>
                  {new Date(m.created_at).toLocaleString("ja-JP")} ・ {m.cell_size_m}m ・ {m.extent_m}m
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="p-4 border-t border-[var(--gda-ink-line)]">
          <SourceChips
            dark
            sources={[
              { id: "ae", label: "AlphaEarth", sub: `${context?.year ?? 2024}`, icon: "globe" },
              { id: "s2", label: "Sentinel-2", icon: "satellite" },
              {
                id: "photo",
                label: "現地記録",
                sub: `${context?.confirmedRecords.length ?? 0}件`,
                icon: "photo",
                active: (context?.confirmedRecords.length ?? 0) > 0,
              },
            ]}
          />
        </div>
      </div>

      {/* Right: the map, with its chrome floating over it. */}
      <div className={`${mobileView === "map" ? "block" : "hidden"} lg:block relative flex-1 min-h-0 map-dark`}>
        <MapView
          center={
            detail
              ? [detail.mesh.center_lat, detail.mesh.center_lng]
              : plannedCenter
                ? [plannedCenter.lat, plannedCenter.lng]
                : [36.2048, 138.2529]
          }
          zoom={detail || plannedCenter ? 17 : 5}
          basemap={controls.basemap}
          imageryEpoch={controls.imageryEpoch}
          imageryOpacity={controls.imageryOpacity}
          mesh={detail?.geojson ?? null}
          meshVisible={controls.meshVisible}
          meshOpacity={controls.meshOpacity}
          meshColorMode={controls.meshColorMode}
          meshHeightMode={controls.meshHeightMode}
          gridVisible={controls.gridVisible}
          labelsVisible={controls.labelsVisible}
          terrain3d={controls.terrain3d}
          terrainExaggeration={controls.exaggeration}
          markers={markers}
          fitBounds={bounds}
          maxFitZoom={18}
          globe={false}
          showUserLocation
          onCellClick={setSelected}
          onOverlayStatus={setOverlayOk}
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

        {/* Header strip: what you are looking at, and the tools that act on it. */}
        <div className="absolute top-2.5 left-2.5 right-2.5 z-10 flex items-start gap-2 pointer-events-none">
          <div className="rounded-lg border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] backdrop-blur-md px-3 py-2 pointer-events-auto min-w-0">
            <div className="text-xs font-semibold truncate">{context?.project.name ?? "対象地"}</div>
            <div className="flex flex-wrap gap-x-3 text-[10px] text-[var(--gda-ink-muted)]">
              {context?.project.areaHa != null && <span>面積 {context.project.areaHa.toLocaleString()} ha</span>}
              {detail && <span>{detail.mesh.cell_size_m}m グリッド ・ {detail.mesh.extent_m}m 四方</span>}
              {detail && <span>{detail.mesh.year}年データ</span>}
            </div>
          </div>

          <div className="ml-auto flex gap-1.5 pointer-events-auto shrink-0">
            <button
              onClick={() => setControls((c) => ({ ...c, terrain3d: !c.terrain3d }))}
              title="3D地形の表示を切り替えます"
              className={`flex items-center gap-1 rounded-lg border px-2 py-2 text-[10.5px] backdrop-blur-md ${
                controls.terrain3d
                  ? "border-[var(--gda-green)] bg-[var(--gda-green)] text-white"
                  : "border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] text-[var(--gda-ink-text)]"
              }`}
            >
              <Mountain size={12} /> <span className="hidden sm:inline">3D</span>
            </button>
            <button
              onClick={() => window.print()}
              title="この画面を印刷 / PDFに保存します"
              className="flex items-center gap-1 rounded-lg border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] backdrop-blur-md px-2 py-2 text-[10.5px]"
            >
              <Printer size={12} /> <span className="hidden sm:inline">印刷</span>
            </button>
            <button
              onClick={() => document.querySelector(".map-dark")?.requestFullscreen?.()}
              title="全画面表示"
              className="flex items-center gap-1 rounded-lg border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] backdrop-blur-md px-2 py-2 text-[10.5px]"
            >
              <Maximize2 size={12} />
            </button>
          </div>
        </div>

        {pickOnMap && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-[var(--gda-green)] text-white text-xs rounded-full px-3 py-1.5 shadow-lg flex items-center gap-1.5">
            <Crosshair size={12} /> 解析したい場所を地図上でクリックしてください
          </div>
        )}

        {/* Layer rail + legend. Scrolls on a short screen instead of clipping. */}
        <div className="absolute top-16 right-2.5 z-10 w-52 max-h-[calc(100%-6rem)] overflow-y-auto scrollbar-dark space-y-2">
          <LayerRail layers={layers} onChange={onLayerChange} open={railOpen} onToggleOpen={() => setRailOpen((v) => !v)} />

          {detail && (
            <>
              <div className="rounded-xl border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] backdrop-blur-md p-2.5">
                <div className="text-[10px] text-[var(--gda-ink-muted)] mb-1.5">マスの色分け</div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ["class", "判定"],
                      ["similarity", "類似度"],
                      ["change", "変化"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => setControls((c) => ({ ...c, meshColorMode: mode }))}
                      className={`text-[10.5px] py-1 rounded-md border ${
                        controls.meshColorMode === mode
                          ? "bg-[var(--gda-green)] text-white border-[var(--gda-green)]"
                          : "bg-white/5 text-[var(--gda-ink-text)] border-[var(--gda-ink-line)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {controls.meshColorMode === "class" ? (
                <Legend dark entries={legendEntries} />
              ) : (
                <div className="rounded-xl border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] backdrop-blur-md p-2.5">
                  <div className="text-xs font-semibold mb-1.5">凡例</div>
                  <div
                    className="h-2.5 rounded"
                    style={{
                      background:
                        controls.meshColorMode === "similarity"
                          ? "linear-gradient(90deg,#f1f8f4,#96ccae,#2f9e63,#0f5132)"
                          : "linear-gradient(90deg,#fdf5f3,#f0b8a8,#d4623f,#8c2c14)",
                    }}
                  />
                  <div className="flex justify-between text-[9.5px] text-[var(--gda-ink-muted)] mt-1">
                    <span>{controls.meshColorMode === "similarity" ? "0（似ていない）" : "0（変化なし）"}</span>
                    <span>{controls.meshColorMode === "similarity" ? "1（同じ環境）" : "0.3（大きい）"}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {selected && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-72 z-10 rounded-xl border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.92)] backdrop-blur-md p-3 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <Ruler size={12} className="text-[var(--gda-ink-muted)]" />
                {selected.label}
              </div>
              <button onClick={() => setSelected(null)} className="text-[var(--gda-ink-muted)] text-sm leading-none">
                ×
              </button>
            </div>
            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <dt className="text-[var(--gda-ink-muted)]">
                  <Term id="similarity">基準との類似度</Term>
                </dt>
                <dd className="font-medium tabular-nums">{selected.similarity?.toFixed(3) ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--gda-ink-muted)]">
                  <Term id="change">前年比の変化</Term>
                </dt>
                <dd className="font-medium tabular-nums">{selected.change?.toFixed(3) ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--gda-ink-muted)]">このマス内の現地記録</dt>
                <dd className="font-medium tabular-nums">{selected.fieldRecords} 件</dd>
              </div>
            </dl>
            <p className="text-[10px] text-[var(--gda-ink-muted)] mt-2 leading-relaxed">
              Google Satellite Embedding の実測値です。変化の「原因」は衛星では判定できないため、現地確認が必要です。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
