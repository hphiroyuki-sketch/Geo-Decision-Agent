import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function databaseFixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`,'utf8'));
  sqlite.exec(`INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES ('u','test@example.test','Test','disabled','disabled','2026-09-09');
    INSERT INTO projects (id,name,created_by,created_at,updated_at) VALUES ('p','Test','u','2026-09-09','2026-09-09');`);
  const DB={prepare(sql:string){let args:any[]=[];const q={bind(...v:any[]){args=v;return q},async first(){return sqlite.prepare(sql).get(...args)??null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}}}};return q;},async batch(qs:{run:()=>Promise<any>}[]){return Promise.all(qs.map(q=>q.run()))}};
  return {sqlite,DB};
}
