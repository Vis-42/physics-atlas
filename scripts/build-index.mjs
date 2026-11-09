// Writes public/data/people.json: every researcher's name, institution and area, for search.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
// every held institution (atlas.json), falling back to the physics list
const levels = JSON.parse(fs.readFileSync(path.join(DATA, fs.existsSync(path.join(DATA, 'atlas.json')) ? 'atlas.json' : 'levels.json'), 'utf8'));
const rows = [];
levels.universities.forEach((u, ui) => {
  const f = path.join(DATA, 'u', u.slug + '.json');
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const p of d.people) rows.push([p.name, ui, p.area, p.id, p.h ?? p.papers]);
});
fs.writeFileSync(path.join(DATA, 'people.json'), JSON.stringify(rows));
console.log('people', rows.length);
