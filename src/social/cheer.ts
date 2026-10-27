/**
 * Cheering crowd (IDEAS #3): who reacts to a comic «бонк» and how. Pure (tested); the feature
 * (src/features/cheer.ts) feeds it the visible standing cats and plays the poses.
 */

export type Cheer = 'cheer' | 'clap' | 'laugh';
export const CHEERS: readonly Cheer[] = ['cheer', 'clap', 'laugh'];
/** Only cats this close to the hit (m) react. */
export const CHEER_RADIUS = 9;
/** Seconds between two crowd reactions, and before the same cat reacts again. */
export const CHEER_GAP = 3.5, CHEER_CAT_GAP = 8;
/** Chance of a small «ха-ха» aside over one of the reacting cats. */
export const ASIDE_CHANCE = 0.25;
export const ASIDES = ['ха-ха!', 'хи-хи', 'бонк!', 'ого!', 'ещё!'];

export interface Bystander { id: string; x: number; z: number }

/**
 * Up to `max` reacting cats (1 … max, more when more stand around), nearest to (hx, hz) first, within CHEER_RADIUS,
 * skipping `exclude` (the one who was hit, ragdolls, cats on cooldown). Returns ids.
 */
export function pickCheerers(cands: readonly Bystander[], hx: number, hz: number, max: number, exclude: (id: string) => boolean, rnd: () => number = Math.random): string[] {
  const near: { id: string; d: number }[] = [];
  for (const c of cands) {
    if (exclude(c.id)) continue;
    const d = Math.hypot(c.x - hx, c.z - hz);
    if (d <= CHEER_RADIUS) near.push({ id: c.id, d });
  }
  if (!near.length || max <= 0) return [];
  near.sort((a, b) => a.d - b.d);
  const n = Math.max(1, Math.min(max, near.length, 1 + Math.floor(rnd() * Math.min(max, near.length))));
  return near.slice(0, n).map((c) => c.id);
}

/** A reaction for the i-th cheerer (varied, never two equal in a row when possible). */
export function cheerFor(i: number, rnd: () => number = Math.random): Cheer {
  const k = (Math.floor(rnd() * CHEERS.length) + i) % CHEERS.length;
  return CHEERS[k];
}

/** Max reacting cats by quality (q0: none — the cheapest is off). */
export const cheerMax = (q: number): number => (q <= 0 ? 0 : q === 1 ? 1 : 3);
