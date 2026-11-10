export const FILTERS=['career','frontier','open'];
export const FILTER_LABELS={career:'Career leaders',frontier:'Frontier now',open:'Open to researchers'};
export function normalizeFilters(mode){const chosen=new Set(String(mode||'').split('+'));return FILTERS.filter(f=>chosen.has(f)).join('+')||'institutions'}
export function toggleFilter(mode,filter){const set=new Set(normalizeFilters(mode).split('+').filter(f=>FILTERS.includes(f)));set.has(filter)?set.delete(filter):set.add(filter);return normalizeFilters([...set].join('+'))}
export function currentOpportunities(person,today=new Date().toISOString().slice(0,10)){
 return (person.opportunities||[]).filter(o=>o.status==='open'&&o.checkedAt<=today&&o.reviewBy>=today&&(!o.deadline||o.deadline>=today)&&/^https:\/\//.test(o.source)&&['advertised','invitation'].includes(o.evidence));
}
export function intersectNetworks(networks,mode){
 const filters=normalizeFilters(mode).split('+'),maps=networks.map(n=>new Map((n?.people||[]).map(p=>[p.id,p])));
 const primary=filters.includes('frontier')?filters.indexOf('frontier'):filters.includes('career')?filters.indexOf('career'):0;
 const people=[...maps[0].keys()].filter(id=>maps.every(m=>m.has(id))).map(id=>{
  const merged=Object.assign({},...maps.map(m=>m.get(id)));const career=maps[filters.indexOf('career')]?.get(id);return {...merged,...(career?{h:career.h,cites:career.cites}:{}),score:maps[primary].get(id).score};
 });
 const byId=new Map(people.map(p=>[p.id,p])),links=new Map();
 for(const net of networks)for(const l of net?.links||[]){if(!byId.has(l.a.id)||!byId.has(l.b.id)||l.a.id===l.b.id)continue;const key=[l.a.id,l.b.id].sort().join(':');if(!links.has(key)||links.get(key).n<l.n)links.set(key,{...l,a:byId.get(l.a.id),b:byId.get(l.b.id)});}
 return {people,links:[...links.values()],mode,insts:new Set(people.map(p=>p.iid)),meta:{...networks[primary]?.meta,filters,counts:Object.fromEntries(filters.map((f,i)=>[f,networks[i]?.people.length||0])),openCoverage:networks[filters.indexOf('open')]?.meta||null}};
}
