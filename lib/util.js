export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// smoothstep between a and b
export const ramp = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const ease = (t) => t * t * (3 - 2 * t);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const rgbCache = new Map();
export function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}
export const rgba = (hex, a) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
export const mix = (h1, h2, t) => {
  const a = rgb(h1), b = rgb(h2);
  const m = (i) => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0');
  return '#' + m(0) + m(1) + m(2);
};

export const fmt = (n) => Math.round(n || 0).toLocaleString('en-GB');
export function fmtShort(n) {
  if (n >= 1e9) return (n / 1e9).toPrecision(3).replace(/\.?0+$/, '') + 'b';
  if (n >= 1e6) return (n / 1e6).toPrecision(3).replace(/\.?0+$/, '') + 'm';
  if (n >= 1e4) return (n / 1e3).toPrecision(3).replace(/\.?0+$/, '') + 'k';
  return fmt(n);
}
export const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Deterministic random source for the force layouts.
export function lcg(seed) {
  let s = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

export function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Road width from shared papers, on a log scale between the weakest and strongest link.
export function widthScale(lo, hi) {
  const a = Math.log(Math.max(1, lo)), b = Math.log(Math.max(1, hi));
  return (w) => 0.6 + 3.4 * clamp((Math.log(Math.max(1, w)) - a) / (b - a || 1), 0, 1);
}

export function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
