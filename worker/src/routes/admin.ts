import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { newId, newInviteCode } from "../lib/crypto";
import { getSetting, setSetting, logAudit, currentMonthKey } from "../lib/db";
import { getBudgetStatus } from "../lib/pricing";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get("/invites", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, code, email, role, note, used_by, used_at, expires_at, created_at FROM invites ORDER BY created_at DESC",
  ).all();
  return c.json({ invites: results });
});

adminRoutes.post("/invites", async (c) => {
  const user = c.get("user") as AuthUser;
  const body = await c.req.json<{ email?: string; role?: string; note?: string; expiresInDays?: number }>();
  const role = body.role === "admin" || body.role === "viewer" ? body.role : "member";
  const code = newInviteCode();
  const id = newId("inv");
  const now = new Date();
  const expiresAt = body.expiresInDays ? new Date(now.getTime() + body.expiresInDays * 86400000).toISOString() : null;

  await c.env.DB.prepare(
    "INSERT INTO invites (id, code, email, role, note, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, code, body.email?.trim().toLowerCase() || null, role, body.note ?? null, user.id, expiresAt, now.toISOString())
    .run();
  await logAudit(c.env.DB, user.id, "invite.create", id, { role, email: body.email });

  return c.json({ invite: { id, code, email: body.email ?? null, role, expiresAt } });
});

adminRoutes.delete("/invites/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM invites WHERE id = ? AND used_by IS NULL").bind(id).run();
  await logAudit(c.env.DB, user.id, "invite.revoke", id);
  return c.json({ ok: true });
});

adminRoutes.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, role, title, created_at, disabled_at FROM users ORDER BY created_at ASC",
  ).all();
  return c.json({ users: results });
});

adminRoutes.post("/users/:id/role", async (c) => {
  const actor = c.get("user") as AuthUser;
  const id = c.req.param("id");
  const body = await c.req.json<{ role?: string }>();
  if (!["admin", "member", "viewer"].includes(body.role ?? "")) {
    return c.json({ error: "不正なロールです。" }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(body.role, id).run();
  await logAudit(c.env.DB, actor.id, "user.role_change", id, { role: body.role });
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/disable", async (c) => {
  const actor = c.get("user") as AuthUser;
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  await logAudit(c.env.DB, actor.id, "user.disable", id);
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/enable", async (c) => {
  const actor = c.get("user") as AuthUser;
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").bind(id).run();
  await logAudit(c.env.DB, actor.id, "user.enable", id);
  return c.json({ ok: true });
});

adminRoutes.get("/usage", async (c) => {
  const monthlyBudgetJpy = Number(await getSetting(c.env.DB, "monthly_budget_jpy", c.env.DEFAULT_MONTHLY_BUDGET_JPY));
  const usdJpyRate = Number(await getSetting(c.env.DB, "usd_jpy_rate", c.env.DEFAULT_USD_JPY_RATE));
  const month = currentMonthKey();
  const status = await getBudgetStatus(c.env.DB, month, monthlyBudgetJpy, usdJpyRate);

  const { results: byUser } = await c.env.DB.prepare(
    `SELECT u.name as name, u.email as email, SUM(l.cost_jpy) as cost_jpy, SUM(l.input_tokens) as input_tokens, SUM(l.output_tokens) as output_tokens
     FROM usage_log l JOIN users u ON u.id = l.user_id
     WHERE l.month = ? GROUP BY l.user_id ORDER BY cost_jpy DESC`,
  )
    .bind(month)
    .all();

  const { results: last6mo } = await c.env.DB.prepare(
    `SELECT month, SUM(cost_jpy) as cost_jpy FROM usage_log GROUP BY month ORDER BY month DESC LIMIT 6`,
  ).all();

  return c.json({ month, status, byUser, history: last6mo });
});

adminRoutes.get("/settings", async (c) => {
  const monthlyBudgetJpy = await getSetting(c.env.DB, "monthly_budget_jpy", c.env.DEFAULT_MONTHLY_BUDGET_JPY);
  const usdJpyRate = await getSetting(c.env.DB, "usd_jpy_rate", c.env.DEFAULT_USD_JPY_RATE);
  const claudeModel = await getSetting(c.env.DB, "claude_model", c.env.CLAUDE_MODEL);
  return c.json({ monthlyBudgetJpy: Number(monthlyBudgetJpy), usdJpyRate: Number(usdJpyRate), claudeModel });
});

adminRoutes.post("/settings", async (c) => {
  const actor = c.get("user") as AuthUser;
  const body = await c.req.json<{ monthlyBudgetJpy?: number; usdJpyRate?: number; claudeModel?: string }>();
  if (body.monthlyBudgetJpy !== undefined) await setSetting(c.env.DB, "monthly_budget_jpy", String(body.monthlyBudgetJpy));
  if (body.usdJpyRate !== undefined) await setSetting(c.env.DB, "usd_jpy_rate", String(body.usdJpyRate));
  if (body.claudeModel) await setSetting(c.env.DB, "claude_model", body.claudeModel);
  await logAudit(c.env.DB, actor.id, "settings.update", null, body);
  return c.json({ ok: true });
});

adminRoutes.get("/audit", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.target, a.detail, a.created_at, u.name as actor_name
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT 200`,
  ).all();
  return c.json({ events: results });
});
