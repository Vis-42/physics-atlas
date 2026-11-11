// Missing observations are never treated as zero, and currencies are never pooled.
export function changePair(before, after) {
 if(!Number.isFinite(before)||!Number.isFinite(after))return {before:before??null,after:after??null,value:null,reason:'Not reported for both years'};
 if(before<=0)return {before,after,value:null,reason:after>0?'Newly recorded activity':'No positive baseline'};
 return {before,after,value:(after-before)/before,reason:before<100?'Small baseline':''};
}
export function institutionMetric(data,metric,currency='USD'){
 if(!data)return {value:null,reason:'No evidence snapshot'};
 const rows=metric==='funding'?data.funding.find(s=>s.currency===currency)?.years:data.indicator;
 const column=metric==='funding'?'value':metric==='linked'?'linked':'papers';
 const before=rows?.find(r=>r.year===2024),after=rows?.find(r=>r.year===2025);
 const result=changePair(before?.[column],after?.[column]);
 if(metric==='funding')return {...result,reason:result.value==null?result.reason:'',awards:[before?.awards??null,after?.awards??null]};
 return result.before!=null&&result.before>0&&result.before<100?{...result,value:null,reason:'Small baseline (<100 publications); percentage withheld'}:result;
}
export function countryMetric(data,phase,metric='volume'){
 if(!data)return {value:null,reason:'No evidence snapshot'};
 let rows=phase.kind==='subfield'?data.subfields.filter(r=>String(r.id)===String(phase.id||phase.sub||phase.key.slice(1))):phase.kind==='field'?data.fields.filter(r=>String(r.id)===String(phase.id||phase.key.slice(1))):phase.kind==='general'?data.fields:[];
 if(!rows.length)return {value:null,reason:'No comparable country aggregate for this scope'};
 const papers=rows.reduce((s,r)=>s+r.papers,0),highImpact=rows.reduce((s,r)=>s+r.highImpact,0);
 return {value:metric==='impact'?(papers>=100?highImpact/papers:null):papers,papers,highImpact,reason:metric==='impact'&&papers<100?'Fewer than 100 publications':''};
}
const RGB=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
function blend(a,b,t){const aa=RGB(a),bb=RGB(b);return '#'+aa.map((v,i)=>Math.round(v+(bb[i]-v)*t).toString(16).padStart(2,'0')).join('')}
export function metricColor(value,{diverging=false,max=1}={}){
 if(!Number.isFinite(value))return '#89939d';
 if(diverging){const t=Math.min(1,Math.abs(value));return blend('#e5e7df',value<0?'#97569a':'#168b80',Math.sqrt(t))}
 const stops=['#440154','#3b528b','#21918c','#5ec962','#fde725'],t=Math.min(1,Math.max(0,value/Math.max(max,1e-12)))*4,i=Math.min(3,Math.floor(t));return blend(stops[i],stops[i+1],t-i);
}
