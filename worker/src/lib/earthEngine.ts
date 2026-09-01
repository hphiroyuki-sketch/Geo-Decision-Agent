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
// but has not been exercised against a live Earth Engine project from this
// environment - the build sandbox's network policy blocks
// developers.google.com and earthengine.googleapis.com, so this has only
// been reviewed, not run. The first real call after deploy is the actual
// test; Earth Engine's error responses name the exact function/argument at
// fault, so a mismatch here is a quick, visible fix rather than a silent one.

import { getGoogleAccessToken, parseServiceAccountKey, type ServiceAccountKey } from "./googleAuth";

const EE_SCOPES = ["https://www.googleapis.com/auth/earthengine.readonly", "https://www.googleapis.com/auth/cloud-platform.read-only"];
const SATELLITE_EMBEDDING_COLLECTION = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL";
const EMBEDDING_BANDS = Array.from({ length: 64 }, (_, i) => `A${String(i).padStart(2, "0")}`);

type EeValue =
  | { constantValue: unknown }
  | { arrayValue: { values: EeValue[] } }
  | { functionInvocationValue: { functionName: string; arguments: Record<string, EeValue> } };

function buildPointSampleExpression(lat: number, lng: number, year: number): EeValue {
  const collection: EeValue = {
    functionInvocationValue: {
      functionName: "ImageCollection.load",
      arguments: { id: { constantValue: SATELLITE_EMBEDDING_COLLECTION } },
    },
  };
  const filtered: EeValue = {
    functionInvocationValue: {
      functionName: "Collection.filterDate",
      arguments: {
        collection,
        start: { constantValue: `${year}-01-01` },
        end: { constantValue: `${year + 1}-01-01` },
      },
    },
  };
  const mosaicked: EeValue = {
    functionInvocationValue: { functionName: "ImageCollection.mosaic", arguments: { collection: filtered } },
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
): Promise<EmbeddingResult> {
  const key: ServiceAccountKey = parseServiceAccountKey(serviceAccountJson);
  const project = projectId || key.project_id;
  const accessToken = await getGoogleAccessToken(key, EE_SCOPES);

  const body = { expression: buildPointSampleExpression(lat, lng, year) };
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

  const data = (await res.json()) as { result?: Record<string, number> };
  const dict = data.result ?? {};
  const vector = EMBEDDING_BANDS.map((band) => {
    const v = dict[band];
    if (typeof v !== "number") throw new Error(`Earth Engine response missing band ${band}`);
    return v;
  });

  return { vector, source: "earth_engine" };
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
