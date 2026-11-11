// Adds real co-author links between the researchers shown at each institution.
// For every shown researcher it asks OpenAlex who they co-wrote physics-related papers with
// (2017–2026, any number of authors, so big collaborations count) and keeps the links to other
// shown researchers at the same institution. Resumable: answers are cached, and it stops cleanly
// when the daily allowance runs out. Run: node scripts/fetch-links.mjs [slug ...]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { has, readJson, writeJson } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache', 'openalex');
const API = 'https://api.openalex.org';
const TYPES = 'type:article|review|preprint|conference-paper|letter|book-chapter';
const TOP_LINKS = 15; // strongest ties kept per researcher, so big collaborations stay readable

const levels = JSON.parse(fs.readFileSync(path.join(DATA, 'levels.json'), 'utf8'));
const SUBF = 'primary_topic.subfield.id:' + levels.meta.subfields.map((s) => s.id.slice(1)).join('|');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0, stopped = false;

async function get(url) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  { const c = readJson(file); if (c) return c; }
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    try { return JSON.parse(text); } catch (e) {
      // a write cut short by an interrupted run: keep the complete object at the start
      const at = Number((String(e.message).match(/position (\d+)/) || [])[1]);
      if (at) try { return JSON.parse(text.slice(0, at)); } catch {}
    }
  }
  if (stopped) return null;
  const key = process.env.OPENALEX_API_KEY || (fs.existsSync(path.join(ROOT, '.cache', 'openalex-key')) ? fs.readFileSync(path.join(ROOT, '.cache', 'openalex-key'), 'utf8').trim() : ''); // private, never published
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + url + (key ? '&api_key=' + key : ''), { headers: { 'User-Agent': 'research-atlas/1.0' } });
    if (res.status === 429) {
      const left = Number(res.headers.get('x-ratelimit-remaining') || 0);
      if (left <= 0 || attempt >= 2) { stopped = true; console.warn('daily allowance used up; rerun later to continue'); return null; }
      await sleep(2000 * (attempt + 1)); continue;
    }
    if (res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(res.status + ' ' + url);
    const json = await res.json();
    calls++;
    delete json.meta?.notice;
    writeJson(file, json);
    return json;
  }
  return null;
}

// Imperial first (the start page), then the biggest institutions.
const want = process.argv.slice(2);
const unis = levels.universities.slice().sort((a, b) => (b.slug === 'imperial') - (a.slug === 'imperial') || b.works - a.works)
  .filter((u) => !want.length || want.includes(u.slug));

for (const u of unis) {
  const f = path.join(DATA, 'u', u.slug + '.json');
  if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const shown = new Set(d.people.map((p) => p.id));
  const pairs = new Map(d.peopleLinks.map((l) => [[l.source, l.target].sort().join('|'), l.weight]));
  let done = 0;
  // TOP=n looks up only each area's n strongest researchers (others still link to them)
  const TOP = Number(process.env.TOP || 0);
  const byArea = new Map();
  for (const p of d.people) { if (!byArea.has(p.area)) byArea.set(p.area, []); byArea.get(p.area).push(p); }
  const look = TOP ? [...byArea.values()].flatMap((l) => l.sort((a, b) => (b.h || 0) - (a.h || 0) || b.papers - a.papers).slice(0, TOP)) : d.people;
  for (const p of look) {
    const r = await get(`/works?filter=author.id:${p.id},authorships.institutions.lineage:${u.id},publication_year:2017-2026,${SUBF},${TYPES}&group_by=authorships.author.id&per_page=200`);
    if (!r) break;
    done++;
    const ties = r.group_by.map((g) => ({ id: g.key.split('/').pop(), n: g.count })).filter((t) => t.id !== p.id && shown.has(t.id))
      .sort((a, b) => b.n - a.n).slice(0, TOP_LINKS);
    for (const t of ties) {
      const k = [p.id, t.id].sort().join('|');
      pairs.set(k, Math.max(pairs.get(k) || 0, t.n));
    }
  }
  if (done > 0) {
    d.peopleLinks = [...pairs].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; });
    // Areas are tied by the joint papers of their researchers.
    const areaOf = new Map(d.people.map((q) => [q.id, q.area]));
    const al = new Map(d.areaLinks.map((l) => [[l.source, l.target].sort().join('|'), l.weight]));
    const fromPeople = new Map();
    for (const l of d.peopleLinks) {
      const a = areaOf.get(l.source), b = areaOf.get(l.target);
      if (!a || !b || a === b) continue;
      const k = [a, b].sort().join('|');
      fromPeople.set(k, (fromPeople.get(k) || 0) + l.weight);
    }
    for (const [k, w] of fromPeople) al.set(k, Math.max(al.get(k) || 0, w));
    d.areaLinks = [...al].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; });
    const deg = new Map();
    for (const l of d.peopleLinks) for (const id of [l.source, l.target]) deg.set(id, (deg.get(id) || 0) + 1);
    d.people.forEach((p) => (p.degree = deg.get(p.id) || 0));
    d.linksComplete = done === d.people.length;
    d.linksLooked = Math.max(d.linksLooked || 0, done);
    fs.writeFileSync(f, JSON.stringify(d));
    console.log(`${u.short}: ${d.peopleLinks.length} links among ${d.people.length} researchers, ${done} looked up (calls so far ${calls})`);
  }
  if (stopped) break;
}
console.log(`done: ${calls} new calls`);
