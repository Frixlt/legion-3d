// Prepares the game's sound bank from the original CC0 downloads (see docs/ASSETS.md for every source URL).
//
//   SND_SRC=.local/sound node src/audio/tools/prepare-sounds.mjs
//
// SND_SRC holds the unpacked downloads (kenney_rpg-audio/, kenney_impact-sounds/, oga/…, crickets-oneloop.mp3,
// crowd_shouting_0.ogg). For every entry below: decode with ffmpeg (48 kHz float), filter (soften highs, cut rumble),
// trim leading silence, fade the tail, normalise (RMS target with a peak ceiling), encode Opus-in-Ogg into
// src/audio/sounds/<name>.ogg, then write src/audio/bank.gen.ts (base64 of every file — the extension runs in the
// page's MAIN world, where it cannot read its own packaged files, so the bank ships inside the bundle).
// Loops keep an extra LOOP_TAIL seconds at the end: the runtime cross-fades that tail into the head (bank.ts), which
// makes the loop seamless regardless of codec padding.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.env.SND_SRC || '.local/sound');
const OUT = resolve('src/audio/sounds');
const GEN = resolve('src/audio/bank.gen.ts');
const SR = 48000;
const LOOP_TAIL = 1.5;

const K_RPG = 'kenney_rpg-audio/Audio/', K_IMP = 'kenney_impact-sounds/Audio/', FZ = 'oga/fz/Fantozzi-footsteps/flac/';
// soften: no rumble, a gentle high shelf (no harsh clicks/sizzle), optional extra low-pass
const SOFT = 'highpass=f=70,treble=g=-4:f=5500:t=s';
const nums = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/** name, source file(s), channels, ffmpeg filter, rms target dBFS, peak ceiling dBFS, loop length (s) */
const LIST = [
  ...['StoneL1', 'StoneL2', 'StoneL3', 'StoneR1', 'StoneR2', 'StoneR3'].map((n, i) => ({ name: `step_cobble_${i}`, src: `${FZ}Fantozzi-${n}.flac`, af: SOFT + ',lowpass=f=7000', rms: -20, peak: -3, max: 0.4 })),
  ...nums(5, (i) => ({ name: `step_wood_${i}`, src: `${K_IMP}footstep_wood_00${i}.ogg`, af: SOFT + ',lowpass=f=7000', rms: -19, peak: -3 })),
  ...['SandL1', 'SandL2', 'SandL3', 'SandR1', 'SandR2', 'SandR3'].map((n, i) => ({ name: `step_soft_${i}`, src: `${FZ}Fantozzi-${n}.flac`, af: SOFT + ',lowpass=f=5000', rms: -21, peak: -4, max: 0.45 })),
  ...[0, 1, 2, 3, 6, 9].map((n, i) => ({ name: `step_dirt_${i}`, src: `${K_RPG}footstep0${n}.ogg`, af: SOFT + ',lowpass=f=6500', rms: -19, peak: -3 })),
  ...nums(3, (i) => ({ name: `land_${i}`, src: `${K_IMP}impactSoft_medium_00${i}.ogg`, af: SOFT + ',lowpass=f=4000', rms: -17, peak: -3 })),
  ...nums(4, (i) => ({ name: `cloth_${i}`, src: `${K_RPG}cloth${i + 1}.ogg`, af: SOFT + ',lowpass=f=6000', rms: -21, peak: -4 })),
  ...nums(2, (i) => ({ name: `door_open_${i}`, src: `${K_RPG}doorOpen_${i + 1}.ogg`, af: SOFT + ',lowpass=f=6000', rms: -20, peak: -3 })),
  ...nums(3, (i) => ({ name: `door_close_${i}`, src: `${K_RPG}doorClose_${i + 1}.ogg`, af: SOFT + ',lowpass=f=5000', rms: -20, peak: -4 })),
  { name: 'coins_0', src: `${K_RPG}handleCoins.ogg`, af: SOFT + ',lowpass=f=7000', rms: -22, peak: -5 },
  { name: 'coins_1', src: `${K_RPG}handleCoins2.ogg`, af: SOFT + ',lowpass=f=7000', rms: -22, peak: -5 },
  ...nums(3, (i) => ({ name: `paper_${i}`, src: `${K_RPG}bookFlip${i + 1}.ogg`, af: SOFT + ',lowpass=f=5000', rms: -22, peak: -5 })),
  ...nums(3, (i) => ({ name: `tick_${i}`, src: `${K_IMP}impactWood_light_00${i}.ogg`, af: 'highpass=f=200,lowpass=f=4500', rms: -20, peak: -4, max: 0.25 })),
  ...nums(5, (i) => ({ name: `pick_${i}`, src: `${K_IMP}impactMining_00${i}.ogg`, af: SOFT + ',lowpass=f=6500', rms: -18, peak: -3 })),
  ...nums(3, (i) => ({ name: `rock_break_${i}`, src: `oga/bfh/bfh1_rock_breaking_0${i + 1}.ogg`, af: SOFT + ',lowpass=f=6000', rms: -19, peak: -3, max: 1.6 })),
  ...nums(3, (i) => ({ name: `creak_${i}`, src: `${K_RPG}creak${i + 1}.ogg`, af: SOFT + ',lowpass=f=5000', rms: -21, peak: -4 })),
  { name: 'meow_0', src: 'oga/cat_softmew.wav', af: 'highpass=f=250,lowpass=f=5000,afftdn=nf=-40', rms: -20, peak: -3, max: 1.6 },
  { name: 'meow_1', src: 'oga/cat_mewpurr.wav', af: 'highpass=f=150,lowpass=f=5000,afftdn=nf=-40', rms: -20, peak: -3, max: 1.4 },
  // «Драки с котиками» (src/combat): gen/* are made by gen-combat-sfx.mjs (run it first), the rest are Kenney CC0
  ...nums(3, (i) => ({ name: `whoosh_${i}`, src: `gen/gen_whoosh_${i}.wav`, af: 'highpass=f=120,lowpass=f=5000', rms: -21, peak: -5 })),
  ...nums(3, (i) => ({ name: `bonk_${i}`, src: `gen/gen_bonk_${i}.wav`, af: SOFT + ',lowpass=f=4500', rms: -18, peak: -3 })),
  ...nums(2, (i) => ({ name: `twang_${i}`, src: `kenney_interface-sounds/Audio/pluck_00${i + 1}.ogg`, af: 'highpass=f=150,lowpass=f=4000', rms: -20, peak: -4 })),
  ...nums(3, (i) => ({ name: `thunk_${i}`, src: `${K_IMP}impactPlank_medium_00${i}.ogg`, af: SOFT + ',lowpass=f=5000', rms: -19, peak: -3 })),
  ...nums(2, (i) => ({ name: `shimmer_${i}`, src: `gen/gen_shimmer_${i}.wav`, af: 'highpass=f=300,lowpass=f=7000', rms: -22, peak: -6 })),
  { name: 'chime_0', src: 'gen/gen_chime_0.wav', af: 'highpass=f=200,lowpass=f=6000', rms: -22, peak: -6 },
  ...nums(2, (i) => ({ name: `groan_${i}`, src: `gen/gen_groan_${i}.wav`, af: 'highpass=f=100,lowpass=f=3000', rms: -21, peak: -5 })),
  ...nums(2, (i) => ({ name: `poof_${i}`, src: `gen/gen_poof_${i}.wav`, af: 'highpass=f=80,lowpass=f=4000', rms: -21, peak: -5 })),
  // beds (loops): longer, quieter RMS targets; the mix sets their real level
  { name: 'bed_crickets', src: 'crickets-oneloop.mp3', ch: 2, af: 'highpass=f=1500,treble=g=-3:f=9000:t=s', rms: -26, peak: -6, loop: 16, at: 2 },
  { name: 'bed_wind', src: 'oga/wind1.wav', ch: 1, af: 'highpass=f=60,lowpass=f=2500', rms: -24, peak: -6, loop: 20, at: 8 },
  // a busy crowd, layered with itself (offset 9 s) and low-passed: an indistinct far-away murmur, no words
  { name: 'bed_crowd', src: 'crowd_shouting_0.ogg', ch: 2, af: 'highpass=f=120,lowpass=f=1400,lowpass=f=1400', rms: -26, peak: -8, loop: 16, at: 1, layer: 9 },
  { name: 'bed_fire', src: 'oga/fire.wav', ch: 1, af: 'highpass=f=90,treble=g=-3:f=6000:t=s', rms: -24, peak: -6, loop: 12, at: 3 },
  // the drips are very peaky (crest ~32 dB): a gentle compressor softens them so the bed can sit at a normal level
  { name: 'bed_cave', src: 'oga/atmosbasement.mp3_.flac', ch: 2, af: 'highpass=f=50,treble=g=-3:f=5000:t=s,acompressor=threshold=0.015:ratio=6:attack=0.3:release=120:knee=4', rms: -28, peak: -10, loop: 17, at: 1 },
];

function decode(file, ch, af) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', join(SRC, file), '-af', af, '-ac', String(ch), '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`decode ${file}: ${r.stderr}`);
  const b = r.stdout; return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
}
function encode(name, pcm, ch, kbps) {
  const out = join(OUT, name + '.ogg');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(ch), '-i', '-', '-c:a', 'libopus', '-b:a', kbps + 'k', '-application', 'audio', '-map_metadata', '-1', out], { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) });
  if (r.status !== 0) throw new Error(`encode ${name}: ${r.stderr}`);
  return out;
}
const db = (g) => 20 * Math.log10(Math.max(1e-9, g));

function process1(e) {
  const ch = e.ch || 1;
  let x = decode(e.src, ch, e.af);
  const frames = x.length / ch;
  if (e.loop) {
    const len = Math.round((e.loop + LOOP_TAIL) * SR), s0 = Math.round((e.at || 0) * SR);
    if (s0 + len > frames) throw new Error(`${e.name}: source too short`);
    let y = x.slice(s0 * ch, (s0 + len) * ch);
    if (e.layer) {   // add a time-shifted copy (wrapping), both at -3 dB
      const off = Math.round(e.layer * SR);
      const z = new Float32Array(y.length);
      for (let i = 0; i < len; i++) { const j = (s0 + ((i + off) % (frames - s0))) ; for (let c = 0; c < ch; c++) z[i * ch + c] = 0.707 * (y[i * ch + c] + (x[j * ch + c] || 0)); }
      y = z;
    }
    x = y;
  } else {
    // trim leading silence (keep 4 ms), cap the length, 25 ms fade-out
    let st = 0; const th = 10 ** (-48 / 20);
    while (st < frames && Math.abs(x[st * ch]) < th) st++;
    st = Math.max(0, st - Math.round(0.004 * SR));
    let en = frames; const w = Math.round(0.005 * SR);
    for (;;) { let m = 0; for (let i = Math.max(st, en - w); i < en; i++) m = Math.max(m, Math.abs(x[i * ch])); if (m >= th * 0.5 || en - w <= st) break; en -= w; }
    if (e.max) en = Math.min(en, st + Math.round(e.max * SR));
    x = x.slice(st * ch, en * ch);
    const n = x.length / ch, fo = Math.min(n, Math.round(0.025 * SR));
    for (let i = 0; i < fo; i++) for (let c = 0; c < ch; c++) x[(n - fo + i) * ch + c] *= Math.cos((i / fo) * Math.PI / 2);
    for (let i = 0; i < Math.min(n, 48); i++) for (let c = 0; c < ch; c++) x[i * ch + c] *= i / 48;   // 1 ms fade-in: no click
  }
  // normalise: RMS of the active part to the target, then cap the peak
  let sum = 0, cnt = 0, pk = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; if (a > 1e-3) { sum += a * a; cnt++; } }
  const rms = Math.sqrt(sum / Math.max(1, cnt));
  let g = 10 ** (e.rms / 20) / Math.max(1e-6, rms);
  const pkLim = 10 ** (e.peak / 20); if (pk * g > pkLim) g = pkLim / pk;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  const kbps = e.loop ? (ch === 2 ? 56 : 40) : 40;
  const out = encode(e.name, x, ch, kbps);
  return { name: e.name, src: e.src, ch, dur: +(x.length / ch / SR).toFixed(2), peakDb: +db(pk * g).toFixed(1), rmsDb: +db(rms * g).toFixed(1), bytes: statSync(out).size, loop: e.loop || 0 };
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.ogg')) rmSync(join(OUT, f));
const rows = LIST.map(process1);
let total = 0;
for (const r of rows) { total += r.bytes; console.log(`${r.name.padEnd(16)} ${String(r.dur).padStart(6)} s  ch${r.ch}  peak ${r.peakDb} dB  rms ${r.rmsDb} dB  ${(r.bytes / 1024).toFixed(1)} KB`); }
console.log(`total ${(total / 1024).toFixed(0)} KB in ${rows.length} files`);

const lines = rows.map((r) => `  ${r.name}: ${JSON.stringify(readFileSync(join(OUT, r.name + '.ogg')).toString('base64'))},`);
writeFileSync(GEN, `// GENERATED by src/audio/tools/prepare-sounds.mjs — do not edit. Opus-in-Ogg files of src/audio/sounds as base64.
// Sources and licences: docs/ASSETS.md (all CC0). Loops (bed_*) carry a ${LOOP_TAIL} s tail for the runtime cross-fade.
export const LOOP_TAIL = ${LOOP_TAIL};
export const LOOP_LEN: Record<string, number> = ${JSON.stringify(Object.fromEntries(rows.filter((r) => r.loop).map((r) => [r.name, r.loop])))};
export const BANK: Record<string, string> = {
${lines.join('\n')}
};
`);
console.log('wrote', GEN);
