// FR-053: TNFD LEAP-aligned output, and FR-034 report variants.
//
// LEAP is a disclosure framework, not an answer generator. Everything here is
// assembled from rows this system actually holds; where a section has no data,
// it says so and names how to obtain it rather than being filled in. A
// disclosure built on invented content is worse than an incomplete one, so
// "未取得" is a first-class outcome of this module.

import type { Env } from "../types";
import { CELL_CLASS_LABEL, type CellClass } from "./mesh";

export type LeapStage = "locate" | "evaluate" | "assess" | "prepare";

export const LEAP_STAGE_META: Record<LeapStage, { code: string; title: string; question: string }> = {
  locate: {
    code: "L",
    title: "Locate（自然との接点を特定する）",
    question: "事業はどこで自然と接しているか。優先的に注意すべき地域はどこか。",
  },
  evaluate: {
    code: "E",
    title: "Evaluate（依存と影響を診断する）",
    question: "その場所で、事業は自然に何を依存し、何の影響を与えているか。",
  },
  assess: {
    code: "A",
    title: "Assess（リスクと機会を評価する）",
    question: "そこから生じるリスクと機会は何か。重要なものはどれか。",
  },
  prepare: {
    code: "P",
    title: "Prepare（対応と開示を準備する）",
    question: "何に取り組み、何を開示し、どう測るか。",
  },
};

export interface LeapItem {
  label: string;
  value: string;
  /** Where the number came from, so a reviewer can check it. */
  basis: "measured" | "field_confirmed" | "estimated" | "missing";
  note?: string;
}

export interface LeapSection {
  stage: LeapStage;
  summary: string;
  items: LeapItem[];
  gaps: string[];
}

export const BASIS_LABEL: Record<LeapItem["basis"], string> = {
  measured: "衛星実データ",
  field_confirmed: "現地確認済み",
  estimated: "推定値",
  missing: "未取得",
};

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  use_case: string;
  area_ha: number | null;
  center_lat: number | null;
  center_lng: number | null;
  created_at: string;
}

/** Assembles the four LEAP sections for one project from its own rows. */
export async function buildLeapReport(env: Env, projectId: string) {
  const project = await env.DB.prepare(
    "SELECT id, name, description, use_case, area_ha, center_lat, center_lng, created_at FROM projects WHERE id = ?",
  )
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) throw new Error("プロジェクトが見つかりません。");

  const mesh = await env.DB.prepare(
    `SELECT id, cell_size_m, extent_m, year, reference_points, completed_at
     FROM meshes WHERE project_id = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{
      id: string;
      cell_size_m: number;
      extent_m: number;
      year: number;
      reference_points: number;
      completed_at: string | null;
    }>();

  const cellCounts = mesh
    ? (
        await env.DB.prepare(
          `SELECT cell_class, COUNT(*) AS n FROM mesh_cells WHERE mesh_id = ? AND status = 'sampled' GROUP BY cell_class`,
        )
          .bind(mesh.id)
          .all<{ cell_class: string; n: number }>()
      ).results
    : [];

  const hotspots = mesh
    ? (
        await env.DB.prepare(
          `SELECT cell_class, COUNT(*) AS n, SUM(area_ha) AS area_ha FROM mesh_hotspots WHERE mesh_id = ? GROUP BY cell_class`,
        )
          .bind(mesh.id)
          .all<{ cell_class: string; n: number; area_ha: number }>()
      ).results
    : [];

  const { results: fieldStats } = await env.DB.prepare(
    "SELECT review_status, COUNT(*) AS n FROM field_records WHERE project_id = ? GROUP BY review_status",
  )
    .bind(projectId)
    .all<{ review_status: string; n: number }>();

  const { results: species } = await env.DB.prepare(
    `SELECT DISTINCT species_guess FROM field_records
     WHERE project_id = ? AND review_status = 'confirmed' AND species_guess IS NOT NULL LIMIT 20`,
  )
    .bind(projectId)
    .all<{ species_guess: string }>();

  const { results: actions } = await env.DB.prepare(
    `SELECT stage, status, COUNT(*) AS n, SUM(area_ha) AS area_ha FROM recovery_actions
     WHERE project_id = ? GROUP BY stage, status`,
  )
    .bind(projectId)
    .all<{ stage: string; status: string; n: number; area_ha: number }>();

  const { results: candidates } = await env.DB.prepare(
    `SELECT label, score, rank, habitat_overlap, protected_area_distance_km, evidence_basis
     FROM site_candidates WHERE project_id = ? ORDER BY rank LIMIT 10`,
  )
    .bind(projectId)
    .all<{
      label: string;
      score: number;
      rank: number;
      habitat_overlap: number | null;
      protected_area_distance_km: number | null;
      evidence_basis: string | null;
    }>();

  const confirmed = fieldStats.find((f) => f.review_status === "confirmed")?.n ?? 0;
  const unreviewed = fieldStats.find((f) => f.review_status === "unreviewed")?.n ?? 0;
  const areaOf = (cls: string) => hotspots.find((h) => h.cell_class === cls)?.area_ha ?? 0;
  const countOf = (cls: string) => hotspots.find((h) => h.cell_class === cls)?.n ?? 0;

  const sections: LeapSection[] = [];

  // --- Locate ---------------------------------------------------------------
  const locateItems: LeapItem[] = [
    {
      label: "対象地",
      value:
        project.center_lat != null && project.center_lng != null
          ? `${project.name}（中心 ${project.center_lat.toFixed(5)}, ${project.center_lng.toFixed(5)}）`
          : project.name,
      basis: project.center_lat != null ? "measured" : "missing",
    },
    {
      label: "対象面積",
      value: project.area_ha ? `${project.area_ha.toLocaleString()} ha` : "未登録",
      basis: project.area_ha ? "measured" : "missing",
    },
    {
      label: "解析解像度",
      value: mesh ? `${mesh.cell_size_m}m メッシュ（範囲 ${mesh.extent_m}m四方、対象年 ${mesh.year}）` : "未実施",
      basis: mesh ? "measured" : "missing",
    },
    {
      label: "解析セル数",
      value: cellCounts.length
        ? cellCounts.map((c) => `${CELL_CLASS_LABEL[c.cell_class as CellClass] ?? c.cell_class}: ${c.n}`).join(" / ")
        : "未実施",
      basis: cellCounts.length ? "measured" : "missing",
    },
  ];
  const locateGaps: string[] = [];
  if (!mesh) locateGaps.push("10mメッシュ解析が未実施です。対象地の状態を面として把握するため、先に実行してください。");
  if (!project.area_ha) locateGaps.push("対象面積が未登録です。プロジェクト設定で登録してください。");
  sections.push({
    stage: "locate",
    summary: mesh
      ? `${project.name} の対象地を ${mesh.cell_size_m}m メッシュで基線化し、保全優先 ${countOf("priority_a")} 区域（${areaOf("priority_a").toFixed(2)}ha）、回復候補 ${countOf("similar")} 区域（${areaOf("similar").toFixed(2)}ha）、要現地確認 ${countOf("changed")} 区域（${areaOf("changed").toFixed(2)}ha）を特定した。`
      : `${project.name} の対象地は登録済みだが、面としての基線化（10mメッシュ解析）が未実施のため、優先地域の特定は完了していない。`,
    items: locateItems,
    gaps: locateGaps,
  });

  // --- Evaluate -------------------------------------------------------------
  const evaluateItems: LeapItem[] = [
    {
      label: "現地確認された生物・植物",
      value: species.length ? species.map((s) => s.species_guess).join("、") : "確認済み記録なし",
      basis: species.length ? "field_confirmed" : "missing",
      note: species.length ? undefined : "査読済みの現地記録がないため、生息種に基づく評価ができません。",
    },
    {
      label: "現地記録の件数",
      value: `確認済み ${confirmed} 件 / 未査読 ${unreviewed} 件`,
      basis: confirmed > 0 ? "field_confirmed" : "missing",
    },
    {
      label: "基準地点（類似度の比較元）",
      value: mesh ? `${mesh.reference_points} 地点` : "未設定",
      basis: mesh && mesh.reference_points > 0 ? "field_confirmed" : "missing",
      note:
        mesh && mesh.reference_points === 0
          ? "基準地点がないため、保全優先・回復候補の判定は成立していません（変化検出のみ）。"
          : undefined,
    },
    {
      label: "生息地重複度・保護区域距離",
      value: candidates.length
        ? candidates
            .map(
              (c) =>
                `${c.label}: 重複 ${c.habitat_overlap != null ? `${(c.habitat_overlap * 100).toFixed(0)}%` : "—"}、保護区域まで ${c.protected_area_distance_km?.toFixed(1) ?? "—"}km`,
            )
            .join(" / ")
        : "候補地の比較分析が未実施",
      basis: candidates.length ? "estimated" : "missing",
      note: candidates.length
        ? "本MVPでは重複度・保護区域距離はシミュレーション値です。開示前に公的な指定区域データとの照合が必要です。"
        : undefined,
    },
  ];
  const evaluateGaps: string[] = [];
  if (confirmed === 0)
    evaluateGaps.push("査読済みの現地記録がありません。現場で撮影・記録し、査読して「確認済み」にしてください。");
  if (unreviewed > 0) evaluateGaps.push(`未査読の現地記録が ${unreviewed} 件あります。査読すると評価に反映されます。`);
  evaluateGaps.push(
    "生態系サービスへの依存（水源涵養・受粉・土壌保持等）の定量評価は本システムの対象外です。専門家評価を別途実施してください。",
  );
  sections.push({
    stage: "evaluate",
    summary:
      confirmed > 0
        ? `衛星による面的評価と、現地で確認された ${confirmed} 件の記録（${species.length} 種）を重ね合わせて、対象地の生物多様性状態を評価した。`
        : "衛星による面的評価は実施したが、現地記録の裏付けがないため、依存・影響の評価は暫定である。",
    items: evaluateItems,
    gaps: evaluateGaps,
  });

  // --- Assess ---------------------------------------------------------------
  const assessItems: LeapItem[] = [
    {
      label: "物理的リスク（生息地への影響）",
      value:
        countOf("priority_a") > 0
          ? `保全優先区域 ${areaOf("priority_a").toFixed(2)}ha に事業が及ぶ場合、回復困難な影響が生じる可能性が高い。`
          : "保全優先水準の区域は検出されていない。",
      basis: mesh ? "measured" : "missing",
    },
    {
      label: "移行リスク（規制・開示）",
      value:
        "TNFD/SSBJ開示、環境アセスメント、林地開発許可等の要否は、事業規模と立地により決まる。本システムは判定しない。",
      basis: "missing",
      note: "法令適合性の判断は、必ず所管行政庁および専門家に確認してください。",
    },
    {
      label: "機会（回復による価値創出）",
      value:
        countOf("similar") > 0
          ? `回復候補区域 ${areaOf("similar").toFixed(2)}ha は、施策の費用対効果が高い可能性がある区域として特定済み。代償措置の候補にもなり得る。`
          : "回復候補区域は検出されていない。",
      basis: mesh ? "measured" : "missing",
    },
    {
      label: "監視が必要な変化",
      value:
        countOf("changed") > 0
          ? `${countOf("changed")} 区域（${areaOf("changed").toFixed(2)}ha）で前年から大きな変化を検出。原因未特定。`
          : "大きな変化は検出されていない。",
      basis: mesh ? "measured" : "missing",
      note: countOf("changed") > 0 ? "衛星は変化の有無のみを示します。原因の特定には現地確認が必要です。" : undefined,
    },
  ];
  sections.push({
    stage: "assess",
    summary:
      countOf("priority_a") + countOf("changed") > 0
        ? `保全優先 ${areaOf("priority_a").toFixed(2)}ha と要確認 ${areaOf("changed").toFixed(2)}ha を重要度の高いリスク箇所として特定した。回復候補 ${areaOf("similar").toFixed(2)}ha は機会として扱う。`
        : "現時点で重要度の高いリスク箇所は特定されていない。監視を継続する。",
    items: assessItems,
    gaps: [
      "財務影響の定量化（コスト増分、回避便益）は未実装です。FR-056として段階導入予定の範囲です。",
      "バリューチェーン上流・下流の自然関連リスクは対象外です。",
    ],
  });

  // --- Prepare --------------------------------------------------------------
  const byStage = (stage: string) => actions.filter((a) => a.stage === stage);
  const stageSummary = (stage: string, label: string): LeapItem => {
    const rows = byStage(stage);
    const total = rows.reduce((s, r) => s + r.n, 0);
    const area = rows.reduce((s, r) => s + (r.area_ha ?? 0), 0);
    const done = rows.filter((r) => r.status === "done").reduce((s, r) => s + r.n, 0);
    return {
      label,
      value: total > 0 ? `${total} 件（対象 ${area.toFixed(2)}ha、完了 ${done} 件）` : "施策なし",
      basis: total > 0 ? "measured" : "missing",
    };
  };

  const prepareItems: LeapItem[] = [
    stageSummary("avoid", "回避（立地・配置の変更）"),
    stageSummary("reduce", "低減（工法・時期・配置）"),
    stageSummary("restore", "回復"),
    stageSummary("offset", "オフセット（代償）"),
    {
      label: "測定指標",
      value:
        "Satellite Embedding 類似度、前年比の変化スコア、NDVI/NDRE/NDMI/NBR、現地確認種数、改変面積(ha)",
      basis: "measured",
    },
    {
      label: "測定頻度",
      value: "衛星：年1回（対象年更新時） / 現地：施策区分により年1〜2回",
      basis: "measured",
    },
  ];

  const prepareGaps: string[] = [];
  const ownerless = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM recovery_actions WHERE project_id = ? AND owner_user_id IS NULL",
  )
    .bind(projectId)
    .first<{ n: number }>();
  if ((ownerless?.n ?? 0) > 0)
    prepareGaps.push(`担当者が未設定の施策が ${ownerless?.n} 件あります。開示前に責任者と期限を確定してください。`);
  prepareGaps.push("本出力は「案」です。開示にあたっては、社内の確認者による承認と、専門家レビューを経てください。");

  sections.push({
    stage: "prepare",
    summary:
      actions.length > 0
        ? "ミティゲーション・ヒエラルキー（回避→低減→回復→オフセット）の順に施策を整理し、区域・期待変化・測定指標・頻度を設定した。"
        : "施策が未登録です。10mメッシュ解析を実行すると、重要区域ごとの施策案が生成されます。",
    items: prepareItems,
    gaps: prepareGaps,
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      useCase: project.use_case,
      areaHa: project.area_ha,
      centerLat: project.center_lat,
      centerLng: project.center_lng,
    },
    generatedAt: new Date().toISOString(),
    dataAsOf: mesh?.completed_at ?? null,
    meshId: mesh?.id ?? null,
    sections,
    /** Everything a reviewer must supply before this can be disclosed. */
    outstanding: sections.flatMap((s) => s.gaps),
  };
}
