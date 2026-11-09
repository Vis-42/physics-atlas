// Search across countries, institutions, views (fields, subfields, topics), areas and people.
import { fold } from './util';
import { A } from './atlas';

// ---------- search
export function searchItems(q, people) {
  const W0 = A.W, s = fold(q.trim());
  if (!s || !W0) return [];
  const score = (n, short, alt) => (n.startsWith(s) || (short && short.startsWith(s)) ? 4 : n.split(/[\s,\-]+/).some((w) => w.startsWith(s)) ? 3 : n.includes(s) ? 2 : alt && alt.includes(s) ? 1 : 0);
  const out = [];
  if (A.researchMode !== 'institutions' && A.net) for (const p of A.net.people) {
    const sc = score(fold(p.name), '', fold(p.iname));
    if (sc) out.push({sc:sc+1, ko:-2, size:p.score, kind:'netp', item:p, name:p.name, sub:`Researcher in this view · ${p.iname}`});
  }
  for (const c of W0.countries) { const sc = score(fold(c.name), fold(c.id), ''); if (sc) out.push({ sc, ko: -1, size: c.pw, kind: 'country', item: c, name: c.name, sub: `Country · ${c.members.length} institutions held` }); }
  for (const u of W0.unis) { const sc = score(fold(u.name), fold(u.short), fold(u.short + ' ' + u.city + ' ' + u.C.name)); if (sc) out.push({ sc, ko: 0, size: u.pw, kind: 'uni', item: u, name: u.name, sub: `Institution · ${u.city}, ${u.C.name}${u.excellent ? ' · centre of excellence' : ''}` }); }
  // views: fields, subfields and topics (each opens a heat map of where that work happens)
  for (const f of W0.fields) { const sc = score(fold(f.name), '', fold(f.domain || '')); if (sc) out.push({ sc: sc + 0.5, ko: 0.5, size: 1e9, kind: 'phase', key: 'f' + f.id, item: f, name: f.name, sub: 'Field · show where this work happens' }); }
  for (const x of W0.subfieldList) { const sc = score(fold(x.name), '', ''); if (sc) out.push({ sc: sc + 0.4, ko: 0.6, size: 1e8, kind: 'phase', key: 's' + x.id, item: x, name: x.name, sub: `Subfield of ${W0.fieldById.get(x.field)?.name || ''} · heat map` }); }
  if (A.topics && s.length >= 3) {
    let n = 0;
    for (const t of A.topics) {
      if (!t.n.includes(s)) continue;
      const sc = fold(t.name).startsWith(s) ? 3.5 : fold(t.name).includes(s) ? 2.5 : 1.2;
      out.push({ sc, ko: 0.7, size: t.works, kind: 'phase', key: 't' + t.id.slice(1), item: t, name: t.name, sub: `Topic · ${W0.subfieldById.get(t.sub)?.name || ''} · heat map` });
      if (++n > 40) break;
    }
  }
  const v = A.view.uni;
  if (v && v.detail) for (const a of v.detail.areas) { const sc = score(fold(a.name), '', fold(a.field)); if (sc) out.push({ sc, ko: 1, size: a.works, kind: 'area', item: a, name: a.name, sub: `Research area · ${v.short}` }); }
  if (people && s.length >= 2) {
    for (const p of people) {
      if (!p.n.includes(s)) continue;
      const sc = p.n.startsWith(s) ? 4 : p.n.split(/[\s\-]+/).some((w) => w.startsWith(s)) ? 3 : 2;
      const area = W0.subfields.get(p.area);
      out.push({ sc, ko: 2, size: p.papers, kind: 'personRef', item: p, name: p.name, sub: `Researcher · ${area ? area.name : ''} · ${p.U.short}` });
    }
  }
  return out.sort((a, b) => b.sc - a.sc || a.ko - b.ko || b.size - a.size).slice(0, 12);
}
