import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import MapView from "../components/MapView";

interface Candidate {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  rank: number;
  score: number;
  habitat_overlap: number;
  protected_area_distance_km: number;
  connectivity_impact: string;
  ndre_change_pct: number;
  alphaearth_similarity: number;
  access_distance_km: number;
  access_rating: string;
  confidence: string;
  evidence_basis: string;
  field_records_count: number;
  recommended_action: string;
}

interface Mitigation {
  id: string;
  candidate_id: string;
  hierarchy_stage: "avoid" | "reduce" | "restore" | "offset";
  description: string;
  priority: number;
  cost_impact: string;
}

const STAGE_LABEL: Record<string, string> = { avoid: "回避", reduce: "低減", restore: "回復", offset: "オフセット" };

function scoreColor(score: number): string {
  if (score >= 75) return "text-green-700 bg-green-50 border-green-200";
  if (score >= 55) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}

function scoreDot(score: number): string {
  if (score >= 75) return "#1f7a4d";
  if (score >= 55) return "#b98420";
  return "#b3432b";
}

export default function AnalysisResults() {
  const { id } = useParams<{ id: string }>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [mitigations, setMitigations] = useState<Mitigation[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [projectCenter, setProjectCenter] = useState<[number, number]>([36.2048, 138.2529]);

  useEffect(() => {
    if (!id) return;
    api.get<{ candidates: Candidate[]; mitigations: Mitigation[] }>(`/projects/${id}/candidates`).then((r) => {
      setCandidates(r.candidates);
      setMitigations(r.mitigations);
    });
    api.get<{ project: { center_lat: number; center_lng: number } }>(`/projects/${id}`).then((r) =>
      setProjectCenter([r.project.center_lat, r.project.center_lng]),
    );
  }, [id]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-slate-400">分析結果</div>
          <h1 className="text-lg font-semibold text-slate-800">生物多様性ポテンシャル評価</h1>
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
          まだ分析結果がありません。AI調査チャットで候補地の比較を依頼してください。
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-[420px]">
            <MapView
              center={projectCenter}
              zoom={11}
              markers={candidates
                .filter((c) => c.lat != null && c.lng != null)
                .map((c) => ({ lat: c.lat as number, lng: c.lng as number, label: `${c.rank}. ${c.label}`, color: scoreDot(c.score) }))}
            />
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium text-slate-700">現地調査の優先候補</div>
            {candidates.map((c) => (
              <div key={c.id} className={`rounded-xl border p-4 ${scoreColor(c.score)}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-sm">
                    {c.rank}. {c.label}
                  </div>
                  <div className="text-xl font-bold">{c.score}</div>
                </div>
                <div className="text-[11px] mb-2">推奨: {c.recommended_action}</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {c.evidence_basis.split(",").map((e) => (
                    <span key={e} className="text-[10px] bg-white/70 border border-current rounded-full px-2 py-0.5">
                      {e}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  className="text-[11px] underline underline-offset-2"
                >
                  {expanded === c.id ? "ミティゲーション案を閉じる" : "ミティゲーション案を見る"}
                </button>
                {expanded === c.id && (
                  <div className="mt-2 space-y-1.5 bg-white/60 rounded-lg p-2">
                    {mitigations
                      .filter((m) => m.candidate_id === c.id)
                      .sort((a, b) => a.priority - b.priority)
                      .map((m) => (
                        <div key={m.id} className="text-[11px] leading-relaxed">
                          <span className="font-semibold">
                            {m.priority}. [{STAGE_LABEL[m.hierarchy_stage]}]
                          </span>{" "}
                          {m.description}
                          <span className="text-slate-500"> （コスト影響: {m.cost_impact}）</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">候補</th>
                  <th className="text-left px-4 py-3 font-medium">環境変化 (NDRE)</th>
                  <th className="text-left px-4 py-3 font-medium">類似度 (AlphaEarth)</th>
                  <th className="text-left px-4 py-3 font-medium">アクセス</th>
                  <th className="text-left px-4 py-3 font-medium">信頼度</th>
                  <th className="text-left px-4 py-3 font-medium">推奨アクション</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {c.rank}. {c.label}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.ndre_change_pct}%</td>
                    <td className="px-4 py-3 text-slate-600">{c.alphaearth_similarity}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.access_distance_km}km（{c.access_rating}）
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.confidence}</td>
                    <td className="px-4 py-3 font-medium">{c.recommended_action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-50">
              結果はAIによる推定です（シミュレーションデータ）。最終判断には現地確認・専門家レビューが必要です。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
