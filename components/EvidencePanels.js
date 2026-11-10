'use client';
import {useEffect,useMemo,useState} from 'react';
import {A,go,setPhase} from '../lib/atlas';
import {rankStrengths,periodChange,projectStatus,safeSource} from '../lib/evidence.mjs';

const cache=new Map();
function useEvidence(path){
 const [version,setVersion]=useState(0),[state,setState]=useState({path:null,status:'loading',data:null});
 useEffect(()=>{let live=true;setState({path,status:'loading',data:null});
  if(!cache.has(path))cache.set(path,fetch(path).then(r=>{if(!r.ok)throw Error('Evidence unavailable');return r.json()}).catch(e=>{cache.delete(path);throw e}));
  cache.get(path).then(data=>{if(live)setState({path,status:'ready',data})}).catch(()=>{if(live)setState({path,status:'error',data:null})});
  return()=>{live=false};
 },[path,version]);
 return {...(state.path===path?state:{status:'loading',data:null}),retry:()=>{cache.delete(path);setVersion(v=>v+1)}};
}
const fmt=n=>new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(n);
const money=(n,currency)=>{if(!Number.isFinite(n))return 'Not reported';try{return new Intl.NumberFormat('en',{style:'currency',currency,notation:'compact',maximumFractionDigits:2}).format(n)}catch{return fmt(n)+' (currency not recorded)'}};
function State({state,label}){return state.status==='loading'?<p role="status" className="lede">Loading {label}…</p>:<p role="alert" className="lede">{label} couldn’t be loaded. <button className="e-link" onClick={state.retry}>Retry</button></p>}
function Trend({rows,currency,label}){
 const max=Math.max(1,...rows.map(r=>r.value||0)),width=280,height=80;
 let path='',connected=false;
 rows.forEach((r,i)=>{if(r.value==null){connected=false;return}const x=8+i*(width-16)/Math.max(1,rows.length-1),y=height-8-r.value/max*(height-18);path+=(connected?'L':'M')+x+','+y;connected=true});
 return <figure className="e-trend"><figcaption>{label}</figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
  <path d={`M8 ${height-8}H${width-8}`} stroke="var(--rule)" fill="none"/><path d={path} stroke="var(--accent)" strokeWidth="2" fill="none"/>
  {rows.map((r,i)=>r.value==null?null:<circle key={r.year} cx={8+i*(width-16)/Math.max(1,rows.length-1)} cy={height-8-r.value/max*(height-18)} r="3" fill="var(--accent)"><title>{r.year}: {currency?money(r.value,currency):fmt(r.value)}</title></circle>)}
 </svg><table><caption className="e-sr">{label}, exact values</caption><thead><tr><th>Year</th><th>{currency?currency:'Publications'}</th>{currency&&<th>Awards</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.year}><td>{r.year}{r.partial?' · YTD':''}</td><td>{r.value==null?'Not reported':currency?new Intl.NumberFormat('en',{style:'currency',currency,maximumFractionDigits:0}).format(r.value):fmt(r.value)}</td>{currency&&<td>{r.awards||'—'}</td>}</tr>)}</tbody></table></figure>;
}
export function InstitutionEvidence({institution}){
 const path=`${A.base}/institutions/${institution.id}.json`,state=useEvidence(path);
 return <section className="evidence"><h2>Funding & research initiatives</h2>
  {state.status==='ready'?<InstitutionContent key={institution.id} data={state.data} institution={institution} path={path}/>:<State state={state} label="institution evidence"/>}
 </section>;
}
function InstitutionContent({data,institution,path}){
 const [tab,setTab]=useState('funding'),[currency,setCurrency]=useState(data.funding.series[0]?.currency||''),[query,setQuery]=useState(''),[status,setStatus]=useState('all'),[partnership,setPartnership]=useState(false),[limit,setLimit]=useState(10);
 const group=data.funding.series.find(s=>s.currency===currency),change=group?periodChange(group.years,data.endYear):null;
 const filtered=useMemo(()=>data.projects.filter(p=>{
  const hay=[p.name,p.funder,p.scheme,p.topic,...p.recipients.map(r=>r.name)].join(' ').toLowerCase();
  return hay.includes(query.toLowerCase())&&(status==='all'||projectStatus(p,data.asOf)===status)&&(!partnership||p.recipients.length>1);
 }),[data,query,status,partnership]);
 const reset=(fn,value)=>{fn(value);setLimit(10)};
 return <><div className="e-tabs" role="group" aria-label="Institution evidence view"><button aria-pressed={tab==='funding'} onClick={()=>setTab('funding')}>Funding</button><button aria-pressed={tab==='initiatives'} onClick={()=>setTab('initiatives')}>Initiatives · {fmt(data.projects.length)}</button></div>
 <p className="srcline">Public records · checked {data.asOf} UTC</p>
 {tab==='funding'?<>
  <h3>New grant commitments</h3><p className="lede">Estimated institution share of awards starting each year. These are commitments for projects, often spanning several years.</p>
  {group?<>
   <label className="e-filter">Currency <select aria-label="Funding currency" value={currency} onChange={e=>setCurrency(e.target.value)}>{data.funding.series.map(s=><option key={s.currency}>{s.currency}</option>)}</select></label>
   {change!=null?<p className="e-change">{change>=0?'+':''}{(100*change).toFixed(1)}% in {data.endYear-1} versus {data.endYear-2}<small>Estimate from indexed award records, not an audited funding-growth figure.</small></p>:<p className="lede">Comparable amounts are not available for both of the last two complete years.</p>}
   <Trend rows={group.years.map(r=>({...r,partial:r.year===data.endYear}))} currency={currency} label="Estimated share of new award commitments"/>
   <p className="srcline">{fmt(group.awards)} monetary award records in {currency}. {fmt(data.funding.missingAmounts)} records lack usable amounts or recipient attribution; {fmt(data.funding.excludedComponents)} component awards excluded.</p>
  </>:<p className="lede">No usable reported monetary amounts in this snapshot. This does not mean the institution has no funding.</p>}
  <details className="e-method"><summary>Estimate and coverage</summary><p>{data.method}</p><p>{data.coverage}</p><p>Data coverage can change over time. YTD amounts are not compared with full years. No currency conversion or inflation adjustment is applied.</p><a href="https://help.openalex.org/data/awards/" target="_blank" rel="noreferrer">Award data definitions ↗</a></details>
  <h3>Grant-linked research activity</h3><p className="lede">Publications with an institutional affiliation and a recorded grant link. This is a research indicator, not a monetary estimate or proof that this institution received the grant.</p>
  {data.indicator.some(r=>r.linked>0)?<Trend rows={data.indicator.map(r=>({year:r.year,value:r.linked}))} label="Grant-linked publications"/>:<p className="lede">No grant-linked publications were identified in the indexed records for this period.</p>}
  <p className="srcline">{fmt(data.indicator.reduce((s,r)=>s+r.linked,0))} grant-linked of {fmt(data.indicator.reduce((s,r)=>s+r.papers,0))} indexed publications, {data.startYear}–{data.endYear-1}. Missing grant acknowledgments and coauthorship limit interpretation.</p>
 </>:<>
  <p className="lede">Documented funded projects, programs and partnerships. {data.coverage}</p>
  <label className="e-filter">Search initiatives<input type="search" aria-label="Search initiatives" placeholder="Project, funder or partner" value={query} onChange={e=>reset(setQuery,e.target.value)}/></label>
  <label className="e-filter">Status at snapshot <select aria-label="Initiative status" value={status} onChange={e=>reset(setStatus,e.target.value)}><option value="all">All records</option><option value="active">Active</option><option value="ended">Ended</option><option value="upcoming">Upcoming</option><option value="unknown">Dates incomplete</option></select></label>
  <label className="e-check"><input type="checkbox" checked={partnership} onChange={e=>reset(setPartnership,e.target.checked)}/>Named institutional partnerships only</label>
  <p role="status" className="srcline">{fmt(filtered.length)} matching initiatives</p>
  <ul className="initiative-list">{filtered.slice(0,limit).map(p=>{
   const partners=p.recipients.filter(r=>r.id!==institution.id);
   return <li key={p.id}><a className="initiative-title" href={safeSource(p.source,`https://openalex.org/${p.id}`)} target="_blank" rel="noreferrer">{p.name} ↗</a>
    <p>{p.funder}{p.scheme?' · '+p.scheme:''}</p><p className="srcline">{p.start||'Start unknown'} – {p.end||'End unknown'} · {({active:'Active at snapshot',ended:'Ended',upcoming:'Upcoming',unknown:'Dates incomplete'})[projectStatus(p,data.asOf)]}</p>
    {Number.isFinite(p.amount)&&p.amount>0&&p.currency&&<p>Reported award: <strong>{money(p.amount,p.currency)}</strong>{partners.length>0?' · whole project, not an institution-specific allocation':''}</p>}
    {p.topic&&<p className="srcline">{p.topic}</p>}
    {partners.length>0&&<div className="initiative-partners"><span>Named partners:</span>{partners.map(r=>{const u=A.W.uniById.get(r.id);return u?<button className="e-link" key={r.id} onClick={()=>go('uni',u)}>{r.name}</button>:<a key={r.id} href={'https://openalex.org/'+r.id} target="_blank" rel="noreferrer">{r.name} ↗</a>})}</div>}
    <p className="srcline">Source: {p.provenance} via OpenAlex{p.parents.length?' · component award':''}</p>
   </li>
  })}</ul>
  {!filtered.length&&<p className="lede">No matching indexed initiatives. Try another filter; unreported programs may not be present.</p>}
  {filtered.length>limit&&<button className="e-more" onClick={()=>setLimit(n=>n+20)}>Show 20 more</button>}
 </>}
 <a className="e-download" href={path} download={institution.id+'-research-evidence.json'}>Download source records (JSON)</a>
 </>;
}
export function CountryStrengths({country}){
 const state=useEvidence(`${A.base}/country-strengths/${country.id}.json`);
 return <section className="evidence"><h2>Research strengths</h2>{state.status==='ready'?<StrengthContent key={country.id} data={state.data} country={country}/>:<State state={state} label="country strengths"/>}</section>;
}
function StrengthContent({data,country}){
 const [kind,setKind]=useState('fields'),[mode,setMode]=useState('volume');
 const rows=rankStrengths(data[kind],mode).slice(0,8);
 const pick=async r=>{await setPhase((kind==='fields'?'f':'s')+r.id);go('country',country)};
 return <><div className="e-tabs" role="group" aria-label="Strength level"><button aria-pressed={kind==='fields'} onClick={()=>setKind('fields')}>Fields</button><button aria-pressed={kind==='subfields'} onClick={()=>setKind('subfields')}>Subfields</button></div>
 <label className="e-filter">Rank by <select aria-label="Rank country strengths" value={mode} onChange={e=>setMode(e.target.value)}><option value="volume">Highly cited output</option><option value="rate">Impact rate · minimum 100 papers</option></select></label>
 <p className="lede">{mode==='volume'?'Leading areas by number of top-10% cited papers.':'Leading areas by the share of papers in the normalized top citation decile.'}</p>
 <ol className="strength-list">{rows.map(r=><li key={r.id}><button onClick={()=>pick(r)}><span>{r.name}<small>{fmt(r.highImpact)} highly cited / {fmt(r.papers)} papers</small></span><strong>{mode==='rate'?(100*r.highImpact/r.papers).toFixed(1)+'%':fmt(r.highImpact)}</strong></button></li>)}</ol>
 {!rows.length&&<p className="lede">No areas meet this view’s evidence threshold.</p>}
 <details className="e-method"><summary>What “strongest” means</summary><p>OpenAlex publications with at least one author affiliated in {country.name}, {data.startYear}–{data.endYear}. Impact uses citation percentiles normalized by year, publication type and subfield. Primary topics determine the field and subfield. Internationally coauthored papers count once in each participating country. Impact-rate rankings require at least 100 papers.</p><p>These country-level counts include institutions beyond the atlas’s mapped selection. Click an area to explore it.</p></details>
 <p className="srcline">OpenAlex · {data.startYear}–{data.endYear} · checked {data.asOf} UTC</p>
 </>;
}
