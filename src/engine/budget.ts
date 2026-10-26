/**
 * Crowd budget: which avatars to draw and at which LOD, per quality level, ranked by distance among the ones in view.
 * Allocation-free per frame (typed arrays sized once, grown only when the crowd grows).
 *
 * Per frame:
 *   crowd.begin(camera, engine.quality)
 *   for each walker: slot = crowd.add(x, y, z, prevLod)        // world metres of the feet; prevLod = last frame's result
 *   crowd.resolve()
 *   for each walker (same order): lod = crowd.lod(slot)        // -1 hidden (skip update), 0 full, 1 no outline, 2 low mesh
 */
import * as THREE from 'three';
import type { QualityLevel } from '../contracts';

export interface CrowdBudget {
  /** Max avatars drawn (others hidden, never updated). Ranked nearest-first among those in view. */
  maxDrawn: number;
  /** LOD0 (body + outline + face + aura) only within this distance (m) ... */
  lod0: number;
  /** ... and only for the nearest `lod0Max` of them. */
  lod0Max: number;
  /** LOD1 (body + face) within this distance (m) and for the nearest `lod1Max`; beyond → LOD2 (low mesh, 1 draw). */
  lod1: number;
  lod1Max: number;
  /** Nameplates beyond this distance (m) are hidden (labels are one draw call each) ... */
  labelFar: number;
  /** ... and only the nearest `labelMax` drawn avatars get one (chat bubbles are not limited by this). */
  labelMax: number;
}

/**
 * Budgets sized for "≤ 150k triangles / ≤ 120 draw calls at quality 2 with 25 avatars in view"
 * (LOD0 ≈ 7k tris / 3 draws, LOD1 ≈ 3.5k / 2, LOD2 ≈ 0.4k / 1 with the current avatar module).
 */
export const CROWD: Record<QualityLevel, CrowdBudget> = {
  0: { maxDrawn: 12, lod0: 0, lod0Max: 0, lod1: 5, lod1Max: 3, labelFar: 12, labelMax: 6 },
  1: { maxDrawn: 18, lod0: 4, lod0Max: 2, lod1: 9, lod1Max: 6, labelFar: 16, labelMax: 10 },
  2: { maxDrawn: 28, lod0: 6, lod0Max: 3, lod1: 13, lod1Max: 8, labelFar: 20, labelMax: 14 },
  3: { maxDrawn: 40, lod0: 12, lod0Max: 10, lod1: 30, lod1Max: 24, labelFar: 25, labelMax: 30 },
};

export function crowdBudget(q: QualityLevel): CrowdBudget { return CROWD[q]; }

/** Bounding sphere used for the in-view test (centre at feet + 0.6 m; generous so turning never pops). */
const R_VIEW = 1.4, Y_MID = 0.6;
/** Hysteresis: a finer LOD is kept until the distance exceeds its threshold by this factor. */
const HYST = 1.12;
const SLOT_BITS = 4096;   // max slots per frame (keys pack the slot in the low 12 bits)

export class CrowdLod {
  private cap = 0;
  private n = 0;
  private d2 = new Float64Array(0);
  private inView = new Uint8Array(0);
  private prev = new Int8Array(0);
  private out = new Int8Array(0);
  private rank = new Int16Array(0);
  private keys = new Float64Array(0);
  private readonly frustum = new THREE.Frustum();
  private readonly m = new THREE.Matrix4();
  private readonly s = new THREE.Sphere(new THREE.Vector3(), R_VIEW);
  private readonly cam = new THREE.Vector3();
  private b: CrowdBudget = CROWD[2];
  /** Stats of the last resolve() (for the debug overlay / tests). */
  readonly stats = { total: 0, inView: 0, drawn: 0, lod0: 0, lod1: 0, lod2: 0 };

  constructor(capacity = 64) { this.grow(capacity); }

  private grow(c: number): void {
    c = Math.min(SLOT_BITS, Math.max(c, this.cap * 2, 16));
    const cp = <T extends Float64Array | Uint8Array | Int8Array | Int16Array>(a: T, b: T) => { b.set(a.subarray(0, Math.min(a.length, b.length))); return b; };
    this.rank = cp(this.rank, new Int16Array(c));
    this.d2 = cp(this.d2, new Float64Array(c));
    this.inView = cp(this.inView, new Uint8Array(c));
    this.prev = cp(this.prev, new Int8Array(c));
    this.out = cp(this.out, new Int8Array(c));
    this.keys = new Float64Array(c);
    this.cap = c;
  }

  /** Start a frame. The camera's matrixWorld must be current (call after rig.update). */
  begin(camera: THREE.Camera, q: QualityLevel | CrowdBudget): void {
    this.b = typeof q === 'number' ? CROWD[q] : q;
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m, (camera as THREE.PerspectiveCamera).coordinateSystem);
    this.cam.setFromMatrixPosition(camera.matrixWorld);
    this.n = 0;
  }

  /** Register an avatar at its feet position; returns its slot for lod(). prevLod: what it had last frame (-1 if none). */
  add(x: number, y: number, z: number, prevLod = -1): number {
    if (this.n >= this.cap) { if (this.cap >= SLOT_BITS) return -1; this.grow(this.cap * 2); }
    const i = this.n++;
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    this.d2[i] = dx * dx + dy * dy + dz * dz;
    this.s.center.set(x, y + Y_MID, z);
    this.inView[i] = this.frustum.intersectsSphere(this.s) ? 1 : 0;
    this.prev[i] = prevLod;
    return i;
  }

  /** Rank the in-view avatars by distance and assign LODs. */
  resolve(): void {
    const n = this.n, b = this.b, keys = this.keys;
    let m = 0;
    for (let i = 0; i < n; i++) {
      this.out[i] = -1; this.rank[i] = -1;
      if (this.inView[i]) keys[m++] = Math.floor(Math.min(this.d2[i], 1e6) * 16) * SLOT_BITS + i;
    }
    for (let i = m; i < keys.length; i++) keys[i] = Infinity;
    keys.sort();   // typed-array numeric sort, in place, no allocation
    const st = this.stats; st.total = n; st.inView = m; st.drawn = 0; st.lod0 = 0; st.lod1 = 0; st.lod2 = 0;
    const l0 = b.lod0 * b.lod0, l1 = b.lod1 * b.lod1, h2 = HYST * HYST;
    for (let r = 0; r < m && r < b.maxDrawn; r++) {
      const i = keys[r] % SLOT_BITS, d2 = this.d2[i], p = this.prev[i];
      let lod: 0 | 1 | 2 = 2;
      if (st.lod0 < b.lod0Max && d2 < l0 * (p === 0 ? h2 : 1)) lod = 0;
      else if (st.lod1 < b.lod1Max && d2 < l1 * (p >= 0 && p <= 1 ? h2 : 1)) lod = 1;
      this.out[i] = lod; this.rank[i] = r;
      st.drawn++;
      if (lod === 0) st.lod0++; else if (lod === 1) st.lod1++; else st.lod2++;
    }
  }

  /** LOD for a slot after resolve(): -1 = do not draw (out of view or over budget). */
  lod(slot: number): -1 | 0 | 1 | 2 { return slot < 0 || slot >= this.n ? -1 : (this.out[slot] as -1 | 0 | 1 | 2); }
  /** Squared distance camera → feet of a slot. */
  dist2(slot: number): number { return slot < 0 || slot >= this.n ? Infinity : this.d2[slot]; }
  /** Distance rank among the drawn avatars (0 = nearest), -1 if not drawn. */
  rankOf(slot: number): number { return slot < 0 || slot >= this.n ? -1 : this.rank[slot]; }
  /** Nameplate allowed for this slot: drawn, among the nearest labelMax and within labelFar. */
  label(slot: number): boolean {
    const r = this.rankOf(slot);
    return r >= 0 && r < this.b.labelMax && this.d2[slot] < this.b.labelFar * this.b.labelFar;
  }
}
