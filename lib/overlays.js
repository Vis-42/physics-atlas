// Drawing layers on top of the base map: heat maps, a subfield's world network, exits and land.
import { sxOf, dxw, worldCopies } from './camera';
import { other } from './model';
import { clamp, fmt, mix, ramp, rgba } from './util';
import { P, arcPts, dot, geoRoad, label, obstacle, road, textW } from './paint';
import { A, hue, sk } from './atlas';
import { DPR, H, T, W, cam, ctx, cvs, mobile, sel } from './camera';

// Where something outside an area lies, as an angle from the area's centre.
export function bearingTo(a, target) {
  const U = a.U;
  if (target.area) return Math.atan2(target.area.sy - a.sy, target.area.sx - a.sx);
  const H = target.uid && A.W.uniById.get(target.uid);
  if (H && H !== U) return Math.atan2(H.y - U.y, dxw(H.x - U.x));
  let h = 0; for (const ch of String(target.key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 628) / 100;
}
// Spread markers that point in similar directions so their names don't collide.
export function spread(items, minGap) {
  items.sort((x, y) => x.ang - y.ang);
  for (let k = 0; k < 3; k++) for (let i = 1; i < items.length; i++) if (items[i].ang - items[i - 1].ang < minGap) items[i].ang = items[i - 1].ang + minGap;
  return items;
}
// A selected researcher's co-authors outside their area and outside the institution: named markers at
// the area's edge in the direction of where those people are, joined by orange ties.
export function ghostsFor(me, a, [mx, my], rMe, d) {
  const S = sk(), al = A.PT * a.open;
  const inner = me.nb.filter((n) => n.q.A !== a).slice(0, 8).map((n) => ({ kind: 'in', q: n.q, w: n.w, key: n.q.id, ang: bearingTo(a, { area: n.q.A }) }));
  const outer = (me.xt || []).slice(0, 8).map(([aid, name, uid, iname, w, slug]) => ({ kind: 'out', aid, name, uid, iname, w, slug, key: aid, ang: bearingTo(a, { uid, key: iname || aid }) }));
  const place = (list, rad) => spread(list, 0.22).forEach((g) => {
    const x = a.sx + Math.cos(g.ang) * rad, y = a.sy + Math.sin(g.ang) * rad;
    road(mx, my, rMe + 2, x, y, 4, Math.min(4, 0.8 + Math.sqrt(g.w)), S.accent, 0.7 * al, null, 0.06);
    ctx.globalAlpha = al; ctx.fillStyle = S.paper; ctx.strokeStyle = S.accent; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
    const f = S.person(11.5), sub = g.kind === 'in' ? g.q.A.name : (A.W.uniById.get(g.uid)?.short || g.iname || 'elsewhere');
    const right = Math.cos(g.ang) >= 0, txt = g.kind === 'in' ? g.q.name : g.name, tw = Math.max(textW(f, txt, 0), textW(S.sub(10.5), sub, 0));
    label({ lines: [txt], font: f, size: 11.5, x, y, color: S.ink, alpha: al, pri: 400 + g.w, sub, subFont: S.sub(10.5), subSize: 10.5,
      spots: right ? [[8, -8], [-8 - tw, -8]] : [[-8 - tw, -8], [8, -8]], hit: { kind: 'ghost', item: g } });
    P.hits.push({ kind: 'ghost', item: g, x, y, r: 7, pri: 7 });
  });
  place(inner, a.ts * 1.04);
  place(outer, a.ts * 1.2);
}
export function areaExits(a) {
  const S = sk();
  const list = spread(a.xi.slice(0, 6).map(([uid, name, n, slug]) => ({ uid, name, n, slug, key: uid, ang: bearingTo(a, { uid, key: name }) })), 0.3);
  for (const e of list) {
    const x = a.sx + Math.cos(e.ang) * a.ts * 1.1, y = a.sy + Math.sin(e.ang) * a.ts * 1.1;
    const short = A.W.uniById.get(e.uid)?.short || (e.name.length > 30 ? e.name.slice(0, 28) + '…' : e.name);
    const q = Math.round(e.ang / (Math.PI / 2)), glyph = ['▶', '▼', '◀', '▲'][((q % 4) + 4) % 4];
    const f = S.uni(12.5), txt = glyph + ' ' + short, right = Math.cos(e.ang) >= 0;
    label({ lines: [txt], font: f, size: 12.5, x, y, color: S.ink, alpha: a.open * 0.9, pri: 80 + e.n, sub: '    ' + fmt(e.n) + ' joint papers in the sample', subFont: S.sub(10), subSize: 10,
      spots: right ? [[0, -9], [-textW(f, txt, 0), -9]] : [[-textW(f, txt, 0), -9], [0, -9]], hit: { kind: 'aexit', item: e } });
  }
}

// The subfield's leading researchers worldwide, at their institutions, joined where they write together.
// Links are drawn under the institutions, people on top of everything, and their names avoid every dot
// (with a short leader line where a region is crowded, as in Europe).
export function netPos() {
  const k = T.k, zf = Math.min(3, Math.sqrt(k / cam.world().k));
  if (A.net.posK === k && A.net.posX === T.x && A.net.posY === T.y) return A.net.pos;
  const pos = new Map();
  for (const p of A.net.people) {
    if (p.x == null || p.y == null) continue;
    // people at one institution sit in a small sunflower around it
    const a = p.j * 2.39996, r = p.j ? (3.5 + 3.2 * Math.sqrt(p.j)) * zf : 0;
    pos.set(p, [sxOf(p.x) + Math.cos(a) * r, p.y * k + T.y + Math.sin(a) * r]);
  }
  Object.assign(A.net, { pos, posK: k, posX: T.x, posY: T.y });
  return pos;
}
export function drawNetLinks(alpha) {
  const S = sk(), col = mix(hue(A.phase.fam || 'phys'), S.ink, 0.35), pos = netPos();
  const sel = A.netSel && A.net.people.includes(A.netSel) ? A.netSel : null;
  const nmax = Math.max(1, ...A.net.links.map((l) => l.n));
  for (const l of A.net.links) {
    if (!pos.has(l.a) || !pos.has(l.b)) continue;
    const [x1, y1] = pos.get(l.a), [x2, y2] = pos.get(l.b);
    const mine = sel && (l.a === sel || l.b === sel);
    const hovered = A.hover?.kind === 'netl' ? A.hover.item : null;
    const active = hovered === l || mine;
    const opacity = alpha * (hovered ? (active ? 0.95 : 0.12) : sel ? (mine ? 0.9 : 0.18) : 0.55);
    const width = 0.6 + 2.4 * Math.sqrt(l.n / nmax);
    if (l.a.iid === l.b.iid) {
      road(x1, y1, 3, x2, y2, 3, width, active ? S.accent : col, opacity, l, 0.18);
    } else {
      geoRoad(arcPts(l.a.lng, l.a.lat, l.b.lng, l.b.lat),
        { sx: x1, sy: y1 }, 3, { sx: x2, sy: y2 }, 3,
        width, active ? S.accent : col, opacity, l);
    }
  }
}
export function drawNetPeople(alpha) {
  const S = sk(), k = T.k, col = mix(hue(A.phase.fam || 'phys'), S.ink, 0.35), pos = netPos();
  const sel = A.netSel && A.net.people.includes(A.netSel) ? A.netSel : null;
  const mates = sel ? new Set(A.net.links.flatMap((l) => (l.a === sel ? [l.b] : l.b === sel ? [l.a] : []))) : null;
  const hmax = Math.max(1, ...A.net.people.map((p) => p.score));
  const order = A.net.people.slice().sort((a, b) => b.score - a.score);
  // more names as you zoom in: about 16 at world scale, all of them by country scale
  const n0 = mobile ? 8 : 16, named = Math.round(clamp(n0 * Math.pow(k / cam.world().k, 0.8), n0, order.length));
  const drawn = [];
  order.forEach((p, i) => {
    if (!pos.has(p)) return;
    const [x, y] = pos.get(p), r = 2.2 + 3.5 * Math.sqrt(p.score / hmax);
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) return;
    drawn.push([p, i, x, y, r]);
    obstacle(x, y, r + 1.5, p);
  });
  for (const [p, i, x, y, r] of drawn.slice().reverse()) {
    const a = sel && p !== sel && !mates.has(p) ? 0.35 * alpha : alpha;
    dot(x, y, r, col, a, 'person');
    ctx.globalAlpha = a; ctx.strokeStyle = p === sel ? S.accent : col; ctx.lineWidth = p === sel ? 2 : 0.7; ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1;
    P.hits.push({ kind: 'netp', item: p, x, y, r: r + 4, pri: 8 });
  }
  for (const [p, i, x, y, r] of drawn) {
    const key = p === sel || (mates && mates.has(p));
    if (i >= named && !key) continue;
    const f = S.person(11), nw = textW(f, p.name, 0), sub = p.iname.length > 30 ? p.iname.slice(0, 28) + '…' : p.iname;
    const sw = textW(S.sub(9.5), sub, 0), w = Math.max(nw, sw);
    label({ lines: [p.name], font: f, size: 11, x, y, color: S.ink, alpha: key || !sel ? alpha : 0.5 * alpha, pri: 300 - i + (key ? 400 : 0), owner: p, dotR: r,
      sub, subFont: S.sub(9.5), subSize: 9.5, lead: i < 30 || key, leadD: mobile ? [18, 30, 44] : [26, 44, 64],
      spots: [[r + 4, -7], [-r - 4 - w, -7], [-w / 2, r + 3], [-w / 2, -r - 27]], hit: { kind: 'netp', item: p } });
  }
}

export const EXC = '#b0892a';
export function drawHeat(alpha) {
  const S = sk(), k = T.k, col = hue(A.phase.fam || 'phys');
  const zf = Math.pow(clamp(k / cam.world().k, 1, 60), 0.32);
  const list = A.heat.slice(0, mobile ? 260 : 520);
  ctx.save();
  ctx.globalCompositeOperation = S.key === 'c' ? 'source-over' : 'multiply';
  for (const e of list) {
    const x = sxOf(e.inst.x), y = e.inst.y * k + T.y, r = (5 + 30 * Math.sqrt(e.f)) * zf;
    if (x + r < 0 || x - r > W || y + r < 0 || y - r > H) continue;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, alpha * (0.18 + 0.42 * Math.sqrt(e.f))));
    g.addColorStop(0.55, rgba(col, alpha * 0.12 * Math.sqrt(e.f)));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
  // how the leading places are connected: measured co-authorship between the top institutions
  const lead = new Set();
  for (const e of list) { const u = A.W.uniById.get(e.inst.id); if (u) lead.add(u); if (lead.size >= 30) break; }
  if (lead.size > 1) {
    const links = A.W.uroads.filter((r) => lead.has(r.a) && lead.has(r.b)).sort((a, b) => b.w - a.w).slice(0, 60);
    const wmax = links.length ? links[0].w : 1;
    for (const r of links) {
      const a = { sx: sxOf(r.a.tx), sy: r.a.ty * k + T.y }, b = { sx: sxOf(r.b.tx), sy: r.b.ty * k + T.y };
      geoRoad(arcPts(r.a.lng, r.a.lat, r.b.lng, r.b.lat), a, 3, b, 3, 0.5 + 2.2 * Math.sqrt(r.w / wmax), mix(col, S.ink, 0.35), alpha * 0.45, r);
    }
  }
  // the leading places that the map doesn't otherwise hold, as small named dots
  let shown = 0;
  for (const e of list) {
    if (shown > (mobile ? 12 : 28)) break;
    if (A.W.uniById.has(e.inst.id)) continue;
    shown++;
    const x = sxOf(e.inst.x), y = e.inst.y * k + T.y;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const r = 2 + 3 * Math.sqrt(e.f);
    dot(x, y, r, mix(col, S.ink, 0.25), alpha, 'person');
    P.hits.push({ kind: 'hinst', item: e, x, y, r: r + 4, pri: 3 });
    const f = S.person(11), nm = e.inst.name.length > 30 ? e.inst.name.slice(0, 28) + '…' : e.inst.name, nw = textW(f, nm, 0);
    label({ lines: [nm], font: f, size: 11, x, y, color: S.ink2, alpha: alpha * 0.9, pri: 20 + 10 * e.f, spots: [[r + 4, -7], [-r - 4 - nw, -7]] });
  }
}

export function drawExits(u, V) {
  const S = sk(), k = T.k, R = u.R * k * 1.06;
  for (const r of u.dom.slice(0, 6)) {
    const o = other(r, u);
    const ang = Math.atan2(o.y - u.y, dxw(o.x - u.x));
    const x = clamp(u.sx + Math.cos(ang) * R, 20, W - 90), y = clamp(u.sy + Math.sin(ang) * R, mobile ? 100 : 60, H - (mobile ? 0.36 * H + 20 : 60));
    const al = u.open * (1 - ramp(0.4, 0.9, V));
    if (al < 0.03) continue;
    const q = Math.round(ang / (Math.PI / 2));
    const glyph = ['▶', '▼', '◀', '▲'][((q % 4) + 4) % 4];
    const f = S.uni(13.5), txt = glyph + ' ' + o.short;
    label({ lines: [txt], font: f, size: 13.5, x, y, color: S.ink, alpha: al, pri: 90 + r.w / 1e4,
      sub: '    ' + fmt(r.w) + ' shared', subFont: S.sub(10.5), subSize: 10.5, spots: [[0, -10], [-textW(f, txt, 0), -10]],
      hit: { kind: 'exit', item: { u: o, r, from: u } } });
  }
}

export function drawLand(alpha) {
  const W0 = A.W, k = T.k, key = sk().key, band = W0.band;
  // the sea: the band between the crop lines when the world wraps, else the globe's outline
  const sea = () => { if (!band) return W0.sphere; const p = new Path2D(); p.rect(-T.x / k - 10, band.y0, W / k + 20, band.y1 - band.y0); return p; };
  const edge = (lw) => {
    ctx.lineWidth = lw / k;
    if (!band) { ctx.stroke(W0.sphere); return; }
    ctx.beginPath(); ctx.moveTo(-T.x / k - 10, band.y0); ctx.lineTo((W - T.x) / k + 10, band.y0);
    ctx.moveTo(-T.x / k - 10, band.y1); ctx.lineTo((W - T.x) / k + 10, band.y1); ctx.stroke();
  };
  ctx.save(); ctx.setTransform(DPR * k, 0, 0, DPR * k, DPR * T.x, DPR * T.y); ctx.globalAlpha = alpha;
  if (key === 'c') {
    ctx.save(); ctx.clip(sea()); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.5 * alpha; ctx.fillStyle = '#7f93a3';
    const step = Math.max(3, Math.round(3.4 * DPR)), th = Math.max(1, Math.round(0.55 * DPR));
    for (let y = (((T.y * DPR) % step) + step) % step; y < cvs.height; y += step) ctx.fillRect(0, y, cvs.width, th);
    ctx.restore(); ctx.globalAlpha = alpha;
  }
  if (key === 'b') { ctx.strokeStyle = 'rgba(125,110,90,.55)'; edge(0.8); }
  for (const off of worldCopies()) {
    ctx.setTransform(DPR * k, 0, 0, DPR * k, DPR * (T.x + off * k), DPR * T.y);
    if (key === 'a') {
      ctx.fillStyle = '#e6ebef'; ctx.fill(W0.land);
      ctx.strokeStyle = '#fbfcfd'; ctx.lineWidth = 1 / k; ctx.stroke(W0.borders);
      ctx.strokeStyle = 'rgba(120,138,153,.45)'; ctx.lineWidth = 0.6 / k; ctx.stroke(W0.land);
    } else if (key === 'b') {
      ctx.strokeStyle = 'rgba(125,110,90,.3)'; ctx.lineWidth = 0.5 / k; ctx.stroke(W0.graticule);
      ctx.fillStyle = '#f2ead9'; ctx.fill(W0.land);
      ctx.setLineDash([2 / k, 2 / k]); ctx.strokeStyle = 'rgba(110,92,70,.45)'; ctx.lineWidth = 0.5 / k; ctx.stroke(W0.borders); ctx.setLineDash([]);
      ctx.strokeStyle = '#7a6a52'; ctx.lineWidth = 0.8 / k; ctx.stroke(W0.land);
    } else {
      ctx.fillStyle = '#ffffff'; ctx.fill(W0.land);
      ctx.strokeStyle = 'rgba(26,26,24,.35)'; ctx.lineWidth = 0.45 / k; ctx.stroke(W0.borders);
      ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 0.75 / k; ctx.stroke(W0.land);
    }
  }
  if (key === 'c') { ctx.setTransform(DPR * k, 0, 0, DPR * k, DPR * T.x, DPR * T.y); ctx.strokeStyle = '#1a1a18'; edge(1.2); }
  ctx.restore();
}
export function drawGrid() {
  const k = T.k;
  let step = Math.pow(10, Math.floor(Math.log10(48 / k)));
  if (step * k < 24) step *= 2;
  if (step * k < 24) step *= 2.5;
  const big = 5 * step, x0 = -T.x / k, y0 = -T.y / k, x1 = (W - T.x) / k, y1 = (H - T.y) / k;
  ctx.lineWidth = 1;
  for (const [s, a] of [[step, 0.05], [big, 0.1]]) {
    ctx.strokeStyle = rgba('#7d6e5a', a); ctx.beginPath();
    for (let x = Math.floor(x0 / s) * s; x <= x1; x += s) { const p = Math.round(x * k + T.x) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
    for (let y = Math.floor(y0 / s) * s; y <= y1; y += s) { const p = Math.round(y * k + T.y) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
  }
}
