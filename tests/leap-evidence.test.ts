import { expect,it } from 'vitest';
import {databaseFixture} from './sqliteFixture';
import {buildLeapReport} from '../worker/src/lib/leap';
it('does not report demo species or satellite similarity as confirmed biodiversity integrity',async()=>{
 const {sqlite,DB}=databaseFixture();
 sqlite.exec(`INSERT INTO field_records(id,project_id,observer_id,lat,lng,species_guess,captured_at,created_at,review_status,demo) VALUES ('f','p','u',35,135,'DEMO SPECIES','2026-09-09','2026-09-09','confirmed',1);
 INSERT INTO meshes(id,project_id,center_lat,center_lng,cell_size_m,extent_m,row_count,col_count,year,status,reference_points,created_by,created_at) VALUES ('m','p',35,135,10,10,1,1,2024,'ready',1,'u','2026-09-09');
 INSERT INTO mesh_cells(id,mesh_id,row_idx,col_idx,center_lat,center_lng,min_lat,min_lng,max_lat,max_lng,status,reference_similarity,change_score,cell_class) VALUES ('c','m',0,0,35,135,35,135,35.0001,135.0001,'sampled',.99,.001,'priority_a');`);
 const result=await buildLeapReport({DB} as any,'p');
 expect(JSON.stringify(result)).not.toContain('DEMO SPECIES');
 const serialized=JSON.stringify(result);
 expect(serialized).not.toContain('現地確認済み 1 件');
 // Both criteria remain unassessed even when successful satellite results exist.
 const criteria=result.sensitive;
 expect(criteria.find((s:any)=>s.key==='high_integrity').assessable).toBe(false);
 expect(criteria.find((s:any)=>s.key==='rapid_decline').assessable).toBe(false);
 sqlite.close();
});
