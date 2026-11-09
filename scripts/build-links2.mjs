// Connections inside and beyond each institution, from the paper samples on disk (no lookups):
//   peopleLinks  co-authors inside the institution (kept as the larger of sampled and measured counts)
//   p.xt         a researcher's strongest co-authors at other institutions: name, institution, papers
//   area.xi      the institutions an area writes with most, outside its own
// Sources: .cache/samples (fetch-samples.mjs), earlier physics samples in .cache/openalex, and the
// per-researcher co-author lookups (fetch-links.mjs) for co-authors who are mapped elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compact } from './fetch-samples.mjs';
import { readJson, listCache } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache', 'openalex');
const SAMPLES = path.join(ROOT, '.cache', 'samples');
const atlas = JSON.parse(fs.readFileSync(path.join(DATA, 'atlas.json'), 'utf8'));
const physics = JSON.parse(fs.readFileSync(path.join(DATA, 'levels.json'), 'utf8'));
const held = new Map(atlas.universities.map((u) => [u.id, u]));
const files = new Map();
for (const u of atlas.universities) {
  const f = path.join(DATA, 'u', u.slug + '.json');
  if (fs.existsSync(f)) files.set(u.id, { u, f, d: JSON.parse(fs.readFileSync(f, 'utf8')) });
}
// who is mapped where
const where = new Map();
for (const { u, d } of files.values()) for (const p of d.people) if (!where.has(p.id)) where.set(p.id, { slug: u.slug, short: u.short, uid: u.id, area: p.area, name: p.name });

// ---- gather sampled works
// Kept lean: titles aren't needed, and on big collaborations only authors at mapped institutions count
// (outsiders on papers with over 40 of them are never named one by one).
const mappedIds = new Set(files.keys());
const slim = (w) => { w[3] = ''; if (w[5].length > 60) w[5] = w[5].filter((a) => a[2].some((x) => mappedIds.has(x))); return w; };
const works = new Map();
for (const f of listCache(SAMPLES)) {
  try { for (const w of readJson(path.join(SAMPLES, f)).works) if (!works.has(w[0])) works.set(w[0], slim(w)); } catch {}
}
let legacy = 0;
for (const f of listCache(CACHE)) {
  const j = readJson(path.join(CACHE, f));
  if (!j?.results?.[0]?.authorships || !String(j.results[0].id).startsWith('https://openalex.org/W')) continue;
  try { for (const w of j.results) if (!works.has(w.id.split('/').pop())) { works.set(w.id.split('/').pop(), slim(compact(w))); legacy++; } } catch {}
}
console.log('sampled papers', works.size, `(${legacy} from earlier physics samples)`);

// ---- per institution: insiders, their links and their outside co-authors
const acc = new Map(); // uid -> { pairs, ext: Map(pid -> Map(aid -> {n,name,inst,instName})), areaExt: Map(area -> Map(inst -> {n,name})) }
const A = (uid) => { if (!acc.has(uid)) acc.set(uid, { pairs: new Map(), ext: new Map(), areaExt: new Map() }); return acc.get(uid); };
const primaryInst = (au) => { const h = au[2].find((x) => held.has(x)); return h ? [h, held.get(h).name] : au[3][0] || [null, '']; };
for (const w of works.values()) {
  const authors = w[5];
  const insts = new Set(authors.flatMap((a) => a[2]).filter((x) => files.has(x)));
  for (const uid of insts) {
    const { d } = files.get(uid);
    d._ids ||= new Map(d.people.map((p) => [p.id, p]));
    const inside = authors.filter((a) => a[2].includes(uid)), outside = authors.filter((a) => !a[2].includes(uid));
    const mine = inside.map((a) => d._ids.get(a[0])).filter(Boolean);
    if (!mine.length) continue;
    const S = A(uid);
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) { const k = [mine[i].id, mine[j].id].sort().join('|'); S.pairs.set(k, (S.pairs.get(k) || 0) + 1); }
    if (outside.length > 40) continue; // huge collaborations: too many to name one by one
    const seenInst = new Set();
    for (const q of outside) {
      const [iid, iname] = primaryInst(q);
      for (const p of mine) {
        if (!S.ext.has(p.id)) S.ext.set(p.id, new Map());
        const e = S.ext.get(p.id), cur = e.get(q[0]) || { n: 0, name: q[1], inst: iid, instName: iname };
        cur.n++; e.set(q[0], cur);
      }
      if (iid && !seenInst.has(iid)) {
        seenInst.add(iid);
        for (const area of new Set(mine.map((p) => p.area))) {
          if (!S.areaExt.has(area)) S.areaExt.set(area, new Map());
          const m = S.areaExt.get(area), cur = m.get(iid) || { n: 0, name: iname };
          cur.n++; m.set(iid, cur);
        }
      }
    }
  }
}

// co-authors mapped at other institutions, from the per-researcher lookups
const SUBF = 'primary_topic.subfield.id:' + physics.meta.subfields.map((s) => s.id.slice(1)).join('|');
const TYPES = 'type:article|review|preprint|conference-paper|letter|book-chapter';
const cached = (url) => { const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json'); return readJson(f); };
let viaLookups = 0;
for (const [uid, { d }] of files) {
  for (const p of d.people) {
    for (const url of [
      `/works?filter=author.id:${p.id},authorships.institutions.lineage:${uid},publication_year:2017-2026,${SUBF},${TYPES}&group_by=authorships.author.id&per_page=200`,
      `/works?filter=author.id:${p.id},publication_year:2017-2026,${TYPES}&group_by=authorships.author.id&per_page=200`,
    ]) {
      const r = cached(url);
      if (!r) continue;
      for (const g of r.group_by) {
        const aid = String(g.key).split('/').pop(), w = where.get(aid);
        if (!w || w.uid === uid || aid === p.id) continue;
        const S = A(uid);
        if (!S.ext.has(p.id)) S.ext.set(p.id, new Map());
        const e = S.ext.get(p.id), cur = e.get(aid) || { n: 0, name: w.name, inst: w.uid, instName: held.get(w.uid).name };
        cur.n = Math.max(cur.n, g.count); e.set(aid, cur); viaLookups++;
      }
    }
  }
}

// ---- write back
let pl = 0, xt = 0;
for (const [uid, { d, f }] of files) {
  const S = acc.get(uid);
  delete d._ids;
  if (!S) continue;
  const pairs = new Map(d.peopleLinks.map((l) => [[l.source, l.target].sort().join('|'), l.weight]));
  for (const [k, n] of S.pairs) pairs.set(k, Math.max(pairs.get(k) || 0, n));
  d.peopleLinks = [...pairs].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; });
  pl += d.peopleLinks.length;
  // areas tied by their researchers' joint papers
  const areaOf = new Map(d.people.map((p) => [p.id, p.area]));
  const al = new Map(d.areaLinks.map((l) => [[l.source, l.target].sort().join('|'), l.weight]));
  const add = new Map();
  for (const l of d.peopleLinks) { const a = areaOf.get(l.source), b = areaOf.get(l.target); if (a && b && a !== b) { const k = [a, b].sort().join('|'); add.set(k, (add.get(k) || 0) + l.weight); } }
  for (const [k, w] of add) al.set(k, Math.max(al.get(k) || 0, w));
  d.areaLinks = [...al].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: w }; });
  const deg = new Map();
  for (const l of d.peopleLinks) for (const id of [l.source, l.target]) deg.set(id, (deg.get(id) || 0) + 1);
  for (const p of d.people) {
    p.degree = deg.get(p.id) || 0;
    const e = S.ext.get(p.id);
    // only co-authors the map can take you to: mapped people, or people at a held institution
    p.xt = e ? [...e].filter(([aid, v]) => { const w = where.get(aid); return (w && w.uid !== uid) || (held.has(v.inst) && v.inst !== uid); }).sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([aid, v]) => {
      const w = where.get(aid);
      return [aid, v.name, v.inst, v.instName, v.n, w && w.uid !== uid ? w.slug : null];
    }) : [];
    xt += p.xt.length;
  }
  for (const a of d.areas) {
    const m = S.areaExt.get(a.id);
    a.xi = m ? [...m].filter(([iid]) => iid !== uid && held.has(iid)).sort((x, y) => y[1].n - x[1].n).slice(0, 8).map(([iid, v]) => [iid, v.name, v.n, held.get(iid)?.slug || null]) : [];
  }
  fs.writeFileSync(f, JSON.stringify(d));
}
console.log(`institutions ${files.size}, links inside ${pl}, outside ties ${xt} (${viaLookups} from lookups)`);
