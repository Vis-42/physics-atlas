// The measure that decides which institutions the atlas holds. For every institution in the world:
// how many of the world's most-cited papers of 2017–26 it wrote (about 50,000 papers, the citation
// level set by fetch-quality.mjs), split into papers with up to 100 authors and larger collaborations.
// Then it scores them and writes .cache/selection.json, the institutions the atlas holds:
//   elite papers E = papers with up to 100 authors + a tenth of those with more
//   quality score Q = E / sqrt(papers 2017–26 in thousands) x h-index / 100
//   (elite papers per size reward strength and focus; the h-index needs sustained strength, so a handful of
//   lucky or inflated papers at a small institution can't carry it)
//   held: the world's top 240 by Q, then, with Q of at least 25, the top 5 in every country with 200+ elite
//   papers, the top 10 in each field by its own highly cited papers, and the top 3 in each subfield by
//   those papers per square root of its size (the citation bar differs by field, so specialists such as
//   CERN in particle physics aren't lost to medicine or to vast organisations).
// Funders, ministries, health systems and parts of a university can't be held. About 600 lookups; resumable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'openalex');
const KEYF = path.join(ROOT, '.cache', 'openalex-key');
const KEY = process.env.OPENALEX_API_KEY || (fs.existsSync(KEYF) ? fs.readFileSync(KEYF, 'utf8').trim() : ''); // private, never published
const BASE = 'publication_year:2017-2026,type:article|review|preprint|conference-paper|letter|book-chapter';
const thr = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'quality.json'), 'utf8')).thr.all;
let calls = 0;

async function get(url) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  const c = readJson(file);
  if (c) return c;
  for (let a = 0; a < 8; a++) {
    const res = await fetch('https://api.openalex.org' + url + '&api_key=' + KEY, { headers: { 'User-Agent': 'netwrk-atlas/1.0' } });
    if (res.status === 429 && Number(res.headers.get('x-ratelimit-remaining-usd') ?? 1) < 0.001) throw new Error('daily allowance used up; rerun later');
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1000 * Number(res.headers.get('retry-after') || 2 * (a + 1)))); continue; }
    if (!res.ok) throw new Error('lookup failed ' + res.status);
    const json = await res.json();
    calls++;
    writeJson(file, json);
    return json;
  }
  throw new Error('gave up');
}
async function all(filter) {
  const m = new Map();
  for (let cursor = '*'; cursor;) {
    const r = await get(`/works?filter=${filter}&group_by=authorships.institutions.lineage&per_page=200&cursor=${cursor}`);
    for (const g of r.group_by || []) m.set(String(g.key).split('/').pop(), g.count);
    cursor = r.group_by?.length ? r.meta.next_cursor : null;
  }
  return m;
}
const small = await all(`${BASE},cited_by_count:>${thr - 1},authors_count:<101`);
const big = await all(`${BASE},cited_by_count:>${thr - 1},authors_count:>100`);
const rows = {};
for (const id of new Set([...small.keys(), ...big.keys()])) rows[id] = [small.get(id) || 0, big.get(id) || 0];
fs.writeFileSync(path.join(ROOT, '.cache', 'elite.json'), JSON.stringify({ thr, rows }));
console.log(`institutions ${Object.keys(rows).length}, new lookups ${calls}`);

// ---- who can be held
const NOT_RESEARCH = /Foundation|Trust\b|Council|Ministry|Ministère|Agency|Fund\b|Association|Society$| System$|NHS|Department of|Government|Research and Innovation|Generalitat|Comunidad|European Union|Administration$|Region\b|Health Services?$|Health$|Direction de|Directorate|Commission|Mass General Brigham|^University of London$|National Institute for Health and Care Research|Initiative|Istituti di Ricovero|Institut Català|Office of Science|Board of the Swiss|CERCA Institution|Deutsche Zentren|Gouvernement|Santé Québec|Ministerio|Alphabet|Battelle/;
const STILL_RESEARCH = /Agency for Science, Technology and Research|Max Planck Society|National Aeronautics and Space Administration|National Oceanic and Atmospheric Administration|Cleveland Clinic|Institutes? of .*Health$|National Research Council/;
// parents in the records that aren't really parents: labs run for a government, hospitals with a nominal affiliation
const OWN_PLACE = /National Laboratory|Accelerator Laboratory|^Brigham and Women|^Université Paris Cité$|Wellcome Sanger|^Google/;
const TYPES = new Set(['education', 'facility', 'nonprofit', 'healthcare', 'company', 'government']);
const SNAP = path.join(ROOT, '.cache', 'snapshot', 'institutions');
const recs = new Map();
for (const f of fs.readdirSync(SNAP).filter((x) => x.endsWith('.gz')).sort()) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(SNAP, f)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line), id = r.id.split('/').pop();
    const cby = new Map((r.counts_by_year || []).map((y) => [y.year, y.works_count]));
    let w = 0;
    for (let y = 2017; y <= 2026; y++) w += cby.get(y) || 0;
    recs.set(id, { id, name: r.display_name, type: r.type, cc: r.country_code, geo: r.geo?.latitude != null, sup: r.is_super_system, w, h: r.summary_stats?.h_index || 0, up: (r.lineage || []).map((l) => l.split('/').pop()).filter((l) => l !== id) });
  }
}
const eligible = (r) => TYPES.has(r.type) && r.cc && r.geo && !r.sup && r.w >= 500 && (!NOT_RESEARCH.test(r.name) || STILL_RESEARCH.test(r.name))
  && (OWN_PLACE.test(r.name) || r.up.every((a) => { const p = recs.get(a); return ['government', 'healthcare'].includes(p?.type) || (p && NOT_RESEARCH.test(p.name) && !STILL_RESEARCH.test(p.name)); })); // a part of a university or a company counts within it
const cand = [];
for (const [id, [s, b]] of Object.entries(rows)) {
  const r = recs.get(id);
  if (r && eligible(r)) cand.push({ ...r, s, b, E: s + b / 10 });
}
// the snapshot's paper counts are unreliable (some inflated threefold), so it only shortlists; exact counts decide
const rough = (c) => (c.E / Math.sqrt(Math.max(c.w, 1000) / 1000)) * c.h;
const short = new Set();
const byCC = new Map();
for (const c of cand) if (c.E >= 10) { if (!byCC.has(c.cc)) byCC.set(c.cc, []); byCC.get(c.cc).push(c); }
for (const list of byCC.values()) list.sort((a, b) => rough(b) - rough(a)).slice(0, 8).forEach((c) => short.add(c));
// each field's leaders by its own highly cited papers (fetch-quality.mjs)
const quality = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'quality.json'), 'utf8'));
const candById = new Map(cand.map((c) => [c.id, c])), leaders = new Set();
const subLeaders = [];
for (const [key, list] of Object.entries(quality.heat)) {
  if (key === 'all') continue;
  const top = list.filter(([id]) => candById.has(id)).slice(0, key[0] === 's' ? 12 : 10);
  for (const [id] of top) short.add(candById.get(id));
  if (key[0] === 's') subLeaders.push(top.map(([id, n]) => ({ c: candById.get(id), n })));
  else top.forEach(([id]) => leaders.add(candById.get(id)));
}
cand.slice().sort((a, b) => rough(b) - rough(a)).slice(0, 450).forEach((c) => short.add(c));
console.log(`eligible ${cand.length}, shortlisted ${short.size}`);

// ---- exact papers 2017–26
const list = [...short];
let i = 0, failed = null;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (i < list.length && !failed) {
    const c = list[i++];
    try { c.P = (await get(`/works?filter=${BASE},authorships.institutions.lineage:${c.id}&per_page=1&select=id`)).meta.count; } catch (e) { failed = e; }
  }
}));
if (failed) { console.warn(String(failed.message), `(lookups ${calls}); selection not written yet`); process.exit(0); }

// ---- score and choose
for (const c of list) c.Q = (c.E / Math.sqrt(Math.max(c.P, 1000) / 1000)) * (c.h / 100);
list.sort((a, b) => b.Q - a.Q);
list.forEach((c, k) => { c.rank = k + 1; });
const held = new Set(list.filter((c) => c.E >= 20).slice(0, 240));
const FLOOR = 25;
for (const cc of byCC.keys()) if ((quality.countries[cc] || 0) >= 200) list.filter((c) => c.cc === cc && c.E >= 10 && c.Q >= FLOOR).slice(0, 5).forEach((c) => held.add(c));
for (const c of leaders) if (c.Q >= FLOOR) held.add(c);
for (const top of subLeaders) top.sort((a, b) => b.n / Math.sqrt(Math.max(b.c.P, 1000)) - a.n / Math.sqrt(Math.max(a.c.P, 1000))).slice(0, 3).forEach(({ c }) => { if (c.Q >= FLOOR) held.add(c); });
fs.writeFileSync(path.join(ROOT, '.cache', 'selection.json'), JSON.stringify({ thr, scored: list.length,
  held: [...held].map((c) => ({ id: c.id, s: c.s, b: c.b, P: c.P, Q: +c.Q.toFixed(1), rank: c.rank })) }));
console.log(`held ${held.size}, lookups ${calls}`);
