/**
 * Small, allocation-free math helpers for frame-rate independent smoothing.
 * All functions are exact for any dt (no "lerp by constant per frame" anywhere).
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Exponential decay towards target: frame-rate independent "smooth follow". lambda = 1/s (higher = snappier). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Same as damp() for angles (shortest way round). Result is not wrapped. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const d = wrapAngle(target - current);
  return current + d * (1 - Math.exp(-lambda * dt));
}

/**
 * Critically damped spring (exact closed-form step). omega = angular frequency (rad/s);
 * settles in ~4/omega seconds with no overshoot. Steady-state lag behind a target moving at speed v is 2v/omega.
 */
export class Spring {
  x = 0;
  v = 0;
  constructor(x = 0) { this.x = x; }
  step(target: number, omega: number, dt: number): number {
    const e = Math.exp(-omega * dt);
    const j0 = this.x - target;
    const j1 = this.v + j0 * omega;
    this.x = e * (j0 + j1 * dt) + target;
    this.v = e * (this.v - j1 * omega * dt);
    return this.x;
  }
  reset(x: number): void { this.x = x; this.v = 0; }
}

export const easeOutCubic = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Quintic smootherstep: zero velocity AND acceleration at both ends — best for big camera sweeps. */
export const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
