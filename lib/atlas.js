import { normalizeFilters } from './research-filters.mjs';
// The atlas's public face: shared state for the panel, loading, views and styles.
// The camera, navigation, focus, drawing and input live in their own modules (see README-architecture.md).
import { applyPhase, arrangeAround, buildDetail, buildWorld } from './model';
import { loadHeat, loadNet, loadQHeat, makePhase, phaseDetailData, phaseSig, phaseWorks, sigEst } from './phase';
import { FONTS, SKIN } from './theme';
import { fold } from './util';
import { P, clearMeasure } from './paint';
import { T, VP, W, ctx, fitCircle, flyTo, initCamera, sel } from './camera';
import { dirtyHash, go, readHash, setBooting } from './nav';
import { kick } from './loop';
import { settle } from './focus';
import { staleControls } from './draw';
import { initInput } from './input';

// ---------- shared state for the panel
export const listeners = new Set();
export let version = 0;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const getVersion = () => version;
// The controls over the map can change size after an update (React renders a moment later), so the
// label placer re-reads their boxes once they have settled.
export const notify = () => {
  version++; listeners.forEach((f) => f());
  if (typeof window !== 'undefined') setTimeout(() => { staleControls(); kick(); }, 80);
};

export const A = {
  ready: false, W: null, skin: SKIN, base: 'data', dark:true,
  view: { country: null, uni: null, area: null, person: null },
  sel: { country: null, uni: null, area: null, person: null },
  hover: null, panelHover: null, openMax: 0, PT: 0,
  phase: null, heat: null, lite: null, topics: null,
  researchMode: 'institutions', lastResearchMode:'career', net: null, netSel: null, netStatus: 'idle', netRequest: 0, modeChoice: 0,
};

export function level() {
  const v = A.view;
  if (v.person) return 'person';
  if (v.area) return 'district';
  if (v.uni) return v.uni.D >= 260 && v.uni.detail ? 'campus' : 'uni';
  if (v.country) return 'country';
  return 'world';
}

export const sk = () => A.skin;
export const hue = (fam) => sk().hue[fam] || sk().neutral;

// ---------- loading
export async function start({ stageEl, canvasEl, tipEl, base = 'data' }) {
  initAppearance();
  const ctx = canvasEl.getContext('2d');
  P.ctx = ctx; P.cvs = canvasEl; P.skin = A.skin;
  const [levels, topo] = await Promise.all([
    fetch(`${base}/atlas.json`).then((r) => { if (!r.ok) throw new Error('atlas.json ' + r.status); return r.json(); }),
    fetch(`${base}/world-110m.json`).then((r) => { if (!r.ok) throw new Error('world-110m.json ' + r.status); return r.json(); }),
  ]);
  A.base = base;
  A.W = buildWorld(levels, topo);
  P.projection = A.W.projection; P.period = A.W.period;
  A.phase = makePhase(A.W, 'general');
  applyPhase(A.W, A.phase, phaseWorks, null, sigOf, null);
  for (const u of A.W.unis) u.R = u.Rt;
  loadTopics();
  await Promise.race([
    Promise.all([`500 16px ${FONTS.serif}`, `400 16px ${FONTS.sans}`, `600 16px ${FONTS.sans}`, `500 16px ${FONTS.mono}`].map((f) => document.fonts.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  clearMeasure();
  for (const c of A.W.countries) { c.fw = 0; c.bloom = 0; c.open = 0; }
  for (const u of A.W.unis) { u.fw = 0; u.bloom = 0; u.open = 0; u.vis = 0; u.D = 0; u.g = 0; u.on = u.off ? 0 : 1; }
  initCamera({ stageEl, canvasEl, tipEl, ctx });
  initInput();
  A.ready = true;
  // dev-only hook for the screenshot checks
  if (process.env.NODE_ENV !== 'production') window.__atlas = { A, T: () => ({ k: T.k, x: T.x, y: T.y }), VP: () => VP };
  settling = true;
  setTimeout(() => (settling = false), 4000);
  await readHash(true);
  setBooting(false);
  notify();
  kick();
}

// An institution's inside for the current view. Researcher data (names, links) is fetched once, for the
// institutions where it has been measured; areas come from the topic mix in every view.
export function loadDetail(u) {
  const key = A.phase.kind === 'topic' ? 's' + A.phase.sub : A.phase.key;
  if (u.detail && u.detailKey === key) return Promise.resolve(u.detail);
  if (!u.raw && u.physDetail && !u.loading)
    u.loading = fetch(`${A.base}/u/${u.slug}.json`).then((r) => r.json()).then((d) => { u.raw = d; }).catch((e) => { console.warn(e); u.loading = null; });
  const wait = u.physDetail && !u.raw ? u.loading : Promise.resolve();
  return wait.then(() => {
    const k2 = A.phase.kind === 'topic' ? 's' + A.phase.sub : A.phase.key;
    let det = u.details.get(k2);
    if (!det) {
      det = buildDetail(u, phaseDetailData(A.W, u, A.phase, u.raw));
      for (const a of det.areas) { a.fw = 0; a.bloom = 0; a.open = 0; a.vis = 0; a.D = 0; a.g = 0; a.ts = 0; a.rs = 0; }
      u.details.set(k2, det);
    }
    u.detail = det; u.detailKey = k2;
    if (A.sel.uni === u && A.sel.person) arrangeAround(u.detail, A.sel.person);
    if (settling) settle();
    notify();
    kick();
    return u.detail;
  });
}

export function loadTopics() {
  if (A.topicsP) return A.topicsP;
  A.topicsP = fetch(`${A.base}/topics.json`).then((r) => r.json()).then((rows) => {
    A.topics = rows.map(([id, name, sub, works, kw]) => ({ id, name, sub, works, kw, n: fold(name + ' ' + kw) }));
    A.W.topicById = new Map(A.topics.map((t) => [t.id, t]));
    notify();
    return A.topics;
  });
  return A.topicsP;
}

// Switch view: resize everything, rebuild the open institution's inside and fetch the heat map.
export async function setPhase(key, opts = {}) {
  if (key && /^t\d+$/.test(key)) await loadTopics();
  const ph = makePhase(A.W, key);
  if (A.phase && ph.key === A.phase.key && !opts.force) return;
  A.phase = ph;
  A.researchMode = 'institutions'; A.net = null; A.netSel = null; A.netStatus = 'idle'; A.netRequest++;
  A.hover = A.panelHover = null;
  A.heat = null;
  A.lite = null;
  applyPhase(A.W, ph, phaseWorks, null, sigOf, null);
  for (const u of A.W.unis) { u.detail = null; u.detailKey = null; }
  const s = A.sel;
  const keep = { uni: A.view.uni || s.uni, area: A.view.area || s.area, person: A.view.person || s.person };
  if (keep.uni) {
    await loadDetail(keep.uni);
    if (A.phase !== ph) return;
    if (A.researchMode === 'institutions') {
      const d = keep.uni.detail;
      s.uni = keep.uni;
      s.area = keep.area && d.areaById.get(keep.area.id) || null;
      s.person = keep.person && d.personById.get(keep.person.id) || null;
      if (s.person) s.area = s.person.A;
      if (keep.area && !s.area) go('uni', keep.uni, { noPush: true });
    }
  }
  dirtyHash();
  notify(); kick();
  const [heat, q] = await Promise.all([loadHeat(A.base, A.W, ph), ph.kind === 'general' ? null : loadQHeat(A.base, ph)]);
  if (A.phase !== ph) return;
  A.heat = heat ? significanceHeat(heat, q) : null;
  if (A.heat) for (const e of A.heat) if (e.inst.x == null) [e.inst.x, e.inst.y] = A.W.projection([e.inst.lng, e.inst.lat]);
  applyPhase(A.W, ph, phaseWorks, heat, sigOf, q);
  notify(); kick();
}
// Researcher networks are opt-in and independent of the institutional heat-map loading.
export async function setResearchMode(mode, { navigate = true, retry = false } = {}) {
  mode = normalizeFilters(mode);
  if (A.phase?.kind !== 'subfield') mode = 'institutions';
  if (mode === A.researchMode && !retry) return;
  A.modeChoice++;
  const request = ++A.netRequest, ph = A.phase;
  if(mode!=='institutions')A.lastResearchMode=mode;
  A.researchMode = mode; A.net = null; A.netSel = null; A.hover = A.panelHover = null;
  A.netStatus = mode === 'institutions' ? 'idle' : 'loading';
  if (navigate) go('world', null, { instant: true });
  dirtyHash(); notify(); kick();
  if (mode === 'institutions') return;
  try {
    const net = await loadNet(A.base, A.W, ph, mode);
    if (request !== A.netRequest || ph !== A.phase) return;
    A.net = net; A.netStatus = net?.people.length ? 'ready' : 'empty';
  } catch {
    if (request !== A.netRequest || ph !== A.phase) return;
    A.netStatus = 'error';
  }
  notify(); kick();
}

// size and rank every view by significance (see phase.js)
export function sigOf(u, q) { return phaseSig(A.W, u, A.phase, q); }
// The heat map ranked by significance: measured highly cited papers where fetched, else estimated.
export function significanceHeat(heat, q) {
  const papers = new Map(heat.map((e) => [e.inst.id, e.n]));
  let rows;
  if (q) rows = q.rows.map((e) => ({ inst: e.inst, n: e.n, p: papers.get(e.inst.id) ?? null, est: false }));
  else rows = heat.map((e) => ({ inst: e.inst, n: sigEst(e.n, e.inst.mc, A.W.mcMed), p: e.n, est: true }));
  rows.sort((a, b) => b.n - a.n);
  const max = rows.length ? rows[0].n : 1;
  for (const r of rows) r.f = r.n / max;
  return rows;
}
export function showLite(inst) {
  A.lite = inst;
  if (inst.x == null) [inst.x, inst.y] = A.W.projection([inst.lng, inst.lat]);
  const held = A.W.uniById.get(inst.id);
  if (held) return go('uni', held);
  flyTo(fitCircle(inst.x, inst.y, 30, 0.9));
  notify();
}

export let peopleIndex = null;
export function loadPeopleIndex() {
  if (!peopleIndex) peopleIndex = fetch(`${A.base}/people.json`).then((r) => r.json()).then((rows) =>
    rows.map(([name, ui, area, id, papers]) => ({ name, n: fold(name), U: A.W.unis[ui], area, id, papers })));
  return peopleIndex;
}

function initAppearance() {
  P.skin = A.skin;
  try { localStorage.removeItem('atlas-style'); localStorage.removeItem('atlas-color-mode'); } catch {}
}
export function selectNet(p) { A.netSel = p; notify(); kick(); }
export function setPanelHover(h) { A.panelHover = h; kick(); }

// Jump straight to the resting state (first load, or a link opened directly).
export let settling = false;

// The panel and controls import everything from here.
export { go, goPerson, up } from './nav';
export { searchItems } from './search';
