#!/usr/bin/env node
// Site drift report: what changed on the game site since the last snapshot, and what the site has that we do not
// support yet. No browser: downloads the channel page and its scripts (public, GET only) and reads them statically.
//
//   npm run drift                                  # default channel, compare with src/data/site-snapshot.json
//   npm run drift -- https://play.multidonate.ru/c/<channel>/
//   npm run drift -- --local=.local/site-new       # read already downloaded scripts (offline)
//   npm run drift -- --write                       # accept the current site as the new snapshot
//   npm run drift -- --json                        # machine-readable report
//   npm run drift -- --strict                      # exit 2 when anything is new/removed/unsupported
//
// Extracted: building ids (citymap.js run as UMD in node:vm), room ids (city.js `const ROOM = {` keys), look catalog
// (doodle.js `const CATALOG = {` + event looks), game data (game-data.js → self.LG_GAME_DATA: classes and every other
// list of {id}), every `/api/...` path in every script, quest kinds (quest.js `KIND_RU` keys).
// Compared with: the snapshot (new / removed ids) and src/data/supported.json (ids the extension has models/rooms for)
// plus the `/api/...` paths our own src/ uses (a removed endpoint we call = breakage).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'src/data/site-snapshot.json');
const SUPPORTED = join(ROOT, 'src/data/supported.json');
const DEFAULT_URL = 'https://play.multidonate.ru/c/zakvielchannel/';

/* ------------------------------------------------------------------ download */

/** Script URLs of the channel page: <script src> + the ones app.js loads on demand (city, mine, quest…). */
export function scriptUrls(html, appJs, origin, base) {
  const out = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) if (!/pixi/.test(m[1])) out.add(m[1].split('?')[0]);
  for (const m of (appJs || '').matchAll(/(\$\{base\}|['"`]\/(?:site|lib)|\(window\.LG_BASE \|\| ''\) \+ ')([\w/.-]*?\/?[\w-]+\.js)(?:\?v=|['"`])/g)) {
    let p = m[2];
    if (m[1].startsWith('${base}') || m[1].startsWith('(window')) p = base + (p.startsWith('/') ? p : '/' + p);
    else p = m[1].slice(1) + (p.startsWith('/') ? p : '/' + p);
    if (!/bugreport/.test(p)) out.add(p.replace(/\/\/+/g, '/'));
  }
  return [...out].map((p) => (p.startsWith('http') ? p : origin + p));
}

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'legion-3d-drift (+https://github.com/)' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function download(pageUrl) {
  const u = new URL(pageUrl);
  const html = await get(u.href);
  const base = (/LG_BASE="([^"]+)"/.exec(html) || [])[1] || u.pathname.replace(/\/$/, '');
  const appUrl = (/<script[^>]+src="([^"]*\/app\.js)[^"]*"/.exec(html) || [])[1];
  const appJs = appUrl ? await get(new URL(appUrl, u.origin).href) : '';
  const files = {};
  const failed = [];
  const seen = new Set();
  let urls = scriptUrls(html, appJs, u.origin, base);
  // scripts load more scripts on demand (city.js → auction.js, towngen.js…): follow them for a few rounds
  for (let round = 0; round < 3 && urls.length; round++) {
    const todo = urls.filter((x) => !seen.has(x));
    for (const x of todo) seen.add(x);
    await Promise.all(todo.map(async (url) => {
      try { files[url.replace(u.origin, '')] = url.endsWith('/app.js') && appJs ? appJs : await get(url); }
      catch (e) { failed.push(String(e.message || e)); }
    }));
    urls = [];
    for (const src of Object.values(files)) for (const m of src.matchAll(/['"`](\/(?:site|lib)\/[\w/-]+\.js)\?v=/g)) if (!/bugreport/.test(m[1])) urls.push(u.origin + m[1]);
    urls = [...new Set(urls)].filter((x) => !seen.has(x));
  }
  return { files, failed, base };
}

function readLocal(dir) {
  const files = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.js')) files['/' + f] = readFileSync(join(dir, f), 'utf8');
  return { files, failed: [], base: '' };
}

/* ------------------------------------------------------------------ extract */

const pick = (files, name) => { const k = Object.keys(files).find((p) => p.endsWith('/' + name)); return k ? files[k] : null; };

/** The text of a `{ … }` literal starting at the first '{' at or after index i (strings and comments respected). */
export function braceBlock(src, i) {
  const s = src.indexOf('{', i); if (s < 0) return null;
  let d = 0, q = null;
  for (let k = s; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) return null; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k + 2) + 1; if (k <= 0) return null; continue; }
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return src.slice(s, k + 1);
  }
  return null;
}
/** Top-level keys of an object literal text. */
export function topKeys(block) {
  const keys = [];
  let d = 0, q = null, start = true;
  for (let k = 1; k < block.length - 1; k++) {
    const c = block[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === '/' && block[k + 1] === '/') { k = block.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && block[k + 1] === '*') { k = block.indexOf('*/', k + 2) + 1; continue; }
    if (d === 0 && start) {
      const m = /^\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:/.exec(block.slice(k, k + 80));
      if (m) { keys.push(m[2] || m[3]); k += m[0].length - 1; start = false; continue; }
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('{[('.includes(c)) d++;
    else if ('}])'.includes(c)) d--;
    else if (c === ',' && d === 0) start = true;
  }
  return keys;
}
const evalLiteral = (text) => { try { return vm.runInNewContext('(' + text + ')', {}, { timeout: 1000 }); } catch { return null; } };
const literalAfter = (src, re) => { const m = re.exec(src); return m ? braceBlock(src, m.index) : null; };
const sorted = (a) => [...new Set(a)].sort();

export function extract(files) {
  const out = { buildings: [], rooms: [], catalog: {}, gameData: {}, api: [], questKinds: [], scripts: Object.keys(files).sort() };
  const errors = [];
  // buildings — citymap.js is UMD: module.exports = factory()
  const cm = pick(files, 'citymap.js');
  if (cm) {
    try {
      const module = { exports: {} };
      vm.runInNewContext(cm, { module, exports: module.exports, console: { log() {}, warn() {} } }, { timeout: 5000 });
      const M = module.exports;
      out.buildings = sorted((M.BUILDINGS || []).map((b) => b.id));
      out.buildingFlags = Object.fromEntries((M.BUILDINGS || []).filter((b) => b.soon || b.mine || b.magic || b.fair).map((b) => [b.id, ['soon', 'mine', 'magic', 'fair'].filter((f) => b[f])]));
    } catch (e) { errors.push('citymap.js: ' + e.message); }
  } else errors.push('citymap.js not found');
  // rooms — city.js `const ROOM = {`
  const city = pick(files, 'city.js');
  const rb = city && literalAfter(city, /const ROOM = \{/);
  if (rb) out.rooms = sorted(topKeys(rb)); else errors.push('city.js: ROOM not found');
  const fb = city && literalAfter(city, /const FULL = \{/);
  if (fb) out.fullRooms = sorted(topKeys(fb));
  // look catalog — doodle.js `const CATALOG = {` (+ event looks merged into it, e.g. HW_LOOKS)
  const dd = pick(files, 'doodle.js');
  if (dd) {
    const ids = (list) => (Array.isArray(list) ? list.map((x) => (Array.isArray(x) ? x[0] : x)).filter((x) => typeof x === 'string') : []);
    const cat = evalLiteral(literalAfter(dd, /const CATALOG = \{/) || 'null');
    if (cat) for (const [k, v] of Object.entries(cat)) out.catalog[k] = ids(v);
    else errors.push('doodle.js: CATALOG not found');
    for (const m of dd.matchAll(/const ([A-Z_]+_LOOKS) = \{/g)) {
      const extra = evalLiteral(braceBlock(dd, m.index) || 'null');
      if (extra && new RegExp(`CATALOG\\[k\\]\\s*=\\s*CATALOG\\[k\\]\\.concat`).test(dd)) for (const [k, v] of Object.entries(extra)) out.catalog[k] = sorted([...(out.catalog[k] || []), ...ids(v)]);
    }
    for (const k of Object.keys(out.catalog)) if (k !== 'colors') out.catalog[k] = sorted(out.catalog[k]); else delete out.catalog[k];
  }
  // game data — self.LG_GAME_DATA
  const gd = pick(files, 'game-data.js');
  if (gd) {
    try {
      const self = {};
      vm.runInNewContext(gd, { self }, { timeout: 5000 });
      const D = self.LG_GAME_DATA || {};
      out.gameDataVersion = D.v;
      for (const [k, v] of Object.entries(D)) {
        if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && typeof x.id === 'string')) out.gameData[k] = sorted(v.map((x) => x.id));
        else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).length < 400) {
          const vals = Object.values(v);
          // id → name maps (res: ore/wood ids) and id → record maps
          if (vals.length >= 3 && (vals.every((x) => typeof x === 'string') || vals.every((x) => x && typeof x === 'object' && !Array.isArray(x)))) out.gameData[k] = sorted(Object.keys(v));
          else if (Array.isArray(v.keys) && v.keys.every((x) => typeof x === 'string')) out.gameData[k + '.keys'] = sorted(v.keys);
        }
      }
      if (Array.isArray(D.levels)) out.maxLevel = D.levels.length;
    } catch (e) { errors.push('game-data.js: ' + e.message); }
  }
  // api paths in every script
  const api = [];
  for (const src of Object.values(files)) for (const m of src.matchAll(/['"`](\/api\/[A-Za-z0-9_/-]+)/g)) api.push(m[1].replace(/\/$/, ''));
  out.api = sorted(api);
  // quest kinds
  const q = pick(files, 'quest.js');
  const kb = q && literalAfter(q, /const KIND_RU = \{/);
  if (kb) out.questKinds = sorted(topKeys(kb)); else errors.push('quest.js: KIND_RU not found');
  return { data: out, errors };
}

/* ------------------------------------------------------------------ compare */

/** `/api/...` paths used by our own sources. */
export function ourApi(dir = join(ROOT, 'src')) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|js|mjs)$/.test(f)) for (const m of readFileSync(p, 'utf8').matchAll(/['"`](\/api\/[A-Za-z0-9_/-]+)/g)) out.push(m[1].replace(/\/$/, '')); } };
  walk(dir);
  return sorted(out);
}

const diffList = (now = [], was = []) => ({ added: now.filter((x) => !was.includes(x)), removed: was.filter((x) => !now.includes(x)) });

export function compare(cur, snap, sup, ours) {
  const R = { changes: {}, unsupported: {}, broken: [] };
  const lists = {
    buildings: [cur.buildings, snap?.buildings], rooms: [cur.rooms, snap?.rooms], questKinds: [cur.questKinds, snap?.questKinds], api: [cur.api, snap?.api],
  };
  for (const [k, v] of Object.entries(cur.catalog)) lists['catalog.' + k] = [v, snap?.catalog?.[k]];
  for (const [k, v] of Object.entries(cur.gameData)) lists['gameData.' + k] = [v, snap?.gameData?.[k]];
  for (const k of Object.keys(snap?.catalog || {})) if (!cur.catalog[k]) lists['catalog.' + k] = [[], snap.catalog[k]];
  for (const k of Object.keys(snap?.gameData || {})) if (!cur.gameData[k]) lists['gameData.' + k] = [[], snap.gameData[k]];
  if (snap) for (const [k, [now, was]] of Object.entries(lists)) { const d = diffList(now, was || []); if (d.added.length || d.removed.length) R.changes[k] = d; }
  if (sup) {
    const miss = (ids, have) => ids.filter((x) => !have.includes(x));
    const S = sup;
    R.unsupported['buildings (3D model)'] = miss(cur.buildings, S.buildings?.models || []);
    R.unsupported['buildings (room mapping)'] = miss(cur.buildings, Object.keys(S.buildings?.rooms || {}));
    const kinds = S.roomKinds || [];
    R.unsupported['buildings (room kind not implemented → site screen)'] = cur.buildings.filter((b) => { const k = S.buildings?.rooms?.[b]; return k && k !== 'site' && k !== 'none' && !kinds.includes(k); });
    for (const [k, v] of Object.entries(cur.catalog)) if (S.looks?.[k]) R.unsupported['looks.' + k] = miss(v, S.looks[k]);
    R.unsupported.questKinds = miss(cur.questKinds, S.questKinds || []);
    if (S.classes) R.unsupported.classes = miss(cur.gameData.classes || [], S.classes);
    for (const k of Object.keys(R.unsupported)) if (!R.unsupported[k].length) delete R.unsupported[k];
  }
  R.broken = ours.filter((p) => !cur.api.some((a) => a === p || a.startsWith(p + '/') || p.startsWith(a + '/')));
  return R;
}

/** JSON with arrays of primitives on one line (readable diffs, one key per line). */
export function compactJson(o) {
  return JSON.stringify(o, null, 2).replace(/\[\n\s*((?:(?:"[^"\n]*"|-?[\d.]+|true|false|null),?\n\s*)+)\]/g, (_, body) => '[' + body.split(/,?\n\s*/).filter(Boolean).join(', ') + ']');
}

/* ------------------------------------------------------------------ report */

function print(cur, R, meta) {
  const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
  const tty = process.stdout.isTTY;
  const f = (k, s) => (tty ? c[k](s) : s);
  console.log(f('b', `Legion 3D drift — ${meta.source}`));
  console.log(f('d', `scripts: ${cur.scripts.length}${meta.failed.length ? `, failed: ${meta.failed.length}` : ''} · snapshot: ${meta.snapAt || 'none'} · game data v${cur.gameDataVersion || '?'}`));
  console.log(`site: ${cur.buildings.length} buildings, ${cur.rooms.length} rooms, ${Object.values(cur.catalog).reduce((n, l) => n + l.length, 0)} looks, ${Object.keys(cur.gameData).length} data lists, ${cur.api.length} api paths, ${cur.questKinds.length} quest kinds`);
  for (const e of meta.errors) console.log(f('r', `! ${e}`));
  for (const e of meta.failed) console.log(f('y', `! download: ${e}`));
  console.log('\n' + f('b', 'Changed since the snapshot'));
  const ch = Object.entries(R.changes);
  if (!meta.snapAt) console.log(f('d', '  (no snapshot yet — run with --write)'));
  else if (!ch.length) console.log(f('g', '  nothing'));
  for (const [k, d] of ch) {
    if (d.added.length) console.log(`  ${k}: ${f('g', '+ ' + d.added.join(', '))}`);
    if (d.removed.length) console.log(`  ${k}: ${f('r', '− ' + d.removed.join(', '))}`);
  }
  console.log('\n' + f('b', 'Site ids without support (generic fallback in the game)'));
  const un = Object.entries(R.unsupported);
  if (!un.length) console.log(f('g', '  none'));
  for (const [k, l] of un) console.log(`  ${k}: ${f('y', l.join(', '))}`);
  console.log('\n' + f('b', 'API paths we call that the site no longer mentions'));
  console.log(R.broken.length ? '  ' + f('r', R.broken.join(', ')) : f('g', '  none'));
  if (Object.keys(R.changes).length) console.log(f('d', '\nAfter updating the code: npm run drift -- --write   (see docs/EXTENDING.md)'));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const url = args.find((a) => !a.startsWith('--')) || DEFAULT_URL;
  const src = opt.local ? readLocal(opt.local) : await download(url);
  const { data, errors } = extract(src.files);
  const snap = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null;
  const sup = existsSync(SUPPORTED) ? JSON.parse(readFileSync(SUPPORTED, 'utf8')) : null;
  const R = compare(data, snap, sup, ourApi());
  if (opt.json) console.log(JSON.stringify({ site: data, ...R, errors, failed: src.failed }, null, 2));
  else print(data, R, { source: opt.local ? `local ${opt.local}` : url, failed: src.failed, errors, snapAt: snap?.at });
  if (opt.write) {
    if (errors.length) { console.error('\nnot writing the snapshot: extraction errors above'); process.exit(1); }
    const { scripts, ...rest } = data;
    const snapObj = { at: new Date().toISOString().slice(0, 10), source: opt.local ? 'local' : new URL(url).origin + '/c/…', scripts: scripts.map((s) => s.replace(/^\/c\/[^/]+/, '/c/…')), ...rest };
    writeFileSync(SNAPSHOT, compactJson(snapObj) + '\n');
    console.log(`\nsnapshot written: ${SNAPSHOT.replace(ROOT + '/', '')}`);
  }
  if (opt.strict && (Object.keys(R.changes).length || Object.keys(R.unsupported).length || R.broken.length)) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
