import type { Env } from "../types";
import { newId } from "./crypto";

export async function getSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function logAudit(
  db: D1Database,
  actorId: string | null,
  action: string,
  target: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_events (id, actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(newId("aud"), actorId, action, target, detail ? JSON.stringify(detail) : null, new Date().toISOString())
    .run();
}

export function currentMonthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
