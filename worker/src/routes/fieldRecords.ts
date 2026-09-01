import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { newId } from "../lib/crypto";
import { logAudit } from "../lib/db";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const fieldRecordRoutes = new Hono<AppEnv>();

function extFromContentType(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

// Mounted at /api/projects/:id/field-records
fieldRecordRoutes.get("/projects/:id/field-records", async (c) => {
  const projectId = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    `SELECT fr.*, u.name as observer_name FROM field_records fr JOIN users u ON u.id = fr.observer_id
     WHERE fr.project_id = ? ORDER BY fr.captured_at DESC`,
  )
    .bind(projectId)
    .all();
  return c.json({ records: results });
});

fieldRecordRoutes.post("/projects/:id/field-records", async (c) => {
  const user = c.get("user") as AuthUser;
  const projectId = c.req.param("id");
  const body = await c.req.json<{
    lat?: number;
    lng?: number;
    gpsAccuracyM?: number;
    speciesGuess?: string;
    taxonConfidence?: string;
    notes?: string;
    capturedAt?: string;
    photoBase64?: string;
    photoContentType?: string;
  }>();

  if (body.lat == null || body.lng == null) {
    return c.json({ error: "位置情報（緯度・経度）が取得できませんでした。" }, 400);
  }

  const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB - generous for a phone camera photo, small enough to avoid abuse
  if (body.photoBase64 && body.photoBase64.length * 0.75 > MAX_PHOTO_BYTES) {
    return c.json({ error: "写真のサイズが大きすぎます（8MBまで）。" }, 400);
  }

  const id = newId("fld");
  let photoKey: string | null = null;
  let photoContentType: string | null = null;

  if (body.photoBase64) {
    photoContentType = body.photoContentType || "image/jpeg";
    const ext = extFromContentType(photoContentType);
    photoKey = `field/${projectId}/${id}.${ext}`;
    const bytes = Uint8Array.from(atob(body.photoBase64), (ch) => ch.charCodeAt(0));
    await c.env.PHOTOS.put(photoKey, bytes, { httpMetadata: { contentType: photoContentType } });
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO field_records (id, project_id, observer_id, lat, lng, gps_accuracy_m, species_guess, taxon_confidence, notes, photo_key, photo_content_type, captured_at, review_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?)`,
  )
    .bind(
      id,
      projectId,
      user.id,
      body.lat,
      body.lng,
      body.gpsAccuracyM ?? null,
      body.speciesGuess ?? null,
      body.taxonConfidence ?? null,
      body.notes ?? null,
      photoKey,
      photoContentType,
      body.capturedAt ?? now,
      now,
    )
    .run();

  await logAudit(c.env.DB, user.id, "field_record.create", id, { projectId });
  return c.json({ id });
});

fieldRecordRoutes.post("/field-records/:id/review", async (c) => {
  const user = c.get("user") as AuthUser;
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string }>();
  if (!["confirmed", "rejected"].includes(body.status ?? "")) {
    return c.json({ error: "不正な値です。" }, 400);
  }
  await c.env.DB.prepare(
    "UPDATE field_records SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
  )
    .bind(body.status, user.id, new Date().toISOString(), id)
    .run();
  await logAudit(c.env.DB, user.id, "field_record.review", id, { status: body.status });
  return c.json({ ok: true });
});

fieldRecordRoutes.get("/field-records/:id/photo", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT photo_key, photo_content_type FROM field_records WHERE id = ?")
    .bind(id)
    .first<{ photo_key: string | null; photo_content_type: string | null }>();
  if (!row?.photo_key) return c.notFound();

  const object = await c.env.PHOTOS.get(row.photo_key);
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      "content-type": row.photo_content_type ?? "application/octet-stream",
      "cache-control": "private, max-age=86400",
    },
  });
});
