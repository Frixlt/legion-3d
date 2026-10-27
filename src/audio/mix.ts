/**
 * Pure mixing / selection logic of the sound system (no WebAudio, no DOM): unit-tested in test/audio-mix.test.ts.
 */

/* ------------------------------------------------------------------ levels */

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(1e-9, g));
/** Volume slider (0…1) → linear gain. A 1.5 power law: 40 % ≈ −12 dB, 70 % ≈ −4.6 dB, 100 % = 0 dB. */
export const sliderGain = (v: number): number => { const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)); return x * Math.sqrt(x); };

/* ------------------------------------------------------------------ randomness */

/** Small seeded PRNG (mulberry32) so the offline mix and the tests are reproducible. */
export class Rng {
  private s: number;
  constructor(seed = 0x2f6b) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(n: number): number { return Math.min(n - 1, Math.floor(this.next() * n)); }
}

/** ±var multiplicative jitter around 1 (var 0.05 → 0.95…1.05). */
export const jitter = (rng: Rng, v: number): number => 1 + (rng.next() * 2 - 1) * v;

/** Picks a variant index without repeating the previous one (n ≥ 2). */
export class VariantPicker {
  private last = new Map<string, number>();
  constructor(private rng: Rng) {}
  pick(key: string, n: number): number {
    if (n <= 1) return 0;
    const prev = this.last.get(key) ?? -1;
    let i = this.rng.int(n - (prev >= 0 ? 1 : 0));
    if (prev >= 0 && i >= prev) i++;
    this.last.set(key, i);
    return i;
  }
}

/** Per-key cooldowns (seconds on the caller's clock). */
export class Cooldowns {
  private until = new Map<string, number>();
  /** True (and arms the cooldown) when `key` may play at `now`. */
  take(key: string, now: number, cd: number): boolean {
    if (cd <= 0) return true;
    const u = this.until.get(key);
    if (u !== undefined && now < u) return false;
    this.until.set(key, now + cd);
    return true;
  }
  clear(): void { this.until.clear(); }
}

/* ------------------------------------------------------------------ footsteps */

/**
 * Mirrors the avatar's gait (src/avatar/avatar.ts update()): the walk amount follows speed01 with a dt·8 lag and the
 * phase advances by dt·(6.5 + run·4)·min(1, walk·2.5); a foot is planted whenever the phase passes a multiple of π
 * (the body's hop |sin(phase)| touches zero). update() returns true on such a contact.
 */
export class StepTracker {
  walk = 0; phase = 0;
  update(dt: number, speed01: number): boolean {
    const target = Math.min(1.6, Math.max(0, speed01));
    this.walk += (target - this.walk) * Math.min(1, dt * 8);
    const run = Math.max(0, this.walk - 1);
    const before = Math.floor(this.phase / Math.PI);
    this.phase += dt * (6.5 + run * 4) * Math.min(1, this.walk * 2.5);
    if (this.phase > 1e6) this.phase -= Math.PI * 2 * 100000;
    return Math.floor(this.phase / Math.PI) !== before && this.walk > 0.25;
  }
  /** 0…1.6 smoothed walk amount (loudness of the step follows it a little). */
  get amount(): number { return this.walk; }
  reset(): void { this.walk = 0; }
}

/* ------------------------------------------------------------------ spaces and surfaces */

export type Space = 'street' | 'shop' | 'forge' | 'tent' | 'mine';
export type Surface = 'cobble' | 'wood' | 'soft' | 'dirt';

/** Acoustic space from the room manager's kind and the room variant (building scene). */
export function spaceFor(kind: string | null, scene: string | null | undefined): Space {
  if (!kind) return 'street';
  if (kind === 'mine3d') return 'mine';
  if (scene === 'forge') return 'forge';
  if (scene === 'tent') return 'tent';
  return 'shop';
}
export function surfaceFor(space: Space): Surface {
  return space === 'street' ? 'cobble' : space === 'tent' ? 'soft' : space === 'mine' ? 'dirt' : 'wood';
}

/** Ambience mix per space (linear gains). `outside` = the street beds; inside they go through a low-pass (walls). */
export interface AmbTarget { outside: number; outLP: number; roomtone: number; fire: number; cave: number; reverb: number }
export const AMB: Record<Space, AmbTarget> = {
  street: { outside: 1, outLP: 16000, roomtone: 0, fire: 0, cave: 0, reverb: 0.05 },
  shop: { outside: 0.4, outLP: 520, roomtone: 0.55, fire: 0, cave: 0, reverb: 0.15 },
  forge: { outside: 0.3, outLP: 480, roomtone: 0.45, fire: 1, cave: 0, reverb: 0.15 },
  tent: { outside: 0.65, outLP: 1500, roomtone: 0.2, fire: 0, cave: 0, reverb: 0.05 },
  mine: { outside: 0, outLP: 300, roomtone: 0.75, fire: 0, cave: 1, reverb: 0.3 },
};

/* ------------------------------------------------------------------ chat bubbles */

/** Bubble pops: only near the listener, at most one per player per `per` s and one overall per `all` s. */
export class BubbleLimiter {
  private cd = new Cooldowns();
  constructor(private maxDist = 14, private per = 2.5, private all = 0.35) {}
  allow(login: string, dist: number, now: number): boolean {
    if (!(dist <= this.maxDist)) return false;
    if (!this.cd.take('*', now, this.all)) return false;
    if (!this.cd.take(login, now, this.per)) return false;
    return true;
  }
}

/** Landing loudness from the impact speed (m/s): a hop off a bench is soft, a fall from a roof is fuller. */
export const landGain = (impact: number): number => Math.min(1, Math.max(0.2, (impact - 1) / 6));

/** Should the output be silent? (classic site shown, or the tab is hidden and «Звук в фоне» is off). */
export const shouldMute = (o: { classic: boolean; hidden: boolean; background: boolean }): boolean => o.classic || (o.hidden && !o.background);
