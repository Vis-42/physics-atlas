// Shows who the quality score picks, from whatever exact paper counts are cached so far (no lookups).
// Run from app/: node scripts/preview-selection.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { readJson } from './cache.mjs';

const src = fs.readFileSync('scripts/fetch-elite.mjs', 'utf8');
const NR = new RegExp(src.match(/const NOT_RESEARCH = \/(.*)\/;/)[1]), SR = new RegExp(src.match(/const STILL_RESEARCH = \/(.*)\/;/)[1]);
const BASE = 'publication_year:2017-2026,type:article|review|preprint|conference-paper|letter|book-chapter';
const e = JSON.parse(fs.readFileSync('.cache/elite.json')).rows, dir = '.cache/snapshot/institutions', recs = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.gz')).sort()) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line), id = r.id.split('/').pop();
    const c = new Map((r.counts_by_year || []).map((y) => [y.year, y.works_count]));
    let w = 0;
    for (let y = 2017; y <= 2026; y++) w += c.get(y) || 0;
    recs.set(id, { id, n: r.display_name, t: r.type, cc: r.country_code, geo: r.geo?.latitude != null, sup: r.is_super_system, w, h: r.summary_stats?.h_index || 0, up: (r.lineage || []).map((l) => l.split('/').pop()).filter((l) => l !== id) });
  }
}
const T = new Set(['education', 'facility', 'nonprofit', 'healthcare', 'company', 'government']), rows = [];
for (const [id, [s, b]] of Object.entries(e)) {
  const r = recs.get(id);
  if (!r || !T.has(r.t) || !r.cc || !r.geo || r.sup || r.w < 500 || (NR.test(r.n) && !SR.test(r.n)) || !r.up.every((a) => ['government', 'healthcare'].includes(recs.get(a)?.t))) continue;
  const j = readJson('.cache/openalex/' + crypto.createHash('sha1').update(`/works?filter=${BASE},authorships.institutions.lineage:${id}&per_page=1&select=id`).digest('hex') + '.json');
  const E = s + b / 10;
  rows.push({ ...r, E, P: j?.meta.count, Q: j ? (E / Math.sqrt(Math.max(j.meta.count, 1000) / 1000)) * (r.h / 100) : null });
}
const k = rows.filter((r) => r.Q != null).sort((a, b) => b.Q - a.Q), top = k.filter((r) => r.E >= 20).slice(0, 240);
const p = (l) => l.map((r) => `${r.n.slice(0, 40)} ${r.cc} ${r.t[0]} E${Math.round(r.E)} P${(r.P / 1000).toFixed(0)}k h${r.h} Q${r.Q.toFixed(1)}`).join('\n');
console.log('counted', k.length, 'score at rank 240', top[239]?.Q?.toFixed(1));
console.log(p(k.slice(0, 30)));
for (const c of ['IN', 'SG', 'IL', 'CH', 'JP', 'KR']) console.log('--' + c + '\n' + p(k.filter((r) => r.cc === c).slice(0, 8)));
for (const q of ['Tata Institute of Fundamental Research', 'SRM Institute of Science and Technology', 'Saveetha University', 'Imperial College London', 'European Organization for Nuclear Research', 'Institute for Advanced Study']) { const r = rows.find((x) => x.n === q); console.log(q, r ? `E${r.E} P${r.P} Q${r.Q?.toFixed(1)}` : 'not eligible'); }
const count = (f) => { const m = {}; for (const r of top) m[f(r)] = (m[f(r)] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).map((x) => x.join(':')).join(' '); };
console.log(count((r) => r.t)); console.log(count((r) => r.cc));
console.log('companies and government\n' + p(top.filter((r) => r.t === 'company' || r.t === 'government').slice(0, 25)));
