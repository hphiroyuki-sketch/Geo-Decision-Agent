import {expect,it} from 'vitest';
import {mediaMatchesType} from '../worker/src/lib/observationMedia';
it('rejects executable uploads disguised as images and recognizes supported signatures',()=>{
  const html=new TextEncoder().encode('<html><script>alert(1)</script></html>');
  expect(mediaMatchesType(html,'image/jpeg')).toBe(false);
  expect(mediaMatchesType(html,'image/svg+xml')).toBe(false);
  const jpeg=new Uint8Array(20);jpeg.set([255,216,255]);expect(mediaMatchesType(jpeg,'image/jpeg')).toBe(true);
  const video=new Uint8Array(20);video.set(new TextEncoder().encode('ftyp'),4);expect(mediaMatchesType(video,'video/mp4')).toBe(true);
});

import {Hono} from 'hono';
import {databaseFixture} from './sqliteFixture';
import {fieldRecordRoutes} from '../worker/src/routes/fieldRecords';
it('stores media digest and preserves independent capture/receipt metadata',async()=>{
  const {sqlite,DB}=databaseFixture();let puts=0;
  const app=new Hono().use('*',async(c,next)=>{c.set('user' as never,{id:'u'} as never);await next()}).route('/',fieldRecordRoutes);
  const req=(body:any)=>app.request('/projects/p/field-records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB,PHOTOS:{put:async()=>{puts++}}});
  const photo='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwFoAAAAASUVORK5CYII=';
  const base={lat:35,lng:135,photoBase64:photo,photoContentType:'image/png',capturedAt:'2026-09-01T00:00:00Z',locationSource:'manual'};
  expect((await req({...base,lat:91})).status).toBe(400);
  expect((await req({...base,photoContentType:'image/svg+xml'})).status).toBe(400);
  expect(puts).toBe(0);
  expect((await req(base)).status).toBe(200);
  const row=sqlite.prepare('SELECT * FROM field_records').get() as any;
  expect(row.media_sha256).toMatch(/^[a-f0-9]{64}$/);expect(row.captured_at).toBe('2026-09-01T00:00:00.000Z');expect(row.created_at).not.toBe(row.captured_at);expect(row.location_source).toBe('manual');expect(row.review_status).toBe('unreviewed');sqlite.close();
});
