import { describe, it, expect } from 'vitest';
import { crossfadeLoop, brownNoise, popSynth, impulseResponse, loudness } from '../src/audio/dsp';

const sine = (f: number, sr: number, secs: number, amp: number) => { const x = new Float32Array(Math.round(sr * secs)); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / sr); return x; };

describe('loops', () => {
  it('crossfadeLoop: exact length, seamless wrap', () => {
    const sr = 8000, len = 8000, tail = 1000;
    const src = new Float32Array(len + tail); for (let i = 0; i < src.length; i++) src[i] = Math.sin(i * 0.013) + 0.3 * Math.sin(i * 0.071);
    const out = crossfadeLoop(src, len);
    expect(out.length).toBe(len);
    // the wrap (last → first sample) is as smooth as the signal itself
    const jump = Math.abs(out[0] - out[len - 1]);
    let maxStep = 0; for (let i = 1; i < len; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
    expect(jump).toBeLessThanOrEqual(maxStep * 1.5);
  });
  it('brown noise room tone: loopable, bounded, no DC', () => {
    const x = brownNoise(48000, 48000, 1, 0.5);
    let pk = 0, m = 0; for (const v of x) { pk = Math.max(pk, Math.abs(v)); m += v; }
    expect(pk).toBeLessThanOrEqual(0.5001);
    expect(Math.abs(m / x.length)).toBeLessThan(0.1);
    expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThan(0.05);
  });
});

describe('procedural sounds', () => {
  it('bubble pop: short, soft attack, ends at silence', () => {
    const sr = 48000, x = popSynth(sr, 0.6);
    expect(x.length / sr).toBeLessThan(0.2);
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
    expect(pk).toBeCloseTo(0.6, 3);
    expect(Math.abs(x[0])).toBeLessThan(0.01);              // no click at the start
    expect(Math.abs(x[x.length - 1])).toBeLessThan(0.001);  // nor at the end
    // the first 1 ms stays well under the peak (3 ms attack)
    let early = 0; for (let i = 0; i < sr * 0.001; i++) early = Math.max(early, Math.abs(x[i]));
    expect(early).toBeLessThan(0.4 * pk);
  });
  it('reverb impulse decays', () => {
    const [l] = impulseResponse(16000, 1, 2);
    const e = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += l[i] * l[i]; return s; };
    expect(e(0, 4000)).toBeGreaterThan(e(12000, 16000) * 10);
  });
});

describe('loudness meter (BS.1770)', () => {
  it('a 1 kHz sine at −20 dBFS (mono) reads ≈ −23 LUFS', () => {
    // BS.1770: 0 dBFS 1 kHz sine in ONE channel = −3.01 LUFS; −20 dBFS → −23.0
    const sr = 48000, x = sine(1000, sr, 5, Math.pow(10, -20 / 20));
    const L = loudness([x], sr);
    expect(L.integrated).toBeGreaterThan(-23.4); expect(L.integrated).toBeLessThan(-22.6);
    expect(L.samplePeakDb).toBeCloseTo(-20, 1);
  });
  it('stereo adds +3 dB; works at 44.1 kHz; silence is gated', () => {
    const sr = 44100, x = sine(1000, sr, 4, 0.1);
    expect(loudness([x, x], sr).integrated - loudness([x], sr).integrated).toBeCloseTo(3.01, 1);
    expect(loudness([new Float32Array(sr * 2)], sr).integrated).toBe(-Infinity);
  });
});
