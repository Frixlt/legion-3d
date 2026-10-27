/**
 * Third-person attack animations (the hero and anyone else who 'swing's): one keyframe track per weapon family, the
 * same families and timings as the first-person view-model (viewmodel.ts SWINGS), so FP and TP strike together.
 *
 * Key = [time s, armR.x, armR.y, armR.z, armL.x, armL.y, armL.z, body yaw, body lean (x; < 0 = forward), body dy,
 *        body dz (< 0 = forward), wrist.x (> 0 cocks the weapon back), wrist.z, ease?]
 * `ease` (optional, of the segment that ENDS at this key): 0 smooth (default), 1 in (accelerating — the strike),
 * 2 out (decelerating — wind-up / follow-through), 3 linear, 4 back-out (a small overshoot, the settle).
 * The FIRST and LAST keys are markers for "the base pose of this frame" (walk/idle): the track blends out of it and
 * back into it, so a swing started mid-walk never pops.
 * Phases of every melee track: wind-up (ease out) → anticipation HOLD (80–120 ms, a slow extra coil) → strike
 * (ease in, fast) → contact (TP_CONTACT: the wrist snaps through) → follow-through (ease out) → settle.
 * Body yaw > 0 turns towards the character's left (rotation about +Y; the character looks to −Z).
 */
export type TpKey = readonly number[];
export const TP_VALUES = 12;
type Family = 'blade' | 'heavy' | 'pole' | 'spear' | 'bow' | 'book' | 'censer' | 'none';

const B = 0;   // marker value (ignored)
const M = (t: number, ease = 0): TpKey => [t, B, B, B, B, B, B, B, B, B, B, B, B, ease];
export const E_SMOOTH = 0, E_IN = 1, E_OUT = 2, E_LIN = 3, E_BACK = 4;

export const TP_SLASH: readonly TpKey[] = [
  M(0),
  [0.09, 1.03, 1.07, 0.91, 1.15, 0, -0.35, -1.15, 0.2, -0.03, 0.06, -1.62, -0.59, E_OUT],   // wind up: sword cocked high behind the right shoulder, free paw aims, body coils hard
  [0.19, 1.09, 1.25, 0.97, 1.25, 0, -0.4, -1.25, 0.24, -0.04, 0.07, -1.88, -0.54],          // anticipation hold: crouched, a slow extra coil
  [0.225, 0.73, 1.09, 0.68, 0.4, 0, -0.5, -0.25, -0.04, 0.03, -0.01, -2.04, -0.48, E_IN],    // the arc: out to the front-right, fast, stretching up
  [0.255, 0.7, 1.4, 0.63, -0.3, 0, -0.35, 0.5, -0.18, 0.0, -0.07, -2.1, -0.2, E_LIN],       // contact: straight ahead, the wrist snaps through
  [0.36, 0.57, 1.95, 0.58, -0.5, 0, -0.3, 0.95, -0.2, -0.03, -0.07, -2.14, -0.28, E_OUT],   // follow-through: wound up the other way, low
  [0.47, 0.57, 1.9, 0.58, -0.4, 0, -0.28, 0.82, -0.12, -0.01, -0.04, -2.18, -0.34, E_BACK], // settle back with a little bounce
  M(0.74, E_SMOOTH),
];
// NB the held weapon tilts with the arm: weapon pitch ≈ arm.x + TP_TILT (model.ts) + lean; arm.x ≈ 0 keeps a hammer level
export const TP_SMASH: readonly TpKey[] = [
  M(0),
  [0.05, 0.78, -0.06, 0.51, 0.7, 0.3, -0.4, -0.3, 0.06, -0.035, 0.01, -0.02, -0.35, E_OUT],     // a quick crouch (anticipation of the hop)
  [0.12, 0.94, 0.67, 0.73, 1.0, -0.6, -0.6, -0.5, 0.2, 0.05, 0.03, -0.85, -0.82, E_OUT],        // both paws up, the head of the weapon high over the right shoulder
  [0.22, 0.98, 0.99, 0.8, 1.1, -0.8, -0.65, -0.55, 0.26, 0.1, 0.04, -1.21, -0.98],             // hold at the top of a little hop
  [0.26, 0.92, 0.86, 0.77, 1.0, -0.9, -0.55, -0.1, -0.05, 0.06, -0.02, -1.27, -0.69, E_IN],     // the arc over the top
  [0.29, 0.23, 0.75, 0.29, 0.44, -1.1, 0, 0.05, -0.44, -0.085, -0.08, -1.32, -0.6, E_IN],      // SLAM (contact), diagonally down to the front
  [0.42, 0.16, 0.72, 0.28, 0.33, -1.0, 0, 0.05, -0.4, -0.075, -0.07, -1.25, -0.57, E_OUT],      // stuck in the ground for a beat
  [0.52, 0.06, 0.75, -0.04, 0.3, -0.5, -0.1, 0.08, -0.2, -0.02, -0.03, -0.17, -0.23],           // heave it back up
  M(0.74, E_SMOOTH),
];
export const TP_THRUST: readonly TpKey[] = [
  M(0),
  [0.1, -0.52, -0.47, 0.72, 0.5, 0, -0.4, -0.3, 0.12, 0, 0.06, 0.34, 0.44, E_OUT],          // draw the spear back, point level
  [0.2, -0.57, -0.55, 0.8, 0.55, 0, -0.42, -0.36, 0.14, 0, 0.075, 0.46, 0.43],               // hold (coiled)
  [0.245, -0.13, 0.17, 1.65, -0.3, 0, -0.35, 0.18, -0.26, -0.015, -0.15, -0.51, -0.39, E_IN], // lunge (contact)
  [0.33, -0.22, 0.33, 1.73, -0.3, 0, -0.35, 0.18, -0.24, -0.012, -0.14, -0.7, -0.51, E_OUT],
  [0.4, -0.19, 0.13, 1.65, -0.2, 0, -0.35, 0.12, -0.16, -0.008, -0.1, -0.53, -0.38],
  M(0.58, E_SMOOTH),
];
export const TP_CAST: readonly TpKey[] = [
  M(0),
  [0.12, 2.3, 0, 0.55, 1.0, 0, -0.6, -0.3, 0.16, 0.05, 0.04, 0.2, 0, E_OUT],           // raise the staff / tome high, lean back
  [0.2, 2.5, 0, 0.6, 1.15, 0, -0.65, -0.36, 0.2, 0.06, 0.05, 0.3, 0],                   // gather (the tip charges up)
  [0.26, 0.2, 0, 0.15, 1.5, 0, -0.15, 0.15, -0.26, -0.02, -0.08, -0.3, 0, E_IN],        // point it at the target, the free paw flung forward
  [0.42, 0.05, 0, 0.15, 1.4, 0, -0.15, 0.15, -0.22, -0.015, -0.07, -0.25, 0, E_OUT],
  [0.52, 0.2, 0, 0.18, 1.0, 0, -0.2, 0.1, -0.12, -0.005, -0.04, -0.1, 0, E_BACK],
  M(0.74, E_SMOOTH),
];
export const TP_FLICK: readonly TpKey[] = [
  M(0),
  [0.12, 0.1, 0, 0.35, 0.2, 0, -0.3, -0.15, 0.06, 0, 0.02, 0, 0, E_OUT],
  [0.2, 0.05, 0, 0.38, 0.22, 0, -0.32, -0.18, 0.08, 0.01, 0.03, 0, 0],
  [0.26, 1.7, 0, 0.2, 0.6, 0, -0.3, 0.12, -0.14, 0.01, -0.03, 0, 0, E_IN],
  M(0.6, E_SMOOTH),
];
export const TP_SLAP: readonly TpKey[] = [
  M(0),
  [0.08, 1.05, 0, 1.5, 0.3, 0, -0.5, -0.34, 0.05, 0.01, 0.02, 0, 0, E_OUT],             // paw cocked up and out
  [0.17, 1.1, 0, 1.58, 0.32, 0, -0.52, -0.4, 0.07, 0.012, 0.025, 0, 0],                  // hold
  [0.215, 1.35, 0, -0.45, 0.1, 0, -0.4, 0.4, -0.15, -0.01, -0.045, 0, 0, E_IN],          // slap across (contact)
  [0.28, 1.25, 0, -0.6, 0.1, 0, -0.4, 0.44, -0.12, -0.01, -0.04, 0, 0, E_OUT],
  M(0.5, E_SMOOTH),
];
/** Zombie bonk: both stiff arms up, then down on the head of whoever is in front. */
export const TP_BONK: readonly TpKey[] = [
  M(0),
  [0.2, 2.8, 0, 0.2, 2.8, 0, -0.2, 0, 0.25, 0.05, 0.03, 0, 0, E_OUT],
  [0.34, 1.0, 0, 0.1, 1.0, 0, -0.1, 0, -0.4, -0.06, -0.06, 0, 0, E_IN],
  [0.5, 1.1, 0, 0.1, 1.1, 0, -0.1, 0, -0.3, -0.04, -0.05, 0, 0, E_OUT],
  M(0.75, E_SMOOTH),
];

export const TP_TRACKS: Record<string, readonly TpKey[]> = {
  slash: TP_SLASH, smash: TP_SMASH, thrust: TP_THRUST, cast: TP_CAST, flick: TP_FLICK, slap: TP_SLAP, bonk: TP_BONK,
};
/** Contact time of each track (s): the strike key. src/combat strikes there (rules.ts SPECS.strikeAt). */
export const TP_CONTACT: Record<string, number> = { slash: 0.255, smash: 0.29, thrust: 0.245, cast: 0.26, flick: 0.26, slap: 0.215, bonk: 0.34 };
/** Weapon family → TP track name for a plain 'swing'. */
export const FAMILY_TRACK: Record<Family, string> = {
  blade: 'slash', heavy: 'smash', spear: 'thrust', pole: 'cast', book: 'cast', censer: 'flick', bow: 'slap', none: 'slap',
};
export const trackLen = (k: readonly TpKey[]) => k[k.length - 1][0];

/** Easing of one segment (x ∈ [0, 1]). */
export function easeK(kind: number, x: number): number {
  switch (kind) {
    case E_IN: return x * x * x;
    case E_OUT: { const u = 1 - x; return 1 - u * u * u; }
    case E_LIN: return x;
    case E_BACK: { const c = 1.7, u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
    default: return x * x * (3 - 2 * x);
  }
}
/**
 * Sample a track at time t into `out` (TP_VALUES values: the key minus its time and ease), blending from/to `base`
 * (same layout) at the marker keys. Returns false once the track is over.
 */
export function sampleTrack(keys: readonly TpKey[], t: number, base: ArrayLike<number>, out: number[]): boolean {
  const end = keys[keys.length - 1][0];
  if (t >= end) return false;
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  const q = easeK(b[TP_VALUES + 1] ?? 0, Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
  const aBase = i === 0, bBase = i + 1 === keys.length - 1;
  for (let k = 0; k < TP_VALUES; k++) {
    const va = aBase ? base[k] : a[k + 1] ?? 0, vb = bBase ? base[k] : b[k + 1] ?? 0;
    out[k] = va + (vb - va) * q;
  }
  return true;
}
