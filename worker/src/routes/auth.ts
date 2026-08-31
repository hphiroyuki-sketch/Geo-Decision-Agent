import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { hashPassword, verifyPassword, newId } from "../lib/crypto";
import { createSession, setSessionCookie, clearSessionCookie, destroySession, SESSION_COOKIE } from "../lib/auth";
import { getCookie } from "hono/cookie";
import { logAudit } from "../lib/db";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/invite/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const invite = await c.env.DB.prepare(
    "SELECT code, email, role, used_by, expires_at FROM invites WHERE code = ?",
  )
    .bind(code)
    .first<{ code: string; email: string | null; role: string; used_by: string | null; expires_at: string | null }>();

  if (!invite) return c.json({ valid: false, reason: "この招待コードは見つかりませんでした。" });
  if (invite.used_by) return c.json({ valid: false, reason: "この招待コードは既に使用されています。" });
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return c.json({ valid: false, reason: "この招待コードは有効期限が切れています。" });
  }
  return c.json({ valid: true, email: invite.email, role: invite.role });
});

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{ code?: string; name?: string; email?: string; password?: string }>();
  const code = (body.code ?? "").toUpperCase().trim();
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!code || !name || !email || !password || password.length < 8) {
    return c.json({ error: "招待コード・氏名・メールアドレス・8文字以上のパスワードが必要です。" }, 400);
  }

  const invite = await c.env.DB.prepare("SELECT * FROM invites WHERE code = ?").bind(code).first<{
    id: string;
    email: string | null;
    role: string;
    used_by: string | null;
    expires_at: string | null;
  }>();
  if (!invite) return c.json({ error: "招待コードが無効です。" }, 400);
  if (invite.used_by) return c.json({ error: "この招待コードは既に使用されています。" }, 400);
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return c.json({ error: "この招待コードは有効期限が切れています。" }, 400);
  }
  if (invite.email && invite.email.toLowerCase() !== email) {
    return c.json({ error: "この招待コードは別のメールアドレス宛です。" }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return c.json({ error: "このメールアドレスは既に登録されています。" }, 400);

  const { hash, salt } = await hashPassword(password);
  const userId = newId("usr");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, password_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(userId, email, name, hash, salt, invite.role, now)
    .run();
  await c.env.DB.prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?")
    .bind(userId, now, invite.id)
    .run();
  await logAudit(c.env.DB, userId, "user.register", userId, { email, via_invite: code });

  const token = await createSession(c.env, userId);
  setSessionCookie(c, token);

  const user: AuthUser = { id: userId, email, name, role: invite.role as AuthUser["role"], title: null };
  return c.json({ user });
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return c.json({ error: "メールアドレスとパスワードを入力してください。" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT id, email, name, role, title, password_hash, password_salt FROM users WHERE email = ? AND disabled_at IS NULL",
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      name: string;
      role: string;
      title: string | null;
      password_hash: string;
      password_salt: string;
    }>();

  if (!row) return c.json({ error: "メールアドレスまたはパスワードが正しくありません。" }, 401);
  const ok = await verifyPassword(password, row.password_hash, row.password_salt);
  if (!ok) return c.json({ error: "メールアドレスまたはパスワードが正しくありません。" }, 401);

  const token = await createSession(c.env, row.id);
  setSessionCookie(c, token);
  await logAudit(c.env.DB, row.id, "user.login", row.id);

  const user: AuthUser = { id: row.id, email: row.email, name: row.name, role: row.role as AuthUser["role"], title: row.title };
  return c.json({ user });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env, token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  return c.json({ user });
});
