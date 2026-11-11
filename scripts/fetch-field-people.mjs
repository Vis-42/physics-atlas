// The world network of each subfield: its 60 most-cited researchers anywhere, and who among them
// writes together (from the subfield's most-cited papers that include them, 2017–26).
// Writes public/data/net/s<subfield>.json. Two lookups per subfield; cached and resumable.
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
const N = 60;
const tail = (s) => String(s || '').split('/').pop();
fs.mkdirSync(path.join(DATA, 'net'), { recursive: true });
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
    // keep only what the network needs
    if (json.results?.[0]?.authorships) json.results = json.results.map((w) => ({ id: w.id, cited_by_count: w.cited_by_count, authorships: w.authorships.map((x) => ({ author: { id: x.author?.id } })) }));
    writeJson(file, json);
    return json;
  }
  return null;
}

const atlas = JSON.parse(fs.readFileSync(path.join(DATA, 'atlas.json'), 'utf8'));
let i = 0, done = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (i < atlas.subfields.length && !stopped) {
    const s = atlas.subfields[i++];
    const a = await get(`/authors?filter=topics.subfield.id:${s.id}&sort=cited_by_count:desc&per_page=${N}&select=id,display_name,cited_by_count,summary_stats,last_known_institutions`);
    if (!a) continue;
    const people = a.results.map((x) => {
      const inst = (x.last_known_institutions || [])[0];
      const top = inst ? tail((inst.lineage || [inst.id]).slice(-1)[0]) : null;
      return [tail(x.id), x.display_name, top, inst?.display_name || '', inst?.country_code || '', x.summary_stats?.h_index || 0, x.cited_by_count || 0];
    });
    const idx = new Map(people.map((p, k) => [p[0], k]));
    const w = await get(`/works?filter=${BASE},primary_topic.subfield.id:${s.id},authorships.author.id:${people.map((p) => p[0]).join('|')}&sort=cited_by_count:desc&per_page=200&select=id,cited_by_count,authorships`);
    const pairs = new Map();
    for (const work of w?.results || []) {
      const ks = [...new Set(work.authorships.map((x) => idx.get(tail(x.author?.id))).filter((k) => k != null))];
      for (let x = 0; x < ks.length; x++) for (let y = x + 1; y < ks.length; y++) { const k = Math.min(ks[x], ks[y]) + '|' + Math.max(ks[x], ks[y]); pairs.set(k, (pairs.get(k) || 0) + 1); }
    }
    fs.writeFileSync(path.join(DATA, 'net', 's' + s.id + '.json'), JSON.stringify({ people, links: [...pairs].map(([k, n]) => [...k.split('|').map(Number), n]) }));
    done++;
  }
}));
console.log(`subfield networks ${done}/${atlas.subfields.length}, lookups ${calls}${stopped ? ' (allowance used up; rerun later)' : ''}`);
