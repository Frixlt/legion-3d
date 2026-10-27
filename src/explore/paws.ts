/**
 * Paw-print trail (idea #8): a ring buffer of the last few prints you left on the cobbles. Pure logic (metres, seconds):
 * `step()` decides when the player has walked far enough for the next print and which foot it is; `alpha()` is the fade.
 */
export const PAW_COUNT = 8;
export const PAW_LIFE = 5.2;        // seconds from birth to gone
export const PAW_LIFT = 0.012;      // m above the ground height (≥ 6 mm: no z-fight with the cobble)

export interface PawTrail {
  /** x, y, z, yaw per print (flat) and birth time (s) per print; born < 0 = empty slot. */
  data: Float32Array; born: Float32Array;
  head: number; side: 1 | -1;
  lastX: number; lastZ: number; has: boolean;
  /** Distance walked since the last print. */
  acc: number;
}
export const newTrail = (): PawTrail => ({ data: new Float32Array(PAW_COUNT * 4), born: new Float32Array(PAW_COUNT).fill(-1), head: 0, side: 1, lastX: 0, lastZ: 0, has: false, acc: 0 });
export const clearTrail = (t: PawTrail): void => { t.born.fill(-1); t.has = false; t.acc = 0; t.head = 0; };

/** Stride between prints: a trot leaves them further apart than a stroll. */
export const strideFor = (speed: number): number => 0.5 + Math.min(0.5, speed * 0.07);

/**
 * One frame. (x, z) = feet (m), `ok` = the player may leave prints here (grounded, on cobble, not in a room), `groundY` = ground
 * height there, `now` = time (s). Returns true when a print was added. Allocation-free.
 */
export function step(t: PawTrail, x: number, z: number, ok: boolean, groundY: number, now: number, dt: number): boolean {
  if (!t.has) { t.lastX = x; t.lastZ = z; t.has = true; return false; }
  const dx = x - t.lastX, dz = z - t.lastZ, d = Math.hypot(dx, dz);
  t.lastX = x; t.lastZ = z;
  if (d > 3) { t.acc = 0; return false; }          // teleported (room exit, respawn)
  if (!ok || dt <= 0) return false;
  const speed = d / Math.min(dt, 0.08);               // a stalled frame (low fps, tab switch) must not read as standing still
  if (speed < 0.7) return false;                    // standing / creeping leaves nothing
  t.acc += d;
  if (t.acc < strideFor(speed)) return false;
  t.acc = 0;
  // the print sits a hair to the side of the line of travel (left / right paw alternate), 0.1 m
  const nx = -dz / d, nz = dx / d;                  // left normal
  const o = t.head * 4;
  t.data[o] = x + nx * 0.1 * t.side; t.data[o + 1] = groundY + PAW_LIFT; t.data[o + 2] = z + nz * 0.1 * t.side;
  t.data[o + 3] = Math.atan2(-dx, -dz);
  t.born[t.head] = now;
  t.head = (t.head + 1) % PAW_COUNT; t.side = t.side > 0 ? -1 : 1;
  return true;
}

/** Opacity 0…1 of a print born at `born` (a quick appear, a long linear fade). */
export function alpha(born: number, now: number): number {
  if (born < 0) return 0;
  const a = now - born;
  if (a < 0 || a >= PAW_LIFE) return 0;
  return Math.min(1, a / 0.12) * (1 - a / PAW_LIFE);
}
