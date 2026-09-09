import { expect,it } from 'vitest';
import { Hono } from 'hono';
import { databaseFixture } from './sqliteFixture';
import { disclosureRoutes,validateEntry } from '../worker/src/routes/disclosure';
const entry={version:0,content:'対象範囲を確認',evidence:'資料A p.2',owner:'担当者',due:'2026-10-01',status:'ready'};
it('validates preparation status without accepting impossible dates or prototype keys',()=>{
  expect(validateEntry(entry,'tnfd','scope')).toBeNull();
  for(const e of [{...entry,due:'2026-02-30'},{...entry,due:'2026-99-01'},{...entry,content:''},{...entry,version:-1}])expect(validateEntry(e,'tnfd','scope')).not.toBeNull();
  expect(validateEntry(entry,'toString','scope')).not.toBeNull();
});
it('persists revisions, rejects stale edits, and excludes demo evidence using real SQL',async()=>{
  const {sqlite,DB}=databaseFixture();
  sqlite.exec(`INSERT INTO field_records (id,project_id,observer_id,lat,lng,captured_at,created_at,review_status,demo) VALUES ('demo','p','u',35,135,'2026-09-09','2026-09-09','confirmed',1),('real','p','u',35,135,'2026-09-09','2026-09-09','unreviewed',0);`);
  const app=new Hono().use('*',async(c,next)=>{c.set('user' as never,{id:'u',role:'member'} as never);await next()}).route('/',disclosureRoutes);
  const req=(path:string,method='GET',body?:unknown)=>app.request(path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},{DB});
  expect((await req('/projects/p/disclosure/tnfd/scope','PATCH',entry)).status).toBe(200);
  expect((await req('/projects/p/disclosure/tnfd/scope','PATCH',entry)).status).toBe(409);
  expect((await req('/projects/p/disclosure/tnfd/scope','PATCH',{...entry,version:1,content:'更新'})).status).toBe(200);
  const result=await (await req('/projects/p/disclosure')).json() as any;
  expect(result.entries).toHaveLength(1);expect(result.entries[0].content).toBe('更新');
  expect(result.inventory.observed).toBe(1);expect(result.inventory.confirmed).toBe(0);expect(result.inventory.demo).toBe(1);
  const history=await (await req('/projects/p/disclosure/tnfd/scope/history')).json() as any;
  expect(history.entries.map((e:any)=>e.version)).toEqual([2,1]);
  expect((await req('/projects/missing/disclosure/tnfd/scope','PATCH',entry)).status).toBe(404);
  sqlite.close();
});
