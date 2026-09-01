import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { BarChart3, ThumbsUp, TriangleAlert, HelpCircle } from "lucide-react";
import { api } from "../lib/api";
import MapView from "../components/MapView";
import { Term, Hint, EmptyState, Verdict } from "../components/Explain";

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

/**
 * V-04 asks for good points, concerns and uncertainty side by side. These are
 * derived from the candidate's own numbers against stated cut-offs rather than
 * written prose, so two candidates are always judged the same way and a
 * reviewer can check any line against the table below.
 */
function readCandidate(c: Candidate) {
  const pros: string[] = [];
  const cons: string[] = [];
  const unknowns: string[] = [];

  if (c.habitat_overlap != null && c.habitat_overlap < 0.2) pros.push(`生息地との重複が ${(c.habitat_overlap * 100).toFixed(0)}% と低い`);
  if (c.habitat_overlap != null && c.habitat_overlap >= 0.4) cons.push(`生息地との重複が ${(c.habitat_overlap * 100).toFixed(0)}% と高い`);

  if (c.protected_area_distance_km != null && c.protected_area_distance_km >= 3)
    pros.push(`最近接の保護区域まで ${c.protected_area_distance_km.toFixed(1)}km と余裕がある`);
  if (c.protected_area_distance_km != null && c.protected_area_distance_km < 1.5)
    cons.push(`保護区域まで ${c.protected_area_distance_km.toFixed(1)}km と近接している`);

  if (c.connectivity_impact === "低") pros.push("生態系ネットワークの分断リスクが低い");
  if (c.connectivity_impact === "高") cons.push("生態系ネットワークの通り道を分断する可能性がある");

  if (c.access_rating === "良い") pros.push(`搬入路まで ${c.access_distance_km?.toFixed(1)}km でアクセスが良い`);
  if (c.access_rating === "悪い") cons.push(`アクセスが悪く（${c.access_distance_km?.toFixed(1)}km）工事コストが増える可能性`);

  if (c.field_records_count > 0) pros.push(`周辺に現地記録が ${c.field_records_count} 件あり、判断の裏付けがある`);
  else unknowns.push("周辺に現地記録がなく、実際の生息状況は未確認");

  const basis = (c.evidence_basis ?? "").split(",");
  if (!basis.some((b) => b.includes("Earth Engine実データ")))
    unknowns.push("衛星の実測値が使われておらず、類似度は推定値");
  if (basis.some((b) => b.includes("未確認")))
    unknowns.push("未査読の現地記録が含まれており、確定した根拠ではない");
  if (c.confidence === "低") unknowns.push("データが乏しく、信頼度は「低」");

  unknowns.push("生息地重複度・保護区域距離・アクセスは本MVPではシミュレーション値");

  return { pros, cons, unknowns };
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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-slate-400">分析結果</div>
          <h1 className="text-lg font-semibold text-slate-800">生物多様性ポテンシャル評価</h1>
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState
            icon={BarChart3}
            title="まだ比較結果がありません"
            body="AI調査チャットで「この2地点を比較して」のように依頼すると、同じ評価軸で候補地をランキングし、回避・低減策まで提示します。"
            action={
              <Link
                to={`/projects/${id}`}
                className="inline-block bg-[var(--gda-green)] text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                AI調査を開く
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {candidates[0] && (
            <div className="col-span-full bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-[11px] text-slate-400 mb-1">結論</div>
              <p className="text-sm text-slate-800 leading-relaxed">
                比較した {candidates.length} 地点のうち、生物多様性への影響が最も小さいのは
                <strong className="mx-1">{candidates[0].label}</strong>
                （総合スコア {candidates[0].score}）です。
                {candidates[1] && (
                  <>
                    次点は {candidates[1].label}（{candidates[1].score}）で、差は{" "}
                    {candidates[0].score - candidates[1].score} 点です。
                    {candidates[0].score - candidates[1].score < 8 &&
                      "差が小さいため、スコアだけで決めず、下の懸念点の内容を見て判断してください。"}
                  </>
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Verdict level={candidates[0].confidence === "高" ? "good" : candidates[0].confidence === "中" ? "watch" : "act"}>
                  信頼度 {candidates[0].confidence}
                </Verdict>
                <Verdict level="watch">最終判断には現地確認が必要</Verdict>
              </div>
            </div>
          )}

          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-64 sm:h-[420px]">
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
                {(() => {
                  const reading = readCandidate(c);
                  return (
                    <div className="space-y-1.5 mb-2 text-[11px] leading-relaxed">
                      {reading.pros.length > 0 && (
                        <div className="flex gap-1.5">
                          <ThumbsUp size={12} className="shrink-0 mt-0.5" />
                          <div>{reading.pros.join("／")}</div>
                        </div>
                      )}
                      {reading.cons.length > 0 && (
                        <div className="flex gap-1.5">
                          <TriangleAlert size={12} className="shrink-0 mt-0.5" />
                          <div>{reading.cons.join("／")}</div>
                        </div>
                      )}
                      <div className="flex gap-1.5 opacity-80">
                        <HelpCircle size={12} className="shrink-0 mt-0.5" />
                        <div>{reading.unknowns.join("／")}</div>
                      </div>
                    </div>
                  );
                })()}
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

          <div className="col-span-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">候補</th>
                  <th className="text-left px-4 py-3 font-medium">
                    <Term id="ndre">環境変化 (NDRE)</Term>
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    <Term id="similarity">類似度</Term>
                  </th>
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
            <div className="px-4 py-3 border-t border-slate-50">
              <Hint tone="warn">
                <strong>この表の読み方。</strong>
                「類似度」だけは条件が揃えば衛星の実測値ですが、生息地重複度・保護区域距離・アクセスは本MVPでは
                シミュレーション値です。各候補の
                <Term id="evidence">根拠ステータス</Term>
                を必ず確認し、法令適合性・アセスメントの要否は所管行政庁と専門家に確認してください。
              </Hint>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
