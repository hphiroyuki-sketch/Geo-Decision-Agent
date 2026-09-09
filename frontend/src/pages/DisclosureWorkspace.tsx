import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileDown, Save, CheckCircle2, Circle, ArrowLeft, History, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { FRAMEWORKS, SECTIONS, type Framework, type DisclosureEntry, type EvidenceInventory } from '../../../shared/disclosure';
interface Workspace { project:{id:string;name:string}; entries:(DisclosureEntry & {framework:Framework})[]; inventory:EvidenceInventory; generatedAt:string; }
const empty=(code:string):DisclosureEntry=>({code,content:'',evidence:'',owner:'',due:'',status:'draft',version:0});
const input='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-emerald-600';
export default function DisclosureWorkspace(){
  const {id}=useParams(); const {user}=useAuth();
  const [data,setData]=useState<Workspace|null>(null);
  const [framework,setFramework]=useState<Framework>('tnfd');
  const [code,setCode]=useState('scope');
  const [entry,setEntry]=useState<DisclosureEntry>(empty('scope'));
  const [dirty,setDirty]=useState(false); const [saving,setSaving]=useState(false);
  const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [history,setHistory]=useState<DisclosureEntry[]|null>(null);
  const load=()=>api.get<Workspace>(`/projects/${id}/disclosure`);
  useEffect(()=>{let live=true;load().then(d=>{if(live){setData(d);setEntry(d.entries.find(e=>e.framework==='tnfd'&&e.code==='scope')??empty('scope'));}}).catch(e=>setError(String(e)));return()=>{live=false};},[id]);
  useEffect(()=>{const guard=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
  useEffect(()=>{
    const guard=(e:MouseEvent)=>{ const anchor=(e.target as Element)?.closest?.('a[href]'); if(dirty&&anchor&&!window.confirm('未保存の入力があります。破棄して移動しますか？')){e.preventDefault();e.stopPropagation();} };
    document.addEventListener('click',guard,true);return()=>document.removeEventListener('click',guard,true);
  },[dirty]);
  const select=(f:Framework,c:string)=>{
    if(dirty&&!window.confirm('未保存の入力があります。破棄して別の項目を開きますか？'))return;
    setFramework(f);setCode(c);setEntry(data?.entries.find(e=>e.framework===f&&e.code===c)??empty(c));setDirty(false);setHistory(null);setNotice('');setError('');
  };
  const update=(key:keyof DisclosureEntry,value:string)=>{setEntry(e=>({...e,[key]:value}));setDirty(true);setNotice('');};
  const save=async()=>{setSaving(true);setError('');try{await api.patch(`/projects/${id}/disclosure/${framework}/${code}`,entry);const d=await load();setData(d);setEntry(d.entries.find(e=>e.framework===framework&&e.code===code)??empty(code));setDirty(false);setNotice('保存しました。前の版は履歴から確認できます。');setHistory(null);}catch(e){setError(String(e));}finally{setSaving(false);}};
  const download=(format:'md'|'json')=>{
    if(!data)return;
    const sections=SECTIONS[framework];
    const lines=[`# ${data.project.name} — ${FRAMEWORKS[framework].title}`,`作成: ${new Date().toISOString()}`,`状態: 社内検討用の下書き（公式様式・認定結果ではありません）`,FRAMEWORKS[framework].note,`参照: ${FRAMEWORKS[framework].source}`,`## 根拠の内訳`,`実地記録 ${data.inventory.observed}件 / レビュー済み ${data.inventory.confirmed}件 / メディア付 ${data.inventory.media}件`,`デモ ${data.inventory.demo}件・地図指定 ${data.inventory.pins}件は生息証拠に含めません。`,`記録: /projects/${id}/field`,`衛星分析: /projects/${id}/mesh`,`回復活動: /projects/${id}/recovery`,...sections.flatMap(s=>{const e=data.entries.find(e=>e.framework===framework&&e.code===s.code);return [`## ${s.code} ${s.title}`,`準備状態: ${e?.status==='ready'?'整理済み（自己申告・開示承認ではありません）':e?'作成中':'未着手'}`,`担当: ${e?.owner||'未設定'} / 期限: ${e?.due||'未設定'}`,e?.content||'未記入',`根拠・参照資料: ${e?.evidence||'未登録'}`,`保存版: ${e?.version||0} / 更新: ${e?.updated_at||'—'}`];})];
    const payload=format==='md'?lines.join('\n\n'):JSON.stringify({...data,framework,sections,entries:data.entries.filter(e=>e.framework===framework),purpose:'internal_draft',exportedAt:new Date().toISOString()},null,2);
    const url=URL.createObjectURL(new Blob([payload],{type:format==='md'?'text/markdown;charset=utf-8':'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${framework}_準備資料_${new Date().toISOString().slice(0,10)}.${format}`;a.click();URL.revokeObjectURL(url);
  };
  const sections=SECTIONS[framework];const section=sections.find(s=>s.code===code)!;
  const ready=sections.filter(s=>data?.entries.some(e=>e.framework===framework&&e.code===s.code&&e.status==='ready')).length;
  const editable=user?.role!=='viewer';
  return <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
    <div className="flex flex-wrap justify-between gap-3 items-start">
      <div><Link to={`/projects/${id}`} className="text-xs text-slate-600 flex items-center gap-1"><ArrowLeft size={12}/>プロジェクトへ</Link><h1 className="text-2xl font-semibold text-slate-900 mt-2">開示・申請準備</h1><p className="text-sm text-slate-600 mt-1">{data?.project.name} · 調査の根拠を、次の社内判断へ。</p></div>
      <div className="flex gap-2"><button disabled={!data||dirty} onClick={()=>download('md')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm flex gap-2 items-center disabled:opacity-40"><FileDown size={16}/>下書き出力</button><button disabled={!data||dirty} onClick={()=>download('json')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40">JSON</button></div>
    </div>
    {error&&<p role="alert" className="p-3 bg-rose-50 text-rose-800 rounded-lg">{error}</p>}
    {data&&<div className="rounded-2xl bg-[#112d2d] text-white p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div><span className="text-xs text-emerald-100">実地記録 / レビュー済み</span><p className="text-2xl font-semibold mt-1">{data.inventory.observed}<span className="text-sm"> 件 / {data.inventory.confirmed} 件</span></p><Link to={`/projects/${id}/field`} className="text-xs underline text-emerald-100">現地記録を確認</Link></div>
      <div><span className="text-xs text-emerald-100">写真・動画付き記録</span><p className="text-2xl font-semibold mt-1">{data.inventory.media}<span className="text-sm"> 件</span></p><p className="text-xs text-emerald-100">デモは実地記録から除外</p></div>
      <div><span className="text-xs text-emerald-100">取得完了のメッシュ解析</span><p className="text-2xl font-semibold mt-1">{data.inventory.meshes}<span className="text-sm"> 件</span></p><Link to={`/projects/${id}/mesh`} className="text-xs underline text-emerald-100">衛星の根拠を確認</Link></div>
      <div><span className="text-xs text-emerald-100">回復計画の施策</span><p className="text-2xl font-semibold mt-1">{data.inventory.actions}<span className="text-sm"> 件</span></p><Link to={`/projects/${id}/recovery`} className="text-xs underline text-emerald-100">担当・期限・進捗を確認</Link></div>
    </div>}
    {data&&(data.inventory.demo>0||data.inventory.pins>0)&&<p className="text-xs rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">比較用デモ {data.inventory.demo}件 / 地図指定 {data.inventory.pins}件。これらは実地の生息証拠には含めていません。参考資料を本文に利用する場合も出典と限界を記入してください。</p>}
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="準備する資料">{(['tnfd','site'] as Framework[]).map(f=><button key={f} role="tab" aria-selected={framework===f} onClick={()=>select(f,SECTIONS[f][0].code)} className={`px-4 py-2.5 rounded-lg text-sm font-semibold ${framework===f?'bg-emerald-700 text-white':'bg-white border border-slate-300 text-slate-600'}`}>{FRAMEWORKS[f].title}</button>)}<span className="ml-auto text-xs text-slate-600">整理済み {ready} / {sections.length}項目（自己申告）</span></div>
    <p className="text-xs text-slate-600 leading-relaxed">{FRAMEWORKS[framework].note} <a href={FRAMEWORKS[framework].source} target="_blank" rel="noreferrer" className="text-emerald-700 underline">公式案内 ↗</a>{framework==='site'&&<> · <a href="https://www.erca.go.jp/nature/henko.html" target="_blank" rel="noreferrer" className="underline">認定後・期間延長の案内</a></>}</p>
    <label className="block lg:hidden text-sm text-slate-700">準備項目<select className={`${input} mt-2`} value={code} onChange={e=>select(framework,e.target.value)}>{sections.map(s=><option key={s.code} value={s.code}>{s.group} · {s.title}</option>)}</select></label>
    <div className="grid lg:grid-cols-[300px_1fr] gap-4">
      <nav aria-label="準備項目" className="hidden lg:block rounded-xl border border-slate-200 bg-white p-2 lg:max-h-[720px] overflow-y-auto">{sections.map((s,i)=>{const e=data?.entries.find(e=>e.framework===framework&&e.code===s.code);return <div key={s.code}>{(i===0||sections[i-1].group!==s.group)&&<p className="px-3 pt-3 pb-1 text-xs text-slate-500 font-semibold">{s.group}</p>}<button onClick={()=>select(framework,s.code)} className={`w-full p-3 rounded-lg flex items-center gap-2 text-left text-sm ${code===s.code?'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200':'text-slate-700 hover:bg-slate-50'}`}>{e?.status==='ready'?<CheckCircle2 size={16} className="text-emerald-700 shrink-0"/>:<Circle size={16} className="text-slate-400 shrink-0"/>}<span className="flex-1">{s.title}</span><span className="text-[10px]">{e?'v'+e.version:'未着手'}</span></button></div>;})}</nav>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
        <div><span className="text-xs text-emerald-700 font-semibold">{section.code} · {section.group}</span><h2 className="text-xl text-slate-900 font-semibold mt-1">{section.title}</h2><p className="text-sm text-slate-600 mt-2 leading-relaxed">{section.guidance}</p></div>
        <label className="block text-sm font-medium text-slate-700">本文・計画<textarea disabled={!editable} value={entry.content} onChange={e=>update('content',e.target.value)} maxLength={16000} rows={9} className={`${input} mt-2`} placeholder="確認できたこと、未確認のこと、次の対応を記入"/></label>
        <label className="block text-sm font-medium text-slate-700">根拠・参照資料<textarea disabled={!editable} value={entry.evidence} onChange={e=>update('evidence',e.target.value)} maxLength={4000} rows={3} className={`${input} mt-2`} placeholder="観測ID、解析ID、資料URL、報告書のページ、確認者と日付など"/></label>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs text-slate-600">担当<input disabled={!editable} value={entry.owner} onChange={e=>update('owner',e.target.value)} maxLength={160} className={`${input} mt-1`}/></label>
          <label className="text-xs text-slate-600">期限<input disabled={!editable} type="date" value={entry.due} onChange={e=>update('due',e.target.value)} className={`${input} mt-1`}/></label>
          <label className="text-xs text-slate-600">準備状態<select disabled={!editable} value={entry.status} onChange={e=>update('status',e.target.value)} className={`${input} mt-1`}><option value="draft">作成中</option><option value="ready">整理済み（自己申告）</option></select></label>
        </div>
        <p className="text-xs text-slate-500">整理済みは、開示承認や認定取得を意味しません。本文・根拠・担当の入力が必要です。</p>
        <div className="flex flex-wrap items-center gap-3"><button disabled={!editable||saving||!dirty} onClick={save} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm text-white disabled:opacity-40"><Save size={15}/>{saving?'保存中…':'この項目を保存'}</button><button onClick={async()=>{try{setHistory((await api.get<{entries:DisclosureEntry[]}>(`/projects/${id}/disclosure/${framework}/${code}/history`)).entries);}catch(e){setError(String(e));}}} className="text-xs text-slate-600 flex items-center gap-1"><History size={14}/>変更履歴</button><span className="text-xs text-slate-500">{dirty?'未保存の変更あり':entry.version?`保存版 ${entry.version} · ${entry.updated_by_name}`:'未保存'}</span></div>
        {notice&&<p role="status" className="text-sm text-emerald-800">{notice}</p>}
        {history&&<div className="border-t border-slate-200 pt-3 space-y-2"><h3 className="font-semibold text-sm">過去の保存版（直近30件）</h3>{history.length===0&&<p className="text-xs">保存履歴はまだありません。</p>}{history.map(h=><details key={h.version} className="bg-slate-50 rounded p-3 text-xs"><summary>版 {h.version} · {h.updated_by_name} · {h.updated_at}</summary><p className="whitespace-pre-wrap mt-3">{h.content}</p><p className="whitespace-pre-wrap mt-2">根拠: {h.evidence}</p><button disabled={!editable} onClick={()=>{setEntry({...h,version:entry.version});setDirty(true);setHistory(null);}} className="mt-3 underline text-emerald-700">この内容を編集欄に復元（保存すると新しい版になります）</button></details>)}</div>}
        <Link to={`/projects/${id}/leap`} className="text-xs text-emerald-700 underline flex items-center gap-1"><ExternalLink size={12}/>衛星・公開データのスクリーニング報告も確認する</Link>
      </section>
    </div>
  </div>;
}
