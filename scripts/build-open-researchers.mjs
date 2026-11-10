import fs from 'node:fs';import assert from 'node:assert/strict';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const catalog=read('data/recruitment-evidence.json'),atlas=read('public/data/atlas.json'),heat=read('public/data/heat/insts.json');
const institutions=new Map(heat.map(([id,name,cc,lat,lng])=>[id,{name,cc,lat,lng}]));for(const u of atlas.universities)institutions.set(u.id,u);
for(const i of catalog.institutions||[])institutions.set(i.id,i);
const subs=atlas.subfields;
const known=new Map(subs.map(s=>[String(s.id).replace(/^a/,''),s.name]));
const covered=[...new Set(catalog.people.flatMap(p=>p.opportunities.flatMap(o=>o.subfields)))].sort().map(id=>({id,name:known.get(id)}));
assert.equal(new Set(catalog.people.map(p=>p.id)).size,catalog.people.length);
for(const p of catalog.people){assert(/^A\d+$/.test(p.id));assert(institutions.has(p.iid),'Unknown institution '+p.iid);for(const o of p.opportunities){assert(o.source.startsWith('https://'));assert(['advertised','invitation'].includes(o.evidence));assert(o.checkedAt<=catalog.asOf);assert(o.reviewBy>=o.checkedAt);assert((Date.parse(o.reviewBy)-Date.parse(o.checkedAt))/86400000<=90);assert(o.subfields.every(s=>known.has(s)));}}
const out=new URL('../public/data/open/',import.meta.url);fs.mkdirSync(out,{recursive:true});
for(const [id] of known){const people=catalog.people.flatMap(p=>{
 const opportunities=p.opportunities.filter(o=>o.subfields.includes(id));if(!opportunities.length)return [];
 const inst=institutions.get(p.iid);return [{...p,opportunities,lng:inst.lng,lat:inst.lat}];
});fs.writeFileSync(new URL('s'+id+'.json',out),JSON.stringify({meta:{asOf:catalog.asOf,method:catalog.method,catalogResearchers:catalog.people.length,coveredSubfields:covered},people,links:[]}));}
console.log(JSON.stringify({researchers:catalog.people.length,subfields:covered.length,snapshots:known.size}));
