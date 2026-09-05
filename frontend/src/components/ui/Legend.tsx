/**
 * The legend (V-03 / V-04).
 *
 * NFR-006 forbids carrying meaning in colour alone, so every entry pairs its
 * swatch with words - which is also what makes the map readable to someone who
 * has never seen it before.
 */
export interface LegendEntry {
  key: string;
  label: string;
  color?: string;
  /** "outline" draws a border-only chip (boundaries), "grid" a hatch. */
  shape?: "fill" | "outline" | "dot" | "grid";
}

export default function Legend({
  entries,
  dark = false,
  title = "凡例",
}: {
  entries: LegendEntry[];
  dark?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`rounded-xl shadow-xl overflow-hidden ${
        dark
          ? "border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] backdrop-blur-md"
          : "border border-slate-200 bg-white/95 backdrop-blur"
      }`}
    >
      <div className={`px-3 pt-2 pb-1 text-xs font-semibold ${dark ? "text-[var(--gda-ink-text)]" : "text-slate-700"}`}>
        {title}
      </div>
      <div className="px-3 pb-2.5 space-y-1">
        {entries.map((e) => (
          <div key={e.key} className="flex items-center gap-2">
            <span
              className={`w-3.5 h-3.5 shrink-0 ${e.shape === "dot" ? "rounded-full" : "rounded-[3px]"}`}
              style={
                e.shape === "outline"
                  ? { border: `1.5px solid ${e.color ?? "#fff"}` }
                  : e.shape === "grid"
                    ? {
                        backgroundImage: `linear-gradient(${e.color ?? "#fff"} 1px, transparent 1px), linear-gradient(90deg, ${e.color ?? "#fff"} 1px, transparent 1px)`,
                        backgroundSize: "4px 4px",
                        border: `1px solid ${e.color ?? "#fff"}`,
                      }
                    : e.shape === "dot"
                      ? { border: `2px solid ${e.color ?? "#fff"}` }
                      : { background: e.color }
              }
              aria-hidden
            />
            <span className={`text-[11px] ${dark ? "text-[var(--gda-ink-text)]" : "text-slate-600"}`}>{e.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
