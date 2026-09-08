import { expect, it, vi } from 'vitest';
import { getEmbeddingVector } from '../worker/src/lib/fieldData';
vi.mock('../worker/src/lib/earthEngine', () => ({ fetchEmbeddingVector: async () => ({vector: Array(64).fill(.125)}) }));
it('uses distinct precise cache keys for 10m neighboring rows and skips legacy coarse cache', async () => {
  const keys: unknown[][] = [];
  const queries: string[] = [];
  const DB = { prepare(sql: string) { queries.push(sql); const q = {bind(...args: unknown[]) { if(sql.startsWith('SELECT')) keys.push(args);return q;}, first:async()=>null,run:async()=>({success:true})}; return q; } };
  const env = { EE_SERVICE_ACCOUNT_JSON: 'test', DB } as any;
  await getEmbeddingVector(env, DB as any, 35.000042, 135, 2024);
  await getEmbeddingVector(env, DB as any, 35.000042 + 10/111320, 135, 2024);
  expect(keys).toHaveLength(2);
  expect(keys[0][0]).not.toBe(keys[1][0]);
  expect(queries.filter(q => q.startsWith('SELECT')).every(q => q.includes("source = 'earth_engine_point_v2'"))).toBe(true);
});
