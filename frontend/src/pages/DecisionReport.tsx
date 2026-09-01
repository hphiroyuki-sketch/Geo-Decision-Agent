import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Link2, CheckCircle2, Clock } from "lucide-react";
import { api } from "../lib/api";

interface Report {
  id: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  summary: string | null;
  status: string;
  created_by_name: string;
  created_at: string;
}

interface Reviewer {
  id: string;
  name: string;
  title: string | null;
  status: string;
  decided_at: string | null;
}

interface Candidate {
  id: string;
  label: string;
  rank: number;
  score: number;
  evidence_basis: string;
  recommended_action: string;
}

export default function DecisionReport() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!id) return;
    const r = await api.get<{ report: Report | null; reviewers: Reviewer[] }>(`/projects/${id}/report`);
    setReport(r.report);
    setReviewers(r.reviewers);
    const c = await api.get<{ candidates: Candidate[] }>(`/projects/${id}/candidates`);
    setCandidates(c.candidates);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const createReport = async () => {
    if (!id) return;
    setCreating(true);
    try {
      const top = candidates[0];
      const summary = top
        ? `調査対象${candidates.length}地点のうち、${candidates.filter((c) => c.score < 60).length}地点で追加確認を推奨します。最優先候補は${top.label}（スコア${top.score}）です。`
        : "分析結果がまだありません。";
      await api.post(`/projects/${id}/report`, { title: "意思決定レポート", summary });
      await load();
    } finally {
      setCreating(false);
    }
  };

  const evidenceCounts = { satellite: 0, field: 0, expert: 0 };
  for (const c of candidates) {
    const bases = c.evidence_basis.split(",");
    if (bases.includes("衛星推定")) evidenceCounts.satellite++;
    if (bases.includes("現地確認済み")) evidenceCounts.field++;
    if (bases.includes("専門家確認済み")) evidenceCounts.expert++;
  }

  if (!report) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-sm mb-4">まだ意思決定レポートが作成されていません。</p>
          <button
            onClick={createReport}
            disabled={creating || candidates.length === 0}
            className="bg-[var(--gda-green)] text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-40"
          >
            {candidates.length === 0 ? "先に分析を実行してください" : creating ? "作成中..." : "レポートを作成"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto print:p-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 print:hidden">
        <h1 className="text-lg font-semibold text-slate-800">意思決定レポート</h1>
        <div className="flex gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-3 py-2"
          >
            <Link2 size={14} /> {copied ? "コピーしました" : "共有リンクを作成"}
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-xs font-medium bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] text-white rounded-lg px-3 py-2"
          >
            <Download size={14} /> PDFを書き出す
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          <div className="sm:col-span-2">
            <h2 className="text-xl font-semibold text-slate-800 mb-3">{report.title}</h2>
            <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 leading-relaxed">
              <div className="text-xs font-medium text-slate-500 mb-1">エグゼクティブサマリー</div>
              {report.summary}
            </div>
          </div>
          <div className="text-xs text-slate-500 space-y-1">
            <div>
              レポートID: <span className="text-slate-700 font-mono">{report.id}</span>
            </div>
            <div>作成日: {new Date(report.created_at).toLocaleDateString("ja-JP")}</div>
            <div>作成者: {report.created_by_name}</div>
            <div>ステータス: {report.status === "draft" ? "ドラフト" : report.status}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs font-medium text-slate-500 mb-3">根拠の状態</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>衛星推定</span>
              <span className="font-semibold">{evidenceCounts.satellite}件</span>
            </div>
            <div className="flex justify-between">
              <span>現地確認済み</span>
              <span className="font-semibold">{evidenceCounts.field}件</span>
            </div>
            <div className="flex justify-between">
              <span>専門家確認済み</span>
              <span className="font-semibold">{evidenceCounts.expert}件</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:col-span-2">
          <div className="text-xs font-medium text-slate-500 mb-3">推奨アクション</div>
          <div className="space-y-2">
            {candidates.slice(0, 3).map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>
                  {c.rank}. {c.label}
                </span>
                <span className="text-slate-500">{c.recommended_action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="text-xs font-medium text-slate-500 mb-3">レビュー担当者</div>
        <div className="space-y-2">
          {reviewers.length === 0 && <div className="text-xs text-slate-400">レビュアーはまだ設定されていません。</div>}
          {reviewers.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <div>
                <span className="font-medium">{r.name}</span>
                {r.title && <span className="text-slate-400 ml-2 text-xs">{r.title}</span>}
              </div>
              <span
                className={`text-xs flex items-center gap-1 font-medium ${
                  r.status === "approved" ? "text-green-700" : "text-slate-400"
                }`}
              >
                {r.status === "approved" ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                {r.status === "approved" ? "承認済み" : "確認待ち"}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
          このレポートにはAIによる推定が含まれます。データ: シミュレーション衛星データ / 現地記録
        </div>
      </div>
    </div>
  );
}
