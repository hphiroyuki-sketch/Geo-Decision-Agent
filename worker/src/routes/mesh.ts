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
  type CellClass,
} from "../lib/mesh";
import { buildRecoveryPlan } from "../lib/recoveryPlan";

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
