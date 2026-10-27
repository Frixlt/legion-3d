import { describe, it, expect } from 'vitest';
import { Rng, VariantPicker, Cooldowns, StepTracker, BubbleLimiter, sliderGain, dbToGain, gainToDb, jitter, spaceFor, surfaceFor, AMB, landGain, shouldMute } from '../src/audio/mix';
import { SFX, BED } from '../src/audio/defs';
import { BANK, LOOP_LEN } from '../src/audio/bank.gen';

describe('audio levels', () => {
  it('slider law: 0 silent, 40 % ≈ −12 dB, 100 % = unity, clamped', () => {
    expect(sliderGain(0)).toBe(0);
    expect(gainToDb(sliderGain(0.4))).toBeCloseTo(-11.9, 1);
    expect(sliderGain(1)).toBe(1);
    expect(sliderGain(2)).toBe(1);
    expect(sliderGain(-1)).toBe(0);
    expect(sliderGain(NaN)).toBe(0);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
  it('slider is monotonic', () => {
    let p = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) { const g = sliderGain(v); expect(g).toBeGreaterThanOrEqual(p); p = g; }
  });
});

describe('variation', () => {
  it('jitter stays within ±var', () => {
    const r = new Rng(1);
    for (let i = 0; i < 2000; i++) { const j = jitter(r, 0.05); expect(j).toBeGreaterThanOrEqual(0.95); expect(j).toBeLessThanOrEqual(1.05); }
  });
  it('variant picker never repeats the previous variant and covers all', () => {
    const p = new VariantPicker(new Rng(3));
    const seen = new Set<number>(); let prev = -1;
    for (let i = 0; i < 500; i++) { const v = p.pick('step', 6); expect(v).not.toBe(prev); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(6); seen.add(v); prev = v; }
    expect(seen.size).toBe(6);
    expect(p.pick('one', 1)).toBe(0);
    // two variants alternate
    const a = p.pick('two', 2), b = p.pick('two', 2), c = p.pick('two', 2);
    expect(b).toBe(1 - a); expect(c).toBe(a);
  });
  it('rng is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});

describe('cooldowns and bubbles', () => {
  it('cooldown blocks repeats inside the window', () => {
    const c = new Cooldowns();
    expect(c.take('a', 0, 1)).toBe(true);
    expect(c.take('a', 0.5, 1)).toBe(false);
    expect(c.take('b', 0.5, 1)).toBe(true);
    expect(c.take('a', 1.01, 1)).toBe(true);
    expect(c.take('z', 0, 0)).toBe(true);
    expect(c.take('z', 0, 0)).toBe(true);
  });
  it('bubble pops: near only, per player and global rate limits', () => {
    const b = new BubbleLimiter(14, 2.5, 0.35);
    expect(b.allow('a', 20, 0)).toBe(false);          // too far
    expect(b.allow('a', 5, 0)).toBe(true);
    expect(b.allow('b', 5, 0.1)).toBe(false);         // global limit
    expect(b.allow('b', 5, 0.5)).toBe(true);
    expect(b.allow('a', 5, 1)).toBe(false);           // per-player limit
    expect(b.allow('a', 5, 3)).toBe(true);
    expect(b.allow('c', NaN, 9)).toBe(false);
  });
});

describe('footstep sync', () => {
  it('walking: ~2 steps/s like the avatar gait; running is faster; idle is silent', () => {
    const count = (speed01: number, secs: number) => { const s = new StepTracker(); let n = 0; for (let t = 0; t < secs; t += 1 / 60) if (s.update(1 / 60, speed01)) n++; return n; };
    const walk = count(1, 10), run = count(1.35, 10);
    expect(walk).toBeGreaterThanOrEqual(19); expect(walk).toBeLessThanOrEqual(22);   // 6.5/π ≈ 2.07 /s
    expect(run).toBeGreaterThan(walk);
    expect(count(0, 10)).toBe(0);
    expect(count(0.05, 10)).toBe(0);
  });
  it('step timing does not depend on the frame rate', () => {
    const at = (fps: number) => { const s = new StepTracker(), out: number[] = []; for (let i = 0; i < fps * 5; i++) if (s.update(1 / fps, 1)) out.push(i / fps); return out; };
    const a = at(30), b = at(144);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
    expect(Math.abs(a[5] - b[5])).toBeLessThan(0.06);
  });
  it('steps stop shortly after stopping', () => {
    const s = new StepTracker();
    for (let i = 0; i < 120; i++) s.update(1 / 60, 1);
    let n = 0; for (let i = 0; i < 120; i++) if (s.update(1 / 60, 0)) n++;
    expect(n).toBeLessThanOrEqual(1);
  });
});

describe('spaces', () => {
  it('maps rooms to spaces and surfaces', () => {
    expect(spaceFor(null, null)).toBe('street');
    expect(spaceFor('mine3d', 'mine')).toBe('mine');
    expect(spaceFor('shop3d', 'forge')).toBe('forge');
    expect(spaceFor('shop3d', 'tent')).toBe('tent');
    expect(spaceFor('hybrid', 'tavern')).toBe('shop');
    expect(surfaceFor('street')).toBe('cobble');
    expect(surfaceFor('forge')).toBe('wood');
    expect(surfaceFor('tent')).toBe('soft');
    expect(surfaceFor('mine')).toBe('dirt');
  });
  it('inside, the street is quieter and muffled; the mine has no street', () => {
    expect(AMB.shop.outside).toBeLessThan(AMB.street.outside);
    expect(AMB.shop.outLP).toBeLessThan(1000);
    expect(AMB.mine.outside).toBe(0);
    expect(AMB.forge.fire).toBeGreaterThan(0);
    expect(AMB.street.fire).toBe(0);
  });
  it('landing gain grows with impact, bounded', () => {
    expect(landGain(0)).toBe(0.2);
    expect(landGain(4)).toBeGreaterThan(landGain(2));
    expect(landGain(50)).toBe(1);
  });
  it('mute: classic always, hidden tab unless background sound is on', () => {
    expect(shouldMute({ classic: true, hidden: false, background: true })).toBe(true);
    expect(shouldMute({ classic: false, hidden: true, background: false })).toBe(true);
    expect(shouldMute({ classic: false, hidden: true, background: true })).toBe(false);
    expect(shouldMute({ classic: false, hidden: false, background: false })).toBe(false);
  });
});

describe('sound list', () => {
  it('every sound points at files that exist in the bank (or a procedural buffer)', () => {
    for (const [id, d] of Object.entries(SFX)) {
      expect(d.files.length, id).toBeGreaterThan(0);
      for (const f of d.files) expect(f.startsWith('@') || f in BANK, `${id}: ${f}`).toBe(true);
    }
  });
  it('variation is subtle (±3–8 %) and nothing is mixed hot', () => {
    for (const [id, d] of Object.entries(SFX) as [string, { db: number; gainVar?: number; rateVar?: number }][]) {
      expect(d.db, id).toBeLessThanOrEqual(-6);
      if (d.gainVar !== undefined) expect(d.gainVar, id).toBeLessThanOrEqual(0.08);
      if (d.rateVar !== undefined) expect(d.rateVar, id).toBeLessThanOrEqual(0.06);
    }
  });
  it('beds are loops in the bank, and the whole bank stays small', () => {
    for (const k of ['bed_crickets', 'bed_wind', 'bed_crowd', 'bed_fire', 'bed_cave']) { expect(k in BANK).toBe(true); expect(LOOP_LEN[k]).toBeGreaterThan(8); }
    const bytes = Object.values(BANK).reduce((s, b) => s + Math.floor(b.length * 3 / 4), 0);
    expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
    expect(BED.crickets).toBeLessThan(1);
  });
});
