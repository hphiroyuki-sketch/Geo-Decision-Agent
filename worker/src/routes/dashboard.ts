import { Hono } from "hono";
import type { Env, AuthUser } from "../types";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const dashboardRoutes = new Hono<AppEnv>();

export interface ActionItem {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  projectId: string | null;
  projectName: string | null;
  lat: number | null;
  lng: number | null;
  at: string;
  link: string;
}

/**
 * Cross-project overview (V-06 / FR-004, FR-041).
 *
 * Every tile counts something the system actually holds - monitored area comes
 * from sampled mesh cells, not from an asset register we do not have - so the
 * dashboard cannot show a number nobody can trace back to a row.
 */
dashboardRoutes.get("/", async (c) => {
  const [projects, meshStats, hotspotStats, fieldStats, actionStats] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.id, p.name, p.status, p.use_case, p.center_lat, p.center_lng, p.area_ha, p.updated_at,
              u.name AS owner_name,
              (SELECT COUNT(*) FROM mesh_cells mc JOIN meshes m ON m.id = mc.mesh_id
                WHERE m.project_id = p.id AND mc.status = 'sampled') AS sampled_cells,
              (SELECT COUNT(*) FROM mesh_cells mc JOIN meshes m ON m.id = mc.mesh_id
                WHERE m.project_id = p.id) AS total_cells,
              (SELECT COUNT(*) FROM site_candidates WHERE project_id = p.id) AS candidates,
              (SELECT COUNT(*) FROM field_records WHERE project_id = p.id) AS field_records
       FROM projects p LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.updated_at DESC`,
    ).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS sampled_cells,
              COALESCE(SUM(m.cell_size_m * m.cell_size_m), 0) / 10000.0 AS monitored_ha
       FROM mesh_cells mc JOIN meshes m ON m.id = mc.mesh_id WHERE mc.status = 'sampled'`,
    ).first<{ sampled_cells: number; monitored_ha: number }>(),
    c.env.DB.prepare(
      `SELECT cell_class, COUNT(*) AS n, COALESCE(SUM(area_ha), 0) AS area_ha
       FROM mesh_hotspots GROUP BY cell_class`,
    ).all<{ cell_class: string; n: number; area_ha: number }>(),
    c.env.DB.prepare(
      `SELECT review_status, COUNT(*) AS n FROM field_records GROUP BY review_status`,
    ).all<{ review_status: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM recovery_actions GROUP BY status`,
    ).all<{ status: string; n: number }>(),
  ]);

  const hotspotBy = Object.fromEntries(hotspotStats.results.map((r) => [r.cell_class, r]));
  const fieldBy = Object.fromEntries(fieldStats.results.map((r) => [r.review_status, r.n]));
  const actionBy = Object.fromEntries(actionStats.results.map((r) => [r.status, r.n]));

  const unreviewed = Number(fieldBy.unreviewed ?? 0);
  const changed = hotspotBy.changed?.n ?? 0;

  const kpis = [
    {
      key: "monitored",
      label: "監視区画",
      value: meshStats?.sampled_cells ?? 0,
      unit: "セル",
      sub: `${(meshStats?.monitored_ha ?? 0).toFixed(2)} ha を10mメッシュで監視`,
      tone: "info" as const,
    },
    {
      key: "attention",
      label: "要確認",
      value: changed + unreviewed,
      unit: "件",
      sub: `変化検出 ${changed} 区域 ／ 未査読の現地記録 ${unreviewed} 件`,
      tone: "warn" as const,
    },
    {
      key: "recovery",
      label: "回復候補区域",
      value: hotspotBy.similar?.n ?? 0,
      unit: "区域",
      sub: `${(hotspotBy.similar?.area_ha ?? 0).toFixed(2)} ha が回復施策の対象候補`,
      tone: "good" as const,
    },
    {
      key: "protect",
      label: "保全優先区域",
      value: hotspotBy.priority_a?.n ?? 0,
      unit: "区域",
      sub: `${(hotspotBy.priority_a?.area_ha ?? 0).toFixed(2)} ha が優先度A判定`,
      tone: "alert" as const,
    },
  ];

  return c.json({
    kpis,
    projects: projects.results,
    actionSummary: {
      proposed: Number(actionBy.proposed ?? 0),
      accepted: Number(actionBy.accepted ?? 0),
      inProgress: Number(actionBy.in_progress ?? 0),
      done: Number(actionBy.done ?? 0),
    },
  });
});

/** The "対応が必要な項目" feed, ranked by severity then recency (FR-060 の代替）。 */
/**
 * V-01's 最近の分析 feed: what the organisation actually did lately, across
 * every project. A portfolio home that shows only project cards tells you
 * nothing about whether anyone is working; this row does.
 */
dashboardRoutes.get("/recent-activity", async (c) => {
  const { results: analyses } = await c.env.DB.prepare(
    `SELECT a.id, a.executed_at AS at, a.candidate_count, a.earth_engine_available,
            p.id AS project_id, p.name AS project_name, u.name AS actor
     FROM analyses a
     JOIN projects p ON p.id = a.project_id
     LEFT JOIN users u ON u.id = a.run_by
     ORDER BY a.executed_at DESC LIMIT 8`,
  ).all<{
    id: string;
    at: string;
    candidate_count: number;
    earth_engine_available: number;
    project_id: string;
    project_name: string;
    actor: string | null;
  }>();

  const { results: meshes } = await c.env.DB.prepare(
    `SELECT m.id, m.created_at AS at, m.cell_size_m, m.extent_m,
            p.id AS project_id, p.name AS project_name,
            (SELECT COUNT(*) FROM mesh_cells WHERE mesh_id = m.id AND status = 'sampled') AS sampled
     FROM meshes m JOIN projects p ON p.id = m.project_id
     ORDER BY m.created_at DESC LIMIT 8`,
  ).all<{
    id: string;
    at: string;
    cell_size_m: number;
    extent_m: number;
    project_id: string;
    project_name: string;
    sampled: number;
  }>();

  const { results: reports } = await c.env.DB.prepare(
    `SELECT r.id, r.created_at AS at, r.title, p.id AS project_id, p.name AS project_name
     FROM decision_reports r JOIN projects p ON p.id = r.project_id
     ORDER BY r.created_at DESC LIMIT 5`,
  ).all<{ id: string; at: string; title: string; project_id: string; project_name: string }>();

  const items = [
    ...analyses.map((a) => ({
      id: `an-${a.id}`,
      kind: "analysis" as const,
      title: `候補地スコアリング（${a.candidate_count}地点）`,
      projectId: a.project_id,
      projectName: a.project_name,
      at: a.at,
      link: `/projects/${a.project_id}/analysis`,
      note: a.earth_engine_available ? "衛星実データ" : "シミュレーション",
    })),
    ...meshes.map((m) => ({
      id: `me-${m.id}`,
      kind: "mesh" as const,
      title: `${m.cell_size_m}mメッシュ解析（${m.sampled.toLocaleString()}マス取得）`,
      projectId: m.project_id,
      projectName: m.project_name,
      at: m.at,
      link: `/projects/${m.project_id}/mesh?mesh=${m.id}`,
      note: `${m.extent_m}m四方`,
    })),
    ...reports.map((r) => ({
      id: `rp-${r.id}`,
      kind: "report" as const,
      title: r.title,
      projectId: r.project_id,
      projectName: r.project_name,
      at: r.at,
      link: `/projects/${r.project_id}/report`,
      note: null as string | null,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 8);

  return c.json({ items });
});

dashboardRoutes.get("/action-items", async (c) => {
  const items: ActionItem[] = [];

  const { results: changedHotspots } = await c.env.DB.prepare(
    `SELECT h.id, h.area_ha, h.center_lat, h.center_lng, h.mean_change, h.created_at, h.mesh_id,
            p.id AS project_id, p.name AS project_name
     FROM mesh_hotspots h JOIN meshes m ON m.id = h.mesh_id JOIN projects p ON p.id = m.project_id
     WHERE h.cell_class = 'changed' ORDER BY h.importance DESC LIMIT 20`,
  ).all<{
    id: string;
    area_ha: number;
    center_lat: number;
    center_lng: number;
    mean_change: number | null;
    created_at: string;
    mesh_id: string;
    project_id: string;
    project_name: string;
  }>();

  for (const h of changedHotspots) {
    items.push({
      id: h.id,
      severity: "high",
      title: `変化検出 ${h.area_ha.toFixed(2)}ha`,
      detail: `前年比の埋め込み差 平均 ${(h.mean_change ?? 0).toFixed(3)}。原因特定のため現地確認が必要です。`,
      projectId: h.project_id,
      projectName: h.project_name,
      lat: h.center_lat,
      lng: h.center_lng,
      at: h.created_at,
      link: `/projects/${h.project_id}/mesh?mesh=${h.mesh_id}`,
    });
  }

  const { results: unreviewed } = await c.env.DB.prepare(
    `SELECT f.id, f.species_guess, f.lat, f.lng, f.captured_at, p.id AS project_id, p.name AS project_name
     FROM field_records f JOIN projects p ON p.id = f.project_id
     WHERE f.review_status = 'unreviewed' ORDER BY f.captured_at DESC LIMIT 20`,
  ).all<{
    id: string;
    species_guess: string | null;
    lat: number;
    lng: number;
    captured_at: string;
    project_id: string;
    project_name: string;
  }>();

  for (const r of unreviewed) {
    items.push({
      id: r.id,
      severity: "medium",
      title: `未査読の現地記録：${r.species_guess ?? "種未記入"}`,
      detail: "査読して確認済みにするまで、この記録は分析の根拠に使われません。",
      projectId: r.project_id,
      projectName: r.project_name,
      lat: r.lat,
      lng: r.lng,
      at: r.captured_at,
      link: `/projects/${r.project_id}/field`,
    });
  }

  const { results: ownerless } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.area_ha, a.center_lat, a.center_lng, a.created_at,
            p.id AS project_id, p.name AS project_name
     FROM recovery_actions a JOIN projects p ON p.id = a.project_id
     WHERE a.status = 'proposed' AND a.owner_user_id IS NULL ORDER BY a.priority LIMIT 20`,
  ).all<{
    id: string;
    title: string;
    area_ha: number;
    center_lat: number;
    center_lng: number;
    created_at: string;
    project_id: string;
    project_name: string;
  }>();

  for (const a of ownerless) {
    items.push({
      id: a.id,
      severity: "low",
      title: `担当者未設定：${a.title}`,
      detail: `${a.area_ha.toFixed(2)}ha の施策が提案のまま滞留しています。担当者と期限を設定してください。`,
      projectId: a.project_id,
      projectName: a.project_name,
      lat: a.center_lat,
      lng: a.center_lng,
      at: a.created_at,
      link: `/projects/${a.project_id}/recovery`,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.at.localeCompare(a.at));

  return c.json({ items });
});

/** Every recovery action across projects, for the plan-wide view. */
dashboardRoutes.get("/recovery-actions", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, p.name AS project_name, u.name AS owner_name
     FROM recovery_actions a JOIN projects p ON p.id = a.project_id
     LEFT JOIN users u ON u.id = a.owner_user_id
     ORDER BY CASE a.status WHEN 'in_progress' THEN 0 WHEN 'accepted' THEN 1 WHEN 'proposed' THEN 2 ELSE 3 END,
              a.priority`,
  ).all();
  return c.json({ actions: results });
});

/** Field data across projects (the "データ" screen). */
dashboardRoutes.get("/field-records", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.lat, f.lng, f.species_guess, f.taxon_confidence, f.notes, f.photo_key,
            f.captured_at, f.review_status, p.id AS project_id, p.name AS project_name, u.name AS observer_name
     FROM field_records f JOIN projects p ON p.id = f.project_id JOIN users u ON u.id = f.observer_id
     ORDER BY f.captured_at DESC LIMIT 200`,
  ).all();
  return c.json({ records: results });
});

/** Decision reports across projects (the "レポート" screen). */
dashboardRoutes.get("/reports", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, p.name AS project_name FROM decision_reports r JOIN projects p ON p.id = r.project_id
     ORDER BY r.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ reports: results });
});
