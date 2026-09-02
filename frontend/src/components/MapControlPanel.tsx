import { useState } from "react";
import { Layers, Satellite, Grid3x3, Mountain, Box, History } from "lucide-react";
import { IMAGERY_EPOCHS, type Basemap, type MeshColorMode, type MeshHeightMode } from "./MapView";

export interface MapControlState {
  basemap: Basemap;
  imageryEpoch: string;
  imageryOpacity: number;
  meshVisible: boolean;
  meshOpacity: number;
  meshColorMode: MeshColorMode;
  meshHeightMode: MeshHeightMode;
  gridVisible: boolean;
  labelsVisible: boolean;
  terrain3d: boolean;
  exaggeration: number;
}

export const DEFAULT_MAP_CONTROLS: MapControlState = {
  basemap: "satellite",
  imageryEpoch: "current",
  imageryOpacity: 1,
  meshVisible: true,
  meshOpacity: 0.6,
  meshColorMode: "class",
  meshHeightMode: "flat",
  gridVisible: true,
  labelsVisible: true,
  terrain3d: false,
  exaggeration: 1.5,
};

interface Props {
  value: MapControlState;
  onChange: (next: MapControlState) => void;
  /** Mesh colouring and 3D column controls only make sense where a mesh exists. */
  showMeshDetail?: boolean;
  hasMesh?: boolean;
  defaultOpen?: boolean;
}

/**
 * The map's controls, shared by every screen that shows one.
 *
 * The time slider is the part that carries the product's argument: a number
 * saying vegetation fell is an assertion, while the same hillside photographed
 * in 1975 and today is something the viewer concludes themselves. Fading the
 * photo against the street map underneath is the same idea - it answers "what
 * is that, actually?" without leaving the view.
 */
export default function MapControlPanel({
  value,
  onChange,
  showMeshDetail = false,
  hasMesh = false,
  defaultOpen = true,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const set = (patch: Partial<MapControlState>) => onChange({ ...value, ...patch });

  const epochIndex = Math.max(
    0,
    IMAGERY_EPOCHS.findIndex((e) => e.id === value.imageryEpoch),
  );
  const epoch = IMAGERY_EPOCHS[epochIndex];
  const imagery = value.basemap === "satellite";

  return (
    <div className="bg-white/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <Layers size={13} /> 表示
        </span>
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex gap-1">
            <button
              onClick={() => set({ basemap: "satellite" })}
              className={`flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg border ${
                imagery ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              <Satellite size={11} /> 航空写真
            </button>
            <button
              onClick={() => set({ basemap: "streets" })}
              className={`flex-1 text-[11px] py-1.5 rounded-lg border ${
                !imagery ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              地図
            </button>
          </div>

          {imagery && (
            <div className="border-t border-slate-100 pt-2.5">
              <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                <span className="flex items-center gap-1.5 font-medium">
                  <History size={12} /> 撮影年代
                </span>
                <span className="text-slate-800 font-semibold">{epoch.period}</span>
              </div>
              <input
                type="range"
                min={0}
                max={IMAGERY_EPOCHS.length - 1}
                step={1}
                value={epochIndex}
                onChange={(e) => set({ imageryEpoch: IMAGERY_EPOCHS[Number(e.target.value)].id })}
                className="w-full accent-[var(--gda-green)]"
              />
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>最新</span>
                <span>1945年</span>
              </div>
              {epoch.note && <p className="text-[10px] text-slate-400 mt-1 leading-snug">{epoch.note}</p>}
              {epochIndex > 0 && (
                <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                  同じ場所を過去と見比べると、森林の減少・伐採・造成が目で確認できます。写真が真っ白な場合、その年代はこの場所を撮影していません。
                </p>
              )}

              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>写真の濃さ</span>
                  <span>{Math.round(value.imageryOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.imageryOpacity}
                  onChange={(e) => set({ imageryOpacity: Number(e.target.value) })}
                  className="w-full accent-[var(--gda-green)]"
                />
                <p className="text-[10px] text-slate-400 leading-snug">
                  下げると下の地図（道路・地名）が透けて、写真に写っているものが何かを確認できます。
                </p>
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 pt-2.5 space-y-2">
            <label className="flex items-center justify-between text-[11px] font-medium text-slate-700">
              <span className="flex items-center gap-1.5">
                <Mountain size={12} /> 3D地形表示
              </span>
              <input
                type="checkbox"
                checked={value.terrain3d}
                onChange={(e) => set({ terrain3d: e.target.checked })}
              />
            </label>
            {value.terrain3d && (
              <div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>起伏の強調</span>
                  <span>×{value.exaggeration.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={value.exaggeration}
                  onChange={(e) => set({ exaggeration: Number(e.target.value) })}
                  className="w-full accent-[var(--gda-green)]"
                />
                <p className="text-[10px] text-slate-400 leading-snug">
                  2本指ドラッグ（PCは右ドラッグ／Ctrl+ドラッグ）で視点を傾け・回転できます。標高データは約30m解像度のため、尾根・谷の把握には十分ですが、10mマス1つ分の起伏までは再現されません。
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-2.5 space-y-2">
            <label className="flex items-center justify-between text-[11px] font-medium text-slate-700">
              <span className="flex items-center gap-1.5">
                <Grid3x3 size={12} /> 10mメッシュ
              </span>
              <input
                type="checkbox"
                checked={value.meshVisible}
                disabled={!hasMesh}
                onChange={(e) => set({ meshVisible: e.target.checked })}
              />
            </label>
            {!hasMesh && (
              <p className="text-[10px] text-slate-400 leading-snug">
                この対象地にはまだメッシュ解析結果がありません。
              </p>
            )}

            {hasMesh && (
              <>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.meshOpacity}
                  onChange={(e) => set({ meshOpacity: Number(e.target.value) })}
                  className="w-full accent-[var(--gda-green)]"
                />
                {showMeshDetail && (
                  <>
                    <div>
                      <div className="text-[11px] text-slate-500 mb-1">マスの色分け</div>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            ["class", "判定"],
                            ["similarity", "類似度"],
                            ["change", "変化"],
                          ] as [MeshColorMode, string][]
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            onClick={() => set({ meshColorMode: mode })}
                            className={`text-[11px] py-1 rounded-lg border ${
                              value.meshColorMode === mode
                                ? "bg-[var(--gda-green)] text-white border-[var(--gda-green)]"
                                : "bg-white text-slate-600 border-slate-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
                        <Box size={11} /> マスの高さ
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            ["flat", "平面"],
                            ["similarity", "類似度"],
                            ["change", "変化"],
                          ] as [MeshHeightMode, string][]
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            onClick={() =>
                              set({ meshHeightMode: mode, terrain3d: mode !== "flat" ? true : value.terrain3d })
                            }
                            className={`text-[11px] py-1 rounded-lg border ${
                              value.meshHeightMode === mode
                                ? "bg-slate-900 text-white border-slate-900"
                                : "bg-white text-slate-600 border-slate-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {value.meshHeightMode !== "flat" && (
                        <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                          柱の高さ＝
                          {value.meshHeightMode === "similarity"
                            ? "類似度（高いほど確認済み生息地に近い）"
                            : "変化スコア（高いほど前年から変化）"}
                          。表示用に強調しており、実際の標高ではありません。
                        </p>
                      )}
                    </div>
                  </>
                )}
                <label className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>マスの境界線</span>
                  <input
                    type="checkbox"
                    checked={value.gridVisible}
                    onChange={(e) => set({ gridVisible: e.target.checked })}
                  />
                </label>
              </>
            )}
            <label className="flex items-center justify-between text-[11px] text-slate-600">
              <span>地名ラベル</span>
              <input
                type="checkbox"
                checked={value.labelsVisible}
                onChange={(e) => set({ labelsVisible: e.target.checked })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
