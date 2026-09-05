import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BarChart3,
  FileText,
  MessageSquare,
  Map as MapIcon,
  Camera,
  Grid3x3,
  ListOrdered,
  TriangleAlert,
  Scale,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { api, streamChat, type PlanStep } from "../lib/api";
import MapView, { type MapMarker } from "../components/MapView";
import MapControlPanel, { DEFAULT_MAP_CONTROLS, type MapControlState } from "../components/MapControlPanel";
import ChatInput from "../components/ChatInput";
import AgentSteps, { type AgentStep } from "../components/ui/AgentSteps";
import SourceChips from "../components/ui/SourceChips";
import RankCard from "../components/ui/RankCard";

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  area_ha: number | null;
  elevation_min: number | null;
  elevation_max: number | null;
  center_lat: number;
  center_lng: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface Candidate {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  score: number;
  rank: number;
  access_distance_km?: number;
  alphaearth_similarity?: number;
  confidence?: string;
}

function scoreColor(score: number): string {
  return score >= 75 ? "#3f9f5e" : score >= 55 ? "#c9a227" : "#c0392b";
}

function tone(score: number): "good" | "watch" | "act" {
  return score >= 75 ? "good" : score >= 55 ? "watch" : "act";
}

const EXAMPLES = [
  "この2地点を比較して。生態系への影響が小さいのはどちらか、回避・低減の具体策も教えて",
  "この土地で保全すべき場所と、回復に取り組むべき場所を教えて",
  "34.7241, 135.4894 の周辺で、設備を置いても影響が小さい区域はどこか",
  "分かる範囲で暫定分析して。不確実な点も一緒に示して",
];

/**
 * V-02 AI対話と地図（適地選定の主力画面）.
 *
 * Three columns on a desktop: what was asked and how it is being answered
 * (left), the ground itself (centre), the answer as a ranking (right). The
 * columns are one argument read left to right, so a reader never has to hold
 * the question in their head while looking at the map.
 *
 * On a phone the same three become tabs, because the requirements are explicit
 * that mobile must not drop information - it may only stage it (5.1, R-09).
 */
export default function ProjectChat() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [fieldRecords, setFieldRecords] = useState<{ lat: number; lng: number; species_guess: string | null }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [plan, setPlan] = useState<AgentStep[] | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"chat" | "map" | "rank">("chat");
  const [controls, setControls] = useState<MapControlState>(DEFAULT_MAP_CONTROLS);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [meshGeoJson, setMeshGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [focus, setFocus] = useState<Candidate | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const detail = await api.get<{ project: ProjectDetail; conversations: { id: string }[] }>(`/projects/${id}`);
      setProject(detail.project);
      let convId = detail.conversations[0]?.id;
      if (!convId) {
        const created = await api.post<{ id: string }>(`/projects/${id}/conversations`, {});
        convId = created.id;
      }
      setConversationId(convId);
      const msgs = await api.get<{ messages: Message[] }>(`/conversations/${convId}/messages`);
      setMessages(msgs.messages);
      const cand = await api.get<{ candidates: Candidate[] }>(`/projects/${id}/candidates`);
      setCandidates(cand.candidates);
      const field = await api.get<{ records: { lat: number; lng: number; species_guess: string | null }[] }>(
        `/projects/${id}/field-records`,
      );
      setFieldRecords(field.records);

      try {
        const list = await api.get<{ meshes: { id: string }[] }>(`/projects/${id}/meshes`);
        if (list.meshes[0]) {
          const meshDetail = await api.get<{ geojson: GeoJSON.FeatureCollection }>(`/meshes/${list.meshes[0].id}`);
          setMeshGeoJson(meshDetail.geojson);
        }
      } catch {
        // A project with no mesh yet is the normal case, not an error.
      }
    })();
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, plan]);

  const send = async () => {
    if (!input.trim() || !conversationId || sending) return;
    const content = input.trim();
    setInput("");
    setBudgetError(null);
    setPlan(null);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() },
    ]);
    setSending(true);
    const assistantId = `local-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() },
    ]);

    try {
      await streamChat(conversationId, content, {
        onDelta: (text) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)));
        },
        onPlan: (steps: PlanStep[]) =>
          setPlan(steps.map((s, i) => ({ ...s, status: i === 0 ? "running" : "waiting" }))),
        onStep: (label, index) =>
          setPlan((prev) => {
            if (!prev) return [{ label, status: "running" }];
            if (index == null) return prev;
            return prev.map((s, i) => ({ ...s, status: i < index ? "done" : i === index ? "running" : "waiting" }));
          }),
        onAnalysisSaved: async () => {
          setPlan((prev) => prev?.map((s) => ({ ...s, status: "done" })) ?? prev);
          if (id) {
            const cand = await api.get<{ candidates: Candidate[] }>(`/projects/${id}/candidates`);
            setCandidates(cand.candidates);
            setMobileView((v) => (v === "chat" ? v : "rank"));
          }
        },
        onBudgetExceeded: (data) => {
          setBudgetError(data.message);
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        },
        onDone: () => setPlan((prev) => prev?.map((s) => ({ ...s, status: "done" })) ?? prev),
        onError: (message) => {
          setPlan((prev) => prev?.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)) ?? prev);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content || `エラー: ${message}` } : m)),
          );
        },
      });
    } finally {
      setSending(false);
    }
  };

  const markers: MapMarker[] = [
    ...candidates
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => ({
        lat: c.lat as number,
        lng: c.lng as number,
        label: `${c.rank}. ${c.label}（${c.score}点）`,
        color: scoreColor(c.score),
      })),
    ...fieldRecords.map((f) => ({
      lat: f.lat,
      lng: f.lng,
      label: `現地記録: ${f.species_guess ?? "種未記入"}`,
      color: "#2563eb",
    })),
  ];

  const TABS = [
    { key: "chat" as const, label: "AI調査", icon: MessageSquare },
    { key: "map" as const, label: "地図", icon: MapIcon },
    { key: "rank" as const, label: `候補地${candidates.length ? ` ${candidates.length}` : ""}`, icon: ListOrdered },
  ];

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem-4rem)] md:h-screen bg-[var(--gda-bg)]">
      {/* Mobile tab bar. Three destinations, never fewer - hiding the ranking
          behind a scroll is how a phone user misses the actual answer. */}
      <div className="lg:hidden flex border-b border-slate-200 bg-white shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setMobileView(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 ${
              mobileView === t.key
                ? "border-[var(--gda-green)] text-[var(--gda-green)]"
                : "border-transparent text-slate-400"
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Column 1: the conversation and the plan it produced. */}
      <div
        className={`${mobileView === "chat" ? "flex" : "hidden"} lg:flex w-full lg:w-[380px] xl:w-[420px] lg:shrink-0 border-r border-slate-200 bg-white flex-col flex-1 lg:flex-none min-h-0`}
      >
        <div className="hidden lg:flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <span className="w-7 h-7 rounded-lg bg-[var(--gda-navy)] flex items-center justify-center shrink-0">
            <Sparkles size={14} className="text-white" />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] text-slate-400 leading-tight">AIアシスタント</div>
            <div className="font-medium text-slate-800 text-sm truncate leading-tight">
              {project?.name ?? "読み込み中..."}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                専門用語は不要です。ふだんの言葉で聞いてください。条件が足りなければAIが聞き返します。
              </p>
              <div className="space-y-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => setInput(example)}
                    className="w-full text-left text-[11px] text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-2 leading-relaxed"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                数値はAIが作文するのではなく、構造化された分析ツールを呼び出して算出します。実データか推定値かは回答内に明示されます。
              </p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex gap-2"}>
              {m.role === "assistant" && (
                <span className="w-6 h-6 rounded-lg bg-[var(--gda-navy)] flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={12} className="text-white" />
                </span>
              )}
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap leading-relaxed ${
                  m.role === "user"
                    ? "bg-sky-50 border border-sky-100 text-slate-800"
                    : "bg-slate-50 border border-slate-100 text-slate-800"
                }`}
              >
                {m.content || (sending && m.role === "assistant" ? "…" : "")}
              </div>
            </div>
          ))}

          {plan && (
            <div className="ml-8 rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-medium text-slate-700 mb-2">調査条件を整理しました</div>
              <AgentSteps steps={plan} />
              {sending && (
                <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 leading-snug">
                  AIがデータを処理しています。しばらくお待ちください。
                  <br />
                  <TriangleAlert size={9} className="inline mr-0.5 -mt-0.5" />
                  AIによる推定・要現地確認
                </div>
              )}
            </div>
          )}

          {budgetError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{budgetError}</div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-4 py-2 border-t border-slate-100">
          <SourceChips
            label="使用データ"
            sources={[
              { id: "ae", label: "AlphaEarth", sub: "2024", icon: "globe" },
              { id: "s2", label: "Sentinel-2", icon: "satellite" },
              { id: "photo", label: "現地写真", sub: `${fieldRecords.length}件`, icon: "photo", active: fieldRecords.length > 0 },
            ]}
          />
        </div>

        <ChatInput
          value={input}
          onChange={setInput}
          onSend={send}
          disabled={sending}
          placeholder="条件を追加・変更する（音声入力も使えます）"
        />
      </div>

      {/* Column 2: the ground. */}
      <div className={`${mobileView === "map" ? "flex" : "hidden"} lg:flex relative flex-1 min-h-0 flex-col`}>
        <div className="absolute top-2.5 left-2.5 right-2.5 z-10 flex items-start gap-2 pointer-events-none">
          <div className="bg-white/95 backdrop-blur rounded-lg shadow-sm border border-slate-200 px-3 py-2 text-[11px] text-slate-600 pointer-events-auto min-w-0">
            <div className="font-medium text-slate-800 truncate">{project?.name ?? "—"}</div>
            <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-500">
              {project?.area_ha != null && <span>面積 {project.area_ha.toLocaleString()} ha</span>}
              {project?.elevation_min != null && project?.elevation_max != null && (
                <span>
                  標高 {project.elevation_min} – {project.elevation_max} m
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setControlsOpen((v) => !v)}
            className="ml-auto pointer-events-auto flex items-center gap-1.5 bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-sm px-2.5 py-2 text-[11px] font-medium text-slate-700 shrink-0"
          >
            <SlidersHorizontal size={12} /> 表示
          </button>
        </div>

        <div className="flex-1 min-h-0">
          <MapView
            center={
              focus?.lat != null
                ? [focus.lat, focus.lng as number]
                : project
                  ? [project.center_lat, project.center_lng]
                  : [36.2048, 138.2529]
            }
            zoom={focus ? 14 : project ? 13 : 5}
            markers={markers}
            basemap={controls.basemap}
            imageryEpoch={controls.imageryEpoch}
            imageryOpacity={controls.imageryOpacity}
            mesh={meshGeoJson}
            meshVisible={controls.meshVisible}
            meshOpacity={controls.meshOpacity}
            meshColorMode={controls.meshColorMode}
            gridVisible={controls.gridVisible}
            labelsVisible={controls.labelsVisible}
            terrain3d={controls.terrain3d}
            terrainExaggeration={controls.exaggeration}
            globe={false}
            showUserLocation
          />
        </div>

        {controlsOpen && (
          <div className="absolute top-14 right-2.5 z-20 w-60 max-h-[calc(100%-5rem)] overflow-y-auto scrollbar-thin">
            <MapControlPanel
              value={controls}
              onChange={setControls}
              hasMesh={Boolean(meshGeoJson && meshGeoJson.features.length > 0)}
              defaultOpen
            />
          </div>
        )}

        {/* The screening caveat lives on the map, where the decision is being
            made - not only in the report someone reads afterwards (R-08). */}
        <div className="shrink-0 bg-amber-50 border-t border-amber-200 px-3 py-2 flex items-start gap-2">
          <TriangleAlert size={13} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[10.5px] text-amber-900 leading-snug">
            初期スクリーニング結果です。事業化判断には現地調査と、法定環境アセスメントの要否確認が必要です。
          </p>
        </div>
      </div>

      {/* Column 3: the answer. */}
      <div
        className={`${mobileView === "rank" ? "flex" : "hidden"} lg:flex w-full lg:w-[300px] xl:w-[340px] lg:shrink-0 border-l border-slate-200 bg-white flex-col flex-1 lg:flex-none min-h-0`}
      >
        <div className="px-3.5 py-3 border-b border-slate-100">
          <div className="text-sm font-medium text-slate-800">候補地ランキング</div>
          <div className="text-[10px] text-slate-400">総合スコアの高い順。タップで地図が移動します。</div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
          {candidates.map((c) => (
            <RankCard
              key={c.id}
              rank={c.rank}
              title={c.label}
              subtitle={c.lat != null ? `${c.lat.toFixed(4)}, ${c.lng?.toFixed(4)}` : undefined}
              score={c.score}
              tone={tone(c.score)}
              onClick={() => setFocus(focus?.id === c.id ? null : c)}
              facts={[
                ...(c.alphaearth_similarity != null
                  ? [{ label: "類似度", value: c.alphaearth_similarity.toFixed(2), emphasis: true }]
                  : []),
                ...(c.access_distance_km != null ? [{ label: "アクセス", value: `${c.access_distance_km} km` }] : []),
                ...(c.confidence ? [{ label: "信頼度", value: c.confidence }] : []),
              ]}
            />
          ))}
          {candidates.length === 0 && (
            <div className="text-center py-10 px-3">
              <ListOrdered size={22} className="mx-auto text-slate-300 mb-2" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                まだ候補地がありません。
                <br />
                左のAI調査で「この2地点を比較して」のように依頼すると、ここに順位が並びます。
              </p>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-100 grid grid-cols-2 gap-2">
          <Link
            to={`/projects/${id}/field`}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2.5"
          >
            <Camera size={13} /> 現地記録
          </Link>
          <Link
            to={`/projects/${id}/mesh`}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2.5"
          >
            <Grid3x3 size={13} /> 10mメッシュ
          </Link>
          <Link
            to={`/projects/${id}/analysis`}
            className={`flex items-center justify-center gap-1.5 text-[11px] font-medium rounded-lg py-2.5 ${
              candidates.length
                ? "bg-[var(--gda-navy)] text-white hover:bg-[var(--gda-navy-light)]"
                : "bg-slate-100 text-slate-400 pointer-events-none"
            }`}
          >
            <Scale size={13} /> 比較する
          </Link>
          <Link
            to={`/projects/${id}/report`}
            className={`flex items-center justify-center gap-1.5 text-[11px] font-medium rounded-lg py-2.5 ${
              candidates.length
                ? "bg-[var(--gda-green)] text-white hover:bg-[var(--gda-green-dark)]"
                : "bg-slate-100 text-slate-400 pointer-events-none"
            }`}
          >
            <FileText size={13} /> レポート作成
          </Link>
          <Link
            to={`/projects/${id}/leap`}
            className="col-span-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-800 py-1"
          >
            <BarChart3 size={12} /> TNFD（LEAP）形式で出力
          </Link>
        </div>
      </div>
    </div>
  );
}
