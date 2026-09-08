import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { chatRoutes } from '../worker/src/routes/chat';
it('rejects a selected cell outside the conversation project before saving or calling AI', async () => {
  const bound: unknown[][] = [];
  let writes = 0;
  const DB = { prepare(sql: string) { const q = {
    bind(...args: unknown[]) { if(sql.includes('JOIN meshes')) bound.push(args); return q; },
    first: async () => sql.includes('FROM conversations') ? {id:'chat-a',project_id:'project-a'} : null,
    run: async () => {writes++;},
  }; return q; } };
  const app = new Hono().use('*',async(c,next)=>{c.set('user' as never,{id:'tester'} as never);await next();}).route('/',chatRoutes);
  const response = await app.request('/chat-a/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'この場所について教えて',selectedCellId:'cell-other-project'})},{DB});
  expect(response.status).toBe(400);
  expect(bound).toEqual([['cell-other-project','project-a']]);
  expect(writes).toBe(0);
});
