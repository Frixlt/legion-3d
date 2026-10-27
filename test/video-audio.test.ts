/**
 * Video sound capture (src/audio/capture.ts + SoundEngine.replay): what the engine logs while the game plays is
 * rebuilt identically — same voices (variant, rate, gain, filter, bus, position), same bed offsets, same level ramps
 * — on another context, without the replay making any decision of its own. WebAudio is mocked (node).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { SoundEngine } from '../src/audio/engine';
import type { AudioLogEvent } from '../src/audio/capture';
import { SFX } from '../src/audio/defs';

interface Started { at: number; off?: number; rate: number; gain: number; file: string; lp: number; pos: number[] | null }

function param(v = 0) {
  const p = { value: v, calls: [] as unknown[][],
    setValueAtTime(x: number, t: number) { p.calls.push(['set', x, t]); p.value = x; return p; },
    setTargetAtTime(x: number, t: number, tc: number) { p.calls.push(['target', x, t, tc]); return p; },
    cancelScheduledValues(t: number) { p.calls.push(['cancel', t]); return p; },
    cancelAndHoldAtTime(t: number) { p.calls.push(['hold', t]); return p; } };
  return p;
}
/** A tiny WebAudio stand-in: nodes record their wiring, sources record how they were started. */
function mockCtx(sr = 8000) {
  const started: Started[] = [];
  const node = (extra: Record<string, unknown> = {}) => {
    const n: any = { outs: [] as any[], connect(d: any) { n.outs.push(d); return d; }, disconnect() { /* */ }, ...extra };
    return n;
  };
  const chainInfo = (src: any) => {
    let lp = 0, gain = 1, pos: number[] | null = null, n = src.outs[0];
    for (let i = 0; i < 4 && n; i++, n = n.outs[0]) {
      if (n.kind === 'biquad') lp = n.frequency.value;
      if (n.kind === 'gain') gain = n.gain.value;
      if (n.kind === 'panner') pos = [n.positionX.value, n.positionY.value, n.positionZ.value];
    }
    return { lp, gain, pos };
  };
  const ac: any = {
    sampleRate: sr, currentTime: 0, destination: node(),
    listener: { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(-1), upX: param(), upY: param(1), upZ: param() },
    createGain: () => node({ kind: 'gain', gain: param(1) }),
    createBiquadFilter: () => node({ kind: 'biquad', type: 'lowpass', frequency: param(350), Q: param(1) }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createConvolver: () => node({ buffer: null, normalize: true }),
    createPanner: () => node({ kind: 'panner', positionX: param(), positionY: param(), positionZ: param(), panningModel: 'equalpower' }),
    createBuffer: (ch: number, len: number, rate: number) => ({ numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, copyToChannel() { /* */ } }),
    createBufferSource() {
      const s = node({ kind: 'src', buffer: null as any, loop: false, playbackRate: param(1), onended: null,
        start(at: number, off?: number) { const c = chainInfo(s); started.push({ at, off, rate: s.playbackRate.value, gain: c.gain, lp: c.lp, pos: c.pos, file: s.buffer.key }); } });
      return s;
    },
  };
  return { ac, started };
}
function bank(): Map<string, AudioBuffer> {
  const m = new Map<string, AudioBuffer>();
  const add = (k: string, d: number) => m.set(k, { key: k, duration: d, length: Math.round(d * 8000) } as unknown as AudioBuffer);
  for (const def of Object.values(SFX)) for (const f of def.files) add(f, 0.4);
  for (const k of ['bed_crickets', 'bed_wind', 'bed_crowd', '@roomtone', 'bed_fire', 'bed_cave']) add(k, 12);
  return m;
}

/** A little session: beds, a walk (steps with cooldowns), a positional bubble, a door into the shop, a coin, ambience ticks. */
function session(e: SoundEngine, ac: any) {
  const at = (t: number) => { ac.currentTime = t; };
  at(0.5); e.startBeds(); e.setVolumes({ master: 1 }, 0);
  for (let i = 0; i < 40; i++) {
    at(1 + i * 0.05);
    e.setListener(i * 0.1, 1.15, 0, 0, 0, -1);
    e.tick(0.05);
    if (i % 3 === 0) e.play('step.cobble', { own: true, gain: 0.9, key: 'step-me' });   // some fall into the cooldown
  }
  at(3.1); e.play('bubble', { x: 2, y: 1.6, z: -3 });
  e.play('bubble', { x: 200, y: 1.6, z: -3 });                                             // too far: culled
  at(3.5); e.play('door.open', { own: true }); e.play('door.close', { own: true, delay: 0.5 }); e.setSpace('shop'); e.setDuck(0.7);
  at(4.2); e.play('shop.buy');
}

afterEach(() => { delete (globalThis as { __VT_AUDIO_LOG?: unknown }).__VT_AUDIO_LOG; });

describe('video sound capture', () => {
  it('logs nothing unless the page asks for it', () => {
    const { ac } = mockCtx();
    const e = new SoundEngine(ac, bank(), { seed: 3 });
    session(e, ac);
    expect((e as unknown as { cap: unknown }).cap).toBeNull();
  });

  it('logs exactly the voices that started (culled / cooled-down plays are absent)', () => {
    const log: AudioLogEvent[] = [];
    (globalThis as { __VT_AUDIO_LOG?: unknown }).__VT_AUDIO_LOG = log;
    const { ac, started } = mockCtx();
    const e = new SoundEngine(ac, bank(), { seed: 3, hrtf: () => true });
    session(e, ac);
    const voices = log.filter((x) => x.k === 'voice');
    const oneShots = started.filter((s) => !/^bed_|@roomtone/.test(s.file));
    expect(voices.length).toBe(oneShots.length);
    expect(voices.map((v) => (v as { id: string }).id)).toContain('door.open');
    expect(voices.filter((v) => (v as { id: string }).id === 'bubble')).toHaveLength(1);
    expect(log.filter((x) => x.k === 'bed')).toHaveLength(6);
    expect(log.filter((x) => x.k === 'lis')).toHaveLength(40);
    expect(log.some((x) => x.k === 'space' && x.space === 'shop')).toBe(true);
    expect(log.some((x) => x.k === 'ramp' && x.p === 'duck' && x.v === 0.7)).toBe(true);
    // the delayed door close is logged at its start time
    const close = voices.find((v) => (v as { id: string }).id === 'door.close')!;
    expect(close.t).toBeCloseTo(4.0, 4);
  });

  it('replay rebuilds the same voices, beds and ramps (shifted), without consulting the RNG', () => {
    const log: AudioLogEvent[] = [];
    (globalThis as { __VT_AUDIO_LOG?: unknown }).__VT_AUDIO_LOG = log;
    const A = mockCtx();
    const e = new SoundEngine(A.ac, bank(), { seed: 3, hrtf: () => false });
    session(e, A.ac);
    delete (globalThis as { __VT_AUDIO_LOG?: unknown }).__VT_AUDIO_LOG;

    const B = mockCtx();
    const r = new SoundEngine(B.ac, bank(), { seed: 999, hrtf: () => false });   // a different seed: replay must not care
    const shift = -0.5;
    const n = r.replay(log, shift);
    const one = (s: Started[]) => s.filter((x) => !/^bed_|@roomtone/.test(x.file));
    const a = one(A.started), b = one(B.started);
    expect(n).toBe(a.length);
    expect(b.map((x) => x.file)).toEqual(a.map((x) => x.file));
    b.forEach((x, i) => {
      expect(x.at).toBeCloseTo(a[i].at + shift, 3);
      expect(x.rate).toBeCloseTo(a[i].rate, 3);
      expect(x.gain).toBeCloseTo(a[i].gain, 3);
      expect(x.lp).toBe(a[i].lp);
      if (a[i].pos) expect(x.pos).toEqual(a[i].pos!.map((v) => +v.toFixed(4)));
    });
    // beds: same buffers, same offsets, started at the shifted time
    const bedsA = A.started.filter((x) => /^bed_|@roomtone/.test(x.file)), bedsB = B.started.filter((x) => /^bed_|@roomtone/.test(x.file));
    expect(bedsB.map((x) => [x.file, x.off])).toEqual(bedsA.map((x) => [x.file, x.off]));
    expect(bedsB[0].at).toBeCloseTo(0, 6);
    // the listener follows the logged pose
    const lx = B.ac.listener.positionX.calls.filter((c: unknown[]) => c[0] === 'set');
    expect(lx).toHaveLength(40);
    expect(lx[39][1]).toBeCloseTo(3.9, 4);
  });
});
