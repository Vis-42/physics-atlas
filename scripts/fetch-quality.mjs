// Significance, not just volume: "highly cited papers" are the top 5% most-cited papers 2017–26 in a
// field or subfield (at most its 50,000 most-cited). For every field, subfield and the whole of
// research it finds that citation threshold, then counts each institution's highly cited papers; for
// every held institution it also counts the highly cited papers it shares with each partner, and for
// every country its highly cited papers. Writes .cache/quality.json. Cached and resumable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { has, readJson, writeJson } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache', 'openalex');
const KEYF = path.join(ROOT, '.cache', 'openalex-key');
const KEY = process.env.OPENALEX_API_KEY || (fs.existsSync(KEYF) ? fs.readFileSync(KEYF, 'utf8').trim() : ''); // private, never published
const BASE = 'publication_year:2017-2026,type:article|review|preprint|conference-paper|letter|book-chapter';
let calls = 0, stopped = false;

async function get(url) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  { const c = readJson(file); if (c) return c; }
  if (stopped) return null;
  for (let a = 0; a < 4; a++) {
    const res = await fetch('https://api.openalex.org' + url + (KEY ? '&api_key=' + KEY : ''), { headers: { 'User-Agent': 'research-atlas/1.0' } });
    if (res.status === 429 && Number(res.headers.get('x-ratelimit-remaining') ?? 1) <= 0) { stopped = true; return null; }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) return null;
    const json = await res.json();
    calls++;
    writeJson(file, json);
    return json;
  }
  return null;
}
const groups = (r) => (r?.group_by || []).map((g) => [String(g.key).split('/').pop(), g.count]);
// Big scopes (all research, physics, whole fields) use their 50,000 most-cited papers: deep enough
// to count every strong institution, and elite enough that citation rings (heavily self-citing
// institutions, whose papers gather moderate counts) drop out. OpenAlex pages only 10,000 deep, so
// past that the citation level is found by halving on paper counts.
const CAP = 50000;
const count = async (f) => (await get(`/works?filter=${f}&per_page=1&select=id`))?.meta?.count ?? null;
async function threshold(f) {
  const n = await count(f);
  if (n == null) return null;
  const k = Math.max(1, Math.min(CAP, Math.round(n * 0.05)));
  const r = await get(`/works?filter=${f}&sort=cited_by_count:desc&per_page=1&page=${Math.min(k, 10000)}&select=cited_by_count`);
  if (!r?.results?.[0]) return null;
  let hi = Math.max(1, r.results[0].cited_by_count);
  if (k <= 10000) return hi;
  let lo = 1; // at least k papers have lo or more citations; fewer than k have hi or more
  while (hi - lo > Math.max(1, lo * 0.03)) {
    const mid = Math.max(lo + 1, Math.round(Math.sqrt(lo * hi)));
    const m = await count(`${f},cited_by_count:>${mid - 1}`);
    if (m == null) return null;
    if (m >= k) lo = mid; else hi = mid;
  }
  return lo;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length && !stopped) await fn(items[i++]); })); }

const atlas = JSON.parse(fs.readFileSync(process.env.ATLAS_FILE || path.join(DATA, 'atlas.json'), 'utf8'));
const out = { thr: {}, heat: {}, inst: {}, shared: {}, countries: {} };
const scopes = [['all', BASE], ['physics', `${BASE},primary_topic.subfield.id:${atlas.meta.physicsSubfields.join('|')}`],
  ...atlas.fields.map((f) => ['f' + f.id, `${BASE},primary_topic.field.id:${f.id}`]),
  ...atlas.subfields.map((s) => ['s' + s.id, `${BASE},primary_topic.subfield.id:${s.id}`])];
await pool(scopes, 5, async ([key, f]) => {
  const t = await threshold(f);
  if (t == null) return;
  out.thr[key] = t;
  const g = await get(`/works?filter=${f},cited_by_count:>${t - 1}&group_by=authorships.institutions.lineage&per_page=200`);
  if (g) out.heat[key] = groups(g);
});
const T = out.thr.all;
if (T) {
  const c = await get(`/works?filter=${BASE},cited_by_count:>${T - 1}&group_by=authorships.countries&per_page=200`);
  if (c) out.countries = Object.fromEntries(groups(c));
  await pool(atlas.universities, 5, async (u) => {
    const g = await get(`/works?filter=${BASE},authorships.institutions.lineage:${u.id},cited_by_count:>${T - 1}&group_by=authorships.institutions.lineage&per_page=200`);
    if (!g) return;
    const m = new Map(groups(g));
    out.inst[u.id] = m.get(u.id) || 0;
    out.shared[u.id] = [...m].filter(([id]) => id !== u.id);
  });
}
fs.writeFileSync(path.join(ROOT, '.cache', 'quality.json'), JSON.stringify(out));
console.log(`scopes ${Object.keys(out.heat).length}/${scopes.length}, institutions ${Object.keys(out.inst).length}, lookups ${calls}${stopped ? ' (allowance used up; rerun later)' : ''}`);
