import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Send, BarChart3, FileText, Satellite, MessageSquare, Map as MapIcon } from "lucide-react";
import { api, streamChat } from "../lib/api";
import MapView, { type MapMarker } from "../components/MapView";

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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"chat" | "map">("chat");
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

  const markers: MapMarker[] = candidates
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({ lat: c.lat as number, lng: c.lng as number, label: `${c.label} (score ${c.score})`, color: scoreColor(c.score) }));

  return (
    <div className="flex flex-col md:flex-row h-full">
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
            <div className="text-xs text-slate-400 leading-relaxed">
              例:「関東地方のこの3候補地に新しい発電所を建てる場合、生態系への影響が最も小さいのはどこか。回避・低減の具体策も教えて」
              のように、自然言語で質問してください。
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
        {candidates.length > 0 && (
          <div className="px-4 py-2 border-t border-slate-100 flex gap-2">
            <Link
              to={`/projects/${id}/analysis`}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2"
            >
              <BarChart3 size={14} /> 分析結果
            </Link>
            <Link
              to={`/projects/${id}/report`}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2"
            >
              <FileText size={14} /> レポート
            </Link>
          </div>
        )}
        <div className="p-3 border-t border-slate-100 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="追加条件を入力してください"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="bg-[var(--gda-navy)] disabled:opacity-40 text-white rounded-lg px-3 flex items-center justify-center"
          >
            <Send size={16} />
          </button>
        </div>
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
          zoom={project ? 11 : 5}
          markers={markers}
        />
      </div>
    </div>
  );
}
