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

export async function runSystemChecks(env: Env): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const year = Number(await getSetting(env.DB, "earth_engine_year", "2024"));

  if (!env.EE_SERVICE_ACCOUNT_JSON) {
    results.push({
      name: "ee_secret",
      ok: false,
      message: "EE_SERVICE_ACCOUNT_JSON が未設定です。",
      durationMs: 0,
    });
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

    // Records the real algorithm names for the operations the indices graph
    // depends on, so a name mismatch can be corrected from the recorded list
    // rather than by guessing again.
    for (const query of ["normalizedDifference", "addBands", "filterBounds", "median", "rename"]) {
      results.push(
        await timed(`ee_algorithms:${query}`, async () => {
          const { matches } = await listAlgorithms(
            env.EE_SERVICE_ACCOUNT_JSON as string,
            env.EE_PROJECT_ID,
            query,
            12,
          );
          return {
            message: `${matches.length} 件`,
            detail: JSON.stringify(matches.map((m) => `${m.name}(${m.arguments.join(",")})`)),
          };
        }),
      );
    }
  }

  const now = new Date().toISOString();
  const statements = results.map((r) =>
    env.DB.prepare(
      `INSERT INTO system_checks (id, check_name, ok, message, detail, duration_ms, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId("chk"), r.name, r.ok ? 1 : 0, r.message, r.detail ?? null, r.durationMs, now),
  );
  if (statements.length) await env.DB.batch(statements);

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
