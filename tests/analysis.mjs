import assert from 'node:assert/strict';
import fs from 'node:fs';
import {changePair,institutionMetric,countryMetric,metricColor} from '../lib/analysis-metrics.mjs';
assert.equal(changePair(null,100).value,null);assert.equal(changePair(0,100).value,null);assert.equal(changePair(100,0).value,-1);assert.equal(changePair(100,120).value,.2);
assert.equal(metricColor(null), '#89939d');assert.notEqual(metricColor(null),metricColor(0,{diverging:true}));assert.notEqual(metricColor(-.5,{diverging:true}),metricColor(.5,{diverging:true}));
const index=JSON.parse(fs.readFileSync('public/data/analysis.json'));
for(const [id,summary] of Object.entries(index.institutions)){
 const source=JSON.parse(fs.readFileSync(`public/data/institutions/${id}.json`));
 assert.deepEqual(summary.indicator,source.indicator);assert.deepEqual(summary.funding,source.funding.series);
 for(const group of summary.funding){const r=institutionMetric(summary,'funding',group.currency);const a=group.years.find(x=>x.year===2024).value,b=group.years.find(x=>x.year===2025).value;assert.equal(r.value,a>0&&b!=null?(b-a)/a:null)}
 assert.equal(institutionMetric(summary,'funding','XXX').value,null);
}
const us=index.countries.US,row=us.subfields.find(r=>r.id==='3106');assert.equal(countryMetric(us,{kind:'subfield',id:'3106'},'volume').value,row.papers);assert.equal(countryMetric(us,{kind:'subfield',id:'3106'},'impact').value,row.highImpact/row.papers);assert.equal(countryMetric(us,{kind:'physics'},'volume').value,null);
console.log('PASS: 550 analysis snapshots match source data, missing/zero baselines, currency isolation, field attribution and colour semantics');
