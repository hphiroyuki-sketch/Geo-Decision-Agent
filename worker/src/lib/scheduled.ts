// Scheduled work: self-checks and alert generation.
//
// The self-check exists for a specific reason. Earth Engine's expression-graph
// wire format has to name server-side algorithms exactly, and the build
// environment cannot reach earthengine.googleapis.com to try them - every
// mismatch otherwise costs a deploy plus a person opening a diagnostic URL and
// pasting the result back. Running the same probes on a schedule and recording
// the raw upstream error in D1 turns that loop into something readable
// directly from the database.

import type { Env } from "../types";
import { newId } from "./crypto";
import { getSetting } from "./db";
import { fetchEmbeddingVector, fetchSpectralIndices, listAlgorithms } from "./earthEngine";

interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
  detail?: string;
  durationMs: number;
}

async function timed(name: string, fn: () => Promise<{ message: string; detail?: string }>): Promise<CheckResult> {
  const started = Date.now();
  try {
    const { message, detail } = await fn();
    return { name, ok: true, message, detail, durationMs: Date.now() - started };
  } catch (err) {
    return {
      name,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/** Tokyo Station - imagery and indices both exist here, so a failure is the
 *  query's fault rather than a gap in coverage. */
const PROBE = { lat: 35.6812, lng: 139.7671 };

/**
 * Writes one result immediately. The Free plan's 10ms CPU ceiling applies to
 * scheduled invocations too, so a batch written at the end is lost whole if
 * any earlier step overruns - recording as we go means a partial run still
 * leaves evidence of how far it got.
 */
async function record(env: Env, r: CheckResult): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO system_checks (id, check_name, ok, message, detail, duration_ms, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId("chk"),
      r.name,
      r.ok ? 1 : 0,
      r.message.slice(0, 900),
      r.detail?.slice(0, 900) ?? null,
      r.durationMs,
      new Date().toISOString(),
    )
    .run();
}

export interface SystemCheckOptions {
  /** Listing Earth Engine's ~1000 algorithms means parsing a megabyte of JSON,
   *  which alone can exceed the scheduled CPU budget - so it runs only when a
   *  person asks for it from the admin screen. */
  includeAlgorithms?: boolean;
}

export async function runSystemChecks(env: Env, opts: SystemCheckOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const year = Number(await getSetting(env.DB, "earth_engine_year", "2024"));

  if (!env.EE_SERVICE_ACCOUNT_JSON) {
    const missing: CheckResult = {
      name: "ee_secret",
      ok: false,
      message: "EE_SERVICE_ACCOUNT_JSON が未設定です。",
      durationMs: 0,
    };
    results.push(missing);
    await record(env, missing);
  } else {
    results.push(
      await timed("ee_embedding", async () => {
        const { vector } = await fetchEmbeddingVector(
          env.EE_SERVICE_ACCOUNT_JSON as string,
          env.EE_PROJECT_ID,
          PROBE.lat,
          PROBE.lng,
          year,
        );
        return { message: `ok (${vector.length}次元)`, detail: JSON.stringify(vector.slice(0, 3)) };
      }),
    );
    await record(env, results[results.length - 1]);

    results.push(
      await timed("ee_indices", async () => {
        const indices = await fetchSpectralIndices(
          env.EE_SERVICE_ACCOUNT_JSON as string,
          env.EE_PROJECT_ID,
          PROBE.lat,
          PROBE.lng,
          year,
        );
        const missing = (["ndvi", "ndre", "ndmi", "nbr"] as const).filter((k) => indices[k] === null);
        if (missing.length === 4) throw new Error(`全指標がnullで返りました: ${JSON.stringify(indices)}`);
        return {
          message: missing.length ? `partial (null: ${missing.join(",")})` : "ok",
          detail: JSON.stringify(indices),
        };
      }),
    );
    await record(env, results[results.length - 1]);

    // Records the real algorithm names behind the indices graph, so a name
    // mismatch is corrected from the returned list rather than guessed at
    // again. One listing covers every query, because fetching the catalogue
    // repeatedly is what makes this expensive.
    if (opts.includeAlgorithms) {
      const check = await timed("ee_algorithms", async () => {
        const found: string[] = [];
        for (const query of ["normalizedDifference", "addBands", "filterBounds", "median"]) {
          const { matches } = await listAlgorithms(
            env.EE_SERVICE_ACCOUNT_JSON as string,
            env.EE_PROJECT_ID,
            query,
            6,
          );
          found.push(...matches.map((m) => `${m.name}(${m.arguments.join(",")})`));
        }
        return { message: `${found.length} 件`, detail: JSON.stringify(found) };
      });
      results.push(check);
      await record(env, check);
    }
  }

  // Keep only recent history; this table is a diagnostic, not an archive.
  await env.DB.prepare(
    `DELETE FROM system_checks WHERE checked_at < datetime('now', '-2 days')`,
  ).run();

  return results;
}

/**
 * FR-060. Raises an alert for every mesh hotspot and unreviewed record that
 * crosses a rule, deduplicated by source so a standing condition does not
 * generate a new alert on every run.
 */
export async function generateAlerts(env: Env): Promise<number> {
  const now = new Date().toISOString();
  const { results: rules } = await env.DB.prepare(
    "SELECT * FROM alert_rules WHERE enabled = 1",
  ).all<{ id: string; name: string; metric: string; comparator: string; threshold: number; severity: string }>();

  const inserts: D1PreparedStatement[] = [];

  const changeRule = rules.find((r) => r.metric === "change_score");
  if (changeRule) {
    const { results } = await env.DB.prepare(
      `SELECT h.id, h.area_ha, h.center_lat, h.center_lng, h.mean_change, m.project_id, m.id AS mesh_id, p.name AS project_name
       FROM mesh_hotspots h JOIN meshes m ON m.id = h.mesh_id JOIN projects p ON p.id = m.project_id
       WHERE h.cell_class = 'changed' AND h.mean_change >= ?`,
    )
      .bind(changeRule.threshold)
      .all<{
        id: string;
        area_ha: number;
        center_lat: number;
        center_lng: number;
        mean_change: number;
        project_id: string;
        mesh_id: string;
        project_name: string;
      }>();

    for (const h of results) {
      inserts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO alerts (id, project_id, severity, category, title, detail, next_action, lat, lng, link, source_id, created_at)
           VALUES (?, ?, ?, 'threshold', ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId("alt"),
          h.project_id,
          changeRule.severity,
          `変化検出 ${h.area_ha.toFixed(2)}ha（${h.project_name}）`,
          `前年比の埋め込み差が平均 ${h.mean_change.toFixed(3)} で、判定基準 ${changeRule.threshold} を超えました。衛星は「変わったこと」しか示せません。`,
          "30日以内に現地確認を行い、伐採・災害・病虫害・季節差のいずれかを判別してください。原因が判明するまで、この区域を判断の根拠に使わないでください。",
          h.center_lat,
          h.center_lng,
          `/projects/${h.project_id}/mesh?mesh=${h.mesh_id}`,
          h.id,
          now,
        ),
      );
    }
  }

  const { results: stale } = await env.DB.prepare(
    `SELECT f.id, f.project_id, f.species_guess, f.lat, f.lng, p.name AS project_name
     FROM field_records f JOIN projects p ON p.id = f.project_id
     WHERE f.review_status = 'unreviewed' AND f.created_at < datetime('now', '-3 days') LIMIT 50`,
  ).all<{
    id: string;
    project_id: string;
    species_guess: string | null;
    lat: number;
    lng: number;
    project_name: string;
  }>();

  for (const r of stale) {
    inserts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO alerts (id, project_id, severity, category, title, detail, next_action, lat, lng, link, source_id, created_at)
         VALUES (?, ?, 'medium', 'review', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId("alt"),
        r.project_id,
        `未査読の現地記録が3日以上滞留（${r.project_name}）`,
        `${r.species_guess ?? "種未記入"} の記録が査読されていません。未査読の記録は分析の根拠に使われません。`,
        "現地記録画面で内容を確認し、「確認済み」または「却下」を選んでください。",
        r.lat,
        r.lng,
        `/projects/${r.project_id}/field`,
        r.id,
        now,
      ),
    );
  }

  for (let i = 0; i < inserts.length; i += 50) {
    await env.DB.batch(inserts.slice(i, i + 50));
  }
  return inserts.length;
}
