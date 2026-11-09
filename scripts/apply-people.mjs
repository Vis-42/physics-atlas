// Carries out verify-people.mjs's decisions on public/data/u/*.json, then fixes every reference to a
// researcher who was moved or removed: links inside an institution, "work alike, never written
// together" suggestions (here and elsewhere), and co-authors at other institutions (they now point to
// the person's current home; a co-author no longer on the map stays listed, as not mapped).
// Back up public/data/u first. Run from app/: node scripts/apply-people.mjs  (then build-index.mjs)
import fs from 'node:fs';

const D = JSON.parse(fs.readFileSync('.cache/verify/decisions.json'));
const L = JSON.parse(fs.readFileSync('public/data/atlas.json'));
const bySlug = new Map(L.universities.map((u) => [u.slug, u]));
const files = new Map();
for (const f of fs.readdirSync('public/data/u')) files.set(f.replace('.json', ''), JSON.parse(fs.readFileSync('public/data/u/' + f)));

// where each researcher ends up (one place at most)
const final = new Map(); // id -> { slug, area }
const out = new Map(); // slug -> Set(ids leaving)
const incoming = new Map(); // slug -> [{ p, area }]
const reassign = new Map(); // slug -> Map(id -> area)
for (const list of Object.values(D.bySlug)) for (const d of list) {
  const leave = () => { if (!out.has(d.slug)) out.set(d.slug, new Set()); out.get(d.slug).add(d.id); };
  if (d.action === 'keep') final.set(d.id, { slug: d.slug, area: d.area });
  else if (d.action === 'reassign') { final.set(d.id, { slug: d.slug, area: d.toArea }); if (!reassign.has(d.slug)) reassign.set(d.slug, new Map()); reassign.get(d.slug).set(d.id, d.toArea); }
  else if (d.action === 'move') {
    leave();
    final.set(d.id, { slug: d.to, area: d.toArea });
    const p = files.get(d.slug).people.find((q) => q.id === d.id);
    if (!incoming.has(d.to)) incoming.set(d.to, []);
    incoming.get(d.to).push({ p, area: d.toArea });
  } else leave();
}

const stats = { removed: 0, moved: 0, reassigned: 0, linksDropped: 0, refsUpdated: 0 };
for (const [slug, data] of files) {
  const gone = out.get(slug) || new Set(), re = reassign.get(slug) || new Map();
  stats.removed += data.people.filter((p) => gone.has(p.id)).length;
  data.people = data.people.filter((p) => !gone.has(p.id));
  for (const p of data.people) if (re.has(p.id)) { p.area = re.get(p.id); p.areas = [p.area, ...(p.areas || []).filter((a) => a !== p.area)]; stats.reassigned++; }
  for (const { p, area } of incoming.get(slug) || []) {
    if (data.people.some((q) => q.id === p.id)) continue;
    data.people.push({ ...structuredClone(p), area, areas: [area, ...(p.areas || []).filter((a) => a !== area)], sug: [], degree: 0, movedFrom: true });
    stats.moved++;
  }
  const here = new Set(data.people.map((p) => p.id));
  const before = data.peopleLinks.length;
  data.peopleLinks = data.peopleLinks.filter((l) => here.has(l.source) && here.has(l.target));
  stats.linksDropped += before - data.peopleLinks.length;
  const deg = new Map();
  for (const l of data.peopleLinks) for (const x of [l.source, l.target]) deg.set(x, (deg.get(x) || 0) + 1);
  for (const p of data.people) {
    p.degree = deg.get(p.id) || 0;
    p.sug = (p.sug || []).filter(([q]) => here.has(q));
    p.sugx = (p.sugx || []).flatMap(([aid, s2, name, iname, sc]) => {
      const f = final.get(aid);
      if (!f) return [];
      if (f.slug !== s2) { stats.refsUpdated++; const u = bySlug.get(f.slug); return [[aid, f.slug, name, u.short || u.name, sc]]; }
      return [[aid, s2, name, iname, sc]];
    });
    p.xt = (p.xt || []).map(([aid, name, uid, iname, w, s2]) => {
      const f = final.get(aid);
      if (f && f.slug !== s2) { stats.refsUpdated++; const u = bySlug.get(f.slug); return [aid, name, u.id, u.name, w, f.slug]; }
      if (!f && s2) { stats.refsUpdated++; return [aid, name, uid, iname, w, null]; }
      return [aid, name, uid, iname, w, s2];
    });
  }
  data.verified = { by: 'verify-people.mjs', rules: D.rules, at: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync('public/data/u/' + slug + '.json', JSON.stringify(data));
}
console.log(stats);
