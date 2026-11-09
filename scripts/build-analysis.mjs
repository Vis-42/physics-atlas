// Finds researchers who work on the same things but have not written together.
// Each researcher's fingerprint is their top OpenAlex topics (from their profile, or from the papers
// sampled for them). Similarity is the cosine of those fingerprints. For every researcher it stores
// the closest unconnected people at the same institution (sug) and at other institutions (sugx).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
// every held institution (atlas.json), falling back to the physics list
const levels = JSON.parse(fs.readFileSync(path.join(DATA, fs.existsSync(path.join(DATA, 'atlas.json')) ? 'atlas.json' : 'levels.json'), 'utf8'));
const files = levels.universities.map((u) => ({ u, f: path.join(DATA, 'u', u.slug + '.json') })).filter((x) => fs.existsSync(x.f));
const docs = files.map(({ u, f }) => ({ u, f, d: JSON.parse(fs.readFileSync(f, 'utf8')) }));

const all = [];
for (const { u, d } of docs) {
  const linked = new Set(d.peopleLinks.map((l) => [l.source, l.target].sort().join('|')));
  for (const p of d.people) {
    p.sug = []; p.sugx = [];
    if (!p.tv || p.tv.length < 3) continue; // too little to compare
    const v = new Map(p.tv.map(([t, n]) => [t, Math.log1p(n)]));
    const norm = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
    for (const [t, x] of v) v.set(t, x / norm);
    all.push({ p, u, v, linked, w: p.h ?? p.papers });
  }
}
// topic → strongest researchers in it (capped so very common topics stay tractable)
const byTopic = new Map();
for (const r of all) for (const [t, x] of r.v) { if (!byTopic.has(t)) byTopic.set(t, []); byTopic.get(t).push([r, x]); }
for (const [t, l] of byTopic) byTopic.set(t, l.sort((a, b) => b[1] - a[1]).slice(0, 400));

let pairs = 0;
for (const r of all) {
  const score = new Map();
  for (const [t, x] of r.v) for (const [o, y] of byTopic.get(t) || []) if (o !== r) score.set(o, (score.get(o) || 0) + x * y);
  const near = [...score].filter(([o]) => !(o.u === r.u && r.linked.has([r.p.id, o.p.id].sort().join('|'))));
  near.sort((a, b) => b[1] - a[1] || b[0].w - a[0].w);
  r.p.sug = near.filter(([o, s]) => o.u === r.u && s >= 0.35).slice(0, 5).map(([o, s]) => [o.p.id, +s.toFixed(2)]);
  r.p.sugx = near.filter(([o, s]) => o.u !== r.u && s >= 0.5).slice(0, 5).map(([o, s]) => [o.p.id, o.u.slug, o.p.name, o.u.short, +s.toFixed(2)]);
  pairs += r.p.sug.length + r.p.sugx.length;
}
for (const { f, d } of docs) fs.writeFileSync(f, JSON.stringify(d));
console.log('researchers with fingerprints', all.length, 'suggested pairs', pairs);
