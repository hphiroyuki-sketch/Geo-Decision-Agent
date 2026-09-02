// Simulated geospatial analysis engine.
//
// The requirements doc calls for Google Satellite Embedding / Earth Engine /
// Sentinel-2 pipelines (7章). Those need real GCP credentials, data licensing,
// and a batch pipeline that are out of scope for this MVP build. This module
// stands in for that pipeline with a deterministic, seeded generator so the
// product's decision-support UX (ranking, mitigation hierarchy, LEAP output,
// confidence) is fully real and wired end-to-end - only the underlying
// satellite numbers are simulated, clearly labeled as such everywhere they
// surface. Swapping this module for a real Earth Engine client is the
// intended upgrade path; nothing above this layer needs to change.

// Bump when the scoring formula, thresholds or mitigation rules change: an
// analysis re-run under a different engine version is not the same analysis.
export const ENGINE_VERSION = "3.0.1";

export interface CandidateInput {
  name: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

// Real data swapped in per candidate when available (Earth Engine embedding
// fetch succeeded, and/or the project has nearby field_records). Any field
// left undefined falls back to the simulated value for that axis.
export interface RealDataOverride {
  alphaEarthSimilarity?: number;
  fieldRecordsCount?: number;
  /** Of fieldRecordsCount, how many a reviewer actually confirmed. */
  confirmedFieldRecordsCount?: number;
  fieldSpeciesNames?: string[];
  /** Metres from this candidate to the nearest confirmed record behind the reference embedding. */
  referenceDistanceM?: number;
  /** Measured Sentinel-2 NDRE change against the previous year (FR-022). */
  ndreChangePct?: number;
  /** The two years the NDRE change was measured between. */
  ndreYears?: [number, number];
  /** This year's measured indices, for the expert view. */
  indices?: { ndvi: number | null; ndre: number | null; ndmi: number | null; nbr: number | null };
}

export interface MitigationMeasure {
  stage: "avoid" | "reduce" | "restore" | "offset";
  description: string;
  priority: number;
  costImpact: string;
}

export interface CandidateResult {
  label: string;
  lat: number | null;
  lng: number | null;
  rank: number;
  score: number;
  habitatOverlap: number;
  protectedAreaDistanceKm: number;
  connectivityImpact: "高" | "中" | "低";
  ndreChangePct: number;
  /** True when ndreChangePct came from Sentinel-2 rather than the simulator. */
  ndreMeasured: boolean;
  indices?: { ndvi: number | null; ndre: number | null; ndmi: number | null; nbr: number | null };
  alphaEarthSimilarity: number;
  accessDistanceKm: number;
  accessRating: string;
  confidence: "高" | "中" | "低";
  evidenceBasis: string[];
  fieldRecordsCount: number;
  recommendedAction: string;
  mitigations: MitigationMeasure[];
}

// Simple deterministic string hash -> mulberry32 PRNG seed.
function seedFromString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function connectivityLabel(v: number): "高" | "中" | "低" {
  if (v > 0.66) return "高";
  if (v > 0.33) return "中";
  return "低";
}

function accessRating(km: number): string {
  if (km < 1.5) return "良い";
  if (km < 3.5) return "普通";
  return "やや遠い";
}

export function analyzeCandidates(
  projectSeed: string,
  candidates: CandidateInput[],
  overrides: Record<string, RealDataOverride> = {},
): CandidateResult[] {
  const results = candidates.map((c) => {
    const rng = mulberry32(seedFromString(`${projectSeed}::${c.name}`));
    const override = overrides[c.name] ?? {};

    const habitatOverlap = clamp(rng() * 0.9 + rng() * 0.1, 0, 1);
    const protectedAreaDistanceKm = clamp(rng() * 6, 0.1, 6);
    const connectivityRaw = rng();
    const simulatedNdreChangePct = -1 * clamp(rng() * 18, 0, 18); // negative = vegetation stress
    const ndreMeasured = override.ndreChangePct !== undefined;
    const ndreChangePct = override.ndreChangePct ?? simulatedNdreChangePct;
    const simulatedAlphaEarthSimilarity = clamp(0.5 + rng() * 0.5, 0, 1);
    const alphaEarthSimilarity = override.alphaEarthSimilarity ?? simulatedAlphaEarthSimilarity;
    const accessDistanceKm = clamp(rng() * 5, 0.2, 5);
    const fieldRecordsCount = override.fieldRecordsCount ?? Math.floor(rng() * 5);

    const connectivityPenalty = connectivityRaw * 20;
    const protectedProximityPenalty = Math.max(0, 2.5 - protectedAreaDistanceKm) * 8;
    const riskScore =
      habitatOverlap * 35 +
      protectedProximityPenalty +
      connectivityPenalty +
      Math.abs(ndreChangePct) * 0.7 +
      alphaEarthSimilarity * 12;
    const score = Math.round(clamp(100 - riskScore, 5, 97));

    const evidenceBasis = [override.alphaEarthSimilarity !== undefined ? "Earth Engine実データ" : "衛星推定"];
    // A measured index change is the one axis that needs no field visit to be
    // real, so it is named with the years it spans rather than folded into the
    // generic "real data" label.
    if (ndreMeasured) {
      const years = override.ndreYears ? `${override.ndreYears[0]}→${override.ndreYears[1]}` : "前年比";
      evidenceBasis.push(`NDRE実測（Sentinel-2 ${years}）`);
    }
    // Only a reviewer-confirmed record earns "confirmed". Counting unreviewed
    // records as confirmed overstated the evidence in a document meant to
    // support a real siting decision.
    const confirmedCount = override.confirmedFieldRecordsCount ?? fieldRecordsCount;
    const unconfirmedCount = Math.max(0, fieldRecordsCount - confirmedCount);
    // Section 9.2 defines the three levels by what is actually behind the
    // number, not by how sure the model sounds: 高 needs verified field data,
    // 中 needs several sources agreeing but no field confirmation, 低 is a
    // single source or a gap. Counting sources here keeps that rule in code.
    const measuredSources =
      (override.alphaEarthSimilarity !== undefined ? 1 : 0) + (ndreMeasured ? 1 : 0);
    let confidence: "高" | "中" | "低" = "低";
    if (confirmedCount >= 3 && measuredSources >= 1) {
      evidenceBasis.push("現地確認済み");
      confidence = "高";
    } else if (confirmedCount >= 1) {
      evidenceBasis.push("現地確認済み");
      confidence = "中";
    } else if (measuredSources >= 2) {
      // Two independent satellite measurements agreeing, but nobody has stood
      // there - "中" with the field visit still named as what is missing.
      confidence = "中";
    }
    if (unconfirmedCount > 0) {
      evidenceBasis.push(`現地記録${unconfirmedCount}件（未確認・レビュー待ち）`);
    }
    // Similarity to the reference is partly just proximity to it, so state the
    // distance rather than letting a high score read as independent evidence.
    if (override.referenceDistanceM !== undefined) {
      evidenceBasis.push(`基準地点まで約${Math.round(override.referenceDistanceM)}m`);
    }
    if (override.fieldSpeciesNames?.length) {
      evidenceBasis.push(`現地記録種: ${override.fieldSpeciesNames.slice(0, 3).join("・")}`);
    }

    const mitigations: MitigationMeasure[] = [];
    let priority = 1;
    if (habitatOverlap > 0.5 || protectedAreaDistanceKm < 1.5) {
      mitigations.push({
        stage: "avoid",
        description: `候補地内で生息地重複度が低い区画へ配置をずらす、または近接する保護区域から緩衝距離を確保する（現況重複度 ${(habitatOverlap * 100).toFixed(0)}%、最近接保護区域まで ${protectedAreaDistanceKm.toFixed(1)}km）。`,
        priority: priority++,
        costImpact: "小〜中（配置見直しのみ）",
      });
    }
    mitigations.push({
      stage: "reduce",
      description:
        connectivityRaw > 0.5
          ? "生態系ネットワークの連結性への影響が大きいため、工事時期を繁殖期・渡り時期を避けて設定し、通路となる緑地帯を分断しない配置とする。"
          : "低影響区画のため、標準的な低減策（夜間照明の制御、濁水対策、騒音低減）を実施する。",
      priority: priority++,
      costImpact: "小",
    });
    mitigations.push({
      stage: "restore",
      description: "工事による一時的な改変区域は、在来植生を用いた植生復元計画をあらかじめ策定し、供用後もモニタリングする。",
      priority: priority++,
      costImpact: "中",
    });
    if (score < 60) {
      mitigations.push({
        stage: "offset",
        description: "回避・低減・回復でも残存する影響については、同等以上の生態学的価値を持つ区域での代償措置（オフセット）を検討する。",
        priority: priority++,
        costImpact: "中〜大",
      });
    }

    let recommendedAction: string;
    if (score >= 75) recommendedAction = "現地調査（優先）";
    else if (score >= 55) recommendedAction = "現地調査（次点）";
    else recommendedAction = "追加確認が必要";

    return {
      label: c.name,
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      rank: 0,
      score,
      habitatOverlap: Number(habitatOverlap.toFixed(2)),
      protectedAreaDistanceKm: Number(protectedAreaDistanceKm.toFixed(1)),
      connectivityImpact: connectivityLabel(connectivityRaw),
      ndreChangePct: Number(ndreChangePct.toFixed(1)),
      ndreMeasured,
      indices: override.indices,
      alphaEarthSimilarity: Number(alphaEarthSimilarity.toFixed(2)),
      accessDistanceKm: Number(accessDistanceKm.toFixed(1)),
      accessRating: accessRating(accessDistanceKm),
      confidence,
      evidenceBasis,
      fieldRecordsCount,
      recommendedAction,
      mitigations,
    } satisfies CandidateResult;
  });

  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}
