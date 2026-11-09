import fs from 'node:fs';
import assert from 'node:assert/strict';
const data=new URL('../public/data/',import.meta.url);
const atlas=JSON.parse(fs.readFileSync(new URL('atlas.json',data)));
let total=0;const dates=new Set();
for(const s of atlas.subfields){
 const d=JSON.parse(fs.readFileSync(new URL(`frontier/s${s.id}.json`,data)));
 assert(d.meta.start<d.meta.activeSince && d.meta.activeSince<d.meta.end);
 assert.equal(d.meta.asOf,d.meta.end);dates.add(d.meta.asOf);
 assert(d.people.length<=60);const ids=new Set();
 for(const p of d.people){
  assert(/^A\d+$/.test(p.id));assert(!ids.has(p.id));ids.add(p.id);
  assert(Number.isInteger(p.score)&&p.score>=2);
  assert(Number.isInteger(p.recentPapers)&&p.recentPapers>=1);
  if(p.lng!=null)assert(Number.isFinite(p.lng)&&Math.abs(p.lng)<=180);
  if(p.lat!=null)assert(Number.isFinite(p.lat)&&Math.abs(p.lat)<=90);
 }
 for(let i=1;i<d.people.length;i++)assert(d.people[i-1].score>=d.people[i].score);
 const pairs=new Set();
 for(const [a,b,n] of d.links){assert(Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&a<b&&b<d.people.length);assert(Number.isInteger(n)&&n>0&&n<=d.meta.linkSampleSize);assert(!pairs.has(a+':'+b));pairs.add(a+':'+b);}
 total+=d.people.length;
}
assert.equal(dates.size,1,'Publish a complete, consistently dated snapshot');
console.log(`PASS: ${atlas.subfields.length} subfield snapshots, ${total} researcher placements, dates, eligibility, coordinates and links`);
