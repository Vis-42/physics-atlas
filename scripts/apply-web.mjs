// Applies the web cross-check (subagents searching faculty pages, ORCID, news) to the researcher files.
// Uses only local data: the web verdicts in .cache/verify/web/result-*.jsonl, the cached OpenAlex profiles
// (for subfield mix, no new lookups) and the pre-verification backup (to restore wrongly removed people).
//   retired / deceased / left academia / wrong person      → removed
//   moved: to an institution on the map                    → moved there, into their best-fitting department
//          to one not on the map                           → removed
//   field wrong                                            → best-fitting department at the same place
//   list B (people we moved or removed) found still at the old place → restored there
// Run from app/: node scripts/apply-web.mjs [--dry]   (then build-analysis.mjs? no: build-index.mjs)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readJson } from './cache.mjs';

const DRY = process.argv.includes('--dry');
const L = JSON.parse(fs.readFileSync('public/data/atlas.json'));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(the|of|and|at|de|la|le|der|du)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const unis = L.universities.map((u) => ({ u, n: fold(u.name), s: fold(u.short) }));
function findInst(name) {
  const f = fold(name);
  if (!f) return null;
  let hit = unis.find((x) => x.n === f || x.s === f);
  if (hit) return hit.u;
  // "Stanford University School of Medicine" → Stanford University; longest map name contained in it
  hit = unis.filter((x) => x.n.length > 6 && (f.includes(x.n) || x.n.includes(f))).sort((a, b) => b.n.length - a.n.length)[0];
  return hit ? hit.u : null;
}

// web verdicts
const res = [];
// Only verdicts backed by an actual web search with a specific page count (not answers from memory, not a
// bare homepage). Later files (checked-*.jsonl, the strict re-run) override earlier ones for the same person.
const specific = (u) => { try { const x = new URL(u); return x.pathname.replace(/\/+$/, '').length > 1 || x.search.length > 1; } catch { return false; } };
const byKey = new Map();
const files0 = fs.readdirSync('.cache/verify/web').filter((f) => /^(result|checked)-[\w-]+\.jsonl$/.test(f)).sort((x, y) => (x.startsWith('checked') - y.startsWith('checked')) || x.localeCompare(y));
for (const f of files0)
  for (const l of fs.readFileSync('.cache/verify/web/' + f, 'utf8').split('\n')) {
    let r; try { if (!l.trim()) continue; r = JSON.parse(l); } catch { continue; }
    if (r.searched !== true || !specific(r.source)) continue;
    byKey.set(r.id + ':' + r.list, r);
  }
res.push(...byKey.values());
const lists = [];
for (const f of fs.readdirSync('.cache/verify/web').filter((f) => /^list-\d+\.json$/.test(f))) lists.push(...JSON.parse(fs.readFileSync('.cache/verify/web/' + f)));
const entry = new Map(lists.map((e) => [e.id + ':' + e.list, e]));

// researcher files, and where each person is now
const files = new Map();
for (const f of fs.readdirSync('public/data/u')) files.set(f.replace('.json', ''), JSON.parse(fs.readFileSync('public/data/u/' + f)));
const where = new Map();
for (const [slug, d] of files) for (const p of d.people) where.set(p.id, slug);
const slugOfName = new Map(L.universities.map((u) => [u.name, u.slug]));

// subfield mix from the cached profiles
const want = new Set(res.map((r) => r.id)), prof = new Map();
const idx = JSON.parse(fs.readFileSync('.cache/authors/index.json'));
for (let i = 0; i < idx.batches && prof.size < want.size; i++) { const b = readJson(`.cache/authors/${i}.json`); if (b) for (const a of b.authors) if (want.has(a.id)) prof.set(a.id, a); }
const sub = (s) => 'a' + String(s).replace(/\D/g, '');
function bestArea(slug, id) {
  const a = prof.get(id), u = L.universities.find((x) => x.slug === slug);
  if (!a || !u) return null;
  const valid = new Set([...files.get(slug).areas.map((x) => x.id), ...(u.subs || []).slice(0, 18).map(([s]) => 'a' + s)]);
  const tot = a.sf.reduce((s, [, n]) => s + n, 0) || 1;
  let best = null, bs = 0;
  for (const [s, n] of a.sf) { const id2 = sub(s); if (valid.has(id2) && n / tot > bs) { bs = n / tot; best = id2; } }
  return bs >= 0.1 ? best : null;
}
let backup = null;
function fromBackup(slug, id) {
  if (!backup) backup = new Map();
  if (!backup.has(slug)) {
    try { backup.set(slug, JSON.parse(execFileSync('tar', ['xzf', '../backups/people-before-verify-2026-11-08.tgz', '-O', `public/data/u/${slug}.json`], { maxBuffer: 1 << 28 }))); }
    catch { backup.set(slug, null); }
  }
  return backup.get(slug)?.people.find((p) => p.id === id) || null;
}

const log = [], stats = {};
const tally = (k) => (stats[k] = (stats[k] || 0) + 1);
const remove = (id, why) => { const s = where.get(id); if (!s) return; const d = files.get(s); d.people = d.people.filter((p) => p.id !== id); where.delete(id); tally('removed:' + why); log.push(`remove ${id} @${s} (${why})`); };
const move = (id, to, why) => {
  const s = where.get(id); if (!s || s === to) return;
  const area = bestArea(to, id);
  if (!area) return remove(id, why + ', no fitting department at ' + to);
  const d = files.get(s), p = d.people.find((q) => q.id === id);
  d.people = d.people.filter((q) => q.id !== id);
  files.get(to).people.push({ ...p, area, areas: [area, ...(p.areas || []).filter((a) => a !== area)], sug: [], degree: 0, movedFrom: true, web: true });
  where.set(id, to); tally('moved'); log.push(`move ${id} @${s} → ${to}/${area} (${why})`);
};
const unmatched = [];
for (const r of res) {
  const e = entry.get(r.id + ':' + r.list) || {};
  const v = r.verdict;
  if (r.list === 'A') {
    if (['emeritus-or-retired', 'deceased', 'left-academia', 'wrong-person'].includes(v)) remove(r.id, v);
    else if (v === 'moved') {
      const u = findInst(r.currentInstitution);
      if (u && u.name === e.shownAt) { tally('moved-but-same-place'); continue; }
      if (u) move(r.id, u.slug, 'web: now at ' + r.currentInstitution);
      else { unmatched.push(`${r.name}: ${r.currentInstitution}`); remove(r.id, 'moved off the map'); }
    } else if (v === 'correct' && r.fieldOk === false) {
      const s = where.get(r.id), a = s && bestArea(s, r.id), p = s && files.get(s).people.find((q) => q.id === r.id);
      if (p && a && a !== p.area) { p.area = a; p.areas = [a, ...(p.areas || []).filter((x) => x !== a)]; tally('department-fixed'); log.push(`department ${r.id} @${s} → ${a}`); }
      else tally('field-flag-no-better-department');
    } else tally('A:' + v);
  } else {
    // list B: were we right to move/remove them?
    const now = r.currentInstitution ? findInst(r.currentInstitution) : null;
    const was = slugOfName.get(e.wasShownAt);
    if (v === 'correct') { tally('B:decision-confirmed'); continue; }
    if (['emeritus-or-retired', 'deceased', 'left-academia'].includes(v)) { remove(r.id, v); tally('B:confirmed-gone'); continue; }
    if (now && now.slug === was && !where.has(r.id)) {
      const p = fromBackup(was, r.id);
      if (p) { files.get(was).people.push({ ...p, sug: [], degree: 0, web: true }); where.set(r.id, was); tally('B:restored'); log.push(`restore ${r.id} @${was} (web: still there)`); }
    } else if (now && now.slug === was && where.has(r.id)) move(r.id, was, 'web: still at ' + now.name);
    else if (now && where.has(r.id) && where.get(r.id) !== now.slug) move(r.id, now.slug, 'web: now at ' + now.name);
    else tally('B:' + v + (now ? '' : '-not-on-map'));
  }
}
if (!DRY) {
  for (const [slug, d] of files) {
    const here = new Set(d.people.map((p) => p.id));
    d.peopleLinks = d.peopleLinks.filter((l) => here.has(l.source) && here.has(l.target));
    for (const p of d.people) p.sug = (p.sug || []).filter(([q]) => here.has(q));
    fs.writeFileSync('public/data/u/' + slug + '.json', JSON.stringify(d));
  }
  fs.writeFileSync('.cache/verify/web/applied.log', log.join('\n'));
}
console.log(`${res.length} web verdicts`, stats);
if (unmatched.length) console.log('moved to places not on the map (removed):\n  ' + unmatched.slice(0, 30).join('\n  '));
