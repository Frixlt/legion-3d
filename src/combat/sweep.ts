/** Swept tests without three.js (unit-tested): a moving point (segment) against an upright capsule, melee cones. */

/**
 * Segment p0→p1 against the upright capsule at feet (cx, cy, cz) with radius r and height h (axis from cy + r to
 * cy + h − r). Returns the segment parameter t ∈ [0, 1] of the first contact, or −1.
 */
export function segCapsule(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  cx: number, cy: number, cz: number, r: number, h: number, pad = 0,
): number {
  const R = r + pad, ya = cy + Math.min(r, h / 2), yb = cy + Math.max(h - r, h / 2);
  // march: the segment per frame is short (≤ 0.6 m at 30 m/s and 60 fps), so 8 samples + refinement are exact enough
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (inside(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, cx, cz, ya, yb, R)) {
      if (i === 0) return 0;
      // bisect between the last outside sample and this one
      let lo = (i - 1) / n, hi = t;
      for (let k = 0; k < 6; k++) {
        const m = (lo + hi) / 2;
        if (inside(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m, z0 + (z1 - z0) * m, cx, cz, ya, yb, R)) hi = m; else lo = m;
      }
      return hi;
    }
  }
  return -1;
}

function inside(x: number, y: number, z: number, cx: number, cz: number, ya: number, yb: number, R: number): boolean {
  const yy = y < ya ? ya : y > yb ? yb : y;
  const dx = x - cx, dy = y - yy, dz = z - cz;
  return dx * dx + dy * dy + dz * dz <= R * R;
}

/**
 * Melee: is a target at feet (tx, tz) (radius tr) inside the cone from (x, z) facing yaw (three.js rotation.y;
 * 0 looks to −Z) with `reach` metres and half-angle `cone`? Returns the distance, or −1.
 */
export function inCone(x: number, z: number, yaw: number, tx: number, tz: number, tr: number, reach: number, cone: number): number {
  const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
  if (d - tr > reach) return -1;
  if (d < 0.35) return d;                 // practically inside us
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const cos = (dx * fx + dz * fz) / d;
  // the target's own radius widens the cone a little
  const a = Math.acos(Math.max(-1, Math.min(1, cos))) - Math.atan2(tr, d);
  return a <= cone ? d : -1;
}
