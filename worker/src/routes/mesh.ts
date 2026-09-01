import { Hono } from "hono";
import type { Env, AuthUser } from "../types";
import { newId } from "../lib/crypto";
import { getSetting, logAudit } from "../lib/db";
import { getReferenceEmbedding, findNearbyFieldRecords } from "../lib/fieldData";
import {
  buildGrid,
  sampleMeshBatch,
  findHotspots,
  MAX_CELLS,
  SAMPLE_BATCH,
  CELL_CLASS_COLOR,
  CELL_CLASS_LABEL,
  PRIORITY_A_THRESHOLD,
  SIMILAR_THRESHOLD,
  CHANGED_THRESHOLD,
  type CellClass,
} from "../lib/mesh";
import { buildRecoveryPlan } from "../lib/recoveryPlan";
import { buildLeapReport } from "../lib/leap";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const meshRoutes = new Hono<AppEnv>();

interface MeshRow {
  id: string;
  project_id: string;
  center_lat: number;
  center_lng: number;
  cell_size_m: number;
  extent_m: number;
  row_count: number;
  col_count: number;
  year: number;
  detect_change: number;
  status: string;
  reference_points: number;
  created_at: string;
  completed_at: string | null;
}

async function loadReference(env: Env, projectId: string, year: number) {
  const reference = await getReferenceEmbedding(env, env.DB, projectId, year);
  return reference;
}

/** Creates a mesh over an AOI and queues every cell for sampling (FR-020). */
meshRoutes.post("/projects/:id/meshes", async (c) => {
  const user = c.get("user") as AuthUser;
  const projectId = c.req.param("id");
  const body = await c.req.json<{
    centerLat?: number;
    centerLng?: number;
    cellSizeM?: number;
    extentM?: number;
    detectChange?: boolean;
  }>();

  const project = await c.env.DB.prepare("SELECT center_lat, center_lng FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ center_lat: number; center_lng: number }>();
  if (!project) return c.json({ error: "プロジェクトが見つかりません。" }, 404);

  const centerLat = body.centerLat ?? project.center_lat;
  const centerLng = body.centerLng ?? project.center_lng;
  if (centerLat == null || centerLng == null) {
    return c.json({ error: "メッシュの中心座標が指定されていません。" }, 400);
  }

  const cellSizeM = body.cellSizeM ?? Number(await getSetting(c.env.DB, "mesh_cell_size_m", "10"));
  const extentM = body.extentM ?? Number(await getSetting(c.env.DB, "mesh_extent_m", "200"));
  const detectChange = body.detectChange !== false;

  const cellCount = Math.round(extentM / cellSizeM) ** 2;
  if (cellCount > MAX_CELLS) {
    // Refuse rather than silently coarsening: the caller asked for a specific
    // resolution and needs to know it was not honoured.
    return c.json(
      {
        error: `セル数が上限を超えています（${cellCount} > ${MAX_CELLS}）。範囲を狭めるかセルサイズを大きくしてください。`,
        cellCount,
        maxCells: MAX_CELLS,
      },
      400,
    );
  }

  const year = Number(await getSetting(c.env.DB, "earth_engine_year", "2024"));
  const reference = await loadReference(c.env, projectId, year);
  const grid = buildGrid(centerLat, centerLng, cellSizeM, extentM);
  const n = Math.round(extentM / cellSizeM);
  const meshId = newId("msh");
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO meshes (id, project_id, center_lat, center_lng, cell_size_m, extent_m, row_count, col_count, year,
       detect_change, status, reference_points, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sampling', ?, ?, ?)`,
  )
    .bind(
      meshId,
      projectId,
      centerLat,
      centerLng,
      cellSizeM,
      extentM,
      n,
      n,
      year,
      detectChange ? 1 : 0,
      reference?.points.length ?? 0,
      user.id,
      now,
    )
    .run();

  // Field records inside each cell, counted once here rather than per sample.
  const nearby = await findNearbyFieldRecords(c.env.DB, projectId, centerLat, centerLng, (extentM / 1000) * 1.5);

  const inserts = grid.map((cell) => {
    const inCell = nearby.filter(
      (r) => r.lat >= cell.minLat && r.lat < cell.maxLat && r.lng >= cell.minLng && r.lng < cell.maxLng,
    ).length;
    return c.env.DB.prepare(
      `INSERT INTO mesh_cells (id, mesh_id, row_idx, col_idx, center_lat, center_lng, min_lat, min_lng, max_lat, max_lng, field_records)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newId("cel"),
      meshId,
      cell.rowIdx,
      cell.colIdx,
      cell.centerLat,
      cell.centerLng,
      cell.minLat,
      cell.minLng,
      cell.maxLat,
      cell.maxLng,
      inCell,
    );
  });

  // D1 caps how much one batch can carry, so insert in chunks.
  for (let i = 0; i < inserts.length; i += 50) {
    await c.env.DB.batch(inserts.slice(i, i + 50));
  }

  await logAudit(c.env.DB, user.id, "mesh.create", meshId, { projectId, cellSizeM, extentM, cells: grid.length });

  return c.json({
    meshId,
    cells: grid.length,
    cellSizeM,
    extentM,
    year,
    detectChange,
    referencePoints: reference?.points.length ?? 0,
    batchSize: SAMPLE_BATCH,
  });
});

/** Drains one batch of pending cells. The client calls this until remaining=0. */
meshRoutes.post("/meshes/:meshId/sample", async (c) => {
  const meshId = c.req.param("meshId");
  const mesh = await c.env.DB.prepare("SELECT * FROM meshes WHERE id = ?").bind(meshId).first<MeshRow>();
  if (!mesh) return c.json({ error: "メッシュが見つかりません。" }, 404);

  const reference = await loadReference(c.env, mesh.project_id, mesh.year);
  const outcome = await sampleMeshBatch(
    c.env,
    meshId,
    reference?.vector ?? null,
    mesh.year,
    mesh.detect_change === 1,
  );

  if (outcome.remaining === 0) {
    await c.env.DB.prepare("UPDATE meshes SET status = 'ready', completed_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), meshId)
      .run();
  }

  return c.json({ ...outcome, referencePoints: reference?.points.length ?? 0 });
});

/** Recomputes hotspots and the recovery plan from the sampled cells. */
meshRoutes.post("/meshes/:meshId/analyze", async (c) => {
  const user = c.get("user") as AuthUser;
  const meshId = c.req.param("meshId");
  const mesh = await c.env.DB.prepare("SELECT * FROM meshes WHERE id = ?").bind(meshId).first<MeshRow>();
  if (!mesh) return c.json({ error: "メッシュが見つかりません。" }, 404);

  const { results: cells } = await c.env.DB.prepare(
    `SELECT id, row_idx, col_idx, center_lat, center_lng, reference_similarity, change_score, cell_class, field_records
     FROM mesh_cells WHERE mesh_id = ? AND status = 'sampled'`,
  )
    .bind(meshId)
    .all<{
      id: string;
      row_idx: number;
      col_idx: number;
      center_lat: number;
      center_lng: number;
      reference_similarity: number | null;
      change_score: number | null;
      cell_class: string;
      field_records: number;
    }>();

  const hotspots = findHotspots(cells, mesh.cell_size_m);
  const plan = buildRecoveryPlan(hotspots);
  const now = new Date().toISOString();

  // Recomputing replaces the previous derivation for this mesh; the cells it
  // was derived from are unchanged and remain the audit trail.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM recovery_actions WHERE mesh_id = ?").bind(meshId),
    c.env.DB.prepare("DELETE FROM mesh_hotspots WHERE mesh_id = ?").bind(meshId),
    c.env.DB.prepare("UPDATE mesh_cells SET hotspot_id = NULL WHERE mesh_id = ?").bind(meshId),
  ]);

  const statements = [];
  let rank = 1;
  for (const { hotspot, actions } of plan) {
    const hotspotId = newId("hot");
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO mesh_hotspots (id, mesh_id, cell_class, rank, cell_count, area_ha, center_lat, center_lng,
           mean_similarity, mean_change, compactness, importance, field_records, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        hotspotId,
        meshId,
        hotspot.cellClass,
        rank,
        hotspot.cellCount,
        hotspot.areaHa,
        hotspot.centerLat,
        hotspot.centerLng,
        hotspot.meanSimilarity,
        hotspot.meanChange,
        hotspot.compactness,
        hotspot.importance,
        hotspot.fieldRecords,
        now,
      ),
    );
    for (const cellId of hotspot.cellIds) {
      statements.push(
        c.env.DB.prepare("UPDATE mesh_cells SET hotspot_id = ? WHERE id = ?").bind(hotspotId, cellId),
      );
    }
    for (const action of actions) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO recovery_actions (id, project_id, mesh_id, hotspot_id, stage, title, description,
             expected_change, indicator, frequency, area_ha, center_lat, center_lng, priority, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId("act"),
          mesh.project_id,
          meshId,
          hotspotId,
          action.stage,
          action.title,
          action.description,
          action.expectedChange,
          action.indicator,
          action.frequency,
          action.areaHa,
          action.centerLat,
          action.centerLng,
          action.priority,
          now,
          now,
        ),
      );
    }
    rank++;
  }

  for (let i = 0; i < statements.length; i += 50) {
    await c.env.DB.batch(statements.slice(i, i + 50));
  }

  await logAudit(c.env.DB, user.id, "mesh.analyze", meshId, {
    hotspots: hotspots.length,
    actions: plan.reduce((n, p) => n + p.actions.length, 0),
  });

  return c.json({
    hotspots: hotspots.length,
    actions: plan.reduce((n, p) => n + p.actions.length, 0),
    sampledCells: cells.length,
  });
});

/** Mesh + cells as GeoJSON for the map overlay (FR-025). */
meshRoutes.get("/meshes/:meshId", async (c) => {
  const meshId = c.req.param("meshId");
  const mesh = await c.env.DB.prepare("SELECT * FROM meshes WHERE id = ?").bind(meshId).first<MeshRow>();
  if (!mesh) return c.json({ error: "メッシュが見つかりません。" }, 404);

  const { results: cells } = await c.env.DB.prepare(
    `SELECT id, row_idx, col_idx, min_lat, min_lng, max_lat, max_lng, status, reference_similarity,
            change_score, cell_class, field_records, hotspot_id
     FROM mesh_cells WHERE mesh_id = ?`,
  )
    .bind(meshId)
    .all<{
      id: string;
      min_lat: number;
      min_lng: number;
      max_lat: number;
      max_lng: number;
      status: string;
      reference_similarity: number | null;
      change_score: number | null;
      cell_class: string | null;
      field_records: number;
      hotspot_id: string | null;
    }>();

  const features = cells
    .filter((cell) => cell.status === "sampled")
    .map((cell) => ({
      type: "Feature" as const,
      id: cell.id,
      properties: {
        cellClass: cell.cell_class,
        label: CELL_CLASS_LABEL[(cell.cell_class ?? "unscored") as CellClass],
        color: CELL_CLASS_COLOR[(cell.cell_class ?? "unscored") as CellClass],
        similarity: cell.reference_similarity,
        change: cell.change_score,
        fieldRecords: cell.field_records,
        hotspotId: cell.hotspot_id,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [cell.min_lng, cell.min_lat],
            [cell.max_lng, cell.min_lat],
            [cell.max_lng, cell.max_lat],
            [cell.min_lng, cell.max_lat],
            [cell.min_lng, cell.min_lat],
          ],
        ],
      },
    }));

  const { results: hotspots } = await c.env.DB.prepare(
    "SELECT * FROM mesh_hotspots WHERE mesh_id = ? ORDER BY rank",
  )
    .bind(meshId)
    .all();

  const { results: actions } = await c.env.DB.prepare(
    "SELECT * FROM recovery_actions WHERE mesh_id = ? ORDER BY priority",
  )
    .bind(meshId)
    .all();

  const pending = cells.filter((cell) => cell.status !== "sampled").length;

  return c.json({
    mesh,
    pending,
    geojson: { type: "FeatureCollection", features },
    hotspots,
    actions,
    legend: (Object.keys(CELL_CLASS_LABEL) as CellClass[]).map((k) => ({
      key: k,
      label: CELL_CLASS_LABEL[k],
      color: CELL_CLASS_COLOR[k],
    })),
  });
});

meshRoutes.get("/projects/:id/meshes", async (c) => {
  const projectId = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM mesh_cells WHERE mesh_id = m.id AND status = 'sampled') AS sampled_cells
     FROM meshes m WHERE m.project_id = ? ORDER BY m.created_at DESC`,
  )
    .bind(projectId)
    .all();
  return c.json({ meshes: results });
});

/** FR-036: a recommendation is only useful once someone owns it. */
meshRoutes.post("/recovery-actions/:actionId", async (c) => {
  const user = c.get("user") as AuthUser;
  const actionId = c.req.param("actionId");
  const body = await c.req.json<{ status?: string; ownerUserId?: string | null; dueDate?: string | null }>();

  const allowed = ["proposed", "accepted", "in_progress", "done", "rejected"];
  if (body.status && !allowed.includes(body.status)) {
    return c.json({ error: "不正な状態です。" }, 400);
  }

  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [new Date().toISOString()];
  if (body.status) {
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (body.ownerUserId !== undefined) {
    sets.push("owner_user_id = ?");
    binds.push(body.ownerUserId);
  }
  if (body.dueDate !== undefined) {
    sets.push("due_date = ?");
    binds.push(body.dueDate);
  }
  binds.push(actionId);

  await c.env.DB.prepare(`UPDATE recovery_actions SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  await logAudit(c.env.DB, user.id, "recovery_action.update", actionId, body);
  return c.json({ ok: true });
});

/**
 * Pre-flight for the mesh screen: where the reference points are, and where a
 * mesh could sensibly be centred.
 *
 * This exists because the first real run centred a mesh on the project centre
 * in Nagano while the only confirmed field records were in Osaka, 400km away.
 * Every cell scored 0.09-0.20 similarity and nothing was classified - correct
 * arithmetic, useless output, and nothing on screen said why. The distance is
 * now something the user is told before spending minutes sampling.
 */
meshRoutes.get("/projects/:id/mesh-context", async (c) => {
  const projectId = c.req.param("id");

  const project = await c.env.DB.prepare(
    "SELECT name, center_lat, center_lng, area_ha FROM projects WHERE id = ?",
  )
    .bind(projectId)
    .first<{ name: string; center_lat: number | null; center_lng: number | null; area_ha: number | null }>();
  if (!project) return c.json({ error: "プロジェクトが見つかりません。" }, 404);

  const { results: confirmed } = await c.env.DB.prepare(
    `SELECT id, lat, lng, species_guess FROM field_records
     WHERE project_id = ? AND review_status = 'confirmed' ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(projectId)
    .all<{ id: string; lat: number; lng: number; species_guess: string | null }>();

  const { results: unreviewed } = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM field_records WHERE project_id = ? AND review_status = 'unreviewed'`,
  )
    .bind(projectId)
    .all<{ n: number }>();

  const referenceCentroid =
    confirmed.length > 0
      ? {
          lat: confirmed.reduce((s, r) => s + r.lat, 0) / confirmed.length,
          lng: confirmed.reduce((s, r) => s + r.lng, 0) / confirmed.length,
        }
      : null;

  const year = Number(await getSetting(c.env.DB, "earth_engine_year", "2024"));

  return c.json({
    project: { name: project.name, centerLat: project.center_lat, centerLng: project.center_lng, areaHa: project.area_ha },
    confirmedRecords: confirmed,
    unreviewedCount: unreviewed[0]?.n ?? 0,
    referenceCentroid,
    year,
    maxCells: MAX_CELLS,
    batchSize: SAMPLE_BATCH,
  });
});

/** Distribution of the sampled values, so a mesh that classified nothing can
 *  still explain itself (how close did anything get to a threshold?). */
meshRoutes.get("/meshes/:meshId/stats", async (c) => {
  const meshId = c.req.param("meshId");
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS sampled,
            MIN(reference_similarity) AS sim_min, MAX(reference_similarity) AS sim_max,
            AVG(reference_similarity) AS sim_avg,
            MIN(change_score) AS chg_min, MAX(change_score) AS chg_max, AVG(change_score) AS chg_avg
     FROM mesh_cells WHERE mesh_id = ? AND status = 'sampled'`,
  )
    .bind(meshId)
    .first<{
      sampled: number;
      sim_min: number | null;
      sim_max: number | null;
      sim_avg: number | null;
      chg_min: number | null;
      chg_max: number | null;
      chg_avg: number | null;
    }>();

  const { results: byClass } = await c.env.DB.prepare(
    `SELECT cell_class, COUNT(*) AS n FROM mesh_cells WHERE mesh_id = ? AND status = 'sampled' GROUP BY cell_class`,
  )
    .bind(meshId)
    .all<{ cell_class: string; n: number }>();

  return c.json({
    stats: row,
    byClass,
    thresholds: {
      priorityA: PRIORITY_A_THRESHOLD,
      similar: SIMILAR_THRESHOLD,
      changed: CHANGED_THRESHOLD,
    },
  });
});

/** FR-053 / FR-034: the LEAP-aligned report for a project. */
meshRoutes.get("/projects/:id/leap", async (c) => {
  try {
    const report = await buildLeapReport(c.env, c.req.param("id"));
    return c.json(report);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * V-05: the points a surveyor should walk to, drawn from what the mesh
 * flagged. Sending someone into the field without telling them where to go is
 * the gap between a satellite finding and a confirmed fact.
 */
meshRoutes.get("/projects/:id/survey-targets", async (c) => {
  const projectId = c.req.param("id");

  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.cell_class, h.rank, h.area_ha, h.center_lat, h.center_lng, h.mean_similarity,
            h.mean_change, h.field_records, m.id AS mesh_id, m.cell_size_m
     FROM mesh_hotspots h JOIN meshes m ON m.id = h.mesh_id
     WHERE m.project_id = ? ORDER BY
       CASE h.cell_class WHEN 'changed' THEN 0 WHEN 'similar' THEN 1 ELSE 2 END, h.importance DESC
     LIMIT 20`,
  )
    .bind(projectId)
    .all<{
      id: string;
      cell_class: string;
      rank: number;
      area_ha: number;
      center_lat: number;
      center_lng: number;
      mean_similarity: number | null;
      mean_change: number | null;
      field_records: number;
      mesh_id: string;
      cell_size_m: number;
    }>();

  const reasonFor = (row: (typeof results)[number]): string => {
    if (row.cell_class === "changed")
      return `前年から大きく変化しています（変化スコア ${row.mean_change?.toFixed(3) ?? "—"}）。原因は衛星では判定できないため、伐採・災害・病虫害・季節差のどれかを現地で確かめてください。`;
    if (row.cell_class === "similar")
      return `確認済みの生息環境と中程度に似ています（類似度 ${row.mean_similarity?.toFixed(2) ?? "—"}）。回復施策の対象になり得る区域なので、現況の植生と土壌を確認してください。`;
    return `保全優先と判定された区域です（類似度 ${row.mean_similarity?.toFixed(2) ?? "—"}）。実際にどの種が生息しているかを記録すると、判定の裏付けになります。`;
  };

  return c.json({
    targets: results.map((row) => ({
      id: row.id,
      cellClass: row.cell_class,
      areaHa: row.area_ha,
      lat: row.center_lat,
      lng: row.center_lng,
      existingRecords: row.field_records,
      reason: reasonFor(row),
      priority: row.cell_class === "changed" ? "high" : row.cell_class === "similar" ? "medium" : "low",
    })),
  });
});
