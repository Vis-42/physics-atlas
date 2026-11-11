'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useAtlas} from './Controls';
import {A,go,setPhase,setResearchMode} from '../lib/atlas';
import {analysis,setAnalysis} from '../lib/analysis-map';
import {countryMetric,institutionMetric} from '../lib/analysis-metrics.mjs';
const fmt=n=>Number.isFinite(n)?new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(n):'Not reported';
const pct=n=>Number.isFinite(n)?`${n>=0?'+':''}${(100*n).toFixed(1)}%`:'Not comparable';
const TITLES={papers:'Indexed publication change',linked:'Grant-linked publication change',funding:'New grant commitment change (estimate)',volume:'Publication volume',impact:'Highly cited share'};
let pending;
function loadIndex(){if(!pending)pending=fetch(`${A.base}/analysis.json`).then(r=>{if(!r.ok)throw Error();return r.json()}).catch(e=>{pending=null;throw e});return pending}
export function Analysis(){
 useAtlas();
 const [tab,setTab]=useState(null),[data,setData]=useState(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 const [scope,setScope]=useState('institutions'),[metric,setMetric]=useState('papers'),[currency,setCurrency]=useState('USD'),[pair,setPair]=useState(['','']);
 const dialog=useRef(null),launcher=useRef(null),returnFocus=useRef(null);
 const [legendOpen,setLegendOpen]=useState(false);
 useEffect(()=>{if(!tab||data)return;let live=true;setError(false);loadIndex().then(d=>live&&setData(d)).catch(()=>live&&setError(true));return()=>{live=false}},[tab,data,retry]);
 useEffect(()=>{if(tab){dialog.current?.showModal()}else if(dialog.current?.open){dialog.current.close();returnFocus.current?.focus()}},[tab]);
 const items=scope==='countries'?A.W.countries:A.W.unis;
 const ordered=useMemo(()=>items.slice().sort((a,b)=>a.name.localeCompare(b.name)),[items]);
 const selected=pair.map((id,i)=>items.find(x=>x.id===id)||items[i]);
 const divergent=['papers','linked','funding'].includes(metric);
 const metricFor=item=>scope==='countries'?countryMetric(data?.countries[item.id],A.phase,metric):metric==='volume'?{value:item.pw,reason:'Estimated from topic mix where direct counts are unavailable'}:institutionMetric(data?.institutions[item.id],metric,currency);
 const rows=data?items.map(item=>{const r=metricFor(item);return {...r,item,text:divergent?pct(r.value):metric==='impact'?(r.value==null?'Not comparable':(100*r.value).toFixed(1)+'%'):fmt(r.value)}}):[];
 function openTab(next){returnFocus.current=document.activeElement;if(!pair[0]){const item=scope==='countries'?A.view.country:A.view.uni;if(item)setPair([item.id,items.find(x=>x.id!==item.id)?.id||''])}setTab(next)}
 const activeResearch=A.researchMode!=='institutions';
 const phase=A.phase?.key;
 // Changing the research scope invalidates an applied layer; never silently retain old colours.
 useEffect(()=>{if(analysis.active)setAnalysis({active:false})},[phase,activeResearch]);
 function changeScope(value){setScope(value);setMetric(value==='countries'?'volume':'papers');setPair(['',''])}
 function apply(){setResearchMode('institutions');setAnalysis({active:true,rows,scope,metric,currency,title:TITLES[metric],diverging:divergent,max:Math.max(1e-9,...rows.map(r=>r.value??0))});go('world');setTab(null)}
 const period=divergent?'2024 → 2025':scope==='countries'?'2021–2025':'2017–2026';
 const fieldScoped=scope==='countries'||metric==='volume';
 const coverage=rows.filter(r=>r.value!=null).length;
 return <>
  <div id="analysis-tools"><button ref={launcher} onClick={()=>openTab('map')}>Colour map</button><button onClick={()=>openTab('compare')}>Compare</button><button title="Return to the world map" onClick={()=>go('world')}>Reset view</button></div>
  {analysis.active&&!activeResearch&&<div id="analysis-legend" className={legendOpen?'expanded':''}><button aria-label="Close colour map" onClick={()=>setAnalysis({active:false})}>×</button><strong>{analysis.title}</strong><button className="scale-toggle" aria-expanded={legendOpen} onClick={()=>setLegendOpen(v=>!v)}>{legendOpen?'Hide scale ▴':'Show scale ▾'}</button><small>{analysis.diverging?'2024 → 2025 · all research':`${A.phase.name||A.phase.short} · ${analysis.scope==='countries'?'2021–2025':'2017–2026'}`}{analysis.metric==='funding'?` · ${analysis.currency}`:''}</small><div className={'colour-ramp '+(analysis.diverging?'diverging':'')}/><div className="ramp-labels"><span>{analysis.diverging?'−100%':'0'}</span><span>{analysis.diverging?'0':analysis.metric==='impact'?(100*analysis.max).toFixed(1)+'%':fmt(analysis.max)}</span>{analysis.diverging&&<span>+100% or more</span>}</div><small>Grey: unavailable · {analysis.rows.filter(r=>r.value!=null).length}/{analysis.rows.length} comparable</small></div>}
  <dialog ref={dialog} className="analysis-dialog" onCancel={()=>setTab(null)} onClick={e=>{if(e.target===dialog.current)setTab(null)}} aria-labelledby="analysis-title">
   <div className="analysis-heading"><div><p className="kick">Explore the evidence</p><h2 id="analysis-title">{tab==='compare'?'Compare side by side':'Colour the research landscape'}</h2></div><button aria-label="Close analysis" onClick={()=>setTab(null)}>×</button></div>
   <div className="analysis-options"><label>Compare or map<select aria-label="Entity type" value={scope} onChange={e=>changeScope(e.target.value)}><option value="institutions">Institutions</option><option value="countries">Countries</option></select></label>
   <label>Measure<select aria-label="Analysis measure" value={metric} onChange={e=>setMetric(e.target.value)}>{(scope==='countries'?['volume','impact']:['papers','linked','funding','volume']).map(m=><option key={m} value={m}>{TITLES[m]}</option>)}</select></label>
   {metric==='funding'&&<label>Shared currency<select aria-label="Comparison currency" value={currency} onChange={e=>setCurrency(e.target.value)}>{['USD','EUR','GBP','CAD','AUD','JPY','CHF','CNY'].map(c=><option key={c}>{c}</option>)}</select></label>}
   {fieldScoped&&<label>Research scope<select aria-label="Analysis research scope" value={phase} onChange={e=>setPhase(e.target.value)}><option value="general">All research</option>{!['general','field','subfield'].includes(A.phase.kind)&&<option value={phase}>{A.phase.name||A.phase.short}</option>}<optgroup label="Fields">{A.W.fields.map(f=><option key={f.id} value={'f'+f.id}>{f.name}</option>)}</optgroup><optgroup label="Subfields">{A.W.subfieldList.map(s=><option key={s.id} value={'s'+s.id}>{s.name}</option>)}</optgroup></select></label>}
   </div>
   <p className="analysis-note">{period} · {fieldScoped?(A.phase.name||A.phase.short):'All research fields'}. {metric==='funding'?'Indexed commitments by award start year, divided equally among listed recipients. Components excluded; no currency conversion or inflation adjustment. These are not annual spending totals.':metric==='linked'?'Grant-linked publications are an activity indicator, not a funding amount.':metric==='volume'&&scope==='institutions'?'Counts may be estimated from topic mix and include the incomplete 2026 year.':metric==='impact'?'Share of publications in the field-normalized top citation decile; minimum 100 publications.':scope==='countries'?'Publications classified into OpenAlex primary fields; not a sum of institution counts.':'Publication indexing can change over time; a rise is not by itself an increase in research quality.'}</p>
   {!data?<p role={error?'alert':'status'}>{error?<><span>Could not load comparison data. </span><button onClick={()=>setRetry(n=>n+1)}>Retry</button></>:'Loading evidence…'}</p>:tab==='compare'?<>
    <div className="comparison-grid">{selected.map((item,i)=>{const r=metricFor(item),entry=data.institutions[item.id];return <section key={i} aria-label={i===0?'First entity':'Second entity'}><label>{i===0?'First':'Second'} {scope==='countries'?'country':'institution'}<select aria-label={i===0?'First entity':'Second entity'} value={item.id} onChange={e=>setPair(p=>selected.map((s,j)=>j===i?e.target.value:s.id))}>{ordered.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><h3>{item.name}</h3><p className="comparison-value">{divergent?pct(r.value):metric==='impact'?(r.value==null?'Not comparable':(r.value*100).toFixed(1)+'%'):fmt(r.value)}</p><p>{TITLES[metric]}</p>{divergent?<dl><dt>2024 {metric==='funding'?currency:''}</dt><dd>{fmt(r.before)}</dd><dt>2025 {metric==='funding'?currency:''}</dt><dd>{fmt(r.after)}</dd><dt>Absolute change</dt><dd>{Number.isFinite(r.before)&&Number.isFinite(r.after)?fmt(r.after-r.before):'Not reported'}</dd>{r.awards&&<><dt>Awards · 2024 / 2025</dt><dd>{r.awards.map(fmt).join(' / ')}</dd></>}</dl>:r.papers!=null&&<p>{fmt(r.highImpact)} highly cited of {fmt(r.papers)} publications</p>}{r.reason&&<p className="analysis-note">{r.reason}</p>}{entry&&<p className="analysis-note">{fmt(entry.initiatives)} indexed initiatives · checked {entry.asOf}</p>}<a href={`${A.base}/${scope==='countries'?'country-strengths':'institutions'}/${item.id}.json`} target="_blank" rel="noreferrer">Source snapshot ↗</a><button className="e-link" onClick={()=>{go(scope==='countries'?'country':'uni',item);setTab(null)}}>Explore on map →</button></section>})}</div>
    <p className="analysis-note">Shared publications can appear in both places. Compare similar organizations or countries; organization size, coverage and affiliation practices affect the figures.</p>
   </>:<><div className={'colour-ramp '+(divergent?'diverging':'')}/><p>{coverage} of {rows.length} places have comparable values. {divergent?'Purple: decline · pale: unchanged · teal: growth. Scale capped at ±100%; exact changes remain in the table.':'Viridis runs from low (purple) to high (yellow), scaled within this view.'} Grey marks unavailable data.</p><button className="analysis-apply" disabled={!coverage} onClick={apply}>Apply colour map</button><details><summary>Values and coverage</summary><div className="analysis-table"><table><thead><tr><th>Place</th><th>{TITLES[metric]}</th><th>Coverage note</th></tr></thead><tbody>{rows.slice().sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity)).map(r=><tr key={r.item.id}><td>{r.item.name}</td><td>{r.text}</td><td>{r.reason}</td></tr>)}</tbody></table></div></details></>}
   <p className="analysis-note">Field and subfield growth series are not available in this snapshot. Their colour maps show activity or impact, not change. Funding and grant links do not establish recruitment availability.</p>
  </dialog>
 </>;
}

export function AnalysisSummary(){
 useAtlas();
 const rows=analysis.rows.filter(r=>r.value!=null).slice().sort((a,b)=>b.value-a.value);
 return <><p className="kick">Evidence colour map</p><h1>{analysis.title}</h1><p className="lede">{analysis.diverging?'Change from 2024 to 2025 · all research fields.':`${A.phase.name} · ${analysis.scope==='countries'?'2021–2025':'2017–2026'}.`}{analysis.metric==='funding'?` ${analysis.currency} only; estimated new commitments, not annual spending.`:''}</p><p className="lede">{analysis.diverging?'Purple shows decline, teal shows growth.':'Purple shows lower values, yellow shows higher values.'} Grey means comparable observations are unavailable. Select a place for its research details, or use Compare to inspect two places together.</p><h2>{analysis.diverging?'Largest recorded increases':'Highest values in this view'}</h2><ol className="rows">{rows.slice(0,20).map(r=><li key={r.item.id}><button className="rowb" onClick={()=>go(analysis.scope==='countries'?'country':'uni',r.item)}><span className="rn">{r.item.name}</span><span className="n">{r.text}</span></button></li>)}</ol><p className="srcline">{rows.length} of {analysis.rows.length} places have comparable values. Indexing and coverage affect comparisons.</p></>;
}
