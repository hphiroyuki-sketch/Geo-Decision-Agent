import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { requireWriteAccess } from '../worker/src/lib/auth';
it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks viewer mutation %s before the handler', async method => {
  const app = new Hono().use('*', async(c, next) => { c.set('user' as never, { role: 'viewer' } as never); await next(); }).use('*', requireWriteAccess).all('*', c => c.json({ mutated: true }));
  expect((await app.request('/mesh', {method})).status).toBe(403);
  expect((await app.request('/mesh')).status).toBe(200);
});
it('allows member edits', async () => {
  const app = new Hono().use('*', async(c, next) => { c.set('user' as never, { role: 'member' } as never); await next(); }).use('*', requireWriteAccess).post('*', c => c.json({ok:true}));
  expect((await app.request('/mesh', {method:'POST'})).status).toBe(200);
});
