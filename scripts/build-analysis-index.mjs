import fs from 'node:fs/promises';
const root=new URL('../public/data/',import.meta.url), read=async path=>JSON.parse(await fs.readFile(new URL(path,root),'utf8'));
const atlas=await read('atlas.json');
const institutions={};
for(const u of atlas.universities){try{const d=await read(`institutions/${u.id}.json`);institutions[u.id]={asOf:d.asOf,indicator:d.indicator,funding:d.funding.series,initiatives:d.projects.length};}catch(e){if(e.code!=='ENOENT')throw e}}
const countries={};for(const c of atlas.countries){try{countries[c.id]=await read(`country-strengths/${c.id}.json`)}catch(e){if(e.code!=='ENOENT')throw e}}
await fs.writeFile(new URL('analysis.json',root),JSON.stringify({institutions,countries}));
console.log(`Analysis index: ${Object.keys(institutions).length} institutions, ${Object.keys(countries).length} countries`);
