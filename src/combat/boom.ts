/**
 * «!идея бум» — the easter-egg mega explosion (src/features/boom.ts): numbers and the cooldown (pure, tested), the
 * blast impulse curve CombatSystem.blast() uses, and BoomShow: the particle timeline in the shared fun Fx —
 *   fuse (0 … FUSE s): sparks spit from a glowing spark over the hero's head;
 *   BOOM: a white-gold flash ball, a billboard shock ring, two ground shockwaves out to the blast radius, a ring of
 *         dust rolling out, confetti and cartoon stars;
 *   then: the fireball climbs on a smoke stem and spreads into a soft mushroom cap that drifts and fades (~4 s).
 * Inside rooms the column stops under the ceiling. Quality and prefers-reduced-motion scale the particle counts.
 * No allocations per frame.
 */
import * as THREE from 'three';
import { Fx, SH_GLOW, SH_STAR, SH_FEATHER, SH_DUST, SH_SPARK, SH_RING } from './fx';

export const BOOM = {
  /** Seconds between two booms. */
  cooldown: 20,
  /** Who flies (m) and how fast the shock front travels (m/s). */
  radius: 15, front: 30,
  /** The fuse (anticipation) before the bang (s). */
  fuse: 0.6,
  /** Camera shake: strength (rad) and length (s). */
  shake: 0.045, shakeLen: 0.55,
  /** How long the whole show runs (s). */
  len: 4.6,
};

/** The boom cooldown on a caller-supplied clock (s). */
export class BoomCooldown {
  private next = -Infinity;
  constructor(private gap = BOOM.cooldown) {}
  ready(now: number) { return now >= this.next; }
  /** Start the cooldown; false (nothing changes) when not ready. */
  use(now: number) { if (!this.ready(now)) return false; this.next = now + this.gap; return true; }
  /** Whole seconds left (0 = ready). */
  left(now: number) { return Math.max(0, Math.ceil(this.next - now)); }
  reset() { this.next = -Infinity; }
}

/** Knock-back of a cat `d` m from the centre of a blast of radius `r`: strong and high near, a shove at the edge. */
export function blastImpulse(d: number, r: number): { push: number; up: number; spin: number } {
  const k = Math.max(0, 1 - d / r);
  return { push: 2.8 + 5.5 * k, up: 4.5 + 7.5 * k, spin: 1.2 + 1.3 * k };
}

/**
 * The cartoon bomb that sits by the hero during the fuse: a glossy black ball, a brass cap and a curled fuse (three
 * meshes, shown only for the 0.6 s fuse). `tip` = the fuse's end in the bomb's local space (where the spark sits).
 */
export function makeBomb(): { root: THREE.Group; tip: THREE.Vector3; dispose(): void } {
  const root = new THREE.Group(); root.name = 'boom-bomb';
  const ball = new THREE.SphereGeometry(0.3, 20, 14);
  const cap = new THREE.CylinderGeometry(0.09, 0.1, 0.09, 12).translate(0, 0.31, 0);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.34, 0), new THREE.Vector3(0.04, 0.44, 0.02), new THREE.Vector3(0.12, 0.5, 0.05), new THREE.Vector3(0.2, 0.49, 0.06)]);
  const fuse = new THREE.TubeGeometry(curve, 10, 0.018, 6);
  const mBall = new THREE.MeshToonMaterial({ color: '#2b2433' }), mCap = new THREE.MeshToonMaterial({ color: '#c9a25a' }), mFuse = new THREE.MeshToonMaterial({ color: '#d8c49a' });
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8).scale(1, 0.7, 0.4).translate(-0.12, 0.13, 0.25), new THREE.MeshBasicMaterial({ color: '#8a7f99' }));
  root.add(new THREE.Mesh(ball, mBall), new THREE.Mesh(cap, mCap), new THREE.Mesh(fuse, mFuse), shine);
  root.visible = false;
  return {
    root, tip: new THREE.Vector3(0.2, 0.49, 0.06),
    dispose() { for (const c of root.children) { const m = c as THREE.Mesh; m.geometry.dispose(); (m.material as THREE.Material).dispose(); } root.removeFromParent(); },
  };
}

const CONF = [[1, 0.55, 0.64], [1, 0.81, 0.42], [0.56, 0.89, 0.6], [0.55, 0.78, 1], [0.8, 0.6, 1], [1, 1, 1]] as const;

export class BoomShow {
  /** Seconds since the trigger (< 0 = idle). */
  t = -1;
  private x = 0; private y = 0; private z = 0; private g = 0; private ceil = 30;
  private banged = false;
  /** Where the fuse spark is (world; defaults to over the hero's head). */
  readonly spark = new THREE.Vector3();
  private acc = 0;
  private n = 1;   // particle count scale
  private sz = 1;  // smoke size scale (rooms: under the ceiling)

  get active() { return this.t >= 0; }

  /** Start at the hero (feet x, y, z; ground height g; ceiling = max column height above the ground). */
  start(x: number, y: number, z: number, g: number, ceil: number, quality: number, reduced: boolean) {
    this.x = x; this.y = y; this.z = z; this.g = g; this.ceil = ceil;
    this.t = 0; this.banged = false; this.acc = 0;
    this.spark.set(x, y + 1.55, z);
    this.sz = ceil < 10 ? 0.5 : 1;
    this.n = (quality <= 0 ? 0.3 : quality === 1 ? 0.6 : 1) * (reduced ? 0.5 : 1);
  }
  stop() { this.t = -1; }

  /** Advance; returns true on the frame of the bang (the caller does the blast, flash, shake and sound). */
  update(fx: Fx, dt: number): boolean {
    if (this.t < 0) return false;
    const t0 = this.t;
    this.t += dt;
    const t = this.t, F = BOOM.fuse;
    if (t > BOOM.len) { this.t = -1; return false; }
    if (t < F) { this.fuse(fx, dt, t / F); return false; }
    let bang = false;
    if (!this.banged) { this.banged = true; this.bang(fx); bang = true; }
    this.after(fx, dt, t - F, t0 - F);
    return bang;
  }

  private cnt(k: number) { return Math.max(1, Math.round(k * this.n)); }

  /** The fuse: a sputtering spark over the head, glow swelling round the hero. */
  private fuse(fx: Fx, dt: number, u: number) {
    const R = () => fx.rnd(), x = this.spark.x, y = this.spark.y, z = this.spark.z;
    fx.emit(SH_GLOW, x, y, z, 0, 0, 0, 0, 0.7 + 0.3 * u + R() * 0.2, 0, 1, 0.8, 0.4, 1, 0, 0, true);
    fx.ring(x, this.g, z, 0.5, 1.2 + 0.6 * u, -1, '#ffb05a', 0.7, 0.5, 0.6);
    fx.emit(SH_STAR, x, y, z, 0, 0, 0, 0, 0.22 + R() * 0.08, 0, 1, 0.95, 0.6, 1, 0, 0, false, R() * 6);
    fx.emit(SH_GLOW, this.x, this.y + 0.6, this.z, 0, 0, 0, 0, 0.6 + 1.6 * u * u, 0, 1, 0.6, 0.3, 0.25 + 0.35 * u, 0, 0, true);
    this.acc += dt;
    while (this.acc > 0.018) {
      this.acc -= 0.018;
      const a = R() * Math.PI * 2, sp = 1.5 + R() * 2.5;
      fx.emit(SH_SPARK, x, y, z, Math.cos(a) * sp, 1.5 + R() * 2.5, Math.sin(a) * sp, 0.3 + R() * 0.25, 0.18, 0.05, 1, 0.85, 0.4, 1, -9, 1, true, a);
    }
  }

  private bang(fx: Fx) {
    const R = () => fx.rnd(), { x, z } = this, y = this.y + 0.6, g = this.g, r = BOOM.radius;
    // flash ball + billboard shock ring
    fx.emit(SH_GLOW, x, y, z, 0, 0, 0, 0.3, 2.2, 6, 1, 0.95, 0.8, 0.85, 0, 0, true);
    fx.emit(SH_RING, x, y, z, 0, 0, 0, 0.5, 1, 16, 1, 0.92, 0.7, 1, 0, 0, true);
    fx.emit(SH_RING, x, y, z, 0, 0, 0, 0.7, 0.5, 9, 1, 0.7, 0.4, 0.8, 0, 0, true);
    // ground shockwaves (instanced rings)
    fx.ring(x, g, z, 0.6, r, 0.75, '#fff2c8', 1.3, 0.35);
    fx.ring(x, g, z, 0.4, r * 0.65, 1.3, '#ff9a4a', 0.9, 0.6, 0.25);
    fx.ring(x, g, z, 0.3, 3.2, 1.6, '#ffcf6a', 0.8, 0.2, 0.9);
    // fireball burst
    for (let i = 0, n = this.cnt(34); i < n; i++) {
      const a = R() * Math.PI * 2, b = R() * 1.1 + 0.1, sp = 2.2 + R() * 3;
      fx.emit(SH_GLOW, x, y, z, Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + 2, Math.sin(a) * Math.cos(b) * sp, 0.5 + R() * 0.3, 0.8 + R() * 0.5, 1.9 + R() * 0.8, 1, 0.5 + R() * 0.3, 0.18 + R() * 0.12, 0.6, 1.5, 4.5, true);
    }
    // a ring of dust rolling out along the ground
    for (let i = 0, n = this.cnt(30); i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.2, sp = 7 + R() * 4;
      fx.emit(SH_DUST, x + Math.cos(a) * 0.8, g + 0.2, z + Math.sin(a) * 0.8, Math.cos(a) * sp, 0.6 + R(), Math.sin(a) * sp, 1.0 + R() * 0.4, 0.5, 1.3, 0.86, 0.78, 0.7, 0.45, -0.2, 2.6, false, R() * 6, (R() - 0.5) * 2);
    }
    // confetti and stars
    for (let i = 0, n = this.cnt(56); i < n; i++) {
      const a = R() * Math.PI * 2, sp = 2 + R() * 6, c = CONF[(R() * CONF.length) | 0];
      fx.emit(SH_FEATHER, x, y + 0.5, z, Math.cos(a) * sp, 6 + R() * 6, Math.sin(a) * sp, 2.6 + R() * 1.2, 0.16, 0.14, c[0], c[1], c[2], 1, -5.5, 1.2, false, R() * 6, (R() - 0.5) * 12);
    }
    for (let i = 0, n = this.cnt(14); i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      fx.emit(SH_STAR, x, y + 0.3, z, Math.cos(a) * 5, 4 + R() * 3, Math.sin(a) * 5, 1.4 + R() * 0.5, 0.35, 0.18, 1, 0.88, 0.35, 1, -6, 1.5, false, R() * 6, (R() - 0.5) * 8);
    }
    for (let i = 0, n = this.cnt(24); i < n; i++) {   // sparks
      const a = R() * Math.PI * 2, sp = 8 + R() * 8;
      fx.emit(SH_SPARK, x, y, z, Math.cos(a) * sp, 2 + R() * 6, Math.sin(a) * sp, 0.4 + R() * 0.3, 0.3, 0.08, 1, 0.85, 0.5, 1, -8, 2, true, a);
    }
  }

  /** Column height (m above the ground) at s seconds after the bang. */
  private colH(s: number) { return Math.min(this.ceil, 1.0 + 3.9 * (1 - Math.exp(-s * 1.7))); }

  private after(fx: Fx, dt: number, s: number, s0: number) {
    const R = () => fx.rnd(), { x, z, g } = this, h = g + this.colH(s);
    this.acc += dt * this.n;
    // the climbing fireball (0 … 1.1 s): glowing puffs at the head of the column
    if (s < 1.1) {
      const k = 1 - s / 1.1;
      while (this.acc > 0.03) {
        this.acc -= 0.03;
        const a = R() * Math.PI * 2, rr = R() * 0.7;
        fx.emit(SH_GLOW, x + Math.cos(a) * rr, h, z + Math.sin(a) * rr, Math.cos(a) * 0.6, 1.2, Math.sin(a) * 0.6, 0.5 + R() * 0.3, 1.2 + k * 0.8, 2.0 + k, 1, 0.42 + 0.3 * k, 0.12 + 0.12 * k, 0.55 * k + 0.08, 0.5, 1.5, true);
        // smoke stem
        const sh = g + R() * (h - g);
        fx.emit(SH_DUST, x + (R() - 0.5) * 0.5, sh, z + (R() - 0.5) * 0.5, (R() - 0.5) * 0.25, 0.5 + R() * 0.4, (R() - 0.5) * 0.25, 2.2 + R(), 0.7, 1.1, 0.55, 0.47, 0.44, 0.65, 0, 0.6, false, R() * 6, (R() - 0.5));
      }
    } else this.acc = 0;
    // the stem keeps puffing (narrow, darker) while the cap forms
    if (s >= 0.3 && s < 2.0 && R() < 0.5 * this.n) {
      const sh = g + 0.3 + R() * (h - g - 0.6);
      fx.emit(SH_DUST, x + (R() - 0.5) * 0.5, sh, z + (R() - 0.5) * 0.5, 0, 0.5, 0, 2.2, 0.7, 1.0, 0.6, 0.52, 0.5, 0.7, 0, 0.8, false, R() * 6, 0.3);
    }
    // the mushroom cap (0.5 … 2.1 s): a wide flattened ring of lit puffs rolling outwards round the top, a dome over it
    if (s >= 0.5 && s0 < 2.1) {
      const n = this.cnt(s0 < 0.5 ? 22 : 2.6);
      const top = g + this.colH(2.5);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, rr = 1.4 + R() * 1.9, lit = 0.74 + R() * 0.16, dome = R() < 0.28;
        const px = x + Math.cos(a) * (dome ? rr * 0.4 : rr), pz = z + Math.sin(a) * (dome ? rr * 0.4 : rr);
        const py = top + ((dome ? 0.6 + R() * 0.5 : (R() - 0.5) * 0.4) - (dome ? 0 : rr * 0.12)) * this.sz - (this.sz < 1 ? 0.6 : 0);
        fx.emit(SH_DUST, px, py, pz, Math.cos(a) * (dome ? 0.3 : 1.1), (dome ? 0.25 : 0.05 + R() * 0.15) * this.sz, Math.sin(a) * (dome ? 0.3 : 1.1), 2.6 + R() * 1.4, 1.5 * this.sz, 3.0 * this.sz, lit + 0.14, lit + 0.02, lit - 0.04, 0.9, 0, 0.45, false, R() * 6, (R() - 0.5) * 0.6);
        if (R() < 0.3) fx.emit(SH_GLOW, px, py - 0.3, pz, Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5, 0.9, 1.4 * this.sz, 2.2 * this.sz, 1, 0.55, 0.25, 0.45, 0, 0.8, true);
      }
    }
  }
}
