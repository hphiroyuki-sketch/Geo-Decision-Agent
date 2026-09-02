import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Section 9 of the requirements ("意思決定出力仕様") asks for the same analysis
 * to be shown three ways, differing in what comes first:
 *
 *   かんたん   … what was found, what it means, what to check next
 *   ビジネス   … ranking, avoid/reduce recommendation, impact, cost, owner
 *   エキスパート … cell values, inputs, method, accuracy, reproduction info
 *
 * It is deliberately not three separate screens. The same page reorders and
 * reveals, so a specialist and a director can look at one link together and
 * neither is reading someone else's document.
 */
export type DisplayMode = "easy" | "business" | "expert";

export const DISPLAY_MODES: { id: DisplayMode; label: string; hint: string }[] = [
  { id: "easy", label: "かんたん", hint: "専門用語なし。何が分かったかと、次にすることだけを表示します。" },
  { id: "business", label: "ビジネス", hint: "優先順位・回避策・費用・期限・担当。事業判断に必要な形で表示します。" },
  { id: "expert", label: "エキスパート", hint: "指標の実測値・算出方法・適用範囲・再現情報まで表示します。" },
];

const STORAGE_KEY = "gda.displayMode";

interface Ctx {
  mode: DisplayMode;
  setMode: (m: DisplayMode) => void;
  /** True when the current mode is at least as detailed as `min`. */
  atLeast: (min: DisplayMode) => boolean;
}

const RANK: Record<DisplayMode, number> = { easy: 0, business: 1, expert: 2 };

const DisplayModeContext = createContext<Ctx>({
  mode: "business",
  setMode: () => {},
  atLeast: () => true,
});

export function DisplayModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DisplayMode>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === "easy" || saved === "business" || saved === "expert" ? saved : "business";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private browsing - the default is fine */
    }
  }, [mode]);

  return (
    <DisplayModeContext.Provider
      value={{ mode, setMode: setModeState, atLeast: (min) => RANK[mode] >= RANK[min] }}
    >
      {children}
    </DisplayModeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDisplayMode(): Ctx {
  return useContext(DisplayModeContext);
}
