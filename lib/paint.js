// Low-level canvas painting: territories, dots, roads and labels.
import { geoInterpolate } from 'd3-geo';
import { projectedSegments } from './projection';
import { clamp, rgba, mix } from './util';

export const P = {
  ctx: null, cvs: null, W: 1, H: 1, DPR: 1, T: { k: 1, x: 0, y: 0 }, skin: null, projection: null, period: 0,
  hits: [], roadHits: [], obstacles: [],
};

const measureCache = new Map();
export const clearMeasure = () => measureCache.clear();
export function textW(font, s, track) {
  const key = font + '|' + s + '|' + track;
  let w = measureCache.get(key);
  if (w === undefined) {
    P.ctx.font = font;
    w = P.ctx.measureText(s).width + (track ? track * (s.length - 1) : 0);
    if (measureCache.size > 6000) measureCache.clear();
    measureCache.set(key, w);
  }
  return w;
}
export function wrap(text, font, track, maxW, maxLines) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textW(font, t, track) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const l = lines.slice(0, maxLines); l[maxLines - 1] += '…'; return l; }
  return lines;
}
export function fillText(s, x, y, font, color, alpha, track = 0, halo = true) {
  const ctx = P.ctx;
  ctx.font = font; ctx.globalAlpha = alpha; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  ctx.strokeStyle = P.skin.paper; ctx.lineWidth = 3.2; ctx.fillStyle = color; ctx.textAlign = 'left';
  if (track) {
    let px = x;
    if (halo) for (const ch of s) { ctx.strokeText(ch, px, y); px += ctx.measureText(ch).width + track; }
    px = x;
    for (const ch of s) { ctx.fillText(ch, px, y); px += ctx.measureText(ch).width + track; }
  } else { if (halo) ctx.strokeText(s, x, y); ctx.fillText(s, x, y); }
  ctx.globalAlpha = 1;
}

// Labels are collected during a frame, then placed by priority so none overlap.
// Dots registered as obstacles are kept clear too (a label may still sit beside its own dot), and a
// label with `lead` set may move out along a short leader line when every spot beside its dot is taken.
let labels = [];
export function label(l) { labels.push(l); }
export function obstacle(x, y, r, owner) {
  if (x + r < 0 || x - r > P.W || y + r < 0 || y - r > P.H) return;
  P.obstacles.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, owner });
}
const LEAD_DIRS = [0, 180, -30, 210, 30, 150, -60, 240, 60, 120, -90, 90].map((d) => (d * Math.PI) / 180);
function leadSpots(l, w, h) {
  const out = [], r0 = (l.dotR || 3) + 2;
  for (const d of l.leadD || [30, 50, 74]) for (const a of LEAD_DIRS) {
    const ex = l.x + Math.cos(a) * (r0 + d), ey = l.y + Math.sin(a) * (r0 + d);
    // text sits beyond the end of the line, on the side it points to
    const ox = Math.cos(a) >= -0.01 ? ex - l.x + 3 : ex - l.x - w - 3;
    const oy = Math.abs(Math.sin(a)) < 0.3 ? ey - l.y - l.size * 0.62 : Math.sin(a) > 0 ? ey - l.y : ey - l.y - h;
    out.push([ox, oy, ex - l.x, ey - l.y]);
  }
  return out;
}
export function placeLabels() {
  labels.sort((a, b) => b.pri - a.pri);
  // on-screen controls (breadcrumbs, search, key…) count as taken, so labels never hide under them
  const placed = (P.covered || []).slice();
  const obs = P.obstacles || [];
  const hit = (r, p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0;
  const free = (r, owner) => !placed.some((p) => hit(r, p)) && !obs.some((o) => o.owner !== owner && hit(r, o));
  const leads = [];
  for (const l of labels) {
    const lh = l.size * 1.18;
    const w = Math.max(...l.lines.map((s) => textW(l.font, s, l.track || 0)), l.sub ? textW(l.subFont, l.sub, 0) : 0);
    const h = lh * l.lines.length + (l.sub ? l.subSize * 1.3 : 0);
    let spots = l.spots || [[l.anchor === 'center' ? -w / 2 : 0, l.anchor === 'center' ? -h / 2 : -l.size * 0.8]];
    if (l.lead) spots = spots.concat(leadSpots(l, w, h));
    let ok = null;
    for (const [ox, oy, lx, ly] of spots) {
      const r = { x0: l.x + ox - 2, y0: l.y + oy - 1, x1: l.x + ox + w + 2, y1: l.y + oy + h + 1 };
      if (r.x0 < 2 || r.x1 > P.W - 2 || r.y0 < 2 || r.y1 > P.H - 2) continue;
      if (lx != null) {
        // the leader line itself must not run through another label
        const lb = { x0: Math.min(l.x, l.x + lx), y0: Math.min(l.y, l.y + ly), x1: Math.max(l.x, l.x + lx), y1: Math.max(l.y, l.y + ly) };
        if (placed.some((p) => hit(lb, p) && segHitsBox(l.x, l.y, l.x + lx, l.y + ly, p))) continue;
        // nor cross another leader line
        if (leads.some((q) => segsCross(l.x, l.y, l.x + lx, l.y + ly, q))) continue;
      }
      if (l.force || free(r, l.owner)) { ok = [ox, oy, r, lx, ly]; break; }
    }
    if (!ok) continue;
    const [ox, oy, r, lx, ly] = ok;
    placed.push(r);
    if (lx != null) {
      leads.push([l.x, l.y, l.x + lx, l.y + ly]);
      const ctx = P.ctx, d = Math.hypot(lx, ly), r0 = (l.dotR || 3) + 1.5;
      ctx.globalAlpha = 0.7 * l.alpha; ctx.strokeStyle = l.leadColor || P.skin.ink2; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(l.x + (lx / d) * r0, l.y + (ly / d) * r0); ctx.lineTo(l.x + lx, l.y + ly); ctx.stroke(); ctx.globalAlpha = 1;
    }
    l.lines.forEach((s, i) => {
      const lw = textW(l.font, s, l.track || 0);
      const dx = l.anchor === 'center' ? (w - lw) / 2 : 0;
      fillText(s, l.x + ox + dx, l.y + oy + l.size * 0.92 + i * lh, l.font, l.color, l.alpha, l.track || 0);
    });
    if (l.sub) {
      const sw = textW(l.subFont, l.sub, 0);
      const dx = l.anchor === 'center' ? (w - sw) / 2 : 0;
      fillText(l.sub, l.x + ox + dx, l.y + oy + lh * l.lines.length + l.subSize * 0.95, l.subFont, P.skin.ink2, l.alpha);
    }
    if (l.hit) P.hits.push({ ...l.hit, box: r });
  }
  labels = [];
}

function segsCross(ax, ay, bx, by, [cx, cy, dx, dy]) {
  const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0 && o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0;
}
function segHitsBox(x1, y1, x2, y2, b) {
  for (let i = 0; i <= 8; i++) {
    const x = x1 + ((x2 - x1) * i) / 8, y = y1 + ((y2 - y1) * i) / 8;
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
  }
  return false;
}

// Engraving hatch pattern
const hatchCache = new Map();
export function hatch(color, dir) {
  const key = color + dir + P.DPR;
  let h = hatchCache.get(key);
  if (h) return h;
  const s = Math.max(4, Math.round(4.2 * P.DPR)), c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.strokeStyle = color; g.lineWidth = 0.62 * P.DPR; g.lineCap = 'square'; g.beginPath();
  if (dir > 0) { g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(-s, s); g.lineTo(s, -s); g.moveTo(0, 2 * s); g.lineTo(2 * s, 0); }
  else { g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(-s, 0); g.lineTo(s, 2 * s); g.moveTo(0, -s); g.lineTo(2 * s, s); }
  g.stroke();
  h = { pat: P.ctx.createPattern(c, 'repeat'), s };
  hatchCache.set(key, h);
  return h;
}
export const clearHatch = () => hatchCache.clear();

// A territory: nested outlines in unit space drawn at (x, y) with radius r.
export function territory(paths, x, y, r, color, alpha, style) {
  const { ctx, W, H, DPR, T } = P, S = P.skin;
  if (alpha < 0.004 || r < 2 || x + 1.3 * r < 0 || x - 1.3 * r > W || y + 1.3 * r < 0 || y - 1.3 * r > H) return;
  const key = S.key, px = (v) => v / r, outer = paths[0];
  ctx.save();
  ctx.setTransform(DPR * r, 0, 0, DPR * r, DPR * x, DPR * y);
  ctx.globalAlpha = alpha;
  if (style === 'unmapped') {
    ctx.fillStyle = rgba(color, key === 'c' ? 0 : 0.04); ctx.fill(outer);
    ctx.setLineDash([px(3), px(3)]);
    ctx.strokeStyle = rgba(color, key === 'c' ? 0.9 : 0.55); ctx.lineWidth = px(key === 'c' ? 0.9 : 1); ctx.stroke(outer);
  } else if (key === 'a') {
    if (style === 'ground') {
      ctx.fillStyle = rgba(color, 0.045); ctx.fill(outer, 'evenodd');
      ctx.fillStyle = rgba(color, 0.03); ctx.fill(paths[1] || outer, 'evenodd');
      ctx.strokeStyle = rgba(color, 0.26); ctx.lineWidth = px(0.8); ctx.stroke(outer);
    } else {
      const f = style === 'uni' ? 0.035 : 0.062;
      for (const p of paths) { ctx.fillStyle = rgba(color, f); ctx.fill(p, 'evenodd'); }
      ctx.strokeStyle = rgba(color, 0.38); ctx.lineWidth = px(0.75); ctx.stroke(outer);
    }
  } else if (key === 'b') {
    ctx.fillStyle = rgba(color, style === 'ground' ? 0.025 : 0.035); ctx.fill(outer, 'evenodd');
    const n = style === 'ground' ? 2 : paths.length;
    for (let i = 0; i < n && paths[i]; i++) {
      ctx.strokeStyle = rgba(color, i === 0 ? 0.85 : 0.55 - 0.05 * i); ctx.lineWidth = px(i === 0 ? 1.1 : 0.6); ctx.stroke(paths[i]);
    }
  } else {
    if (style !== 'ground') {
      ctx.save(); ctx.clip(outer, 'evenodd'); ctx.setTransform(1, 0, 0, 1, 0, 0);
      const h = hatch(color, style === 'uni' ? -1 : 1);
      h.pat.setTransform?.(new DOMMatrix().translate((T.x * DPR) % h.s, (T.y * DPR) % h.s));
      ctx.fillStyle = h.pat;
      const x0 = Math.max(0, (x - 1.3 * r) * DPR), y0 = Math.max(0, (y - 1.3 * r) * DPR);
      ctx.fillRect(x0, y0, Math.min(P.cvs.width, (x + 1.3 * r) * DPR) - x0, Math.min(P.cvs.height, (y + 1.3 * r) * DPR) - y0);
      ctx.restore();
    }
    ctx.strokeStyle = style === 'ground' ? S.ink : mix(color, S.ink, 0.45);
    ctx.lineWidth = px(style === 'ground' ? 1.2 : 1); ctx.stroke(outer);
    if (style === 'ground' && paths[1]) { ctx.lineWidth = px(0.45); ctx.strokeStyle = rgba(S.ink, 0.5); ctx.stroke(paths[0]); }
  }
  ctx.restore();
}
export const unitCircle = (() => (typeof Path2D === 'undefined' ? [] : (() => { const p = new Path2D(); p.arc(0, 0, 1, 0, Math.PI * 2); return [p]; })()))();

export function dot(x, y, r, color, alpha, kind) {
  if (alpha < 0.01) return;
  const ctx = P.ctx, S = P.skin;
  ctx.globalAlpha = alpha;
  if (S.key === 'a') {
    ctx.fillStyle = S.paper; ctx.beginPath(); ctx.arc(x, y, r + (kind === 'uni' ? 1.2 : 1.6), 0, 6.2832); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  } else if (S.key === 'b') {
    ctx.fillStyle = kind === 'uni' ? S.ink : mix(color, S.ink, 0.38); ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, 0.82 * r), 0, 6.2832); ctx.fill();
  } else {
    ctx.fillStyle = S.paper; ctx.strokeStyle = kind === 'uni' ? S.ink : mix(color, S.ink, 0.3); ctx.lineWidth = kind === 'uni' ? 1.5 : 1.15;
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, 0.9 * r), 0, 6.2832); ctx.fill(); ctx.stroke();
    if (kind === 'uni') { ctx.fillStyle = S.ink; ctx.beginPath(); ctx.arc(x, y, Math.max(1, 0.22 * r), 0, 6.2832); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
export function ring(x, y, r, alpha) {
  const ctx = P.ctx;
  ctx.globalAlpha = alpha; ctx.strokeStyle = P.skin.accent; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1;
}

// A gently curved road between two circles.
export function road(x1, y1, r1, x2, y2, r2, w, color, alpha, item, bend = 0.09) {
  const { ctx, W, H } = P, S = P.skin;
  if (alpha < 0.01) return;
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  if (d < r1 + r2 + 3 || (x1 < -40 && x2 < -40) || (x1 > W + 40 && x2 > W + 40) || (y1 < -40 && y2 < -40) || (y1 > H + 40 && y2 > H + 40)) return;
  const ux = dx / d, uy = dy / d;
  const ax = x1 + ux * r1, ay = y1 + uy * r1, bx = x2 - ux * r2, by = y2 - uy * r2;
  const b = bend * (d - r1 - r2), mx = (ax + bx) / 2 - uy * b, my = (ay + by) / 2 + ux * b;
  ctx.globalAlpha = alpha; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
  if (S.key === 'c' && w > 1.9 && color === S.road && item && item.kind === 'uroad') {
    ctx.strokeStyle = S.ink; ctx.lineWidth = w + 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.strokeStyle = S.paper; ctx.lineWidth = Math.max(0.6, w - 1.1);
  } else { ctx.strokeStyle = color; ctx.lineWidth = w; }
  ctx.stroke(); ctx.globalAlpha = 1;
  if (item && alpha > 0.12) P.roadHits.push({ x1: ax, y1: ay, mx, my, x2: bx, y2: by, w, item });
}

// A great-circle road between two places on the globe.
// On a wrapping map the arc is one continuous line that may run past the date line; it is drawn from
// the copy of each end that is on screen (twice when its ends are on different copies of the world).
const arcCache = new Map();
export function arcPts(lng1, lat1, lng2, lat2) {
  const key = lng1 + ',' + lat1 + ',' + lng2 + ',' + lat2;
  let segs = arcCache.get(key);
  if (segs) return segs;
  const ip = geoInterpolate([lng1, lat1], [lng2, lat2]), pr = P.projection, per = P.period;
  segs = [];
  if (per) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const p = pr(ip(i / 40));
      if (pts.length) { const q = pts[pts.length - 1]; p[0] = q[0] + (p[0] - q[0]) - per * Math.round((p[0] - q[0]) / per); }
      pts.push(p);
    }
    segs.push(pts);
  } else {
    segs = projectedSegments(pr, { type: 'LineString', coordinates: [[lng1, lat1], [lng2, lat2]] });
  }
  if (arcCache.size > 20000) arcCache.clear();
  arcCache.set(key, segs);
  return segs;
}
export function geoRoad(segs, a, ra, b, rb, w, color, alpha, item) {
  const { T } = P;
  if (alpha < 0.01 || !segs.length) return;
  const k = T.k, per = P.period;
  const base = segs.map((s) => s.map((p) => [p[0] * k + T.x, p[1] * k + T.y]));
  if (!per || base.length !== 1) {
    base[0][0] = [a.sx, a.sy];
    const lastSeg = base[base.length - 1];
    lastSeg[lastSeg.length - 1] = [b.sx, b.sy];
    strokeArc(base, a.sx, a.sy, ra, b.sx, b.sy, rb, w, color, alpha, item);
    return;
  }
  const s = base[0], Pk = per * k, n = Math.round((a.sx - s[0][0]) / Pk);
  const m = Math.round((s[s.length - 1][0] + n * Pk - b.sx) / Pk);
  for (const shift of m === 0 ? [0] : [0, -m]) {
    const dx = (n + shift) * Pk;
    const pts = s.map(([x, y]) => [x + dx, y]);
    const ax = a.sx + shift * Pk, bx = b.sx + (m + shift) * Pk;
    pts[0] = [ax, a.sy]; pts[pts.length - 1] = [bx, b.sy];
    strokeArc([pts], ax, a.sy, ra, bx, b.sy, rb, w, color, alpha, item);
  }
}
function strokeArc(pts, ax, ay, ra, bx, by, rb, w, color, alpha, item) {
  const { ctx, W, H } = P;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of pts) for (const [x, y] of s) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < -20 || x0 > W + 20 || y1 < -20 || y0 > H + 20) return;
  const continuations = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const left = pts[i], right = pts[i + 1];
    continuations.push({ segment: left, end: left[left.length - 1], inside: left[left.length - 2] });
    continuations.push({ segment: right, end: right[0], inside: right[1] });
  }
  const trim = (s, x, y, r) => {
    while (s.length > 2 && Math.hypot(s[1][0] - x, s[1][1] - y) < r) s.shift();
    if (s.length < 2) return false;
    const dx = s[1][0] - x, dy = s[1][1] - y, d = Math.hypot(dx, dy);
    if (d <= r) return false;
    s[0] = [x + (dx / d) * r, y + (dy / d) * r];
    return true;
  };
  // An endpoint can cover its entire short segment next to the seam. Keep the
  // continuation on the opposite edge instead of dropping the whole connection.
  if (!trim(pts[0], ax, ay, ra)) {
    if (pts.length === 1) return;
    pts.shift();
  }
  const e = pts[pts.length - 1];
  e.reverse(); const ok = trim(e, bx, by, rb); e.reverse();
  if (!ok) {
    if (pts.length === 1) return;
    pts.pop();
  }
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath();
  for (const s of pts) { ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); }
  ctx.stroke();
  // Matching double bars identify an undirected connection continuing at the other
  // edge. Draw inward from the seam so the markers stay inside the map outline.
  ctx.lineWidth = Math.max(1, Math.min(2, w));
  for (const c of continuations) {
    if (!pts.includes(c.segment)) continue;
    const [x, y] = c.end, d = Math.hypot(c.inside[0] - x, c.inside[1] - y);
    if (d < 1e-6) continue;
    const ux = (c.inside[0] - x) / d, uy = (c.inside[1] - y) / d;
    ctx.beginPath();
    for (const offset of [3, 7]) {
      const cx = x + ux * offset, cy = y + uy * offset;
      ctx.moveTo(cx - uy * 3, cy + ux * 3);
      ctx.lineTo(cx + uy * 3, cy - ux * 3);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (item && alpha > 0.12) P.roadHits.push({ pts, w, item, edgeContinuation: continuations.length > 0 });
}

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l, 0, 1) : 0;
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
export function hitTest(x, y) {
  const { hits, roadHits } = P;
  for (const h of hits) if (h.box && x >= h.box.x0 && x <= h.box.x1 && y >= h.box.y0 && y <= h.box.y1) return h;
  let best = null, bd = 1e9;
  for (const h of hits) if (!h.terr && !h.box) {
    const d = Math.hypot(x - h.x, y - h.y);
    if (d <= h.r + 2 && d - 0.01 * h.pri < bd) { bd = d - 0.01 * h.pri; best = h; }
  }
  if (best) return best;
  let rb = null, rd = 1e9;
  for (const r of roadHits) {
    let d = 1e9;
    if (r.pts) {
      for (const s of r.pts) for (let i = 1; i < s.length; i++) d = Math.min(d, segDist(x, y, s[i - 1], s[i]));
    } else {
      for (let i = 0; i <= 14; i++) {
        const t = i / 14, m = 1 - t;
        d = Math.min(d, Math.hypot(x - (m * m * r.x1 + 2 * m * t * r.mx + t * t * r.x2), y - (m * m * r.y1 + 2 * m * t * r.my + t * t * r.y2)));
      }
    }
    if (d < Math.max(4, r.w / 2 + 3) && d < rd) { rd = d; rb = r; }
  }
  if (rb) return { kind: rb.item.kind, item: rb.item, edgeContinuation: rb.edgeContinuation };
  for (const h of hits) if (h.path) {
    P.ctx.save(); P.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const inside = P.ctx.isPointInPath(h.path, (x - P.T.x) / P.T.k, (y - P.T.y) / P.T.k);
    P.ctx.restore(); if (inside) return h;
  }
  let tb = null, tr = 1e9;
  for (const h of hits) if (h.terr && Math.hypot(x - h.x, y - h.y) <= h.r && h.r < tr) { tr = h.r; tb = h; }
  return tb;
}
