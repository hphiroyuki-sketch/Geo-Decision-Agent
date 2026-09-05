import { ChevronUp, Layers } from "lucide-react";

/**
 * The layer rail from V-03: each layer is a checkbox, a swatch, and its own
 * opacity. One global opacity is not enough - the reason to fade the mesh is to
 * see the imagery under it, which means the two have to move independently.
 */
export interface LayerSpec {
  id: string;
  label: string;
  /** A colour chip, a gradient, or an image thumbnail standing for the layer. */
  swatch: string;
  visible: boolean;
  opacity: number;
  /** Layers with no opacity of their own (point overlays) hide the slider. */
  fixedOpacity?: boolean;
  hint?: string;
}

interface Props {
  layers: LayerSpec[];
  onChange: (id: string, patch: Partial<LayerSpec>) => void;
  open: boolean;
  onToggleOpen: () => void;
}

export default function LayerRail({ layers, onChange, open, onToggleOpen }: Props) {
  return (
    <div className="rounded-xl border border-[var(--gda-ink-line)] bg-[rgba(11,22,34,0.86)] backdrop-blur-md shadow-xl overflow-hidden">
      <button
        onClick={onToggleOpen}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[var(--gda-ink-text)]"
      >
        <span className="flex items-center gap-1.5">
          <Layers size={13} /> レイヤー
        </span>
        <ChevronUp size={14} className={`transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          {layers.map((l) => (
            <div key={l.id}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={l.visible}
                  onChange={(e) => onChange(l.id, { visible: e.target.checked })}
                  className="accent-[var(--gda-green)] w-3.5 h-3.5 shrink-0"
                />
                <span
                  className="w-6 h-6 rounded-md shrink-0 border border-white/15 bg-cover bg-center"
                  style={{ background: l.swatch }}
                  aria-hidden
                />
                <span className="text-[11px] text-[var(--gda-ink-text)] flex-1 min-w-0 truncate">{l.label}</span>
                <span className="text-[10px] text-[var(--gda-ink-muted)] tabular-nums shrink-0">
                  {l.fixedOpacity ? "" : `${Math.round(l.opacity * 100)}%`}
                </span>
              </label>
              {!l.fixedOpacity && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={l.opacity}
                  disabled={!l.visible}
                  onChange={(e) => onChange(l.id, { opacity: Number(e.target.value) })}
                  aria-label={`${l.label} の不透明度`}
                  className="range-dark w-full mt-1 disabled:opacity-40"
                />
              )}
              {l.hint && <p className="text-[9.5px] text-[var(--gda-ink-muted)] leading-snug mt-0.5">{l.hint}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
