/** Mirrors worker/src/lib/leap.ts. Kept in step with it by hand. */

export type LeapPhase = "scoping" | "locate" | "evaluate" | "assess" | "prepare";
export type Coverage = "covered" | "partial" | "not_covered";

export const COVERAGE_LABEL: Record<Coverage, string> = {
  covered: "対応",
  partial: "部分対応",
  not_covered: "本システム対象外",
};

export const PHASE_TITLE: Record<LeapPhase, string> = {
  scoping: "スコーピング",
  locate: "Locate — 自然との接点を特定する",
  evaluate: "Evaluate — 依存と影響を診断する",
  assess: "Assess — リスクと機会を評価する",
  prepare: "Prepare — 対応と開示を準備する",
};

export type Basis = "measured" | "field_confirmed" | "map_designated" | "configured" | "estimated" | "missing";

export const BASIS_LABEL: Record<Basis, string> = {
  measured: "衛星実測",
  field_confirmed: "現地確認済み",
  map_designated: "地図上で指定（現地未確認）",
  configured: "登録・設定値",
  estimated: "推定値",
  missing: "未取得",
};

export interface LeapItem {
  label: string;
  value: string;
  basis: Basis;
  note?: string;
}

export interface LeapComponent {
  code: string;
  phase: LeapPhase;
  titleEn: string;
  title: string;
  question: string;
  coverage: Coverage;
  verdict: string;
  items: LeapItem[];
  gaps: string[];
}

export interface SensitiveCriterion {
  key: string;
  title: string;
  assessable: boolean;
  /** A derived indicator, which is neither an assessment nor an absence of one. */
  proxy?: boolean;
  result: string;
  requires?: string;
  source?: string;
  fetchedAt?: string | null;
}

export interface PublicDataStatus {
  key: string;
  label: string;
  covers: string;
  caveat: string;
  status: "ok" | "failed" | "not_fetched";
  error?: string;
  fetchedAt?: string | null;
}

export type SiteVerdict = "attention" | "watch" | "clear" | "insufficient";

export const SITE_VERDICT_LABEL: Record<SiteVerdict, string> = {
  attention: "配慮が必要",
  watch: "監視・要確認",
  clear: "特記事項なし",
  insufficient: "情報不足",
};

export interface ScreenedSite {
  label: string;
  lat: number | null;
  lng: number | null;
  verdict: SiteVerdict;
  reason: string;
  score: number | null;
  evidence: string[];
}

export interface LeapReport {
  project: {
    id: string;
    name: string;
    clientName: string | null;
    useCase: string;
    areaHa: number | null;
    centerLat: number | null;
    centerLng: number | null;
  };
  generatedAt: string;
  dataAsOf: string | null;
  meshId: string | null;
  meshComplete: boolean;
  sites: ScreenedSite[];
  sensitive: SensitiveCriterion[];
  publicData: PublicDataStatus[];
  screenPoint: { lat: number; lng: number } | null;
  components: LeapComponent[];
  coverageSummary: { covered: number; partial: number; notCovered: number; total: number };
  provenance: {
    analysisId: string | null;
    model: string | null;
    engineVersion: string | null;
    earthEngineYear: number | null;
    embeddingDataset: string;
    indicesDataset: string;
    earthEngineAvailable: boolean | null;
    executedAt: string | null;
  };
  outstanding: string[];
}
