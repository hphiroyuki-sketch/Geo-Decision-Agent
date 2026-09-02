import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { newId } from "../lib/crypto";
import { logAudit } from "../lib/db";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name as created_by_name,
       (SELECT COUNT(*) FROM site_candidates sc WHERE sc.project_id = p.id) as candidate_count
     FROM projects p JOIN users u ON u.id = p.created_by
     ORDER BY p.updated_at DESC`,
  ).all();
  return c.json({ projects: results });
});

projectRoutes.post("/", async (c) => {
  const user = c.get("user") as AuthUser;
  const body = await c.req.json<{
    name?: string;
    description?: string;
    useCase?: string;
    areaHa?: number;
    elevationMin?: number;
    elevationMax?: number;
    centerLat?: number;
    centerLng?: number;
  }>();
  if (!body.name?.trim()) return c.json({ error: "案件名を入力してください。" }, 400);

  const id = newId("proj");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO projects (id, name, description, use_case, status, area_ha, elevation_min, elevation_max, center_lat, center_lng, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.name.trim(),
      body.description ?? null,
      body.useCase ?? "UC-01",
      body.areaHa ?? null,
      body.elevationMin ?? null,
      body.elevationMax ?? null,
      body.centerLat ?? 36.2048,
      body.centerLng ?? 138.2529,
      user.id,
      now,
      now,
    )
    .run();
  await logAudit(c.env.DB, user.id, "project.create", id, { name: body.name });
  return c.json({ id });
});

projectRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await c.env.DB.prepare(
    `SELECT p.*, u.name as created_by_name FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = ?`,
  )
    .bind(id)
    .first();
  if (!project) return c.json({ error: "案件が見つかりません。" }, 404);

  const { results: conversations } = await c.env.DB.prepare(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE project_id = ? ORDER BY updated_at DESC",
  )
    .bind(id)
    .all();

  return c.json({ project, conversations });
});

projectRoutes.get("/:id/candidates", async (c) => {
  const id = c.req.param("id");
  const { results: candidates } = await c.env.DB.prepare(
    "SELECT * FROM site_candidates WHERE project_id = ? ORDER BY rank ASC",
  )
    .bind(id)
    .all();

  const candidateIds = (candidates as { id: string }[]).map((r) => r.id);
  let mitigations: unknown[] = [];
  if (candidateIds.length > 0) {
    const placeholders = candidateIds.map(() => "?").join(",");
    const res = await c.env.DB.prepare(
      `SELECT * FROM mitigation_measures WHERE candidate_id IN (${placeholders}) ORDER BY priority ASC`,
    )
      .bind(...candidateIds)
      .all();
    mitigations = res.results;
  }

  // The snapshot behind the newest candidates (output block 8 / FR-007), so the
  // screen can say which model, which satellite year and which rule version
  // produced these numbers instead of presenting them as timeless.
  const analysisId = (candidates as { analysis_id: string | null }[])[0]?.analysis_id ?? null;
  const analysis = analysisId
    ? await c.env.DB.prepare(
        `SELECT a.*, u.name AS run_by_name FROM analyses a
         LEFT JOIN users u ON u.id = a.run_by WHERE a.id = ?`,
      )
        .bind(analysisId)
        .first()
    : null;

  return c.json({ candidates, mitigations, analysis });
});

/** Every recorded run for this project, newest first (FR-037 判断履歴). */
projectRoutes.get("/:id/analyses", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.name AS run_by_name FROM analyses a
     LEFT JOIN users u ON u.id = a.run_by
     WHERE a.project_id = ? ORDER BY a.executed_at DESC LIMIT 20`,
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ analyses: results });
});

projectRoutes.post("/:id/conversations", async (c) => {
  const user = c.get("user") as AuthUser;
  const projectId = c.req.param("id");
  const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
  const id = newId("conv");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO conversations (id, project_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, projectId, user.id, body.title ?? "新しい調査", now, now)
    .run();
  return c.json({ id });
});

projectRoutes.get("/:id/report", async (c) => {
  const id = c.req.param("id");
  const report = await c.env.DB.prepare(
    `SELECT r.*, u.name as created_by_name FROM decision_reports r JOIN users u ON u.id = r.created_by
     WHERE r.project_id = ? ORDER BY r.created_at DESC LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!report) return c.json({ report: null, reviewers: [] });

  const { results: reviewers } = await c.env.DB.prepare(
    "SELECT * FROM report_reviewers WHERE report_id = ?",
  )
    .bind((report as { id: string }).id)
    .all();

  return c.json({ report, reviewers });
});

projectRoutes.post("/:id/report/:reportId/reviewers", async (c) => {
  const actor = c.get("user") as AuthUser;
  const reportId = c.req.param("reportId");
  const body = await c.req.json<{ name?: string; title?: string }>();
  if (!body.name?.trim()) return c.json({ error: "レビュアー名を入力してください。" }, 400);
  const id = newId("rev");
  await c.env.DB.prepare(
    "INSERT INTO report_reviewers (id, report_id, user_id, name, title, status) VALUES (?, ?, ?, ?, ?, 'pending')",
  )
    .bind(id, reportId, actor.id, body.name.trim(), body.title ?? null)
    .run();
  return c.json({ id });
});

projectRoutes.post("/:id/report/:reportId/reviewers/:reviewerId/decision", async (c) => {
  const actor = c.get("user") as AuthUser;
  const reviewerId = c.req.param("reviewerId");
  const body = await c.req.json<{ status?: string }>();
  if (!["approved", "rejected"].includes(body.status ?? "")) return c.json({ error: "不正な値です。" }, 400);
  await c.env.DB.prepare("UPDATE report_reviewers SET status = ?, decided_at = ? WHERE id = ?")
    .bind(body.status, new Date().toISOString(), reviewerId)
    .run();
  await logAudit(c.env.DB, actor.id, "report.review_decision", reviewerId, { status: body.status });
  return c.json({ ok: true });
});

projectRoutes.post("/:id/report", async (c) => {
  const user = c.get("user") as AuthUser;
  const projectId = c.req.param("id");
  const body = await c.req.json<{ title?: string; summary?: string; periodStart?: string; periodEnd?: string }>();
  const id = newId("rpt");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO decision_reports (id, project_id, title, period_start, period_end, summary, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
  )
    .bind(id, projectId, body.title ?? "意思決定レポート", body.periodStart ?? null, body.periodEnd ?? null, body.summary ?? null, user.id, now)
    .run();
  await logAudit(c.env.DB, user.id, "report.create", id, { projectId });
  return c.json({ id });
});
