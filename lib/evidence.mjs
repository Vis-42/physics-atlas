// Pure evidence calculations shared by data builds, UI and regression checks.
export function fundingSeries(projects, institutionId, startYear, endYear) {
  const byCurrency=new Map(), seen=new Set();let missing=0,components=0,shared=0;
  for(const p of projects){
    if(seen.has(p.id))continue;seen.add(p.id);
    if(!Number.isInteger(p.year)||p.year<startYear||p.year>endYear)continue;
    if(p.parents?.length){components++;continue;}
    const recipients=[...new Set((p.recipients||[]).map(r=>r.id).filter(Boolean))];
    if(!Number.isFinite(p.amount)||p.amount<=0||!(/^[A-Z]{3}$/).test(p.currency||'')||!recipients.includes(institutionId)){missing++;continue;}
    if(recipients.length>1)shared++;
    if(!byCurrency.has(p.currency))byCurrency.set(p.currency,{currency:p.currency,awards:0,years:Array.from({length:endYear-startYear+1},(_,i)=>({year:startYear+i,value:null,awards:0}))});
    const group=byCurrency.get(p.currency),row=group.years[p.year-startYear];
    row.value=(row.value??0)+p.amount/recipients.length;row.awards++;group.awards++;
  }
  return {series:[...byCurrency.values()].sort((a,b)=>b.awards-a.awards||a.currency.localeCompare(b.currency)),missingAmounts:missing,excludedComponents:components,sharedAwards:shared};
}
export function projectStatus(p, asOf) {
  if(p.start && p.start>asOf)return 'upcoming';
  if(p.end && p.end<asOf)return 'ended';
  if(p.start && p.start<=asOf && p.end && p.end>=asOf)return 'active';
  return 'unknown';
}
export function periodChange(rows,currentYear) {
  const a=rows.find(r=>r.year===currentYear-1)?.value,b=rows.find(r=>r.year===currentYear-2)?.value;
  return Number.isFinite(a)&&Number.isFinite(b)&&b>0?(a-b)/b:null;
}
export function rankStrengths(rows, mode='volume') {
  return rows.filter(r=>mode!=='rate'||r.papers>=100).slice().sort((a,b)=>
    mode==='rate' ? (b.highImpact/b.papers-a.highImpact/a.papers)||b.highImpact-a.highImpact : b.highImpact-a.highImpact||b.papers-a.papers);
}
export function safeSource(url,fallback) {
  try { const u=new URL(url);if(u.protocol==='https:'||u.protocol==='http:')return u.href; }catch{}
  return fallback;
}
