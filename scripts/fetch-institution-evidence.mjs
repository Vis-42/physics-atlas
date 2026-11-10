import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import zlib from 'node:zlib';import {fileURLToPath} from 'node:url';
import {fundingSeries,safeSource} from '../lib/evidence.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),DATA=path.join(ROOT,'public/data');
const CACHE=path.join(ROOT,'.cache/institution-evidence');fs.mkdirSync(CACHE,{recursive:true});
const key=process.env.OPENALEX_API_KEY||fs.readFileSync(path.join(ROOT,'.cache/openalex-key'),'utf8').trim();
const asOf=process.env.AS_OF||new Date().toISOString().slice(0,10),endYear=Number(asOf.slice(0,4)),startYear=endYear-5;
const atlas=JSON.parse(fs.readFileSync(path.join(DATA,'atlas.json')));let calls=0,stopped=false,failures=0,nextRequestAt=0;
const tail=s=>String(s||'').split('/').pop();
async function get(endpoint,params){
 const query=new URLSearchParams(params).toString(),file=path.join(CACHE,crypto.createHash('sha256').update(asOf+endpoint+query).digest('hex')+'.json.gz');
 if(fs.existsSync(file))return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
 if(stopped)throw Error('API allowance exhausted');
 for(let attempt=0;attempt<8;attempt++){
  try{
   const u=new URL('https://api.openalex.org/'+endpoint+'?'+query);u.searchParams.set('api_key',key);
   const wait=Math.max(0,nextRequestAt-Date.now());nextRequestAt=Math.max(Date.now(),nextRequestAt)+250;
   if(wait)await new Promise(r=>setTimeout(r,wait));
   const r=await fetch(u,{signal:AbortSignal.timeout(90000)});
   if(r.status===429){
    if(Number(r.headers.get('x-ratelimit-remaining-usd')??1)<=0){stopped=true;throw Error('API allowance exhausted');}
    await new Promise(r=>setTimeout(r,Math.max(5000,Math.min(60000,Number(r.headers.get('retry-after')||5)*1000))));
    throw Error('Temporary API rate limit');
   }
   if(r.status>=500)throw Error('OpenAlex temporarily unavailable');
   if(!r.ok)throw Error('OpenAlex HTTP '+r.status);
   const data=await r.json();fs.writeFileSync(file+'.tmp',zlib.gzipSync(JSON.stringify(data)));fs.renameSync(file+'.tmp',file);calls++;return data;
  }catch(e){if(stopped||attempt===7||/HTTP 4/.test(e.message))throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
 }
}
async function pages(endpoint,params,group=false){let cursor='*';const seen=new Set(),out=[];do{
 const j=await get(endpoint,{...params,per_page:'200',cursor});out.push(...(group?j.group_by:j.results)||[]);
 const next=j.meta?.next_cursor;if(next&&seen.has(next))throw Error('Repeated cursor');seen.add(next);cursor=next;
}while(cursor);return out;}
function save(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}
const groupsToYears=j=>new Map((j.group_by||[]).map(g=>[Number(g.key),g.count]));
async function institution(u){
 const file=path.join(DATA,'institutions',u.id+'.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).asOf===asOf)return;
 const fields='id,display_name,amount,currency,start_date,end_date,start_year,end_year,institution_awarded,landing_page_url,provenance,parent_awards,funder,funder_scheme,funding_type,primary_topic';
 const recent=await pages('awards',{filter:`institution_awarded.id:${u.id},start_year:${startYear}-${endYear}`,select:fields});
 const ongoing=await pages('awards',{filter:`institution_awarded.id:${u.id},start_year:<${startYear},end_year:${endYear}-2100`,select:fields});
 const unique=[...new Map([...recent,...ongoing].map(p=>[p.id,p])).values()];
 const projects=unique.map(p=>({id:tail(p.id),name:p.display_name||'Untitled award',amount:p.amount,currency:p.currency||null,year:p.start_year,start:p.start_date||null,end:p.end_date||null,
   recipients:(p.institution_awarded||[]).map(r=>({id:tail(r.id),name:r.display_name,country:r.country_code})),parents:(p.parent_awards||[]).map(a=>tail(a.id)).filter(Boolean),
   funder:p.funder?.display_name||'Funder not recorded',scheme:p.funder_scheme||null,type:p.funding_type||'research award',topic:p.primary_topic?.display_name||null,
   source:safeSource(p.landing_page_url,`https://openalex.org/${tail(p.id)}`),provenance:p.provenance||'OpenAlex'})).sort((a,b)=>(b.start||'').localeCompare(a.start||'')||a.id.localeCompare(b.id));
 const pubFilter=`institutions.id:${u.id},publication_year:${startYear}-${endYear-1},is_retracted:false`;
 const [all,linked]=await Promise.all([get('works',{filter:pubFilter,group_by:'publication_year',per_page:'100'}),get('works',{filter:pubFilter+',awards.id:!null',group_by:'publication_year',per_page:'100'})]);
 const totals=groupsToYears(all),links=groupsToYears(linked);
 save(file,{institutionId:u.id,asOf,startYear,endYear,projects,funding:fundingSeries(projects,u.id,startYear,endYear),
  indicator:Array.from({length:5},(_,i)=>{const year=startYear+i;return {year,papers:totals.get(year)||0,linked:links.get(year)||0}}),
  coverage:'Indexed awards beginning in the last five complete years or current year, plus older awards with a current or future end year. This is not a complete inventory of institutional programs. Unknown dates, unreported funding and unindexed initiatives may be absent.',
  method:'Estimated new award commitments by start year. Positive reported award amounts are divided equally among named recipients; component awards with a parent are excluded to reduce double counting. Currencies remain separate. These estimates are not expenditure, annual income or total institutional funding. Grant-linked publication counts are a separate research activity indicator, not money.'});
}
async function country(c){
 const file=path.join(DATA,'country-strengths',c.id+'.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).asOf===asOf)return;
 const filter=`authorships.countries:${c.id},publication_year:${startYear}-${endYear-1},is_retracted:false`;
 const output={country:c.id,asOf,startYear,endYear:endYear-1,fields:[],subfields:[]};
 for(const [kind,key] of [['fields','field'],['subfields','subfield']]){
  const all=await pages('works',{filter,group_by:`primary_topic.${key}.id`},true);
  const high=await pages('works',{filter:filter+',citation_normalized_percentile.is_in_top_10_percent:true',group_by:`primary_topic.${key}.id`},true);
  const h=new Map(high.map(g=>[tail(g.key),g.count]));
  output[kind]=all.filter(g=>g.key&&g.key!=='unknown').map(g=>({id:tail(g.key),name:g.key_display_name,papers:g.count,highImpact:h.get(tail(g.key))||0}));
 }
 save(file,output);
}
const kind=process.argv[2]||'all',tasks=[];
if(kind!=='institutions')for(const c of atlas.countries)tasks.push({label:c.id,fn:()=>country(c)});
if(kind!=='countries')for(const u of atlas.universities)tasks.push({label:u.slug,fn:()=>institution(u)});
let index=0,done=0;await Promise.all(Array.from({length:5},async()=>{while(index<tasks.length&&!stopped){const t=tasks[index++];try{await t.fn();done++;if(done%10===0||done===tasks.length)console.log(`${done}/${tasks.length} ${t.label}`);}catch(e){failures++;console.error(t.label+': '+e.message)}}}));
console.log(JSON.stringify({done,failures,calls,stopped,asOf}));if(failures||stopped)process.exitCode=1;
