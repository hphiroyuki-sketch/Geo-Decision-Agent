import { Check, AlertTriangle, X, ChevronRight } from "lucide-react";

/**
 * The ranked candidate card (V-02 / V-04).
 *
 * V-04's design carries an argument worth preserving: the reasons are a
 * checklist with three states, not prose. A candidate that scores 61 shows
 * exactly which criterion failed, so a reader can disagree with the ranking on
 * a specific point instead of dismissing the whole score.
 */
export type ReasonState = "ok" | "warn" | "bad";

export interface Reason {
  state: ReasonState;
  text: string;
}

export interface EvidenceChip {
  label: string;
  /** Present = this evidence exists; absent = shown greyed as "not yet". */
  present: boolean;
}

export interface RankCardProps {
  rank: number;
  title: string;
  subtitle?: string;
  score: number;
  scoreLabel?: string;
  tone: "good" | "watch" | "act";
  reasons?: Reason[];
  facts?: { label: string; value: string; emphasis?: boolean }[];
  factsTitle?: string;
  evidence?: EvidenceChip[];
  onClick?: () => void;
  dark?: boolean;
}

const TONE_BAR: Record<RankCardProps["tone"], string> = {
  good: "var(--gda-class-priority)",
  watch: "var(--gda-class-similar)",
  act: "var(--gda-class-changed)",
};

const REASON_ICON = { ok: Check, warn: AlertTriangle, bad: X };
const REASON_COLOR = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  bad: "text-rose-500",
};

export default function RankCard({
  rank,
  title,
  subtitle,
  score,
  scoreLabel = "総合スコア",
  tone,
  reasons = [],
  facts = [],
  factsTitle = "根拠データ",
  evidence = [],
  onClick,
  dark = false,
}: RankCardProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`w-full text-left rounded-xl border overflow-hidden transition-colors ${
        dark
          ? "border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)] hover:border-slate-500"
          : "border-slate-200 bg-white hover:border-slate-300 shadow-sm"
      }`}
    >
      <div className="flex">
        <span className="w-1 shrink-0" style={{ background: TONE_BAR[tone] }} aria-hidden />
        <div className="flex-1 min-w-0 p-3">
          <div className="flex items-start gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-5 h-5 rounded text-[11px] font-bold text-white flex items-center justify-center shrink-0"
                style={{ background: TONE_BAR[tone] }}
              >
                {rank}
              </span>
              <div className="min-w-0">
                <div className={`text-sm font-semibold truncate ${dark ? "text-[var(--gda-ink-text)]" : "text-slate-800"}`}>
                  {title}
                </div>
                {subtitle && (
                  <div className={`text-[10px] truncate ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-400"}`}>
                    {subtitle}
                  </div>
                )}
              </div>
            </div>
            <div className="ml-auto text-right shrink-0">
              <div className={`text-[9.5px] ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-400"}`}>{scoreLabel}</div>
              <div className="text-xl font-bold leading-none" style={{ color: TONE_BAR[tone] }}>
                {score}
                <span className={`text-[10px] font-normal ml-0.5 ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-400"}`}>
                  点
                </span>
              </div>
            </div>
            {onClick && <ChevronRight size={14} className={dark ? "text-[var(--gda-ink-muted)]" : "text-slate-300"} />}
          </div>

          {(reasons.length > 0 || facts.length > 0) && (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
              {reasons.length > 0 && (
                <div>
                  <div className={`text-[9.5px] mb-1 ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-400"}`}>
                    選定理由
                  </div>
                  <ul className="space-y-0.5">
                    {reasons.map((r, i) => {
                      const Icon = REASON_ICON[r.state];
                      return (
                        <li key={i} className="flex items-start gap-1.5">
                          <Icon size={11} className={`${REASON_COLOR[r.state]} shrink-0 mt-[2px]`} strokeWidth={2.5} />
                          <span
                            className={`text-[10.5px] leading-snug ${dark ? "text-[var(--gda-ink-text)]" : "text-slate-600"}`}
                          >
                            {r.text}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {facts.length > 0 && (
                <div>
                  <div className={`text-[9.5px] mb-1 ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-400"}`}>
                    {factsTitle}
                  </div>
                  <div className="space-y-0.5">
                    {facts.map((f) => (
                      <div key={f.label} className="flex items-baseline justify-between gap-2">
                        <span className={`text-[10.5px] ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-500"}`}>
                          {f.label}
                        </span>
                        <span
                          className={`text-[10.5px] tabular-nums ${
                            f.emphasis ? "font-semibold" : ""
                          } ${dark ? "text-[var(--gda-ink-text)]" : "text-slate-700"}`}
                        >
                          {f.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {evidence.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {evidence.map((e) => (
                <span
                  key={e.label}
                  className={`text-[9.5px] rounded px-1.5 py-0.5 border ${
                    e.present
                      ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40"
                      : dark
                        ? "border-[var(--gda-ink-line)] text-[var(--gda-ink-muted)] opacity-60"
                        : "border-slate-200 text-slate-400"
                  }`}
                  title={e.present ? `${e.label}：あり` : `${e.label}：まだありません`}
                >
                  {e.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
