// Focus: for the current zoom, which country, institution and area is in focus and how open each is.
import { wrapX, dxw, sxOf } from './camera';
import { geoContains } from 'd3-geo';
import { ease, lerp, ramp } from './util';
import { P } from './paint';
import { A, loadDetail } from './atlas';
import { H, T, VP, W, flight, reduced } from './camera';
import { syncView } from './nav';
import { markMoving } from './loop';

export let fcountry = null, funi = null, farea = null;
export function settle() {
  P.T = T;
  for (let i = 0; i < 8; i++) update(2000);
}
export function approach(o, key, target, dt, tau = 220) {
  const v = o[key] ?? 0;
  if (Math.abs(v - target) < 0.002) { o[key] = target; return; }
  o[key] = v + (target - v) * (1 - Math.exp(-dt / tau));
  markMoving();
}

// Decide, for the current zoom, which country, institution and area are in focus and how open each is.
export function update(dt) {
  if (A.researchMode !== 'institutions') {
    fcountry = funi = farea = null; A.openMax = A.PT = 0;
    syncView({country:null, uni:null, area:null, person:null});
    return;
  }
  const { countries, unis, projection } = A.W;
  const k = T.k, cx = VP.x + VP.w / 2, cy = VP.y + VP.h / 2;
  const P0 = A.W.period, vx = (cx - T.x) / k;
  const centre = projection.invert([P0 ? vx - P0 * Math.round(vx / P0) : vx, (cy - T.y) / k]);
  let best = 1e9; fcountry = null;
  for (const c of countries) {
    c.sx = wrapX(c.x) * k + T.x; c.sy = c.y * k + T.y; c.D = 2 * c.Rn * k;
    if (c.D >= 56) {
      const near = Math.hypot(c.sx - cx, c.sy - cy) / (c.Rn * k);
      // a country too small to have an outline (Singapore) wins when the view is centred on it
      const d = !c.f && near < 0.6 ? -1 : c.f && centre && geoContains(c.f, centre) ? 0 : near;
      if (d < 1.1 && d < best) { best = d; fcountry = c; }
    }
  }
  // the selected country keeps focus while the view is on it, even at a border (CERN, Geneva)
  const S = A.sel.country, SU = A.sel.uni;
  const py = (cy - T.y) / k, pad = 40 / k;
  const px = S && S.box ? S.box.x0 / 2 + S.box.x1 / 2 + dxw(vx - S.box.x0 / 2 - S.box.x1 / 2) : vx;
  const onSel = S && S.D >= 56 && (Math.hypot(S.sx - cx, S.sy - cy) / (S.Rn * k) < 1.1
    || (S.box && (S.box.x1 - S.box.x0) * k < 3 * VP.w && px > S.box.x0 - pad && px < S.box.x1 + pad && py > S.box.y0 - pad && py < S.box.y1 + pad)
    || (SU && SU.C === S && Math.hypot(sxOf(SU.x) - cx, SU.y * k + T.y - cy) < 0.35 * Math.min(VP.w, VP.h)));
  if (onSel) fcountry = S;
  for (const c of countries) approach(c, 'fw', c === fcountry ? 1 : 0, dt);
  const M = fcountry ? fcountry.fw * ramp(50, 76, fcountry.D) : 0;
  for (const c of countries) {
    c.bloom = ramp(50, 76, c.D) * (fcountry && fcountry !== c ? 1 - M : 1);
    c.open = ramp(260, 340, c.ext * k) * c.fw;
  }
  best = 1e9; funi = null;
  for (const u of unis) {
    approach(u, 'R', u.Rt, dt, 320);
    approach(u, 'on', u.off ? 0 : 1, dt, 260);
    const C = u.C, v = (u.prevC ? C.bloom : C.open) * u.on;
    u.vis = v; u.g = ease(v);
    u.sx = C.sx + dxw(u.x - C.x) * k * u.g; u.sy = C.sy + (u.y - C.y) * k * u.g;
    u.D = 2 * u.R * k * u.g;
    if (u.vis > 0.5 && u.D >= 56) {
      const d = Math.hypot(u.sx - cx, u.sy - cy) / (u.R * k);
      if (d < 1.3 && d < best) { best = d; funi = u; }
    }
  }
  const su = A.sel.uni;
  if (!funi && su && su.vis > 0.5 && su.D >= 56 && su.sx > 0 && su.sx < W && su.sy > 0 && su.sy < H) funi = su;
  for (const u of unis) approach(u, 'fw', u === funi ? 1 : 0, dt);
  if (funi && !funi.detail) loadDetail(funi);
  let openMax = 0;
  for (const u of unis) {
    u.bloom = ramp(50, 76, u.D);
    u.open = u.detail ? ramp(220, 300, u.D) * u.fw : 0;
    openMax = Math.max(openMax, u.open);
  }
  const I = funi ? funi.fw * ramp(50, 76, funi.D) : 0;
  for (const u of unis) {
    if (u !== funi) u.bloom *= (1 - openMax) * (funi ? 1 - I : 1);
    const e = Math.min(1, 1.5 * u.vis);
    u.bloom *= e; u.open *= e;
    u.ts = u.R * k * lerp(0.45, 1, u.bloom);
  }
  A.openMax = openMax;
  farea = null;
  for (const u of unis) {
    const d = u.detail;
    if (!d) continue;
    if (u.bloom <= 0.001) { for (const a of d.areas) { a.vis = 0; a.D = 0; a.bloom = 0; a.open = 0; } continue; }
    for (const a of d.areas) {
      const v = a.prev ? u.bloom : u.open;
      a.vis = v; a.g = ease(v);
      a.sx = u.sx + a.lx * u.ts * a.g; a.sy = u.sy + a.ly * u.ts * a.g;
      a.rs = a.lr * u.ts * a.g; a.D = 2 * a.rs;
    }
    if (u === funi && u.open > 0.5) {
      let b2 = 1e9;
      for (const a of d.areas) if (a.D >= 220) {
        const dd = Math.hypot(a.sx - cx, a.sy - cy) / a.rs;
        if (dd < 1.15 && dd < b2) { b2 = dd; farea = a; }
      }
      const sa = A.sel.person ? A.sel.person.A : A.sel.area;
      if (sa && sa.U === u && sa.D >= 220 && (!farea || flight)) farea = sa;
    }
  }
  for (const u of unis) {
    const d = u.detail;
    if (!d || u.bloom <= 0.001) continue;
    for (const a of d.areas) {
      approach(a, 'fw', a === farea ? 1 : 0, dt);
      a.bloom = a.vis > 0 ? ramp(50, 76, a.D) : 0;
      a.open = ramp(220, 300, a.D) * a.fw;
      a.ts = a.rs * lerp(0.45, 1, a.bloom);
    }
    if (u === funi) {
      const tau = reduced ? 40 : 150;
      for (const p of d.people) {
        const t = p.tgt || p.home;
        if (Math.abs(p.cur.x - t.x) > 1e-4 || Math.abs(p.cur.y - t.y) > 1e-4) {
          const r = 1 - Math.exp(-dt / tau);
          p.cur.x += (t.x - p.cur.x) * r; p.cur.y += (t.y - p.cur.y) * r; markMoving();
        } else { p.cur.x = t.x; p.cur.y = t.y; }
        approach(p, 'rec', p.rt, dt, tau);
      }
    }
  }
  const sp = A.sel.person;
  A.PT = sp && farea === sp.A ? 1 : 0;
  const openArea = farea && farea.open > 0.5 ? farea : null;
  syncView({
    country: funi ? funi.C : fcountry && fcountry.bloom > 0.5 ? fcountry : null,
    uni: funi,
    area: openArea,
    person: sp && openArea === sp.A ? sp : null,
  });
}
