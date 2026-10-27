/**
 * Pure DSP helpers (Float32Array in, Float32Array out — no WebAudio): seamless loops, procedural buffers (room tone,
 * the chat-bubble pop, a small reverb impulse) and a BS.1770-4 loudness meter for the offline mix report.
 * Unit-tested in test/audio-dsp.test.ts.
 */
import { Rng } from './mix';

/**
 * Seamless loop: the source holds `len + tail` frames; the last `tail` frames are cross-faded (equal power) into the
 * first `tail`, the result is exactly `len` frames long and wraps without a click.
 */
export function crossfadeLoop(src: Float32Array, len: number): Float32Array {
  const tail = src.length - len;
  if (tail <= 0) return src.slice(0, len);
  const out = src.slice(0, len);
  for (let i = 0; i < tail; i++) {
    const k = (i + 0.5) / tail;
    out[i] = out[i] * Math.sin(k * Math.PI / 2) + src[len + i] * Math.cos(k * Math.PI / 2);
  }
  return out;
}

/** Brown-ish noise (leaky integrated white) normalised to `peak`, made loopable. Warm, low room tone. */
export function brownNoise(frames: number, sr: number, seed = 7, peak = 0.5): Float32Array {
  const rng = new Rng(seed), tail = Math.round(sr * 0.5);
  const x = new Float32Array(frames + tail);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y = y * 0.997 + (rng.next() * 2 - 1) * 0.06; x[i] = y; }
  // remove DC
  let m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length;
  let pk = 0; for (let i = 0; i < x.length; i++) { x[i] -= m; pk = Math.max(pk, Math.abs(x[i])); }
  const g = peak / Math.max(1e-6, pk);
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return crossfadeLoop(x, frames);
}

/**
 * Soft bubble «pop»: a sine whose pitch rises (as a real air bubble's does), 3 ms attack, ~30 ms decay, a quiet
 * octave partial — round and tiny, no click. ~0.14 s, peak `peak`.
 */
export function popSynth(sr: number, peak = 0.6, f0 = 560, f1 = 980): Float32Array {
  const n = Math.round(sr * 0.14), x = new Float32Array(n);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0 + (f1 - f0) * (1 - Math.exp(-t / 0.018));
    ph += 2 * Math.PI * f / sr; ph2 += 4 * Math.PI * f / sr;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.032);
    x[i] = (Math.sin(ph) + 0.12 * Math.sin(ph2) * Math.exp(-t / 0.01)) * env;
  }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
  const fo = Math.round(sr * 0.01);
  for (let i = 0; i < n; i++) { x[i] *= peak / pk; if (i >= n - fo) x[i] *= (n - i) / fo; }
  return x;
}

/** Diffuse reverb impulse (decaying noise, darker over time), `channels` decorrelated channels. */
export function impulseResponse(sr: number, seconds: number, channels = 2, seed = 11): Float32Array[] {
  const n = Math.round(sr * seconds), out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const rng = new Rng(seed + c * 101), x = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = 0.65 - 0.55 * t;                       // one-pole low-pass closing over time
      lp = lp + a * ((rng.next() * 2 - 1) - lp);
      x[i] = lp * Math.pow(1 - t, 2.2) * Math.min(1, i / (sr * 0.004));
    }
    out.push(x);
  }
  // normalise energy so a send of 1 is roughly unity loudness
  let e = 0; for (const x of out) for (let i = 0; i < n; i++) e += x[i] * x[i];
  const g = 1 / Math.sqrt(e / channels);
  for (const x of out) for (let i = 0; i < n; i++) x[i] *= g * 0.5;
  return out;
}

/* ------------------------------------------------------------------ loudness (ITU-R BS.1770-4 / EBU R128) */

function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/** K-weighting (pre-filter shelf + RLB high-pass) for any sample rate (libebur128 formulas). */
export function kWeight(x: Float32Array, sr: number): Float32Array {
  let f0 = 1681.974450955533; const G = 3.999843853973347; let Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s = biquad(x, (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
  a0 = 1 + K / Q + K * K;
  return biquad(s, 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
}

export interface Loudness { integrated: number; shortTermMax: number; momentaryMax: number; samplePeakDb: number }

/** Integrated loudness (LUFS, gated), max short-term (3 s) and momentary (0.4 s) loudness, sample peak (dBFS). */
export function loudness(channels: Float32Array[], sr: number): Loudness {
  const kw = channels.map((c) => kWeight(c, sr));
  const n = channels[0].length;
  let pk = 0; for (const c of channels) for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(c[i]));
  // squared sums per 100 ms hop
  const hop = Math.round(sr * 0.1), hops = Math.floor(n / hop), sq = new Float64Array(hops);
  for (const c of kw) for (let h = 0; h < hops; h++) { let s = 0; for (let i = h * hop; i < (h + 1) * hop; i++) s += c[i] * c[i]; sq[h] += s; }
  const block = (from: number, len: number) => { let s = 0; for (let i = from; i < from + len; i++) s += sq[i]; return s / (len * hop); };
  const lufs = (ms: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, ms));
  const blocks: number[] = []; let mMax = -Infinity, sMax = -Infinity;
  for (let h = 0; h + 4 <= hops; h++) { const z = block(h, 4); blocks.push(z); mMax = Math.max(mMax, lufs(z)); }
  for (let h = 0; h + 30 <= hops; h++) sMax = Math.max(sMax, lufs(block(h, 30)));
  const abs = blocks.filter((z) => lufs(z) > -70);
  const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((z) => lufs(z) > rel);
  return { integrated: gated.length ? lufs(mean(gated)) : -Infinity, shortTermMax: sMax, momentaryMax: mMax, samplePeakDb: 20 * Math.log10(Math.max(1e-9, pk)) };
}
