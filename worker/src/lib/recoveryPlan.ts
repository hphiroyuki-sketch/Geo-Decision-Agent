// FR-052 mitigation hierarchy / FR-054 recovery plan / FR-055 verification.
//
// Turns each hotspot into measures that name the ground they apply to. The
// requirements ask for 施策区域・期待変化・測定指標・頻度・責任者 on every
// entry, so each action carries all of them; the owner is left unset because
// assigning a person is a human decision, not an inference.
//
// These are deterministic templates keyed to what the mesh actually measured,
// not model-written prose: the numbers in them (area, similarity, change) come
// from the cells, so a reviewer can check any figure against the map.

import type { Hotspot } from "./mesh";
import { PRIORITY_A_THRESHOLD } from "./mesh";

export type MitigationStage = "avoid" | "reduce" | "restore" | "offset";

export const STAGE_LABEL: Record<MitigationStage, string> = {
  avoid: "回避",
  reduce: "低減",
  restore: "回復",
  offset: "オフセット",
};

export interface RecoveryAction {
  stage: MitigationStage;
  title: string;
  description: string;
  expectedChange: string;
  indicator: string;
  frequency: string;
  areaHa: number;
  centerLat: number;
  centerLng: number;
  priority: number;
}

function coords(hotspot: Hotspot): string {
  return `${hotspot.centerLat.toFixed(5)}, ${hotspot.centerLng.toFixed(5)}`;
}

/**
 * Builds the measures for one hotspot. Priority is 1-based within the plan and
 * assigned by the caller's ranking, so the returned order is the order to act.
 */
export function buildActionsForHotspot(hotspot: Hotspot, basePriority: number): RecoveryAction[] {
  const area = hotspot.areaHa.toFixed(2);
  const at = coords(hotspot);
  const actions: RecoveryAction[] = [];
  const common = { areaHa: hotspot.areaHa, centerLat: hotspot.centerLat, centerLng: hotspot.centerLng };

  if (hotspot.cellClass === "priority_a") {
    const sim = hotspot.meanSimilarity?.toFixed(2) ?? "-";
    actions.push({
      ...common,
      stage: "avoid",
      priority: basePriority,
      title: `保全優先区域 ${area}ha を計画区域から除外する`,
      description:
        `中心 ${at} の ${area}ha は、現地で確認済みの生息環境との衛星エンベディング類似度が平均 ${sim}` +
        `（優先度A判定のしきい値 ${PRIORITY_A_THRESHOLD}）で、まとまり（連結度 ${hotspot.compactness.toFixed(2)}）も保たれています。` +
        `施設・進入路・資材ヤードの配置対象から外し、境界の外側に緩衝帯を設けてください。`,
      expectedChange: "改変面積 0ha を維持し、区域内の類似度を現状水準（±0.03以内）で保つ",
      indicator: "Satellite Embedding 類似度（対 現地確認済み基準ベクトル）、改変面積(ha)",
      frequency: "年1回（衛星）／2年に1回（現地）",
    });
    actions.push({
      ...common,
      stage: "reduce",
      priority: basePriority + 1,
      title: "区域外縁での夜間照明・騒音・濁水の影響を抑える",
      description:
        `除外しきれない外縁部では、夜間照明の下向き遮光、繁殖期を外した工程、濁水の沈砂処理により、` +
        `区域内へ及ぶ影響を抑えます。フェンスを設ける場合は下部に小動物の通行空間を確保してください。`,
      expectedChange: "外縁50m内の類似度低下を 0.05 未満に抑える",
      indicator: "外縁バッファ内セルの類似度変化、夜間照度(lx)",
      frequency: "工事期間中は月1回、供用後は年1回",
    });
  }

  if (hotspot.cellClass === "similar") {
    const sim = hotspot.meanSimilarity?.toFixed(2) ?? "-";
    actions.push({
      ...common,
      stage: "restore",
      priority: basePriority,
      title: `回復候補区域 ${area}ha で在来種による植生回復を行う`,
      description:
        `中心 ${at} の ${area}ha は、確認済み生息環境との類似度が平均 ${sim} と中程度です。` +
        `つまり環境の骨格は近いものの、そこまでは達していない状態で、回復施策の費用対効果が最も高い区域にあたります。` +
        `周辺の確認済み地点で成立している在来種を用い、下層植生と樹冠の階層構造を回復させてください。` +
        (hotspot.fieldRecords > 0
          ? `この区域内には現地記録が ${hotspot.fieldRecords} 件あり、種の選定根拠として使えます。`
          : `区域内に現地記録がないため、着手前に現地の植生・土壌調査を実施してください。`),
      expectedChange: `3年で類似度を平均 +0.05（${sim} → ${(Number(sim) + 0.05).toFixed(2)}）、5年で優先度A水準（${PRIORITY_A_THRESHOLD}）到達を目指す`,
      indicator: "Satellite Embedding 類似度、NDVI、在来種被度(%)、確認種数",
      frequency: "年2回（春・秋）",
    });
    actions.push({
      ...common,
      stage: "offset",
      priority: basePriority + 1,
      title: "他区域の改変に対する代償措置の候補として登録する",
      description:
        `回避・低減を尽くしてなお残る影響がある場合、この区域の回復を代償措置の候補として計上できます。` +
        `代償はミティゲーション・ヒエラルキーの最終手段であり、回避・低減の不足を埋める口実には使えません。`,
      expectedChange: "残余影響に対する代償面積の確保（改変面積と同等以上）",
      indicator: "代償面積(ha)、回復後の類似度",
      frequency: "年1回",
    });
  }

  if (hotspot.cellClass === "changed") {
    const change = hotspot.meanChange?.toFixed(3) ?? "-";
    actions.push({
      ...common,
      stage: "reduce",
      priority: basePriority,
      title: `変化検出区域 ${area}ha の原因を現地で特定する`,
      description:
        `中心 ${at} の ${area}ha で、前年との埋め込み差が平均 ${change} と大きく出ています。` +
        `衛星データは「変わったこと」を示せますが「なぜ変わったか」は示せません。` +
        `伐採・災害・病虫害・季節差・観測条件のいずれかを、現地確認で切り分けてください。原因が判明するまでは、この区域を判断の根拠に使わないでください。`,
      expectedChange: "変化要因の特定（自然変動／人為改変／観測差の判別）",
      indicator: "現地確認記録、前年比の埋め込み差、NDVI・NBR",
      frequency: "検出から30日以内に初回、以降は四半期ごと",
    });
    actions.push({
      ...common,
      stage: "restore",
      priority: basePriority + 1,
      title: "人為改変・災害由来と判明した場合の回復措置",
      description:
        `現地確認で人為改変または災害由来と判明した場合、裸地化した部分の表土流出防止を先行し、` +
        `その後に在来種による植生回復へ移行します。自然変動・観測差であった場合は監視継続のみとし、施策は行いません。`,
      expectedChange: "裸地面積の減少、2年で植生指数を変化前水準へ復帰",
      indicator: "裸地面積(ha)、NDVI、Satellite Embedding 類似度",
      frequency: "年2回",
    });
  }

  return actions;
}

/** Builds the whole plan, ranked, from the hotspots of one mesh. */
export function buildRecoveryPlan(hotspots: Hotspot[]): { hotspot: Hotspot; actions: RecoveryAction[] }[] {
  let priority = 1;
  return hotspots.map((hotspot) => {
    const actions = buildActionsForHotspot(hotspot, priority);
    priority += actions.length;
    return { hotspot, actions };
  });
}
