/**
 * Benches (IDEAS #2): where the city's benches stand and where a cat sits on one. Mirrors the placement in
 * src/world/place.ts (LOW.benches: rotY = `y > 1600 ? π : 0`, scale 1.05) and the bench
 * kind in src/world/protoProps.ts (seat 1.5 × 0.42 m at 0.42 m, back at local z −0.2, the front faces local +Z).
 * Pure: no THREE objects, no allocations per query.
 */
import type { CityLayout } from '../contracts';
import { toX, toZ, fromX, fromZ } from '../world/coords';

export const BENCH_SCALE = 1.05;
/** Seat top above the bench origin (m, scale 1) — src/world/solid.ts PROP_SOLID.bench.top. */
export const SEAT_TOP = 0.46;
/** Two places on a bench: local x offsets (m, scale 1). */
export const SEAT_X = [-0.36, 0.36] as const;
/** Sitting cats sit this far forward of the bench centre (local +Z, m), clear of the back. */
export const SEAT_Z = 0.1;
/** A place is taken when another cat stands closer than this (m) to it. */
export const TAKEN_R = 0.5;

export interface Bench {
  id: string;
  /** Centre (world metres) on the ground and the bench yaw (rotY). */
  x: number; y: number; z: number; rotY: number;
  /** Site px of the centre. */
  px: number; py: number;
}

/** Benches of a city layout (fair city: LOW.benches). */
export function benchesOf(L: CityLayout, groundAt: (x: number, y: number) => number): Bench[] {
  const out: Bench[] = [];
  const list = L.low?.benches || [];
  list.forEach(([px, py], i) => {
    out.push({ id: `bench:${L.id}:${i}`, x: toX(px), y: groundAt(px, py), z: toZ(py), rotY: py > 1600 ? Math.PI : 0, px, py });
  });
  return out;
}

/** World position of seat `s` (0/1) of a bench into out; returns the yaw the seated cat faces (Walker.face convention). */
export function seatPos(b: Bench, s: number, out: { x: number; y: number; z: number }): number {
  const lx = SEAT_X[s] * BENCH_SCALE, lz = SEAT_Z * BENCH_SCALE;
  const c = Math.cos(b.rotY), sn = Math.sin(b.rotY);
  // rotation about +Y: x' = x cos + z sin, z' = −x sin + z cos
  out.x = b.x + lx * c + lz * sn;
  out.z = b.z - lx * sn + lz * c;
  out.y = b.y + SEAT_TOP * BENCH_SCALE;
  // the bench front faces local +Z; an avatar with face 0 looks to −Z → turn it around
  return b.rotY + Math.PI;
}

/**
 * The free seat of a bench nearest to (fx, fz), or −1 when both are taken. `others(fn)` lists the other cats'
 * positions (world metres); `taken` is called for nothing else.
 */
export function freeSeat(b: Bench, fx: number, fz: number, others: (fn: (x: number, z: number) => void) => void): number {
  const p = { x: 0, y: 0, z: 0 };
  let best = -1, bestD = Infinity;
  for (let s = 0; s < SEAT_X.length; s++) {
    seatPos(b, s, p);
    let taken = false;
    others((x, z) => { if (!taken && (x - p.x) ** 2 + (z - p.z) ** 2 < TAKEN_R * TAKEN_R) taken = true; });
    if (taken) continue;
    const d = (p.x - fx) ** 2 + (p.z - fz) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/** Site px of a world point (for the walk grid). */
export const toPx = (x: number, z: number): [number, number] => [fromX(x), fromZ(z)];
