/**
 * Where the New Year things go (pure; the city raster from the Halloween placement):
 *  - the fir tree: the most open flat spot (largest clearance to walls / drops) near the spawn — the city's "square" —
 *    clear of doors and the spawn, so it never blocks an entrance or the arrival point;
 *  - snow drifts: soft decals that hug wall feet, railings and props on flat ground (never across a drop, never on
 *    stairs, ≥ 0.6 m from doors), spaced ≥ 1.4 m apart, in a deterministic shuffled order (quality = a prefix).
 */
import { Grid, clearOfDoors, mulberry32, type PlaceCity } from '../halloween/placement';
import { TREE_RADIUS } from './geo';

export interface Drift { x: number; y: number; z: number; r: number; rot: number; variant: number }
export interface NewYearPlan { tree: { x: number; y: number; z: number } | null; drifts: Drift[] }

const CELL = 0.125;

/** No open ground within radius r around (X,Z) lies lower than the centre (the decal would float over a drop); higher
 *  ground or solids only hide the decal's edge (a wall foot, the retaining wall). */
function noDrop(g: Grid, X: number, Z: number, r: number, tol = 0.03): boolean {
  const k0 = g.at(X, Z); if (k0 < 0 || !g.open[k0]) return false;
  const g0 = g.gnd[k0], s = Math.ceil(r / CELL), i0 = g.ix(X), j0 = g.iz(Z);
  for (let dj = -s; dj <= s; dj++) for (let di = -s; di <= s; di++) {
    if (di * di + dj * dj > s * s) continue;
    const i = i0 + di, j = j0 + dj; if (!g.in(i, j)) continue;
    const k = j * g.nx + i; if (g.open[k] && g.gnd[k] < g0 - tol) return false;
  }
  return true;
}

export function planNewYear(c: PlaceCity, seed = 2027): NewYearPlan {
  const g = new Grid(c), rnd = mulberry32(seed);
  const onStair = (X: number) => c.stairs.some(([a, b]) => X > a - 0.6 && X < b + 0.6);

  /* ---- the tree */
  let tree: NewYearPlan['tree'] = null, best = -Infinity;
  for (let Z = c.area.z0 + 1; Z < c.area.z1 - 1; Z += 0.25) for (let X = c.area.x0 + 1; X < c.area.x1 - 1; X += 0.25) {
    const ds = Math.hypot(X - c.spawn.x, Z - c.spawn.z);
    if (ds < 3 || ds > 16) continue;
    if (!g.flat(X, Z, TREE_RADIUS + 0.25, 0.03) || !clearOfDoors(c, X, Z, TREE_RADIUS + 0.4)) continue;
    const score = Math.min(g.distAt(X, Z), 4) - 0.12 * ds;
    if (score > best) { best = score; tree = { x: X, y: c.groundAt(X, Z), z: Z }; }
  }

  /* ---- drifts along wall feet */
  const cand: Drift[] = [];
  for (let Z = c.area.z0 + 0.25; Z < c.area.z1; Z += 0.25) for (let X = c.area.x0 + 0.25; X < c.area.x1; X += 0.25) {
    const d = g.distAt(X, Z);
    if (d < 0.12 || d > 0.38 || onStair(X)) continue;
    const r = 0.7 + rnd() * 0.55;
    if (!noDrop(g, X, Z, r) || !clearOfDoors(c, X, Z, r * 0.8)) continue;
    if (tree && Math.hypot(X - tree.x, Z - tree.z) < TREE_RADIUS + r) continue;
    cand.push({ x: X, y: c.groundAt(X, Z), z: Z, r, rot: rnd() * Math.PI * 2, variant: Math.floor(rnd() * 4) });
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const drifts: Drift[] = [];
  for (const d of cand) {
    if (drifts.some((o) => Math.hypot(o.x - d.x, o.z - d.z) < Math.max(1.4, o.r + d.r))) continue;
    drifts.push(d);
    if (drifts.length >= 140) break;
  }
  return { tree, drifts };
}

/**
 * The street's snow cover: one quad per 0.5 m cell of open, flat ground (all four corners at the same height, so the
 * layer never bridges a drop or a stair ramp), 1 cm above the paving, with world-space UVs (tile = 3 m).
 */
export function snowCoverMesh(c: PlaceCity, cell = 0.5, lift = 0.01): { position: Float32Array; uv: Float32Array } {
  const pos: number[] = [], uv: number[] = [];
  const T = 3;
  for (let Z = c.area.z0; Z < c.area.z1; Z += cell) for (let X = c.area.x0; X < c.area.x1; X += cell) {
    const pts: [number, number][] = [[X, Z], [X + cell, Z], [X, Z + cell], [X + cell, Z + cell]];
    const g0 = c.groundAt(X + cell / 2, Z + cell / 2);
    let ok = c.top(X + cell / 2, Z + cell / 2) === -Infinity;
    for (const [x, z] of pts) if (!ok || Math.abs(c.groundAt(x, z) - g0) > 0.01 || c.top(x, z) === Infinity) ok = false;
    if (!ok) continue;
    const y = g0 + lift;
    const q = [[X, Z], [X, Z + cell], [X + cell, Z], [X + cell, Z], [X, Z + cell], [X + cell, Z + cell]];
    for (const [x, z] of q) { pos.push(x, y, z); uv.push(x / T, -z / T); }
  }
  return { position: new Float32Array(pos), uv: new Float32Array(uv) };
}
