// Views ("phases") of the atlas: all research, physics-related, one field, one subfield or one topic.
// A view decides how big each institution and country is, which research areas an institution
// opens into, and which heat map (where the work happens worldwide) is shown.
import { famOf } from './theme';
import { normalizeFilters, currentOpportunities, intersectNetworks } from './research-filters.mjs';

export function makePhase(W, key) {
  if (!key || key === 'general') return { key: 'general', kind: 'general', name: 'All research', short: 'All research' };
  if (key === 'physics') return { key, kind: 'physics', name: 'Physics-related research', short: 'Physics', subs: new Set(W.meta.physicsSubfields) };
  const m = key.match(/^([fst])(\d+)$/);
  if (!m) return makePhase(W, 'general');
  const [, k, id] = m;
  if (k === 'f') {
    const f = W.fieldById.get(id);
    if (!f) return makePhase(W, 'general');
    return { key, kind: 'field', id, name: f.name, short: f.name, fam: famOf(f.name), subs: new Set(W.subfieldList.filter((s) => s.field === id).map((s) => s.id)) };
  }
  if (k === 's') {
    const s = W.subfieldById.get(id);
    if (!s) return makePhase(W, 'general');
    return { key, kind: 'subfield', id, name: s.name, short: s.name, fam: famOf(W.fieldById.get(s.field)?.name), subs: new Set([id]) };
  }
  const tid = 'T' + id;
  const t = W.topicById?.get(tid);
  return { key, kind: 'topic', id: tid, name: t ? t.name : 'Topic ' + id, short: t ? t.name : 'Topic', fam: t ? famOf(W.fieldById.get(W.subfieldById.get(t.sub)?.field)?.name) : 'soc', sub: t?.sub, subs: new Set(t ? [t.sub] : []) };
}

// Papers in this view, 2017–26. Measured where we have it (all papers; physics from the API),
// otherwise estimated from the institution's topic mix scaled to its 2017–26 output.
export function phaseWorks(u, ph) {
  if (ph.kind === 'general') return u.works;
  if (ph.kind === 'physics' && u.physWorks != null) return u.physWorks;
  const scale = u.works / Math.max(1, u.worksAll);
  if (ph.kind === 'topic') return Math.round((u.topMap.get(ph.id) || 0) * scale);
  let n = 0;
  for (const [s, c] of u.subs) if (ph.subs.has(s)) n += c;
  return Math.round(n * scale);
}
export const isMeasured = (u, ph) => ph.kind === 'general' || (ph.kind === 'physics' && u.physWorks != null);

// The institution's research areas in this view (OpenAlex subfields), biggest first.
export function phaseAreas(W, u, ph, max = 18) {
  const scale = u.works / Math.max(1, u.worksAll);
  const list = u.subs.filter(([s]) => ph.kind === 'general' || ph.subs.has(s));
  return list.slice(0, max).map(([s, c]) => {
    const sf = W.subfieldById.get(s), f = W.fieldById.get(sf?.field);
    return { id: 'a' + s, name: sf ? sf.name : s, field: f ? f.name : '', works: Math.round(c * scale), researchersSeen: 0 };
  });
}

// Detail data for buildDetail in this view: areas from the topic mix, researchers where measured.
export function phaseDetailData(W, u, ph, raw) {
  // physics: the measured areas (2017–26 counts from the API), other views: the topic mix
  const areas = ph.kind === 'physics' && raw
    ? raw.areas.filter((a) => ph.subs.has(a.id.slice(1))).map((a) => ({ ...a }))
    : phaseAreas(W, u, ph);
  // departments added for a researcher the web check confirmed moved here (outside the 18 biggest)
  if (raw && ph.kind !== 'physics') for (const a of raw.areas) if (a.added && !areas.some((x) => x.id === a.id)) areas.push({ ...a });
  if (!raw) return { areas: [], areaLinks: [], people: [], peopleLinks: [], sampleWorks: 0 };
  const rawAreas = new Map(raw.areas.map((a) => [a.id, a]));
  for (const a of areas) {
    const r = rawAreas.get(a.id);
    if (r) { Object.assign(a, { ...r, name: a.name, field: a.field, works: Math.max(a.works, r.works) }); }
  }
  // only areas with researchers on the map: nothing opens onto an empty department
  const peopled = new Set(raw.people.map((p) => p.area));
  const shown = areas.filter((a) => peopled.has(a.id));
  const ids = new Set(shown.map((a) => a.id));
  const people = raw.people.filter((p) => ids.has(p.area));
  const pid = new Set(people.map((p) => p.id));
  return {
    areas: shown,
    areaLinks: raw.areaLinks.filter((l) => ids.has(l.source) && ids.has(l.target)),
    people,
    peopleLinks: raw.peopleLinks.filter((l) => pid.has(l.source) && pid.has(l.target)),
    sampleWorks: raw.sampleWorks,
  };
}

// Heat maps: every sizeable institution's papers in this view.
let instsP = null;
export function loadInsts(base) {
  if (!instsP) instsP = fetch(`${base}/heat/insts.json`).then((r) => r.json()).then((rows) =>
    rows.map(([id, name, cc, lat, lng, works, h, mc, exc, t]) => ({ id, name, cc, lat, lng, works, h, mc, exc, type: t })));
  return instsP;
}
const heatCache = new Map();
export async function loadHeat(base, W, ph) {
  if (ph.kind === 'general') return null;
  if (heatCache.has(ph.key)) return heatCache.get(ph.key);
  const insts = await loadInsts(base);
  const get = (p) => fetch(`${base}/heat/${p}.json`).then((r) => (r.ok ? r.json() : []));
  let rows;
  if (ph.kind === 'topic') rows = await get('t/' + ph.id);
  else if (ph.kind === 'field') rows = await get('f/' + ph.id);
  else {
    const parts = await Promise.all([...ph.subs].map((s) => get('s/' + s)));
    const m = new Map();
    for (const part of parts) for (const [i, n] of part) m.set(i, (m.get(i) || 0) + n);
    rows = [...m];
  }
  rows.sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  const heat = rows.map(([i, n]) => ({ inst: insts[i], n, f: n / max })).filter((e) => e.inst);
  heatCache.set(ph.key, heat);
  return heat;
}

// Significance, the atlas's lens: highly cited papers (2017–26 papers among the top 5% most cited in
// the scope). Measured where fetched; otherwise estimated from papers and recent citations per paper.
export const impactOf = (mc, med) => Math.min(4, Math.max(0.25, (mc || med) / med));
export const sigEst = (pw, mc, med) => Math.round(pw * 0.05 * impactOf(mc, med));
export const qKey = (ph) => (ph.kind === 'general' ? 'all' : ph.kind === 'physics' ? 'physics' : ph.kind === 'field' ? 'f' + ph.id : ph.kind === 'subfield' ? 's' + ph.id : 's' + ph.sub);
const qCache = new Map();
export async function loadQHeat(base, ph) {
  const key = qKey(ph);
  if (qCache.has(key)) return qCache.get(key);
  const insts = await loadInsts(base);
  const rows = await fetch(`${base}/heat/q/${key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let out = null;
  if (rows && rows.length) {
    const m = new Map();
    for (const [i, n] of rows) if (insts[i]) m.set(insts[i].id, n);
    out = { map: m, floor: Math.min(...rows.map((r) => r[1])), rows: rows.filter((r) => insts[r[0]]).map(([i, n]) => ({ inst: insts[i], n })) };
  }
  qCache.set(key, out);
  return out;
}
export function phaseSig(W, u, ph, q) {
  if (ph.kind === 'general' && u.hc != null) return { v: u.hc, measured: true };
  if (q && ph.kind !== 'topic') {
    if (q.map.has(u.id)) return { v: q.map.get(u.id), measured: true };
    return { v: Math.min(sigEst(u.pw, u.mc, W.mcMed), q.floor), measured: false };
  }
  return { v: sigEst(u.pw, u.mc, W.mcMed), measured: false };
}

// A subfield's world network: its most-cited researchers anywhere and who among them writes together.
const netCache = new Map();
export async function loadNet(base, W, ph, mode = 'career') {
  if (ph.kind !== 'subfield') return null;
  mode = normalizeFilters(mode);
  if (mode === 'institutions') return null;
  const today = new Date().toISOString().slice(0,10);
  if (mode.includes('+')) return intersectNetworks(await Promise.all(mode.split('+').map(f=>loadNet(base,W,ph,f))),mode);
  const key = mode + ':' + ph.id + (mode === 'open' ? ':' + today : '');
  if (netCache.has(key)) return netCache.get(key);
  const response = await fetch(`${base}/${mode === 'career' ? 'net' : mode}/s${ph.id}.json`);
  if (response.status === 404) { if(mode==='open')throw new Error('Recruitment evidence unavailable'); return null; }
  if (!response.ok) throw new Error('Researcher network unavailable');
  const raw = await response.json();
  if (!Array.isArray(raw.people) || !Array.isArray(raw.links)) throw new Error('Invalid researcher data');
  const insts = await loadInsts(base), byId = new Map(insts.map((x) => [x.id, x])), seen = new Map();
  const rows = mode === 'open' ? raw.people.map(p=>({...p,opportunities:currentOpportunities(p,today)})).filter(p=>p.opportunities.length) : raw.people;
  const people = rows.map((row) => {
    const p = Array.isArray(row) ? Object.fromEntries(['id','name','iid','iname','cc','h','cites'].map((k,i)=>[k,row[i]])) : row;
    const held = W.uniById.get(p.iid), inst = byId.get(p.iid), C = W.countryById.get(p.cc);
    const precise = Number.isFinite(p.lng) && Number.isFinite(p.lat);
    const ll = precise ? [p.lng, p.lat] : held ? [held.lng, held.lat] : inst ? [inst.lng, inst.lat] : C ? [C.lng, C.lat] : null;
    const n = seen.get(p.iid || p.cc) || 0; seen.set(p.iid || p.cc, n + 1);
    const [x, y] = ll ? W.projection(ll) : [null, null];
    return { ...p, score: mode === 'career' ? p.h : mode === 'open' ? (p.opportunities.some(o=>o.evidence==='advertised')?2:1) : p.score, x, y, lng: ll?.[0], lat: ll?.[1],
      locationApproximate: !precise && !held && !inst && !!C, j: n, held };
  });
  const links = raw.links.map(([a,b,n]) => ({kind:'netl', a:people[a], b:people[b], n})).filter(l=>l.a&&l.b);
  const net = {people, links, mode, meta: mode === 'open' ? {...raw.meta, reviewed:raw.people.length, current:people.length, expired:raw.people.length-people.length, evaluatedAt:today} : raw.meta || null, insts:new Set(people.map(p=>p.iid))};
  netCache.set(key, net); return net;
}
