// Prints an audit sheet: for one shard of institutions, a stratified sample of verify-people.mjs's
// decisions, each with the researcher's OpenAlex evidence in plain form, for a reviewer to judge.
// Run from app/: node scripts/audit-sheet.mjs <shard> <shards> [cases per institution]
import fs from 'node:fs';
import { readJson } from './cache.mjs';

const [shard, shards, per = 6] = process.argv.slice(2).map(Number);
const D = JSON.parse(fs.readFileSync('.cache/verify/decisions.json'));
const L = JSON.parse(fs.readFileSync('public/data/atlas.json'));
const name = new Map(L.universities.map((u) => [u.id, u.name]));
try { for (const r of JSON.parse(fs.readFileSync('public/data/heat/insts.json'))) if (!name.has(r[0])) name.set(r[0], r[1]); } catch {}
const slugName = new Map(L.universities.map((u) => [u.slug, u.name]));
const subName = new Map(L.subfields.map((s) => ['a' + s.id, s.name]));
const inst = (id) => name.get(id) || id;

// profiles, by id
const idx = JSON.parse(fs.readFileSync('.cache/authors/index.json'));
const want = new Set();
const slugs = Object.keys(D.bySlug).sort().filter((s, i) => i % shards === shard);
// deterministic sample: one per kind of decision, top-h keeps first, then the rest by a hash
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const picked = new Map();
for (const slug of slugs) {
  const list = D.bySlug[slug].slice().sort((a, b) => hash(a.id + slug) - hash(b.id + slug));
  const out = [], kinds = new Set();
  const topKeep = list.filter((d) => d.action === 'keep').sort((a, b) => (b.h || 0) - (a.h || 0))[0];
  if (topKeep) { out.push(topKeep); kinds.add('keep:' + topKeep.reason); }
  for (const d of list) { if (out.length >= per) break; const k = d.action + ':' + d.reason; if (!kinds.has(k)) { kinds.add(k); out.push(d); } }
  for (const d of list) { if (out.length >= per) break; if (!out.includes(d)) out.push(d); }
  picked.set(slug, out);
  for (const d of out) want.add(d.id);
}
const prof = new Map();
for (let i = 0; i < idx.batches && prof.size < want.size; i++) {
  const b = readJson(`.cache/authors/${i}.json`);
  if (b) for (const a of b.authors) if (want.has(a.id)) prof.set(a.id, a);
}

let n = 0;
console.log(`AUDIT SHEET shard ${shard + 1} of ${shards}: ${slugs.length} institutions`);
console.log(`Rules the script applied: ${JSON.stringify(D.rules)}\n`);
for (const slug of slugs) {
  console.log(`=== ${slugName.get(slug) || slug}  [${slug}]`);
  for (const d of picked.get(slug)) {
    const a = prof.get(d.id);
    n++;
    const dec = d.action === 'move' ? `MOVE to ${slugName.get(d.to)} / ${subName.get(d.toArea) || d.toArea}`
      : d.action === 'reassign' ? `CHANGE DEPARTMENT to ${subName.get(d.toArea) || d.toArea}` : d.action.toUpperCase();
    console.log(`\n#${n} case=${d.id}@${slug}  ${d.name}`);
    console.log(`   shown as: ${slugName.get(slug)} / department "${subName.get(d.area) || d.area}"`);
    console.log(`   decision: ${dec}   (reason: ${d.reason})`);
    if (!a) { console.log('   (no OpenAlex profile)'); continue; }
    const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => `${y}:${a.cy[y] || 0}`).join(' ');
    console.log(`   OpenAlex: ${a.wc} papers in career, h-index ${a.h}; papers per year ${years}`);
    console.log(`   last known institutions: ${a.lk.map((l) => inst(l[0])).join('; ') || '(none)'}`);
    const af = a.af.filter((x) => x.y.some((y) => y >= 2018)).sort((x, y) => Math.max(...y.y) - Math.max(...x.y));
    console.log(`   affiliations since 2018 (${af.length}):`);
    for (const x of af.slice(0, 12)) console.log(`     - ${inst(x.l[0])}${x.l.length > 1 ? ' (part of ' + inst(x.l[x.l.length - 1]) + ')' : ''} [${x.c}] years ${x.y.filter((y) => y >= 2018).sort().join(',')}`);
    if (af.length > 12) console.log(`     … and ${af.length - 12} more`);
    const tot = a.sf.reduce((s, [, c]) => s + c, 0) || 1;
    console.log(`   work by subfield (top topics): ${a.sf.slice(0, 5).map(([s, c]) => `${subName.get('a' + String(s).replace(/\D/g, '')) || s} ${Math.round((100 * c) / tot)}%`).join('; ')}`);
  }
  console.log('');
}
console.log(`END: ${n} cases`);
