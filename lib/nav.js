// Navigation: going to a place, the address bar, and keeping both in step with what is in view.
import { arrangeAround } from './model';
import { A, loadDetail, notify, setPhase, setResearchMode } from './atlas';
import { cam, dragging, flight, flyTo } from './camera';
import { kick } from './loop';
import { hideTip } from './input';

export const START = 'world';
export let pushNext = false, hashTimer = 0;
export let hashSeen = '', hashPending = '';
// A view change the address hasn't caught up with yet (a flight ended, the view switched).
export function dirtyHash() { hashSeen = '~'; }
export let booting = true;
export function setBooting(v) { booting = v; }

// ---------- navigation
export function go(kind, item, opts = {}) {
  hideTip(); A.hover = null;
  if (kind !== 'world' && A.researchMode !== 'institutions') setResearchMode('institutions', {navigate:false});
  if (kind !== 'world' && !(kind === 'country' && A.lite && A.lite.cc === item.id)) A.lite = null;
  const s = A.sel;
  if (kind === 'world') { s.country = s.uni = s.area = s.person = null; }
  else if (kind === 'country') { s.country = item; s.uni = s.area = s.person = null; }
  else if (kind === 'uni') { s.country = item.C; s.uni = item; s.area = s.person = null; loadDetail(item); }
  else if (kind === 'area') { s.uni = item.U; s.country = item.U.C; s.area = item; s.person = null; }
  else if (kind === 'person') { s.uni = item.U; s.country = item.U.C; s.area = item.A; s.person = item; }
  for (const u of A.W.unis) if (u.detail) arrangeAround(u.detail, u === s.uni ? s.person : null);
  pushNext = !opts.noPush;
  const t = kind === 'world' ? cam.world() : kind === 'country' ? cam.country(item) : kind === 'uni' ? cam.uni(item) : cam.area(kind === 'area' ? item : item.A);
  flyTo(t, opts.instant);
}
export async function goPerson(row) {
  const d = await loadDetail(row.U);
  const p = d && d.personById.get(row.id);
  if (p) go('person', p);
}
export function up() {
  const v = A.view;
  if (v.person) go('area', v.person.A);
  else if (v.area) go('uni', v.area.U);
  else if (v.uni) go('country', v.uni.C);
  else if (v.country) go('world');
}
let navigationRequest = 0;
export async function readHash(instant) {
  const request = ++navigationRequest;
  let raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const mode = raw.match(/~((?:career|frontier|open)(?:\+(?:career|frontier|open))*)$/)?.[1] || 'institutions';
  raw = raw.replace(/~((?:career|frontier|open)(?:\+(?:career|frontier|open))*)$/, '');
  // A view prefix ("physics:", "f31:", "s3106:", "t10048:") picks the view; no prefix is all research.
  const pm = raw.match(/^(physics|general|[fst]\d+):(.*)$/);
  const phaseKey = pm ? pm[1] : 'general';
  if (pm) raw = pm[2];
  if (!A.phase || A.phase.key !== phaseKey) {
    const choice = A.modeChoice;
    await setPhase(phaseKey);
    if (A.modeChoice !== choice) return;
  }
  if (request !== navigationRequest) return;
  await setResearchMode(mode, {navigate:false});
  if (request !== navigationRequest) return;
  let parts = raw.split('/').filter(Boolean);
  // Open the full world by default; explicit entity links retain their destinations.
  if (!parts.length) parts = (pm ? 'world' : START).split('/');
  if (parts[0] === 'world') return go('world', null, { noPush: true, instant });
  const W0 = A.W;
  const c = parts[0] && W0.countries.find((x) => x.slug === parts[0]);
  if (c) return go('country', c, { noPush: true, instant });
  const u = parts[0] && W0.unis.find((x) => x.slug === parts[0]);
  if (!u) return go('world', null, { noPush: true, instant });
  if (parts.length < 2) return go('uni', u, { noPush: true, instant });
  const d = await loadDetail(u);
  if (request !== navigationRequest) return;
  // An area this view doesn't have falls back to the closest one in the same OpenAlex field.
  const a = d && (d.areaById.get(parts[1]) || d.areas.find((x) => x.id.slice(0, 3) === parts[1].slice(0, 3)));
  if (!a) return go('uni', u, { noPush: true, instant });
  const p = parts[2] && d.personById.get(parts[2]);
  if (p && p.A === a) return go('person', p, { noPush: true, instant });
  return go('area', a, { noPush: true, instant });
}
export function onHash() { if (location.hash !== hashSeen) readHash(false); }
// Keep the address and the panel in step with what is in view.
export function syncView(next) {
  if (flight || booting) return; // the first view is still loading: leave the address as given
  const pre = A.phase && A.phase.key !== 'general' ? A.phase.key + ':' : '';
  const h = '#' + pre + (next.uni ? (next.area ? next.uni.slug + '/' + next.area.id + (next.person ? '/' + next.person.id : '') : next.uni.slug) : next.country ? next.country.slug : 'world') + (A.researchMode !== 'institutions' ? '~' + A.researchMode : '');
  const v = A.view;
  const same = v.country === next.country && v.uni === next.uni && v.area === next.area && v.person === next.person;
  if (h === hashSeen && same) { hashPending = ''; clearTimeout(hashTimer); return; }
  if (h === hashPending) return;
  hashPending = h;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    hashPending = '';
    if (flight) return;
    A.view = next;
    hashSeen = h;
    const s = A.sel;
    if (s.person && next.person !== s.person) { s.person = null; if (s.uni && s.uni.detail) arrangeAround(s.uni.detail, null); }
    if (s.area && next.area !== s.area) s.area = null;
    if (s.uni && next.uni !== s.uni) s.uni = null;
    if (s.country && next.country !== s.country) s.country = null;
    try {
      const startView = !location.hash && h === '#' + START;
      if (location.hash !== h && !startView) {
        const url = h;
        if (pushNext) history.pushState(null, '', url); else history.replaceState(null, '', url);
      }
    } catch {}
    pushNext = false;
    notify(); kick();
  }, dragging ? 160 : 60);
}
