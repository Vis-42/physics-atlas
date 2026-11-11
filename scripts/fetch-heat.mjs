// Exact 2017–26 paper counts from the OpenAlex API (papers only, not data files):
//   for every field and subfield, the 200 institutions with the most papers in it (heat maps);
//   for every held institution, its papers per subfield and per topic (its research areas).
// Raw answers go to the cache; build-atlas.mjs reads them. Resumable.
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
export const BASE = 'publication_year:2017-2026,type:article|review|preprint|conference-paper|letter|book-chapter';
let calls = 0, stopped = false;

export function cachedPath(url) { return path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json'); }
async function get(url) {
  const file = cachedPath(url);
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
export const urls = {
  sub: (id) => `/works?filter=${BASE},primary_topic.subfield.id:${id}&group_by=authorships.institutions.lineage&per_page=200`,
  field: (id) => `/works?filter=${BASE},primary_topic.field.id:${id}&group_by=authorships.institutions.lineage&per_page=200`,
  instSubs: (id) => `/works?filter=${BASE},authorships.institutions.lineage:${id}&group_by=primary_topic.subfield.id&per_page=200`,
  instTops: (id) => `/works?filter=${BASE},authorships.institutions.lineage:${id}&group_by=primary_topic.id&per_page=200`,
  countries: () => `/works?filter=${BASE}&group_by=authorships.countries&per_page=200`,
};

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const atlas = JSON.parse(fs.readFileSync(process.env.ATLAS_FILE || path.join(DATA, 'atlas.json'), 'utf8'));
  const jobs = [
    ...atlas.subfields.map((s) => urls.sub(s.id)), ...atlas.fields.map((f) => urls.field(f.id)),
    ...atlas.universities.flatMap((u) => [urls.instSubs(u.id), urls.instTops(u.id)]), urls.countries(),
  ];
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < jobs.length && !stopped) await get(jobs[i++]); }));
  console.log(`jobs ${jobs.length}, new lookups ${calls}${stopped ? ' (stopped: allowance used up)' : ''}`);
}
