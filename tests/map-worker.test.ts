import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
it('ships a real MapLibre worker and references its hashed URL in the release', () => {
  const dir = resolve('frontend/dist/assets');
  const files = readdirSync(dir);
  const worker = files.find(f => /^maplibre-gl-worker-.+\.js$/.test(f));
  expect(worker, 'Build first; missing workers silently fall back to SPA HTML').toBeTruthy();
  const script = readFileSync(resolve(dir, worker!), 'utf8');
  expect(script.trimStart().startsWith('<')).toBe(false);
  expect(script.length).toBeGreaterThan(10000);
  const app = files.filter(f => f.endsWith('.js') && f !== worker).map(f => readFileSync(resolve(dir, f), 'utf8')).join('\n');
  expect(app).toContain(`/assets/${worker}`);
});
