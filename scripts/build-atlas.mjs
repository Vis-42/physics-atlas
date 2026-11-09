// Builds the all-fields atlas from the OpenAlex snapshot (free bulk download, no daily limit):
//   public/data/atlas.json      countries, held institutions (by output, by impact, physics), topic mix
//   public/data/topics.json     every OpenAlex field, subfield and topic, for search and views
//   public/data/heat/insts.json every sizeable research institution (for topic heat maps)
//   public/data/heat/{t,s,f}/<id>.json  where each topic / subfield / field is worked on
// Inputs: .cache/snapshot/{institutions,countries,topics} (see download step in README of this script's
// sibling fetch-snapshot.sh) and public/data/levels.json (the measured physics layer from the API).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { geoArea, geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import { urls as apiUrls, cachedPath } from './fetch-heat.mjs';
import { has } from './cache.mjs';
import { readJson } from './cache.mjs';

// Exact counts from the OpenAlex API (fetch-heat.mjs), where fetched: papers only, 2017–26.
const api = (url) => { const f = cachedPath(url); try { const j = readJson(f); return j ? j.group_by.map((g) => [String(g.key).split('/').pop(), g.count]) : null; } catch { return null; } };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = path.join(ROOT, '.cache', 'snapshot');
const QF = path.join(ROOT, '.cache', 'quality.json');
const quality = fs.existsSync(QF) ? JSON.parse(fs.readFileSync(QF, 'utf8')) : null;
const OUT = path.join(ROOT, 'public', 'data');
// The institutions to hold, by quality score (fetch-elite.mjs). Until every one of them is fully mapped
// the published atlas stays as it is and the list is only staged, in .cache/atlas-next.json.
const SEL = path.join(ROOT, '.cache', 'selection.json');
const selection = fs.existsSync(SEL) ? JSON.parse(fs.readFileSync(SEL, 'utf8')) : null;
const scored = new Map((selection?.held || []).map((h) => [h.id, h]));
const STATE = path.join(ROOT, '.cache', 'atlas-state');
const tail = (s) => String(s || '').split('/').pop();
const Y0 = 2017, Y1 = 2026;

async function* records(entity) {
  const dir = path.join(SNAP, entity);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.gz')).sort()) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) if (line) yield JSON.parse(line);
  }
}

// ---- topics, subfields, fields
const fields = new Map(), subfields = new Map(), topics = new Map();
for await (const t of records('topics')) {
  const fid = tail(t.field?.id), sid = tail(t.subfield?.id);
  if (!fields.has(fid)) fields.set(fid, { id: fid, name: t.field.display_name, domain: t.domain?.display_name, works: 0 });
  if (!subfields.has(sid)) subfields.set(sid, { id: sid, name: t.subfield.display_name, field: fid, works: 0 });
  topics.set(tail(t.id), { id: tail(t.id), name: t.display_name, sub: sid, works: t.works_count || 0, kw: (t.keywords || []).slice(0, 6).map((k) => k.display_name) });
  subfields.get(sid).works += t.works_count || 0;
  fields.get(fid).works += t.works_count || 0;
}
const topicList = [...topics.values()];
const topicIdx = new Map(topicList.map((t, i) => [t.id, i]));
console.log('topics', topics.size, 'subfields', subfields.size, 'fields', fields.size);

// ---- countries
const countryMeta = new Map();
for await (const c of records('countries')) countryMeta.set(c.country_code, { id: c.country_code, name: c.display_name, iso: String(c.numeric ?? '').padStart(3, '0'), worksAll: c.works_count || 0, cites: c.cited_by_count || 0, continent: c.continent?.display_name || '' });

// ---- institutions
const KEEP = new Set(['education', 'facility', 'nonprofit', 'government', 'healthcare', 'company']);
const NOT_RESEARCH = /Foundation|Trust\b|Council|Ministry|Agency|Fund\b|Association|Society$| System$|NHS|Department of/;
const insts = [];
for await (const r of records('institutions')) {
  if (!KEEP.has(r.type) || !r.country_code || !r.geo || r.geo.latitude == null) continue;
  const cby = new Map((r.counts_by_year || []).map((y) => [y.year, y.works_count]));
  let w10 = 0;
  for (let y = Y0; y <= Y1; y++) w10 += cby.get(y) || 0;
  if (w10 < 1000 && !scored.has(tail(r.id))) continue;
  const ss = r.summary_stats || {};
  insts.push({
    id: tail(r.id), name: r.display_name, acr: (r.display_name_acronyms || [])[0] || '', cc: r.country_code, type: r.type,
    city: r.geo.city || '', lat: r.geo.latitude, lng: r.geo.longitude, works: w10, worksAll: r.works_count || 0, cites: r.cited_by_count || 0,
    h: ss.h_index || 0, mc: ss['2yr_mean_citedness'] || 0, top: ((r.lineage || []).length <= 1 && !r.is_super_system) || scored.has(tail(r.id)),
    research: !NOT_RESEARCH.test(r.display_name),
    topics: (r.topics || []).map((t) => [topicIdx.get(tail(t.id)), t.count]).filter((x) => x[0] != null),
  });
}
console.log('institutions with 1,000+ papers', insts.length);

// Impact relative to size: residual of log h-index against log output, nudged by recent citations per paper.
const cand = insts.filter((x) => x.top && x.research && x.type !== 'company' && x.type !== 'healthcare' && x.worksAll >= 3000 && x.h >= 250);
{
  const X = cand.map((x) => Math.log(x.worksAll)), Y = cand.map((x) => Math.log(x.h));
  const mx = X.reduce((a, b) => a + b) / X.length, my = Y.reduce((a, b) => a + b) / Y.length;
  const b = X.reduce((s, x, i) => s + (x - mx) * (Y[i] - my), 0) / X.reduce((s, x) => s + (x - mx) ** 2, 0), a = my - b * mx;
  const lm = cand.map((x) => Math.log(Math.min(x.mc, 15) + 0.5)), m = lm.reduce((s, v) => s + v) / lm.length;
  const sd = Math.sqrt(lm.reduce((s, v) => s + (v - m) ** 2, 0) / lm.length);
  cand.forEach((x, i) => (x.exc = Math.log(x.h) - (a + b * X[i]) + 0.25 * (lm[i] - m) / sd));
  const sorted = cand.slice().sort((p, q) => q.exc - p.exc);
  sorted.forEach((x, i) => (x.excRank = i + 1, x.excPct = 1 - i / sorted.length));
}

// ---- which institutions the map holds
const physics = JSON.parse(fs.readFileSync(path.join(OUT, 'levels.json'), 'utf8'));
const physById = new Map(physics.universities.map((u) => [u.id, u]));
const byId = new Map(insts.map((x) => [x.id, x]));
const held = new Map();
const hold = (x, why) => { if (!x) return; if (!held.has(x.id)) held.set(x.id, { x, why: new Set() }); held.get(x.id).why.add(why); };
if (selection) for (const h of selection.held) hold(byId.get(h.id), 'quality');
else {
for (const u of physics.universities) hold(byId.get(u.id), 'physics');
// biggest research countries by output, their biggest institutions
const ccWorks = new Map();
for (const x of insts) if (x.top) ccWorks.set(x.cc, (ccWorks.get(x.cc) || 0) + x.works);
const bigCountries = [...ccWorks].sort((a, b) => b[1] - a[1]).slice(0, 30).map((x) => x[0]);
for (const cc of bigCountries) insts.filter((x) => x.cc === cc && x.top && x.research && x.type === 'education').sort((a, b) => b.works - a.works).slice(0, 5).forEach((x) => hold(x, 'output'));
// islands of excellence: the strongest anywhere, and each country's strongest
cand.slice().sort((a, b) => b.exc - a.exc).slice(0, 70).forEach((x) => hold(x, 'impact'));
const bestIn = new Map();
for (const x of cand) if (x.exc > 0.25 && (!bestIn.has(x.cc) || bestIn.get(x.cc).exc < x.exc)) bestIn.set(x.cc, x);
for (const x of bestIn.values()) hold(x, 'impact');
}
console.log('held institutions', held.size);

// ---- countries on the map
const topo = JSON.parse(fs.readFileSync(path.join(OUT, 'world-110m.json'), 'utf8'));
const geoByIso = new Map(feature(topo, topo.objects.countries).features.map((f) => [String(f.id).padStart(3, '0'), f]));
const centroid = (f) => {
  const g = f.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates.map((p) => ({ type: 'Polygon', coordinates: p })) : [g];
  return geoCentroid(polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a)));
};
const physC = new Map(physics.countries.map((c) => [c.id, c]));
const countryIds = new Set([...held.values()].map((h) => h.x.cc));
const apiCountry = (() => { const g = api(apiUrls.countries()); return g ? new Map(g) : null; })();
const countries = [...countryIds].map((cc) => {
  const m = countryMeta.get(cc) || { id: cc, name: cc, iso: '', worksAll: 0, cites: 0 };
  const f = geoByIso.get(m.iso);
  let lng, lat;
  if (physC.has(cc)) ({ lng, lat } = physC.get(cc));
  else if (f) [lng, lat] = centroid(f);
  else { const hs = [...held.values()].filter((h) => h.x.cc === cc); lat = hs.reduce((s, h) => s + h.x.lat, 0) / hs.length; lng = hs.reduce((s, h) => s + h.x.lng, 0) / hs.length; }
  // Country output = papers by its independent institutions, 2017–26 (the country-level totals in the
  // snapshot also count data files, which inflate some countries by millions).
  const top = insts.filter((x) => x.cc === cc && x.top);
  return {
    id: cc, name: m.name, iso: m.iso, lat: +lat.toFixed(3), lng: +lng.toFixed(3), continent: m.continent,
    works: apiCountry?.get(cc) ?? top.reduce((s, x) => s + x.works, 0), worksAll: m.worksAll, cites: m.cites, worksExact: apiCountry?.has(cc) || false,
    physWorks: physC.get(cc)?.works ?? null, hc: quality?.countries?.[cc] ?? null,
    instCount: insts.filter((x) => x.cc === cc).length,
    universities: [...held.values()].filter((h) => h.x.cc === cc).map((h) => h.x.id),
  };
}).sort((a, b) => b.works - a.works);

// ---- held institutions
const SHORT = Object.fromEntries(physics.universities.map((u) => [u.id, u.short]));
const NAMES = {
  'European Organization for Nuclear Research': 'CERN', 'Weizmann Institute of Science': 'Weizmann', 'Collaborative Innovation Center of Chemistry for Energy Materials': 'iChEM',
  'Austrian Academy of Sciences': 'Austrian Academy', 'Institute for Health Metrics and Evaluation': 'IHME', 'King Abdullah University of Science and Technology': 'KAUST',
  'Howard Hughes Medical Institute': 'HHMI', 'European Molecular Biology Laboratory': 'EMBL', 'Singapore Eye Research Institute': 'Singapore Eye Research',
  'Institute for Basic Science': 'IBS Korea', 'Kavli Institute for the Physics and Mathematics of the Universe': 'Kavli IPMU', 'Francis Crick Institute': 'Crick Institute',
  'Okinawa Institute of Science and Technology Graduate University': 'OIST', 'Institute of Science and Technology Austria': 'ISTA', 'Technion – Israel Institute of Technology': 'Technion',
  'Hebrew University of Jerusalem': 'Hebrew University', 'Walter and Eliza Hall Institute of Medical Research': 'WEHI', 'Friedrich Miescher Institute for Biomedical Research': 'FMI Basel',
  'Barcelona Institute for Science and Technology': 'BIST', 'Cold Spring Harbor Laboratory': 'Cold Spring Harbor', 'Scottish Universities Physics Alliance': 'SUPA',
  'Inter-University Centre for Astronomy and Astrophysics': 'IUCAA', 'Harvard–MIT Division of Health Sciences and Technology': 'Harvard–MIT HST',
};
const shortName = (x) => {
  if (SHORT[x.id]) return SHORT[x.id];
  if (NAMES[x.name]) return NAMES[x.name];
  let s = x.name.replace(/^The /, '');
  let m = s.match(/^University of (.+)$/); if (m && m[1].length < 22) return m[1].replace(/,.*$/, '');
  m = s.match(/^(.+) University$/); if (m && m[1].length < 22) return m[1];
  if (s.length <= 26) return s;
  if (x.acr && x.acr.length <= 7) return x.acr;
  let out = '';
  for (const w of s.split(' ')) { if ((out + ' ' + w).trim().length > 24) break; out = (out + ' ' + w).trim(); }
  return out.replace(/ (of|for|and|the|de|des|la|du)$/i, '') + '…';
};
const used = new Set(physics.universities.map((u) => u.slug));
// what is on the map for an institution: the subfields with researchers
function mapOf(slug) {
  const f = path.join(OUT, 'u', slug + '.json');
  if (!fs.existsSync(f)) return { mapped: [], done: false };
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { mapped: [...new Set(d.people.map((p) => p.area.slice(1)))], done: !!d.peopleDone };
}
const universities = [...held.values()].map(({ x, why }) => {
  const p = physById.get(x.id);
  let slug = p?.slug;
  if (!slug) {
    slug = shortName(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || x.id.toLowerCase();
    if (used.has(slug) || countryIds.has(slug.toUpperCase())) slug += '-' + x.cc.toLowerCase();
    used.add(slug);
  }
  const aSubs = api(apiUrls.instSubs(x.id)), aTops = api(apiUrls.instTops(x.id));
  const exact = !!(aSubs && aTops);
  const works = exact ? aSubs.reduce((s, [, n]) => s + n, 0) : x.works;
  return {
    id: x.id, name: x.name, short: shortName(x), slug, city: p?.city || x.city, lat: x.lat, lng: x.lng, country: x.cc, type: x.type,
    works, worksAll: exact ? works : x.worksAll, exact, citations: x.cites, h: x.h, mc: +x.mc.toFixed(2),
    hc: quality?.inst?.[x.id] ?? null,
    q: scored.get(x.id)?.Q ?? null, qRank: scored.get(x.id)?.rank ?? null, eliteS: scored.get(x.id)?.s ?? null, eliteB: scored.get(x.id)?.b ?? null, ...mapOf(slug),
    exc: x.exc != null ? +x.exc.toFixed(3) : null, excRank: x.excRank ?? null, excPct: x.excPct != null ? +x.excPct.toFixed(3) : null,
    why: [...why],
    // topic and subfield mix: exact 2017–26 papers from the API, else the snapshot's top topics (all-time)
    tops: exact ? aTops : x.topics.map(([ti, n]) => [topicList[ti].id, n]),
    subs: exact ? aSubs : [...x.topics.reduce((m, [ti, n]) => m.set(topicList[ti].sub, (m.get(topicList[ti].sub) || 0) + n), new Map())].sort((a, b) => b[1] - a[1]),
    physWorks: p?.works ?? null, physFields: p?.fields ?? null, physDetail: !!p || fs.existsSync(path.join(OUT, 'u', slug + '.json')),
  };
});

// held only when fully mapped: researchers fetched and every area's papers sampled
let toMap = 0;
if (selection) {
  const out = [];
  for (const u of universities) {
    const finished = u.done && u.subs.slice(0, 14).every(([sid]) => has(path.join(ROOT, '.cache', 'samples', `${u.id}-${sid}.json`)));
    if (!finished) toMap++;
    if (u.done && !u.mapped.length) { console.log('no researchers found, not held:', u.name); continue; }
    out.push(u);
  }
  universities.splice(0, universities.length, ...out);
  const kept = new Set(out.map((u) => u.id));
  for (const c of countries) c.universities = c.universities.filter((id) => kept.has(id));
  countries.splice(0, countries.length, ...countries.filter((c) => c.universities.length));
  // the gold ring: the top quarter by elite papers per paper written
  const rate = (u) => (u.eliteS + u.eliteB / 10) / Math.max(u.works, 1000);
  const cut = out.map(rate).sort((x, y) => y - x)[Math.floor(out.length / 4)];
  for (const u of out) if (rate(u) >= cut) u.why.push('impact');
}
for (const u of universities) delete u.done;

const atlas = {
  meta: {
    source: 'OpenAlex', snapshot: 'OpenAlex snapshot (CC0), institutions as of ' + new Date().toISOString().slice(0, 10), years: `${Y0}–${Y1}`,
    focus: physics.meta.focus, checked: physics.meta.checked, physicsSubfields: physics.meta.subfields.map((s) => s.id.slice(1)), excTotal: cand.length,
    qScored: selection?.scored ?? null, eliteAt: selection?.thr ?? null,
    note: selection ? `Institutions held by quality score: elite papers (the world's roughly 50,000 most-cited papers of ${Y0}–${Y1}, ${selection.thr}+ citations; papers with over 100 authors count a tenth) divided by the square root of its papers in thousands, times its h-index over 100. The world's top 240 are held, then, with a score of at least 25, the top 5 in each country with 200+ elite papers, the top 10 in each field by its own highly cited papers and the top 3 in each subfield by those papers for their size.` : 'Institutions held: the five biggest universities in each of the 30 biggest research countries, the 70 institutions with the highest impact for their size worldwide plus each country’s strongest, and the 103 physics institutions with measured researcher data. Impact for size: how far an institution’s h-index sits above what its output would predict, nudged by its recent citations per paper.',
  },
  fields: [...fields.values()].map((f) => ({ id: f.id, name: f.name, domain: f.domain })),
  subfields: [...subfields.values()].map((s) => ({ id: s.id, name: s.name, field: s.field })),
  countries, universities,
  countryNames: Object.fromEntries([...countryMeta].map(([k, v]) => [k, v.name])),
  countryLinks: physics.countryLinks, uniLinks: physics.uniLinks,
  // all-fields co-authorship (fetch-general-links.mjs), when fetched
  ...(fs.existsSync(path.join(OUT, 'glinks.json')) ? (({ uniLinks, countryLinks }) => {
    // shared highly cited papers for each pair of institutions, where measured
    const sh = new Map();
    for (const [a, list] of Object.entries(quality?.shared || {})) for (const [b, n] of list) { const k = [a, b].sort().join('|'); sh.set(k, Math.max(sh.get(k) || 0, n)); }
    return { genUniLinks: uniLinks.map((l) => ({ ...l, hq: sh.get([l.source, l.target].sort().join('|')) ?? null })), genCountryLinks: countryLinks };
  })(JSON.parse(fs.readFileSync(path.join(OUT, 'glinks.json'), 'utf8'))) : {}),
  quality: quality ? { thresholds: quality.thr, measured: true } : { measured: false },
};
fs.writeFileSync(path.join(ROOT, '.cache', 'atlas-next.json'), JSON.stringify(atlas));
fs.writeFileSync(STATE, selection && toMap ? 'staged' : 'ready');
if (selection && toMap) console.log(`staged ${universities.length} institutions; ${toMap} still to map, published atlas unchanged`);
else {
  fs.writeFileSync(path.join(OUT, 'atlas.json'), JSON.stringify(atlas));
  if (selection) {
    // institutions no longer held leave the published site; kept in the cache in case they return
    const keep = new Set(universities.map((u) => u.slug + '.json')), gone = path.join(ROOT, '.cache', 'dropped-u');
    fs.mkdirSync(gone, { recursive: true });
    for (const f of fs.readdirSync(path.join(OUT, 'u'))) if (!keep.has(f)) fs.renameSync(path.join(OUT, 'u', f), path.join(gone, f));
  }
}
fs.writeFileSync(path.join(OUT, 'topics.json'), JSON.stringify(topicList.map((t) => [t.id, t.name, t.sub, t.works, t.kw.join('; ')])));

// ---- heat maps: where each topic, subfield and field is worked on
const heatInsts = insts.filter((x) => x.top);
const hidx = new Map(heatInsts.map((x, i) => [x.id, i]));
fs.mkdirSync(path.join(OUT, 'heat', 't'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'heat', 's'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'heat', 'f'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'heat', 'insts.json'), JSON.stringify(heatInsts.map((x) => [x.id, x.name, x.cc, +x.lat.toFixed(3), +x.lng.toFixed(3), x.works, x.h, +x.mc.toFixed(2), x.exc != null ? +x.exc.toFixed(2) : null, x.type[0]])));
const bucket = { t: new Map(), s: new Map(), f: new Map() };
const add = (m, k, i, n) => { if (!m.has(k)) m.set(k, new Map()); const e = m.get(k); e.set(i, (e.get(i) || 0) + n); };
// fields and subfields: exact API counts (top 200 institutions each), where fetched
const apiSub = new Map(), apiFloor = new Map();
for (const [kind, list, url] of [['s', [...subfields.keys()], apiUrls.sub], ['f', [...fields.keys()], apiUrls.field]])
  for (const id of list) {
    const g = api(url(id));
    if (!g) continue;
    const m = new Map();
    for (const [iid, n] of g) { const i = hidx.get(iid); if (i != null) { add(bucket[kind], id, i, n); m.set(i, n); } }
    if (kind === 's') { apiSub.set(id, m); apiFloor.set(id, g.length >= 200 ? g[g.length - 1][1] : 0); }
  }
// topics: exact for held institutions; otherwise the snapshot's topic counts, capped by the exact
// subfield count so data-file records can't inflate them
const heldTops = new Map(universities.filter((u) => u.exact).map((u) => [u.id, u.tops]));
heatInsts.forEach((x, i) => {
  if (heldTops.has(x.id)) { for (const [tid, n] of heldTops.get(x.id)) if (topics.has(tid)) add(bucket.t, tid, i, n); return; }
  const scale = x.works / Math.max(1, x.worksAll);
  for (const [ti, n] of x.topics) {
    const t = topicList[ti], s = subfields.get(t.sub);
    let c = Math.round(n * scale);
    const m = apiSub.get(s.id);
    if (m) c = Math.min(c, m.has(i) ? m.get(i) : apiFloor.get(s.id));
    if (c > 0) add(bucket.t, t.id, i, c);
    if (!m) { add(bucket.s, s.id, i, c); }
    if (!bucket.f.has(s.field) || !api(apiUrls.field(s.field))) add(bucket.f, s.field, i, c);
  }
});
// quality heat: highly cited papers per institution, per scope (all, physics, each field and subfield)
if (quality) {
  fs.mkdirSync(path.join(OUT, 'heat', 'q'), { recursive: true });
  for (const [key, g] of Object.entries(quality.heat)) {
    const rows = g.map(([iid, n]) => [hidx.get(iid), n]).filter((r) => r[0] != null);
    fs.writeFileSync(path.join(OUT, 'heat', 'q', key + '.json'), JSON.stringify(rows));
  }
}
let files = 0;
for (const [k, m] of Object.entries(bucket))
  for (const [id, e] of m) {
    fs.writeFileSync(path.join(OUT, 'heat', k, id + '.json'), JSON.stringify([...e].sort((a, b) => b[1] - a[1]).slice(0, 600)));
    files++;
  }
console.log('heat institutions', heatInsts.length, 'heat files', files, 'countries', countries.length);
