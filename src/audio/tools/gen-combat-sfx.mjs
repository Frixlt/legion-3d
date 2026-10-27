// Procedural one-shots for «Драки с котиками» (src/combat), written as WAV sources for prepare-sounds.mjs:
//
//   SND_SRC=.local/sound node src/audio/tools/gen-combat-sfx.mjs     (then run prepare-sounds.mjs)
//
// Everything here is synthesised (original, CC0) except the cushion thump, which layers a synthesised cartoon "bonk"
// over Kenney's impactSoft_heavy (CC0, kenney_impact-sounds/). Soft attacks (≥ 4 ms), gentle tops (no sizzle), short
// tails. Deterministic (seeded noise), so the bank does not change between runs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.env.SND_SRC || '.local/sound');
const OUT = join(SRC, 'gen');
const SR = 48000;
mkdirSync(OUT, { recursive: true });

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const len = (s) => Math.round(s * SR);

/** Chamberlin state-variable filter: returns {lp, bp, hp} per call. */
function svf() {
  let lp = 0, bp = 0;
  return (x, fc, q) => {
    const f = 2 * Math.sin(Math.PI * Math.min(0.45, fc / SR));
    lp += f * bp; const hp = x - lp - bp / q; bp += f * hp;
    return { lp, bp, hp };
  };
}
const env = (t, a, d) => (t < a ? Math.sin((t / a) * Math.PI / 2) ** 2 : Math.exp(-(t - a) / d));

function wav(name, x) {
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const g = pk > 0 ? 0.7 / pk : 1;
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * g * 32767))), 44 + i * 2);
  writeFileSync(join(OUT, name + '.wav'), b);
  console.log('gen', name, (x.length / SR).toFixed(2) + ' s');
}

/** Soft cartoon whoosh: noise through a resonant band-pass sweeping up then down, swelling and fading. */
function whoosh(dur, f0, f1, f2, q) {
  const n = len(dur), x = new Float32Array(n), f = svf(), f2b = svf();
  for (let i = 0; i < n; i++) {
    // the sound is played when the fast part of the swing starts: swell quickly (~70 ms), then trail off
    const t = i / n, P = 0.28, fc = t < P ? f0 + (f1 - f0) * Math.sin((t / P) * Math.PI / 2) : f1 + (f2 - f1) * ((t - P) / (1 - P));
    const a = t < P ? Math.sin((t / P) * Math.PI / 2) ** 2 : Math.cos(((t - P) / (1 - P)) * Math.PI / 2) ** 1.5;
    const y = f(rnd(), fc, q).bp;
    x[i] = f2b(y, 3200, 0.7).lp * a;   // and a gentle top
  }
  return x;
}

/** Puff of smoke: a soft noise burst whose low-pass falls from bright to dull, a tiny low "pff" under it. */
function poof(dur, bright) {
  const n = len(dur), x = new Float32Array(n), f = svf();
  for (let i = 0; i < n; i++) {
    const t = i / SR, a = env(t, 0.012, dur * 0.28);
    const fc = 300 + bright * Math.exp(-t / (dur * 0.25));
    x[i] = f(rnd(), fc, 0.8).lp * a + Math.sin(2 * Math.PI * (110 - 40 * t / dur) * t) * env(t, 0.008, 0.06) * 0.35;
  }
  return x;
}

/** Magic shimmer: bell-like partials arpeggiated upwards with a light tremolo, over an airy hiss. */
function shimmer(dur, notes, step) {
  const n = len(dur), x = new Float32Array(n), f = svf();
  notes.forEach((fr, k) => {
    const on = k * step, det = 1 + (k % 2 ? 0.003 : -0.002);
    for (let i = len(on); i < n; i++) {
      const t = i / SR - on, a = env(t, 0.02, 0.28) * 0.5;
      x[i] += (Math.sin(2 * Math.PI * fr * det * t) + 0.25 * Math.sin(2 * Math.PI * fr * 2.01 * t) * Math.exp(-t / 0.08)) * a * (0.8 + 0.2 * Math.sin(2 * Math.PI * 11 * t));
    }
  });
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] += f(rnd(), 6000, 0.7).bp * 0.08 * env(t, 0.06, dur * 0.4); }
  return x;
}

/** Soft holy chime: two gentle bells a fifth apart with inharmonic shimmer, slow-ish attack. */
function chime(dur, base) {
  const n = len(dur), x = new Float32Array(n);
  const parts = [[1, 1, 0.9], [2.76, 0.32, 0.35], [5.4, 0.12, 0.16], [1.5, 0.7, 0.8], [4.1, 0.15, 0.2]];
  for (const [m, g, d] of parts) {
    const on = m === 1.5 || m === 4.1 ? 0.09 : 0;
    for (let i = len(on); i < n; i++) { const t = i / SR - on; x[i] += Math.sin(2 * Math.PI * base * m * t) * g * env(t, 0.012, d); }
  }
  return x;
}

/** Cute zombie-cat groan: a buzzy voice gliding down, through two vowel formants moving "a" → "u", a slow wobble. */
function groan(dur, p0, p1) {
  const n = len(dur), x = new Float32Array(n), F1 = svf(), F2 = svf(), lp = svf();
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n, s = i / SR;
    const pitch = (p0 + (p1 - p0) * t) * (1 + 0.035 * Math.sin(2 * Math.PI * 5.5 * s));
    ph += pitch / SR; ph -= Math.floor(ph);
    let src = 0; for (let h = 1; h <= 12; h++) src += Math.sin(2 * Math.PI * h * ph) / h;   // band-limited saw
    const f1 = 750 - 350 * t, f2 = 1150 - 350 * t;
    const v = F1(src, f1, 5).bp + 0.6 * F2(src, f2, 6).bp;
    const a = Math.sin(Math.min(1, t / 0.18) * Math.PI / 2) ** 2 * Math.cos(Math.max(0, (t - 0.6) / 0.4) * Math.PI / 2) ** 2;
    x[i] = lp(v, 2600, 0.7).lp * a;
  }
  return x;
}

/** Decode a source file to mono float at SR. */
function load(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', join(SRC, file), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`decode ${file}: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4).slice();
}

/** Cushion thump + a short cartoon "bonk" (sine with a falling pitch, soft attack) on top. */
function bonk(file, f0, mix) {
  const th = load(file), n = Math.max(th.length, len(0.3)), x = new Float32Array(n);
  let pk = 0; for (const v of th) pk = Math.max(pk, Math.abs(v));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, fr = f0 * (0.55 + 0.45 * Math.exp(-t / 0.05));
    ph += fr / SR;
    x[i] = (th[i] || 0) / (pk || 1) + Math.sin(2 * Math.PI * ph) * env(t, 0.005, 0.07) * mix;
  }
  return x;
}

const K = 'kenney_impact-sounds/Audio/';
[[0.26, 380, 1300, 520, 1.3], [0.3, 320, 1100, 450, 1.5], [0.24, 420, 1500, 600, 1.2]].forEach((p, i) => wav(`gen_whoosh_${i}`, whoosh(...p)));
wav('gen_poof_0', poof(0.42, 2600)); wav('gen_poof_1', poof(0.5, 2000));
wav('gen_shimmer_0', shimmer(0.75, [1047, 1319, 1568, 2093, 2637], 0.045));
wav('gen_shimmer_1', shimmer(0.75, [1175, 1480, 1760, 2349, 2960], 0.04));
wav('gen_chime_0', chime(1.2, 784));
wav('gen_groan_0', groan(0.85, 230, 165)); wav('gen_groan_1', groan(0.95, 205, 150));
[0, 1, 2].forEach((i) => wav(`gen_bonk_${i}`, bonk(`${K}impactSoft_heavy_00${i}.ogg`, 560 + i * 60, 0.32)));
