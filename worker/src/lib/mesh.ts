// 10m mesh engine (FR-020 grid, FR-023 change detection, FR-025 overlay,
// FR-026 hotspots).
//
// Sampling budget is the constraint that shapes this file. Cloudflare Workers
// allow 50 subrequests per request, and one Earth Engine sample is one
// subrequest (two when change detection compares two years), so a mesh cannot
// be filled in a single request. Cells are therefore persisted up front as
// `pending` and drained in batches: the client calls the sample endpoint
// repeatedly until nothing is pending. Vectors land in embedding_cache, so a
// re-run over the same ground costs nothing.

import type { Env } from "../types";
import { newId } from "./crypto";
import { getEmbeddingVector, cosineSimilarity } from "./fieldData";

/** Cells sampled per request. Two Earth Engine calls per cell when change
 *  detection is on, leaving headroom under the 50-subrequest ceiling. */
export const SAMPLE_BATCH = 16;

/** Guards against a mesh so large it could never finish draining. */
export const MAX_CELLS = 2500;

const M_PER_DEG_LAT = 111_320;

export type CellClass = "priority_a" | "similar" | "changed" | "baseline" | "unscored";

export const CELL_CLASS_LABEL: Record<CellClass, string> = {
  priority_a: "優先度A（保全優先）",
  similar: "類似環境（回復候補）",
  changed: "大きな変化（要現地確認）",
  baseline: "一般区域",
  unscored: "未評価",
};

export const CELL_CLASS_COLOR: Record<CellClass, string> = {
  priority_a: "#1f7a4d",
  similar: "#c98a1b",
  changed: "#b3432b",
  baseline: "#6b7280",
  unscored: "#9ca3af",
};

// Thresholds are deliberately explicit rather than tuned: they are the
// published rule the analysis is judged against, and a reviewer has to be able
// to argue with them.
export const CHANGED_THRESHOLD = 0.15; // 1 - cosine between consecutive years
export const PRIORITY_A_THRESHOLD = 0.85; // cosine to the confirmed-habitat reference
export const SIMILAR_THRESHOLD = 0.7;

export function classifyCell(referenceSimilarity: number | null, changeScore: number | null): CellClass {
  if (changeScore !== null && changeScore >= CHANGED_THRESHOLD) return "changed";
  if (referenceSimilarity === null) return "unscored";
  if (referenceSimilarity >= PRIORITY_A_THRESHOLD) return "priority_a";
  if (referenceSimilarity >= SIMILAR_THRESHOLD) return "similar";
  return "baseline";
}

export interface GridCell {
  rowIdx: number;
  colIdx: number;
  centerLat: number;
  centerLng: number;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Builds a square grid of `cellSizeM` cells covering `extentM` around a centre. */
export function buildGrid(centerLat: number, centerLng: number, cellSizeM: number, extentM: number): GridCell[] {
  const n = Math.max(1, Math.round(extentM / cellSizeM));
  const degLat = cellSizeM / M_PER_DEG_LAT;
  // Longitude degrees shrink with latitude, so a cell stays square on the ground.
  const degLng = cellSizeM / (M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180));
  const half = n / 2;

  const cells: GridCell[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const minLat = centerLat + (r - half) * degLat;
      const minLng = centerLng + (c - half) * degLng;
      cells.push({
        rowIdx: r,
        colIdx: c,
        minLat,
        minLng,
        maxLat: minLat + degLat,
        maxLng: minLng + degLng,
        centerLat: minLat + degLat / 2,
        centerLng: minLng + degLng / 2,
      });
    }
  }
  return cells;
}

export interface SampleOutcome {
  sampled: number;
  failed: number;
  remaining: number;
}

interface PendingCell {
  id: string;
  center_lat: number;
  center_lng: number;
}

/**
 * Samples up to SAMPLE_BATCH pending cells of a mesh against Earth Engine and
 * records similarity, change and class for each. Returns how many are left.
 */
export async function sampleMeshBatch(
  env: Env,
  meshId: string,
  reference: number[] | null,
  year: number,
  detectChange: boolean,
): Promise<SampleOutcome> {
  const { results: pending } = await env.DB.prepare(
    `SELECT id, center_lat, center_lng FROM mesh_cells
     WHERE mesh_id = ? AND status = 'pending' ORDER BY row_idx, col_idx LIMIT ?`,
  )
    .bind(meshId, SAMPLE_BATCH)
    .all<PendingCell>();

  if (pending.length === 0) {
    return { sampled: 0, failed: 0, remaining: 0 };
  }

  const now = new Date().toISOString();
  const updates = await Promise.all(
    pending.map(async (cell) => {
      const current = await getEmbeddingVector(env, env.DB, cell.center_lat, cell.center_lng, year);
      if (!current) {
        return { id: cell.id, ok: false as const, error: "Earth Engineから値を取得できませんでした" };
      }

      const similarity = reference ? Number(cosineSimilarity(current, reference).toFixed(4)) : null;

      let changeScore: number | null = null;
      if (detectChange) {
        const previous = await getEmbeddingVector(env, env.DB, cell.center_lat, cell.center_lng, year - 1);
        // A missing previous year is not a failure of this cell - the mesh
        // still carries a valid similarity, just no change signal.
        if (previous) changeScore = Number((1 - cosineSimilarity(current, previous)).toFixed(4));
      }

      return {
        id: cell.id,
        ok: true as const,
        similarity,
        changeScore,
        cellClass: classifyCell(similarity, changeScore),
      };
    }),
  );

  const statements = updates.map((u) =>
    u.ok
      ? env.DB.prepare(
          `UPDATE mesh_cells SET status = 'sampled', reference_similarity = ?, change_score = ?,
             cell_class = ?, sampled_at = ?, error = NULL WHERE id = ?`,
        ).bind(u.similarity, u.changeScore, u.cellClass, now, u.id)
      : env.DB.prepare(`UPDATE mesh_cells SET status = 'failed', error = ?, sampled_at = ? WHERE id = ?`).bind(
          u.error,
          now,
          u.id,
        ),
  );
  await env.DB.batch(statements);

  const remainingRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mesh_cells WHERE mesh_id = ? AND status = 'pending'`,
  )
    .bind(meshId)
    .first<{ n: number }>();

  return {
    sampled: updates.filter((u) => u.ok).length,
    failed: updates.filter((u) => !u.ok).length,
    remaining: remainingRow?.n ?? 0,
  };
}

interface HotspotCell {
  id: string;
  row_idx: number;
  col_idx: number;
  center_lat: number;
  center_lng: number;
  reference_similarity: number | null;
  change_score: number | null;
  cell_class: string;
  field_records: number;
}

export interface Hotspot {
  cellClass: CellClass;
  cellIds: string[];
  cellCount: number;
  areaHa: number;
  centerLat: number;
  centerLng: number;
  meanSimilarity: number | null;
  meanChange: number | null;
  compactness: number;
  importance: number;
  fieldRecords: number;
}

/**
 * FR-026: groups 4-connected cells of the same class into regions and ranks
 * them. A single isolated cell is noise at 10m resolution, so regions below
 * `minCells` are dropped rather than reported as findings.
 */
export function findHotspots(cells: HotspotCell[], cellSizeM: number, minCells = 3): Hotspot[] {
  const byKey = new Map<string, HotspotCell>();
  for (const cell of cells) {
    if (cell.cell_class === "baseline" || cell.cell_class === "unscored") continue;
    byKey.set(`${cell.row_idx}:${cell.col_idx}`, cell);
  }

  const seen = new Set<string>();
  const hotspots: Hotspot[] = [];
  const cellAreaHa = (cellSizeM * cellSizeM) / 10_000;

  for (const [key, start] of byKey) {
    if (seen.has(key)) continue;

    // Flood fill across same-class neighbours.
    const group: HotspotCell[] = [];
    const stack = [key];
    seen.add(key);
    while (stack.length) {
      const currentKey = stack.pop() as string;
      const cell = byKey.get(currentKey);
      if (!cell) continue;
      group.push(cell);
      const [r, c] = currentKey.split(":").map(Number);
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const neighbourKey = `${r + dr}:${c + dc}`;
        const neighbour = byKey.get(neighbourKey);
        if (neighbour && !seen.has(neighbourKey) && neighbour.cell_class === start.cell_class) {
          seen.add(neighbourKey);
          stack.push(neighbourKey);
        }
      }
    }

    if (group.length < minCells) continue;

    const sims = group.map((g) => g.reference_similarity).filter((v): v is number => v !== null);
    const changes = group.map((g) => g.change_score).filter((v): v is number => v !== null);
    const areaHa = group.length * cellAreaHa;
    const meanSimilarity = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null;
    const meanChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;

    // Compactness compares the group's own bounding box fill: a solid block of
    // habitat is worth more than the same cell count smeared into a thin
    // fragment, which is the connectivity point the requirements make.
    const rows = group.map((g) => g.row_idx);
    const cols = group.map((g) => g.col_idx);
    const boxCells = (Math.max(...rows) - Math.min(...rows) + 1) * (Math.max(...cols) - Math.min(...cols) + 1);
    const compactness = group.length / boxCells;

    const fieldRecords = group.reduce((sum, g) => sum + g.field_records, 0);
    const cellClass = start.cell_class as CellClass;

    // Importance blends size, signal strength and contiguity so the ranking a
    // reviewer sees is not just "biggest blob first".
    const signal =
      cellClass === "changed" ? (meanChange ?? 0) / CHANGED_THRESHOLD : (meanSimilarity ?? 0) / PRIORITY_A_THRESHOLD;
    const importance = Number((areaHa * 10 * Math.min(signal, 2) * (0.5 + compactness / 2)).toFixed(3));

    hotspots.push({
      cellClass,
      cellIds: group.map((g) => g.id),
      cellCount: group.length,
      areaHa: Number(areaHa.toFixed(4)),
      centerLat: group.reduce((s, g) => s + g.center_lat, 0) / group.length,
      centerLng: group.reduce((s, g) => s + g.center_lng, 0) / group.length,
      meanSimilarity: meanSimilarity === null ? null : Number(meanSimilarity.toFixed(4)),
      meanChange: meanChange === null ? null : Number(meanChange.toFixed(4)),
      compactness: Number(compactness.toFixed(3)),
      importance,
      fieldRecords,
    });
  }

  return hotspots.sort((a, b) => b.importance - a.importance);
}

export { newId };
