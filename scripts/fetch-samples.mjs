// Paper samples for every held institution and each of its biggest research areas (all fields):
// the 200 most-cited papers 2017–26 in that area with an author there. The authorships of these
// papers give co-authorship inside the institution, across its areas, and with people elsewhere.
// Stored compact in .cache/samples/<institution>-<subfield>.json. Cached and resumable.
// Run: node scripts/fetch-samples.mjs [slug ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { has, readJson, writeJson } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(ROOT, '.cache', 'samples');
const KEYF = path.join(ROOT, '.cache', 'openalex-key');
const KEY = process.env.OPENALEX_API_KEY || (fs.existsSync(KEYF) ? fs.readFileSync(KEYF, 'utf8').trim() : ''); // private, never published
const AREAS = Number(process.env.AREAS || 14);
const BASE = 'publication_year:2017-2026,type:article|review|preprint|conference-paper|letter|book-chapter';
fs.mkdirSync(OUT, { recursive: true });
const tail = (s) => String(s || '').split('/').pop();
let calls = 0, stopped = false;

async function fetchJson(url) {
  for (let a = 0; a < 4; a++) {
    const res = await fetch('https://api.openalex.org' + url + (KEY ? '&api_key=' + KEY : ''), { headers: { 'User-Agent': 'netwrk-atlas/1.0' } });
    if (res.status === 429 && Number(res.headers.get('x-ratelimit-remaining') ?? 1) <= 0) { stopped = true; return null; }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) return null;
    calls++;
    return res.json();
  }
  return null;
}
// compact work: [id, year, cites, title, subfield, [[authorId, name, [institution ids incl. lineage], [[instId, instName]]]]]
export const compact = (w) => [tail(w.id), w.publication_year, w.cited_by_count || 0, (w.title || '').replace(/<[^>]+>/g, '').slice(0, 160), tail(w.primary_topic?.subfield?.id),
  (w.authorships || []).filter((a) => a.author?.id).map((a) => [tail(a.author.id), a.author.display_name,
    [...new Set((a.institutions || []).flatMap((i) => (i.lineage || [i.id]).map(tail)))],
    (a.institutions || []).slice(0, 2).map((i) => [tail(i.id), i.display_name])])];

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const atlas = JSON.parse(fs.readFileSync(process.env.ATLAS_FILE || path.join(DATA, 'atlas.json'), 'utf8'));
  const want = process.argv.slice(2);
  const unis = atlas.universities.slice().sort((a, b) => (b.slug === 'imperial') - (a.slug === 'imperial') || b.works - a.works).filter((u) => !want.length || want.includes(u.slug));
  const jobs = unis.flatMap((u) => u.subs.slice(0, AREAS).map(([sid]) => ({ u, sid })));
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < jobs.length && !stopped) {
      const { u, sid } = jobs[i++];
      const f = path.join(OUT, `${u.id}-${sid}.json`);
      if (has(f)) { done++; continue; }
      const r = await fetchJson(`/works?filter=${BASE},authorships.institutions.lineage:${u.id},primary_topic.subfield.id:${sid}&sort=cited_by_count:desc&per_page=200&select=id,title,publication_year,cited_by_count,authorships,primary_topic`);
      if (!r) continue;
      writeJson(f, { inst: u.id, sub: sid, works: r.results.map(compact) });
      done++;
      if (done % 100 === 0) console.log(`samples ${done}/${jobs.length}, lookups ${calls}`);
    }
  }));
  console.log(`done: ${done}/${jobs.length} samples, ${calls} new lookups${stopped ? ' (allowance used up; rerun later)' : ''}`);
}
