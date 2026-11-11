// Pointer, keyboard and tooltips.
import { select } from 'd3-selection';
import { YEARS } from './theme';
import { fmt } from './util';
import { hitTest } from './paint';
import { A, selectNet, setSkin, showLite } from './atlas';
import { VP, cvs, dragging, flight, reduced, sel, tip, wz, zoomer, kExtent } from './camera';
import { go, goPerson, onHash, up } from './nav';
import { kick } from './loop';

export function onKey(e) {
  if (e.target?.closest?.('dialog[open]') || (e.target && /input|textarea|select/i.test(e.target.tagName))) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  zoomer.scaleExtent(kExtent());
  const centre = [VP.x + VP.w / 2, VP.y + VP.h / 2], dur = reduced ? 0 : 250;
  if (e.key === '1' || e.key === '2' || e.key === '3') setSkin({ 1: 'a', 2: 'b', 3: 'c' }[e.key]);
  else if (e.key === 'Backspace') { up(); e.preventDefault(); } // Escape only closes menus
  else if (e.key === '/') { document.getElementById('q')?.focus(); e.preventDefault(); }
  else if (e.key === '+' || e.key === '=') zoomer.scaleBy(sel.transition().duration(dur), 1.6, centre);
  else if (e.key === '-' || e.key === '_') zoomer.scaleBy(sel.transition().duration(dur), 1 / 1.6, centre);
}

// ---------- pointer
export function setHover(h) {
  if ((h && h.item) !== (A.hover && A.hover.item)) { A.hover = h; kick(); }
}
export function onMove(e) {
  if (dragging || flight || wz) return;
  if (e.pointerType && e.pointerType !== 'mouse') return; // no hover tooltips on touch screens
  const r = cvs.getBoundingClientRect(), h = hitTest(e.clientX - r.left, e.clientY - r.top);
  setHover(h);
  cvs.classList.toggle('hot', !!h);
  if (h) showTip(h, e.clientX, e.clientY); else hideTip();
}
export function onClick(e) {
  const r = cvs.getBoundingClientRect(), h = hitTest(e.clientX - r.left, e.clientY - r.top);
  if (!h) return;
  const it = h.item, v = A.view;
  switch (h.kind) {
    case 'country': return go('country', it);
    case 'uni': return go('uni', it);
    case 'area': return go('area', it);
    case 'person': return go('person', it);
    case 'exit': return go('uni', it.u);
    case 'croad': return go('country', v.country === it.a ? it.b : it.a);
    case 'uroad': return go('uni', v.uni === it.a ? it.b : it.a);
    case 'xcroad': return go('country', it.C);
    case 'aroad': return go('area', v.area === it.a ? it.b : it.a);
    case 'proad': return go('person', A.sel.person === it.a ? it.b : it.a);
    case 'xroad': return go('area', it.B);
    case 'hinst': return showLite({ ...it.inst, n: it.n });
    case 'ghost': {
      if (it.kind === 'in') return go('person', it.q);
      const U = it.slug ? A.W.unis.find((x) => x.slug === it.slug) : A.W.uniById.get(it.uid);
      if (U && it.slug) return goPerson({ U, id: it.aid });
      if (U) return go('uni', U);
      return;
    }
    case 'aexit': { const U = A.W.uniById.get(it.uid); if (U) go('uni', U); return; }
    case 'netp': return selectNet(it);
  }
}
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function tipHtml(h) {
  const it = h.item, m = (n) => `<span class="m">${fmt(n)}</span>`;
  if (h.analysis) return `<b>${esc(it.name)}</b><br>${esc(h.analysis)}`;
  switch (h.kind) {
    case 'country': return `<b>${esc(it.name)}</b><br>${m(it.sig)} highly cited · ${m(it.pw)} papers, ${YEARS}${A.phase.kind === 'general' ? '' : ' · ' + esc(A.phase.short)}`;
    case 'uni': return `<b>${esc(it.name)}</b><br>${esc(it.city)} · ${m(it.sig)} highly cited${it.sigM ? '' : ' (est.)'} · ${m(it.pw)} papers, ${YEARS}${A.phase.kind === 'general' ? '' : ' · ' + esc(A.phase.short)}<br>h-index ${m(it.h)}${it.excellent ? ' · centre of excellence' : ''}`;
    case 'hinst': return `<b>${esc(it.inst.name)}</b><br>${m(it.n)} highly cited papers${it.est ? ' (est.)' : ''}${it.p != null ? ' · ' + m(it.p) + ' papers' : ''} in ${esc(A.phase.short)} · h-index ${m(it.inst.h)}`;
    case 'ghost': return it.kind === 'in' ? `<b>${esc(it.q.name)}</b><br>${esc(it.q.A.name)} · ${m(it.w)} joint papers` : `<b>${esc(it.name)}</b><br>${esc(it.iname || 'another institution')} · ${m(it.w)} joint papers${it.slug ? '' : A.W.uniById.get(it.uid) ? '' : ' · not mapped yet'}`;
    case 'aexit': return `<b>${esc(it.name)}</b><br>${m(it.n)} joint papers in the sample with this area`;
    case 'netp': return `<b>${esc(it.name)}</b><br>${esc(it.iname)}${it.locationApproximate ? ' (country-level location)' : ''}<br>${A.researchMode.includes('frontier') ? m(it.score) + ' recent top-10% papers · ' + m(it.recentPapers) + ' subfield papers in the last 12 months' : A.researchMode.includes('career') ? 'career h-index ' + m(it.h) + ' · ' + m(it.cites) + ' career citations' : 'Explicit recruitment evidence · select to inspect sources'}`;
    case 'netl': return `<b>${esc(it.a.name)} × ${esc(it.b.name)}</b><br>${m(it.n)} shared papers in the collaboration sample`;
    case 'area': return `<b>${esc(it.name)}</b><br>${m(it.works)} papers · ${m(it.researchersSeen)} researchers seen`;
    case 'person': return `<b>${esc(it.name)}</b><br>${it.h ? 'h-index ' + m(it.h) + ' · ' : ''}${m(it.papers)} papers in the sample · ${esc(it.A.name)}`;
    case 'exit': return `<b>${esc(it.u.name)}</b><br>${m(it.r.w)} shared papers with ${esc(it.from.short)}`;
    case 'croad': case 'uroad': return `<b>${esc(it.a.short || it.a.name)} × ${esc(it.b.short || it.b.name)}</b><br>${m(it.w)} shared papers, ${YEARS}`;
    case 'xcroad': return `<b>${esc(it.u.short)} × ${esc(it.C.name)}</b><br>${m(it.w)} shared papers with institutions held there`;
    case 'aroad': return `<b>${esc(it.a.name)} × ${esc(it.b.name)}</b><br>${m(it.w)} co-authorships in the sample`;
    case 'proad': return `<b>${esc(it.a.name)} × ${esc(it.b.name)}</b><br>${m(it.w)} joint papers in the sample`;
    case 'xroad': return `<b>${esc(it.p.name)} → ${esc(it.B.name)}</b><br>${m(it.w)} joint papers in the sample`;
  }
  return '';
}
export function showTip(h, cx, cy) {
  tip.innerHTML = tipHtml(h) + (h.edgeContinuation ? '<br>Double bars: continues at the opposite map edge' : '');
  tip.classList.add('on');
  const b = tip.getBoundingClientRect();
  let x = cx + 14, y = cy + 14;
  if (x + b.width > innerWidth - 6) x = cx - b.width - 14;
  if (y + b.height > innerHeight - 6) y = cy - b.height - 14;
  tip.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
}
export function hideTip() { tip && tip.classList.remove('on'); }


export function initInput() {
  cvs.addEventListener('pointermove', onMove);
  cvs.addEventListener('pointerleave', () => { setHover(null); hideTip(); });
  cvs.addEventListener('click', onClick);
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onHash);
  window.addEventListener('keydown', onKey);
}
