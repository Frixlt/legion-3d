/**
 * How a flying mage looks: a gentle bob of the drawn body (the camera does not bob), legs dangling, arms a little out
 * for balance, a lean into the flight direction, the robe / cape fluttering, a soft magic circle on the ground under
 * the hero and a sparkle trail. Runs AFTER the avatar animated itself this frame (feature onFrame) and only adds to /
 * overrides the bones it touches; no allocations per frame.
 */
import * as THREE from 'three';
import type { CombatRig } from '../avatar/avatar';
import { Fx, SH_GLOW, SH_STAR } from '../combat/fx';

// bone indices (src/avatar/model.ts B)
const BODY = 1, ARM_L = 2, ARM_R = 3, LEG_L = 4, LEG_R = 5, TAIL1 = 6, CAPE1 = 8, CAPE2 = 9;

/** Trail colour per role (falls back to the mage blue). */
export const TRAIL_COLOR: Record<string, string> = { mage: '#9fdcff', necromancer: '#c9a3ff', priest: '#ffe9a0' };

const _c = new THREE.Color();

export class FlightLook {
  /** 0..1 blend of the flying pose (eased in / out). */
  k = 0;
  private trailT = 0;
  private stepT = 0;

  /**
   * Pose one frame. `on` = flying, `above` = height over the support (m), `speed01` = horizontal speed (walk = 1).
   * Returns the visual bob (m) the caller adds to the avatar root.
   */
  pose(rig: CombatRig | null, dt: number, t: number, on: boolean, above: number, speed01: number, reduced: boolean): number {
    const want = on ? 1 : 0;
    this.k += (want - this.k) * Math.min(1, dt * (on ? 5 : 7));
    if (Math.abs(this.k - want) < 0.002) this.k = want;
    const k = this.k;
    if (k <= 0 || !rig) return 0;
    const b = rig.bones;
    const lift = Math.min(1, above / 0.6) * k;
    const s = Math.min(1, speed01);
    const bob = reduced ? 0 : Math.sin(t * 2.3) * 0.07 * lift;
    // legs dangle and paddle a little; forward flight trails them back
    const pad = reduced ? 0 : Math.sin(t * 3.1) * 0.18;
    const legL = b[LEG_L], legR = b[LEG_R];
    legL.rotation.x += (-0.25 * s + 0.12 + pad - legL.rotation.x) * lift;
    legR.rotation.x += (-0.25 * s - 0.05 - pad - legR.rotation.x) * lift;
    // body: lean into the flight, a slow roll
    const body = b[BODY];
    body.position.y += (rig.rest[BODY].y - rig.rest[0].y - body.position.y) * lift;   // no walk hop in the air
    body.rotation.x += (-0.22 * s - 0.04) * lift;
    body.rotation.z += (reduced ? 0 : Math.sin(t * 1.4) * 0.05) * lift;
    // arms a little out (balance), the walk swing calmed down
    b[ARM_L].rotation.x *= 1 - 0.7 * lift; b[ARM_R].rotation.x = b[ARM_R].rotation.x * (1 - 0.5 * lift) + 0.15 * lift;
    b[ARM_L].rotation.z -= 0.45 * lift; b[ARM_R].rotation.z += 0.3 * lift;
    // robe / cape flutter, the tail streams behind
    if (b[CAPE1] && b[CAPE2]) {
      const fl = reduced ? 0 : Math.sin(t * 9.5) * 0.07 + Math.sin(t * 6.1 + 1) * 0.05;
      b[CAPE1].rotation.x += (-0.25 - 0.35 * s + fl) * lift;
      b[CAPE2].rotation.x += (-0.35 - 0.45 * s + fl * 1.6) * lift;
      b[CAPE2].rotation.z += (reduced ? 0 : Math.sin(t * 4.3) * 0.08) * lift;
    }
    if (rig.hasTail && b[TAIL1]) b[TAIL1].rotation.x += (-0.35 - 0.3 * s) * lift;
    return bob;
  }

  /** Magic circle on the ground and the sparkle trail (q = quality level; q0: nothing). */
  effects(fx: Fx | null, dt: number, t: number, x: number, feetY: number, z: number, groundY: number, yaw: number, role: string, q: number, reduced: boolean) {
    const k = this.k;
    if (!fx || k <= 0.05 || q <= 0) return;
    _c.set(TRAIL_COLOR[role] || TRAIL_COLOR.mage);
    const above = feetY - groundY;
    // a soft light pool under the hero, fading with height (one-frame ring: re-emitted every frame)
    const a = Math.max(0, 1 - above / 10) * 0.85 * k;
    if (a > 0.02) fx.ring(x, groundY, z, 0.5, 0.7 + above * 0.1, -1, _c, a, 0.45, 0.5);
    // sparkles drift down from the hem
    this.trailT += dt;
    const every = reduced ? 0.12 : q >= 2 ? 0.035 : 0.07;
    while (this.trailT >= every) {
      this.trailT -= every;
      const r = fx.rnd, ang = r.call(fx) * Math.PI * 2, rr = 0.12 + r.call(fx) * 0.12;
      const bx = x + Math.sin(yaw) * 0.12 + Math.cos(ang) * rr, bz = z + Math.cos(yaw) * 0.12 + Math.sin(ang) * rr;
      fx.emit(SH_GLOW, bx, feetY + 0.12, bz, 0, -0.35 - r.call(fx) * 0.3, 0, 0.8 + r.call(fx) * 0.5, 0.16, 0.03, _c.r, _c.g, _c.b, 0.9, 0, 0.6, true);
      if (r.call(fx) < 0.3) fx.emit(SH_STAR, bx, feetY + 0.2, bz, 0, -0.25, 0, 0.9, 0.11, 0.03, 1, 0.97, 0.85, 1, 0, 0.5, false, t * 2, 3);
    }
    // a tiny puff every few steps of "paddling" (only q ≥ 2)
    this.stepT += dt;
    if (q >= 2 && !reduced && this.stepT > 0.6) {
      this.stepT = 0;
      fx.emit(SH_GLOW, x, feetY + 0.05, z, 0, -0.2, 0, 0.5, 0.12, 0.35, _c.r, _c.g, _c.b, 0.35, 0, 0.5, true);
    }
  }
}
