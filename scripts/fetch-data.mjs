// Builds public/data from OpenAlex: physics-related research, 2017–2026.
// Run once with `node scripts/fetch-data.mjs`; responses are cached in .cache/ so a rerun is free.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { has, readJson, writeJson } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache', 'openalex');
fs.mkdirSync(path.join(OUT, 'u'), { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const API = 'https://api.openalex.org';
const YEARS = '2017-2026';
const RECENT = '2022-2026';
const SUBFIELDS = [
  3102, 3103, 3104, 3105, 3106, 3107, 3108, 3109, // Physics and Astronomy
  2503, 2504, 2505, 2506, 2508, // Materials Science
  1606, 1607, // Chemistry
  2202, 2206, 2208, 2210, 2211, // Engineering
  2102, 2104, 2105, // Energy
  1902, 1908, 1910, // Earth and Planetary Sciences
  2610, // Mathematical Physics
  1304, 1315, // Biophysics, Structural Biology
  2741, // Radiology, Nuclear Medicine and Imaging
  1708, // Hardware and Architecture
];
const SUBF = 'primary_topic.subfield.id:' + SUBFIELDS.join('|') + ',type:article|review|preprint|conference-paper|letter|book-chapter';
const BASE = `publication_year:${YEARS},${SUBF}`;

// Country centroids for the map, and ISO numeric codes for world-110m shapes.
const GEO = {
  US: ['United States', 39.5, -98.5, '840'], CN: ['China', 35.0, 104.0, '156'], JP: ['Japan', 36.5, 138.5, '392'],
  DE: ['Germany', 51.0, 10.3, '276'], GB: ['United Kingdom', 54.0, -2.5, '826'], FR: ['France', 46.6, 2.4, '250'],
  IN: ['India', 22.5, 79.0, '356'], IT: ['Italy', 42.8, 12.6, '380'], RU: ['Russia', 58.0, 60.0, '643'],
  KR: ['South Korea', 36.4, 127.9, '410'], ES: ['Spain', 40.2, -3.6, '724'], CA: ['Canada', 56.0, -100.0, '124'],
  AU: ['Australia', -25.5, 134.0, '036'], CH: ['Switzerland', 46.8, 8.2, '756'], NL: ['Netherlands', 52.2, 5.5, '528'],
  BR: ['Brazil', -10.0, -52.0, '076'], PL: ['Poland', 52.0, 19.4, '616'], SE: ['Sweden', 62.5, 16.0, '752'],
  IR: ['Iran', 32.5, 54.0, '364'], TW: ['Taiwan', 23.7, 121.0, '158'], BE: ['Belgium', 50.6, 4.6, '056'],
  AT: ['Austria', 47.6, 14.1, '040'], CZ: ['Czechia', 49.8, 15.5, '203'], IL: ['Israel', 31.4, 35.0, '376'],
  DK: ['Denmark', 56.0, 9.5, '208'], SG: ['Singapore', 1.35, 103.82, '702'], TR: ['Turkey', 39.0, 35.0, '792'],
  SA: ['Saudi Arabia', 24.0, 45.0, '682'], PT: ['Portugal', 39.6, -8.0, '620'], FI: ['Finland', 63.0, 26.0, '246'],
  NO: ['Norway', 61.5, 9.0, '578'], MX: ['Mexico', 23.5, -102.5, '484'], ZA: ['South Africa', -29.0, 24.5, '710'],
  GR: ['Greece', 39.3, 22.0, '300'], EG: ['Egypt', 26.5, 30.0, '818'], HK: ['Hong Kong', 22.35, 114.15, '344'],
  UA: ['Ukraine', 49.0, 31.5, '804'], PK: ['Pakistan', 30.0, 70.0, '586'], MY: ['Malaysia', 4.0, 102.0, '458'],
  AR: ['Argentina', -35.0, -65.0, '032'], CL: ['Chile', -33.0, -71.0, '152'], IE: ['Ireland', 53.2, -8.0, '372'],
  NZ: ['New Zealand', -41.5, 172.5, '554'], HU: ['Hungary', 47.2, 19.4, '348'], RO: ['Romania', 45.9, 24.9, '642'],
};
const N_COUNTRIES = 16;
const PER_COUNTRY = { GB: 12, US: 10, CN: 10, DE: 8, JP: 7, FR: 6 };
const PER_AREA = 60;

let spent = 0, calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(CACHE, key + '.json');
  if (has(file)) { const c = readJson(file); if (c) return c; }
  for (let attempt = 0; attempt < 6; attempt++) {
    // An OpenAlex key (OPENALEX_API_KEY) raises the daily allowance; it is never part of the cache key.
    const key = process.env.OPENALEX_API_KEY || (fs.existsSync(path.join(ROOT, '.cache', 'openalex-key')) ? fs.readFileSync(path.join(ROOT, '.cache', 'openalex-key'), 'utf8').trim() : ''); // private, never published
    const res = await fetch(API + url + (key ? (url.includes('?') ? '&' : '?') + 'api_key=' + key : ''), { headers: { 'User-Agent': 'netwrk-physics-atlas/1.0' } });
    if (res.status === 429 || res.status >= 500) {
      const body = await res.text();
      if (/budget|limit/i.test(body) && res.status === 429 && attempt > 2) throw new Error('OpenAlex budget exhausted: ' + body.slice(0, 300));
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}\n${(await res.text()).slice(0, 400)}`);
    const json = await res.json();
    calls++;
    spent += json.meta?.cost_usd || 0;
    delete json.meta?.notice;
    writeJson(file, json);
    return json;
  }
  throw new Error('Gave up on ' + url);
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
// Optional lookups: when the daily allowance runs out they return null and the atlas keeps what it has.
let exhausted = false;
async function tryGet(url) {
  if (exhausted) { const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json'); return readJson(f); }
  try { return await get(url); } catch (e) { if (/budget|429|Gave up/i.test(String(e))) { exhausted = true; console.warn('allowance used up; continuing with cached data'); return null; } throw e; }
}
const tail = (s) => String(s).split('/').pop();
const groups = async (filter, by, perPage = 200) =>
  (await get(`/works?filter=${filter}&group_by=${by}&per_page=${perPage}`)).group_by.map((g) => ({ key: tail(g.key), name: g.key_display_name, count: g.count }));

// ---- subfields
const subMeta = (await get(`/subfields?filter=id:${SUBFIELDS.join('|')}&per_page=100&select=id,display_name,field`)).results;
const SUB = new Map(subMeta.map((s) => [tail(s.id), { name: s.display_name, field: s.field.display_name }]));

// ---- countries
const cGroups = (await groups(BASE, 'authorships.countries', 100)).filter((g) => GEO[g.key]);
const top = cGroups.slice(0, N_COUNTRIES);
const countries = top.map((g) => ({ id: g.key, name: GEO[g.key][0], lat: GEO[g.key][1], lng: GEO[g.key][2], iso: GEO[g.key][3], works: g.count, universities: [] }));
const CID = new Set(countries.map((c) => c.id));
console.log('countries', countries.map((c) => c.id + ':' + c.works).join(' '));

const countryLinks = new Map();
await pool(countries, 4, async (c) => {
  for (const g of await groups(`${BASE},authorships.countries:${c.id}`, 'authorships.countries', 100)) {
    if (g.key === c.id || !CID.has(g.key)) continue;
    const k = [c.id, g.key].sort().join('|');
    countryLinks.set(k, Math.max(countryLinks.get(k) || 0, g.count));
  }
});

// ---- institutions per country
const cand = new Map();
await pool(countries, 4, async (c) => {
  const gs = await groups(`${BASE},authorships.institutions.country_code:${c.id}`, 'authorships.institutions.lineage', 60);
  c._cand = gs.map((g) => g.key);
  gs.forEach((g) => cand.set(g.key, Math.max(cand.get(g.key) || 0, g.count)));
});
const ids = [...cand.keys()];
const details = new Map();
for (let i = 0; i < ids.length; i += 50) {
  const batch = ids.slice(i, i + 50);
  const r = await get(`/institutions?filter=openalex:${batch.join('|')}&per_page=50&select=id,display_name,geo,country_code,type,cited_by_count,counts_by_year`);
  r.results.forEach((x) => details.set(tail(x.id), x));
}
const SHORT = {
  'Massachusetts Institute of Technology': 'MIT', 'California Institute of Technology': 'Caltech', 'Imperial College London': 'Imperial',
  'University College London': 'UCL', 'Chinese Academy of Sciences': 'CAS', 'Centre National de la Recherche Scientifique': 'CNRS',
  'Max Planck Society': 'Max Planck', 'ETH Zurich': 'ETH Zurich', 'École Polytechnique Fédérale de Lausanne': 'EPFL',
  'University of Science and Technology of China': 'USTC', 'Helmholtz Association of German Research Centres': 'Helmholtz',
  'Commissariat à l\'Énergie Atomique et aux Énergies Alternatives': 'CEA', 'Indian Institute of Science Bangalore': 'IISc',
  'National University of Singapore': 'NUS', 'Nanyang Technological University': 'NTU Singapore', 'Korea Advanced Institute of Science and Technology': 'KAIST',
  'University of Tokyo': 'Tokyo', 'The University of Tokyo': 'Tokyo', 'Tokyo Institute of Technology': 'Tokyo Tech', "King's College London": "King's",
  'Delft University of Technology': 'TU Delft', 'Eindhoven University of Technology': 'TU Eindhoven', 'Technical University of Munich': 'TU Munich',
  'Royal Institute of Technology': 'KTH', 'KTH Royal Institute of Technology': 'KTH', 'Technical University of Denmark': 'DTU',
  'Indian Institute of Technology Delhi': 'IIT Delhi', 'Indian Institute of Technology Bombay': 'IIT Bombay', 'Indian Institute of Technology Madras': 'IIT Madras',
  'Indian Institute of Technology Kharagpur': 'IIT Kharagpur', 'Russian Academy of Sciences': 'RAS', 'Consejo Superior de Investigaciones Científicas': 'CSIC',
  'Istituto Nazionale di Fisica Nucleare': 'INFN', 'National Research Council': 'CNR', 'Consiglio Nazionale delle Ricerche': 'CNR',
  'Harbin Institute of Technology': 'Harbin Tech', 'Huazhong University of Science and Technology': 'HUST', 'Xi\'an Jiaotong University': 'Xi\'an Jiaotong',
  'University of California, Berkeley': 'UC Berkeley', 'University of California, Los Angeles': 'UCLA', 'Stanford University': 'Stanford',
  'Seoul National University': 'SNU', 'University of Oxford': 'Oxford', 'University of Cambridge': 'Cambridge', 'Harvard University': 'Harvard',
  'Commonwealth Scientific and Industrial Research Organisation': 'CSIRO', 'National Research Council Canada': 'NRC Canada',
  'National Institute for Materials Science': 'NIMS', 'RIKEN': 'RIKEN', 'Lawrence Berkeley National Laboratory': 'Berkeley Lab',
  'Argonne National Laboratory': 'Argonne', 'Oak Ridge National Laboratory': 'Oak Ridge', 'Los Alamos National Laboratory': 'Los Alamos',
  'National Aeronautics and Space Administration': 'NASA', 'Sandia National Laboratories': 'Sandia', 'University of Manchester': 'Manchester',
  'Vellore Institute of Technology University': 'VIT Vellore', 'SRM Institute of Science and Technology': 'SRM', 'Technische Universität Dresden': 'TU Dresden',
  'Friedrich-Alexander-Universität Erlangen-Nürnberg': 'Erlangen', 'Ludwig-Maximilians-Universität München': 'LMU Munich', 'Lomonosov Moscow State University': 'Moscow State',
  'National Research Nuclear University MEPhI': 'MEPhI', 'Forschungszentrum Jülich': 'Jülich', 'Institute of Science Tokyo': 'Science Tokyo', 'The University of Osaka': 'Osaka',
  'Sorbonne Université': 'Sorbonne', 'Sapienza University of Rome': 'Sapienza', 'Universitat Politècnica de Catalunya': 'UPC Barcelona', 'Universidad Autónoma de Madrid': 'UAM Madrid',
  'University of the Basque Country': 'Basque Country', 'Islamic Azad University, Tehran': 'Azad Tehran', 'Iran University of Science and Technology': 'IUST Tehran',
  'Amirkabir University of Technology': 'Amirkabir', 'Universidade de São Paulo': 'São Paulo', 'Universidade Estadual de Campinas (UNICAMP)': 'Unicamp',
  'Universidade Estadual Paulista (Unesp)': 'Unesp', 'Universidade Federal do Rio de Janeiro': 'UFRJ', 'Universidade Federal do Rio Grande do Sul': 'UFRGS',
  'Korea University': 'Korea Univ.', 'University of Chinese Academy of Sciences': 'UCAS',
};
function shortName(n) {
  if (SHORT[n]) return SHORT[n];
  let s = n.replace(/^The /, '');
  let m = s.match(/^University of (.+)$/); if (m && m[1].length < 22) return m[1].replace(/,.*$/, '');
  m = s.match(/^(.+) University$/); if (m && m[1].length < 22) return m[1];
  m = s.match(/^Universit[éeäaà]t? (?:de |di |of |van |zu )?(.+)$/i); if (m && m[1].length < 22) return m[1];
  return s.length > 26 ? s.split(/[ ,]/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('') : s;
}
const yearsSum = (cby) => (cby || []).filter((y) => y.year >= 2017 && y.year <= 2026).reduce((a, y) => a + y.works_count, 0);
const universities = [];
for (const c of countries) {
  const want = PER_COUNTRY[c.id] || 5;
  const picks = c._cand.map((id) => details.get(id)).filter((d) => d && d.country_code === c.id && d.geo && !['government', 'funder', 'company', 'other'].includes(d.type) && !/ System$|^Ministry|^Government|Department of|Administration|^University of London$|^Institut de Chimie$|^Institut National des Sciences|^Institut de Physique$/i.test(d.display_name));
  for (const d of picks.slice(0, want)) {
    const id = tail(d.id);
    universities.push({
      id, name: d.display_name, short: shortName(d.display_name), city: d.geo.city || '', lat: d.geo.latitude, lng: d.geo.longitude,
      works: cand.get(id), allWorks: yearsSum(d.counts_by_year), citations: d.cited_by_count, type: d.type, country: c.id,
    });
    c.universities.push(id);
  }
  delete c._cand;
}
// unique slugs
const used = new Set();
for (const u of universities) {
  let s = u.short.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || u.id.toLowerCase();
  if (used.has(s)) s = s + '-' + u.country.toLowerCase();
  used.add(s); u.slug = s;
}
const UID = new Set(universities.map((u) => u.id));
console.log('universities', universities.length);

// ---- per university: areas, partners, sample of works
const uniLinks = new Map();
await pool(universities, 4, async (u, k) => {
  const L = `authorships.institutions.lineage:${u.id}`;
  const areaG = await groups(`${BASE},${L}`, 'primary_topic.subfield.id', 60);
  const partG = await groups(`${BASE},${L}`, 'authorships.institutions.lineage', 200);
  for (const g of partG) {
    if (g.key === u.id || !UID.has(g.key)) continue;
    const key = [u.id, g.key].sort().join('|');
    uniLinks.set(key, Math.max(uniLinks.get(key) || 0, g.count));
  }
  const fields = new Map();
  for (const g of areaG) { const s = SUB.get(g.key); if (s) fields.set(s.field, (fields.get(s.field) || 0) + g.count); }
  u.fields = [...fields].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count);
  u.topField = u.fields[0]?.field || 'Physics and Astronomy';
  const areaList = areaG.filter((g) => SUB.has(g.key) && g.count >= 15).slice(0, 18);
  const areaIds = new Set(areaList.map((g) => g.key));
  const sel = 'id,title,publication_year,cited_by_count,authorships,primary_topic';
  const w1 = await get(`/works?filter=${BASE},${L},authors_count:2-30&sort=cited_by_count:desc&per_page=200&select=${sel}`);
  const w2 = await get(`/works?filter=publication_year:${RECENT},${SUBF},${L},authors_count:2-30&sort=cited_by_count:desc&per_page=200&select=${sel}`);
  // Smaller areas get their own samples so the big ones don't crowd them out.
  const extra = [];
  for (const from of [3, 9]) {
    if (areaList.length <= from) continue;
    const f = `publication_year:${YEARS},primary_topic.subfield.id:${areaList.slice(from).map((g) => g.key).join('|')},type:article|review|preprint|conference-paper|letter|book-chapter`;
    extra.push(await get(`/works?filter=${f},${L},authors_count:2-30&sort=cited_by_count:desc&per_page=200&select=${sel}`));
  }
  const works = new Map();
  for (const w of [...w1.results, ...w2.results, ...extra.flatMap((x) => x.results)]) works.set(w.id, w);
  // Full OpenAlex profiles of the institution's physics researchers: career citations, h-index and topics.
  const prof = await tryGet(`/authors?filter=last_known_institutions.lineage:${u.id},topics.subfield.id:${SUBFIELDS.join('|')}&sort=cited_by_count:desc&per_page=200&select=id,display_name,works_count,cited_by_count,summary_stats,topics`);
  u.profiles = prof ? prof.meta.count : null;
  writeUni(u, areaList, areaIds, [...works.values()], prof ? prof.results : []);
  if (k % 10 === 0) console.log(`  ${k + 1}/${universities.length} ${u.name}  calls=${calls} $${spent.toFixed(4)}`);
});

function writeUni(u, areaList, areaIds, works, profiles) {
  const people = new Map();
  const profById = new Map(profiles.map((a) => [tail(a.id), a]));
  const paperAuthors = [];
  for (const w of works) {
    const sf = tail(w.primary_topic?.subfield?.id || '');
    if (!areaIds.has(sf)) continue;
    const mine = [];
    for (const a of w.authorships || []) {
      if (!a.author?.id || !a.author.display_name) continue;
      if (!(a.institutions || []).some((i) => (i.lineage || [i.id]).some((x) => tail(x) === u.id))) continue;
      const id = tail(a.author.id);
      let p = people.get(id);
      if (!p) people.set(id, (p = { id, name: a.author.display_name, sub: new Map(), papers: 0, citations: 0, first: 9999, last: 0, tp: [] }));
      if (mine.includes(p)) continue;
      mine.push(p);
      p.papers++; p.citations += w.cited_by_count || 0;
      p.first = Math.min(p.first, w.publication_year); p.last = Math.max(p.last, w.publication_year);
      p.sub.set(sf, (p.sub.get(sf) || 0) + 1);
      const tid = tail(w.primary_topic?.id || '');
      if (tid) (p.tt ||= new Map()).set(tid, (p.tt.get(tid) || 0) + 1);
      p.tp.push({ title: (w.title || 'Untitled').replace(/<[^>]+>/g, '').slice(0, 160), year: w.publication_year, cites: w.cited_by_count || 0 });
    }
    if (mine.length) { mine.sf = 'a' + sf; paperAuthors.push(mine); }
  }
  // Profiles add researchers the paper sample missed (big collaborations, long careers) and give everyone career totals.
  const topicArea = (a) => {
    const m = new Map();
    for (const t of a.topics || []) { const sf = tail(t.subfield?.id || ''); if (areaIds.has(sf)) m.set(sf, (m.get(sf) || 0) + t.count); }
    return [...m].sort((x, y) => y[1] - x[1]);
  };
  for (const [id, a] of profById) {
    const ta = topicArea(a);
    if (!ta.length) continue;
    let p = people.get(id);
    if (!p) people.set(id, (p = { id, name: a.display_name, sub: new Map(), papers: 0, citations: 0, first: 0, last: 0, tp: [] }));
    p.h = a.summary_stats?.h_index || 0;
    p.career = a.cited_by_count || 0;
    p.phys = ta.reduce((s, x) => s + x[1], 0);
    p.topicAreas = ta.map((x) => 'a' + x[0]);
    p.tv = (a.topics || []).slice(0, 10).map((t) => [tail(t.id), t.count]);
  }
  for (const p of people.values()) {
    const s = [...p.sub].sort((a, b) => b[1] - a[1]);
    p.areas = p.topicAreas || s.map((x) => 'a' + x[0]);
    p.area = p.areas[0];
  }
  const areas = areaList.map((g) => ({ id: 'a' + g.key, name: SUB.get(g.key).name, works: g.count, field: SUB.get(g.key).field, researchersSeen: 0 }));
  const byArea = new Map(areas.map((a) => [a.id, []]));
  for (const p of people.values()) { byArea.get(p.area)?.push(p); }
  const kept = new Set();
  for (const a of areas) {
    const list = byArea.get(a.id).sort((x, y) => (y.h || 0) - (x.h || 0) || y.papers - x.papers || y.citations - x.citations);
    a.researchersSeen = list.length;
    list.slice(0, PER_AREA).forEach((p) => kept.add(p));
  }
  const pl = new Map(), al = new Map();
  for (const authors of paperAuthors) {
    // a researcher publishing outside their main area also ties the two areas
    for (const a of authors) if (a.area !== authors.sf) { const k = [a.area, authors.sf].sort().join('|'); al.set(k, (al.get(k) || 0) + 1); }
    for (let i = 0; i < authors.length; i++) for (let j = i + 1; j < authors.length; j++) {
      const a = authors[i], b = authors[j];
      if (a.area !== b.area) { const k = [a.area, b.area].sort().join('|'); al.set(k, (al.get(k) || 0) + 1); }
      if (kept.has(a) && kept.has(b)) { const k = [a.id, b.id].sort().join('|'); pl.set(k, (pl.get(k) || 0) + 1); }
    }
  }
  const deg = new Map();
  for (const k of pl.keys()) for (const id of k.split('|')) deg.set(id, (deg.get(id) || 0) + 1);
  const out = {
    id: u.id,
    sampleWorks: works.length,
    areas: areas.filter((a) => a.researchersSeen > 0 || a.works > 0),
    areaLinks: [...al].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; }),
    people: [...kept].map((p) => ({
      id: p.id, name: p.name, area: p.area, papers: p.papers, citations: p.citations, first: p.first, last: p.last, areas: p.areas.slice(0, 4),
      h: p.h ?? null, career: p.career ?? null, phys: p.phys ?? null, tv: p.tv || (p.tt ? [...p.tt].sort((a, b) => b[1] - a[1]).slice(0, 10) : null),
      topPapers: p.tp.sort((a, b) => b.cites - a.cites).slice(0, 3), degree: deg.get(p.id) || 0,
    })),
    peopleLinks: [...pl].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; }),
  };
  u.areaCount = out.areas.length;
  u.peopleCount = out.people.length;
  fs.writeFileSync(path.join(OUT, 'u', u.slug + '.json'), JSON.stringify(out));
}

const levels = {
  meta: {
    source: 'OpenAlex', years: '2017–2026', focus: universities.find((u) => u.slug === 'imperial')?.id || universities[0].id, checked: new Date().toISOString().slice(0, 10),
    subfields: [...SUB].map(([id, s]) => ({ id: 'a' + id, name: s.name, field: s.field })),
    note: 'Physics-related research: OpenAlex works 2017–2026 whose main topic falls in one of 31 physics-related subfields. Countries: works with an author in that country. Institutions: the largest by those works in each country. Areas: OpenAlex subfields, sized by the institution’s works. People: authors at the institution on its 200 most-cited 2–30-author papers in these subfields plus its 200 most-cited since 2022 and the most-cited papers in its smaller areas, joined with the full OpenAlex profiles (career citations, h-index, topics) of its 200 most-cited physics researchers; up to 60 per area, ranked by h-index.',
  },
  countries,
  countryLinks: [...countryLinks].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; }),
  universities,
  uniLinks: [...uniLinks].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; }),
};
fs.writeFileSync(path.join(OUT, 'levels.json'), JSON.stringify(levels));
console.log(`done: ${calls} new calls, $${spent.toFixed(4)}`);
