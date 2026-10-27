/**
 * A tiny position-based (Verlet) ragdoll for the chibi characters. No three.js, no allocations after construction.
 *
 * Particles (world metres, y up):
 *   body  A (lower body centre), C (upper body / head centre), F (front marker), R (right marker) — a stiff
 *         tetrahedron (6 distance constraints): the whole blob (cats are one head-body shell) is a rigid body.
 *         A and C carry the body radius, so the blob rests on its side like a capsule; F and R give it a facing and
 *         make it settle on its back, front or side instead of spinning forever.
 *   limbs HL, HR (paws), FL, FR (feet), T (tail tip): each hangs from an anchor fixed in the body frame (shoulder,
 *         hip, tail base) at its rest length, inside a cone around its rest direction (angle limit) — floppy but
 *         never inside-out. Limbs follow the body; they do not push it (the body is far heavier).
 * Environment: ground height + blocked cells (walls) per (x, z); friction and a little bounce on contact.
 * Fixed substeps of 1/60 s (at most 4 per call), so the result does not depend on the frame rate.
 *
 * Model space of the rest shape is the avatar's (feet at y = 0, looking towards −Z, right hand at +X).
 */

export const NP = 9;
export const A = 0, C = 1, F = 2, R = 3, HL = 4, HR = 5, FL = 6, FR = 7, T = 8;
const LIMBS = [HL, HR, FL, FR, T] as const;
const BODY_PAIRS = [A, C, A, F, A, R, C, F, C, R, F, R] as const;
export const H = 1 / 60;
const GRAVITY = -10.5;            // a cartoon toss: a little more than g, but with the strong launch (SPECS.up) it still hangs
const AIR_DAMP = 0.996;
const LIMB_DAMP = 0.93;           // limbs: floppy but quickly calm (they are dragged by the body anyway)
const FRICTION = 0.3;             // fraction of tangential velocity removed per substep on contact
const BOUNCE = 0.34;              // a short comic bounce on landing
const VMAX = 18 * H;              // m per substep

export interface RagdollEnv {
  groundAt(x: number, z: number): number;
  /** A wall / building / anything a body cannot be pushed into at (x, z) for something at height y. */
  blocked(x: number, z: number, y: number): boolean;
}

/** Rest shape in model space. Build with makeShape(). */
export interface RagdollShape {
  rest: Float32Array;      // NP × 3
  radius: Float32Array;    // NP
  anchor: Float32Array;    // 5 × 3 (limb anchors: shoulders, hips, tail base)
  limit: Float32Array;     // 5 cone half-angles (rad)
  active: Uint8Array;      // 5: limb present (legs / tail may be missing)
}

export interface ShapeDims {
  y0: number; top: number; w: number; depth: number; armY: number;
  /** right shoulder (model space), right paw offset from the shoulder */
  shoulder: [number, number, number]; hand: [number, number, number];
  /** right hip (leg bone origin) */
  hip: [number, number, number];
  tailBase: [number, number, number]; tailTip: [number, number, number];
  hasLegs: boolean; hasTail: boolean;
}

export function makeShape(d: ShapeDims): RagdollShape {
  const rest = new Float32Array(NP * 3), radius = new Float32Array(NP), anchor = new Float32Array(15), limit = new Float32Array(5), active = new Uint8Array(5);
  const r = Math.max(0.12, Math.min(d.w, (d.top - d.y0) / 2) * 0.95);
  const ya = d.y0 + r, yc = Math.max(ya + 0.06, d.top - r * 0.9), mid = (ya + yc) / 2;
  const set = (i: number, x: number, y: number, z: number, rad: number) => { rest[i * 3] = x; rest[i * 3 + 1] = y; rest[i * 3 + 2] = z; radius[i] = rad; };
  set(A, 0, ya, 0, r);
  set(C, 0, yc, 0, r * 0.92);
  set(F, 0, mid, -r * d.depth * 0.68, r * 0.32);
  set(R, r * 0.68, mid, 0, r * 0.32);
  const [sx, sy, sz] = d.shoulder, [hx, hy, hz] = d.hand;
  const lim = (k: number, ax: number, ay: number, az: number, a: number, on: boolean) => { anchor[k * 3] = ax; anchor[k * 3 + 1] = ay; anchor[k * 3 + 2] = az; limit[k] = a; active[k] = on ? 1 : 0; };
  lim(0, -sx, sy, sz, 1.7, true); set(HL, -sx - hx, sy + hy, sz + hz, 0.05);
  lim(1, sx, sy, sz, 1.7, true); set(HR, sx + hx, sy + hy, sz + hz, 0.05);
  const [px, py, pz] = d.hip;
  lim(2, -px, py, pz, 1.15, d.hasLegs); set(FL, -px, 0.045, pz - 0.03, 0.05);
  lim(3, px, py, pz, 1.15, d.hasLegs); set(FR, px, 0.045, pz - 0.03, 0.05);
  lim(4, d.tailBase[0], d.tailBase[1], d.tailBase[2], 1.0, d.hasTail); set(T, d.tailTip[0], d.tailTip[1], d.tailTip[2], 0.04);
  return { rest, radius, anchor, limit, active };
}

export class Ragdoll {
  readonly p = new Float32Array(NP * 3);
  readonly prev = new Float32Array(NP * 3);
  /** Body frame (world): columns x (right), y (up), z (back), row-major m[r*3+c]. Valid after init/step. */
  readonly basis = new Float32Array(9);
  /** Seconds the ragdoll has been (almost) still. */
  still = 0;
  /** Largest particle speed of the last substep (m/s). */
  speed = 0;
  private acc = 0;
  private shape: RagdollShape;
  private bodyLen = new Float32Array(6);
  private limbLen = new Float32Array(5);
  private limbDir = new Float32Array(15);   // rest direction of each limb in model (= body-local) space, unit
  private aModel = new Float32Array(3);

  constructor(shape: RagdollShape) {
    this.shape = shape;
    this.setShape(shape);
  }

  setShape(shape: RagdollShape) {
    this.shape = shape;
    const s = shape.rest;
    for (let k = 0; k < 6; k++) {
      const i = BODY_PAIRS[k * 2] * 3, j = BODY_PAIRS[k * 2 + 1] * 3;
      this.bodyLen[k] = Math.hypot(s[i] - s[j], s[i + 1] - s[j + 1], s[i + 2] - s[j + 2]);
    }
    for (let k = 0; k < 5; k++) {
      const i = LIMBS[k] * 3, a = k * 3;
      const dx = s[i] - shape.anchor[a], dy = s[i + 1] - shape.anchor[a + 1], dz = s[i + 2] - shape.anchor[a + 2];
      const L = Math.hypot(dx, dy, dz) || 1e-3;
      this.limbLen[k] = L; this.limbDir[a] = dx / L; this.limbDir[a + 1] = dy / L; this.limbDir[a + 2] = dz / L;
    }
    this.aModel[0] = s[A * 3]; this.aModel[1] = s[A * 3 + 1]; this.aModel[2] = s[A * 3 + 2];
  }

  /** Place the rest shape at feet (x, y, z) turned by yaw (three.js rotation.y; 0 looks to −Z). Zero velocity. */
  init(x: number, y: number, z: number, yaw: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw), r = this.shape.rest;
    for (let i = 0; i < NP; i++) {
      const mx = r[i * 3], my = r[i * 3 + 1], mz = r[i * 3 + 2];
      this.p[i * 3] = x + mx * c + mz * s; this.p[i * 3 + 1] = y + my; this.p[i * 3 + 2] = z - mx * s + mz * c;
    }
    this.prev.set(this.p);
    this.still = 0; this.acc = 0; this.speed = 0;
    this.updateBasis();
  }

  /** Move one particle (e.g. a paw to where the animation had it), keeping its velocity. */
  place(i: number, x: number, y: number, z: number) {
    const o = i * 3;
    const vx = this.p[o] - this.prev[o], vy = this.p[o + 1] - this.prev[o + 1], vz = this.p[o + 2] - this.prev[o + 2];
    this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z;
    this.prev[o] = x - vx; this.prev[o + 1] = y - vy; this.prev[o + 2] = z - vz;
  }

  /**
   * Add a velocity (m/s) to every particle, stronger near the point (px, py, pz) — a hit high on the head topples
   * the body, a hit low sweeps the feet. `falloff` 0 = uniform, 1 = only near the point.
   */
  impulse(vx: number, vy: number, vz: number, px: number, py: number, pz: number, falloff = 0.6) {
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < 4; i++) { sx += this.p[i * 3]; sy += this.p[i * 3 + 1]; sz += this.p[i * 3 + 2]; }
    sx /= 4; sy /= 4; sz /= 4;
    const ref = Math.max(0.2, Math.hypot(px - sx, py - sy, pz - sz)) * 2.2;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      const d = Math.hypot(this.p[o] - px, this.p[o + 1] - py, this.p[o + 2] - pz);
      const k = (1 - falloff) + falloff * Math.max(0.15, 1 - d / ref) * 1.6;
      this.prev[o] -= vx * k * H; this.prev[o + 1] -= vy * k * H; this.prev[o + 2] -= vz * k * H;
    }
  }

  /** Add a spin (rad/s about the world axis (wx, wy, wz) through the body centre) — the cartoon tumble of a hit. */
  spin(wx: number, wy: number, wz: number) {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 4; i++) { cx += this.p[i * 3]; cy += this.p[i * 3 + 1]; cz += this.p[i * 3 + 2]; }
    cx /= 4; cy /= 4; cz /= 4;
    for (let i = 0; i < NP; i++) {
      const o = i * 3, rx = this.p[o] - cx, ry = this.p[o + 1] - cy, rz = this.p[o + 2] - cz;
      // v = ω × r
      this.prev[o] -= (wy * rz - wz * ry) * H; this.prev[o + 1] -= (wz * rx - wx * rz) * H; this.prev[o + 2] -= (wx * ry - wy * rx) * H;
    }
  }

  /** Move the whole body (positions only: a soft push that becomes a little velocity). */
  shift(dx: number, dy: number, dz: number) {
    for (let i = 0; i < NP; i++) { const o = i * 3; this.p[o] += dx; this.p[o + 1] += dy; this.p[o + 2] += dz; }
  }

  /** Body sphere k (0 = lower, 1 = upper) centre and radius. */
  sphere(k: 0 | 1): { x: number; y: number; z: number; r: number } {
    const i = k === 0 ? A : C, s = this._sph;
    s.x = this.p[i * 3]; s.y = this.p[i * 3 + 1]; s.z = this.p[i * 3 + 2]; s.r = this.shape.radius[i];
    return s;
  }
  private _sph = { x: 0, y: 0, z: 0, r: 0 };

  /** Advance by dt seconds (fixed 1/60 substeps, at most 4). */
  step(dt: number, env: RagdollEnv, iterations = 5) {
    this.acc = Math.min(this.acc + Math.max(0, dt), 4 * H);
    while (this.acc >= H) {
      this.acc -= H;
      this.substep(env, iterations);
    }
  }

  private substep(env: RagdollEnv, iters: number) {
    const p = this.p, q = this.prev, act = this.shape.active;
    let vmax = 0;
    for (let i = 0; i < NP; i++) {
      if (i >= HL && !act[i - HL]) continue;
      const o = i * 3;
      const damp = i >= HL ? LIMB_DAMP : AIR_DAMP;
      let vx = (p[o] - q[o]) * damp, vy = (p[o + 1] - q[o + 1]) * damp + GRAVITY * H * H, vz = (p[o + 2] - q[o + 2]) * damp;
      const v = Math.hypot(vx, vy, vz);
      if (v > VMAX) { const k = VMAX / v; vx *= k; vy *= k; vz *= k; }
      if (!(v === v)) { vx = vy = vz = 0; }   // NaN guard
      q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2];
      p[o] += vx; p[o + 1] += vy; p[o + 2] += vz;
    }
    for (let it = 0; it < iters; it++) {
      this.solveBody();
      this.updateBasis();
      this.solveLimbs();
      this.collide(env, it === iters - 1);
    }
    this.updateBasis();
    for (let i = 0; i < 4; i++) {   // the body decides when the ragdoll is at rest
      const o = i * 3, v = Math.hypot(p[o] - q[o], p[o + 1] - q[o + 1], p[o + 2] - q[o + 2]);
      if (v > vmax) vmax = v;
    }
    this.speed = vmax / H;
    this.still = this.speed < 0.25 ? this.still + H : 0;
  }

  private solveBody() {
    const p = this.p;
    for (let k = 0; k < 6; k++) {
      const i = BODY_PAIRS[k * 2] * 3, j = BODY_PAIRS[k * 2 + 1] * 3;
      const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-6) continue;
      const corr = (d - this.bodyLen[k]) / d * 0.5;
      p[i] += dx * corr; p[i + 1] += dy * corr; p[i + 2] += dz * corr;
      p[j] -= dx * corr; p[j + 1] -= dy * corr; p[j + 2] -= dz * corr;
    }
  }

  /** Recompute the body frame from A, C, R. */
  updateBasis() {
    const p = this.p, m = this.basis;
    let yx = p[C * 3] - p[A * 3], yy = p[C * 3 + 1] - p[A * 3 + 1], yz = p[C * 3 + 2] - p[A * 3 + 2];
    let l = Math.hypot(yx, yy, yz) || 1; yx /= l; yy /= l; yz /= l;
    let xx = p[R * 3] - p[A * 3], xy = p[R * 3 + 1] - p[A * 3 + 1], xz = p[R * 3 + 2] - p[A * 3 + 2];
    const dd = xx * yx + xy * yy + xz * yz;
    xx -= yx * dd; xy -= yy * dd; xz -= yz * dd;
    l = Math.hypot(xx, xy, xz);
    if (l < 1e-6) { // degenerate: any perpendicular
      xx = Math.abs(yx) < 0.9 ? 1 : 0; xy = 0; xz = Math.abs(yx) < 0.9 ? 0 : 1;
      const d2 = xx * yx + xz * yz; xx -= yx * d2; xy -= yy * d2; xz -= yz * d2; l = Math.hypot(xx, xy, xz) || 1;
    }
    xx /= l; xy /= l; xz /= l;
    // z = x × y
    const zx = xy * yz - xz * yy, zy = xz * yx - xx * yz, zz = xx * yy - xy * yx;
    m[0] = xx; m[3] = xy; m[6] = xz;
    m[1] = yx; m[4] = yy; m[7] = yz;
    m[2] = zx; m[5] = zy; m[8] = zz;
  }

  /** World position of a model-space point carried by the body (rigid). */
  bodyPoint(mx: number, my: number, mz: number, out: Float32Array | number[], o = 0) {
    const m = this.basis, p = this.p, a = this.aModel;
    const lx = mx - a[0], ly = my - a[1], lz = mz - a[2];
    out[o] = p[0] + m[0] * lx + m[1] * ly + m[2] * lz;
    out[o + 1] = p[1] + m[3] * lx + m[4] * ly + m[5] * lz;
    out[o + 2] = p[2] + m[6] * lx + m[7] * ly + m[8] * lz;
  }

  private _w = new Float32Array(3);
  private solveLimbs() {
    const p = this.p, m = this.basis, s = this.shape, w = this._w;
    for (let k = 0; k < 5; k++) {
      if (!s.active[k]) continue;
      const i = LIMBS[k] * 3, a = k * 3;
      this.bodyPoint(s.anchor[a], s.anchor[a + 1], s.anchor[a + 2], w);
      // limb vector in body-local space
      const vx = p[i] - w[0], vy = p[i + 1] - w[1], vz = p[i + 2] - w[2];
      let lx = m[0] * vx + m[3] * vy + m[6] * vz, ly = m[1] * vx + m[4] * vy + m[7] * vz, lz = m[2] * vx + m[5] * vy + m[8] * vz;
      let l = Math.hypot(lx, ly, lz);
      const d0x = this.limbDir[a], d0y = this.limbDir[a + 1], d0z = this.limbDir[a + 2];
      if (l < 1e-6) { lx = d0x; ly = d0y; lz = d0z; l = 1; }
      lx /= l; ly /= l; lz /= l;
      // cone limit around the rest direction
      const cosL = Math.cos(s.limit[k]), dot = lx * d0x + ly * d0y + lz * d0z;
      if (dot < cosL) {
        let px = lx - d0x * dot, py = ly - d0y * dot, pz = lz - d0z * dot;
        let pl = Math.hypot(px, py, pz);
        if (pl < 1e-5) { px = -d0y; py = d0x; pz = 0; pl = Math.hypot(px, py) || 1; if (pl < 1e-5) { px = 1; py = 0; pz = 0; pl = 1; } }
        const sinL = Math.sin(s.limit[k]);
        lx = d0x * cosL + (px / pl) * sinL; ly = d0y * cosL + (py / pl) * sinL; lz = d0z * cosL + (pz / pl) * sinL;
      }
      const L = this.limbLen[k];
      p[i] = w[0] + (m[0] * lx + m[1] * ly + m[2] * lz) * L;
      p[i + 1] = w[1] + (m[3] * lx + m[4] * ly + m[5] * lz) * L;
      p[i + 2] = w[2] + (m[6] * lx + m[7] * ly + m[8] * lz) * L;
    }
  }

  private collide(env: RagdollEnv, last: boolean) {
    const p = this.p, q = this.prev, rad = this.shape.radius, act = this.shape.active;
    for (let i = 0; i < NP; i++) {
      if (i >= HL && !act[i - HL]) continue;
      const o = i * 3, r = rad[i];
      if (env.blocked(p[o], p[o + 2], p[o + 1])) {
        // pushed into a wall: back to the last free spot horizontally, no horizontal speed
        if (!env.blocked(q[o], q[o + 2], q[o + 1])) { p[o] = q[o]; p[o + 2] = q[o + 2]; }
      }
      const g = env.groundAt(p[o], p[o + 2]);
      if (p[o + 1] - r < g) {
        // project out WITHOUT injecting velocity (a step up must not launch the body): shift prev along
        const corr = g + r - p[o + 1];
        p[o + 1] += corr; q[o + 1] += corr;
      }
      if (last && p[o + 1] - r <= g + 1e-4) {
        const vy = p[o + 1] - q[o + 1];
        if (vy < 0) q[o + 1] = p[o + 1] + vy * BOUNCE;
        q[o] += (p[o] - q[o]) * FRICTION; q[o + 2] += (p[o + 2] - q[o + 2]) * FRICTION;
      }
    }
  }

  /** Kinetic energy proxy: Σ v² (m²/s²) over the active particles. */
  energy(): number {
    let e = 0;
    const act = this.shape.active;
    for (let i = 0; i < NP; i++) {
      if (i >= HL && !act[i - HL]) continue;
      const o = i * 3, vx = (this.p[o] - this.prev[o]) / H, vy = (this.p[o + 1] - this.prev[o + 1]) / H, vz = (this.p[o + 2] - this.prev[o + 2]) / H;
      e += vx * vx + vy * vy + vz * vz;
    }
    return e;
  }

  /** Largest relative error of the body distance constraints (0 = perfectly rigid). */
  bodyError(): number {
    let e = 0;
    for (let k = 0; k < 6; k++) {
      const i = BODY_PAIRS[k * 2] * 3, j = BODY_PAIRS[k * 2 + 1] * 3;
      const d = Math.hypot(this.p[j] - this.p[i], this.p[j + 1] - this.p[i + 1], this.p[j + 2] - this.p[i + 2]);
      e = Math.max(e, Math.abs(d - this.bodyLen[k]) / this.bodyLen[k]);
    }
    return e;
  }

  /** Limb length error (m) and the worst angle-limit violation (rad) — for tests. */
  limbError(): { len: number; angle: number } {
    let len = 0, ang = 0;
    const s = this.shape, m = this.basis, w = this._w;
    for (let k = 0; k < 5; k++) {
      if (!s.active[k]) continue;
      const i = LIMBS[k] * 3, a = k * 3;
      this.bodyPoint(s.anchor[a], s.anchor[a + 1], s.anchor[a + 2], w);
      const vx = this.p[i] - w[0], vy = this.p[i + 1] - w[1], vz = this.p[i + 2] - w[2];
      const l = Math.hypot(vx, vy, vz);
      len = Math.max(len, Math.abs(l - this.limbLen[k]));
      const lx = (m[0] * vx + m[3] * vy + m[6] * vz) / l, ly = (m[1] * vx + m[4] * vy + m[7] * vz) / l, lz = (m[2] * vx + m[5] * vy + m[8] * vz) / l;
      const an = Math.acos(Math.max(-1, Math.min(1, lx * this.limbDir[a] + ly * this.limbDir[a + 1] + lz * this.limbDir[a + 2])));
      ang = Math.max(ang, an - s.limit[k]);
    }
    return { len, angle: ang };
  }

  /** Body-local unit direction of limb k (0 HL, 1 HR, 2 FL, 3 FR, 4 T) and its rest direction. */
  limbLocal(k: number, out: Float32Array | number[]) {
    const s = this.shape, m = this.basis, w = this._w, i = LIMBS[k] * 3, a = k * 3;
    this.bodyPoint(s.anchor[a], s.anchor[a + 1], s.anchor[a + 2], w);
    const vx = this.p[i] - w[0], vy = this.p[i + 1] - w[1], vz = this.p[i + 2] - w[2];
    const l = Math.hypot(vx, vy, vz) || 1;
    out[0] = (m[0] * vx + m[3] * vy + m[6] * vz) / l; out[1] = (m[1] * vx + m[4] * vy + m[7] * vz) / l; out[2] = (m[2] * vx + m[5] * vy + m[8] * vz) / l;
    out[3] = this.limbDir[a]; out[4] = this.limbDir[a + 1]; out[5] = this.limbDir[a + 2];
  }

  /** Model-space position of particle A (for root placement). */
  get aRest(): Float32Array { return this.aModel; }
}

/**
 * Push two ragdolls apart where their body spheres overlap (light, mutual: `k` of the overlap per call, half each).
 * Cats bump into each other instead of melting together. Returns the overlap that was found (m).
 */
export function separateRagdolls(a: Ragdoll, b: Ragdoll, k = 0.5): number {
  let worst = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const sa = a.sphere(i as 0 | 1), ax = sa.x, ay = sa.y, az = sa.z, ar = sa.r;
    const sb = b.sphere(j as 0 | 1);
    let dx = sb.x - ax, dy = sb.y - ay, dz = sb.z - az;
    const d = Math.hypot(dx, dy, dz), min = (ar + sb.r) * 0.92;
    if (d >= min) continue;
    if (d < 1e-4) { dx = 1; dy = 0; dz = 0; } else { dx /= d; dy /= d; dz /= d; }
    const o = min - d; if (o > worst) worst = o;
    // mostly sideways: cats slide off each other rather than stack up
    const m = o * k * 0.5;
    a.shift(-dx * m, -dy * m * 0.3, -dz * m); b.shift(dx * m, dy * m * 0.3, dz * m);
  }
  return worst;
}

/** Push a ragdoll out of a standing character (upright capsule at feet (cx, cy, cz), radius r, height h). */
export function pushOutOfCapsule(a: Ragdoll, cx: number, cy: number, cz: number, r: number, h: number, k = 0.5): number {
  let worst = 0;
  for (let i = 0; i < 2; i++) {
    const s = a.sphere(i as 0 | 1);
    if (s.y + s.r < cy || s.y - s.r > cy + h) continue;
    let dx = s.x - cx, dz = s.z - cz;
    const d = Math.hypot(dx, dz), min = (s.r + r) * 0.9;
    if (d >= min) continue;
    if (d < 1e-4) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    const o = min - d; if (o > worst) worst = o;
    a.shift(dx * o * k, 0, dz * o * k);
  }
  return worst;
}
