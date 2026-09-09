// FR-053: TNFD LEAP-aligned screening output.
//
// LEAP is an assessment process, not an answer generator. Two rules govern this
// module, and both exist because a nature disclosure built on invented content
// is worse than an incomplete one:
//
//   1. Every figure is assembled from rows this system actually holds. Where a
//      component has no data, it says so and names how to obtain it.
//   2. Every component carries an explicit coverage verdict. Satellite data can
//      evidence part of Locate; it cannot evidence dependency analysis or
//      materiality. Presenting the whole of LEAP as "done" because the headings
//      are present would misrepresent what the reader is holding.
//
// The component codes, titles and guiding questions follow TNFD's LEAP guidance
// (v1.1). They are quoted rather than paraphrased so a reader can match this
// output against the framework line by line.

import type { Env } from "../types";
import { CELL_CLASS_LABEL, type CellClass } from "./mesh";
import { PUBLIC_DATA_SOURCES, type PublicDataBundle } from "./publicData";

export type LeapPhase = "scoping" | "locate" | "evaluate" | "assess" | "prepare";

/** What this system can actually evidence for a given component. */
export type Coverage = "covered" | "partial" | "not_covered";

export const COVERAGE_LABEL: Record<Coverage, string> = {
  covered: "対応",
  partial: "部分対応",
  not_covered: "本システム対象外",
};

export const PHASE_META: Record<LeapPhase, { code: string; title: string; intent: string }> = {
  scoping: {
    code: "S",
    title: "スコーピング",
    intent: "LEAPを始める前に、対象範囲と仮説を定める段階。",
  },
  locate: {
    code: "L",
    title: "Locate — 自然との接点を特定する",
    intent: "事業がどこで自然と接しているか、優先的に注意すべき地域はどこかを特定する。",
  },
  evaluate: {
    code: "E",
    title: "Evaluate — 依存と影響を診断する",
    intent: "その場所で、事業が自然に何を依存し、何の影響を与えているかを診断する。",
  },
  assess: {
    code: "A",
    title: "Assess — リスクと機会を評価する",
    intent: "そこから生じるリスクと機会のうち、重要なものを特定する。",
  },
  prepare: {
    code: "P",
    title: "Prepare — 対応と開示を準備する",
    intent: "何に取り組み、何を開示し、どう測るかを決める。",
  },
};

export interface LeapItem {
  label: string;
  value: string;
  /** Where the figure came from, so a reviewer can check it. */
  basis: "measured" | "field_confirmed" | "map_designated" | "configured" | "estimated" | "missing";
  note?: string;
}

export const BASIS_LABEL: Record<LeapItem["basis"], string> = {
  measured: "衛星由来の算出値",
  field_confirmed: "現地確認済み",
  map_designated: "地図上で指定（現地未確認）",
  configured: "登録・設定値",
  estimated: "推定値",
  missing: "未取得",
};

export interface LeapComponent {
  code: string;
  phase: LeapPhase;
  /** TNFD's official component name, kept in English for traceability. */
  titleEn: string;
  title: string;
  question: string;
  coverage: Coverage;
  /** One line saying what this system did or did not establish. */
  verdict: string;
  items: LeapItem[];
  gaps: string[];
}

/**
 * TNFD's five characteristics of a sensitive location. Three of them need
 * public datasets this system has not connected; saying so per criterion is
 * the difference between an honest screening and a misleading one.
 */
export interface SensitiveCriterion {
  key: string;
  title: string;
  assessable: boolean;
  /** A proxy indicator is neither an assessment nor an absence of one. */
  proxy?: boolean;
  result: string;
  requires?: string;
  /** Named next to the figure, so a reader can defend it in a meeting. */
  source?: string;
  fetchedAt?: string | null;
}

export interface PublicDataStatus {
  key: string;
  label: string;
  covers: string;
  caveat: string;
  /** True where the source adds detail but no criterion depends on it. */
  optional?: boolean;
  status: "ok" | "failed" | "busy" | "not_fetched";
  error?: string;
  fetchedAt?: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  use_case: string;
  area_ha: number | null;
  center_lat: number | null;
  center_lng: number | null;
  client_name: string | null;
  created_at: string;
}

export interface ScreenedSite {
  label: string;
  lat: number | null;
  lng: number | null;
  /** Plain-language screening outcome for the executive summary. */
  verdict: "attention" | "watch" | "clear" | "insufficient";
  reason: string;
  score: number | null;
  evidence: string[];
}

export const SITE_VERDICT_LABEL: Record<ScreenedSite["verdict"], string> = {
  attention: "配慮が必要",
  watch: "監視・要確認",
  clear: "特記事項なし",
  insufficient: "情報不足",
};

/** Assembles the LEAP screening for one project from its own rows. */
export async function buildLeapReport(env: Env, projectId: string) {
  const project = await env.DB.prepare(
    `SELECT id, name, description, use_case, area_ha, center_lat, center_lng, client_name, created_at
     FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) throw new Error("プロジェクトが見つかりません。");

  const mesh = await env.DB.prepare(
    `SELECT id, cell_size_m, extent_m, year, detect_change, reference_points, center_lat, center_lng,
            status, completed_at, created_at
     FROM meshes WHERE project_id = ? ORDER BY (status = 'ready') DESC, created_at DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{
      id: string;
      cell_size_m: number;
      extent_m: number;
      year: number;
      detect_change: number;
      reference_points: number;
      center_lat: number;
      center_lng: number;
      status: string;
      completed_at: string | null;
      created_at: string;
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

  const meshStats = mesh
    ? await env.DB.prepare(
        `SELECT COUNT(*) AS sampled, MIN(reference_similarity) AS sim_min, MAX(reference_similarity) AS sim_max,
                MAX(change_score) AS chg_max, AVG(change_score) AS chg_avg
         FROM mesh_cells WHERE mesh_id = ? AND status = 'sampled'`,
      )
        .bind(mesh.id)
        .first<{
          sampled: number;
          sim_min: number | null;
          sim_max: number | null;
          chg_max: number | null;
          chg_avg: number | null;
        }>()
    : null;

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
    `SELECT review_status, source, COUNT(*) AS n FROM field_records WHERE project_id = ? AND demo = 0 GROUP BY review_status, source`,
  )
    .bind(projectId)
    .all<{ review_status: string; source: string; n: number }>();

  const { results: species } = await env.DB.prepare(
    `SELECT DISTINCT species_guess FROM field_records
     WHERE project_id = ? AND review_status = 'confirmed' AND source = 'field' AND demo = 0
       AND species_guess IS NOT NULL LIMIT 20`,
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
    `SELECT label, lat, lng, score, rank, confidence, evidence_basis, ndre_change_pct, ndre_measured,
            alphaearth_similarity, field_records_count, recommended_action
     FROM site_candidates WHERE project_id = ? ORDER BY rank LIMIT 20`,
  )
    .bind(projectId)
    .all<{
      label: string;
      lat: number | null;
      lng: number | null;
      score: number;
      rank: number;
      confidence: string;
      evidence_basis: string | null;
      ndre_change_pct: number | null;
      ndre_measured: number;
      alphaearth_similarity: number | null;
      field_records_count: number;
      recommended_action: string;
    }>();

  const analysis = await env.DB.prepare(
    `SELECT id, model, prompt_version, engine_version, earth_engine_year, embedding_dataset, indices_dataset,
            earth_engine_available, executed_at
     FROM analyses WHERE project_id = ? ORDER BY executed_at DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{
      id: string;
      model: string;
      prompt_version: string;
      engine_version: string;
      earth_engine_year: number | null;
      embedding_dataset: string | null;
      indices_dataset: string | null;
      earth_engine_available: number;
      executed_at: string;
    }>();

  // Public datasets are fetched on demand and cached; the report reads what is
  // there rather than calling out on every view.
  const screenPoint =
    mesh?.center_lat != null
      ? { lat: mesh.center_lat, lng: mesh.center_lng }
      : project.center_lat != null && project.center_lng != null
        ? { lat: project.center_lat, lng: project.center_lng }
        : null;

  const publicRows = screenPoint
    ? (
        await env.DB.prepare(
          `SELECT source, payload_json, status, error, fetched_at FROM public_data_cache
           WHERE lat = ? AND lng = ?`,
        )
          .bind(Math.round(screenPoint.lat * 1000) / 1000, Math.round(screenPoint.lng * 1000) / 1000)
          .all<{ source: string; payload_json: string | null; status: string; error: string | null; fetched_at: string }>()
      ).results
    : [];

  const publicOf = (source: string) => publicRows.find((r) => r.source === source);
  const parsed = <T>(source: string): T | null => {
    const row = publicOf(source);
    return row?.payload_json && row.status === "ok" ? (JSON.parse(row.payload_json) as T) : null;
  };

  const bio = parsed<PublicDataBundle["biodiversity"]["data"]>("gbif");
  const pa = parsed<PublicDataBundle["protectedAreas"]["data"]>("osm_protected");
  const hz = parsed<PublicDataBundle["hazards"]["data"]>("gsi_hazard");

  const publicData: PublicDataStatus[] = PUBLIC_DATA_SOURCES.map((src) => {
    const row = publicOf(src.key);
    return {
      key: src.key,
      label: src.label,
      covers: src.covers,
      caveat: src.caveat,
      optional: "optional" in src ? Boolean(src.optional) : false,
      status: !row
        ? ("not_fetched" as const)
        : row.status === "ok"
          ? ("ok" as const)
          : row.status === "busy"
            ? ("busy" as const)
            : ("failed" as const),
      error: row?.error ?? undefined,
      fetchedAt: row?.fetched_at ?? null,
    };
  });

  const countBy = (status: string, source?: string) =>
    fieldStats
      .filter((f) => f.review_status === status && (source ? f.source === source : true))
      .reduce((s, f) => s + f.n, 0);

  const confirmedField = countBy("confirmed", "field");
  const mapPins = countBy("confirmed", "map_pin");
  const unreviewed = countBy("unreviewed");
  const areaOf = (cls: string) => hotspots.find((h) => h.cell_class === cls)?.area_ha ?? 0;
  const countOf = (cls: string) => hotspots.find((h) => h.cell_class === cls)?.n ?? 0;
  const sampled = meshStats?.sampled ?? 0;
  const meshComplete = mesh?.status === "ready";
  const hasMeshResult = sampled > 0;

  // --- Sites screened -------------------------------------------------------
  const sites: ScreenedSite[] = [];

  if (mesh && hasMeshResult) {
    const changed = countOf("changed");
    const priority = countOf("priority_a");
    sites.push({
      label: `${project.name}（メッシュ解析範囲）`,
      lat: mesh.center_lat,
      lng: mesh.center_lng,
      verdict: confirmedField === 0 ? "insufficient" : "watch",
      reason:
        changed > 0
          ? `前年から大きく変化した区域を ${changed} 件（${areaOf("changed").toFixed(2)}ha）検出。原因は衛星では判定できないため現地確認が必要。`
          : priority > 0
            ? `比較基準と高い環境類似度を示す区域を ${priority} 件（${areaOf("priority_a").toFixed(2)}ha）検出。生態学的な価値と事業影響は現地で別途確認が必要。`
            : `${sampled.toLocaleString()} マスを取得したが、しきい値を超える区域は検出されていない。`,
      score: null,
      evidence: [
        `${mesh.cell_size_m}mメッシュ ${sampled.toLocaleString()}マス（${mesh.extent_m}m四方・${mesh.year}年）`,
        mesh.reference_points > 0 ? `基準地点 ${mesh.reference_points} 地点` : "基準地点なし（変化検出のみ）",
      ],
    });
  }

  for (const c of candidates) {
    sites.push({
      label: c.label,
      lat: c.lat,
      lng: c.lng,
      verdict: "insufficient",
      reason:
        c.confidence === "低"
          ? `信頼度「低」。判断の裏付けが不足しており、この結果だけで立地を決めることはできない。`
          : "比較デモを含むため、企業の立地判断には未評価。現地情報と正式データによる再評価が必要です。",
      score: null,
      evidence: (c.evidence_basis ?? "").split(",").filter(Boolean),
    });
  }

  // --- Sensitive location screening (TNFD's five characteristics) -----------
  const sensitive: SensitiveCriterion[] = [
    {
      key: "biodiversity_importance",
      title: "生物多様性にとって重要な地域",
      assessable: Boolean(bio || pa),
      result: (() => {
        if (!bio && !pa) return "判定不可（公的データ未取得）";
        const parts: string[] = [];
        if (bio) {
          parts.push(
            bio.threatened.length > 0
              ? `該当の可能性あり：半径${bio.radiusKm}km以内に絶滅危惧種の記録 ${bio.threatenedRecords}件（${bio.threatened.map((t) => t.label).join("・")}）`
              : `半径${bio.radiusKm}km以内に絶滅危惧種（CR/EN/VU）の記録なし（総記録 ${bio.totalRecords.toLocaleString()}件）`,
          );
        }
        if (pa) {
          parts.push(
            pa.nearest
              ? `最寄りの保護区域まで ${pa.nearest.distanceKm}km（${pa.nearest.name}／${pa.nearest.kind}）`
              : `半径${pa.radiusKm}km以内に保護区域の登録なし`,
          );
        }
        return parts.join("／");
      })(),
      requires: !bio && !pa
        ? "「公的データと照合」を実行すると、GBIFの生物記録とOpenStreetMapの保護区域から判定します。"
        : "GBIFは観察記録の集積であり、記録が無いことは生息していないことを意味しません。保護区域はOpenStreetMap由来の参考値です。正式な指定はKBA・自然共生サイト・国立公園等の所管データでご確認ください。",
      source: [bio ? "GBIF" : null, pa ? "OpenStreetMap" : null].filter(Boolean).join(" / ") || undefined,
      fetchedAt: publicOf("gbif")?.fetched_at ?? publicOf("osm_protected")?.fetched_at ?? null,
    },
    {
      key: "high_integrity",
      title: "生態系の完全性が高い地域",
      assessable: false,
      proxy: hasMeshResult,
      result: hasMeshResult ? `参考：環境類似度 ${meshStats?.sim_min?.toFixed(2) ?? "—"}〜${meshStats?.sim_max?.toFixed(2) ?? "—"}。完全性は未判定` : "判定不可",
      requires: "環境類似度は生態系完全性を測る指標ではありません。比較基準にはデモや地図指定が含まれ得ます。生態系状態の専門家評価と独立した指標が必要です。",
      source:
        hasMeshResult && (mesh?.reference_points ?? 0) > 0
          ? "自システムの10mメッシュ解析（Google Satellite Embedding V1 Annual）"
          : undefined,
      fetchedAt: mesh?.completed_at ?? null,
    },
    {
      key: "rapid_decline",
      title: "生態系の完全性が急速に低下している地域",
      assessable: false,
      proxy: hasMeshResult && mesh?.detect_change === 1,
      result: hasMeshResult && mesh?.detect_change === 1 ? `参考：最大変化スコア ${meshStats?.chg_max?.toFixed(3) ?? "—"}。完全性の低下は未判定` : "判定不可",
      requires: "衛星特徴の変化だけでは、生態系の悪化・回復やその原因を判定できません。現地記録と複数年の状態評価を組み合わせてください。",
      source:
        hasMeshResult && mesh?.detect_change === 1
          ? "自システムの10mメッシュ解析（Google Satellite Embedding V1 Annual）"
          : undefined,
      fetchedAt: mesh?.completed_at ?? null,
    },
    {
      key: "water_risk",
      title: "物理的な水リスクが高い地域",
      assessable: Boolean(hz),
      result: (() => {
        if (!hz) return "判定不可（公的データ未取得）";
        const hit = hz.layers.filter((l) => l.group === "water" && l.present === true);
        return hit.length > 0
          ? `該当あり：${hit.map((l) => l.label).join("・")}（周辺約${hz.tileSpanM}m四方の範囲内）`
          : `該当なし：洪水・高潮・津波の想定区域は検出されず（周辺約${hz.tileSpanM}m四方）`;
      })(),
      requires: !hz
        ? "「公的データと照合」を実行すると、国土地理院ハザードマップポータルの配信タイルから判定します。"
        : `判定はタイル単位（約${hz.tileSpanM}m四方）での該当有無です。地点そのものが区域内にあるかは「重ねるハザードマップ」でご確認ください。渇水・取水制限等の水ストレスは本判定に含みません。`,
      source: hz ? "国土地理院 ハザードマップポータルサイト" : undefined,
      fetchedAt: publicOf("gsi_hazard")?.fetched_at ?? null,
    },
    {
      key: "ecosystem_services",
      title: "生態系サービス供給上、重要な地域",
      // Deliberately never "assessed". No authoritative nationwide dataset of
      // ecosystem service provision is published as an open API, so what is
      // offered here is a derived indicator - and labelling a proxy as an
      // assessment is exactly the overstatement this report exists to avoid.
      assessable: false,
      proxy: Boolean(hz && hasMeshResult),
      result:
        hz && hasMeshResult
          ? `参考指標：${hz.landslidePresent ? "周辺に土砂災害警戒区域があり、" : ""}植生の状態は類似度 ${meshStats?.sim_min?.toFixed(2) ?? "—"}〜${meshStats?.sim_max?.toFixed(2) ?? "—"} の範囲。${hz.landslidePresent ? "当該植生が土砂流出防備の機能を担っている可能性があります。" : "土砂災害警戒区域は周辺に検出されていません。"}`
          : "判定不可",
      requires:
        hz && hasMeshResult
          ? "これは代理指標であり、生態系サービスの評価ではありません。水源涵養・土壌保持・受粉等の定量評価には、保安林指定等の個別データと専門家評価が必要です。"
          : "水源涵養・土壌保持・受粉等のサービス評価が必要です。本システムには、その評価に必要なデータを接続していません。",
      source: hz && hasMeshResult ? "国土地理院ハザードマップ ＋ 自システムの植生解析（代理指標）" : undefined,
      fetchedAt: publicOf("gsi_hazard")?.fetched_at ?? null,
    },
  ];

  // --- The 16 components ----------------------------------------------------
  const components: LeapComponent[] = [];
  const add = (c: LeapComponent) => components.push(c);

  add({
    code: "S",
    phase: "scoping",
    titleEn: "Scoping",
    title: "スコーピング",
    question: "何を対象に、どの範囲まで、どの仮説を検証するのか。",
    coverage: "partial",
    verdict:
      "対象地と解析範囲は本システムで定義済み。バリューチェーン（上流・下流）の範囲設定は利用者側の作業です。",
    items: [
      {
        label: "対象範囲",
        value: project.area_ha
          ? `${project.name}／${project.area_ha.toLocaleString()} ha`
          : `${project.name}（面積未登録）`,
        basis: project.area_ha ? "configured" : "missing",
      },
      {
        label: "ユースケース区分",
        value: project.use_case,
        basis: "configured",
      },
      {
        label: "解析対象年",
        value: mesh ? `${mesh.year}年（前年比較 ${mesh.detect_change === 1 ? "あり" : "なし"}）` : "未設定",
        basis: mesh ? "configured" : "missing",
      },
    ],
    gaps: [
      "バリューチェーン上流・下流の範囲設定は本システムの対象外です。",
      "評価の目的（新規立地判断／既存拠点の開示／認定申請）を先に確定してください。出力の使い方が変わります。",
    ],
  });

  add({
    code: "L1",
    phase: "locate",
    titleEn: "Span of the business model and value chain",
    title: "事業モデルとバリューチェーンの範囲",
    question: "直接操業する資産・拠点と、関連するバリューチェーンの活動はどこにあるか。",
    coverage: sites.length > 0 ? "partial" : "not_covered",
    verdict:
      sites.length > 0
        ? `直接操業に関する ${sites.length} 地点を座標で特定済み。`
        : "拠点が登録されていません。座標を登録すると特定できます。",
    items: [
      {
        label: "スクリーニング対象地点数",
        value: `${sites.length} 地点`,
        basis: sites.length > 0 ? "configured" : "missing",
      },
      {
        label: "対象地の中心座標",
        value:
          project.center_lat != null && project.center_lng != null
            ? `${project.center_lat.toFixed(5)}, ${project.center_lng.toFixed(5)}`
            : "未登録",
        basis: project.center_lat != null ? "configured" : "missing",
      },
    ],
    gaps: ["上流・下流のバリューチェーン拠点は登録・評価の対象外です。"],
  });

  add({
    code: "L2", phase: "locate", titleEn: "Dependency and impact screening", title: "依存・影響のスクリーニング",
    question: "どの事業・バリューチェーン・直接操業に、自然への中程度以上の依存・影響があり得るか。",
    coverage: "not_covered",
    verdict: "事業別の依存・影響スクリーニングは未実施です。ユースケースの登録だけでは評価できません。",
    items: [{label:"ユースケース区分",value:project.use_case,basis:"configured"}],
    gaps: ["事業活動とバリューチェーンを特定し、依存・影響のスクリーニングを実施してください。"],
  });

  add({
    code: "L3",
    phase: "locate",
    titleEn: "Interface with nature",
    title: "自然との接点",
    question:
      "それらの活動はどのバイオーム・生態系と接しているか。各地点の生態系の完全性と重要性は現在どうか。",
    coverage: hasMeshResult ? "partial" : "not_covered",
    verdict: hasMeshResult
      ? "衛星による地表状態と前年比変化は実測済み。ただしバイオーム・生態系タイプの分類は未接続のため、「どの生態系か」は本システムでは確定できません。"
      : "10mメッシュ解析が未実施のため、自然との接点は把握できていません。",
    items: [
      {
        label: "解析条件",
        value: mesh ? `${mesh.cell_size_m}m メッシュ／${mesh.extent_m}m四方` : "未実施",
        basis: mesh ? "configured" : "missing",
      },
      {
        label: "実際に取得したマス数",
        value: hasMeshResult ? `${sampled.toLocaleString()} マス` : "未取得",
        basis: hasMeshResult ? "measured" : "missing",
      },
      {
        label: "地表状態の分布",
        value: cellCounts.length
          ? cellCounts
              .map((c) => `${CELL_CLASS_LABEL[c.cell_class as CellClass] ?? c.cell_class} ${c.n}マス`)
              .join("／")
          : "未実施",
        basis: cellCounts.length ? "measured" : "missing",
      },
      {
        label: "基準地点との類似度（範囲）",
        value:
          meshStats?.sim_max != null
            ? `${meshStats.sim_min?.toFixed(2)} 〜 ${meshStats.sim_max.toFixed(2)}`
            : "未算出",
        basis: meshStats?.sim_max != null ? "measured" : "missing",
      },
      {
        label: "生態系タイプの分類",
        value: "未実施",
        basis: "missing",
        note: "バイオーム／生態系タイプの判定には土地被覆分類データとの接続が必要です。",
      },
    ],
    gaps: [
      "バイオーム・生態系タイプの分類が未接続です。TNFDが求める「どの生態系と接しているか」の記述には、土地被覆分類データとの照合が必要です。",
      "生態系の重要性（希少性・代替不可能性）の判定は未接続です。",
    ],
  });

  add({
    code: "L4",
    phase: "locate",
    titleEn: "Interface with sensitive locations",
    title: "感度の高い地域との接点",
    question:
      "高い生態系完全性を持つ地域、完全性が急速に低下している地域、生物多様性上重要な地域、水ストレス地域、重大な依存・影響が想定される地域はどこか。",
    coverage: sensitive.some((s) => s.assessable) ? "partial" : "not_covered",
    verdict: `5基準のうち、参照情報を取得しているのは ${sensitive.filter(s=>s.assessable).length} 基準です。衛星の類似度・変化は補助情報であり、完全性の評価は未実施です。正式な指定・現地状態との照合が必要です。`,
    items: sensitive.map((s) => ({
      label: s.title,
      value: s.result,
      basis: s.assessable ? ("configured" as const) : ("missing" as const),
      note: s.requires,
    })),
    gaps: sensitive.filter((s) => !s.assessable).map((s) => `${s.title}：${s.requires ?? "データ未接続"}`),
  });

  add({
    code: "E1",
    phase: "evaluate",
    titleEn: "Identification of environmental assets, ecosystem services and impact drivers",
    title: "環境資産・生態系サービス・影響要因の特定",
    question: "各優先地域でどの事業活動が行われ、どの環境資産・生態系サービスに依存／影響しているか。",
    coverage: "not_covered",
    verdict:
      "セクター別の依存・影響マッピング（ENCORE等）は未接続です。本システムは影響側の面的変化を測るもので、依存側の特定は行いません。",
    items: [
      {
        label: "依存・影響マッピング",
        value: "未実施",
        basis: "missing",
        note: "セクター×生態系サービスの標準マッピングとの接続が必要です。",
      },
    ],
    gaps: ["生態系サービスへの依存（水源涵養・受粉・土壌保持等）の特定は専門家評価を別途実施してください。"],
  });

  add({
    code: "E2",
    phase: "evaluate",
    titleEn: "Identification of dependencies and impacts",
    title: "依存と影響の特定",
    question: "各優先地域で、どのような自然関連の依存と影響があるか。",
    coverage: confirmedField > 0 || hasMeshResult ? "partial" : "not_covered",
    verdict:
      confirmedField > 0
        ? "現地で確認された種と、衛星による面的変化から、影響側の手がかりを提示しています。依存側は対象外です。"
        : "現地確認済みの記録がないため、影響の内容を裏付ける一次データがありません。",
    items: [
      {
        label: "現地確認された生物・植物",
        value: species.length ? species.map((s) => s.species_guess).join("、") : "確認済み記録なし",
        basis: species.length ? "field_confirmed" : "missing",
      },
      {
        label: "現地記録の件数",
        value: `現地確認済み ${confirmedField} 件／未査読 ${unreviewed} 件`,
        basis: confirmedField > 0 ? "field_confirmed" : "missing",
      },
      {
        label: "地図上で指定した基準地点",
        value: `${mapPins} 地点`,
        basis: mapPins > 0 ? "map_designated" : "missing",
        note:
          mapPins > 0
            ? "衛星画像上での指定であり、現地確認の記録ではありません。判定の裏付けとしては現地記録より弱いものです。"
            : undefined,
      },
    ],
    gaps: [
      confirmedField === 0
        ? "現地確認済みの記録がありません。開示に用いる前に現地調査を実施してください。"
        : "確認種は調査時点のものであり、網羅的な種リストではありません。",
      "依存（自然から受けている便益）の特定は本システムの対象外です。",
    ],
  });

  add({
    code: "E3",
    phase: "evaluate",
    titleEn: "Dependency and impact measurement",
    title: "依存と影響の測定",
    question: "依存の規模と範囲、負の影響の深刻度、正の影響の規模と範囲はどれほどか。",
    coverage: hasMeshResult ? "partial" : "not_covered",
    verdict: hasMeshResult
      ? "影響側は面積（ha）と変化スコアで定量化済み。依存側は未測定です。"
      : "メッシュ解析が未実施のため、定量化できていません。",
    items: [
      {
        label: "保全上の配慮が必要な面積",
        value: hasMeshResult ? `${areaOf("priority_a").toFixed(2)} ha（${countOf("priority_a")} 区域）` : "未算出",
        basis: hasMeshResult ? "measured" : "missing",
      },
      {
        label: "回復候補の面積",
        value: hasMeshResult ? `${areaOf("similar").toFixed(2)} ha（${countOf("similar")} 区域）` : "未算出",
        basis: hasMeshResult ? "measured" : "missing",
      },
      {
        label: "大きな変化を検出した面積",
        value: hasMeshResult ? `${areaOf("changed").toFixed(2)} ha（${countOf("changed")} 区域）` : "未算出",
        basis: hasMeshResult ? "measured" : "missing",
      },
      {
        label: "使用した指標",
        value: "Satellite Embedding 類似度（64次元・10m・年次）、前年比変化スコア、NDVI／NDRE／NDMI／NBR",
        basis: "configured",
      },
    ],
    gaps: ["依存側（水・土壌・受粉等）の規模と範囲は未測定です。", "正の影響の測定は施策実施後の効果検証で行います。"],
  });

  add({
    code: "E4",
    phase: "evaluate",
    titleEn: "Impact materiality assessment",
    title: "影響の重要性評価",
    question: "どの影響が重要（material）か。",
    coverage: "not_covered",
    verdict: "重要性の判断基準は企業ごとに定めるものであり、本システムは判定しません。判断材料として面積と変化量を提供します。",
    items: [
      {
        label: "重要性の判断",
        value: "未判定",
        basis: "missing",
        note: "企業の重要性判断基準（閾値）を設定のうえ、社内で判定してください。",
      },
    ],
    gaps: ["重要性の閾値設定と判定は、企業の開示方針に基づき実施してください。"],
  });

  const riskItems: LeapItem[] = [
    {
      label: "物理的リスク（生息環境への影響）",
      value:
        countOf("priority_a") > 0
          ? `保全上の配慮が必要な区域 ${areaOf("priority_a").toFixed(2)}ha に事業が及ぶ場合、回復困難な影響が生じる可能性があります。`
          : hasMeshResult
            ? "しきい値を超える区域は検出されていません。"
            : "未評価",
      basis: hasMeshResult ? "measured" : "missing",
    },
    {
      label: "移行リスク（規制・開示）",
      value:
        "TNFD／SSBJ開示、環境影響評価、林地開発許可等の要否は事業規模と立地により決まります。本システムは判定しません。",
      basis: "missing",
      note: "法令適合性の判断は、必ず所管行政庁および専門家に確認してください。",
    },
    {
      label: "機会（回復による価値創出）",
      value:
        countOf("similar") > 0
          ? `回復候補区域 ${areaOf("similar").toFixed(2)}ha は現地調査の候補です。回復効果・費用対効果・代償措置への適合性は未評価です。`
          : "回復候補区域は検出されていません。",
      basis: hasMeshResult ? "measured" : "missing",
    },
  ];

  add({
    code: "A1",
    phase: "assess",
    titleEn: "Risk and opportunity identification",
    title: "リスクと機会の特定",
    question: "対応するリスクと機会は何か。",
    coverage: hasMeshResult ? "partial" : "not_covered",
    verdict: hasMeshResult
      ? "スクリーニング結果からリスク・機会の候補を提示しています。網羅性は保証しません。"
      : "スクリーニングが未実施のため、候補を提示できません。",
    items: riskItems,
    gaps: ["バリューチェーン上流・下流のリスクは対象外です。", "評判・市場・賠償責任リスクは本システムの対象外です。"],
  });

  const stageRows = (stage: string) => actions.filter((a) => a.stage === stage);
  const stageItem = (stage: string, label: string): LeapItem => {
    const rows = stageRows(stage);
    const total = rows.reduce((s, r) => s + r.n, 0);
    const area = rows.reduce((s, r) => s + (r.area_ha ?? 0), 0);
    const done = rows.filter((r) => r.status === "done").reduce((s, r) => s + r.n, 0);
    return {
      label,
      value: total > 0 ? `${total} 件（対象 ${area.toFixed(2)}ha／完了 ${done} 件）` : "施策なし",
      basis: total > 0 ? "configured" : "missing",
    };
  };

  add({
    code: "A2",
    phase: "assess",
    titleEn: "Adjustment of existing risk mitigation and risk and opportunity management",
    title: "既存の低減策・管理手法",
    question: "すでに適用している低減策・管理手法は何か。",
    coverage: actions.length > 0 ? "partial" : "not_covered",
    verdict:
      actions.length > 0
        ? "本システムに登録された施策のみを集計しています。社内で既に実施している管理手法は含みません。"
        : "登録された施策がありません。",
    items: [
      stageItem("avoid", "回避（Avoid）"),
      stageItem("reduce", "低減（Reduce／Minimise）"),
      stageItem("restore", "回復（Restore／Regenerate）"),
      stageItem("offset", "オフセット（代償）"),
    ],
    gaps: ["社内で既に実施している環境管理施策は、別途棚卸のうえ追記してください。"],
  });

  add({
    code: "A3",
    phase: "assess",
    titleEn: "Risk and opportunity measurement and prioritisation",
    title: "リスクと機会の測定・優先順位づけ",
    question: "どのリスク・機会を優先すべきか。",
    coverage: hasMeshResult || candidates.length > 0 ? "partial" : "not_covered",
    verdict:
      hasMeshResult || candidates.length > 0
        ? "衛星解析区域の面積・連結度・信号強度から、現地確認の候補を整理しています。企業の重要性判断と財務影響の定量化は未実装です。"
        : "順位づけの材料がありません。",
    items: [
      {
        label: "区域の優先順位",
        value: hasMeshResult
          ? `重要区域 ${countOf("priority_a") + countOf("similar") + countOf("changed")} 件を面積・連結度・信号強度で順位づけ済み`
          : "未算出",
        basis: hasMeshResult ? "measured" : "missing",
      },
      {
        label: "候補地の順位",
        value: candidates.length
          ? `${candidates.length}地点の比較デモあり。正式な順位は未評価`
          : "候補地比較は未実施",
        basis: candidates.length ? "estimated" : "missing",
        note: candidates.length
          ? "総合スコアの構成要素のうち、生息地重複度・保護区域距離・アクセスは本MVPではシミュレーション値です。"
          : undefined,
      },
    ],
    gaps: ["財務影響（コスト増分・回避便益）の定量化は未実装です。"],
  });

  add({
    code: "A4",
    phase: "assess",
    titleEn: "Risk and opportunity materiality assessment",
    title: "リスクと機会の重要性評価",
    question: "どのリスク・機会が重要であり、TNFD推奨開示に沿って開示すべきか。",
    coverage: "not_covered",
    verdict: "重要性の判定は企業の開示方針に基づく判断であり、本システムは行いません。",
    items: [{ label: "重要性の判定", value: "未判定", basis: "missing" }],
    gaps: ["開示対象とするリスク・機会の選定は、社内の重要性判断プロセスで決定してください。"],
  });

  add({
    code: "P1",
    phase: "prepare",
    titleEn: "Strategy and resource allocation plans",
    title: "戦略と資源配分の計画",
    question: "この分析の結果、どのようなリスク管理・戦略・資源配分の意思決定を行うか。",
    coverage: actions.length > 0 ? "partial" : "not_covered",
    verdict:
      actions.length > 0
        ? "区域ごとに、緩和ヒエラルキー（回避→低減→回復→オフセット）の順で施策案を生成しています。予算配分は含みません。"
        : "施策案が未生成です。メッシュ解析を実行すると生成されます。",
    items: [
      stageItem("avoid", "回避"),
      stageItem("reduce", "低減"),
      stageItem("restore", "回復"),
      stageItem("offset", "オフセット"),
      {
        label: "対応するSBTNのAR3T区分",
        value: "Avoid／Reduce／Restore・Regenerate／（Transformは対象外）",
        basis: "configured",
        note: "緩和ヒエラルキー（IFC PS6由来）とAR3Tの対応関係です。Transform（システム変革）は本システムの範囲外です。",
      },
    ],
    gaps: ["予算・人員の配分計画は本システムの対象外です。"],
  });

  add({
    code: "P2",
    phase: "prepare",
    titleEn: "Target setting and performance management",
    title: "目標設定と実績管理",
    question: "どう目標を設定し、進捗をどう定義・測定するか。",
    coverage: actions.length > 0 ? "partial" : "not_covered",
    verdict:
      actions.length > 0
        ? "施策ごとに測定指標・頻度・対象面積を設定済み。科学的根拠に基づく目標（SBTs for Nature）との整合は未実施です。"
        : "目標設定の対象となる施策がありません。",
    items: [
      {
        label: "測定指標",
        value: "Satellite Embedding 類似度、前年比変化スコア、NDVI／NDRE／NDMI／NBR、現地確認種数、改変面積(ha)",
        basis: "configured",
      },
      { label: "測定頻度", value: "衛星：年1回（対象年更新時）／現地：施策区分により年1〜2回", basis: "configured" },
      {
        label: "科学的根拠に基づく目標との整合",
        value: "未実施",
        basis: "missing",
        note: "SBTN の目標設定手法との整合確認は別途必要です。",
      },
    ],
    gaps: ["ベースライン年の確定と、目標値の設定は利用者側で行ってください。"],
  });

  add({
    code: "P3",
    phase: "prepare",
    titleEn: "Reporting",
    title: "報告",
    question: "TNFD推奨開示に沿って何を開示するか。",
    coverage: "partial",
    verdict:
      "本スクリーニング帳票は、TNFD推奨開示のうち「戦略」「指標と目標」の一部に資する素材を提供します。14の推奨開示への対応は利用者側の作業です。",
    items: [
      {
        label: "本帳票が資する開示領域",
        value: "戦略（優先地域・影響面積）、指標と目標（測定指標・頻度）",
        basis: "configured",
      },
      {
        label: "ガバナンス／リスクと影響の管理",
        value: "対象外",
        basis: "missing",
        note: "取締役会の監督体制、リスク管理プロセスの記述は企業側の作業です。",
      },
    ],
    gaps: ["TNFDの4つの柱・14の推奨開示への対応整理は、本帳票を素材として社内で実施してください。"],
  });

  add({
    code: "P4",
    phase: "prepare",
    titleEn: "Presentation",
    title: "提示",
    question: "自然関連開示をどこで、どのように提示するか。",
    coverage: "not_covered",
    verdict: "開示媒体（有価証券報告書、統合報告書、サステナビリティ報告書等）の選択は企業の判断です。",
    items: [
      {
        label: "開示媒体",
        value: "未設定",
        basis: "missing",
        note: "開示媒体と適用される基準・時期は、企業の状況と最新の公式情報に基づいて確認してください。",
      },
    ],
    gaps: ["開示媒体と時期の決定は、開示規制の適用時期を踏まえて計画してください。"],
  });

  const coverageCount = (c: Coverage) => components.filter((x) => x.coverage === c).length;

  return {
    project: {
      id: project.id,
      name: project.name,
      clientName: project.client_name,
      useCase: project.use_case,
      areaHa: project.area_ha,
      centerLat: project.center_lat,
      centerLng: project.center_lng,
    },
    generatedAt: new Date().toISOString(),
    dataAsOf: mesh?.completed_at ?? mesh?.created_at ?? null,
    meshId: mesh?.id ?? null,
    meshComplete,
    sites,
    sensitive,
    publicData,
    screenPoint,
    components,
    coverageSummary: {
      covered: coverageCount("covered"),
      partial: coverageCount("partial"),
      notCovered: coverageCount("not_covered"),
      total: components.length,
    },
    provenance: {
      analysisId: analysis?.id ?? null,
      model: analysis?.model ?? null,
      engineVersion: analysis?.engine_version ?? null,
      earthEngineYear: analysis?.earth_engine_year ?? mesh?.year ?? null,
      embeddingDataset: analysis?.embedding_dataset ?? "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL",
      indicesDataset: analysis?.indices_dataset ?? "COPERNICUS/S2_SR_HARMONIZED",
      earthEngineAvailable: analysis ? analysis.earth_engine_available === 1 : null,
      executedAt: analysis?.executed_at ?? null,
    },
    /** Everything a reviewer must supply before this can inform a disclosure. */
    outstanding: components.flatMap((c) => c.gaps),
  };
}

export type LeapReport = Awaited<ReturnType<typeof buildLeapReport>>;
