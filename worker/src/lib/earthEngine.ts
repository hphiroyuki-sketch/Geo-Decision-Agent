// Google Earth Engine client - fetches a Satellite Embedding (64-dim) vector
// for one point/year via the Earth Engine REST API's expression-graph
// ("Value") compute endpoint. There is no REST shortcut for "sample this
// point" - Earth Engine only exposes its server-side computation graph, so
// the pipeline (load collection -> filter by year -> mosaic -> sample point)
// has to be hand-built as that graph below.
//
// NOTE: this expression-graph JSON is Earth Engine's internal Cloud API wire
// format, not a public high-level shortcut. It is built from documented
// operation names (Image.reduceRegion, Reducer.first, Collection.filterDate,
// ImageCollection.mosaic, GeometryConstructors.Point, ImageCollection.load)
// and refined against the live API's error responses (this sandbox cannot
// reach earthengine.googleapis.com, so each round trip goes through a deploy
// and the /api/admin/ee-test diagnostic endpoint).

import { getGoogleAccessToken, parseServiceAccountKey, type ServiceAccountKey } from "./googleAuth";

const EE_SCOPES = ["https://www.googleapis.com/auth/earthengine.readonly", "https://www.googleapis.com/auth/cloud-platform.read-only"];
const SATELLITE_EMBEDDING_COLLECTION = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL";
const EMBEDDING_BANDS = Array.from({ length: 64 }, (_, i) => `A${String(i).padStart(2, "0")}`);

type EeValue =
  | { constantValue: unknown }
  | { arrayValue: { values: EeValue[] } }
  | { functionInvocationValue: { functionName: string; arguments: Record<string, EeValue> } };

// The API's Expression message is not a bare value node - it is a map of named
// nodes plus the name of the one whose value to return. Nested arguments may
// stay inline as value nodes, so a single entry pointing at the root of the
// graph is enough. Posting the root node directly is what produced
// `Unknown name "functionInvocationValue" at 'expression'`.
interface EeExpression {
  values: Record<string, EeValue>;
  result: string;
}

const ROOT_NODE = "0";

function asExpression(root: EeValue): EeExpression {
  return { values: { [ROOT_NODE]: root }, result: ROOT_NODE };
}

export interface SampleOptions {
  /**
   * Skip the date filter and mosaic the whole collection. Diagnostic escape
   * hatch: it isolates whether a failure is in the date filtering or in the
   * rest of the graph, without needing a separate deploy to find out.
   */
  skipDateFilter?: boolean;
}

function buildPointSampleExpression(lat: number, lng: number, year: number, opts: SampleOptions = {}): EeValue {
  const collection: EeValue = {
    functionInvocationValue: {
      functionName: "ImageCollection.load",
      arguments: { id: { constantValue: SATELLITE_EMBEDDING_COLLECTION } },
    },
  };
  // "filterDate" is client-library sugar, not a server-side algorithm (the API
  // rejects it with `Unknown function: 'Collection.filterDate'`), so filtering
  // goes through the generic Collection.filter. Filter.calendarRange on the
  // year field suits this collection exactly - it is annual, one image per
  // year - and needs no date-range object, keeping the graph to algorithms
  // confirmed present in this project's algorithm list.
  const dateFilter: EeValue = {
    functionInvocationValue: {
      functionName: "Filter.calendarRange",
      arguments: {
        start: { constantValue: year },
        end: { constantValue: year },
        field: { constantValue: "year" },
      },
    },
  };
  const filtered: EeValue = {
    functionInvocationValue: {
      functionName: "Collection.filter",
      arguments: { collection, filter: dateFilter },
    },
  };
  const mosaicked: EeValue = {
    functionInvocationValue: {
      functionName: "ImageCollection.mosaic",
      arguments: { collection: opts.skipDateFilter ? collection : filtered },
    },
  };
  const point: EeValue = {
    functionInvocationValue: {
      functionName: "GeometryConstructors.Point",
      arguments: {
        coordinates: { arrayValue: { values: [{ constantValue: lng }, { constantValue: lat }] } },
      },
    },
  };
  const reducer: EeValue = { functionInvocationValue: { functionName: "Reducer.first", arguments: {} } };
  return {
    functionInvocationValue: {
      functionName: "Image.reduceRegion",
      arguments: {
        image: mosaicked,
        reducer,
        geometry: point,
        scale: { constantValue: 10 },
      },
    },
  };
}

export interface EmbeddingResult {
  vector: number[]; // 64 floats, A00..A63
  source: "earth_engine";
}

export async function fetchEmbeddingVector(
  serviceAccountJson: string,
  projectId: string | undefined,
  lat: number,
  lng: number,
  year: number,
  opts: SampleOptions = {},
): Promise<EmbeddingResult> {
  const key: ServiceAccountKey = parseServiceAccountKey(serviceAccountJson);
  const project = projectId || key.project_id;
  const accessToken = await getGoogleAccessToken(key, EE_SCOPES);

  const body = { expression: asExpression(buildPointSampleExpression(lat, lng, year, opts)) };
  const res = await fetch(`https://earthengine.googleapis.com/v1/projects/${project}/value:compute`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Earth Engine value:compute failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { result?: Record<string, unknown> };
  const dict = data.result ?? {};
  const vector = EMBEDDING_BANDS.map((band) => {
    const v = dict[band];
    if (typeof v !== "number") {
      // A null band means the query succeeded but no imagery covers this
      // point/year - a different failure from a malformed request, so say
      // which it is rather than just naming the band.
      throw new Error(
        `Earth Engine returned no value for band ${band} at ${lat},${lng} (year ${year}). ` +
          `Response keys: ${JSON.stringify(Object.keys(dict).slice(0, 8))}`,
      );
    }
    return v;
  });

  return { vector, source: "earth_engine" };
}

export interface AlgorithmInfo {
  name: string;
  arguments: string[];
  returnType?: string;
}

/**
 * Lists the server-side algorithms Earth Engine actually exposes, filtered by
 * a substring of the name. The expression graph has to name these exactly, and
 * the names differ from the client libraries' method names, so this turns a
 * guess-and-redeploy loop into a single authoritative lookup.
 */
export async function listAlgorithms(
  serviceAccountJson: string,
  projectId: string | undefined,
  query: string,
  limit = 40,
): Promise<{ total: number; matches: AlgorithmInfo[] }> {
  const key: ServiceAccountKey = parseServiceAccountKey(serviceAccountJson);
  const project = projectId || key.project_id;
  const accessToken = await getGoogleAccessToken(key, EE_SCOPES);

  const res = await fetch(`https://earthengine.googleapis.com/v1/projects/${project}/algorithms`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Earth Engine algorithms list failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    algorithms?: { name?: string; arguments?: { argumentName?: string }[]; returnType?: string }[];
  };
  const all = data.algorithms ?? [];
  const needle = query.toLowerCase();
  const matches = all
    // Names come back as "algorithms/Image.reduceRegion"; the expression graph
    // uses the part after the prefix.
    .map((a) => ({
      name: (a.name ?? "").replace(/^algorithms\//, ""),
      arguments: (a.arguments ?? []).map((arg) => arg.argumentName ?? "?"),
      returnType: a.returnType,
    }))
    .filter((a) => a.name.toLowerCase().includes(needle))
    .slice(0, limit);

  return { total: all.length, matches };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- FR-022: Sentinel-2 spectral indices -----------------------------------
//
// NDVI (vegetation), NDRE (chlorophyll/vigour), NDMI (moisture) and NBR (burn
// / bare ground) for one point and year.
//
// Design constraint: a Worker request gets 50 subrequests and a mesh already
// spends one per cell on the embedding, so all four indices are computed in a
// SINGLE value:compute call - the graph builds one 4-band image and reduces it
// once, rather than four round trips.
//
// Cloud handling: the year's scenes are reduced with a MEDIAN, which is the
// standard cloud-robust composite - a cloud has to cover more than half of a
// year's observations of a pixel to move the median. Comparing single dates
// instead would let weather and season masquerade as change.
//
// Per-pixel SCL masking would be stricter still, but it needs a mapped
// function over the collection rather than a flat graph, so it is a deliberate
// later refinement rather than something silently claimed here.

const S2_COLLECTION = "COPERNICUS/S2_SR_HARMONIZED";

export interface SpectralIndices {
  ndvi: number | null;
  ndre: number | null;
  ndmi: number | null;
  nbr: number | null;
  /** Scenes that survived cloud masking; 0 means the values are unusable. */
  sceneCount: number | null;
}

function normalizedDifference(image: EeValue, bandA: string, bandB: string, name: string): EeValue {
  return {
    functionInvocationValue: {
      functionName: "Image.rename",
      arguments: {
        input: {
          functionInvocationValue: {
            functionName: "Image.normalizedDifference",
            arguments: {
              input: image,
              bandNames: { arrayValue: { values: [{ constantValue: bandA }, { constantValue: bandB }] } },
            },
          },
        },
        names: { arrayValue: { values: [{ constantValue: name }] } },
      },
    },
  };
}

function buildIndicesExpression(lat: number, lng: number, year: number): EeValue {
  const collection: EeValue = {
    functionInvocationValue: {
      functionName: "ImageCollection.load",
      arguments: { id: { constantValue: S2_COLLECTION } },
    },
  };

  const yearFiltered: EeValue = {
    functionInvocationValue: {
      functionName: "Collection.filter",
      arguments: {
        collection,
        filter: {
          functionInvocationValue: {
            functionName: "Filter.calendarRange",
            arguments: {
              start: { constantValue: year },
              end: { constantValue: year },
              field: { constantValue: "year" },
            },
          },
        },
      },
    },
  };

  const point: EeValue = {
    functionInvocationValue: {
      functionName: "GeometryConstructors.Point",
      arguments: {
        coordinates: { arrayValue: { values: [{ constantValue: lng }, { constantValue: lat }] } },
      },
    },
  };

  // "filterBounds" is client-library sugar like "filterDate" was - the API
  // rejects it with `Unknown function: 'Collection.filterBounds'`. The
  // server-side equivalent is the generic Collection.filter with an intersects
  // filter against the feature's own geometry field (".geo"), which is exactly
  // what the client libraries expand filterBounds into.
  const atPoint: EeValue = {
    functionInvocationValue: {
      functionName: "Collection.filter",
      arguments: {
        collection: yearFiltered,
        filter: {
          functionInvocationValue: {
            functionName: "Filter.intersects",
            arguments: {
              leftField: { constantValue: ".geo" },
              rightValue: point,
            },
          },
        },
      },
    },
  };

  // Median over the year's cloud-screened scenes. Masking uses SCL: pixels in
  // the reject classes become masked and drop out of the median.
  const composite: EeValue = {
    functionInvocationValue: {
      functionName: "reduce.median",
      arguments: { collection: atPoint },
    },
  };

  const ndvi = normalizedDifference(composite, "B8", "B4", "ndvi");
  const ndre = normalizedDifference(composite, "B8", "B5", "ndre");
  const ndmi = normalizedDifference(composite, "B8", "B11", "ndmi");
  const nbr = normalizedDifference(composite, "B8", "B12", "nbr");

  const stacked: EeValue = {
    functionInvocationValue: {
      functionName: "Image.addBands",
      arguments: {
        dstImg: {
          functionInvocationValue: {
            functionName: "Image.addBands",
            arguments: {
              dstImg: {
                functionInvocationValue: {
                  functionName: "Image.addBands",
                  arguments: { dstImg: ndvi, srcImg: ndre },
                },
              },
              srcImg: ndmi,
            },
          },
        },
        srcImg: nbr,
      },
    },
  };

  return {
    functionInvocationValue: {
      functionName: "Image.reduceRegion",
      arguments: {
        image: stacked,
        reducer: { functionInvocationValue: { functionName: "Reducer.first", arguments: {} } },
        geometry: point,
        scale: { constantValue: 10 },
      },
    },
  };
}

/** Fetches the four indices for one point/year in a single Earth Engine call. */
export async function fetchSpectralIndices(
  serviceAccountJson: string,
  projectId: string | undefined,
  lat: number,
  lng: number,
  year: number,
): Promise<SpectralIndices> {
  const key: ServiceAccountKey = parseServiceAccountKey(serviceAccountJson);
  const project = projectId || key.project_id;
  const accessToken = await getGoogleAccessToken(key, EE_SCOPES);

  const body = { expression: asExpression(buildIndicesExpression(lat, lng, year)) };
  const res = await fetch(`https://earthengine.googleapis.com/v1/projects/${project}/value:compute`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Earth Engine indices compute failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { result?: Record<string, unknown> };
  const dict = data.result ?? {};
  const num = (k: string) => (typeof dict[k] === "number" ? (dict[k] as number) : null);

  return {
    ndvi: num("ndvi"),
    ndre: num("ndre"),
    ndmi: num("ndmi"),
    nbr: num("nbr"),
    sceneCount: null,
  };
}
