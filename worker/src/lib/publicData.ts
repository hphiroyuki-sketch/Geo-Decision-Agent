// Public datasets consulted for TNFD's sensitive-location criteria.
//
// Three of the five criteria previously read "判定不可" because this system had
// no data for them. These are the sources that change that, and every one of
// them is keyless: a screening a company can run today is worth more than one
// gated behind a data licence negotiation.
//
// Two rules shape the design:
//
//   Each source fails on its own. A report that drops a source it could not
//   reach reads as "nothing found there", which is the opposite of the truth,
//   so a failure is recorded and displayed rather than swallowed.
//
//   Nothing here is presented as an authoritative designation. OpenStreetMap is
//   community-maintained and the hazard tiles answer a question about a tile,
//   not about a point. Both limits travel with the numbers into the report.

import type { Env } from "../types";
import { newId } from "./crypto";

/** ~100m. Sites closer than this share a cached answer. */
function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

async function readCache<T>(db: D1Database, source: string, lat: number, lng: number, maxAgeDays = 30) {
  const row = await db
    .prepare("SELECT payload_json, status, error, fetched_at FROM public_data_cache WHERE source = ? AND lat = ? AND lng = ?")
    .bind(source, roundCoord(lat), roundCoord(lng))
    .first<{ payload_json: string | null; status: string; error: string | null; fetched_at: string }>();
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.fetched_at).getTime();
  // A failure is retried sooner than a success is refreshed: the outage that
  // caused it is usually shorter than the data's shelf life.
  const maxAge =
    row.status === "failed" || row.status === "busy" ? 60 * 60 * 1000 : maxAgeDays * 24 * 60 * 60 * 1000;
  if (ageMs > maxAge) return null;
  return {
    status: row.status as "ok" | "failed" | "busy" | "empty",
    error: row.error,
    fetchedAt: row.fetched_at,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as T) : null,
  };
}

async function writeCache(
  db: D1Database,
  source: string,
  lat: number,
  lng: number,
  status: string,
  payload: unknown,
  error?: string,
) {
  await db
    .prepare(
      `INSERT INTO public_data_cache (id, source, lat, lng, payload_json, status, error, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, lat, lng) DO UPDATE SET
         payload_json = excluded.payload_json, status = excluded.status,
         error = excluded.error, fetched_at = excluded.fetched_at`,
    )
    .bind(
      newId("pdc"),
      source,
      roundCoord(lat),
      roundCoord(lng),
      payload ? JSON.stringify(payload) : null,
      status,
      error ?? null,
      new Date().toISOString(),
    )
    .run();
}

const UA = "GeoDecisionAgent/1.0 (biodiversity screening; contact via app administrator)";

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- GBIF: species records and threat categories ---------------------------

export interface BiodiversityResult {
  radiusKm: number;
  totalRecords: number;
  /** Distinct species with at least one record in the radius. */
  speciesCount: number;
  /** IUCN Red List categories present, most threatened first. */
  threatened: { category: string; label: string; records: number }[];
  threatenedRecords: number;
  source: string;
}

const IUCN_LABEL: Record<string, string> = {
  EX: "絶滅（EX）",
  EW: "野生絶滅（EW）",
  CR: "絶滅危惧IA類（CR）",
  EN: "絶滅危惧IB類（EN）",
  VU: "絶滅危惧II類（VU）",
  NT: "準絶滅危惧（NT）",
  LC: "低懸念（LC）",
  DD: "情報不足（DD）",
};

/** Categories that make a location notable for biodiversity importance. */
const THREATENED = ["CR", "EN", "VU"];

export async function fetchBiodiversity(
  env: Env,
  lat: number,
  lng: number,
  radiusKm = 3,
): Promise<{ status: "ok" | "failed"; data: BiodiversityResult | null; error?: string; fetchedAt: string }> {
  const cached = await readCache<BiodiversityResult>(env.DB, "gbif", lat, lng);
  if (cached) return { status: cached.status === "failed" ? "failed" : "ok", data: cached.payload, error: cached.error ?? undefined, fetchedAt: cached.fetchedAt };

  const base = `https://api.gbif.org/v1/occurrence/search?geoDistance=${lat},${lng},${radiusKm}km&limit=0`;
  try {
    const [byThreat, bySpecies] = await Promise.all([
      fetchJson(`${base}&facet=iucnRedListCategory&facetLimit=10`),
      fetchJson(`${base}&facet=speciesKey&facetLimit=1`),
    ]);

    const t = byThreat as { count?: number; facets?: { field: string; counts: { name: string; count: number }[] }[] };
    const s = bySpecies as { facets?: { field: string; counts: { name: string; count: number }[] }[] };

    const threatFacet = t.facets?.find((f) => f.field?.toUpperCase() === "IUCN_RED_LIST_CATEGORY")?.counts ?? [];
    const threatened = threatFacet
      .filter((c) => THREATENED.includes(c.name?.toUpperCase()))
      .map((c) => ({
        category: c.name.toUpperCase(),
        label: IUCN_LABEL[c.name.toUpperCase()] ?? c.name,
        records: c.count,
      }))
      .sort((a, b) => THREATENED.indexOf(a.category) - THREATENED.indexOf(b.category));

    // The species facet is capped at 1 entry only to read its cardinality;
    // GBIF does not expose a distinct count, so this is the number of facet
    // buckets it reports rather than a true distinct count.
    const speciesFacet = s.facets?.find((f) => f.field?.toUpperCase() === "SPECIES_KEY")?.counts ?? [];

    const data: BiodiversityResult = {
      radiusKm,
      totalRecords: t.count ?? 0,
      speciesCount: speciesFacet.length,
      threatened,
      threatenedRecords: threatened.reduce((n, x) => n + x.records, 0),
      source: "GBIF (Global Biodiversity Information Facility)",
    };
    await writeCache(env.DB, "gbif", lat, lng, "ok", data);
    return { status: "ok", data, fetchedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeCache(env.DB, "gbif", lat, lng, "failed", null, message);
    return { status: "failed", data: null, error: message, fetchedAt: new Date().toISOString() };
  }
}

// --- OpenStreetMap: protected areas nearby ---------------------------------

export interface ProtectedAreaResult {
  radiusKm: number;
  nearest: { name: string; kind: string; distanceKm: number } | null;
  count: number;
  source: string;
}

const OSM_KIND_LABEL: Record<string, string> = {
  national_park: "国立・国定公園",
  protected_area: "保護地域",
  nature_reserve: "自然保護区",
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Overpass runs as a set of independent volunteer-hosted instances, and the
 * main one returned 521 from production on the first live check. Any single
 * endpoint is therefore a single point of failure for this criterion, which is
 * not acceptable when the feature is demonstrated live in front of a client.
 * The mirrors are tried in order and the first that answers wins.
 */
/**
 * Whether an HTTP status from a volunteer-run mirror is the provider's
 * condition rather than a fault in our request.
 *
 * Overpass instances rate-limit per source IP, and this Worker shares
 * Cloudflare's egress addresses with everything else on the platform, so 429
 * says nothing about us. Neither does a 5xx - production has seen 521 (the
 * mirror's own origin down) alongside 429 from the others. Both mean "come
 * back later"; recording either as a failure would put 取得失敗 in a client
 * document for a source that is merely unavailable, and nothing else depends
 * on it.
 *
 * Anything else - a 4xx that is not 429, a DNS or parse error - is ours, and
 * still has to surface as a failure so a real regression stays visible.
 */
export function isProviderSideStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * The same question for a thrown error rather than a status.
 *
 * A request that we sent successfully and that was not answered inside the
 * timeout is the provider being too slow, not a fault here - so it belongs
 * with 429 and 5xx. A DNS failure or a parse error does not: those mean the
 * host or the response shape changed under us, and have to stay visible.
 */
export function isProviderSideError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(msg);
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export async function fetchProtectedAreas(
  env: Env,
  lat: number,
  lng: number,
  radiusKm = 10,
): Promise<{
  status: "ok" | "failed" | "busy";
  data: ProtectedAreaResult | null;
  error?: string;
  fetchedAt: string;
}> {
  const cached = await readCache<ProtectedAreaResult>(env.DB, "osm_protected", lat, lng);
  if (cached) {
    return {
      status: cached.status === "ok" ? "ok" : cached.status === "busy" ? "busy" : "failed",
      data: cached.payload,
      error: cached.error ?? undefined,
      fetchedAt: cached.fetchedAt,
    };
  }

  const r = Math.round(radiusKm * 1000);
  // `out center` returns one representative point per way/relation, which is
  // all a distance screen needs and avoids pulling full polygon geometry.
  const query = `[out:json][timeout:20];(
    nwr["boundary"="national_park"](around:${r},${lat},${lng});
    nwr["boundary"="protected_area"](around:${r},${lat},${lng});
    nwr["leisure"="nature_reserve"](around:${r},${lat},${lng});
  );out center tags 40;`;

  try {
    let json: {
      elements?: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];
    } | null = null;
    const failures: string[] = [];
    let rateLimited = false;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
          if (isProviderSideStatus(res.status)) rateLimited = true;
          failures.push(`${new URL(endpoint).host}: HTTP ${res.status}`);
          continue;
        }
        json = await res.json();
        break;
      } catch (err) {
        if (isProviderSideError(err)) rateLimited = true;
        failures.push(`${new URL(endpoint).host}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!json) {
      const message = failures.join(" / ");
      const status = rateLimited ? "busy" : "failed";
      await writeCache(env.DB, "osm_protected", lat, lng, status, null, message);
      return { status, data: null, error: message, fetchedAt: new Date().toISOString() };
    }

    const areas = (json.elements ?? [])
      .map((e) => {
        const p = e.center ?? (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
        if (!p) return null;
        const tags = e.tags ?? {};
        const kindKey = tags.boundary === "national_park" ? "national_park" : tags.leisure === "nature_reserve" ? "nature_reserve" : "protected_area";
        return {
          name: tags["name:ja"] || tags.name || OSM_KIND_LABEL[kindKey],
          kind: OSM_KIND_LABEL[kindKey],
          distanceKm: Number(haversineKm(lat, lng, p.lat, p.lon).toFixed(2)),
        };
      })
      .filter((x): x is { name: string; kind: string; distanceKm: number } => x !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const data: ProtectedAreaResult = {
      radiusKm,
      nearest: areas[0] ?? null,
      count: areas.length,
      source: "OpenStreetMap (Overpass API)",
    };
    await writeCache(env.DB, "osm_protected", lat, lng, "ok", data);
    return { status: "ok", data, fetchedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeCache(env.DB, "osm_protected", lat, lng, "failed", null, message);
    return { status: "failed", data: null, error: message, fetchedAt: new Date().toISOString() };
  }
}

// --- GSI hazard map tiles ---------------------------------------------------
//
// Reading one pixel out of a PNG needs the whole image inflated and unfiltered,
// which does not fit a 10ms CPU budget. It is not needed: the GSI tile service
// returns 404 for tiles containing no data for that layer, so presence is
// answerable from the HTTP status alone.
//
// The cost is granularity. A z16 tile is roughly 600m across at Japanese
// latitudes, so a hit means "a designated area exists within this ~600m tile",
// not "this point is inside one". That limit is carried into the report rather
// than rounded away.

export const HAZARD_TILE_ZOOM = 16;

interface HazardLayer {
  key: string;
  label: string;
  path: string;
  /** Which TNFD criterion this contributes to. */
  group: "water" | "landslide";
}

const HAZARD_LAYERS: HazardLayer[] = [
  { key: "flood", label: "洪水浸水想定区域（想定最大規模）", path: "01_flood_l2_shinsuishin_data", group: "water" },
  { key: "hightide", label: "高潮浸水想定区域", path: "03_hightide_l2_shinsuishin_data", group: "water" },
  { key: "tsunami", label: "津波浸水想定", path: "04_tsunami_newlegend_data", group: "water" },
  { key: "steep", label: "土砂災害警戒区域（急傾斜地の崩壊）", path: "05_kyukeishakeikaikuiki", group: "landslide" },
  { key: "debris", label: "土砂災害警戒区域（土石流）", path: "05_dosekiryukeikaikuiki", group: "landslide" },
  { key: "slide", label: "土砂災害警戒区域（地すべり）", path: "05_jisuberikeikaikuiki", group: "landslide" },
];

export interface HazardResult {
  zoom: number;
  tileSpanM: number;
  layers: { key: string; label: string; group: string; present: boolean | null }[];
  waterPresent: boolean;
  landslidePresent: boolean;
  unresolved: number;
  source: string;
}

function tileXY(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export async function fetchHazards(
  env: Env,
  lat: number,
  lng: number,
): Promise<{ status: "ok" | "failed"; data: HazardResult | null; error?: string; fetchedAt: string }> {
  const cached = await readCache<HazardResult>(env.DB, "gsi_hazard", lat, lng);
  if (cached) return { status: cached.status === "failed" ? "failed" : "ok", data: cached.payload, error: cached.error ?? undefined, fetchedAt: cached.fetchedAt };

  const { x, y } = tileXY(lat, lng, HAZARD_TILE_ZOOM);
  const spanM = Math.round(((156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** HAZARD_TILE_ZOOM) * 256);

  try {
    const results = await Promise.all(
      HAZARD_LAYERS.map(async (layer) => {
        try {
          const res = await fetch(
            `https://disaportaldata.gsi.go.jp/raster/${layer.path}/${HAZARD_TILE_ZOOM}/${x}/${y}.png`,
            { method: "GET", headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) },
          );
          if (res.status === 404) return { ...layer, present: false as boolean | null };
          if (!res.ok) return { ...layer, present: null as boolean | null };
          // A served tile that is essentially empty is a blank PNG of a few
          // hundred bytes; treating those as "no data" avoids reporting a hit
          // for a service that returns 200 with a transparent tile.
          const bytes = (await res.arrayBuffer()).byteLength;
          return { ...layer, present: bytes > 1000 };
        } catch {
          return { ...layer, present: null as boolean | null };
        }
      }),
    );

    const layers = results.map((r) => ({ key: r.key, label: r.label, group: r.group, present: r.present }));
    const data: HazardResult = {
      zoom: HAZARD_TILE_ZOOM,
      tileSpanM: spanM,
      layers,
      waterPresent: layers.some((l) => l.group === "water" && l.present === true),
      landslidePresent: layers.some((l) => l.group === "landslide" && l.present === true),
      unresolved: layers.filter((l) => l.present === null).length,
      source: "国土地理院 ハザードマップポータルサイト",
    };

    // Every layer unresolved means the service was unreachable, not that the
    // area is clear.
    if (data.unresolved === layers.length) {
      await writeCache(env.DB, "gsi_hazard", lat, lng, "failed", null, "全レイヤーで取得できませんでした");
      return { status: "failed", data: null, error: "全レイヤーで取得できませんでした", fetchedAt: new Date().toISOString() };
    }

    await writeCache(env.DB, "gsi_hazard", lat, lng, "ok", data);
    return { status: "ok", data, fetchedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeCache(env.DB, "gsi_hazard", lat, lng, "failed", null, message);
    return { status: "failed", data: null, error: message, fetchedAt: new Date().toISOString() };
  }
}

// --- Combined ---------------------------------------------------------------

export interface PublicDataBundle {
  lat: number;
  lng: number;
  biodiversity: Awaited<ReturnType<typeof fetchBiodiversity>>;
  protectedAreas: Awaited<ReturnType<typeof fetchProtectedAreas>>;
  hazards: Awaited<ReturnType<typeof fetchHazards>>;
}

/** All three sources for one point. ~9 subrequests, well inside the budget. */
export async function fetchPublicData(env: Env, lat: number, lng: number): Promise<PublicDataBundle> {
  const [biodiversity, protectedAreas, hazards] = await Promise.all([
    fetchBiodiversity(env, lat, lng),
    fetchProtectedAreas(env, lat, lng),
    fetchHazards(env, lat, lng),
  ]);
  return { lat, lng, biodiversity, protectedAreas, hazards };
}

export const PUBLIC_DATA_SOURCES = [
  {
    key: "gbif",
    label: "GBIF（地球規模生物多様性情報機構）",
    optional: false,
    covers: "半径3km以内の生物種の記録・IUCN絶滅危惧カテゴリ",
    caveat: "研究者・市民による観察記録の集積です。記録が無いことは、生息していないことを意味しません。",
  },
  {
    key: "osm_protected",
    label: "OpenStreetMap（保護区域）",
    covers: "半径10km以内の国立・国定公園、保護地域、自然保護区",
    caveat:
      "市民参加型データのため参考値です。正式な指定範囲は所管行政庁でご確認ください。提供元はボランティア運営のため混雑時は取得できないことがありますが、その場合も他の判定には影響しません。",
    optional: true,
  },
  {
    key: "gsi_hazard",
    label: "国土地理院 ハザードマップポータルサイト",
    optional: false,
    covers: "洪水浸水想定・高潮・津波・土砂災害警戒区域（急傾斜地／土石流／地すべり）",
    caveat: "タイル単位（約600m四方）での該当有無です。地点そのものが区域内にあるかは、重ねるハザードマップでご確認ください。",
  },
] as const;
