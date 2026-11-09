// One frame: every territory, road, dot and label, drawn from what is in memory.
import { wrapX, dxw } from './camera';
import { other } from './model';
import { YEARS } from './theme';
import { clamp, ease, fmt, lerp, mix, ramp, rgba } from './util';
import { P, arcPts, dot, fillText, geoRoad, hatch, label, obstacle, placeLabels, ring, road, territory, textW, unitCircle, wrap } from './paint';
import { A, hue, sk } from './atlas';
import { DPR, H, T, W, cam, ctx, cvs, flight, mobile, stage } from './camera';
import { farea, fcountry, funi } from './focus';
import { EXC, areaExits, drawExits, drawGrid, drawHeat, drawLand, drawNetLinks, drawNetPeople, ghostsFor } from './overlays';

// What the hovered thing touches, so everything else can fade.
export function related() {
  const h = A.panelHover || A.hover;
  // Hovering a whole territory (country, campus, area) highlights it without fading the rest.
  if (!h || flight || h.terr) return null;
  const s = new Set(), it = h.item;
  s.add(it);
  if (h.kind === 'uni') { it.links.forEach((r) => { s.add(r); s.add(other(r, it)); }); it.xc.forEach((r) => { s.add(r); s.add(r.C); }); }
  else if (h.kind === 'country') it.links.forEach((r) => { s.add(r); s.add(other(r, it)); });
  else if (h.kind === 'croad' || h.kind === 'uroad' || h.kind === 'aroad' || h.kind === 'proad') { s.add(it.a); s.add(it.b); }
  else if (h.kind === 'xcroad') { s.add(it.u); s.add(it.C); }
  else if (h.kind === 'area') it.links.forEach((r) => { s.add(r); s.add(other(r, it)); });
  else if (h.kind === 'person') { s.add(it.A); it.nb.forEach((n) => { s.add(n.q); s.add(n.l); }); it.cross.forEach((r) => { s.add(r); s.add(r.B); }); }
  else if (h.kind === 'xroad') { s.add(it.p); s.add(it.B); }
  else if (h.kind === 'exit') { s.add(it.u); s.add(it.r); }
  return s;
}

// Screen boxes of the controls over the map, refreshed twice a second.
export function controlRects() {
  const sr = stage.getBoundingClientRect(), out = [];
  for (const id of ['crumbs', 'search', 'view', 'research-mode', 'key', 'skins']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const parts = id === 'crumbs' ? [...el.children].flatMap((c) => [...c.children]) : [el];
    for (const c of parts) {
      const q = c.getBoundingClientRect();
      if (q.width && q.height) out.push({ x0: q.left - sr.left - 4, y0: q.top - sr.top - 4, x1: q.right - sr.left + 4, y1: q.bottom - sr.top + 4 });
    }
  }
  return out;
}
export let controlsAt = 0;
export function staleControls() { controlsAt = 0; }
export function draw() {
  const W0 = A.W, k = T.k, S = sk(), accent = S.accent;
  const now = performance.now();
  if (now - controlsAt > 500) { P.covered = controlRects(); controlsAt = now; }
  P.hits = []; P.roadHits = []; P.obstacles = [];
  const hits = P.hits;
  const rel = related();
  const dimA = (x) => (!rel || rel.has(x) ? 1 : 0.32);
  const dimT = (x) => (!rel || rel.has(x) ? 1 : 0.55);
  const hov = A.panelHover || A.hover;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1; ctx.fillStyle = S.paper; ctx.fillRect(0, 0, W, H);
  if (S.key === 'b') drawGrid();

  const X = cam.country(fcountry || W0.countryById.get('GB') || W0.countries[0]).k;
  const landA = A.researchMode !== 'institutions' ? 1 : 1 - ramp(5 * X, 14 * X, k);
  if (landA > 0.01) drawLand(landA);

  // A dedicated researcher layer: retain geographic orientation without institutional clutter.
  if (A.researchMode !== 'institutions') {
    if (A.net) { drawNetLinks(1); drawNetPeople(1); }
    placeLabels();
    return;
  }

  // country territories
  for (const c of W0.countries) {
    if (c.bloom < 0.004 || !c.path) continue;
    const a1 = c.bloom * (1 - c.open) * dimT(c), a2 = c.open * landA * (rel ? 0.6 : 1);
    // the copy nearest the view; a country across the date line also on the far side of the seam
    const o = wrapX(c.x) - c.x, P0 = W0.period;
    for (const off of c.seam ? [o - P0, o, o + P0] : [o]) {
      ctx.save(); ctx.setTransform(DPR * k, 0, 0, DPR * k, DPR * (T.x + off * k), DPR * T.y);
      if (a1 > 0.01) {
        ctx.globalAlpha = a1;
        if (S.key === 'c') {
          ctx.save(); ctx.clip(c.path); ctx.setTransform(1, 0, 0, 1, 0, 0);
          const h = hatch(S.neutral, -1); h.pat.setTransform?.(new DOMMatrix().translate((T.x * DPR) % h.s, (T.y * DPR) % h.s));
          ctx.fillStyle = h.pat; ctx.fillRect(0, 0, cvs.width, cvs.height); ctx.restore();
          ctx.strokeStyle = S.ink; ctx.lineWidth = 1.1 / k; ctx.stroke(c.path);
        } else {
          ctx.fillStyle = rgba(S.neutral, S.key === 'a' ? 0.12 : 0.07); ctx.fill(c.path);
          ctx.strokeStyle = rgba(S.neutral, 0.7); ctx.lineWidth = (S.key === 'b' ? 1.2 : 1) / k; ctx.stroke(c.path);
        }
      }
      if (a2 > 0.01) {
        ctx.globalAlpha = a2;
        ctx.fillStyle = S.key === 'c' ? '#ffffff' : rgba(S.neutral, S.key === 'a' ? 0.05 : 0.035); ctx.fill(c.path);
        ctx.strokeStyle = S.key === 'c' ? S.ink : rgba(S.neutral, 0.5); ctx.lineWidth = (S.key === 'c' ? 1.1 : 0.9) / k; ctx.stroke(c.path);
      }
      ctx.restore();
    }
    if (c.bloom > 0.5) hits.push({ kind: 'country', item: c, x: c.sx, y: c.sy, r: c.Rn * k, terr: true, pri: 0 });
  }

  // heat map: where the current view's work happens, every sizeable institution
  const heatA = A.heat ? (1 - A.openMax) * (1 - 0.85 * (funi ? funi.fw * ramp(50, 120, funi.D) : 0)) : 0;
  if (heatA > 0.02) drawHeat(heatA);
  // A subfield's world network takes over the map: the general roads and the institutions outside it step back.
  const NM = A.net && heatA > 0.02 ? heatA : 0;
  const netU = NM ? A.net.insts : null;
  if (NM) drawNetLinks(heatA);

  // roads between countries
  const M = fcountry ? fcountry.fw * ramp(50, 76, fcountry.D) : 0;
  const cR = (c) => lerp(c.dotR + 3, c.Rn * k * 0.5, c.bloom);
  const hc = hov && hov.kind === 'country' ? hov.item : null;
  for (const r of W0.croads) {
    if (!(r.bb || hc === r.a || hc === r.b)) continue;
    const touches = fcountry && (r.a === fcountry || r.b === fcountry);
    const fade = 1 - Math.max(r.a.open, r.b.open);
    let al = S.roadA * fade * (touches ? 1 : 1 - 0.85 * M) * (1 - 0.75 * NM);
    if (rel) al = rel.has(r) ? Math.min(1, 2.2 * S.roadA) * fade : 0.15 * al;
    geoRoad(arcPts(r.a.lng, r.a.lat, r.b.lng, r.b.lat), r.a, cR(r.a), r.b, cR(r.b), W0.wC(r.w), S.road, al, r);
  }

  // institution territories
  const openU = funi && funi.open > 0 ? funi : null;
  for (const u of W0.unis) {
    if (u.bloom < 0.004) continue;
    const r = u.R * k * lerp(0.45, 1, u.bloom);
    if (u.detail) {
      territory(u.detail.paths, u.sx, u.sy, r, S.neutral, u.bloom * (1 - u.open) * dimT(u), 'uni');
      territory(u.detail.paths, u.sx, u.sy, r, S.neutral, u.open * (rel ? 0.6 : 1), 'ground');
    } else territory(unitCircle, u.sx, u.sy, 0.92 * r, S.neutral, u.bloom * dimT(u), 'unmapped');
    if (u.bloom > 0.5 && u.vis > 0.5) hits.push({ kind: 'uni', item: u, x: u.sx, y: u.sy, r, terr: true, pri: 1 });
  }

  // roads between institutions
  const V = farea ? farea.open : 0;
  const I = funi ? funi.fw * ramp(50, 76, funi.D) : 0;
  const uR = (u) => (u.open > 0 ? lerp(lerp(u.dotR + 3, 0.97 * u.ts, u.bloom), u.R * k * 1.06, u.open) : lerp(u.dotR + 3.5, u.R * k * lerp(0.45, 1, u.bloom) * 0.92, u.bloom));
  const hu = hov && hov.kind === 'uni' ? hov.item : null;
  for (const r of W0.uroads) {
    const vis = Math.min(r.a.vis, r.b.vis);
    if (vis < 0.01) continue;
    const touchesOpen = openU && (r.a === openU || r.b === openU);
    const di = touchesOpen ? openU.dom.indexOf(r) : -1;
    if (!(r.bb || hu === r.a || hu === r.b || (touchesOpen && openU.open > 0.2 && di >= 0 && di < 6))) continue;
    const touchesF = funi && (r.a === funi || r.b === funi);
    let al = vis * S.roadA * (touchesF ? 1 : 1 - 0.85 * I) * (touchesOpen ? 1 : 1 - 0.9 * A.openMax) * (1 - 0.92 * V) * (1 - 0.75 * NM);
    if (rel) al = rel.has(r) ? vis * Math.min(1, 2.2 * S.roadA) : 0.15 * al;
    const crossesSeam = arcPts(r.a.lng, r.a.lat, r.b.lng, r.b.lat).length > 1;
    if (r.dom && !crossesSeam) road(r.a.sx, r.a.sy, uR(r.a), r.b.sx, r.b.sy, uR(r.b), W0.wU(r.w) * (1 - 0.35 * A.openMax), S.road, al, r);
    else geoRoad(arcPts(r.a.lng, r.a.lat, r.b.lng, r.b.lat), r.a, uR(r.a), r.b, uR(r.b), W0.wU(r.w), S.road, al, r);
  }
  for (const u of W0.unis) {
    if (u.vis < 0.3 || u.C.open < 0.3) continue;
    for (const x of u.xc) {
      if (!((x.bb && u.rank < 10) || hu === u) || x.C.open > 0.5) continue;
      let al = 0.6 * S.roadA * u.vis * u.C.open * (1 - x.C.open) * (u === funi ? 1 : 1 - 0.85 * I) * (u === openU ? 1 : 1 - 0.9 * A.openMax) * (1 - 0.92 * V) * (1 - 0.75 * NM);
      if (rel) al = rel.has(x) ? 0.7 * u.vis : 0.15 * al;
      geoRoad(arcPts(u.lng, u.lat, x.C.lng, x.C.lat), u, uR(u), x.C, cR(x.C), W0.wX(x.w), S.road, al, x);
    }
  }

  // research areas and their roads
  const aR = (a) => lerp(6 * (0.5 + 0.5 * a.g) + 2.5, 0.93 * a.ts, a.bloom);
  for (const u of W0.unis) {
    const d = u.detail;
    if (!d || u.bloom <= 0.001) continue;
    for (const a of d.areas) {
      if (a.vis < 0.004 || a.bloom < 0.004) continue;
      territory(a.paths, a.sx, a.sy, a.ts, hue(a.fam), a.bloom * a.vis * dimT(a) * (1 - 0.4 * a.open), 'area');
      if (a.bloom > 0.5 && a.vis > 0.5) hits.push({ kind: 'area', item: a, x: a.sx, y: a.sy, r: 0.97 * a.ts, terr: true, pri: 2 });
    }
    const ha = hov && hov.kind === 'area' ? hov.item : null;
    for (const r of d.aroads) {
      if (!(r.bb || ha === r.a || ha === r.b)) continue;
      const v = Math.min(r.a.vis, r.b.vis) * u.open;
      if (v < 0.01) continue;
      let al = S.roadA * v * (1 - 0.9 * V);
      if (rel) al = rel.has(r) ? Math.min(1, 2.2 * S.roadA) * v : 0.15 * al;
      road(r.a.sx, r.a.sy, aR(r.a), r.b.sx, r.b.sy, aR(r.b), d.wA(r.w), S.road, al, r, 0.07);
    }
  }

  // researchers inside areas
  const pR = (p, n) => (2.2 + 1.05 * Math.sqrt(p.w)) * n;
  const sp = A.sel.person;
  const ppl = [];
  for (const u of W0.unis) {
    const d = u.detail;
    if (!d || u.bloom <= 0.001) continue;
    for (const a of d.areas) {
      if (a.vis < 0.01) continue;
      const pos = (p) => { const s = a.ts * ease(p.prev ? a.bloom : a.open); return [a.sx + p.cur.x * s, a.sy + p.cur.y * s]; };
      const n = clamp(Math.sqrt(a.ts / 330), 0.55, 1.5);
      if (a.open > 0.01) {
        const me = sp && sp.A === a ? sp : null;
        for (const r of a.intra) {
          const mine = me && (r.a === me || r.b === me);
          let al = 1.15 * S.roadA * a.open * Math.min(r.a.rec, r.b.rec) * (mine ? 1 : 1 - 0.82 * A.PT);
          if (rel) al = rel.has(r) ? 0.8 * a.open : 0.15 * al;
          const [x1, y1] = pos(r.a), [x2, y2] = pos(r.b);
          road(x1, y1, pR(r.a, n) + 1.5, x2, y2, pR(r.b, n) + 1.5, d.wP(r.w), mine && A.PT > 0.3 ? accent : S.road, mine ? Math.max(al, 0.75 * A.PT) : al, r, 0.12);
        }
        const hp = hov && hov.kind === 'person' ? hov.item : null;
        for (const r of a.cross) {
          if (!(r.bb || hp === r.p)) continue;
          let al = 0.9 * S.roadA * a.open * r.p.rec * (1 - A.PT);
          if (rel) al = rel.has(r) ? 0.7 * a.open : 0.15 * al;
          if (al < 0.01 || r.B.vis < 0.01) continue;
          const [x1, y1] = pos(r.p);
          road(x1, y1, pR(r.p, n) + 1.5, r.B.sx, r.B.sy, aR(r.B), 0.9 * d.wXP(r.w), hue(r.B.fam), al, r, 0.05);
        }
        if (me && A.PT > 0.05) ghostsFor(me, a, pos(me), pR(me, n), d);
      }
      for (const p of a.people) {
        const v = p.prev ? a.bloom * a.vis : a.open;
        if (v < 0.02) continue;
        const [x, y] = pos(p);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        ppl.push({ p, a, x, y, r: pR(p, n) * (a.open < 0.5 ? lerp(0.75, 1, a.open) : 1), v });
      }
    }
  }

  // an open area's strongest outside partners, at its rim, pointing toward them
  if (farea && farea.open > 0.5 && !(sp && sp.A === farea) && farea.xi && farea.xi.length) areaExits(farea);

  // dashed lines from a selected researcher to colleagues with the closest work they've never written with
  if (sp && sp.sug && sp.sug.length && A.PT > 0.3) {
    const at = new Map(ppl.map((e) => [e.p.id, e]));
    const me = at.get(sp.id);
    if (me) {
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.2;
      for (const [qid] of sp.sug) {
        const q = at.get(qid);
        if (!q) continue;
        ctx.globalAlpha = 0.7 * A.PT; ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  // country dots and names
  for (const c of W0.countries) {
    const v = 1 - c.bloom;
    if (v < 0.01 || c.sx < -30 || c.sx > W + 30 || c.sy < -30 || c.sy > H + 30) continue;
    const al = dimA(c) * (1 - 0.35 * NM);
    if (S.key === 'a') { ctx.fillStyle = S.paper; ctx.globalAlpha = v * al; ctx.beginPath(); ctx.arc(c.sx, c.sy, c.dotR + 2.5, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1; }
    dot(c.sx, c.sy, c.dotR, S.ink, v * al, 'uni');
    if (v > 0.4) obstacle(c.sx, c.sy, c.dotR + 1.5, c);
    if (A.sel.country === c && !fcountry) ring(c.sx, c.sy, c.dotR + 4, v);
    if (v > 0.4) {
      hits.push({ kind: 'country', item: c, x: c.sx, y: c.sy, r: c.dotR + 5, pri: 4 });
      const f = S.uni(13), nw = textW(f, c.name, 0);
      label({ lines: [c.name], font: f, size: 13, x: c.sx, y: c.sy, color: S.ink, alpha: v * al, pri: 50 + c.pw / 1e5,
        owner: c, dotR: c.dotR, lead: true, leadD: mobile ? [20, 38, 58] : [30, 50, 74], hit: { kind: 'country', item: c },
        sub: fmt(c.pw) + ' papers', subFont: S.sub(10.5), subSize: 10.5,
        spots: [[c.dotR + 6, -9], [-c.dotR - 6 - nw, -9], [-nw / 2, c.dotR + 4]] });
    }
  }
  for (const c of W0.countries) {
    const v = c.bloom * (1 - c.open) * (1 - A.openMax);
    if (v < 0.05) continue;
    const f = S.region(11);
    label({ lines: [c.name.toUpperCase()], font: f, size: 11, track: 11 * S.regionTrack, x: c.sx, y: c.sy, anchor: 'center', color: S.ink2, alpha: v * 0.85 * dimA(c), pri: 30 });
  }

  // institution dots and names
  for (const u of W0.unis) {
    const v = (1 - u.bloom) * u.vis * (NM && !netU.has(u.id) ? 1 - 0.6 * NM : 1);
    if (v < 0.05 || u.sx < -60 || u.sx > W + 60 || u.sy < -30 || u.sy > H + 30) continue;
    const tx = u.C.sx + dxw(u.tx - u.C.x) * k * u.g, ty = u.C.sy + (u.ty - u.C.y) * k * u.g;
    if (Math.hypot(u.sx - tx, u.sy - ty) > u.dotR + 6) {
      ctx.globalAlpha = 0.55 * v * dimA(u); ctx.strokeStyle = S.ink2; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(u.sx, u.sy); ctx.stroke();
      ctx.fillStyle = S.ink2; ctx.beginPath(); ctx.arc(tx, ty, 1.2, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
    }
    dot(u.sx, u.sy, u.dotR, hue(u.fam), v * dimA(u), 'uni');
    if (u.excellent) { ctx.globalAlpha = v * dimA(u) * 0.9; ctx.strokeStyle = EXC; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(u.sx, u.sy, u.dotR + 2.8, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1; }
    if (A.sel.uni === u && !funi) ring(u.sx, u.sy, u.dotR + 4, v);
    hits.push({ kind: 'uni', item: u, x: u.sx, y: u.sy, r: u.dotR + 4, pri: 5 });
    if (v > 0.3) obstacle(u.sx, u.sy, u.dotR + 1.5, u);
    // in a network view only the leading institutions keep their names; the researchers carry the map
    if (NM > 0.5 && u.rank > 1) continue;
    const f = S.uni(12.5), nw = textW(f, u.short, 0);
    label({ lines: [u.short], font: f, size: 12.5, x: u.sx, y: u.sy, color: S.ink, alpha: v * dimA(u), pri: 40 - u.rank + (u.C === fcountry ? 20 : 0),
      owner: u, dotR: u.dotR, lead: true, hit: { kind: 'uni', item: u },
      spots: [[u.dotR + 5, -8], [-u.dotR - 5 - nw, -8], [-nw / 2, u.dotR + 3], [-nw / 2, -u.dotR - 18]] });
  }
  for (const u of W0.unis) {
    const v = u.bloom * (1 - u.open) * u.vis;
    if (v < 0.05) continue;
    const r = u.R * k * lerp(0.45, 1, u.bloom);
    const size = clamp(r / 5, 13, 18), f = S.uni(size);
    label({ lines: wrap(u.name, f, 0, Math.max(90, 1.5 * r), 2), font: f, size, x: u.sx, y: u.sy - (u.detail ? r * 0.62 : 0), anchor: 'center', color: S.ink, alpha: v * dimA(u), pri: 60,
      sub: u.detail ? '' : u.loading ? 'Opening…' : fmt(u.pw) + ' papers', subFont: S.sub(10.5), subSize: 10.5 });
  }
  if (openU && openU.open > 0.2) drawExits(openU, V);
  if (NM) drawNetPeople(heatA);

  // area labels
  for (const u of W0.unis) {
    const d = u.detail;
    if (!d || u.bloom <= 0.001) continue;
    for (const a of d.areas) {
      const v = a.bloom * a.vis * (1 - ramp(0.4, 0.9, a.open)) * (1 - ramp(0.4, 0.9, V));
      if (v < 0.05 || a.ts < 22) continue;
      const size = clamp(a.ts / 11, 9.5, 11.5), f = S.region(size), tr = size * S.regionTrack;
      const lines = wrap(a.name.toUpperCase(), f, tr, Math.max(70, 1.55 * a.ts), 3);
      label({ lines, font: f, size, track: tr, x: a.sx, y: a.sy, anchor: 'center', color: mix(hue(a.fam), S.ink, 0.45), alpha: v * dimA(a), pri: 70 + a.works / 1e4 });
    }
  }

  // researcher dots and names
  ppl.sort((a, b) => a.p.w - b.p.w);
  for (const { p, a, x, y, r, v } of ppl) {
    const al = v * dimA(p) * lerp(0.45, 1, p.rec);
    dot(x, y, r, hue(p.fam), al, 'person');
    if (sp === p) ring(x, y, r + 4, a.open);
    hits.push({ kind: 'person', item: p, x, y, r: r + 3, pri: 6 });
    if (a.open > 0.3) {
      const f = S.person(11.5), nw = textW(f, p.name, 0);
      label({ lines: [p.name], font: f, size: 11.5, x, y, color: S.ink, alpha: al * a.open, pri: 100 + p.w + (sp === p ? 500 : 0) + (rel && rel.has(p) ? 300 : 0),
        spots: [[r + 4, -7.5], [-r - 4 - nw, -7.5], [-nw / 2, r + 2], [-nw / 2, -r - 16]] });
    }
  }
  placeLabels();

  // the open area's name across the top of the map
  if (farea && farea.open > 0.5) {
    const a = farea, al = ramp(0.5, 0.95, farea.open);
    const f = S.region(12.5), tr = 12.5 * 0.17, y0 = mobile ? 112 : 84;
    const lines = wrap(a.name.toUpperCase(), f, tr, W - 60, 2);
    lines.forEach((s, i) => fillText(s, W / 2 - textW(f, s, tr) / 2, y0 + i * 15, f, mix(hue(a.fam), S.ink, 0.45), al, tr));
    const more = a.researchersSeen - a.people.length;
    const sub = a.people.length ? `Top ${a.people.length} researchers in this sample by h-index` + (more > 0 ? ` · + ${fmt(more)} more` : '') : `${fmt(a.works)} papers ${YEARS} · researchers not mapped yet`;
    const sf = S.sub(11);
    fillText(sub, W / 2 - textW(sf, sub, 0) / 2, y0 + (lines.length - 1) * 15 + 17, sf, S.ink2, al);
  }
}
