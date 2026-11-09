// The camera: viewport, fitting, wheel smoothing, flights, drag momentum and the pan limits.
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { interpolateZoom } from 'd3-interpolate';
import { clamp, easeInOutCubic } from './util';
import { P } from './paint';
import { A } from './atlas';
import { nearest, shortDx } from './projection';
import { dirtyHash } from './nav';
import { kick } from './loop';
import { settle } from './focus';
import { hideTip } from './input';

export let cvs, ctx, stage, tip, zoomer, sel;
export let T = zoomIdentity, W = 1, H = 1, DPR = 1, mobile = false, reduced = false;
export let VP = { x: 0, y: 0, w: 1, h: 1 };
export let flight = null, glide = null, dragging = false;
export let samples = [];
// ---------- camera
export function measure() {
  W = stage.clientWidth; H = stage.clientHeight;
  mobile = window.innerWidth <= 720;
  DPR = Math.min(window.devicePixelRatio || 1, mobile ? 2 : 3);
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  const top = mobile ? 90 : 56, bottom = mobile ? 0.36 * H + 6 : 44;
  VP = { x: 16, y: top, w: Math.max(80, W - 32), h: Math.max(80, H - top - bottom) };
  P.W = W; P.H = H; P.DPR = DPR;
}
export function fitBox(b, pad, kmin, kmax) {
  let k = Math.min(VP.w / (b.x1 - b.x0), VP.h / (b.y1 - b.y0)) * pad;
  if (kmin) k = Math.max(k, kmin);
  if (kmax) k = Math.min(k, kmax);
  return { k, x: VP.x + VP.w / 2 - ((b.x0 + b.x1) / 2) * k, y: VP.y + VP.h / 2 - ((b.y0 + b.y1) / 2) * k };
}
export function fitCircle(x, y, r, frac, minD) {
  let k = (Math.min(VP.w, VP.h) * frac) / (2 * r);
  if (minD) k = Math.max(k, minD / (2 * r));
  return { k, x: VP.x + VP.w / 2 - x * k, y: VP.y + VP.h / 2 - y * k };
}
export const cam = {
  // With wrapping, the world view is exactly one trip round the world across the whole canvas.
  world: () => {
    const f = fitBox(A.W.sphereBox, 0.96), P0 = A.W.period;
    if (!P0 || f.k >= W / P0) return f;
    const b = A.W.sphereBox, k = W / P0;
    return { k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: VP.y + VP.h / 2 - ((b.y0 + b.y1) / 2) * k };
  },
  country: (c) => fitBox(c.box, 0.9, Math.max(360 / c.ext, 80 / (2 * c.Rn)), 44 / (2 * c.maxR)),
  // cameras aim at an institution's size in the current view (Rt), even while it is still resizing
  uni: (u) => fitCircle(u.x, u.y, 1.12 * u.Rt, 0.97),
  area: (a) => fitCircle(a.U.x + a.lx * a.U.Rt, a.U.y + a.ly * a.U.Rt, 1.13 * a.lr * a.U.Rt, 0.95, 330),
};
// Zoomed out, a wrapping map shows at most one trip round the world.
export const kExtent = () => [A.W.period ? W / A.W.period : 0.85 * cam.world().k, 6000];
// The map stops a little past the edges of the world instead of panning forever. The rule is on the
// centre of the view, not on the map's edges: d3's own translate extent re-centres the map whenever the
// world is smaller than the screen (a phone held upright at world zoom), which pulled every pinch back
// to the middle. Clamping the centre never moves the map unless it is about to leave the world.
export function constrain(t) {
  const b = A.W.sphereBox, mx = (b.x1 - b.x0) * 0.04, my = (b.y1 - b.y0) * 0.04;
  const cx = VP.x + VP.w / 2, cy = VP.y + VP.h / 2;
  const wx = (cx - t.x) / t.k, wy = (cy - t.y) / t.k;
  // east-west the world wraps, so only north-south is limited
  const nx = A.W.period ? wx : clamp(wx, b.x0 - mx, b.x1 + mx), ny = clamp(wy, b.y0 - my, b.y1 + my);
  if (nx === wx && ny === wy) return t;
  return zoomIdentity.translate(cx - nx * t.k, cy - ny * t.k).scale(t.k);
}
// Smoothed wheel and trackpad zoom around the pointer.
export let wz = null;
export function onWheel(e) {
  e.preventDefault();
  flight = null; glide = null; hideTip();
  const r = cvs.getBoundingClientRect();
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
    setT({ k: T.k, x: T.x - e.deltaX, y: T.y }); kick(); return;
  }
  const [k0, k1] = kExtent();
  const base = wz ? wz.k : T.k;
  wz = { k: clamp(base * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0024)), k0, k1), px: e.clientX - r.left, py: e.clientY - r.top };
  kick();
}
export function stepWheel(dt) {
  if (!wz) return false;
  const lk = Math.log(T.k), tk = Math.log(wz.k), f = 1 - Math.exp(-dt / 85);
  const nk = Math.abs(tk - lk) < 0.003 ? wz.k : Math.exp(lk + (tk - lk) * f);
  const wx = (wz.px - T.x) / T.k, wy = (wz.py - T.y) / T.k;
  setT({ k: nk, x: wz.px - wx * nk, y: wz.py - wy * nk });
  if (nk === wz.k) wz = null;
  return true;
}
export const viewOf = (t) => [(VP.x + VP.w / 2 - t.x) / t.k, (VP.y + VP.h / 2 - t.y) / t.k, VP.w / t.k];
export const fromView = (v) => { const k = VP.w / v[2]; return { k, x: VP.x + VP.w / 2 - v[0] * k, y: VP.y + VP.h / 2 - v[1] * k }; };
export function setT(t) { zoomer.transform(sel, zoomIdentity.translate(t.x, t.y).scale(t.k)); }
export function flyTo(t, instant) {
  glide = null;
  // fly to the copy of the target nearest to where we are, never the long way round the world
  if (A.W.period) { const v = viewOf(t); v[0] = nearest(v[0], viewOf(T)[0], A.W.period); t = fromView(v); }
  if (instant || reduced) { flight = null; setT(t); dirtyHash(); if (instant) settle(); kick(); return; }
  const i = interpolateZoom(viewOf(T), viewOf(t));
  flight = { i, t0: performance.now(), dur: clamp(0.62 * i.duration, 700, 1800) };
  kick();
}
// Momentum only follows a plain one-finger (or mouse) drag. During a pinch the offset moves fast just
// because the scale changes, so measuring it threw the map sideways when the fingers lifted.
export let pinched = false;
export function onZoomStart(e) { if (e.sourceEvent) { flight = null; glide = null; wz = null; samples = []; dragging = true; pinched = false; hideTip(); } }
export function onZoom(e) {
  const k0 = T.k;
  T = e.transform;
  if (e.sourceEvent) {
    const t = e.sourceEvent.touches;
    if ((t && t.length > 1) || Math.abs(T.k - k0) > 1e-9 * T.k) { pinched = true; samples = []; }
    else { samples.push({ t: performance.now(), x: T.x, y: T.y }); if (samples.length > 8) samples.shift(); }
  }
  kick();
}
export function onZoomEnd(e) {
  dragging = false;
  if (!e.sourceEvent || reduced || pinched || samples.length < 2) { samples = []; pinched = false; return; }
  const now = performance.now(), b = samples[samples.length - 1];
  if (now - b.t < 70) {
    const a = samples.find((s) => b.t - s.t <= 110) || samples[0], dt = b.t - a.t;
    if (dt > 8) { const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt; if (Math.hypot(vx, vy) > 0.15) glide = { vx, vy }; }
  }
  samples = [];
  kick();
}


// Set up the canvas, the zoom behaviour and resizing.
export function initCamera({ stageEl, canvasEl, tipEl, ctx: c2d }) {
  stage = stageEl; cvs = canvasEl; tip = tipEl; ctx = c2d;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  measure();
  // Wheel zoom is handled here (smoothed); drags, pinches and taps go through d3-zoom.
  zoomer = d3zoom().scaleExtent(kExtent()).constrain(constrain).filter((e) => e.type !== 'wheel' && !e.button)
    .on('start', onZoomStart).on('zoom', onZoom).on('end', onZoomEnd);
  sel = select(cvs).call(zoomer).on('dblclick.zoom', null);
  let lastW = 0, lastH = 0;
  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight;
    // Phone address bars grow and shrink the height while scrolling; don't move the map for that.
    const barOnly = mobile && w === lastW && Math.abs(h - lastH) < 160;
    lastW = w; lastH = h;
    const v = viewOf(T);
    measure();
    zoomer.scaleExtent(kExtent());
    if (!flight && !barOnly) setT(fromView(v));
    kick();
  }).observe(stage);
  cvs.addEventListener('wheel', onWheel, { passive: false });
}

// Advance the camera one frame: a flight, the smoothed wheel, or a drag's momentum. True while moving.
export function stepCamera(now, dt) {
  if (flight) {
    const p = clamp((now - flight.t0) / flight.dur, 0, 1);
    setT(fromView(flight.i(easeInOutCubic(p))));
    if (p >= 1) { flight = null; dirtyHash(); }
    return true;
  }
  if (stepWheel(dt)) return true;
  if (glide) {
    setT({ k: T.k, x: T.x + glide.vx * dt, y: T.y + glide.vy * dt });
    const f = Math.exp(-dt / 320);
    glide.vx *= f; glide.vy *= f;
    if (Math.hypot(glide.vx, glide.vy) < 0.02) glide = null;
    return true;
  }
  return false;
}

// ---- the wrapping world: which copy of a thing to draw
// World x of the centre of the view.
export const viewX = () => (VP.x + VP.w / 2 - T.x) / T.k;
// The copy of world x nearest the centre of the view, and a difference in x taken the short way round.
export const wrapX = (x) => nearest(x, (VP.x + VP.w / 2 - T.x) / T.k, A.W.period);
export const dxw = (d) => shortDx(d, A.W.period);
// Screen x of world x (nearest copy).
export const sxOf = (x) => wrapX(x) * T.k + T.x;
// The offsets (world units) of every copy of the world that is at least partly on screen.
export function worldCopies() {
  const P0 = A.W.period;
  if (!P0) return [0];
  // a little wider than one trip round: the warp bends the date line a few degrees either way
  const x0 = A.W.sphereBox.x0 - 0.15 * P0, x1 = A.W.sphereBox.x1 + 0.15 * P0;
  const lo = -T.x / T.k, hi = (W - T.x) / T.k, out = [];
  for (let n = Math.floor((lo - x1) / P0); n <= Math.ceil((hi - x0) / P0); n++) {
    const o = n * P0;
    if (x1 + o >= lo && x0 + o <= hi) out.push(o);
  }
  return out;
}
