// The local cache of OpenAlex answers. Nothing is bulk-downloaded: OpenAlex counts and ranks on its
// side (group_by, sort by citations), so each answer is a short tally or the few hundred most-cited
// papers of one scope. Answers are stored gzip-compressed (JSON shrinks about 8×), and every fetch
// stops cleanly when the disk gets low; all steps resume from the cache on the next run.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const MIN_FREE = Number(process.env.MIN_FREE_GB || 3) * 2 ** 30;
export const has = (f) => fs.existsSync(f + '.gz') || fs.existsSync(f);
export function readJson(f) {
  try {
    if (fs.existsSync(f + '.gz')) return JSON.parse(zlib.gunzipSync(fs.readFileSync(f + '.gz')));
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return null;
}
export function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; }
}
let writes = 0;
export function writeJson(f, obj) {
  if (writes++ % 50 === 0 && freeBytes(path.dirname(f)) < MIN_FREE) {
    console.warn(`stopping: less than ${MIN_FREE / 2 ** 30} GB of disk left (everything fetched so far is kept; free some space and rerun)`);
    process.exit(3);
  }
  const tmp = f + '.gz.part';
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(obj)));
  fs.renameSync(tmp, f + '.gz'); // never leaves a half-written answer behind
  if (fs.existsSync(f)) fs.rmSync(f);
}
// cached answer files (compressed or not), by their bare .json name
export const listCache = (dir) => fs.existsSync(dir) ? [...new Set(fs.readdirSync(dir).filter((n) => /\.json(\.gz)?$/.test(n)).map((n) => n.replace(/\.gz$/, '')))] : [];

// One-off: compress what earlier runs stored uncompressed. Run: node scripts/cache.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache');
  let before = 0, after = 0, n = 0;
  for (const d of ['openalex', 'samples']) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const f = path.join(dir, name), text = fs.readFileSync(f);
      let obj; try { obj = JSON.parse(text); } catch { continue; } // leave unreadable files alone
      before += text.length;
      writeJson(f, obj);
      after += fs.statSync(f + '.gz').size; n++;
    }
  }
  console.log(`compressed ${n} answers: ${(before / 2 ** 20).toFixed(0)} MB → ${(after / 2 ** 20).toFixed(0)} MB`);
}
