// Every researcher on the map, checked against their own OpenAlex profile: where they have been
// affiliated and in which years, where they are now, how much they have published each year, and the
// subfields they work in. 100 profiles per lookup (one credit each), so the whole map is ~3,200 lookups.
// Stored compact in .cache/authors/<batch>.json.gz (batch = 100 author ids in sorted order). Resumable.
// Run from app/: node scripts/fetch-authors.mjs [concurrency]
import fs from 'node:fs';
import { readJson, writeJson, has } from './cache.mjs';

const CONC = +(process.argv[2] || 6);
const KEY = fs.readFileSync('.cache/openalex-key', 'utf8').trim();
const DIR = '.cache/authors';
fs.mkdirSync(DIR, { recursive: true });

const ids = new Set();
for (const f of fs.readdirSync('public/data/u')) for (const p of JSON.parse(fs.readFileSync('public/data/u/' + f)).people) ids.add(p.id);
const all = [...ids].sort();
const batches = [];
for (let i = 0; i < all.length; i += 100) batches.push(all.slice(i, i + 100));
fs.writeFileSync(DIR + '/index.json', JSON.stringify({ count: all.length, batches: batches.length }));
const todo = batches.map((b, i) => i).filter((i) => !has(`${DIR}/${i}.json`));
console.log(`${all.length} researchers in ${batches.length} batches; ${todo.length} to fetch`);

const short = (u) => u && u.replace('https://openalex.org/', '').replace('https://openalex.org/subfields/', 's');
function compact(r) {
  const sf = new Map();
  for (const t of r.topics || []) { const s = short(t.subfield?.id); if (s) sf.set(s, (sf.get(s) || 0) + t.count); }
  return {
    id: short(r.id), n: r.display_name, wc: r.works_count, cites: r.cited_by_count, h: r.summary_stats?.h_index ?? null,
    lk: (r.last_known_institutions || []).map((i) => (i.lineage || [i.id]).map(short)),
    af: (r.affiliations || []).map((a) => ({ l: (a.institution.lineage || [a.institution.id]).map(short), c: a.institution.country_code, y: a.years })),
    cy: Object.fromEntries((r.counts_by_year || []).filter((c) => c.year >= 2015).map((c) => [c.year, c.works_count])),
    sf: [...sf].sort((a, b) => b[1] - a[1]),
  };
}

let remaining = Infinity, done = 0, failed = 0;
async function get(url) {
  for (let t = 0; t < 6; t++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'research-atlas/1.0' } }).catch(() => null);
    if (res && res.ok) { remaining = +(res.headers.get('x-ratelimit-remaining') ?? remaining); return res.json(); }
    if (res && res.status === 429 && remaining < 50) throw new Error('daily allowance used up');
    await new Promise((r) => setTimeout(r, 1000 * 2 ** t));
  }
  throw new Error('failed ' + url.slice(0, 120));
}
async function worker() {
  while (todo.length) {
    if (remaining < 100) { console.log('stopping: under 100 lookups left today; rerun after the reset'); return; }
    const i = todo.shift(), b = batches[i];
    try {
      const j = await get(`https://api.openalex.org/authors?filter=openalex_id:${b.join('|')}&per_page=100&select=id,display_name,works_count,cited_by_count,summary_stats,last_known_institutions,affiliations,counts_by_year,topics&api_key=${KEY}`);
      const got = j.results.map(compact);
      // ids OpenAlex no longer has (merged into another profile) are recorded as missing
      const seen = new Set(got.map((r) => r.id));
      writeJson(`${DIR}/${i}.json`, { ids: b, authors: got, missing: b.filter((x) => !seen.has(x)) });
      if (++done % 100 === 0) console.log(`  ${done} batches, ${remaining} lookups left today`);
    } catch (e) { failed++; console.warn('batch', i, e.message); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`done: ${done} fetched, ${failed} failed; ${todo.length} left`);
