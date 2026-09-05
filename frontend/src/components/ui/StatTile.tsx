import type { LucideIcon } from "lucide-react";

/** The three-up counters on the portfolio home (V-01). */
export default function StatTile({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: "info" | "warn" | "done";
  onClick?: () => void;
}) {
  const accent = tone === "warn" ? "#c9a227" : tone === "done" ? "#2563eb" : "#1f7a4d";
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className="w-full bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-3 sm:px-4 text-center relative overflow-hidden"
    >
      <Icon size={18} className="mx-auto mb-1" style={{ color: accent }} />
      <div className="text-[10.5px] sm:text-[11px] text-slate-500">{label}</div>
      <div className="text-2xl sm:text-3xl font-semibold text-slate-800 leading-tight tabular-nums">{value}</div>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-2/3 rounded-t" style={{ background: accent }} />
    </Wrapper>
  );
}
