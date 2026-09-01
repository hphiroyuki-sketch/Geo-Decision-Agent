import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { logAudit } from "../lib/db";
import { runSystemChecks, generateAlerts } from "../lib/scheduled";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const alertRoutes = new Hono<AppEnv>();

alertRoutes.get("/", async (c) => {
  const unreadOnly = c.req.query("unread") === "1";
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, p.name AS project_name FROM alerts a LEFT JOIN projects p ON p.id = a.project_id
     ${unreadOnly ? "WHERE a.read_at IS NULL" : ""}
     ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.created_at DESC
     LIMIT 200`,
  ).all();

  const unread = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL").first<{ n: number }>();
  return c.json({ alerts: results, unread: unread?.n ?? 0 });
});

alertRoutes.get("/unread-count", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL").first<{ n: number }>();
  return c.json({ unread: row?.n ?? 0 });
});

alertRoutes.post("/:id/read", async (c) => {
  const user = c.get("user") as AuthUser;
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE alerts SET read_at = ?, acknowledged_by = ? WHERE id = ?")
    .bind(new Date().toISOString(), user.id, id)
    .run();
  return c.json({ ok: true });
});

alertRoutes.post("/read-all", async (c) => {
  const user = c.get("user") as AuthUser;
  await c.env.DB.prepare("UPDATE alerts SET read_at = ?, acknowledged_by = ? WHERE read_at IS NULL")
    .bind(new Date().toISOString(), user.id)
    .run();
  await logAudit(c.env.DB, user.id, "alerts.read_all", null);
  return c.json({ ok: true });
});

/** Re-evaluates the rules now rather than waiting for the next cron tick. */
alertRoutes.post("/refresh", async (c) => {
  const created = await generateAlerts(c.env);
  return c.json({ ok: true, evaluated: created });
});

alertRoutes.get("/rules", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM alert_rules ORDER BY severity").all();
  return c.json({ rules: results });
});

alertRoutes.post("/rules/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const id = c.req.param("id");
  const body = await c.req.json<{ threshold?: number; enabled?: boolean; severity?: string }>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.threshold !== undefined) {
    sets.push("threshold = ?");
    binds.push(body.threshold);
  }
  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    binds.push(body.enabled ? 1 : 0);
  }
  if (body.severity) {
    sets.push("severity = ?");
    binds.push(body.severity);
  }
  if (sets.length === 0) return c.json({ ok: true });
  binds.push(id);
  await c.env.DB.prepare(`UPDATE alert_rules SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  await logAudit(c.env.DB, user.id, "alert_rule.update", id, body);
  return c.json({ ok: true });
});

/**
 * The most recent result of each scheduled self-check. Surfaced in the admin
 * screen so "is the satellite integration actually working right now" is a
 * question the product answers about itself.
 */
alertRoutes.get("/system-checks", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT check_name, ok, message, detail, duration_ms, checked_at FROM system_checks s
     WHERE checked_at = (SELECT MAX(checked_at) FROM system_checks WHERE check_name = s.check_name)
     ORDER BY check_name`,
  ).all();
  return c.json({ checks: results });
});

/** Runs the checks immediately (admin action, mirrors the cron). */
alertRoutes.post("/system-checks/run", async (c) => {
  const results = await runSystemChecks(c.env);
  return c.json({ checks: results });
});
