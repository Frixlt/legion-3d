// Deterministic frame-capture renderer for the review video (see scripts/video/README.md).
//
//   node scripts/video/render.mjs [--segments=a,b|--test] [--workers=3] [--gpu] [--w=1920 --h=1080]
//        [--frames=N] [--format=jpeg|png] [--jq=95] [--name=legion-3d-review] [--encoder=libx264|h264_nvenc]
//        [--no-assemble] [--assemble-only] [--bots=20] [--root=.] [--fresh]
//
// Every segment renders in its own headless Chrome: virtual time (video/bundle/director.js) advances exactly
// 1/60 s per frame, the director poses the game, then a real screenshot (3D canvas + DOM UI) goes to
// video/frames/<segment>/NNNNN.jpg. Existing frames are kept (resume: the segment is fast-forwarded with rendering
// off up to the first missing frame). Finally ffmpeg joins the segments with crossfades into video/<name>.mp4.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const ROOT = resolve(opt.root || resolve(here, '../..'));
const OUT = resolve(ROOT, opt.out || 'video');
const W = +(opt.w || 1920), H = +(opt.h || 1080);
const FPS = 60, DT = 1000 / FPS;
const FMT = opt.format === 'png' ? 'png' : 'jpeg', EXT = FMT === 'png' ? 'png' : 'jpg';
const JQ = +(opt.jq || 95);
const WORKERS = Math.max(1, +(opt.workers || 3));
const GPU = !!opt.gpu;
const BOTS = +(opt.bots || 20);
const NAME = opt.name || (opt.test ? 'test' : 'legion-3d-review');
const ENC = opt.encoder || 'libx264';
const LIMIT = opt.frames ? +opt.frames : Infinity;
const ARGS = GPU
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--password-store=basic', '--no-first-run',
     '--disable-features=PasswordManagerEnableSenderService,PasswordLeakDetection']
  : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const EXE = opt.chrome || process.env.CHROMIUM || undefined;

/* ---- bundle */
const BUNDLE = join(OUT, 'bundle', 'director.js');
if (!opt['assemble-only'] && !opt['no-build']) {
  try { await import(pathToFileURL(join(here, 'build.mjs')).href); }
  catch (e) { if (!existsSync(BUNDLE)) throw e; console.log('esbuild unavailable, using prebuilt bundle'); }
}
const bundle = existsSync(BUNDLE) ? readFileSync(BUNDLE, 'utf8') : '';
const pageUrl = (page = 'game') => pathToFileURL(resolve(ROOT, `dist-dev/${page}.html`)).href + `?bots=${BOTS}`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---- browsers
 * default: one Chrome per task (separate GPU processes — parallel SwiftShader rendering);
 * --profile=<dir>: ONE persistent Chrome for the whole run, workers are pages of its single context. Use it on
 * Windows: Chrome probes the OS password once per fresh profile (LogonUser with an empty password → a failed logon
 * in the Security log); a persistent profile caches the probe, so the whole render costs at most one probe. */
const INIT = `try{localStorage.setItem('l3d.quality','3');localStorage.setItem('l3d.cam','fp');localStorage.setItem('l3d.post','1');}catch(e){}\nwindow.__VT_CFG={seed:20261026};\n` + bundle;
let shared = null;   // persistent context (--profile)
async function context() {
  if (opt.profile) {
    if (!shared) {
      shared = await chromium.launchPersistentContext(resolve(opt.profile), { executablePath: EXE, headless: true, args: ARGS, viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await shared.addInitScript({ content: INIT });
      log('persistent Chrome profile', resolve(opt.profile));
    }
    return { ctx: shared, close: async () => {} };
  }
  const b = await chromium.launch({ executablePath: EXE, headless: true, args: ARGS });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript({ content: INIT });
  return { ctx, close: () => b.close().catch(() => {}) };
}
async function openGame(ctx, tag, pg) {
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`.slice(0, 300); logs.push(t); if (/error/i.test(m.type()) || /\[director\]|\[vt\]/.test(t)) console.log(`  ${tag} ${t}`); });
  page.on('pageerror', (e) => console.log(`  ${tag} [pageerror] ${e.message}`));
  await page.goto(pageUrl(pg), { waitUntil: 'load', timeout: 120000 });
  const cdp = await ctx.newCDPSession(page);
  return { page, cdp, logs };
}
const step = (page, n = 1) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__vt.step(dt); return window.__vt.frame; }, [n, DT]);

async function bootSegment(page, id, tag, pg) {
  // boot: step virtual time until the game and the demo exist, fonts are in
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate(([dt, pg]) => { window.__vt.step(dt); return window.__director.booted(pg); }, [DT, pg]);
    if (ok) break;
    if (Date.now() - t0 > 180000) throw new Error('game did not boot in 180 s');
    await new Promise((r) => setTimeout(r, 30));
  }
  log(`${tag} booted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.evaluate((id) => window.__director.init(id), id);
  for (let i = 0; ; i++) {
    const st = await page.evaluate((dt) => { window.__vt.step(dt); return window.__director.status; }, DT);
    if (st === 'ready') break;
    if (st.startsWith('skip:') || st.startsWith('error:')) return st;
    if (i > 3000) return 'error:setup timeout';
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 20));   // let real async work (image decode) progress
  }
  return 'ready';
}

async function capture(cdp, file) {
  const r = await cdp.send('Page.captureScreenshot', FMT === 'png' ? { format: 'png', optimizeForSpeed: true } : { format: 'jpeg', quality: JQ, optimizeForSpeed: true });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
}

async function renderSegment(seg, wi, from = 0, to = Infinity) {
  const tag = `[w${wi}:${seg.id}${from || to < Infinity ? `:${from}-${to}` : ''}]`;
  const dir = join(OUT, 'frames', seg.id);
  mkdirSync(dir, { recursive: true });
  const total = Math.min(LIMIT, Math.round(seg.dur * FPS), to);
  const fname = (i) => join(dir, String(i).padStart(5, '0') + '.' + EXT);
  let first = from; if (!opt.at) while (first < total && existsSync(fname(first))) first++;
  if (first >= total) { log(`${tag} complete (${total} frames), skipped`); return { id: seg.id, status: 'done', frames: total }; }
  const B = await context();
  let page = null;
  try {
    const o = await openGame(B.ctx, tag, seg.page); page = o.page; const cdp = o.cdp;
    const st = await bootSegment(page, seg.id, tag, seg.page);
    if (st !== 'ready') { log(`${tag} ${st}`); writeFileSync(join(dir, 'status.txt'), st); return { id: seg.id, status: st, frames: 0 }; }
    const gl = await page.evaluate(() => { const g = (window.__l3dGame || window.__showcase).engine.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
    log(`${tag} ready · ${W}x${H} · GL ${gl} · preroll ${seg.preroll ?? 90} · frames ${first}..${total - 1}`);
    await step(page, seg.preroll ?? 90);
    await page.evaluate(() => window.__director.go());
    if (opt.at) {
      // stills mode: video/probe/<segment>-<t>.jpg at the given segment times (fast-forward between them)
      mkdirSync(join(OUT, 'probe'), { recursive: true });
      let f = 0;
      for (const at of String(opt.at).split(',').map(Number).sort((a, b) => a - b)) {
        const target = Math.round(at * FPS);
        await page.evaluate(() => window.__director.fast(true));
        while (f < target) { const n = Math.min(60, target - f); await step(page, n); f += n; }
        await page.evaluate(() => window.__director.fast(false));
        await step(page, 1); f++;
        await capture(cdp, join(OUT, 'probe', `${seg.id}-${at}.${EXT}`));
        log(`${tag} still t=${at}`, JSON.stringify(await page.evaluate(() => window.__director.info())));
        if (opt.eval) { try { log(`${tag} eval`, JSON.stringify(await page.evaluate(opt.eval)).slice(0, 4000)); } catch (e) { log(`${tag} eval error`, e.message); } }
      }
      return { id: seg.id, status: 'stills', frames: 0 };
    }
    if (first > 0) {
      log(`${tag} fast-forward ${first} frames`);
      await page.evaluate(() => window.__director.fast(true));
      for (let i = 0; i < first; i += 60) await step(page, Math.min(60, first - i));
      await page.evaluate(() => window.__director.fast(false));
    }
    const t0 = Date.now();
    for (let i = first; i < total; i++) {
      await step(page, 1);
      await capture(cdp, fname(i));
      if ((i - first) % 60 === 59 || i === total - 1) {
        const n = i - first + 1, ms = (Date.now() - t0) / n;
        const info = await page.evaluate(() => window.__director.info());
        log(`${tag} frame ${i + 1}/${total} · ${ms.toFixed(0)} ms/frame · ETA ${((total - i - 1) * ms / 60000).toFixed(1)} min · me ${info?.me} ${info?.mode} room ${info?.room} menu ${info?.menu}`);
      }
    }
    return { id: seg.id, status: 'done', frames: total, ms: (Date.now() - t0) / Math.max(1, total - first) };
  } finally { if (page) await page.close().catch(() => {}); await B.close(); }
}

/* ---- main */
async function segmentList() {
  // the director exposes its list; read it without booting the game (a blank page with the bundle)
  const B = await context();
  try {
    const p = await B.ctx.newPage();
    await p.goto('about:blank');
    await p.setContent('<html><body></body></html>');
    const list = await p.evaluate(() => window.__director.segments);
    await p.close();
    return list;
  } finally { await B.close(); }
}

// the list lives in the page bundle; cached in video/segments.json so --assemble-only needs no browser
const LIST = join(OUT, 'segments.json');
const all = opt['assemble-only'] && existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : await segmentList();
mkdirSync(OUT, { recursive: true }); writeFileSync(LIST, JSON.stringify(all, null, 1));
let segs = opt.segments ? opt.segments.split(',').map((id) => { const s = all.find((x) => x.id === id); if (!s) throw new Error('unknown segment ' + id); return s; })
  : all.filter((s) => (opt.test ? s.test : !s.test));
log(`config: ${W}x${H}@${FPS} · ${FMT}${FMT === 'jpeg' ? ' q' + JQ : ''} · ${GPU ? 'GPU (d3d11)' : 'swiftshader'} · workers ${WORKERS} · bots ${BOTS} · segments ${segs.map((s) => `${s.id}(${s.dur}s)`).join(' ')}`);

const results = new Map();
if (!opt['assemble-only']) {
  // tasks: whole segments, or --chunk=<s> pieces (each piece fast-forwards to its start with rendering off;
  // the simulation is identical, see README «Determinism»)
  const CH = opt.chunk ? Math.max(1, Math.round(+opt.chunk * FPS)) : 0;
  const q = [];
  for (const s of segs.slice().sort((a, b) => b.dur - a.dur)) {
    if (opt.fresh && !opt.at) rmSync(join(OUT, 'frames', s.id), { recursive: true, force: true });
    const n = Math.min(LIMIT, Math.round(s.dur * FPS));
    if (!CH || opt.at) q.push({ s, a: 0, b: Infinity });
    else for (let a = 0; a < n; a += CH) q.push({ s, a, b: Math.min(n, a + CH) });
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(WORKERS, q.length) }, async (_, wi) => {
    for (let k = q.shift(); k; k = q.shift()) {
      const s = k.s, rk = `${s.id}:${k.a}`;
      try { results.set(rk, await renderSegment(s, wi, k.a, k.b)); }
      catch (e) { log(`[w${wi}:${s.id}] FAILED ${e?.stack || e}`); results.set(rk, { id: s.id, status: 'error', frames: 0 }); }
    }
  }));
  log(`render done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
if (shared) { await shared.close().catch(() => {}); shared = null; }

if (!opt['no-assemble'] && !opt.at) {
  const parts = [];
  for (const s of segs) {
    const dir = join(OUT, 'frames', s.id);
    const n = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.' + EXT)).length : 0;
    const st = existsSync(join(dir, 'status.txt')) ? readFileSync(join(dir, 'status.txt'), 'utf8') : '';
    if (!n || /^(skip|error)/.test(st)) { log(`assemble: skipping ${s.id} (${st || 'no frames'})`); continue; }
    const want = Math.min(LIMIT, Math.round(s.dur * FPS));
    if (n < want) log(`assemble: WARNING ${s.id} has ${n}/${want} frames (incomplete — run the render again to resume)`);
    parts.push({ ...s, n, dir });
  }
  if (!parts.length) { log('nothing to assemble'); process.exit(1); }
  const args = ['-y', '-hide_banner', '-loglevel', 'warning'];
  for (const p of parts) args.push('-framerate', String(FPS), '-i', join(p.dir, '%05d.' + EXT));
  // crossfade chain; the fade length of a part is its own xfade (into the next), min 1 frame (= a cut)
  let f = '', last = '[0:v]', len = parts[0].n / FPS;
  for (let i = 1; i < parts.length; i++) {
    const d = Math.max(1 / FPS, Math.min(parts[i - 1].xfade || 0, len / 2, parts[i].n / FPS / 2));
    const off = Math.max(0, len - d);
    f += `${last}[${i}:v]xfade=transition=fade:duration=${d.toFixed(4)}:offset=${off.toFixed(4)}[x${i}];`;
    last = `[x${i}]`; len = off + parts[i].n / FPS;
  }
  f += `${last}format=yuv420p[out]`;
  args.push('-filter_complex', f, '-map', '[out]', '-r', String(FPS));
  if (ENC === 'h264_nvenc') args.push('-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-profile:v', 'high');
  else args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18');
  const mp4 = join(OUT, NAME + '.mp4');
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  log('ffmpeg', parts.map((p) => `${p.id}:${p.n}`).join(' '), '→', mp4);
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) { log('ffmpeg failed', r.status); process.exit(1); }
  const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,r_frame_rate,nb_frames', '-of', 'compact', mp4], { encoding: 'utf8' });
  log('result:', (pr.stdout || '').trim().replace(/\n/g, ' | '));
  void spawn;
}
writeFileSync(join(OUT, NAME + '.results.json'), JSON.stringify([...results.values()], null, 1));
