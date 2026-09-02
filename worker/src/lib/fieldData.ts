import type { Env } from "../types";
import { newId } from "./crypto";
import { fetchEmbeddingVector, fetchSpectralIndices, cosineSimilarity } from "./earthEngine";

// A site candidate covers tens to hundreds of hectares, and a field observation
// is a single point somewhere in or near it, so 500m was tight enough that real
// records next to a candidate still counted as zero. 2km keeps observations
// tied to the candidate they belong to while actually connecting the two.
const NEARBY_RADIUS_KM = 2;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export interface NearbyFieldRecord {
  lat: number;
  lng: number;
  species_guess: string | null;
  review_status: string;
}

export async function findNearbyFieldRecords(
  db: D1Database,
  projectId: string,
  lat: number,
  lng: number,
  radiusKm: number = NEARBY_RADIUS_KM,
): Promise<NearbyFieldRecord[]> {
  // Coarse bounding-box prefilter in SQL (cheap), exact haversine filter in JS.
  const degPad = radiusKm / 111; // ~111km per degree latitude
  const { results } = await db
    .prepare(
      `SELECT lat, lng, species_guess, review_status FROM field_records
       WHERE project_id = ? AND review_status != 'rejected'
         AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    )
    .bind(projectId, lat - degPad, lat + degPad, lng - degPad, lng + degPad)
    .all<NearbyFieldRecord>();

  return results.filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm);
}

async function getCachedEmbedding(db: D1Database, lat: number, lng: number, year: number): Promise<number[] | null> {
  // Round to ~10m grid so nearby repeat lookups hit the cache.
  const rLat = Math.round(lat * 10000) / 10000;
  const rLng = Math.round(lng * 10000) / 10000;
  const row = await db
    .prepare("SELECT vector_json FROM embedding_cache WHERE lat = ? AND lng = ? AND year = ?")
    .bind(rLat, rLng, year)
    .first<{ vector_json: string }>();
  return row ? (JSON.parse(row.vector_json) as number[]) : null;
}

async function setCachedEmbedding(db: D1Database, lat: number, lng: number, year: number, vector: number[]): Promise<void> {
  const rLat = Math.round(lat * 10000) / 10000;
  const rLng = Math.round(lng * 10000) / 10000;
  await db
    .prepare(
      "INSERT INTO embedding_cache (id, lat, lng, year, vector_json, source, fetched_at) VALUES (?, ?, ?, ?, ?, 'earth_engine', ?)",
    )
    .bind(newId("emb"), rLat, rLng, year, JSON.stringify(vector), new Date().toISOString())
    .run();
}

/** Fetches (with D1 caching) the real Satellite Embedding vector for one point, or null if EE isn't configured / the call fails. */
export async function getEmbeddingVector(env: Env, db: D1Database, lat: number, lng: number, year: number): Promise<number[] | null> {
  if (!env.EE_SERVICE_ACCOUNT_JSON) return null;
  const cached = await getCachedEmbedding(db, lat, lng, year);
  if (cached) return cached;
  try {
    const { vector } = await fetchEmbeddingVector(env.EE_SERVICE_ACCOUNT_JSON, env.EE_PROJECT_ID, lat, lng, year);
    await setCachedEmbedding(db, lat, lng, year, vector);
    return vector;
  } catch (err) {
    console.error("Earth Engine embedding fetch failed", err);
    return null;
  }
}

export interface ReferenceEmbedding {
  vector: number[];
  /** The confirmed record locations the vector was averaged from. */
  points: { lat: number; lng: number }[];
}

/**
 * Builds a "known good habitat" reference embedding by averaging the vectors
 * at confirmed field_records locations in this project. Returns null if
 * there are no confirmed records yet (nothing to compare candidates against),
 * or if Earth Engine isn't configured.
 */
export async function getReferenceEmbedding(
  env: Env,
  db: D1Database,
  projectId: string,
  year: number,
): Promise<ReferenceEmbedding | null> {
  if (!env.EE_SERVICE_ACCOUNT_JSON) return null;
  const { results } = await db
    .prepare(
      `SELECT lat, lng FROM field_records WHERE project_id = ? AND review_status = 'confirmed' ORDER BY created_at DESC LIMIT 5`,
    )
    .bind(projectId)
    .all<{ lat: number; lng: number }>();
  if (results.length === 0) return null;

  const vectors: number[][] = [];
  const points: { lat: number; lng: number }[] = [];
  for (const r of results) {
    const v = await getEmbeddingVector(env, db, r.lat, r.lng, year);
    if (v) {
      vectors.push(v);
      points.push({ lat: r.lat, lng: r.lng });
    }
  }
  if (vectors.length === 0) return null;

  const dims = vectors[0].length;
  const avg = new Array(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i++) avg[i] += v[i] / vectors.length;
  return { vector: avg, points };
}

/** Metres from a candidate to the nearest point the reference was built from. */
export function distanceToNearestReferencePointM(
  lat: number,
  lng: number,
  points: { lat: number; lng: number }[],
): number | undefined {
  if (points.length === 0) return undefined;
  return Math.min(...points.map((p) => haversineKm(lat, lng, p.lat, p.lng))) * 1000;
}

export { cosineSimilarity };

// --- FR-022: spectral indices, cached the same way embeddings are -----------
//
// Until now these were computed only by the scheduled self-check, which proved
// the Earth Engine query works but put no number in front of a user: the NDRE
// change on the analysis screen was still the simulated one. These two helpers
// put the measured value on the decision path.

export interface CachedIndices {
  ndvi: number | null;
  ndre: number | null;
  ndmi: number | null;
  nbr: number | null;
}

const INDEX_KEYS = ["ndvi", "ndre", "ndmi", "nbr"] as const;

function roundPoint(lat: number, lng: number): [number, number] {
  return [Math.round(lat * 10000) / 10000, Math.round(lng * 10000) / 10000];
}

/** Real Sentinel-2 indices for one point/year, or null if unavailable. */
export async function getSpectralIndices(
  env: Env,
  db: D1Database,
  lat: number,
  lng: number,
  year: number,
): Promise<CachedIndices | null> {
  if (!env.EE_SERVICE_ACCOUNT_JSON) return null;
  const [rLat, rLng] = roundPoint(lat, lng);

  const cached = await db
    .prepare("SELECT ndvi, ndre, ndmi, nbr FROM indices_cache WHERE lat = ? AND lng = ? AND year = ?")
    .bind(rLat, rLng, year)
    .first<CachedIndices>();
  if (cached) return cached;

  try {
    const fresh = await fetchSpectralIndices(env.EE_SERVICE_ACCOUNT_JSON, env.EE_PROJECT_ID, lat, lng, year);
    // All four null means the year has no usable scene here; caching that would
    // hide a later fix, so it is returned but not stored.
    if (INDEX_KEYS.every((k) => fresh[k] === null)) return null;
    await db
      .prepare(
        `INSERT INTO indices_cache (id, lat, lng, year, ndvi, ndre, ndmi, nbr, source, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'earth_engine', ?)`,
      )
      .bind(newId("idx"), rLat, rLng, year, fresh.ndvi, fresh.ndre, fresh.ndmi, fresh.nbr, new Date().toISOString())
      .run();
    return { ndvi: fresh.ndvi, ndre: fresh.ndre, ndmi: fresh.ndmi, nbr: fresh.nbr };
  } catch (err) {
    console.error("Earth Engine indices fetch failed", err);
    return null;
  }
}

export interface IndexChange {
  current: CachedIndices;
  previous: CachedIndices | null;
  /** Percentage change in NDRE against the previous year, if both years resolved. */
  ndreChangePct: number | null;
  year: number;
  previousYear: number;
}

/**
 * Indices for a point this year and last, so "vegetation fell 12%" is a measured
 * difference rather than an assertion. Two Earth Engine calls at most, both
 * cached, which keeps a multi-candidate analysis inside the subrequest budget.
 */
export async function getIndexChange(
  env: Env,
  db: D1Database,
  lat: number,
  lng: number,
  year: number,
): Promise<IndexChange | null> {
  const current = await getSpectralIndices(env, db, lat, lng, year);
  if (!current) return null;
  const previous = await getSpectralIndices(env, db, lat, lng, year - 1);

  let ndreChangePct: number | null = null;
  if (previous?.ndre != null && current.ndre != null && Math.abs(previous.ndre) > 0.02) {
    ndreChangePct = Number((((current.ndre - previous.ndre) / Math.abs(previous.ndre)) * 100).toFixed(1));
  }

  return { current, previous, ndreChangePct, year, previousYear: year - 1 };
}
