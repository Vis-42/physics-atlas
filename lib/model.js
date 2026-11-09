// Turns the small data files (names, institutions, links) into a laid-out atlas.
// Nothing here is pre-drawn: positions and territory outlines are computed in the browser.
import { geoPath, geoArea, geoGraticule10 } from 'd3-geo';
import { makeProjection, nearest, projectedSegments } from './projection';
import { forceSimulation, forceX, forceY, forceCollide, forceLink, forceManyBody } from 'd3-force';
import { contours } from 'd3-contour';
import { line, curveCatmullRomClosed } from 'd3-shape';
import { feature, mesh } from 'topojson-client';
import { famOf, FAMILIES } from './theme';
import { clamp, lcg, groupBy, widthScale, quantile } from './util';

const GRID = 84;
const SPAN = 1.25;

export function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
const other = (road, x) => (road.a === x ? road.b : road.a);
export { other };

// Mark the roads that always show: the strongest 5% and each node's top three.
function markBackbone(nodes, roads, key = 'links') {
  const cut = quantile(roads.map((r) => r.w).sort((a, b) => a - b), 0.95);
  roads.forEach((r) => (r.bb = r.w >= cut));
  for (const n of nodes) {
    n[key].sort((a, b) => b.w - a.w);
    n[key].slice(0, 3).forEach((r) => (r.bb = true));
  }
}

// Keep nodes inside a disc of radius R (unit space).
function boxForce(nodes, R) {
  return () => {
    for (const n of nodes) {
      const d = Math.hypot(n.x, n.y), lim = R - n.r;
      if (d > lim && d > 0) { n.x *= lim / d; n.y *= lim / d; }
    }
  };
}

const pathLine = line().curve(curveCatmullRomClosed.alpha(0.5));
// Density field on a grid → nested contour outlines as Path2D, in unit space.
function territory(fn, thresholds) {
  const values = new Float64Array(GRID * GRID);
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++)
      values[j * GRID + i] = fn(-SPAN + ((i + 0.5) / GRID) * 2 * SPAN, -SPAN + ((j + 0.5) / GRID) * 2 * SPAN);
  return contours().size([GRID, GRID]).thresholds(thresholds)(values).map((c) => {
    let d = '';
    for (const poly of c.coordinates)
      for (const ring of poly) {
        if (ring.length < 4) continue;
        d += pathLine(ring.slice(0, -1).map(([x, y]) => [-SPAN + (x / GRID) * 2 * SPAN, -SPAN + (y / GRID) * 2 * SPAN]));
      }
    return new Path2D(d || 'M0,0');
  });
}
const fadeOut = (r, a, b) => 1 - clamp((r - a) / (b - a), 0, 1) ** 2 * (3 - 2 * clamp((r - a) / (b - a), 0, 1));

export function buildWorld(levels, topo) {
  const { projection, period, band } = makeProjection();
  const gp = geoPath(projection);
  const countriesGeo = feature(topo, topo.objects.countries).features;
  const geoById = new Map(countriesGeo.map((f) => [String(f.id).padStart(3, '0'), f]));
  const land = new Path2D(gp({ type: 'FeatureCollection', features: countriesGeo }));
  const borders = new Path2D(gp(mesh(topo, topo.objects.countries, (a, b) => a !== b)));
  const sphere = new Path2D(gp({ type: 'Sphere' }));
  const graticule = new Path2D(gp(geoGraticule10()));
  // one trip round the world; with wrapping the map is a band, cropped top and bottom
  const sphereBounds = period ? [[-period / 2, band.y0], [period / 2, band.y1]] : gp.bounds({ type: 'Sphere' });

  const focusId = levels.meta.focus;
  const fieldById = new Map(levels.fields.map((f) => [f.id, f]));
  const subfieldById = new Map(levels.subfields.map((x) => [x.id, x]));
  const famOfSub = (sid) => famOf(fieldById.get(subfieldById.get(sid)?.field)?.name);
  const unis = levels.universities.map((u) => ({
    ...u, kind: 'uni', links: [], dom: [], intl: [], detail: null, loading: null, details: new Map(),
    topMap: new Map(u.tops || []), subs: u.subs || [], excellent: (u.why || []).includes('impact'),
  }));
  const uniById = new Map(unis.map((u) => [u.id, u]));
  // Sizes: the reference institution gets the same radius as the original's (13 units).
  const ref = uniById.get(focusId) || unis[0];
  const RK = 13 / Math.sqrt(ref.works);
  for (const u of unis) { u.R = RK * Math.sqrt(u.works); u.pw = u.works; }
  // significance scale: the reference institution keeps the original's radius
  const mcs = unis.map((u) => u.mc).filter(Boolean).sort((a, b) => a - b), mcMed = mcs[Math.floor(mcs.length / 2)] || 3;
  const impact = (u) => Math.min(4, Math.max(0.25, (u.mc || mcMed) / mcMed));
  const refSig = ref.hc ?? Math.round(ref.works * 0.05 * impact(ref));
  const RKq = 13 / Math.sqrt(Math.max(1, refSig)), qToW = ref.works / Math.max(1, refSig);

  const countries = levels.countries.map((c) => ({ ...c, kind: 'country', slug: c.id.toLowerCase(), links: [], members: [], pw: c.works }));
  const countryById = new Map(countries.map((c) => [c.id, c]));
  for (const u of unis) { u.C = countryById.get(u.country); u.C.members.push(u); }

  // Co-authorship roads: all fields, and physics only. Each view picks one set (useRoads).
  const roadSets = {
    general: { countryLinks: levels.genCountryLinks || levels.countryLinks, uniLinks: levels.genUniLinks || levels.uniLinks, label: 'shared papers' },
    physics: { countryLinks: levels.countryLinks, uniLinks: levels.uniLinks, label: 'shared physics papers' },
  };

  // Place institutions at their real spot, nudged apart so none overlap.
  unis.forEach((u, i) => {
    [u.tx, u.ty] = projection([u.lng, u.lat]);
    u.x = u.tx + 2 * Math.cos(2.39996 * i);
    u.y = u.ty + 2 * Math.sin(2.39996 * i);
  });
  forceSimulation(unis).randomSource(lcg(0.42))
    .force('x', forceX((u) => u.tx).strength(0.4))
    .force('y', forceY((u) => u.ty).strength(0.4))
    .force('c', forceCollide((u) => 1.12 * u.R + 2).iterations(4))
    .stop().tick(320);
  unis.forEach((u) => { delete u.vx; delete u.vy; });

  for (const c of countries) {
    [c.x, c.y] = projection([c.lng, c.lat]);
    c.f = geoById.get(c.iso);
    let box = null;
    if (c.f) {
      c.path = new Path2D(gp(c.f));
      c.Rt = Math.sqrt(gp.area(c.f) / Math.PI);
      const g = c.f.geometry;
      const polys = g.type === 'MultiPolygon' ? g.coordinates.map((p) => ({ type: 'Polygon', coordinates: p })) : [g];
      const main = polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
      // Frame the connected projected landmass nearest the country's anchor. A rotated
      // seam may split a country; fitting both sides would zoom out to almost the whole globe.
      const pieces = projectedSegments(projection, main);
      const bounds = pieces.map((points) => ({
        x0: Math.min(...points.map((p) => p[0])), x1: Math.max(...points.map((p) => p[0])),
        y0: Math.min(...points.map((p) => p[1])), y1: Math.max(...points.map((p) => p[1])),
      }));
      const distance = (b) => Math.hypot(Math.max(b.x0 - c.x, 0, c.x - b.x1), Math.max(b.y0 - c.y, 0, c.y - b.y1));
      box = bounds.sort((a, b) => distance(a) - distance(b))[0] || null;
      // a country whose outline crosses the date line is drawn on both sides of the seam
      const pb = gp.bounds(c.f);
      c.seam = period > 0 && pb[1][0] - pb[0][0] > 0.6 * period;
    }
    c.Rn = clamp(c.Rt || 0, 70, 420);
    let mbox = null;
    for (const u of c.members) {
      if (!period && box && Math.abs(u.x - c.x) > (sphereBounds[1][0] - sphereBounds[0][0]) / 2) continue;
      if (period) u.x = nearest(u.x, c.x, period);
      const b = { x0: u.x - 2 * u.R, y0: u.y - 2 * u.R, x1: u.x + 2 * u.R, y1: u.y + 2 * u.R };
      mbox = mbox ? { x0: Math.min(mbox.x0, b.x0), y0: Math.min(mbox.y0, b.y0), x1: Math.max(mbox.x1, b.x1), y1: Math.max(mbox.y1, b.y1) } : b;
    }
    c.maxR = Math.max(10, ...c.members.map((u) => u.R));
    const n = 17 * c.maxR;
    const ext = (b) => Math.max(b.x1 - b.x0, b.y1 - b.y0);
    if (box && mbox && ext(box) > 3 * Math.max(ext(mbox), n)) {
      // A vast country whose research sits in one corner (Russia: Moscow): frame the institutions with
      // some of the country around them, not the empty middle of the landmass.
      const half = Math.max(ext(mbox), n, 0.3 * ext(box)) / 2, cx = (mbox.x0 + mbox.x1) / 2, cy = (mbox.y0 + mbox.y1) / 2;
      box = { x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half };
    } else if (mbox) {
      box = box ? { x0: Math.min(box.x0, mbox.x0), y0: Math.min(box.y0, mbox.y0), x1: Math.max(box.x1, mbox.x1), y1: Math.max(box.y1, mbox.y1) } : mbox;
    }
    const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
    if (box.x1 - box.x0 < n) { box.x0 = mx - n / 2; box.x1 = mx + n / 2; }
    if (box.y1 - box.y0 < n) { box.y0 = my - n / 2; box.y1 = my + n / 2; }
    c.box = box;
    c.ext = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  }

  return {
    meta: levels.meta, projection, period, band, land, borders, sphere, graticule,
    sphereBox: { x0: sphereBounds[0][0], y0: sphereBounds[0][1], x1: sphereBounds[1][0], y1: sphereBounds[1][1] },
    countries, countryById, unis, uniById, ref, RK, RKq, qToW, mcMed, impact, famOfSub, roadSets, roadKey: null,
    fieldById, subfieldById, subfieldList: levels.subfields, fields: levels.fields, countryNames: levels.countryNames || {}, quality: levels.quality || { measured: false },
    subfields: new Map(levels.subfields.map((x) => ['a' + x.id, x])),
  };
}

// Build the roads for one set of co-authorship links (all fields, or physics).
export function useRoads(W, key) {
  if (W.roadKey === key) return;
  W.roadKey = key;
  const set = W.roadSets[key];
  for (const c of W.countries) c.links = [];
  for (const u of W.unis) { u.links = []; u.dom = []; u.intl = []; }
  const croads = set.countryLinks.map((l) => ({ kind: 'croad', a: W.countryById.get(l.source), b: W.countryById.get(l.target), w: l.weight })).filter((r) => r.a && r.b);
  croads.forEach((r) => { r.a.links.push(r); r.b.links.push(r); });
  markBackbone(W.countries, croads);
  const uroads = set.uniLinks.map((l) => ({ kind: 'uroad', a: W.uniById.get(l.source), b: W.uniById.get(l.target), w: l.weight, hq: key === 'general' ? l.hq ?? null : null })).filter((r) => r.a && r.b);
  for (const r of uroads) {
    r.dom = r.a.C === r.b.C;
    for (const u of [r.a, r.b]) { u.links.push(r); (r.dom ? u.dom : u.intl).push(r); }
  }
  markBackbone(W.unis, uroads.filter((r) => r.dom), 'dom');
  for (const u of W.unis) {
    u.links.sort((a, b) => b.w - a.w);
    u.intl.sort((a, b) => b.w - a.w);
    u.intl.slice(0, 2).forEach((r) => (r.bb = true));
    const byC = new Map();
    for (const r of u.intl) { const C = other(r, u).C; byC.set(C, (byC.get(C) || 0) + r.w); }
    u.xc = [...byC].map(([C, w]) => ({ kind: 'xcroad', u, C, w })).sort((a, b) => b.w - a.w);
    u.xc.forEach((r, i) => (r.bb = i < 1));
  }
  const xcs = W.unis.flatMap((u) => u.xc);
  const minMax = (l) => (l.length ? [Math.min(...l.map((r) => r.w)), Math.max(...l.map((r) => r.w))] : [1, 2]);
  Object.assign(W, { croads, uroads, uroadDom: uroads.filter((r) => r.dom), roadLabel: set.label,
    wC: widthScale(...minMax(croads)), wU: widthScale(...minMax(uroads)), wX: widthScale(...minMax(xcs)) });
}

// Resize and recolour the map for a view: institutions by their papers in it, countries likewise.
export function applyPhase(W, ph, phaseWorks, heat, sigOf, q) {
  useRoads(W, ph.kind === 'physics' ? 'physics' : 'general');
  const inPhase = (sid) => ph.kind === 'general' || ph.subs.has(sid);
  for (const u of W.unis) {
    u.pw = phaseWorks(u, ph);
    u.off = u.pw <= 0 || (ph.kind !== 'general' && !(u.mapped || []).some((s) => ph.subs.has(s))); // nothing to open in this view
    // size by significance (highly cited papers), not by volume
    const sg = sigOf ? sigOf(u, q) : { v: u.pw * 0.05, measured: false };
    u.sig = sg.v; u.sigM = sg.measured;
    u.Rt = W.RKq * Math.sqrt(Math.max(u.sig, 8));
    u.dotR = 2.6 + 0.021 * (326 / Math.sqrt(W.ref.works)) * Math.sqrt(Math.max(u.sig, 8) * W.qToW) * 1.3;
    const mixM = new Map();
    for (const [sid, n] of u.subs) if (inPhase(sid)) { const f = W.famOfSub(sid); mixM.set(f, (mixM.get(f) || 0) + n); }
    u.mix = FAMILIES.filter((f) => mixM.has(f.key)).map((f) => ({ fam: f.key, count: mixM.get(f.key) }));
    u.mixTotal = u.mix.reduce((a, m) => a + m.count, 0) || 1;
    const top = u.subs.find(([sid]) => inPhase(sid));
    u.fam = ph.fam || (top ? W.famOfSub(top[0]) : 'soc');
  }
  const byC = new Map();
  if (heat) for (const e of heat) byC.set(e.inst.cc, (byC.get(e.inst.cc) || 0) + e.n * (e.inst.works ? 1 : 1));
  const qByC = new Map();
  if (q) for (const e of q.rows) qByC.set(e.inst.cc, (qByC.get(e.inst.cc) || 0) + e.n);
  for (const c of W.countries) {
    c.pw = ph.kind === 'general' ? c.works : ph.kind === 'physics' && c.physWorks != null ? c.physWorks : byC.get(c.id) || c.members.reduce((s, u) => s + u.pw, 0);
    c.sig = ph.kind === 'general' && c.hc != null ? c.hc : qByC.get(c.id) || c.members.reduce((s, u) => s + u.sig, 0);
    c.members.sort((a, b) => b.sig - a.sig || b.pw - a.pw);
    c.members.forEach((u, i) => { u.rank = i; u.prevC = i < 4 || u.excellent; });
  }
  const cMax = Math.max(1, ...W.countries.map((c) => c.sig));
  for (const c of W.countries) { c.dotR = 3 + 7 * Math.sqrt(c.sig / cMax); c.off = c.pw <= 0; }
  // partnerships ranked by significance: shared highly cited papers where measured (ties go to the
  // pair whose joint work is more often highly cited), otherwise shared papers weighted by both
  // partners' citation impact. Where the set is measured, a pair with none found stays below any with one.
  const measuredRoads = W.uroads.some((r) => r.hq != null);
  for (const r of W.uroads) {
    const est = r.w * 0.05 * Math.sqrt(W.impact(r.a) * W.impact(r.b));
    r.s = r.hq != null ? r.hq + r.hq / Math.max(r.hq, r.w) : measuredRoads ? Math.min(0.9, est / 1e4) : est;
  }
  for (const r of W.croads) r.s = r.w * Math.sqrt((r.a.sig / Math.max(1, r.a.pw)) * (r.b.sig / Math.max(1, r.b.pw))) ;
}

// Lay out one institution's research areas and researchers from its data file.
export function buildDetail(u, d) {
  const areas = d.areas.map((a) => ({ ...a, kind: 'area', fam: famOf(a.field), links: [], people: [], U: u }));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const aroads = d.areaLinks.map((l) => ({ kind: 'aroad', a: areaById.get(l.source), b: areaById.get(l.target), w: l.weight })).filter((r) => r.a && r.b);
  aroads.forEach((r) => { r.a.links.push(r); r.b.links.push(r); });
  if (aroads.length) markBackbone(areas, aroads);
  areas.slice().sort((a, b) => b.works - a.works).slice(0, 4).forEach((a) => (a.prev = true));

  // Size and rank by career h-index where OpenAlex has the profile, else by papers in the sample.
  const people = d.people.map((p) => ({ ...p, kind: 'person', nb: [], cross: [], U: u, w: p.h ? Math.max(p.papers, p.h / 4) : p.papers }));
  const personById = new Map(people.map((p) => [p.id, p]));
  for (const p of people) { p.A = areaById.get(p.area); p.fam = p.A ? p.A.fam : 'soc'; p.A && p.A.people.push(p); }
  const proads = d.peopleLinks.map((l) => ({ kind: 'proad', a: personById.get(l.source), b: personById.get(l.target), w: l.weight })).filter((r) => r.a && r.b && r.a.A && r.b.A);
  for (const r of proads) {
    r.a.nb.push({ q: r.b, w: r.w, l: r });
    r.b.nb.push({ q: r.a, w: r.w, l: r });
    r.intra = r.a.A === r.b.A;
  }
  for (const p of people) {
    p.nb.sort((a, b) => b.w - a.w);
    const m = new Map();
    for (const n of p.nb) if (n.q.A !== p.A) m.set(n.q.A, (m.get(n.q.A) || 0) + n.w);
    p.cross = [...m].map(([B, w]) => ({ kind: 'xroad', p, B, w })).sort((a, b) => b.w - a.w);
    p.cross.forEach((r, i) => (r.bb = i < 2));
  }
  for (const a of areas) {
    a.people.sort((x, y) => (y.h || 0) - (x.h || 0) || y.papers - x.papers || y.degree - x.degree);
    a.people.slice(0, 4).forEach((p) => (p.prev = true));
    a.intra = proads.filter((r) => r.intra && r.a.A === a);
    a.cross = a.people.flatMap((p) => p.cross);
  }

  // Areas: one sector of the campus per field family, pulled together by shared papers.
  const total = areas.reduce((s, a) => s + a.works, 0) || 1;
  const kScale = Math.sqrt(0.52 / total);
  areas.forEach((a) => (a.lr = kScale * Math.sqrt(a.works)));
  const famW = groupBy(areas, (a) => a.fam);
  const anchor = {};
  let acc = 0;
  for (const f of FAMILIES.filter((f) => famW.has(f.key))) {
    const share = famW.get(f.key).reduce((s, a) => s + a.works, 0) / total;
    const ang = (acc + share / 2) * Math.PI * 2 - Math.PI / 2;
    anchor[f.key] = [0.5 * Math.cos(ang), 0.5 * Math.sin(ang)];
    acc += share;
  }
  const an = areas.map((a, i) => ({ a, r: a.lr, x: anchor[a.fam][0] + 0.06 * Math.cos(2.4 * i), y: anchor[a.fam][1] + 0.06 * Math.sin(2.4 * i) }));
  const anBy = new Map(an.map((n) => [n.a, n]));
  const maxW = Math.max(1, ...aroads.map((r) => r.w));
  forceSimulation(an).randomSource(lcg(0.11)).velocityDecay(0.35)
    .force('fx', forceX((n) => anchor[n.a.fam][0]).strength(0.05))
    .force('fy', forceY((n) => anchor[n.a.fam][1]).strength(0.05))
    .force('l', forceLink(aroads.map((r) => ({ source: anBy.get(r.a), target: anBy.get(r.b), w: r.w })))
      .distance((l) => l.source.r + l.target.r + 0.03).strength((l) => 0.22 * Math.sqrt(l.w / maxW)))
    .force('c', forceCollide((n) => n.r + 0.018).iterations(5))
    .force('box', boxForce(an, 0.97))
    .stop().tick(600);
  boxForce(an, 0.97)();
  an.forEach((n) => { n.a.lx = n.x; n.a.ly = n.y; });

  // Researchers: inside their area, leaning toward the areas they write with.
  for (const a of areas) {
    const nodes = a.people.map((p, i) => {
      let x = 0, y = 0, w = 0;
      for (const c of p.cross) {
        const dx = c.B.lx - a.lx, dy = c.B.ly - a.ly, dd = Math.hypot(dx, dy) || 1;
        x += (c.w * dx) / dd; y += (c.w * dy) / dd; w += c.w;
      }
      const len = Math.hypot(x, y), s = len ? (0.52 * Math.min(1, w / 3)) / len : 0;
      const tx = x * s, ty = y * s;
      return { p, r: (2.2 + 1.05 * Math.sqrt(p.w) + 13) / 330, tx, ty,
        x: tx + 0.25 * Math.cos(2.39996 * i) * Math.sqrt(i / 42), y: ty + 0.25 * Math.sin(2.39996 * i) * Math.sqrt(i / 42) };
    });
    const by = new Map(nodes.map((n) => [n.p, n]));
    forceSimulation(nodes).randomSource(lcg(0.7)).velocityDecay(0.4)
      .force('tx', forceX((n) => n.tx).strength(0.06))
      .force('ty', forceY((n) => n.ty).strength(0.06))
      .force('l', forceLink(a.intra.map((r) => ({ source: by.get(r.a), target: by.get(r.b) }))).distance((l) => l.source.r + l.target.r + 0.09).strength(0.07))
      .force('q', forceManyBody().strength(-0.0025).distanceMax(0.6))
      .force('c', forceCollide((n) => n.r).iterations(4))
      .force('box', boxForce(nodes, 0.84))
      .stop().tick(420);
    boxForce(nodes, 0.84)();
    nodes.forEach((n) => { n.p.home = { x: n.x, y: n.y }; n.p.cur = { x: n.x, y: n.y }; n.p.tgt = n.p.home; n.p.rec = 1; n.p.rt = 1; });
  }
  for (const a of areas) {
    const maxP = Math.max(1, ...a.people.map((p) => p.w));
    const pts = a.people.map((p) => [p.home.x, p.home.y, 0.55 + 0.45 * Math.sqrt(p.w / maxP)]);
    const s2 = 0.28 * 0.14;
    a.paths = territory((x, y) => {
      const r2 = x * x + y * y;
      let o = 0;
      for (const [px, py, w] of pts) { const dx = x - px, dy = y - py; o += w * Math.exp(-(dx * dx + dy * dy) / s2); }
      return (0.42 * Math.exp(-r2 / 0.6728) + 0.58 * (1 - Math.exp(-0.8 * o))) * fadeOut(Math.sqrt(r2), 0.9, 1.07);
    }, [0.12, 0.25, 0.4, 0.56, 0.74]);
  }
  const blobs = areas.map((a) => [a.lx, a.ly, 2 * Math.pow(0.95 * a.lr, 2)]);
  const paths = territory((x, y) => {
    const r2 = x * x + y * y;
    let v = 0.35 * Math.exp(-r2 / 0.72);
    for (const [ax, ay, s] of blobs) { const dx = x - ax, dy = y - ay; v += Math.exp(-(dx * dx + dy * dy) / s); }
    return v * fadeOut(Math.sqrt(r2), 1.02, 1.2);
  }, [0.16, 0.3, 0.48, 0.68, 0.88]);

  const maxPW = Math.max(1, ...proads.map((r) => r.w));
  const maxXW = Math.max(2, ...people.flatMap((p) => p.cross).map((r) => r.w));
  const aw = aroads.map((r) => r.w);
  return {
    areas, areaById, aroads, people, personById, proads, paths,
    wA: widthScale(quantile(aw.slice().sort((x, y) => x - y), 0.25) || 1, quantile(aw.slice().sort((x, y) => x - y), 0.9) || 2), wP: widthScale(1, maxPW), wXP: widthScale(1, maxXW),
    sampleWorks: d.sampleWorks,
  };
}

// Arrange a selected researcher's co-authors in rings around them.
export function arrangeAround(detail, person) {
  for (const p of detail.people) { p.tgt = p.home; p.rt = 1; }
  if (!person) return;
  const A = person.A, c = person.home;
  const ang = (p) => Math.atan2(p.home.y - c.y, p.home.x - c.x);
  const ring = (list, r) => {
    if (!list.length) return;
    list.sort((a, b) => ang(a) - ang(b));
    const n = list.length;
    let sx = 0, sy = 0;
    list.forEach((p, i) => { const d = ang(p) - (2 * i * Math.PI) / n; sx += Math.cos(d); sy += Math.sin(d); });
    const off = Math.atan2(sy, sx);
    list.forEach((p, i) => { const t = off + (2 * i * Math.PI) / n; p.tgt = { x: Math.cos(t) * r, y: Math.sin(t) * r }; });
  };
  person.tgt = { x: 0, y: 0 };
  const near = person.nb.filter((n) => n.q.A === A).map((n) => n.q);
  let i = 0;
  for (const [r, n] of [[0.3, 7], [0.47, 12], [0.63, 18]]) { ring(near.slice(i, i + n), r); i += n; }
  if (i < near.length) ring(near.slice(i), 0.74);
  const keep = new Set([person, ...near]);
  const rest = A.people.filter((p) => !keep.has(p));
  ring(rest, 0.88);
  rest.forEach((p) => (p.rt = 0.28));
}
