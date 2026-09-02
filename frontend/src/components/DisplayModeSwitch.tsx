import { useState } from "react";
import { Eye } from "lucide-react";
import { DISPLAY_MODES, useDisplayMode } from "../lib/displayMode";

/** The 9章 audience switch. Compact enough to live in the header on a phone. */
export default function DisplayModeSwitch({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useDisplayMode();
  const [showHint, setShowHint] = useState(false);
  const active = DISPLAY_MODES.find((m) => m.id === mode);

  return (
    <div className="relative">
      <div
        className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5"
        onMouseEnter={() => setShowHint(true)}
        onMouseLeave={() => setShowHint(false)}
      >
        {!compact && <Eye size={12} className="text-slate-400 ml-1.5 mr-0.5" />}
        {DISPLAY_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            title={m.hint}
            className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
              mode === m.id ? "bg-white text-slate-800 shadow-sm font-medium" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {showHint && active && (
        <div className="absolute right-0 top-full mt-1 z-30 w-60 bg-slate-800 text-white text-[11px] leading-snug rounded-lg px-2.5 py-2 shadow-lg">
          {active.hint}
        </div>
      )}
    </div>
  );
}
