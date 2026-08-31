import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, AuthUser } from "../types";
import { verifySessionToken, signSessionToken, newId } from "./crypto";

export const SESSION_COOKIE = "gda_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(env: Env, userId: string): Promise<string> {
  const id = newId("sess");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, now.toISOString(), expires.toISOString())
    .run();
  return signSessionToken(env.SESSION_SECRET, id);
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function destroySession(env: Env, token: string): Promise<void> {
  const sessionId = await verifySessionToken(env.SESSION_SECRET, token);
  if (!sessionId) return;
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export async function resolveUserFromRequest(c: Context<AppEnv>): Promise<AuthUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const sessionId = await verifySessionToken(c.env.SESSION_SECRET, token);
  if (!sessionId) return null;

  const session = await c.env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ user_id: string; expires_at: string }>();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
    return null;
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, name, role, title FROM users WHERE id = ? AND disabled_at IS NULL",
  )
    .bind(session.user_id)
    .first<AuthUser>();
  return user ?? null;
}

export async function attachUser(c: Context<AppEnv>, next: Next) {
  const user = await resolveUserFromRequest(c);
  c.set("user", user);
  await next();
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const user = c.get("user");
  if (!user) return c.json({ error: "認証が必要です。" }, 401);
  await next();
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const user = c.get("user");
  if (!user) return c.json({ error: "認証が必要です。" }, 401);
  if (user.role !== "admin") return c.json({ error: "管理者権限が必要です。" }, 403);
  await next();
}
