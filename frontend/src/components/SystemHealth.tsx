import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Hint } from "./Explain";

interface CheckRow {
  check_name: string;
  ok: number;
  message: string | null;
  detail: string | null;
  duration_ms: number | null;
  checked_at: string;
}

const CHECK_LABEL: Record<string, { label: string; why: string }> = {
  ee_secret: {
    label: "Earth Engine 認証情報",
    why: "サービスアカウント鍵がWorkerに設定されているか。未設定だと衛星データを一切取得できません。",
  },
  ee_embedding: {
    label: "衛星エンベディング取得",
    why: "10mメッシュ解析と類似度判定の土台。これが失敗すると分析はシミュレーション値に切り替わります。",
  },
  ee_indices: {
    label: "植生指数（NDVI等）取得",
    why: "植生の状態把握とレポートの材料。失敗しても他の機能は動作します。",
  },
  ee_algorithms: {
    label: "Earth Engine 関数一覧",
    why: "クエリの関数名が正しいかを照合するための参照情報です（手動実行時のみ取得）。",
  },
};

/**
 * Shows whether the satellite integration is working right now.
 *
 * The analysis path falls back to simulated values whenever Earth Engine
 * fails, which keeps the product usable but hides an outage completely - the
 * numbers keep appearing, just without the data behind them. This panel is how
 * an operator finds out, rather than discovering it in a report.
 */
export default function SystemHealth() {
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<{ checks: CheckRow[] }>("/alerts/system-checks");
    setChecks(res.checks);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      await api.post("/alerts/system-checks/run", {});
      await load();
    } finally {
      setRunning(false);
    }
  };

  const failing = checks.filter((c) => !c.ok);

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
            <Activity size={15} className="text-slate-400" /> 衛星データ連携の稼働状況
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">5分ごとに自動確認しています。</p>
        </div>
        <button
          onClick={runNow}
          disabled={running}
          className="flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-3 py-2"
        >
          <RefreshCw size={13} className={running ? "animate-spin" : ""} />
          {running ? "確認中..." : "今すぐ確認"}
        </button>
      </div>

      <div className="p-4 space-y-3">
        {failing.length > 0 && (
          <Hint tone="warn">
            <strong>{failing.length} 件の確認が失敗しています。</strong>
            分析画面は自動的にシミュレーション値へ切り替わるため、エラーは表示されません。
            結果の <code>evidenceBasis</code> が「衛星推定」になっている場合は、ここが原因です。
          </Hint>
        )}

        {loaded && checks.length === 0 && (
          <div className="text-xs text-slate-500">
            まだ確認結果がありません。「今すぐ確認」を押すか、次回の自動確認（5分ごと）をお待ちください。
          </div>
        )}

        {checks.map((c) => {
          const meta = CHECK_LABEL[c.check_name] ?? { label: c.check_name, why: "" };
          return (
            <div key={c.check_name} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                {c.ok ? (
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-800">{meta.label}</div>
                  {meta.why && <div className="text-[11px] text-slate-500 mt-0.5">{meta.why}</div>}
                  <div
                    className={`text-[11px] mt-1 break-words ${c.ok ? "text-slate-600" : "text-rose-700"}`}
                  >
                    {c.message}
                  </div>
                  {c.detail && (
                    <details className="mt-1">
                      <summary className="text-[10px] text-slate-400 cursor-pointer">詳細</summary>
                      <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all mt-1">{c.detail}</pre>
                    </details>
                  )}
                  <div className="text-[10px] text-slate-400 mt-1">
                    {new Date(c.checked_at).toLocaleString("ja-JP")}
                    {c.duration_ms != null && ` ・ ${c.duration_ms}ms`}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
