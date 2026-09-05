import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BarChart3,
  ChevronRight,
  Scale,
  CalendarPlus,
  RefreshCw,
  Star,
  ThumbsUp,
  TriangleAlert,
  HelpCircle,
} from "lucide-react";
import { api } from "../lib/api";
import MapView from "../components/MapView";
import { Term, Hint, EmptyState } from "../components/Explain";
import { useDisplayMode } from "../lib/displayMode";
import ReproductionInfo, { type AnalysisSnapshot } from "../components/ReproductionInfo";
import RankCard, { type Reason } from "../components/ui/RankCard";
import Legend from "../components/ui/Legend";
import SourceChips from "../components/ui/SourceChips";

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
  ndre_measured: number;
  ndvi: number | null;
  ndre: number | null;
  ndmi: number | null;
  nbr: number | null;
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

const CONFIDENCE_STARS: Record<string, number> = { 高: 4.5, 中: 3.5, 低: 2 };

function tone(score: number): "good" | "watch" | "act" {
  if (score >= 75) return "good";
  if (score >= 55) return "watch";
  return "act";
}

function markerColor(score: number): string {
  return score >= 75 ? "#3f9f5e" : score >= 55 ? "#c9a227" : "#c0392b";
}

/**
 * The reasons behind a rank, as a three-state checklist rather than prose.
 *
 * V-04's design makes each criterion pass, warn or fail on its own, which is
 * what lets a reviewer disagree with one line instead of rejecting the whole
 * score. The cut-offs are stated here rather than described in text, so two
 * candidates are always judged identically.
 */
function reasonsFor(c: Candidate): Reason[] {
  const change = Math.abs(c.ndre_change_pct);
  return [
    {
      state: change >= 10 ? "ok" : change >= 5 ? "warn" : "bad",
      text: `年間環境変化が${change >= 10 ? "大きい" : change >= 5 ? "中程度" : "小さい"}（${c.ndre_change_pct}%）`,
    },
    {
      state: c.alphaearth_similarity >= 0.85 ? "ok" : c.alphaearth_similarity >= 0.7 ? "warn" : "bad",
      text: `希少種確認地点と環境が${c.alphaearth_similarity >= 0.85 ? "類似" : c.alphaearth_similarity >= 0.7 ? "やや類似" : "異なる"}`,
    },
    {
      state: c.access_distance_km <= 1.5 ? "ok" : c.access_distance_km <= 3.5 ? "warn" : "bad",
      text: `道路からのアクセスが${c.access_rating}（${c.access_distance_km}km）`,
    },
    {
      state: c.field_records_count >= 3 ? "ok" : c.field_records_count >= 1 ? "warn" : "bad",
      text: c.field_records_count > 0 ? `現地記録 ${c.field_records_count}件あり` : "現地確認が必要（記録なし）",
    },
  ];
}

/** V-04 also asks for good points / concerns / uncertainty side by side. */
function readCandidate(c: Candidate) {
  const pros: string[] = [];
  const cons: string[] = [];
  const unknowns: string[] = [];

  if (c.habitat_overlap != null && c.habitat_overlap < 0.2)
    pros.push(`生息地との重複が ${(c.habitat_overlap * 100).toFixed(0)}% と低い`);
  if (c.habitat_overlap != null && c.habitat_overlap >= 0.4)
    cons.push(`生息地との重複が ${(c.habitat_overlap * 100).toFixed(0)}% と高い`);
  if (c.protected_area_distance_km >= 3)
    pros.push(`最近接の保護区域まで ${c.protected_area_distance_km.toFixed(1)}km と余裕がある`);
  if (c.protected_area_distance_km < 1.5)
    cons.push(`保護区域まで ${c.protected_area_distance_km.toFixed(1)}km と近接している`);
  if (c.connectivity_impact === "低") pros.push("生態系ネットワークの分断リスクが低い");
  if (c.connectivity_impact === "高") cons.push("生態系ネットワークの通り道を分断する可能性がある");
  if (c.field_records_count === 0) unknowns.push("周辺に現地記録がなく、実際の生息状況は未確認");

  const basis = (c.evidence_basis ?? "").split(",");
  if (!basis.some((b) => b.includes("Earth Engine実データ"))) unknowns.push("衛星の実測値が使われておらず、類似度は推定値");
  if (basis.some((b) => b.includes("未確認"))) unknowns.push("未査読の現地記録が含まれており、確定した根拠ではない");
  if (c.confidence === "低") unknowns.push("データが乏しく、信頼度は「低」");
  unknowns.push("生息地重複度・保護区域距離・アクセスは本MVPではシミュレーション値");

  return { pros, cons, unknowns };
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-[1px]" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={11}
          className={i <= value ? "text-amber-400" : i - 0.5 === value ? "text-amber-400/60" : "text-slate-600"}
          fill={i <= value ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

/**
 * V-04 立地候補の比較結果 / トレードオフ表示.
 *
 * Dark ground on purpose: the map is the evidence and the panels are the
 * argument around it. The screen answers one question - "why this candidate and
 * not that one" - so the ranking, the reasons and the numbers all stay visible
 * without leaving the page.
 */
export default function AnalysisResults() {
  const { id } = useParams<{ id: string }>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [mitigations, setMitigations] = useState<Mitigation[]>([]);
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectCenter, setProjectCenter] = useState<[number, number]>([36.2048, 138.2529]);
  const [tab, setTab] = useState<"all" | "priority" | "review">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "list">("list");
  const { mode, atLeast } = useDisplayMode();

  useEffect(() => {
    if (!id) return;
    api
      .get<{ candidates: Candidate[]; mitigations: Mitigation[]; analysis: AnalysisSnapshot | null }>(
        `/projects/${id}/candidates`,
      )
      .then((r) => {
        setCandidates(r.candidates);
        setMitigations(r.mitigations);
        setSnapshot(r.analysis);
        setSelected((prev) => prev ?? r.candidates[0]?.id ?? null);
      });
    api.get<{ project: { name: string; center_lat: number; center_lng: number } }>(`/projects/${id}`).then((r) => {
      setProjectName(r.project.name);
      setProjectCenter([r.project.center_lat, r.project.center_lng]);
    });
  }, [id]);

  const shown = useMemo(
    () =>
      candidates.filter((c) =>
        tab === "priority" ? c.score >= 75 : tab === "review" ? c.score < 55 || c.confidence === "低" : true,
      ),
    [candidates, tab],
  );

  const focus = candidates.find((c) => c.id === selected);

  if (candidates.length === 0) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
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
      </div>
    );
  }

  const top = candidates[0];

  return (
    <div className="theme-dark min-h-full bg-[var(--gda-ink)] text-[var(--gda-ink-text)]">
      <div className="px-3 sm:px-5 pt-3 sm:pt-4 pb-3 border-b border-[var(--gda-ink-line)]">
        <div className="flex items-center gap-1 text-[10.5px] text-[var(--gda-ink-muted)] mb-1.5 min-w-0">
          <Link to="/" className="hover:text-[var(--gda-ink-text)] shrink-0">
            プロジェクト一覧
          </Link>
          <ChevronRight size={11} className="shrink-0" />
          <Link to={`/projects/${id}`} className="hover:text-[var(--gda-ink-text)] truncate">
            {projectName || "プロジェクト"}
          </Link>
          <ChevronRight size={11} className="shrink-0" />
          <span className="text-[var(--gda-ink-text)] shrink-0">分析結果</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-lg font-semibold shrink-0">分析結果</h1>
            <span className="text-[10px] rounded-md border border-[var(--gda-ink-line)] bg-white/5 px-2 py-1 truncate">
              生物多様性ポテンシャル評価
            </span>
          </div>

          <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-[var(--gda-ink-line)] overflow-hidden">
              {(
                [
                  ["all", "すべて", candidates.length],
                  ["priority", "高優先", candidates.filter((c) => c.score >= 75).length],
                  ["review", "要確認", candidates.filter((c) => c.score < 55 || c.confidence === "低").length],
                ] as const
              ).map(([key, label, n]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    tab === key
                      ? "bg-[var(--gda-green)] text-white"
                      : "text-[var(--gda-ink-muted)] hover:text-[var(--gda-ink-text)]"
                  }`}
                >
                  {label}
                  <span className="ml-1 opacity-70">{n}</span>
                </button>
              ))}
            </div>
            {snapshot && (
              <span className="flex items-center gap-1 text-[10.5px] text-[var(--gda-ink-muted)]">
                <RefreshCw size={11} />
                最終更新:{" "}
                {new Date(snapshot.executed_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}
              </span>
            )}
          </div>
        </div>

        <p className="text-[10.5px] text-[var(--gda-ink-muted)] mt-1.5">
          {mode === "easy"
            ? "かんたん表示：結論と次にすることだけを表示しています。"
            : mode === "business"
              ? "ビジネス表示：優先順位・回避策・判断に必要な数値を表示しています。"
              : "エキスパート表示：実測指標・算出条件・再現情報まで表示しています。"}
        </p>
      </div>

      <div className="px-3 sm:px-5 py-3 border-b border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)]">
        <div className="text-[10px] text-[var(--gda-ink-muted)] mb-1">結論</div>
        <p className="text-[13px] leading-relaxed">
          比較した {candidates.length} 地点のうち、生物多様性への影響が最も小さいのは
          <strong className="mx-1 text-white">{top.label}</strong>（総合スコア {top.score}）です。
          {candidates[1] && (
            <>
              次点は {candidates[1].label}（{candidates[1].score}）で、差は {top.score - candidates[1].score} 点です。
              {top.score - candidates[1].score < 8 &&
                "差が小さいため、スコアだけで決めず、下の懸念点を見て判断してください。"}
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] rounded-full border border-[var(--gda-ink-line)] bg-white/5 px-2.5 py-1">
            信頼度 {top.confidence} <Stars value={CONFIDENCE_STARS[top.confidence] ?? 2} />
          </span>
          <span className="text-[10.5px] rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300 px-2.5 py-1">
            最終判断には現地確認が必要
          </span>
        </div>
      </div>

      <div className="lg:hidden flex border-b border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)]">
        {(
          [
            ["list", "候補一覧"],
            ["map", "地図"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMobileView(key)}
            className={`flex-1 py-2.5 text-xs font-medium border-b-2 ${
              mobileView === key
                ? "border-[var(--gda-green)] text-[var(--gda-ink-text)]"
                : "border-transparent text-[var(--gda-ink-muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 p-3 sm:p-5">
        <div className={`${mobileView === "map" ? "block" : "hidden"} lg:block lg:col-span-3`}>
          <div className="relative map-dark rounded-xl overflow-hidden border border-[var(--gda-ink-line)] h-[300px] sm:h-[420px] lg:h-[520px]">
            <MapView
              center={focus?.lat != null ? [focus.lat, focus.lng as number] : projectCenter}
              zoom={12}
              basemap="satellite"
              globe={false}
              markers={shown
                .filter((c) => c.lat != null && c.lng != null)
                .map((c) => ({
                  lat: c.lat as number,
                  lng: c.lng as number,
                  label: `${c.rank}. ${c.label}（${c.score}点）`,
                  color: markerColor(c.score),
                }))}
            />
            <div className="absolute bottom-3 left-3 w-44 z-10">
              <Legend
                dark
                title="マップ凡例"
                entries={[
                  { key: "good", label: "高スコア（75点以上）", color: "#3f9f5e" },
                  { key: "watch", label: "中スコア（55〜74点）", color: "#c9a227" },
                  { key: "act", label: "低スコア（55点未満）", color: "#c0392b" },
                ]}
              />
            </div>
          </div>
        </div>

        <div className={`${mobileView === "list" ? "block" : "hidden"} lg:block lg:col-span-2 space-y-2.5`}>
          <div className="text-sm font-medium">現地調査の優先候補</div>
          {shown.map((c) => {
            const basis = (c.evidence_basis ?? "").split(",");
            return (
              <div key={c.id}>
                <RankCard
                  dark
                  rank={c.rank}
                  title={c.label}
                  subtitle={c.lat != null ? `${c.lat.toFixed(4)}, ${c.lng?.toFixed(4)}` : undefined}
                  score={c.score}
                  tone={tone(c.score)}
                  onClick={() => setSelected(selected === c.id ? null : c.id)}
                  reasons={atLeast("business") ? reasonsFor(c) : []}
                  facts={
                    atLeast("business")
                      ? [
                          { label: "AlphaEarth 類似度", value: c.alphaearth_similarity.toFixed(2), emphasis: true },
                          {
                            label: `NDRE 変化${c.ndre_measured ? "（実測）" : "（推定）"}`,
                            value: `${c.ndre_change_pct}%`,
                            emphasis: Boolean(c.ndre_measured),
                          },
                          { label: "現地記録", value: `${c.field_records_count}件` },
                        ]
                      : []
                  }
                  evidence={
                    atLeast("business")
                      ? [
                          { label: "衛星推定", present: true },
                          { label: "現地確認済み", present: basis.some((b) => b.includes("現地確認済み")) },
                          { label: "専門家確認済み", present: basis.some((b) => b.includes("専門家")) },
                        ]
                      : []
                  }
                />
                {selected === c.id && <CandidateDetail c={c} mitigations={mitigations} expert={atLeast("expert")} />}
              </div>
            );
          })}
          {shown.length === 0 && (
            <div className="rounded-xl border border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)] px-4 py-8 text-center text-[11px] text-[var(--gda-ink-muted)]">
              この絞り込みに該当する候補地はありません。
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Link
              to={`/projects/${id}/report`}
              className="flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg border border-[var(--gda-ink-line)] bg-white/5 py-2.5 hover:bg-white/10"
            >
              <Scale size={14} /> 候補を比較
            </Link>
            <Link
              to={`/projects/${id}/field`}
              className="flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] text-white py-2.5"
            >
              <CalendarPlus size={14} /> 調査計画に追加
            </Link>
          </div>
        </div>
      </div>

      {atLeast("business") && (
        <div className="px-3 sm:px-5 pb-4">
          <div className="rounded-xl border border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[760px]">
                <thead>
                  <tr className="border-b border-[var(--gda-ink-line)] text-[var(--gda-ink-muted)]">
                    <th className="text-left px-3 py-2.5 font-medium">候補</th>
                    <th className="text-left px-3 py-2.5 font-medium">
                      <Term id="ndre">環境変化</Term>
                      <div className="text-[9px] font-normal opacity-70">(NDRE変化)</div>
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium">
                      <Term id="similarity">類似度</Term>
                      <div className="text-[9px] font-normal opacity-70">(AlphaEarth)</div>
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium">
                      アクセス
                      <div className="text-[9px] font-normal opacity-70">(道路からの距離)</div>
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium">
                      信頼度
                      <div className="text-[9px] font-normal opacity-70">(総合)</div>
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium">根拠</th>
                    <th className="text-left px-3 py-2.5 font-medium">推奨アクション</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const basis = (c.evidence_basis ?? "").split(",");
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelected(c.id)}
                        className={`border-b border-[var(--gda-ink-line)]/60 last:border-0 cursor-pointer hover:bg-white/[0.03] ${
                          selected === c.id ? "bg-white/[0.05]" : ""
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-4 h-4 rounded text-[10px] font-bold text-white flex items-center justify-center"
                              style={{ background: markerColor(c.score) }}
                            >
                              {c.rank}
                            </span>
                            <span className="font-medium">{c.label}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {c.ndre_change_pct}%
                          <span
                            className={`ml-1.5 text-[9px] rounded px-1 py-0.5 border ${
                              c.ndre_measured
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                                : "border-[var(--gda-ink-line)] text-[var(--gda-ink-muted)]"
                            }`}
                          >
                            {c.ndre_measured ? "実測" : "推定"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{c.alphaearth_similarity.toFixed(2)}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {c.access_distance_km} km
                          <span className="ml-1.5 text-[var(--gda-ink-muted)]">{c.access_rating}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <Stars value={CONFIDENCE_STARS[c.confidence] ?? 2} />
                            <span>{c.confidence}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex gap-1">
                            {[
                              { label: "衛星", present: true },
                              { label: "現地", present: basis.some((b) => b.includes("現地確認済み")) },
                              { label: "専門家", present: basis.some((b) => b.includes("専門家")) },
                            ].map((e) => (
                              <span
                                key={e.label}
                                className={`text-[9.5px] rounded px-1.5 py-0.5 border ${
                                  e.present
                                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                                    : "border-[var(--gda-ink-line)] text-[var(--gda-ink-muted)] opacity-60"
                                }`}
                              >
                                {e.label}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-medium">{c.recommended_action}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-3 py-3 border-t border-[var(--gda-ink-line)] space-y-2.5">
              <SourceChips
                dark
                sources={[
                  { id: "ae", label: "AlphaEarth", sub: "衛星ベースマップ", icon: "globe" },
                  { id: "s2", label: "Sentinel-2", sub: "衛星画像", icon: "satellite" },
                  {
                    id: "field",
                    label: "現地記録",
                    sub: `${candidates.reduce((s, c) => s + c.field_records_count, 0)}件`,
                    icon: "photo",
                  },
                ]}
              />
              <Hint tone="warn">
                <strong>この表の読み方。</strong>
                「環境変化(NDRE)」に<span className="mx-0.5 font-semibold">実測</span>と付いた行は Sentinel-2 の前年比の
                実測値、<span className="mx-0.5 font-semibold">推定</span>
                と付いた行は衛星データが取得できずシミュレーション値に落ちた行です。「類似度」も条件が揃えば実測値です。
                一方で生息地重複度・保護区域距離・アクセスは本MVPではシミュレーション値のままです。結果はAIによる推定であり、
                最終判断には現地確認が必要です。法令適合性・アセスメントの要否は所管行政庁と専門家に確認してください。
              </Hint>
            </div>
          </div>
        </div>
      )}

      {atLeast("expert") && snapshot && (
        <div className="px-3 sm:px-5 pb-6">
          <ReproductionInfo snapshot={snapshot} dark />
        </div>
      )}
    </div>
  );
}

/** The expanded panel under a selected candidate: reading, then mitigations. */
function CandidateDetail({ c, mitigations, expert }: { c: Candidate; mitigations: Mitigation[]; expert: boolean }) {
  const reading = readCandidate(c);
  const mine = mitigations.filter((m) => m.candidate_id === c.id).sort((a, b) => a.priority - b.priority);

  return (
    <div className="mt-1.5 rounded-xl border border-[var(--gda-ink-line)] bg-[var(--gda-ink-3)] p-3 space-y-2.5">
      {reading.pros.length > 0 && (
        <div className="flex gap-1.5 text-[10.5px] leading-relaxed">
          <ThumbsUp size={12} className="shrink-0 mt-0.5 text-emerald-400" />
          <div>{reading.pros.join("／")}</div>
        </div>
      )}
      {reading.cons.length > 0 && (
        <div className="flex gap-1.5 text-[10.5px] leading-relaxed">
          <TriangleAlert size={12} className="shrink-0 mt-0.5 text-amber-400" />
          <div>{reading.cons.join("／")}</div>
        </div>
      )}
      <div className="flex gap-1.5 text-[10.5px] leading-relaxed text-[var(--gda-ink-muted)]">
        <HelpCircle size={12} className="shrink-0 mt-0.5" />
        <div>{reading.unknowns.join("／")}</div>
      </div>

      {expert && (c.ndvi != null || c.ndre != null) && (
        <div className="rounded-lg bg-black/25 p-2 text-[10px] font-mono space-y-0.5">
          <div className="font-sans text-[var(--gda-ink-muted)]">Sentinel-2 実測値（年次中央値合成）</div>
          <div>
            NDVI {c.ndvi?.toFixed(3) ?? "—"} ／ NDRE {c.ndre?.toFixed(3) ?? "—"}
          </div>
          <div>
            NDMI {c.ndmi?.toFixed(3) ?? "—"} ／ NBR {c.nbr?.toFixed(3) ?? "—"}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] text-[var(--gda-ink-muted)] mb-1">
          ミティゲーション案（回避 → 低減 → 回復 → オフセットの順）
        </div>
        <div className="space-y-1.5">
          {mine.map((m) => (
            <div key={m.id} className="text-[10.5px] leading-relaxed">
              <span className="font-semibold text-white">
                {m.priority}. [{STAGE_LABEL[m.hierarchy_stage]}]
              </span>{" "}
              {m.description}
              <span className="text-[var(--gda-ink-muted)]"> （コスト影響: {m.cost_impact}）</span>
            </div>
          ))}
          {mine.length === 0 && (
            <div className="text-[10.5px] text-[var(--gda-ink-muted)]">この候補の措置案はありません。</div>
          )}
        </div>
      </div>
    </div>
  );
}
