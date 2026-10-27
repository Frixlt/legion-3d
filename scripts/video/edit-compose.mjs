// The EDIT trailer's compositor: source shots (video/frames-edit/<id>/NNNNN.jpg) + video/edit/timeline.json → picture,
// music + game sound → video/<name>.mp4. Called by render.mjs --cut=edit after the sources are rendered; also a CLI:
//
//   node scripts/video/edit-compose.mjs [--name=legion-3d-edit] [--w=1920 --h=1080] [--from=S --to=S] [--no-audio]
//        [--still=t1,t2 (PNG-free JPEG stills → video/edit/still-<t>.jpg)] [--sheet (contact sheet of the clips)]
//        [--encoder=h264_nvenc] [--crf=18] [--chrome=…] [--gpu] [--profile=<dir>] [--timeline=video/edit/timeline.json]
//
// Picture: one headless Chrome page draws every output frame on a 2D canvas as a pure function of the frame number
// (no clocks, no randomness): full-frame clips, grids of tiles with a pop-in, punch-in zooms on beats, whip pans with
// motion-blur ghosts, freeze frames, speed ramps (the clip's source-time map), flashes, shakes, the title / end
// cards and the captions (Dela Gothic One + Golos Text). Each frame is captured (CDP screenshot, JPEG q95) and piped
// into ffmpeg (libx264 -preset slow -crf 18 | h264_nvenc), 60 fps, yuv420p, +faststart — no intermediate files.
//
// Sound (video-audio rules): the music LEADS (its spliced parts, 20 ms crossfades, fade-out at the end); the game's
// own sound of selected clips (captured + replayed like the gameplay cut, src/audio) sits UNDER it at the clip's `sfx`
// dB (slow-mo clips are pitched down with their speed). ONE static gain of the sum to −14 LUFS + a limiter, the true
// peak measured on the ENCODED AAC and the ceiling lowered until ≤ −1 dBTP; the video stream is copied when muxing.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[edit]', ...a);
const FPS = 60;

/** Piecewise-linear value of keys [[t, v], …] at t (held outside). */
export function interp(keys, t) {
  if (!keys?.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * (t - a) / (b - a); }
  return keys[keys.length - 1][1];
}
/** Game seconds of a source at its output second t (slow-mo rate keys integrated per frame, like the director). */
export function simOf(rate, t) {
  if (!rate) return t;
  const n = Math.round(t * FPS); let s = 0;
  for (let f = 1; f <= n; f++) s += interp(rate, f / FPS) / FPS;
  return s;
}

/* ------------------------------------------------------------------ the page-side compositor */
const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@600;800&family=Dela+Gothic+One&display=swap">
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style></head><body><canvas id="c"></canvas>
<script>
const C = document.getElementById('c'), X = C.getContext('2d');
let TL = null, W = 1920, H = 1080, K = 1;
const cache = new Map();
const load = (u) => { let p = cache.get(u); if (!p) { p = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; }); cache.set(u, p); if (cache.size > 96) cache.delete(cache.keys().next().value); } return p; };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const interp = (keys, t) => { if (!keys || !keys.length) return 0; if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * (t - a) / (b - a); } return keys[keys.length - 1][1]; };
const easeOut = (u) => 1 - Math.pow(1 - clamp(u), 3);
const back = (u) => { u = clamp(u); const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const FONT_H = '"Dela Gothic One", "Russo One", Impact, sans-serif', FONT_T = '"Golos Text", "Nunito", Arial, sans-serif';
window.setup = (tl, w, h, sources) => { TL = tl; W = w; H = h; K = w / 1920; C.width = w; C.height = h; window.SRC = sources; return Promise.all(['40px "Dela Gothic One"', '800 40px "Golos Text"', '600 40px "Golos Text"'].map((f) => document.fonts.load(f, 'Котики ABC').catch(() => null))).then(() => document.fonts.ready).then(() => document.fonts.check('40px "Dela Gothic One"', 'Котики')); };
// the source frame of a clip at trailer time T (absolute frame number, clamped into what was rendered)
function srcFrame(c, T) {
  const s = interp(c.map, T), S = window.SRC[c.src];
  let f = Math.round(s * 60);
  if (S) f = Math.max(S.f0, Math.min(S.f1 - 1, f));
  return f;
}
const url = (c, f) => 'http://edit.local/f/' + c.src + '/' + String(f).padStart(5, '0') + '.' + window.EXT;
function drawImg(img, c, T, bx, by, bw, bh, dx = 0, alpha = 1) {
  if (!img) { X.fillStyle = '#2a1f4a'; X.fillRect(bx, by, bw, bh); return; }
  let sc = c.zoom ? interp(c.zoom.map((k) => [k[0], k[1]]), T) : 1, cx = c.zoom ? interp(c.zoom.map((k) => [k[0], k[2]]), T) : 0.5, cy = c.zoom ? interp(c.zoom.map((k) => [k[0], k[3]]), T) : 0.5;
  for (const p of c.punch || []) if (T >= p) sc *= 1 + 0.13 * Math.exp(-(T - p) / 0.085);
  // cover the box (crop the source to the box's aspect), then zoom around (cx, cy)
  const ia = img.width / img.height, ba = bw / bh;
  let sw = img.width, sh = img.height; if (ia > ba) sw = sh * ba; else sh = sw / ba;
  sw /= sc; sh /= sc;
  const sx = clamp(cx * img.width - sw / 2, 0, img.width - sw), sy = clamp(cy * img.height - sh / 2, 0, img.height - sh);
  X.globalAlpha = alpha;
  X.drawImage(img, sx, sy, sw, sh, bx + dx, by, bw, bh);
  X.globalAlpha = 1;
}
function fxOn(c) {
  const f = c.fx || {}; const parts = [];
  if (f.sat != null) parts.push('saturate(' + f.sat + ')');
  if (f.blur) parts.push('blur(' + (f.blur * K).toFixed(1) + 'px)');
  X.filter = parts.length ? parts.join(' ') : 'none';
}
function roundRect(x, y, w, h, r) { X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }
async function drawClip(c, T, prev) {
  let [bx, by, bw, bh] = [c.box[0] * W, c.box[1] * H, c.box[2] * W, c.box[3] * H];
  const tile = c.z === 1;
  // tile pop-in (scale with overshoot around the tile centre)
  if (c.pop) { const k = back((T - c.t0) / c.pop), s = 0.55 + 0.45 * k; const mx = bx + bw / 2, my = by + bh / 2; bw *= s; bh *= s; bx = mx - bw / 2; by = my - bh / 2; }
  const img = await load(url(c, srcFrame(c, T)));
  X.save();
  if (tile) { roundRect(bx, by, bw, bh, 16 * K); X.clip(); } else { X.beginPath(); X.rect(bx, by, bw, bh); X.clip(); }
  fxOn(c);
  const wi = c.whipIn && T < c.t0 + c.whipIn ? easeOut((T - c.t0) / c.whipIn) : 1;
  if (wi < 1 && prev) {
    // whip pan: the previous shot (its last frame) leaves to the left, this one comes in from the right, motion ghosts
    const pimg = await load(url(prev, srcFrame(prev, prev.t1 - 1 / 60)));
    for (let g = 0; g < 5; g++) drawImg(pimg, prev, prev.t1 - 1 / 60, bx, by, bw, bh, -wi * bw * 0.7 - g * 26 * K * (1 - wi), g ? 0.22 : 1);
  }
  const off = (1 - wi) * bw * 0.7;
  for (let g = wi < 1 ? 4 : 0; g >= 0; g--) drawImg(img, c, T, bx, by, bw, bh, off + g * 26 * K * (1 - wi), g ? 0.22 : 1);
  X.filter = 'none';
  if (c.fx && c.fx.dim) { X.fillStyle = 'rgba(8,5,22,' + c.fx.dim + ')'; X.fillRect(bx, by, bw, bh); }
  if (c.freeze) { X.fillStyle = 'rgba(255,224,138,0.06)'; X.fillRect(bx, by, bw, bh); }
  X.restore();
  if (tile) { X.lineWidth = 3 * K; X.strokeStyle = 'rgba(255,224,138,0.55)'; roundRect(bx, by, bw, bh, 16 * K); X.stroke(); }
  if (c.freeze) { X.lineWidth = 10 * K; X.strokeStyle = '#ffe08a'; X.strokeRect(bx + 5 * K, by + 5 * K, bw - 10 * K, bh - 10 * K); }
}
const SIZE = { xl: 190, l: 104, m: 72, s: 48 };
function bigText(s, x, y, px, color, rot, scale, alpha, font = FONT_H) {
  X.save(); X.globalAlpha = alpha; X.translate(x, y); X.rotate(rot * Math.PI / 180); X.scale(scale, scale);
  X.font = px + 'px ' + font; X.textAlign = 'center'; X.textBaseline = 'middle';
  const w = X.measureText(s).width, fit = Math.min(1, (W * 0.9) / Math.max(1, w)); X.scale(fit, fit);
  X.lineJoin = 'round'; X.lineWidth = px * 0.2; X.strokeStyle = '#1a0f2e'; X.shadowColor = 'rgba(0,0,0,0.55)'; X.shadowBlur = px * 0.25; X.shadowOffsetY = px * 0.06;
  X.strokeText(s, 0, 0); X.shadowColor = 'transparent'; X.fillStyle = color; X.fillText(s, 0, 0);
  X.restore();
}
function drawText(t, T) {
  if (T < t.t0 || T >= t.t1) return;
  const u = T - t.t0, px = SIZE[t.size] * K;
  const sc = t.pop ? 1.45 - 0.45 * back(u / t.pop) : 1, a = clamp(u / 0.04) * (1 - clamp((T - (t.t1 - 0.08)) / 0.08));
  bigText(t.text, t.x * W, t.y * H, px, t.color, t.rot, sc, a);
  if (t.sub) bigText(t.sub, t.x * W, t.y * H + px * 0.95, Math.round(px * 0.5), '#fff3c9', t.rot, sc, clamp((u - 0.25) / 0.06) * a, '800 ' + FONT_T);
}
function drawCard(k, T) {
  if (T < k.t0 || T >= k.t1) return;
  const u = T - k.t0, P = TL.grid.period;
  if (k.kind === 'title') {
    const beat = Math.floor(u / P), bu = u - beat * P;
    const g = X.createRadialGradient(W / 2, H * 0.52, H * 0.1, W / 2, H * 0.52, H * 0.8); g.addColorStop(0, 'rgba(40,22,80,0.25)'); g.addColorStop(1, 'rgba(8,5,22,0.85)');
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    const s = (0.6 + 0.4 * back(u / 0.25)) * (1 + 0.08 * Math.exp(-bu / 0.09));
    bigText('LEGION 3D', W / 2, H * 0.45, 250 * K, '#ffe08a', -3, s, clamp(u / 0.05));
    bigText('котики · ярмарка · хаос', W / 2, H * 0.64, 54 * K, '#fff3c9', -3, 1, clamp((u - P) / 0.08), '800 ' + FONT_T);
  } else {
    const g = X.createRadialGradient(W / 2, H * 0.5, H * 0.1, W / 2, H * 0.5, H * 0.85); g.addColorStop(0, 'rgba(30,18,64,0.35)'); g.addColorStop(1, 'rgba(8,5,22,0.9)');
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    bigText('Legion 3D', W / 2, H * 0.33, 200 * K, '#ffe08a', -2, 0.6 + 0.4 * back(u / 0.3), clamp(u / 0.05));
    bigText('ярмарка Легиона в 3D · расширение для Chrome', W / 2, H * 0.5, 50 * K, '#f3e6ff', 0, 1, clamp((u - 0.35) / 0.15), '800 ' + FONT_T);
    bigText('github.com/ascorblack/legion-3d/releases/latest', W / 2, H * 0.62, 58 * K, '#ffe08a', 0, 1, clamp((u - 0.6) / 0.15), '800 ' + FONT_T);
    bigText('ни один котик не пострадал**', W / 2, H * 0.8, 40 * K, '#fff3c9', -1.5, 1, clamp((u - 1.4) / 0.15), '800 ' + FONT_T);
    bigText('**пострадали все, но понарошку', W / 2, H * 0.86, 26 * K, '#cdbfe8', -1.5, 1, clamp((u - 2.2) / 0.15), '600 ' + FONT_T);
  }
}
window.frame = async (n) => {
  const T = n / 60;
  X.setTransform(1, 0, 0, 1, 0, 0); X.filter = 'none'; X.globalAlpha = 1;
  X.fillStyle = '#120d26'; X.fillRect(0, 0, W, H);
  // shake (deterministic: a function of time)
  let sx = 0, sy = 0;
  for (const s of TL.shakes) { const u = (T - s.t) / s.dur; if (u >= 0 && u < 1) { const a = s.amp * K * (1 - u) * (1 - u); sx += Math.sin(T * 91) * a; sy += Math.sin(T * 67 + 1.3) * a; } }
  X.setTransform(1, 0, 0, 1, sx, sy);
  const act = TL.clips.filter((c) => T >= c.t0 && T < c.t1).sort((a, b) => a.z - b.z || a.t0 - b.t0);
  // grids: dark backdrop (already), tiles over it
  for (const c of act) {
    const prev = c.whipIn ? TL.clips.find((p) => p.z === 0 && p !== c && Math.abs(p.t1 - c.t0) < 1e-3) : null;
    await drawClip(c, T, prev);
  }
  X.setTransform(1, 0, 0, 1, 0, 0);
  for (const k of TL.cards) drawCard(k, T);
  for (const t of TL.texts) drawText(t, T);
  for (const f of TL.flashes) { const u = (T - f.t) / f.dur; if (u >= 0 && u < 1) { X.fillStyle = 'rgba(255,250,235,' + (f.a * (1 - u) * (1 - u)).toFixed(3) + ')'; X.fillRect(0, 0, W, H); } }
  // final fade to black over the last 0.5 s
  const fo = clamp((T - (TL.duration - 0.5)) / 0.5); if (fo > 0) { X.fillStyle = 'rgba(0,0,0,' + fo + ')'; X.fillRect(0, 0, W, H); }
  return act.length;
};
</script></body></html>`;

/* ------------------------------------------------------------------ helpers */
function sourcesOf(tl, frames, ext) {
  const S = {};
  for (const id of new Set(tl.clips.map((c) => c.src))) {
    const dir = join(frames, id);
    const fs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.' + ext)).map((f) => +f.slice(0, 5)).sort((a, b) => a - b) : [];
    S[id] = fs.length ? { f0: fs[0], f1: fs[fs.length - 1] + 1, n: fs.length } : { f0: 0, f1: 1, n: 0 };
  }
  return S;
}

export async function compose(o) {
  const ROOT = o.root, OUT = o.out, NAME = o.name || 'legion-3d-edit', EXT = o.ext || 'jpg', W = o.w || 1920, H = o.h || 1080;
  const tlF = resolve(ROOT, o.opt?.timeline || 'video/edit/timeline.json');
  if (!existsSync(tlF) || o.opt?.recut) {
    const cut = await import(pathToFileURL(join(here, 'edit-cut.mjs')).href);
    const grid = JSON.parse(readFileSync(resolve(ROOT, 'scripts/video/edit-grid.json'), 'utf8'));
    mkdirSync(dirname(tlF), { recursive: true });
    writeFileSync(tlF, JSON.stringify(cut.buildTimeline(grid), null, 1));
    log('timeline built →', tlF);
  }
  const tl = JSON.parse(readFileSync(tlF, 'utf8'));
  const S = sourcesOf(tl, o.frames, EXT);
  const missing = Object.entries(S).filter(([, v]) => !v.n).map(([k]) => k);
  if (missing.length) log('WARNING sources without frames (drawn as placeholders):', missing.join(' '));
  const from = Math.round((+(o.opt?.from) || 0) * FPS), to = Math.min(Math.round(tl.duration * FPS), o.opt?.to ? Math.round(+o.opt.to * FPS) : Infinity);
  log(`config: ${W}x${H}@${FPS} · ${tl.duration.toFixed(2)} s (${from}..${to - 1}) · ${tl.clips.length} clips · ${tl.texts.length} captions · ${Object.keys(S).length} sources · music ${tl.music.file}`);

  const args = ['--no-sandbox', ...(o.gpu ? (o.args || []) : [])];
  const b = o.profile ? await chromium.launchPersistentContext(resolve(o.profile), { executablePath: o.chrome, headless: true, args, viewport: { width: W, height: H } })
    : await chromium.launch({ executablePath: o.chrome, headless: true, args });
  const ctx = o.profile ? b : await b.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.route('http://edit.local/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    const m = /^\/f\/([^/]+)\/(\d+\.\w+)$/.exec(u.pathname);
    const f = m && join(o.frames, m[1], m[2]);
    return f && existsSync(f) ? r.fulfill({ contentType: 'image/jpeg', body: readFileSync(f) }) : r.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://edit.local/', { waitUntil: 'load' });
  await page.evaluate((e) => { window.EXT = e; }, EXT);
  const fontsOk = await page.evaluate(([tl, w, h, s]) => window.setup(tl, w, h, s), [tl, W, H, S]);
  log('fonts', fontsOk ? 'Dela Gothic One loaded' : 'FALLBACK (no Google Fonts: Impact/Arial)');
  const cdp = await ctx.newCDPSession(page);
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true })).data, 'base64');
  try {
    if (o.opt?.still) {
      mkdirSync(join(OUT, 'edit'), { recursive: true });
      for (const t of String(o.opt.still).split(',').map(Number)) { await page.evaluate((n) => window.frame(n), Math.round(t * FPS)); writeFileSync(join(OUT, 'edit', `still-${t}.jpg`), await shot()); }
      log('stills →', join(OUT, 'edit'));
      return { stills: true };
    }
    // the picture: frames piped into ffmpeg
    const video = join(OUT, NAME + (o.audio !== false ? '.video.mp4' : '.mp4'));
    const enc = o.encoder === 'h264_nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', String(o.crf || 18), '-b:v', '0', '-profile:v', 'high']
      : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf || 18), '-profile:v', 'high'];
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-', ...enc, '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res) => ff.on('close', res));
    const t0 = Date.now();
    for (let n = from; n < to; n++) {
      await page.evaluate((k) => window.frame(k), n);
      const buf = await shot();
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if ((n - from) % 120 === 119 || n === to - 1) { const ms = (Date.now() - t0) / (n - from + 1); log(`frame ${n + 1}/${to} · ${ms.toFixed(0)} ms/frame · ETA ${((to - n - 1) * ms / 60000).toFixed(1)} min`); }
    }
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error('ffmpeg (picture) failed ' + code);
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate,nb_frames', '-of', 'compact', video], { encoding: 'utf8' });
    log('picture:', (pr.stdout || '').trim().replace(/\n/g, ' | '));
    if (o.audio === false) return { video };
    await page.close();
    return await soundtrack({ ...o, tl, video, from: from / FPS, to: to / FPS, browser: b, NAME });
  } finally { await b.close().catch(() => {}); }
}

/* ------------------------------------------------------------------ the soundtrack */
async function soundtrack(o) {
  const A = await import(pathToFileURL(join(here, 'audio.mjs')).href);
  const { tl, OUT = o.out, NAME } = { ...o, OUT: o.out };
  const segs = Object.fromEntries((o.segs || JSON.parse(readFileSync(join(o.out, 'segments.json'), 'utf8'))).map((s) => [s.id, s]));
  const abundle = readFileSync(join(o.out, 'bundle', 'audio.js'), 'utf8');
  // 1. the game sound of every source a clip wants (rendered once per source, game time)
  const want = [...new Set(tl.clips.filter((c) => c.sfx != null && !c.freeze && c.t1 > (o.from || 0) && c.t0 < (o.to || tl.duration)).map((c) => c.src))];
  const wavs = {};
  const AARGS = ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
  const ab = o.profile ? o.browser : await chromium.launch({ executablePath: o.chrome, headless: true, args: AARGS });
  try {
    for (const id of want) {
      const capF = join(o.frames, id, 'audio.json'), wav = join(o.frames, id, 'audio.wav');
      if (!existsSync(capF)) { log(`audio: no capture for ${id} (run the render again or --audio-only) — its sound is left out`); continue; }
      const cap = JSON.parse(readFileSync(capF, 'utf8'));
      cap.dur = cap.simDur || cap.dur;
      if (!existsSync(wav) || o.opt?.['fresh-audio']) { const r = await A.renderSegment(ab, abundle, cap, wav); log(`audio: ${id} ${r.voices} voices, peak ${r.peakDb.toFixed(1)} dBFS`); }
      wavs[id] = wav;
    }
  } finally { if (!o.profile) await ab.close(); }
  // 2. the mix: music parts (they lead) + game sound slices under them
  const inputs = [], f = [], mixIn = [];
  const music = resolve(o.root, o.opt?.music || tl.music.file);   // --music=<file> on another machine
  const T0 = o.from || 0, T1 = o.to || tl.duration, LEN = T1 - T0;
  tl.music.parts.forEach((p, i) => {
    const a = Math.max(p.at, T0), b = Math.min(p.at + (p.to - p.from), T1); if (b <= a) return;
    inputs.push('-i', music); const k = inputs.length / 2 - 1;
    const xf = 0.02;
    f.push(`[${k}:a]atrim=start=${(p.from + a - p.at).toFixed(4)}:end=${(p.from + b - p.at + xf).toFixed(4)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,afade=t=in:d=${i ? xf : 0.005},afade=t=out:st=${(b - a).toFixed(4)}:d=${xf},adelay=${Math.round((a - T0) * 1000)}:all=1[m${i}]`);
    mixIn.push(`[m${i}]`);
  });
  tl.clips.forEach((c, i) => {
    if (c.sfx == null || c.freeze || !wavs[c.src]) return;
    const a = Math.max(c.t0, T0), b = Math.min(c.t1, T1); if (b - a < 0.05) return;
    const seg = segs[c.src] || {};
    const s0 = simOf(seg.rate, interp(c.map, a)), s1 = simOf(seg.rate, interp(c.map, b));
    const k0 = (s1 - s0) / (b - a);           // game seconds per trailer second (< 1 = slow-mo → pitched down)
    if (k0 <= 0.05) return;
    inputs.push('-i', wavs[c.src]); const k = inputs.length / 2 - 1;
    const rate = k0 === 1 ? '' : `asetrate=${Math.round(48000 * k0)},aresample=48000,`;
    f.push(`[${k}:a]atrim=start=${s0.toFixed(4)}:end=${s1.toFixed(4)},asetpts=PTS-STARTPTS,${rate}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${c.sfx}dB,afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, b - a - 0.03).toFixed(4)}:d=0.03,adelay=${Math.round((a - T0) * 1000)}:all=1[s${i}]`);
    mixIn.push(`[s${i}]`);
  });
  const fo = tl.music.fadeOut || 1.2;
  f.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:dropout_transition=0,atrim=end=${LEN.toFixed(4)},afade=t=out:st=${Math.max(0, LEN - fo).toFixed(4)}:d=${fo}[out]`);
  const raw = join(OUT, NAME + '.raw.wav');
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-c:a', 'pcm_f32le', '-ar', '48000', raw], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg (mix) failed');
  log(`mix: ${mixIn.length} inputs (${mixIn.filter((x) => x.startsWith("[m")).length} music parts, ${mixIn.filter((x) => x.startsWith("[s")).length} game-sound slices) → ${raw}`);
  // 3. master −14 LUFS, ≤ −1 dBTP on the encoded file, mux (video copied)
  const res = A.joinAndMaster({ parts: [{ wav: raw, fade: 0 }], video: o.video, outMp4: join(OUT, NAME + '.mp4'), rawWav: join(OUT, NAME + '.sum.wav'), masterWav: join(OUT, NAME + '.wav'), target: -14, ceiling: -1 });
  const meta = { name: NAME, duration: LEN, mix: { lufs: res.final.I, truePeak: res.final.TP, gainDb: +res.gain.toFixed(2), limiterDb: +res.limiter.toFixed(2) }, sfx: tl.clips.filter((c) => c.sfx != null && wavs[c.src]).map((c) => ({ t: c.t0, src: c.src, db: c.sfx })) };
  writeFileSync(join(OUT, NAME + '.audio.json'), JSON.stringify(meta, null, 1));
  log(`soundtrack: ${NAME}.mp4 · ${res.final.I} LUFS · TP ${res.final.TP} dBTP`);
  return { video: o.video, mp4: join(OUT, NAME + '.mp4'), ...meta };
}

/* ---- CLI (picture + sound from existing source frames) */
if (import.meta.url === `file://${process.argv[1]}`) {
  const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
  const ROOT = resolve(here, '../..'), OUT = resolve(ROOT, opt.out || 'video');
  const W = +(opt.w || 1920), H = +(opt.h || 1080);
  await compose({ root: ROOT, out: OUT, frames: join(OUT, 'frames-edit'), ext: opt.format === 'png' ? 'png' : 'jpg', name: opt.name || 'legion-3d-edit', w: W, h: H,
    encoder: opt.encoder, crf: opt.crf, audio: !opt['no-audio'], chrome: opt.chrome || process.env.CHROMIUM, gpu: !!opt.gpu, profile: opt.profile, opt });
}
