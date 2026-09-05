import { FlaskConical } from "lucide-react";

/**
 * Output block 8 of section 9, and the thing NFR-010 / UAT-08 actually ask for:
 * an analysis you can come back to in six months and re-run.
 *
 * A score with no snapshot behind it is an opinion with a number on it. This
 * block names the model, the rule version, the satellite year and the datasets,
 * so a reviewer can tell whether two differing answers disagree or were simply
 * computed from different ground.
 */
export interface AnalysisSnapshot {
  id: string;
  purpose: string | null;
  candidate_count: number;
  model: string;
  prompt_version: string;
  engine_version: string;
  earth_engine_year: number | null;
  embedding_dataset: string | null;
  indices_dataset: string | null;
  earth_engine_available: number;
  reference_points: number;
  executed_at: string;
  run_by_name: string | null;
}

function Row({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 border-b last:border-0 ${dark ? "border-white/5" : "border-slate-50"}`}>
      <span className={`shrink-0 ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-500"}`}>{label}</span>
      <span
        className={`text-right font-mono text-[10px] break-all ${dark ? "text-[var(--gda-ink-text)]" : "text-slate-700"}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function ReproductionInfo({ snapshot, dark = false }: { snapshot: AnalysisSnapshot; dark?: boolean }) {
  const R = (props: { label: string; value: string }) => <Row {...props} dark={dark} />;
  return (
    <div
      className={`rounded-xl border p-4 ${
        dark ? "border-[var(--gda-ink-line)] bg-[var(--gda-ink-2)]" : "bg-white border-slate-200 shadow-sm"
      }`}
    >
      <div
        className={`flex items-center gap-1.5 text-xs font-medium mb-2 ${
          dark ? "text-[var(--gda-ink-text)]" : "text-slate-600"
        }`}
      >
        <FlaskConical size={13} /> 再現情報
      </div>
      <p className={`text-[11px] leading-snug mb-2 ${dark ? "text-[var(--gda-ink-muted)]" : "text-slate-500"}`}>
        この結果を後から検証・再実行するための記録です。同じ分析IDとスナップショットであれば、同じ数値が再現されます。
      </p>
      <div className="text-[11px]">
        <R label="分析ID" value={snapshot.id} />
        <R label="実行日時" value={new Date(snapshot.executed_at).toLocaleString("ja-JP")} />
        <R label="実行者" value={snapshot.run_by_name ?? "—"} />
        <R label="対話モデル" value={snapshot.model} />
        <R label="プロンプト版" value={snapshot.prompt_version} />
        <R label="判定ロジック版" value={snapshot.engine_version} />
        <R label="衛星データ年" value={snapshot.earth_engine_year ? `${snapshot.earth_engine_year}年` : "—"} />
        <R label="埋め込みデータセット" value={snapshot.embedding_dataset ?? "—"} />
        <R label="指標データセット" value={snapshot.indices_dataset ?? "—"} />
        <R
          label="Earth Engine接続"
          value={snapshot.earth_engine_available ? "接続あり（実データ）" : "未接続（シミュレーション）"}
        />
        <R label="基準地点数" value={`${snapshot.reference_points}地点（現地確認済み記録）`} />
      </div>
    </div>
  );
}
