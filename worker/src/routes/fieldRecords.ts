import { MAX_MEDIA_BYTES, MEDIA_TYPES, mediaMatchesType } from "../lib/observationMedia";
import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { newId } from "../lib/crypto";
import { logAudit } from "../lib/db";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const fieldRecordRoutes = new Hono<AppEnv>();

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
    locationSource?: string;
  }>().catch(() => null);
  if (!body || Array.isArray(body)) return c.json({error:"入力を確認してください。"},400);

  if (typeof body.lat !== "number" || typeof body.lng !== "number" || !Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat)>90 || Math.abs(body.lng)>180) {
    return c.json({ error: "位置情報（緯度・経度）が取得できませんでした。" }, 400);
  }

  if (!await c.env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(projectId).first()) return c.json({error:"プロジェクトが見つかりません。"},404);
  if (body.gpsAccuracyM != null && (typeof body.gpsAccuracyM !== "number" || !Number.isFinite(body.gpsAccuracyM) || body.gpsAccuracyM < 0)) return c.json({error:"位置精度を確認してください。"},400);
  if (body.capturedAt && !Number.isFinite(Date.parse(body.capturedAt))) return c.json({error:"記録日時を確認してください。"},400);
  if (body.photoBase64 && (typeof body.photoBase64 !== "string" || body.photoBase64.length * .75 > MAX_MEDIA_BYTES + 2)) return c.json({error:"写真・動画は8MBまでです。"},400);
  for (const value of [body.speciesGuess,body.taxonConfidence,body.notes]) if(value!=null && (typeof value!=="string" || value.length>8000)) return c.json({error:"入力が長すぎるか、形式が不正です。"},400);
  if (body.locationSource && !["device","manual"].includes(body.locationSource)) return c.json({error:"位置情報の取得方法を確認してください。"},400);

  const id = newId("fld");
  let photoKey: string | null = null;
  let photoContentType: string | null = null;
  let mediaHash: string | null = null;

  if (body.photoBase64) {
    photoContentType = body.photoContentType || "image/jpeg";
    const ext = MEDIA_TYPES[photoContentType];
    if (!ext) return c.json({error:"JPEG・PNG・WebP写真、MP4・WebM動画に対応しています。"},400);
    photoKey = `field/${projectId}/${id}.${ext}`;
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(body.photoBase64), ch => ch.charCodeAt(0)); }
    catch { return c.json({error:"メディアを読み取れませんでした。"},400); }
    if (bytes.length > MAX_MEDIA_BYTES || !mediaMatchesType(bytes, photoContentType)) return c.json({error:"ファイル形式と内容を確認してください（8MBまで）。"},400);
    mediaHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2,"0")).join("");
    await c.env.PHOTOS.put(photoKey, bytes, { httpMetadata: { contentType: photoContentType } });
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO field_records (id, project_id, observer_id, lat, lng, gps_accuracy_m, species_guess, taxon_confidence, notes, photo_key, photo_content_type, captured_at, review_status, created_at, media_sha256, location_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?, ?, ?)`,
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
      body.capturedAt ? new Date(body.capturedAt).toISOString() : now,
      now,
      mediaHash,
      body.locationSource ?? "unspecified",
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
      "x-content-type-options": "nosniff",
    },
  });
});

fieldRecordRoutes.get("/field-records/:id", async (c) => {
  const record = await c.env.DB.prepare(`SELECT fr.*, u.name AS observer_name FROM field_records fr
    JOIN users u ON u.id = fr.observer_id WHERE fr.id = ?`).bind(c.req.param("id")).first();
  return record ? c.json({ record }) : c.json({ error: "記録が見つかりません。" }, 404);
});
