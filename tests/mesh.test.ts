import { expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { buildGrid, classifyCell } from '../worker/src/lib/mesh';
import { meshRoutes } from '../worker/src/routes/mesh';
vi.mock('../worker/src/lib/db', () => ({ getSetting: async (_db: unknown, _key: string, value: string) => value, logAudit: async () => {} }));
vi.mock('../worker/src/lib/fieldData', async (original) => ({ ...await original<object>(), getReferenceEmbedding: async () => null }));
function fixture(managed = false, sampledCount = 0) {
  const cells = (sampledCount ? Array(sampledCount).fill('sampled') : ['sampled', 'pending', 'failed']).map((status, i) => ({
    id: `cell-${i}`, status, row_idx: sampledCount ? Math.floor(i / 40) : 0, col_idx: sampledCount ? i % 40 : i, center_lat: 35 + Math.floor(i / 40) * .00009, center_lng: 135 + (i % 40) * .00011, min_lat: 35, max_lat: 35.00009,
    min_lng: 135 + i * .00011, max_lng: 135.00011 + i * .00011,
    reference_similarity: status === 'sampled' ? .91 : null, change_score: null,
    cell_class: status === 'sampled' ? 'priority_a' : null, field_records: 0,
  }));
  const mutations: string[] = [];
  const DB = {
    prepare(sql: string) {
      const q = {
        bind: (..._args: unknown[]) => q,
        first: async () => sql.includes('recovery_actions') ? { n: managed ? 1 : 0 } : sql.includes('projects') ? { center_lat: 35, center_lng: 135 } : { id: 'mesh-1', project_id: 'project-1', col_count: 3, cell_size_m: 10 },
        all: async () => ({ results: sql.includes('FROM mesh_cells') ? cells : [] }),
        run: async () => { mutations.push(sql); if (sql.includes("status = 'pending'")) cells.filter(c => c.status === 'failed').forEach(c => c.status = 'pending'); return { success: true }; },
      }; return q;
    },
    batch: async (queries: { run: () => unknown }[]) => Promise.all(queries.map(q => q.run())),
  };
  const app = new Hono().use('*', async (c, next) => { c.set('user' as never, { id: 'tester' } as never); await next(); }).route('/', meshRoutes);
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }, { DB });
  return { request, cells, mutations };
}
it('preserves contiguous 10m ground spacing at a Japanese latitude', () => {
  const cells = buildGrid(36.28, 137.03, 10, 200);
  expect(cells).toHaveLength(400);
  const a = cells[0], b = cells[1];
  expect((a.maxLat - a.minLat) * 111320).toBeCloseTo(10, 5);
  expect((a.maxLng - a.minLng) * 111320 * Math.cos(36.28 * Math.PI / 180)).toBeCloseTo(10, 5);
  expect(a.maxLng).toBeCloseTo(b.minLng, 10);
});
it('does not infer biodiversity from missing references', () => {
  expect(classifyCell(null, null)).toBe('unscored');
  expect(classifyCell(.95, .2)).toBe('changed');
});
it.each([{cellSizeM:0}, {cellSizeM:-10}, {extentM:-200}, {centerLat:90}, {centerLng:181}, {extentM:205}, {extentM:2000}])('rejects invalid grid %j', async body => {
  const f = fixture();
  expect((await f.request('/projects/project-1/meshes', 'POST', body)).status).toBe(400);
  expect(f.mutations).toEqual([]);
});
it('returns missing cells with honest statuses and unique numeric feature IDs', async () => {
  const data = await (await fixture().request('/meshes/mesh-1')).json() as any;
  expect(data.counts).toEqual({ total: 3, sampled: 1, pending: 1, failed: 1 });
  expect(data.geojson.features.map((f: any) => f.id)).toEqual([0, 1, 2]);
  expect(data.geojson.features[2].properties.label).toContain('取得失敗');
  expect(data.geojson.features[1].properties.similarity).toBeNull();
});
it('retries failures while preserving successful data', async () => {
  const f = fixture();
  expect((await f.request('/meshes/mesh-1/retry', 'POST', {})).status).toBe(200);
  expect(f.cells.map(c => c.status)).toEqual(['sampled', 'pending', 'pending']);
});
it('protects assigned recovery work from destructive reanalysis', async () => {
  const f = fixture(true);
  expect((await f.request('/meshes/mesh-1/analyze', 'POST', {})).status).toBe(409);
  expect(f.mutations).toEqual([]);
});

it('analyzes a 1600-cell patch without issuing a statement per cell', async () => {
  const f = fixture(false, 1600);
  const response = await f.request('/meshes/mesh-1/analyze', 'POST', {});
  expect(response.status).toBe(200);
  const updates = f.mutations.filter(sql => sql.startsWith('UPDATE mesh_cells SET hotspot_id = ?'));
  expect(updates.length).toBeGreaterThan(0);
  expect(updates.length).toBeLessThanOrEqual(20);
  expect(updates.every(sql => (sql.match(/\?/g) ?? []).length <= 100)).toBe(true);
});
