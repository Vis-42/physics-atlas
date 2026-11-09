// Checks every researcher placement on the map against the researcher's own OpenAlex profile
// (fetched by fetch-authors.mjs) and decides what to do. Dry run: writes .cache/verify/decisions.json
// and a summary; apply-people.mjs carries the decisions out.
//
// Rules, in order, for a researcher placed at institution X in research area A:
//  1. gone      OpenAlex no longer has the profile (merged into another)                 → remove
//  2. merged    the profile mixes many people (OpenAlex sometimes fuses everyone with a common name):
//               MERGED_ROOTS+ unrelated organisations since 2024 AND at least MERGED_RATE new
//               organisations per recent paper (big-collaboration physicists have many organisations
//               but far more papers)                                                      → remove
//  3. inactive  fewer than ACTIVE_MIN papers in ACTIVE_FROM onwards                       → remove
//  4. home      where they are now: map institutions (and their parent bodies) among their latest-year
//               and "last known" affiliations. One home per researcher: among current places, where
//               they are already shown; if shown at several, the most specific, then the smaller.
//     left      no current affiliation on the map at all                                → remove
//     moved     X is not their home: removed from X; if they are not already shown at their home,
//               they are moved there, into the area that fits their work (if it has one)
//  5. area      at home, A must be a real part of their work: at least AREA_MIN of their topic papers
//               in that subfield, or their main subfield. Otherwise they move to the area at X that
//               fits best (if it reaches AREA_MIN); with no fitting area and no papers in A → remove.
// Run from app/: node scripts/verify-people.mjs
import fs from 'node:fs';
import { readJson, writeJson } from './cache.mjs';

const ACTIVE_FROM = 2024, ACTIVE_MIN = 2;
const MERGED_ROOTS = 20, MERGED_RATE = 0.4; // organisations since 2024, and organisations per recent paper
const BROKEN_WORKS = 2000, BROKEN_RATIO = 40; // career papers, and papers per point of h-index
const AREA_MIN = 0.2, AREA_MIN_WEAK = 0.1;
const LK_BONUS = 0.75; // OpenAlex's "last known" just follows the latest paper, so it only tips a balance

const L = JSON.parse(fs.readFileSync('public/data/atlas.json'));
const atlas = new Map(L.universities.map((u) => [u.id, u]));
const slugOf = new Map(L.universities.map((u) => [u.slug, u]));

// profiles
const prof = new Map(), missing = new Set();
const idx = JSON.parse(fs.readFileSync('.cache/authors/index.json'));
let absentBatches = 0;
for (let i = 0; i < idx.batches; i++) {
  const b = readJson(`.cache/authors/${i}.json`);
  if (!b) { absentBatches++; continue; }
  for (const a of b.authors) prof.set(a.id, a);
  for (const m of b.missing) missing.add(m);
}
if (absentBatches) console.warn(`warning: ${absentBatches} batches not fetched yet; their researchers are left unchanged`);

// placements
const inst = new Map(); // slug -> { u, data }
const placements = new Map(); // author id -> [{ slug, area, p }]
for (const f of fs.readdirSync('public/data/u')) {
  const slug = f.replace('.json', ''), data = JSON.parse(fs.readFileSync('public/data/u/' + f));
  // departments the site can show here: the institution's 18 biggest subfields (the general view) and
  // its measured areas (the physics view)
  const u0 = slugOf.get(slug);
  inst.set(slug, { u: u0, data, areas: new Set([...data.areas.map((a) => a.id), ...(u0?.subs || []).slice(0, 18).map(([s]) => 'a' + s)]) });
  for (const p of data.people) {
    if (!placements.has(p.id)) placements.set(p.id, []);
    placements.get(p.id).push({ slug, area: p.area, p });
  }
}

const mapInst = (lineage) => { for (const id of lineage) if (atlas.has(id)) return atlas.get(id); return null; }; // most specific
const sub = (s) => 'a' + String(s).replace(/\D/g, ''); // 'subfields/3106' -> 'a3106' (the map's area ids)
const shares = (a) => { const t = a.sf.reduce((s, [, n]) => s + n, 0) || 1; return new Map(a.sf.map(([s, n]) => [sub(s), n / t])); };
function bestArea(slug, sh) {
  let best = null, bs = 0;
  for (const aid of inst.get(slug).areas) { const v = sh.get(aid) || 0; if (v > bs) { bs = v; best = aid; } }
  return [best, bs];
}

const decisions = [];
const tally = {};
const add = (d) => { decisions.push(d); tally[d.action + ':' + d.reason] = (tally[d.action + ':' + d.reason] || 0) + 1; };
for (const [id, list] of placements) {
  const a = prof.get(id);
  const base = (pl) => ({ id, name: pl.p.name, slug: pl.slug, area: pl.area, h: pl.p.h });
  if (!a) {
    for (const pl of list) add({ ...base(pl), action: missing.has(id) ? 'remove' : 'keep', reason: missing.has(id) ? 'gone' : 'unchecked' });
    continue;
  }
  const recent = Object.entries(a.cy).filter(([y]) => +y >= ACTIVE_FROM).reduce((s, [, n]) => s + n, 0);
  const maxY = Math.max(0, ...a.af.flatMap((x) => x.y));
  const roots = new Set(a.af.filter((x) => x.y.some((y) => y >= ACTIVE_FROM)).map((x) => x.l[x.l.length - 1]));
  // How strongly an affiliation says "works here now": the latest years weigh most, and a long run of
  // years counts (one 2026 co-authorship elsewhere must not outweigh a home held every year).
  const affStrength = (x) => 2 * x.y.includes(maxY) + x.y.includes(maxY - 1) + 0.5 * x.y.includes(maxY - 2) + 0.15 * Math.min(10, x.y.length);
  const ev = { recent, maxY, roots: roots.size, lk: a.lk.map((l) => l[0]), sf: a.sf.slice(0, 4), wc: a.wc };
  // also a profile no single career could produce: thousands of papers with a low h-index
  const broken = a.wc > BROKEN_WORKS && a.wc / Math.max(1, a.h || 0) > BROKEN_RATIO;
  if (broken || (roots.size >= MERGED_ROOTS && roots.size / Math.max(1, recent) >= MERGED_RATE)) { for (const pl of list) add({ ...base(pl), action: 'remove', reason: 'merged', ev }); continue; }
  if (recent < ACTIVE_MIN) { for (const pl of list) add({ ...base(pl), action: 'remove', reason: 'inactive', ev }); continue; }
  // where they are now: every map institution in the lineage of a latest-year or last-known affiliation
  // (IOP is part of CAS: both count), with how specific the match is (0 = the institution itself)
  const cur = new Map(); // atlas inst -> { spec, strength }
  const note = (l, strength) => l.forEach((id, i) => {
    const u = atlas.get(id); if (!u) return;
    // an institution's strength is its strongest single affiliation (a parent academy must not add up
    // the strength of all its institutes), plus the "last known" bonus once
    const c = cur.get(u) || { spec: 99, strength: 0, lk: 0 };
    if (strength === 'lk') c.lk = LK_BONUS; else c.strength = Math.max(c.strength, strength);
    cur.set(u, { spec: Math.min(c.spec, i), strength: c.strength, lk: c.lk });
  });
  // recent years weigh most; a long run of years breaks ties (one 2026 co-authorship elsewhere does not
  // outrank a long-standing home); "last known" is OpenAlex's own reading of their latest papers
  for (const x of a.af) if (x.y.some((y) => y >= maxY - 1))
    note(x.l, affStrength(x));
  for (const l of a.lk) note(l, 'lk');
  for (const c of cur.values()) c.strength += c.lk;
  const placedAt = new Set(list.map((pl) => pl.slug));
  // Several current places are concurrent appointments, not a career move: keep the researcher where
  // they are already shown, and if shown at several, at the most specific (an institute rather than its
  // parent academy, a hospital rather than the university system), then the smaller institution.
  // Only places about as strong as the strongest are in the running; among those, prefer where they are
  // shown, then the most specific, then the smaller institution.
  const maxS = Math.max(0, ...[...cur.values()].map((c) => c.strength));
  // their strongest affiliation anywhere, on the map or not: if it is clearly stronger than anything on
  // the map, their real home is elsewhere and a stray recent paper doesn't keep them here
  const lkRoots = new Set(a.lk.map((l) => l[l.length - 1]));
  let allBest = 0;
  for (const x of a.af) if (x.y.some((y) => y >= maxY - 1)) {
    const st = affStrength(x) + (lkRoots.has(x.l[x.l.length - 1]) ? LK_BONUS : 0);
    allBest = Math.max(allBest, st);
  }
  ev.offMap = +(allBest - maxS).toFixed(1);
  if (cur.size && allBest - maxS > 1) { for (const pl of list) add({ ...base(pl), action: 'remove', reason: 'home-off-map', ev }); continue; }
  const ranked = [...cur].filter(([, c]) => c.strength >= maxS - 1).sort((x, y) => (placedAt.has(y[0].slug) - placedAt.has(x[0].slug))
    || (Math.abs(y[1].strength - x[1].strength) > 0.3 ? y[1].strength - x[1].strength : 0)
    || (x[1].spec - y[1].spec) || ((x[0].works || 0) - (y[0].works || 0)) || (y[1].strength - x[1].strength));
  const home = ranked.length ? ranked[0][0] : null;
  ev.home = home && home.slug; ev.current = ranked.map(([u]) => u.slug);
  const sh = shares(a);
  if (!home) {
    // no affiliation data at all: nothing to go on, leave as is
    if (!a.af.length && !a.lk.length) { for (const pl of list) add({ ...base(pl), action: 'keep', reason: 'no-affiliations', ev }); continue; }
    for (const pl of list) add({ ...base(pl), action: 'remove', reason: 'left', ev });
    continue;
  }
  const homePl = list.find((pl) => pl.slug === home.slug);
  for (const pl of list) {
    if (pl.slug === home.slug) continue;
    if (homePl || !inst.has(home.slug)) { add({ ...base(pl), action: 'remove', reason: homePl ? 'duplicate' : 'left', ev }); continue; }
    // not shown at their current home yet: move them there once (the first placement carries over)
    if (pl !== list.find((q) => q.slug !== home.slug)) { add({ ...base(pl), action: 'remove', reason: 'duplicate', ev }); continue; }
    const [to, s] = bestArea(home.slug, sh);
    if (to && s >= AREA_MIN) add({ ...base(pl), action: 'move', reason: 'moved', to: home.slug, toArea: to, ev });
    else add({ ...base(pl), action: 'remove', reason: 'moved-no-area', to: home.slug, ev });
  }
  if (homePl) {
    const s = sh.get(homePl.area) || 0, top = a.sf.length ? sub(a.sf[0][0]) : null;
    if (s >= AREA_MIN || top === homePl.area) add({ ...base(homePl), action: 'keep', reason: 'ok', ev });
    else {
      const [to, bs] = bestArea(home.slug, sh);
      // the department that fits best among those the site can show here; a weak fit stays only when
      // nothing fits better; removal only when no department here carries a tenth of their work
      if (to && to !== homePl.area && bs > s && bs >= AREA_MIN_WEAK) add({ ...base(homePl), action: 'reassign', reason: 'wrong-area', toArea: to, ev: { ...ev, share: +s.toFixed(2), toShare: +bs.toFixed(2) } });
      else if (s >= AREA_MIN_WEAK) add({ ...base(homePl), action: 'keep', reason: 'weak-area', ev: { ...ev, share: +s.toFixed(2) } });
      else add({ ...base(homePl), action: 'remove', reason: 'off-field', ev });
    }
  }
}

fs.mkdirSync('.cache/verify', { recursive: true });
const bySlug = {};
for (const d of decisions) (bySlug[d.slug] ||= []).push(d);
fs.writeFileSync('.cache/verify/decisions.json', JSON.stringify({ rules: { ACTIVE_FROM, ACTIVE_MIN, MERGED_ROOTS, MERGED_RATE, BROKEN_WORKS, BROKEN_RATIO, AREA_MIN, AREA_MIN_WEAK }, tally, bySlug }));
// per-institution files for the auditors
fs.mkdirSync('.cache/verify/by-inst', { recursive: true });
for (const [slug, list] of Object.entries(bySlug)) fs.writeFileSync(`.cache/verify/by-inst/${slug}.json`, JSON.stringify(list));
console.log(`${placements.size} researchers, ${decisions.length} placements`);
for (const [k, v] of Object.entries(tally).sort((x, y) => y[1] - x[1])) console.log(k.padEnd(26), v);
