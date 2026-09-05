import { Globe, Satellite, Mountain, TriangleAlert, Camera, Database } from "lucide-react";

/**
 * The 使用データ row (V-02 / V-03).
 *
 * FR-006 asks every claim to name its source. Putting the sources on the screen
 * itself, not only inside a report, is what stops a map from reading as an
 * opinion: the viewer can see what it was built from without asking.
 */
export interface Source {
  id: string;
  label: string;
  sub?: string;
  icon?: "satellite" | "globe" | "dem" | "hazard" | "photo" | "internal";
  /** Dimmed when the source did not actually contribute to this view. */
  active?: boolean;
}

const ICONS = {
  satellite: Satellite,
  globe: Globe,
  dem: Mountain,
  hazard: TriangleAlert,
  photo: Camera,
  internal: Database,
};

export default function SourceChips({
  sources,
  dark = false,
  label = "使用データ",
}: {
  sources: Source[];
  dark?: boolean;
  label?: string | null;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {label && (
        <span className={`text-[10px] shrink-0 ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-400"}`}>{label}</span>
      )}
      {sources.map((s) => {
        const Icon = ICONS[s.icon ?? "globe"];
        const off = s.active === false;
        return (
          <span
            key={s.id}
            title={off ? `${s.label}（このビューでは未使用）` : s.label}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] leading-none ${
              dark
                ? off
                  ? "border-[var(--gda-ink-line)] text-[var(--gda-ink-muted)] opacity-50"
                  : "border-[var(--gda-ink-line)] bg-white/5 text-[var(--gda-ink-text)]"
                : off
                  ? "border-slate-200 text-slate-400 bg-white opacity-60"
                  : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <Icon size={11} className="shrink-0 opacity-80" />
            <span className="font-medium">{s.label}</span>
            {s.sub && <span className={dark ? "text-[var(--gda-ink-muted)]" : "text-slate-400"}>{s.sub}</span>}
          </span>
        );
      })}
    </div>
  );
}
