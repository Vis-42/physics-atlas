// Adds researchers to research areas beyond physics, from OpenAlex author profiles: for each held
// institution and each of its biggest areas (OpenAlex subfields) it fetches the 60 most-cited
// researchers there (career h-index, citations, topics). One lookup per institution and area;
// cached and resumable, it stops cleanly when the daily allowance runs out.
// Run: node scripts/fetch-people.mjs [slug ...]   (default: Imperial first, then the biggest)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { has, readJson, writeJson } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache', 'openalex');
const AREAS = 14, PER = 60;
const atlas = JSON.parse(fs.readFileSync(process.env.ATLAS_FILE || path.join(DATA, 'atlas.json'), 'utf8'));
const subName = new Map(atlas.subfields.map((s) => [s.id, s]));
const fieldName = new Map(atlas.fields.map((f) => [f.id, f.name]));
let stopped = false, calls = 0;

async function get(url) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  { const c = readJson(file); if (c) return c; }
  if (stopped) return null;
  const key = process.env.OPENALEX_API_KEY || (fs.existsSync(path.join(ROOT, '.cache', 'openalex-key')) ? fs.readFileSync(path.join(ROOT, '.cache', 'openalex-key'), 'utf8').trim() : ''); // private, never published
  const res = await fetch('https://api.openalex.org' + url + (key ? '&api_key=' + key : ''), { headers: { 'User-Agent': 'research-atlas/1.0' } });
  if (res.status === 429 && Number(res.headers.get('x-ratelimit-remaining') ?? 1) <= 0) { stopped = true; console.warn('daily allowance used up; rerun later to continue'); return null; }
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 3000)); return get(url); } // a brief throttle, not the daily limit
  if (!res.ok) { console.warn(res.status, url); return null; }
  const json = await res.json();
  calls++;
  writeJson(file, json);
  return json;
}

const want = process.argv.slice(2);
const unis = atlas.universities.slice().sort((a, b) => (b.slug === 'imperial') - (a.slug === 'imperial') || b.works - a.works)
  .filter((u) => !want.length || want.includes(u.slug));
let next = 0;
async function worker() { while (next < unis.length && !stopped) await one(unis[next++]); }
async function one(u) {
  const f = path.join(DATA, 'u', u.slug + '.json');
  const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { id: u.id, sampleWorks: 0, areas: [], areaLinks: [], people: [], peopleLinks: [] };
  const have = new Set(d.people.map((p) => p.id));
  const scale = u.works / Math.max(1, u.worksAll);
  let added = 0, whole = true;
  for (const [sid, n] of u.subs.slice(0, AREAS)) {
    const aid = 'a' + sid;
    if (d.areas.some((a) => a.id === aid && a.researchersSeen > 0)) continue; // physics areas are already measured
    const r = await get(`/authors?filter=last_known_institutions.lineage:${u.id},topics.subfield.id:${sid}&sort=cited_by_count:desc&per_page=${PER}&select=id,display_name,works_count,cited_by_count,summary_stats,topics`);
    if (!r) { whole = false; break; }
    let area = d.areas.find((a) => a.id === aid);
    if (!area) d.areas.push((area = { id: aid, name: subName.get(sid)?.name || sid, works: Math.round(n * scale), field: fieldName.get(subName.get(sid)?.field) || '', researchersSeen: 0 }));
    area.researchersSeen = r.meta.count;
    for (const a of r.results) {
      const id = a.id.split('/').pop();
      if (have.has(id)) continue;
      have.add(id);
      const tops = (a.topics || []).map((t) => [t.id.split('/').pop(), t.subfield?.id?.split('/').pop(), t.count]);
      d.people.push({
        id, name: a.display_name, area: aid, papers: 0, citations: 0, first: 0, last: 0,
        areas: [...new Set(tops.map((t) => 'a' + t[1]))].slice(0, 4),
        h: a.summary_stats?.h_index || 0, career: a.cited_by_count || 0, phys: null,
        tv: tops.slice(0, 10).map((t) => [t[0], t[2]]), topPapers: [], degree: 0,
      });
      added++;
    }
  }
  if (whole) d.peopleDone = true; // every area was asked; the atlas holds only finished institutions
  if (added || whole) fs.writeFileSync(f, JSON.stringify(d));
  if (added) console.log(`${u.short}: +${added} researchers (${d.people.length} in all), calls ${calls}`);
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`done: ${calls} new calls`);
