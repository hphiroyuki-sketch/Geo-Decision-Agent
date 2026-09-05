import { Check, Loader2, AlertTriangle } from "lucide-react";

/**
 * The agent's plan, shown as it executes (V-02 / V-03).
 *
 * The point is not decoration. A user who asked a question in their own words
 * needs to see how it was turned into conditions before they trust the answer -
 * the requirements call this 意図構造化 (FR-002) and 分析計画の提示. Showing the
 * steps also makes it obvious which step a wrong answer came from.
 */
export type StepStatus = "done" | "running" | "waiting" | "failed";

export interface AgentStep {
  label: string;
  detail?: string;
  status: StepStatus;
}

const STATUS_TEXT: Record<StepStatus, string> = {
  done: "完了",
  running: "実行中",
  waiting: "待機中",
  failed: "失敗",
};

export default function AgentSteps({ steps, dark = false }: { steps: AgentStep[]; dark?: boolean }) {
  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={`${step.label}-${i}`} className="relative flex gap-2.5 pb-3 last:pb-0">
            {!last && (
              <span
                className={`absolute left-[9px] top-5 bottom-0 w-px ${dark ? "bg-[var(--gda-ink-line)]" : "bg-slate-200"}`}
              />
            )}
            <span
              className={`relative z-10 w-[19px] h-[19px] rounded-full flex items-center justify-center shrink-0 mt-0.5 border ${
                step.status === "done"
                  ? "bg-[var(--gda-green)] border-[var(--gda-green)] text-white"
                  : step.status === "running"
                    ? dark
                      ? "border-sky-400 text-sky-400 bg-transparent"
                      : "border-[var(--gda-green)] text-[var(--gda-green)] bg-white"
                    : step.status === "failed"
                      ? "bg-rose-500 border-rose-500 text-white"
                      : dark
                        ? "border-[var(--gda-ink-line)] text-[var(--gda-ink-muted)] bg-transparent"
                        : "border-slate-300 text-slate-400 bg-white"
              }`}
            >
              {step.status === "done" ? (
                <Check size={11} strokeWidth={3} />
              ) : step.status === "running" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : step.status === "failed" ? (
                <AlertTriangle size={10} />
              ) : (
                <span className="text-[9px] font-semibold">{i + 1}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-xs font-medium leading-snug ${
                    dark
                      ? step.status === "waiting"
                        ? "text-[var(--gda-ink-muted)]"
                        : "text-[var(--gda-ink-text)]"
                      : step.status === "waiting"
                        ? "text-slate-400"
                        : "text-slate-800"
                  }`}
                >
                  {i + 1}. {step.label}
                </span>
                <span
                  className={`text-[10px] shrink-0 ${
                    step.status === "done"
                      ? "text-[var(--gda-green)]"
                      : step.status === "running"
                        ? dark
                          ? "text-sky-400"
                          : "text-[var(--gda-green)]"
                        : step.status === "failed"
                          ? "text-rose-500"
                          : dark
                            ? "text-[var(--gda-ink-muted)]"
                            : "text-slate-400"
                  }`}
                >
                  {STATUS_TEXT[step.status]}
                </span>
              </div>
              {step.detail && (
                <div className={`text-[10.5px] leading-snug mt-0.5 ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-500"}`}>
                  {step.detail}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
