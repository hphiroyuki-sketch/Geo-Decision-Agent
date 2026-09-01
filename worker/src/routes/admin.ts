import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { newId, newInviteCode } from "../lib/crypto";
import { getSetting, setSetting, logAudit, currentMonthKey } from "../lib/db";
import { getBudgetStatus } from "../lib/pricing";
import { parseServiceAccountKey, getGoogleAccessToken } from "../lib/googleAuth";
import { fetchEmbeddingVector, listAlgorithms } from "../lib/earthEngine";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const adminRoutes = new Hono<AppEnv>();

/**
 * Earth Engine connectivity check. Reports each stage separately (secret
 * present -> key parses -> OAuth token -> actual EE call) with the raw
 * upstream error text, so a failure names itself instead of silently
 * falling back to simulated values inside the analysis flow.
 * Never returns key material - only the service account's email and errors.
 */
adminRoutes.get("/ee-test", async (c) => {
  const lat = Number(c.req.query("lat") ?? "35.6812");
  const lng = Number(c.req.query("lng") ?? "139.7671");
  const year = Number(c.req.query("year") ?? (await getSetting(c.env.DB, "earth_engine_year", "2024")));

  const result: Record<string, unknown> = { lat, lng, year };

  if (!c.env.EE_SERVICE_ACCOUNT_JSON) {
    result.stage = "secret_missing";
    result.message = "EE_SERVICE_ACCOUNT_JSON が Worker に設定されていません。";
    return c.json(result);
  }
  result.secretPresent = true;

  let key;
  try {
    key = parseServiceAccountKey(c.env.EE_SERVICE_ACCOUNT_JSON);
    result.clientEmail = key.client_email;
    result.projectId = c.env.EE_PROJECT_ID || key.project_id;
  } catch (err) {
    result.stage = "key_parse_failed";
    result.message = err instanceof Error ? err.message : String(err);
    return c.json(result);
  }

  try {
    const token = await getGoogleAccessToken(key, [
      "https://www.googleapis.com/auth/earthengine.readonly",
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);
    result.oauthOk = token.length > 0;
  } catch (err) {
    result.stage = "oauth_failed";
    result.message = err instanceof Error ? err.message : String(err);
    return c.json(result);
  }

  const skipDateFilter = c.req.query("nofilter") === "1";
  result.skipDateFilter = skipDateFilter;

  try {
    const { vector } = await fetchEmbeddingVector(c.env.EE_SERVICE_ACCOUNT_JSON, c.env.EE_PROJECT_ID, lat, lng, year, {
      skipDateFilter,
    });
    result.stage = "ok";
    result.vectorLength = vector.length;
    result.sample = vector.slice(0, 4);
  } catch (err) {
    result.stage = "earth_engine_call_failed";
    result.message = err instanceof Error ? err.message : String(err);
  }

  return c.json(result);
});

/**
 * Lists the Earth Engine algorithms whose names contain ?q=. The expression
 * graph must name server-side algorithms exactly, and those names differ from
 * the client libraries' method names, so this answers "what is this operation
 * really called" directly instead of by trial and redeploy.
 */
adminRoutes.get("/ee-algorithms", async (c) => {
  const q = c.req.query("q") ?? "";
  if (!c.env.EE_SERVICE_ACCOUNT_JSON) {
    return c.json({ error: "EE_SERVICE_ACCOUNT_JSON が Worker に設定されていません。" }, 400);
  }
  try {
    const { total, matches } = await listAlgorithms(c.env.EE_SERVICE_ACCOUNT_JSON, c.env.EE_PROJECT_ID, q);
    return c.json({ query: q, totalAlgorithms: total, matchCount: matches.length, matches });
  } catch (err) {
    return c.json({ query: q, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

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
