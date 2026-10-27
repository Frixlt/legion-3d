// The EDIT trailer's cut: the shot list on the music's beat grid → video/edit/timeline.json.
//
//   node scripts/video/edit-cut.mjs [--grid=scripts/video/edit-grid.json] [--music=../voice/music/edit-v1.mp3]
//
// The music (Lyria, voice/music/edit-v1.mp3, 139.9 BPM) is analysed by voice/music/edit-beats.py into a grid of bars;
// the trailer uses bars 0–32 of the track (cute intro → groove → cute break → build → BIG DROP at bar 20 = 34.37 s →
// brutal → groove) and then jumps to the track's last brutal bar (101.24 s) for the final hit and its cute music-box
// tail under the end card. Everything below is written in bars / beats of THAT edit grid: `at(bar, beat)`.
//
// The grid is kept in the repo (scripts/video/edit-grid.json, a copy of voice/music/edit-grid.json); the music
// file itself is passed with --music (default ../voice/music/edit-v1.mp3, outside the repo).
//
// Timeline schema (consumed by edit-compose.mjs; seconds on the trailer clock, every time snapped to a frame):
//   music: { file, parts: [{ from, to, at }], fadeOut }, fps, duration, grid: { bpm, period, bars: [edit s] }
//   clips: [{ t0, t1, src, map: [[edit s, source s], …] (piecewise linear: speed ramps, freeze = flat),
//             box: [x, y, w, h] (fractions of the frame; full = [0,0,1,1]), zoom: [[edit s, scale, cx, cy], …],
//             punch: [edit s, …] (beat punch-ins), whipIn / whipOut: seconds, pop: s (tile pop-in), freeze: bool,
//             sfx: dB | null (game sound of the clip under the music), fx: { sat, tint } }]
//   texts: [{ t0, t1, text, size: xl|l|m|s, x, y (0..1), rot (deg), color, pop, sub }]
//   cards: [{ t0, t1, kind: title|end }], flashes: [{ t, dur, a }], shakes: [{ t, dur, amp }]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FPS = 60;
const snap = (t) => Math.round(t * FPS) / FPS;
const r3 = (x) => +x.toFixed(4);

/** The trailer's grid: bars [0, SPLICE_BAR) of the track, then the track from TAIL_FROM (its last brutal bar). */
export function editGrid(grid, { spliceBar = 32, tailFrom = null, tailBars = 4.4 } = {}) {
  const P = grid.period, mb = grid.downbeats;
  const tail = tailFrom ?? (() => {
    // the last brutal bar before the closing cute section
    const cute = [...grid.sections].reverse().find((s) => s.kind === 'cute' && s.start > grid.duration * 0.6);
    const bar = cute ? mb.filter((t) => t < cute.start - 0.5).pop() : mb[mb.length - 6];
    return bar;
  })();
  const at0 = mb[spliceBar];
  const bars = mb.slice(0, spliceBar);
  const tailBarsT = mb.filter((t) => t >= tail - 0.01);
  for (const t of tailBarsT) { const e = at0 + (t - tail); if (e <= at0 + tailBars * 4 * P + 0.01) bars.push(e); }
  const end = at0 + tailBars * 4 * P;
  return { period: P, bpm: grid.bpm, bars, music: [{ from: 0, to: at0, at: 0 }, { from: tail, to: tail + (end - at0), at: at0 }], end, spliceAt: at0, tail };
}

/** Window starts of the sources reused from the other cuts (scripts/video/edit.ts `reuse(…, win)`): source times in the
 *  shot list are written RELATIVE to the window, the timeline stores absolute source seconds (lint checks both). */
export const WIN0 = { 'e-fair-fp': 1.2, 'e-fair-jump': 15.6, 'e-gear': 1.0, 'e-map': 2.2, 'e-shop': 3.6, 'e-mine': 3.5, 'e-showcase': 0.5 };

/** The shot list. `at(bar, beat)` = edit seconds. Returns { clips, texts, cards, flashes, shakes }. */
export function shotList(g) {
  const P = g.period;
  const at = (bar, beat = 0) => snap(g.bars[Math.floor(bar)] + ((bar % 1) * 4 + beat) * P);
  const clips = [], texts = [], cards = [], flashes = [], shakes = [];
  const FULL = [0, 0, 1, 1];
  /** a full-frame (or boxed) clip: source `src` from source second `sin`, speed 1 unless map given */
  const clip = (t0, t1, src, sin, o = {}) => {
    const w0 = WIN0[src] || 0;
    sin += w0; if (o.map) o = { ...o, map: o.map.map(([t, v]) => [t, r3(v + w0)]) };
    const c = { t0: snap(t0), t1: snap(t1), src, map: o.map || [[snap(t0), r3(sin)], [snap(t1), r3(sin + (t1 - t0) * (o.speed ?? 1))]], box: o.box || FULL,
      zoom: o.zoom || null, punch: o.punch || [], whipIn: o.whipIn || 0, whipOut: o.whipOut || 0, pop: o.pop || 0, freeze: !!o.freeze,
      sfx: o.sfx ?? null, fx: o.fx || null, z: o.z || 0 };
    clips.push(c); return c;
  };
  /** a freeze-frame: hold source second `sin` for [t0, t1), slow push-in */
  const freeze = (t0, t1, src, sin, o = {}) => clip(t0, t1, src, sin, { ...o, map: [[snap(t0), sin], [snap(t1), sin]], freeze: true,
    zoom: o.zoom || [[snap(t0), 1.0, 0.5, 0.5], [snap(t1), 1.12, o.cx ?? 0.5, o.cy ?? 0.5]], fx: { sat: 1.25, ...(o.fx || {}) } });
  /** a grid of tiles (cols × rows) over [t0, t1); tiles pop in staggered by `stagger` beats */
  const grid = (t0, t1, cols, rows, items, stagger = 0.5, o = {}) => {
    const gap = 0.006, cw = (1 - gap * (cols + 1)) / cols, ch = (1 - gap * (rows + 1) * 16 / 9) / rows;
    items.forEach(([src, sin, sfx], i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      const box = [gap + cx * (cw + gap), gap * 16 / 9 + cy * (ch + gap * 16 / 9), cw, ch].map(r3);
      const s0 = snap(t0 + i * stagger * P);
      clip(s0, t1, src, sin + (s0 - t0) * 0, { box, pop: 0.12, sfx: sfx ?? null, z: 1, ...o });
    });
  };
  const text = (t0, t1, s, o = {}) => texts.push({ t0: snap(t0), t1: snap(t1), text: s, size: o.size || 'l', x: o.x ?? 0.5, y: o.y ?? 0.78, rot: o.rot ?? -2.5, color: o.color || '#ffe08a', pop: o.pop ?? 0.14, sub: o.sub || null });
  const flash = (t, a = 0.85, dur = 0.16) => flashes.push({ t: snap(t), dur, a });
  const shake = (t, dur = 0.5, amp = 14) => shakes.push({ t: snap(t), dur, amp });
  const q = 1;   // one beat

  /* ---------------- INTRO (cute music box), bars 0–4 */
  clip(0, at(1), 'e-fair-fp', 1.25, { zoom: [[0, 1.0, 0.5, 0.5], [at(1), 1.06, 0.5, 0.45]], sfx: -14 });
  clip(at(1), at(2), 'e-summer', 0.3, { sfx: -16 });
  text(at(1, 0.5), at(3), 'очень мирная игра про котиков', { size: 'l', y: 0.8 });
  clip(at(2), at(2, 2), 'e-bench', 0.4, {});
  clip(at(2, 2), at(3), 'e-april', 0.5, {});
  // title card on bar 3, punch-ins on its beats; the drop to the groove on bar 4
  cards.push({ t0: at(3), t1: at(4), kind: 'title' });
  clip(at(3), at(4), 'e-dance', 1.4, { fx: { sat: 0.6, blur: 6, dim: 0.55 }, punch: [at(3, 1), at(3, 2), at(3, 3)] });
  flash(at(4), 0.7);

  /* ---------------- GROOVE (bass), bars 4–13 */
  clip(at(4), at(4, 2), 'e-fair-jump', 0.75, { whipIn: 0.12, sfx: -10 });
  clip(at(4, 2), at(5), 'e-dance', 1.5, { punch: [at(4, 3)], sfx: -10 });
  grid(at(5), at(6), 2, 2, [['e-moods', 0.3, -14], ['e-paws', 0.6], ['e-photo', 0.6], ['e-halloween', 0.5]], 0.25);
  clip(at(6), at(6, 2), 'e-shop', 0.6, { whipIn: 0.12, sfx: -12 });
  clip(at(6, 2), at(7), 'e-shop', 3.1, { punch: [at(6, 2)], sfx: -12 });
  text(at(6), at(7, 0.5), 'смотреть можно. трогать — E', { size: 'm', y: 0.15, rot: 2 });
  clip(at(7), at(7, 3), 'e-mine', 3.4, { sfx: -8, punch: [at(7, 2)] });
  freeze(at(7, 3), at(8), 'e-mine', 3.4 + 3 * P, { cx: 0.5, cy: 0.5 });
  text(at(7, 1), at(8, 1), 'работа. честная. пыльная.', { size: 'm', y: 0.82 });
  clip(at(8), at(8, 2), 'e-gear', 2.2, { whipIn: 0.12, sfx: -12 });
  clip(at(8, 2), at(9), 'e-map', 1.3, { sfx: -12 });
  clip(at(9), at(10, 2), 'e-flight', 0.4, { map: [[at(9), 0.4], [at(10), 0.4 + 2.2], [at(10, 2), 0.4 + 2.2 + 2 * P * 1.5]], sfx: -10, whipIn: 0.12 });
  text(at(9, 1), at(10, 2), 'кот-маг. летает.', { size: 'l', y: 0.2, rot: -3, sub: 'потому что может' });
  clip(at(10, 2), at(11), 'e-showcase', 1.5, { whipIn: 0.12 });
  grid(at(11), at(12), 3, 3, [['e-fair-fp', 2.0], ['e-summer', 1.5], ['e-april', 1.2], ['e-halloween', 1.5], ['e-newyear', 0.4], ['e-mine', 3.0], ['e-gear', 2.8], ['e-map', 3.0], ['e-showcase', 3.5]], 0.125);
  clip(at(12), at(12, 2), 'e-exp-battle', 0.5, { whipIn: 0.12 });
  clip(at(12, 2), at(13), 'e-exp-boss', 0.8, {});
  text(at(12), at(13), 'походы. с боссом.', { size: 'm', y: 0.17, rot: 2, sub: 'прямо со стрима' });

  /* ---------------- CUTE BREAK, bars 13–16 */
  clip(at(13), at(14), 'e-newyear', 0.4, { sfx: -6, punch: [at(13, 3)] });
  text(at(13, 1), at(14, 2), 'снежок. в лицо.', { size: 'l', y: 0.2, sub: 'с любовью' });
  clip(at(14), at(15), 'e-bench', 2.8, { zoom: [[at(14), 1.0, 0.5, 0.4], [at(15), 1.08, 0.5, 0.3]] });
  text(at(14, 0.5), at(15, 2), 'посидеть. посмотреть на звёзды.', { size: 'm', y: 0.84, rot: -1.5 });
  clip(at(15), at(16), 'e-moods', 0.6, { sfx: -12 });
  text(at(15, 1), at(16), 'все такие милые…', { size: 'l', y: 0.8, rot: -2 });

  /* ---------------- BUILD, bars 16–20: «!идея бум» */
  clip(at(16), at(17, 2), 'e-boom', 0.0, { map: [[at(16), 0.0], [at(17, 2), 1.72]], sfx: -10 });
  text(at(16, 1), at(17, 2), 'одна команда в чат', { size: 'm', y: 0.14, rot: 2 });
  text(at(17, 2), at(19), '!идея бум', { size: 'xl', y: 0.5, rot: -4, color: '#ff7a59' });
  clip(at(17, 2), at(18), 'e-boom', 1.72, { map: [[at(17, 2), 1.72], [at(18), 2.06]], sfx: -10 });
  clip(at(18), at(18, 1), 'e-moods', 2.0, {});
  clip(at(18, 1), at(18, 2), 'e-april', 1.6, {});
  clip(at(18, 2), at(18, 3), 'e-dance', 2.6, {});
  freeze(at(18, 3), at(19, 3), 'e-boom', 2.40, { zoom: [[at(18, 3), 1.0, 0.5, 0.55], [at(19, 3), 1.45, 0.5, 0.55]], fx: { sat: 1.4 } });
  text(at(19), at(19, 3), 'очень мирная игра…', { size: 'm', y: 0.84, rot: -2 });
  clip(at(19, 3), at(20), 'e-boom', 2.40, { map: [[at(19, 3), 2.40], [at(20), 2.40]], fx: { dim: 0.9 } });   // the hush before the drop

  /* ---------------- THE DROP (bar 20 = 34.37 s): BOOM in slow motion, then the brawl */
  flash(at(20), 1.0, 0.3); shake(at(20), 0.7, 22);
  // e-boom output seconds 2.3–5.6 are rendered at 0.25× game time (a real slow-mo); a ramp back to 1× after
  // the bang (game 2.30 s = output ≈ 2.47 s of the source) lands two frames after the drop
  clip(at(20), at(21, 2), 'e-boom', 2.44, { map: [[at(20), 2.44], [at(21, 2), 2.44 + 2.57 * 1.0]], sfx: -2, zoom: [[at(20), 1.12, 0.5, 0.5], [at(20, 1), 1.0, 0.5, 0.5]] });
  text(at(21), at(22, 2), 'никто не пострадал*', { size: 'l', y: 0.18, rot: -3 });
  text(at(21, 2), at(22, 2), '*кроме всех', { size: 's', y: 0.29, rot: -3, color: '#fff3c9' });
  clip(at(21, 2), at(22), 'e-slash', 0.45, { whipIn: 0.1, sfx: -6, punch: [at(21, 3)] });
  clip(at(22), at(22, 2), 'e-smash', 0.3, { sfx: -6, punch: [at(22, 1)] });
  clip(at(22, 2), at(23), 'e-orb', 0.3, { sfx: -6, punch: [at(22, 3)] });
  clip(at(23), at(24), 'e-shopfight', 0.4, { sfx: -6, punch: [at(23, 1)] });
  text(at(23, 1), at(24, 2), 'магазин закрыт на учёт', { size: 'l', y: 0.16, rot: 2.5 });
  clip(at(24), at(24, 2), 'e-arrows', 1.05, { sfx: -8, whipIn: 0.1 });
  clip(at(24, 2), at(25), 'e-holy', 0.3, { sfx: -6, punch: [at(24, 3)] });
  clip(at(25), at(26), 'e-zombies', 0.5, { sfx: -6 });
  text(at(25, 1), at(26, 1), 'некромант. хотел дружить', { size: 'm', y: 0.84, rot: -2 });
  grid(at(26), at(27), 3, 3, [['e-slash', 0.9], ['e-smash', 0.6], ['e-orb', 0.8], ['e-zombies', 1.6], ['e-boom', 2.6], ['e-holy', 0.8], ['e-shopfight', 0.9], ['e-arrows', 2.0], ['e-slash', 1.8]], 0.125);
  flash(at(26), 0.5);
  clip(at(27), at(27, 2), 'e-slash', 1.9, { sfx: -8 });
  text(at(27), at(28), 'публика довольна', { size: 'm', y: 0.17, rot: 2 });
  clip(at(27, 2), at(28), 'e-moods', 2.3, { sfx: -10, punch: [at(27, 2)] });

  /* ---------------- GROOVE recap, bars 28–32 */
  grid(at(28), at(29), 2, 2, [['e-flight', 3.0], ['e-photo', 1.4], ['e-gear', 2.5], ['e-map', 3.6]], 0.25);
  clip(at(29), at(29, 2), 'e-fair-fp', 2.6, { whipIn: 0.1 });
  clip(at(29, 2), at(30), 'e-fair-jump', 0.9, {});
  text(at(29), at(30, 1), 'от первого лица. и от третьего.', { size: 'm', y: 0.84, rot: -1.5 });
  clip(at(30), at(31), 'e-exp-boss', 2.2, { zoom: [[at(30), 1.0, 0.5, 0.5], [at(31), 1.1, 0.5, 0.45]] });
  grid(at(31), at(32), 2, 2, [['e-mine', 4.0], ['e-shop', 3.0], ['e-showcase', 4.0], ['e-bench', 3.2]], 0.25);

  /* ---------------- FINAL HIT bar (the track's last brutal bar), then the cute tail under the end card */
  grid(at(32), at(33), 3, 3, [['e-boom', 3.2], ['e-flight', 4.5], ['e-zombies', 2.6], ['e-newyear', 1.6], ['e-dance', 2.2], ['e-shopfight', 1.6], ['e-exp-battle', 2.5], ['e-mine', 4.6], ['e-summer', 2.6]], 0.125, { punch: [] });
  flash(at(33), 0.9, 0.25);
  cards.push({ t0: at(33), t1: snap(g.end), kind: 'end' });
  clip(at(33), snap(g.end), 'e-summer', 1.0, { map: [[at(33), 1.0], [snap(g.end), 3.0]], fx: { sat: 0.7, blur: 5, dim: 0.55 } });
  return { clips, texts, cards, flashes, shakes };
}

export function buildTimeline(grid, { music = '../voice/music/edit-v1.mp3', fadeOut = 1.4 } = {}) {
  const g = editGrid(grid);
  const s = shotList(g);
  return { fps: FPS, duration: snap(g.end), music: { file: music, parts: g.music.map((m) => ({ from: r3(m.from), to: r3(m.to), at: r3(m.at) })), fadeOut, source: grid.source },
    grid: { bpm: g.bpm, period: g.period, bars: g.bars.map(r3), spliceAt: r3(g.spliceAt), tail: r3(g.tail) }, ...s };
}

/** Problems of a timeline (gaps / overlaps of the full-frame layer, too long or too short shots, captions). */
export function lint(tl, sources = null) {
  const out = [];
  const full = tl.clips.filter((c) => c.z === 0).sort((a, b) => a.t0 - b.t0);
  const tiles = tl.clips.filter((c) => c.z === 1);
  // every moment is covered by a full-frame clip or a grid
  const cover = [...full.map((c) => [c.t0, c.t1]), ...tiles.map((c) => [c.t0, c.t1])].sort((a, b) => a[0] - b[0]);
  let end = 0;
  for (const [a, b] of cover) { if (a > end + 1e-6) out.push(`gap ${end.toFixed(3)}–${a.toFixed(3)}`); end = Math.max(end, b); }
  if (end < tl.duration - 1e-6) out.push(`gap at the end ${end.toFixed(3)}–${tl.duration}`);
  for (let i = 1; i < full.length; i++) if (full[i].t0 < full[i - 1].t1 - 1e-6) out.push(`overlap ${full[i - 1].src}/${full[i].src} at ${full[i].t0}`);
  for (const c of full) { const d = c.t1 - c.t0; if (d < 0.2 - 1e-6) out.push(`too short ${c.src} ${d.toFixed(2)} s at ${c.t0}`); if (d > 3.5 && !tl.cards.some((k) => k.t0 <= c.t0 + 1e-6 && k.t1 >= c.t1 - 1e-6)) out.push(`too long ${c.src} ${d.toFixed(2)} s at ${c.t0}`); }
  for (const t of tl.texts) if (t.t1 - t.t0 < 0.8) out.push(`caption too short «${t.text}»`);
  if (sources) for (const c of tl.clips) {
    const s = sources[c.src]; if (!s) { out.push(`unknown source ${c.src}`); continue; }
    for (const [, v] of c.map) if (v < s[0] - 1e-6 || v > s[1] + 1e-6) out.push(`${c.src} at ${c.t0}: source time ${v.toFixed(2)} outside its window ${s[0]}–${s[1]}`);
  }
  return out;
}

/* ---- CLI */
if (import.meta.url === `file://${process.argv[1]}`) {
  const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
  const ROOT = resolve(here, '../..');
  const gridF = resolve(ROOT, opt.grid || 'scripts/video/edit-grid.json');
  const musicF = resolve(ROOT, opt.music || '../voice/music/edit-v1.mp3');
  const tl = buildTimeline(JSON.parse(readFileSync(gridF, 'utf8')), { music: relative(ROOT, musicF) });
  const segF = join(ROOT, 'video', 'segments.json');
  const src = existsSync(segF) ? Object.fromEntries(JSON.parse(readFileSync(segF, 'utf8')).filter((s) => s.cut === 'edit').map((s) => [s.id, s.win || [0, s.dur]])) : null;
  const problems = lint(tl, src);
  mkdirSync(join(ROOT, 'video', 'edit'), { recursive: true });
  const outF = resolve(ROOT, opt.out || 'video/edit/timeline.json');
  writeFileSync(outF, JSON.stringify(tl, null, 1));
  console.log(`timeline: ${tl.duration.toFixed(2)} s · ${tl.clips.length} clips · ${tl.texts.length} captions · ${tl.grid.bpm} BPM · splice ${tl.grid.spliceAt}s ← ${tl.grid.tail}s → ${outF}`);
  for (const p of problems) console.log('  lint:', p);
}
