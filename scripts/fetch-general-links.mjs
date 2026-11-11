// Co-authorship across all fields, 2017–2026: for each held institution, the papers it shares with
// every other held institution; for each country, the papers it shares with every other country.
// Writes public/data/glinks.json. Cached and resumable (one lookup per institution or country).
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
const atlas = JSON.parse(fs.readFileSync(process.env.ATLAS_FILE || path.join(DATA, 'atlas.json'), 'utf8'));
let calls = 0, stopped = false;

async function get(url) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  { const c = readJson(file); if (c) return c; }
  if (stopped) return null;
  for (let a = 0; a < 4; a++) {
    const res = await fetch('https://api.openalex.org' + url + (KEY ? '&api_key=' + KEY : ''), { headers: { 'User-Agent': 'research-atlas/1.0' } });
    if (res.status === 429 && Number(res.headers.get('x-ratelimit-remaining') ?? 1) <= 0) { stopped = true; console.warn('daily allowance used up'); return null; }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) { console.warn('lookup failed', res.status); return null; }
    const json = await res.json();
    calls++;
    writeJson(file, json);
    return json;
  }
  return null;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const uid = new Set(atlas.universities.map((u) => u.id));
const cid = new Set(atlas.countries.map((c) => c.id));
const uni = new Map(), cty = new Map();
await pool(atlas.universities, 5, async (u) => {
  const r = await get(`/works?filter=${BASE},authorships.institutions.lineage:${u.id}&group_by=authorships.institutions.lineage&per_page=200`);
  if (!r) return;
  for (const g of r.group_by) {
    const id = g.key.split('/').pop();
    if (id === u.id || !uid.has(id)) continue;
    const k = [u.id, id].sort().join('|');
    uni.set(k, Math.max(uni.get(k) || 0, g.count));
  }
});
await pool(atlas.countries, 5, async (c) => {
  const r = await get(`/works?filter=${BASE},authorships.countries:${c.id}&group_by=authorships.countries&per_page=200`);
  if (!r) return;
  for (const g of r.group_by) {
    const id = g.key.split('/').pop();
    if (id === c.id || !cid.has(id)) continue;
    const k = [c.id, id].sort().join('|');
    cty.set(k, Math.max(cty.get(k) || 0, g.count));
  }
});
const out = (m) => [...m].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; });
fs.writeFileSync(path.join(DATA, 'glinks.json'), JSON.stringify({ uniLinks: out(uni), countryLinks: out(cty) }));
console.log(`institution links ${uni.size}, country links ${cty.size}, new lookups ${calls}`);
