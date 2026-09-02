import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BarChart3, FileText, Satellite, MessageSquare, Map as MapIcon, Camera, Grid3x3 } from "lucide-react";
import { api, streamChat } from "../lib/api";
import MapView, { type MapMarker } from "../components/MapView";
import MapControlPanel, { DEFAULT_MAP_CONTROLS, type MapControlState } from "../components/MapControlPanel";
import ChatInput from "../components/ChatInput";

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
}

function scoreColor(score: number): string {
  if (score >= 75) return "#1f7a4d";
  if (score >= 55) return "#b98420";
  return "#b3432b";
}

export default function ProjectChat() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [fieldRecords, setFieldRecords] = useState<{ lat: number; lng: number; species_guess: string | null }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"chat" | "map">("chat");
  const [controls, setControls] = useState<MapControlState>(DEFAULT_MAP_CONTROLS);
  // The mesh belongs on the map people actually look at, not only on the
  // screen dedicated to producing it.
  const [meshGeoJson, setMeshGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
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
          const detail = await api.get<{ geojson: GeoJSON.FeatureCollection }>(`/meshes/${list.meshes[0].id}`);
          setMeshGeoJson(detail.geojson);
        }
      } catch {
        // A project with no mesh yet is the normal case, not an error.
      }
    })();
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stepLabel]);

  const send = async () => {
    if (!input.trim() || !conversationId || sending) return;
    const content = input.trim();
    setInput("");
    setBudgetError(null);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() }]);
    setSending(true);
    const assistantId = `local-assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() }]);

    try {
      await streamChat(conversationId, content, {
        onDelta: (text) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)));
        },
        onStep: (label) => setStepLabel(label),
        onAnalysisSaved: async () => {
          if (id) {
            const cand = await api.get<{ candidates: Candidate[] }>(`/projects/${id}/candidates`);
            setCandidates(cand.candidates);
          }
        },
        onBudgetExceeded: (data) => {
          setBudgetError(data.message);
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        },
        onDone: () => setStepLabel(null),
        onError: (message) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content || `エラー: ${message}` } : m)));
        },
      });
    } finally {
      setSending(false);
      setStepLabel(null);
    }
  };

  const markers: MapMarker[] = [
    ...candidates
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => ({ lat: c.lat as number, lng: c.lng as number, label: `${c.label} (score ${c.score})`, color: scoreColor(c.score) })),
    ...fieldRecords.map((f) => ({
      lat: f.lat,
      lng: f.lng,
      label: `現地記録: ${f.species_guess ?? "種未記入"}`,
      color: "#2563eb",
    })),
  ];

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-3.5rem-4rem)] md:h-screen">
      <div className="md:hidden flex border-b border-slate-200 bg-white">
        <button
          onClick={() => setMobileView("chat")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 ${
            mobileView === "chat" ? "border-[var(--gda-green)] text-[var(--gda-green)]" : "border-transparent text-slate-400"
          }`}
        >
          <MessageSquare size={14} /> 会話
        </button>
        <button
          onClick={() => setMobileView("map")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 ${
            mobileView === "map" ? "border-[var(--gda-green)] text-[var(--gda-green)]" : "border-transparent text-slate-400"
          }`}
        >
          <MapIcon size={14} /> 地図
        </button>
      </div>
      <div
        className={`${mobileView === "chat" ? "flex" : "hidden"} md:flex w-full md:w-[420px] md:shrink-0 border-r border-slate-200 bg-white flex-col flex-1 md:flex-none min-h-0`}
      >
        <div className="hidden md:block px-4 py-3 border-b border-slate-100">
          <div className="text-xs text-slate-400 mb-0.5">AI調査</div>
          <div className="font-medium text-slate-800 text-sm">{project?.name ?? "読み込み中..."}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="text-xs text-slate-500 leading-relaxed">
                専門用語は不要です。ふだんの言葉で聞いてください。AIは条件が足りなければ聞き返します。
              </div>
              <div className="space-y-1.5">
                {[
                  "この2地点を比較して。生態系への影響が小さいのはどちらか、回避・低減の具体策も教えて",
                  "この土地で保全すべき場所と、回復に取り組むべき場所を教えて",
                  "34.7241, 135.4894 の周辺で、設備を置いても影響が小さい区域はどこか",
                  "分かる範囲で暫定分析して。不確実な点も一緒に示して",
                ].map((example) => (
                  <button
                    key={example}
                    onClick={() => setInput(example)}
                    className="w-full text-left text-[11px] text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-2 leading-relaxed"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-slate-400 leading-relaxed">
                数値はAIが作文するのではなく、構造化された分析ツールを呼び出して算出します。実データか推定値かは回答内に明示されます。
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "user" ? "bg-[var(--gda-navy)] text-white" : "bg-slate-100 text-slate-800"
                }`}
              >
                {m.content || (sending && m.role === "assistant" ? "…" : "")}
              </div>
            </div>
          ))}
          {stepLabel && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Satellite size={14} className="animate-pulse" /> {stepLabel}
            </div>
          )}
          {budgetError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{budgetError}</div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="px-4 py-2 border-t border-slate-100 flex gap-2">
          <Link
            to={`/projects/${id}/field`}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2"
          >
            <Camera size={14} /> 現地記録
          </Link>
          <Link
            to={`/projects/${id}/mesh`}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2"
          >
            <Grid3x3 size={14} /> 10mメッシュ
          </Link>
          {candidates.length > 0 && (
            <>
              <Link
                to={`/projects/${id}/analysis`}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2"
              >
                <BarChart3 size={14} /> 分析結果
              </Link>
              <Link
                to={`/projects/${id}/leap`}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2"
              >
                <FileText size={14} /> TNFD出力
              </Link>
            </>
          )}
        </div>
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={send}
          disabled={sending}
          placeholder="調査したい内容や追加条件を入力（音声入力も使えます）"
        />
      </div>
      <div className={`${mobileView === "map" ? "block" : "hidden"} md:block relative flex-1 min-h-0`}>
        <div className="absolute top-3 left-3 z-10 bg-white/95 rounded-lg shadow-sm px-3 py-2 text-xs text-slate-600">
          {project?.area_ha ? `面積: ${project.area_ha.toLocaleString()} ha　` : ""}
          {project?.elevation_min != null && project?.elevation_max != null
            ? `標高: ${project.elevation_min} - ${project.elevation_max} m`
            : ""}
        </div>
        <MapView
          center={project ? [project.center_lat, project.center_lng] : [36.2048, 138.2529]}
          zoom={project ? 13 : 5}
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

        <div className="absolute top-3 right-3 z-10 w-56 max-h-[calc(100%-1.5rem)] overflow-y-auto">
          <MapControlPanel
            value={controls}
            onChange={setControls}
            hasMesh={Boolean(meshGeoJson && meshGeoJson.features.length > 0)}
            defaultOpen={false}
          />
        </div>
      </div>
    </div>
  );
}
