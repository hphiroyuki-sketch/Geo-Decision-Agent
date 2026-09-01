import { useState, type ReactNode } from "react";
import { HelpCircle, Info, Lightbulb, TriangleAlert } from "lucide-react";

/**
 * The product's readers are not remote-sensing specialists. A planning officer
 * has to defend a number to their manager, and an executive reads it once
 * before a decision - so every unfamiliar term carries its own explanation
 * where it appears, rather than in a manual nobody opens.
 */
export const GLOSSARY: Record<string, { term: string; plain: string; detail?: string }> = {
  embedding: {
    term: "衛星エンベディング",
    plain: "衛星が捉えた土地の特徴を64個の数値で表したもの。",
    detail:
      "Googleが Sentinel-1/2 等の年間観測をまとめて作った指紋のようなデータです。植生・地形・水分・人工物などの特徴が凝縮されており、2つの場所の数値を比べると「環境としてどれだけ似ているか」が測れます。",
  },
  similarity: {
    term: "類似度",
    plain: "確認済みの生息地と、その場所がどれだけ似ているか（-1〜1、1が最も似ている）。",
    detail:
      "現地で生きものを確認した地点の衛星エンベディングを基準とし、各セルとの近さを計算した値です。0.85以上を保全優先、0.70〜0.85を回復候補として扱います。基準地点の近くほど高く出やすい性質があるため、距離も併せて確認してください。",
  },
  change: {
    term: "変化スコア",
    plain: "前の年と比べて、その場所がどれだけ変わったか（0に近いほど変化なし）。",
    detail:
      "同じ場所の今年と前年の衛星エンベディングの差です。0.15以上を「大きな変化」として抽出します。ただし衛星は「変わったこと」しか分かりません。伐採なのか災害なのか季節差なのかは、現地確認でしか判別できません。",
  },
  compactness: {
    term: "連結度",
    plain: "区域がひとまとまりか、飛び地に分かれているか（1に近いほどまとまっている）。",
    detail:
      "同じ面積でも、生きものにとっては細切れの林より一続きの林のほうが価値があります。この値が低い区域は、分断の解消（回廊づくり）が有効な可能性があります。",
  },
  mitigation: {
    term: "ミティゲーション・ヒエラルキー",
    plain: "①回避 → ②低減 → ③回復 → ④オフセット の順で対策を検討する国際的な原則。",
    detail:
      "最初から代償（オフセット）に頼るのは認められません。まず「そこを避けられないか」を検討し、避けられない場合に影響を小さくし、それでも残る影響を回復・代償で埋める、という順序が求められます。",
  },
  leap: {
    term: "TNFD LEAPアプローチ",
    plain: "自然関連の情報開示で使う4段階の手順（発見・診断・評価・準備）。",
    detail:
      "Locate（自然との接点を特定）→ Evaluate（依存と影響を評価）→ Assess（リスクと機会を評価）→ Prepare（対応と開示を準備）。TNFD提言に沿った開示を行う際の標準的な進め方です。",
  },
  ndvi: {
    term: "NDVI（植生指数）",
    plain: "植物の茂り具合を示す指標（-1〜1、高いほど緑が濃い）。",
    detail:
      "健全な植物は近赤外線を強く反射し赤色光を吸収する性質を利用した指標です。0.6以上で樹林、0.2〜0.4で草地や疎らな植生、0.1以下で裸地・水面・人工物の目安になります。",
  },
  ndre: {
    term: "NDRE（レッドエッジ指数）",
    plain: "植物の活力・葉緑素量に敏感な指標。",
    detail: "NDVIが飽和しやすい密な樹林でも差が出るため、活力低下（衰弱・病虫害）の早期把握に向きます。",
  },
  ndmi: {
    term: "NDMI（水分指数）",
    plain: "植生の水分状態を示す指標。",
    detail: "乾燥ストレスや土壌水分の変化を捉えます。低下が続く区域は枯損や火災リスクの検討対象になります。",
  },
  nbr: {
    term: "NBR（正規化燃焼指数）",
    plain: "焼失・裸地化を捉える指標。",
    detail: "火災前後の差分（dNBR）で焼損程度を評価します。伐採跡地や崩壊地の把握にも使われます。",
  },
  evidence: {
    term: "根拠ステータス",
    plain: "その数値が実データか推定かの区別。",
    detail:
      "「Earth Engine実データ」は衛星から実際に取得した値、「現地確認済み」は査読された現地記録に裏付けられた値、「衛星推定」はデータが揃わない場合の推定値です。判断の重みが変わるため、必ず確認してください。",
  },
  referenceDistance: {
    term: "基準地点までの距離",
    plain: "確認済みの現地記録から、その区域までの距離。",
    detail:
      "類似度は基準地点に近いほど高く出ます。数百m以内で類似度が高い場合、「環境が似ている」のか「単に近い」のかを区別できません。基準地点は互いに離れた複数箇所で登録するのが望ましい設計です。",
  },
};

export function Term({ id, children }: { id: keyof typeof GLOSSARY | string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const entry = GLOSSARY[id];
  if (!entry) return <>{children}</>;

  return (
    <span className="relative inline-flex items-center gap-0.5">
      <span>{children ?? entry.term}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-slate-400 hover:text-slate-600 align-middle"
        aria-label={`${entry.term}の説明`}
      >
        <HelpCircle size={12} />
      </button>
      {open && (
        <span className="absolute z-50 left-0 top-full mt-1 w-64 bg-slate-900 text-white text-[11px] leading-relaxed rounded-lg p-2.5 shadow-lg">
          <span className="block font-semibold mb-1">{entry.term}</span>
          <span className="block">{entry.plain}</span>
          {entry.detail && <span className="block mt-1.5 text-slate-300">{entry.detail}</span>}
          <button onClick={() => setOpen(false)} className="block mt-1.5 text-slate-400 underline">
            閉じる
          </button>
        </span>
      )}
    </span>
  );
}

/** A short note that tells the reader how to read what they are looking at. */
export function Hint({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "tip" }) {
  const styles = {
    info: "bg-sky-50 border-sky-200 text-sky-900",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    tip: "bg-emerald-50 border-emerald-200 text-emerald-900",
  }[tone];
  const Icon = tone === "warn" ? TriangleAlert : tone === "tip" ? Lightbulb : Info;
  return (
    <div className={`flex gap-2 border rounded-xl px-3 py-2.5 text-[11px] leading-relaxed ${styles}`}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Empty states always say what to do next, never just "no data". */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Info;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-12 px-6">
      <Icon size={26} className="mx-auto mb-3 text-slate-300" />
      <div className="text-sm font-medium text-slate-700">{title}</div>
      <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Turns a bare number into a judgement a non-specialist can act on. */
export function Verdict({ level, children }: { level: "good" | "watch" | "act" | "unknown"; children: ReactNode }) {
  const styles = {
    good: "bg-emerald-50 text-emerald-800 border-emerald-200",
    watch: "bg-amber-50 text-amber-800 border-amber-200",
    act: "bg-rose-50 text-rose-800 border-rose-200",
    unknown: "bg-slate-100 text-slate-600 border-slate-200",
  }[level];
  return <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${styles}`}>{children}</span>;
}
