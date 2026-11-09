// Independent, resumable frontier snapshots; never modifies the staged atlas or career networks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DATA=path.join(ROOT,'public/data');
const CACHE=path.join(ROOT,'.cache/frontier');fs.mkdirSync(CACHE,{recursive:true});
const OUT=path.join(DATA,'frontier');fs.mkdirSync(OUT,{recursive:true});
const KEY=process.env.OPENALEX_API_KEY||fs.readFileSync(path.join(ROOT,'.cache/openalex-key'),'utf8').trim();
const end=process.env.AS_OF||new Date().toISOString().slice(0,10);
const ago=(n)=>{const d=new Date(end+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-n);return d.toISOString().slice(0,10)};
const start=ago(3),activeSince=ago(1),tail=s=>String(s||'').split('/').pop();
let stopped=false,calls=0;
async function get(endpoint,params){
 const query=new URLSearchParams(params).toString(),file=path.join(CACHE,crypto.createHash('sha256').update(endpoint+'?'+query).digest('hex')+'.json');
 if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file));
 if(stopped)throw Error('API allowance exhausted');
 for(let attempt=0;attempt<4;attempt++){
  const u=new URL('https://api.openalex.org/'+endpoint+'?'+query);u.searchParams.set('api_key',KEY);
  const r=await fetch(u,{signal:AbortSignal.timeout(90000)});
  if(r.status===429){stopped=true;throw Error('API allowance exhausted; rerun to resume');}
  if(r.status>=500){await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}
  if(!r.ok)throw Error('OpenAlex HTTP '+r.status);
  const j=await r.json();fs.writeFileSync(file,JSON.stringify(j));calls++;return j;
 }
 throw Error('OpenAlex temporarily unavailable');
}
const base=(sid,date)=>`from_publication_date:${date},to_publication_date:${end},primary_topic.subfield.id:${sid},is_retracted:false`;
async function build(s){
 const target=path.join(OUT,'s'+s.id+'.json');
 if(fs.existsSync(target)&&JSON.parse(fs.readFileSync(target)).meta?.asOf===end)return;
 const ranked=await get('works',{filter:base(s.id,start)+',citation_normalized_percentile.is_in_top_10_percent:true',group_by:'authorships.author.id',per_page:'100'});
 const candidates=(ranked.group_by||[]).filter(g=>g.key&&g.count>=2).map(g=>({id:tail(g.key),hq:g.count}));
 const ids=new Set(candidates.map(p=>p.id)),activity=new Map();
 // Cursor through exact grouped counts, including coauthors; stop only when every
 // candidate is found or the result is exhausted. Missing after exhaustion means zero.
 if(ids.size){let cursor='*';const seen=new Set();do{
  const j=await get('works',{filter:base(s.id,activeSince)+',authorships.author.id:'+Array.from(ids).join('|'),group_by:'authorships.author.id',per_page:'200',cursor});
  for(const g of j.group_by||[])if(ids.has(tail(g.key)))activity.set(tail(g.key),g.count);
  const next=j.meta?.next_cursor;if(next&&seen.has(next))throw Error('Repeated activity cursor');seen.add(next);cursor=next;
 }while(cursor&&activity.size<ids.size);}
 const chosen=candidates.filter(p=>(activity.get(p.id)||0)>0).sort((a,b)=>b.hq-a.hq||(activity.get(b.id)-activity.get(a.id))||a.id.localeCompare(b.id)).slice(0,60);
 const authors=chosen.length?(await get('authors',{filter:'openalex_id:'+chosen.map(p=>p.id).join('|'),per_page:'100',select:'id,display_name,cited_by_count,summary_stats,last_known_institutions'})).results:[];
 const profiles=new Map((authors||[]).map(a=>[tail(a.id),a]));
 const people=chosen.filter(p=>profiles.has(p.id)).map(p=>{const a=profiles.get(p.id),i=a.last_known_institutions?.[0];return {id:p.id,name:a.display_name,iid:tail(i?.id),iname:i?.display_name||'Affiliation unavailable',cc:i?.country_code||'',h:a.summary_stats?.h_index||0,cites:a.cited_by_count||0,score:p.hq,recentPapers:activity.get(p.id)};});
 const works=people.length?(await get('works',{filter:base(s.id,start)+',citation_normalized_percentile.is_in_top_10_percent:true,authorships.author.id:'+people.map(p=>p.id).join('|'),sort:'cited_by_count:desc',per_page:'100',select:'id,authorships'})).results:[];
 const index=new Map(people.map((p,i)=>[p.id,i])),pairs=new Map();
 for(const w of works||[]){const ks=[...new Set(w.authorships.map(a=>index.get(tail(a.author?.id))).filter(i=>i!=null))];for(let a=0;a<ks.length;a++)for(let b=a+1;b<ks.length;b++){const key=[ks[a],ks[b]].sort((a,b)=>a-b).join('|');pairs.set(key,(pairs.get(key)||0)+1);}}
 const result={meta:{version:1,asOf:end,start,end,activeSince,candidateLimit:100,candidateCount:candidates.length,eligibleCount:chosen.length,linkSampleSize:works?.length||0,method:'Top-10% cited subfield papers, normalized by year, type and subfield; at least two in the three-year window and one subfield paper in the last 12 months. Candidates are the 100 leading authors by recent top-10% paper count. Ties use last-12-month publication count. Coauthors receive full credit. Collaboration links are sampled from up to 100 highly cited papers; absent links do not imply no collaboration.'},people,links:[...pairs].map(([k,n])=>[...k.split('|').map(Number),n])};
 fs.writeFileSync(target+'.tmp',JSON.stringify(result));fs.renameSync(target+'.tmp',target);
}
const atlas=JSON.parse(fs.readFileSync(path.join(DATA,'atlas.json'))),only=process.argv.slice(2);
const subs=atlas.subfields.filter(s=>!only.length||only.includes(String(s.id)));let i=0,done=0,failed=0;
await Promise.all(Array.from({length:4},async()=>{while(i<subs.length&&!stopped){const s=subs[i++];try{await build(s);done++;console.log(`${done}/${subs.length} ${s.id} ${s.name}`);}catch(e){failed++;console.error(`${s.id}: ${e.message}`);}}}));
// Resolve precise current institution coordinates in batches, without changing the
// shared institution index being prepared by the other data pipeline.
if (!stopped && !failed) {
  const snapshots = subs.map(s=>({file:path.join(OUT,'s'+s.id+'.json')})).filter(x=>fs.existsSync(x.file));
  for (const x of snapshots) x.data=JSON.parse(fs.readFileSync(x.file));
  const ids=[...new Set(snapshots.flatMap(x=>x.data.people.map(p=>p.iid)).filter(id=>/^I\d+$/.test(id)))];
  const coords=new Map();
  for(let start=0;start<ids.length;start+=100){
    const j=await get('institutions',{filter:'openalex_id:'+ids.slice(start,start+100).join('|'),per_page:'100',select:'id,geo'});
    for(const i of j.results||[])if(Number.isFinite(i.geo?.longitude)&&Number.isFinite(i.geo?.latitude))coords.set(tail(i.id),[i.geo.longitude,i.geo.latitude]);
  }
  for(const x of snapshots){
    for(const p of x.data.people){const ll=coords.get(p.iid);if(ll)[p.lng,p.lat]=ll;}
    fs.writeFileSync(x.file+'.tmp',JSON.stringify(x.data));fs.renameSync(x.file+'.tmp',x.file);
  }
  console.log(`Resolved coordinates for ${coords.size} institutions`);
}
console.log(JSON.stringify({done,failed,calls,stopped,asOf:end}));if(failed||stopped)process.exitCode=1;
