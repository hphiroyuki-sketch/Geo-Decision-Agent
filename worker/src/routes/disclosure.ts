import { Hono } from 'hono';
import type { Env, AuthUser } from '../types';
import { SECTIONS, type Framework } from '../../../shared/disclosure';
type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };
export const disclosureRoutes = new Hono<AppEnv>();

export function validateEntry(body: Record<string, unknown>, framework: string, code: string): string | null {
  if (!Object.hasOwn(SECTIONS, framework) || !SECTIONS[framework as Framework].some(s => s.code === code)) return '項目が見つかりません。';
  for (const [key, limit] of [['content', 16000], ['evidence', 4000], ['owner', 160], ['due', 10]] as const) {
    if (typeof body[key] !== 'string' || (body[key] as string).length > limit) return `${key}: 入力の形式または長さを確認してください。`;
  }
  if (!Number.isInteger(body.version) || (body.version as number) < 0) return '版番号が不正です。';
  if (!['draft', 'ready'].includes(String(body.status))) return '状態が不正です。';
  if (body.due && (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.due)) || !Number.isFinite(Date.parse(String(body.due))) || new Date(String(body.due)).toISOString().slice(0,10) !== body.due)) return '期限の日付が不正です。';
  if (body.status === 'ready' && ['content','evidence','owner'].some(k => !(body[k] as string).trim())) return '整理済みにするには本文・根拠・担当を記入してください。';
  return null;
}

disclosureRoutes.get('/projects/:id/disclosure', async c => {
  const id = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT id, name FROM projects WHERE id = ?').bind(id).first();
  if (!project) return c.json({error:'プロジェクトが見つかりません。'},404);
  const { results: entries } = await c.env.DB.prepare(`SELECT d.*, u.name AS updated_by_name FROM disclosure_entries d
    JOIN users u ON u.id = d.updated_by
    WHERE d.project_id = ? AND d.version = (SELECT MAX(e.version) FROM disclosure_entries e WHERE e.project_id=d.project_id AND e.framework=d.framework AND e.code=d.code)`)
    .bind(id).all();
  const inventory = await c.env.DB.prepare(`SELECT
    COALESCE(SUM(demo=0 AND source='field'),0) AS observed,
    COALESCE(SUM(demo=0 AND source='field' AND review_status='confirmed'),0) AS confirmed,
    COALESCE(SUM(demo=0 AND source='field' AND photo_key IS NOT NULL),0) AS media,
    COALESCE(SUM(demo=1),0) AS demo,
    COALESCE(SUM(source='map_pin'),0) AS pins,
    (SELECT COUNT(*) FROM meshes WHERE project_id=? AND status='ready') AS meshes,
    (SELECT COUNT(*) FROM recovery_actions WHERE project_id=?) AS actions
    FROM field_records WHERE project_id=?`).bind(id,id,id).first();
  return c.json({project, entries, inventory, generatedAt:new Date().toISOString()});
});

disclosureRoutes.get('/projects/:id/disclosure/:framework/:code/history', async c => {
  const { results } = await c.env.DB.prepare(`SELECT d.*, u.name AS updated_by_name FROM disclosure_entries d JOIN users u ON u.id=d.updated_by
    WHERE project_id=? AND framework=? AND code=? ORDER BY version DESC LIMIT 30`)
    .bind(c.req.param('id'),c.req.param('framework'),c.req.param('code')).all();
  return c.json({entries:results});
});

disclosureRoutes.patch('/projects/:id/disclosure/:framework/:code', async c => {
  const {id,framework,code}=c.req.param();
  const body = await c.req.json<Record<string,unknown>>().catch(() => null);
  if (!body || Array.isArray(body)) return c.json({error:'入力を確認してください。'},400);
  const error=validateEntry(body,framework,code);
  if(error) return c.json({error},400);
  if (!await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(id).first()) return c.json({error:'プロジェクトが見つかりません。'},404);
  const version=(body.version as number)+1;
  // Atomic optimistic concurrency: simultaneous edits cannot silently overwrite.
  const result=await c.env.DB.prepare(`INSERT INTO disclosure_entries
    (project_id,framework,code,version,content,evidence,owner,due,status,updated_by,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(version) FROM disclosure_entries WHERE project_id=? AND framework=? AND code=?),0)=?`)
    .bind(id,framework,code,version,body.content,body.evidence,body.owner,body.due,body.status,(c.get('user') as AuthUser).id,new Date().toISOString(),id,framework,code,body.version).run();
  if (!result.meta.changes) return c.json({error:'他の人が更新しています。入力内容を控えて再読み込みし、最新版と比較してください。'},409);
  return c.json({ok:true,version});
});
