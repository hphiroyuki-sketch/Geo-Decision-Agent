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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1 border-b border-slate-50 last:border-0">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-700 text-right font-mono text-[10px] break-all">{value}</span>
    </div>
  );
}

export default function ReproductionInfo({ snapshot }: { snapshot: AnalysisSnapshot }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-2">
        <FlaskConical size={13} /> 再現情報
      </div>
      <p className="text-[11px] text-slate-500 leading-snug mb-2">
        この結果を後から検証・再実行するための記録です。同じ分析IDとスナップショットであれば、同じ数値が再現されます。
      </p>
      <div className="text-[11px]">
        <Row label="分析ID" value={snapshot.id} />
        <Row label="実行日時" value={new Date(snapshot.executed_at).toLocaleString("ja-JP")} />
        <Row label="実行者" value={snapshot.run_by_name ?? "—"} />
        <Row label="対話モデル" value={snapshot.model} />
        <Row label="プロンプト版" value={snapshot.prompt_version} />
        <Row label="判定ロジック版" value={snapshot.engine_version} />
        <Row label="衛星データ年" value={snapshot.earth_engine_year ? `${snapshot.earth_engine_year}年` : "—"} />
        <Row label="埋め込みデータセット" value={snapshot.embedding_dataset ?? "—"} />
        <Row label="指標データセット" value={snapshot.indices_dataset ?? "—"} />
        <Row
          label="Earth Engine接続"
          value={snapshot.earth_engine_available ? "接続あり（実データ）" : "未接続（シミュレーション）"}
        />
        <Row label="基準地点数" value={`${snapshot.reference_points}地点（現地確認済み記録）`} />
      </div>
    </div>
  );
}
