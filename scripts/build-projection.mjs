// The atlas's map projection: a research-weighted cartogram on a cylinder, so the world can wrap east-west.
//
// Base: Miller cylindrical, cropped to 60°S-84°N. A cylinder has straight, matching left and right edges,
// so copies of the world sit side by side with no seam and links take their shortest way round.
//
// Warp: a diffusion cartogram (Gastner & Newman 2004) on that cylinder. Every place gets map area
//   (1 - BETA) x its true share of the Earth's surface  +  BETA x its share of significant research,
// where research is each held institution's highly cited papers (square-rooted, so one giant can't
// claim a country) smoothed over a few hundred km. BETA = 0.6. The same rule applies everywhere, so
// Europe, the US north-east, East Asia and the Bangalore-Delhi belt open up by the same measure, while
// the empty Arctic that Miller inflates, the Sahara and the open oceans give space back.
// The density diffuses on a grid that is periodic east-west and closed at the crop lines (so those stay
// straight); the grid's corners ride the flow and their final positions are the warp.
//
// Writes public/data/projection.json: the grid and its corner displacements (int16, base64).
// Run from app/: node scripts/build-projection.mjs [beta] [sigma in 2° cells] [out file]
import fs from 'fs';

const BETA = +(process.argv[2] ?? 0.6);
const OUT = process.argv[4] || 'public/data/projection.json';
const LAT_S = -60, LAT_N = 84;
const NX = 180;                       // 2° cells
const H = (2 * Math.PI) / NX;         // cell size in base units (radians of longitude)
const SIGMA = +(process.argv[3] ?? 12);   // research smoothing, in 2° cells: 12 = 24°, ~2,700 km, so whole regions grow together
const QUANT = 1e-4;                   // displacement step stored in the file

const rad = Math.PI / 180;
const millerY = (phi) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi));
const Y0 = millerY(LAT_S * rad), Y1 = millerY(LAT_N * rad);
const NY = Math.round((Y1 - Y0) / H);
const HY = (Y1 - Y0) / NY;            // cell height (≈ H)
const millerInv = (y) => 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI;

// ---- target density on the base grid
const area = new Float64Array(NX * NY), res = new Float64Array(NX * NY);
for (let j = 0; j < NY; j++) {
  const phi = millerInv(Y0 + (j + 0.5) * HY);
  // true surface area per unit of Miller map area: cos φ · dφ/dy, and dφ/dy = cos(0.8 φ)
  const a = Math.cos(phi) * Math.cos(0.8 * phi);
  for (let i = 0; i < NX; i++) area[j * NX + i] = a;
}
const L = JSON.parse(fs.readFileSync('public/data/atlas.json'));
for (const u of L.universities) {
  const w = Math.sqrt(Math.max(1, u.hc ?? u.works * 0.05));
  const fx = (u.lng * rad + Math.PI) / H - 0.5, fy = (millerY(Math.max(LAT_S, Math.min(LAT_N, u.lat)) * rad) - Y0) / HY - 0.5;
  const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
  for (const [di, dj, f] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const i = (((i0 + di) % NX) + NX) % NX, j = Math.max(0, Math.min(NY - 1, j0 + dj));
    res[j * NX + i] += w * f;
  }
}
// gaussian blur: periodic in x, reflecting in y
function blur(src, s) {
  const r = Math.ceil(3 * s), k = [];
  for (let d = -r; d <= r; d++) k.push(Math.exp(-(d * d) / (2 * s * s)));
  const ks = k.reduce((a, b) => a + b, 0);
  const tmp = new Float64Array(src.length), out = new Float64Array(src.length);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    let v = 0;
    for (let d = -r; d <= r; d++) v += k[d + r] * src[j * NX + ((((i + d) % NX) + NX) % NX)];
    tmp[j * NX + i] = v / ks;
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    let v = 0;
    for (let d = -r; d <= r; d++) { let jj = j + d; if (jj < 0) jj = -jj - 1; if (jj >= NY) jj = 2 * NY - jj - 1; v += k[d + r] * tmp[jj * NX + i]; }
    out[j * NX + i] = v / ks;
  }
  return out;
}
const resB = blur(res, SIGMA);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const mA = mean(area), mR = mean(resB);
let rho = new Float64Array(NX * NY);
for (let n = 0; n < rho.length; n++) rho[n] = (1 - BETA) * area[n] / mA + BETA * resB[n] / mR;
const rho0 = Float64Array.from(rho);

// ---- diffusion, carrying the grid corners along with the flow
const at = (i, j) => rho[Math.max(0, Math.min(NY - 1, j)) * NX + ((((i) % NX) + NX) % NX)];
const NXn = NX + 1, NYn = NY + 1;
const px = new Float64Array(NXn * NYn), py = new Float64Array(NXn * NYn); // corner positions in cell units
for (let j = 0; j < NYn; j++) for (let i = 0; i < NXn; i++) { px[j * NXn + i] = i; py[j * NXn + i] = j; }
// velocity -∇ρ/ρ at a point in cell units (cell centres sit at i + 0.5)
function vel(x, y) {
  const fx = x - 0.5, fy = Math.max(0, Math.min(NY - 1, y - 0.5));
  const i0 = Math.floor(fx), j0 = Math.min(NY - 2, Math.floor(fy)), tx = fx - i0, ty = fy - j0;
  let vx = 0, vy = 0;
  for (const [di, dj, f] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const i = i0 + di, j = j0 + dj, r = at(i, j);
    vx += f * -(at(i + 1, j) - at(i - 1, j)) / (2 * r);
    vy += f * -(at(i, j + 1) - at(i, j - 1)) / (2 * r);
  }
  // no flow through the crop lines: the north-south flow fades to nothing over the last cell
  if (vy > 0) vy *= Math.max(0, Math.min(1, NY - y)); else vy *= Math.max(0, Math.min(1, y));
  return [vx, vy];
}
const t0 = Date.now();
let t = 0, step = 0, vmax = 1;
const dt = 0.2;
const next = new Float64Array(NX * NY);
while (vmax > 4e-4 && step < 60000) {
  // move the corners (midpoint rule), at most a fifth of a cell per step
  vmax = 0;
  for (let j = 0; j < NYn; j++) for (let i = 0; i < NX; i++) {
    const n = j * NXn + i;
    let [vx, vy] = vel(px[n], py[n]);
    let [mx, my] = vel(px[n] + 0.5 * dt * vx, py[n] + 0.5 * dt * vy);
    if (j === 0 || j === NY) my = 0; // the crop lines stay straight
    const s = Math.min(1, 0.2 / (Math.hypot(mx, my) * dt || 1));
    px[n] += mx * dt * s; py[n] += my * dt * s;
    vmax = Math.max(vmax, Math.hypot(mx, my));
  }
  for (let j = 0; j < NYn; j++) { px[j * NXn + NX] = px[j * NXn] + NX; py[j * NXn + NX] = py[j * NXn]; }
  // diffuse ρ (explicit, periodic in x, closed in y)
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
    next[j * NX + i] = at(i, j) + dt * (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1) - 4 * at(i, j));
  rho.set(next);
  t += dt; step++;
  if (step % 2000 === 0) console.log(`  t=${t.toFixed(0)} max flow ${vmax.toExponential(2)}`);
}
console.log(`diffusion: ${step} steps, t=${t.toFixed(0)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---- check: no cell may fold over (every warped cell keeps its orientation)
let folded = 0, minA = 1e9;
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const a = j * NXn + i, b = a + 1, c = a + NXn + 1, d = a + NXn;
  const sa = 0.5 * ((px[a] * py[b] - px[b] * py[a]) + (px[b] * py[c] - px[c] * py[b]) + (px[c] * py[d] - px[d] * py[c]) + (px[d] * py[a] - px[a] * py[d]));
  if (sa <= 0) folded++;
  minA = Math.min(minA, sa);
}
console.log(`folded cells: ${folded}; smallest cell ${(100 * minA).toFixed(1)}% of its original size`);

// ---- check: map area each region ends up with, before and after
function cellArea(i, j) { // area of the warped quad (cell units)
  const a = j * NXn + i, b = a + 1, c = a + NXn + 1, d = a + NXn;
  return 0.5 * Math.abs((px[a] * py[b] - px[b] * py[a]) + (px[b] * py[c] - px[c] * py[b]) + (px[c] * py[d] - px[d] * py[c]) + (px[d] * py[a] - px[a] * py[d]));
}
const regions = { Europe: [-11, 40, 35, 71], 'North America': [-125, -66, 25, 55], 'East Asia': [100, 146, 18, 46], 'South Asia': [66, 92, 6, 35], Africa: [-18, 52, -35, 35], 'South America': [-82, -34, -56, 12], Oceania: [112, 179, -47, -10], 'Arctic (>66°N)': [-180, 180, 66, 84] };
let total = 0, totalArea = 0;
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { total += cellArea(i, j); totalArea += area[j * NX + i]; }
console.log('region            true-area  now (Miller)  research  atlas map');
for (const [n, [a, b, c, d]] of Object.entries(regions)) {
  let s = 0, s0 = 0, sa = 0, sr = 0;
  for (let j = 0; j < NY; j++) {
    const lat = millerInv(Y0 + (j + 0.5) * HY) / rad;
    if (lat < c || lat > d) continue;
    for (let i = 0; i < NX; i++) {
      const lng = -180 + (i + 0.5) * 2;
      if (lng < a || lng > b) continue;
      s += cellArea(i, j); s0 += 1; sa += area[j * NX + i]; sr += resB[j * NX + i];
    }
  }
  const pct = (v) => (100 * v).toFixed(1).padStart(6) + '%';
  console.log(n.padEnd(17), pct(sa / totalArea), '  ', pct(s0 / (NX * NY)), '    ', pct(sr / (mR * NX * NY)), ' ', pct(s / total));
}

// ---- write: corner displacements in base units
const dx = new Int16Array(NX * NYn), dy = new Int16Array(NX * NYn);
let maxD = 0;
for (let j = 0; j < NYn; j++) for (let i = 0; i < NX; i++) {
  const n = j * NXn + i, ex = (px[n] - i) * H, ey = (py[n] - j) * HY;
  maxD = Math.max(maxD, Math.abs(ex), Math.abs(ey));
  dx[j * NX + i] = Math.round(ex / QUANT); dy[j * NX + i] = Math.round(ey / QUANT);
}
if (maxD / QUANT > 32767) throw new Error('displacement too large for int16');
const b64 = (a) => Buffer.from(a.buffer).toString('base64');
const out = { v: 1, base: 'miller', beta: BETA, sigma: SIGMA, latS: LAT_S, latN: LAT_N, nx: NX, ny: NY, y0: Y0, y1: Y1, q: QUANT, dx: b64(dx), dy: b64(dy) };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB), largest shift ${(maxD / H).toFixed(1)} cells`);
