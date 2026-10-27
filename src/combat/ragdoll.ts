/**
 * Drives one avatar as a ragdoll: hit (flash + hit-stop squash) → fall (physics) → down (dizzy face, stars) →
 * get-up (a springy roll back onto the feet, blended back into the walk/idle animation) → return (glide back to
 * where the site says the player is). The avatar's own animation keeps running underneath (the crowd updates it
 * before us every frame); we overwrite the root transform and the bones after it, so blending in and out is a
 * slerp between "what the animation wants" and "what the physics says".
 *
 * Nothing here ever touches the site or the walker: the crowd keeps placing the avatar at the site position every
 * frame, we only override the drawn transform while the ragdoll lasts.
 */
import * as THREE from 'three';
import type { Avatar } from '../contracts/modules';
import type { AvatarCombat, CombatRig } from '../avatar/avatar';
import { Ragdoll, makeShape, A, C, type RagdollEnv } from './physics';
import { Fx, SH_STAR, SH_GLOW } from './fx';

export type Phase = 'hit' | 'fall' | 'down' | 'getup' | 'shake' | 'return' | 'done';
export type CombatAvatar = Avatar & Partial<AvatarCombat>;

const DOWN_TIME = 1.9, GETUP_TIME = 0.6, SHAKE_TIME = 0.6, MAX_FALL = 3.2;
const BLEND_IN = 0.1;
// bone indices (src/avatar/model.ts B)
const BODY = 1, ARM_L = 2, ARM_R = 3, LEG_L = 4, LEG_R = 5, TAIL1 = 6, TAIL2 = 7;
const LIMB_BONES = [ARM_L, ARM_R, LEG_L, LEG_R, TAIL1] as const;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _d = new Float32Array(6), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ease = (x: number) => x * x * (3 - 2 * x);
const backOut = (x: number) => { const c = 1.2; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

/** Physics shape of an avatar rig (model space). */
export function shapeOf(rig: CombatRig) {
  const r = rig.rest;
  const sh = r[ARM_R], hip = r[LEG_R], tb = r[TAIL1];
  return makeShape({
    y0: rig.y0, top: rig.top, w: rig.w, depth: rig.depth, armY: rig.armY,
    shoulder: [sh.x, sh.y, sh.z], hand: [rig.handR.x, rig.handR.y, rig.handR.z],
    hip: [hip.x, hip.y, hip.z],
    tailBase: [tb.x, tb.y, tb.z], tailTip: [tb.x + 0.09, tb.y + 0.36, tb.z + 0.2],
    hasLegs: rig.hasLegs, hasTail: rig.hasTail,
  });
}

export class AvatarRagdoll {
  phase: Phase = 'hit';
  t = 0;
  /** Total time since the hit (oldest-first eviction). */
  age = 0;
  readonly phys: Ragdoll;
  private rig: CombatRig;
  private hitStop: number;
  private imp = new Float32Array(8);   // vx vy vz px py pz falloff spin
  /** Landing squash: amount (0..1) and time since. */
  private sq = 0; private sqT = 1; private bounces = 0;
  private starA = 0;
  private restQ: THREE.Quaternion[] = [];     // ragdoll bone rotations captured at get-up start
  private lieQ = new THREE.Quaternion(); private lieC = new THREE.Vector3();
  private upQ = new THREE.Quaternion(); private standC = new THREE.Vector3();
  private stand = new THREE.Vector3();         // feet where it got up
  private standYaw = 0;
  private cModel = new THREE.Vector3();        // body centre in model space
  private retLen = 0.3;
  flash = 0;
  private starPh = Math.random() * 6;
  /** Head position (world) for the nameplate while down. */
  readonly head = new THREE.Vector3();

  constructor(readonly id: string, readonly av: CombatAvatar, rig: CombatRig, stop: number, flash = true) {
    this.rig = rig;
    this.phys = new Ragdoll(shapeOf(rig));
    this.hitStop = stop;
    for (let i = 0; i < 5; i++) this.restQ.push(new THREE.Quaternion());
    const r = this.phys.aRest;
    this.cModel.set(0, (r[1] + (rig.top - rig.w * 0.9)) / 2, 0);
    this.flash = flash ? 0.45 : 0;
    if (flash) av.setFlash?.(0.45);
  }

  /** Queue the knock-back (applied when the hit-stop ends). Point in world metres. */
  push(vx: number, vy: number, vz: number, px: number, py: number, pz: number, falloff = 0.6, spin = 1) {
    if (this.phase === 'hit') { this.imp[0] = vx; this.imp[1] = vy; this.imp[2] = vz; this.imp[3] = px; this.imp[4] = py; this.imp[5] = pz; this.imp[6] = falloff; this.imp[7] = spin; return; }
    if (this.phase === 'getup' || this.phase === 'shake' || this.phase === 'return') this.restart();
    this.launch(vx, vy, vz, px, py, pz, falloff, spin);
    this.phase = 'fall'; this.t = 0; this.bounces = 0;
    this.av.setDizzy?.(true);
  }

  /** The knock-back itself: the impulse plus a cartoon tumble head-over-heels along the push (and a little twist). */
  private launch(vx: number, vy: number, vz: number, px: number, py: number, pz: number, falloff: number, spin: number) {
    this.phys.impulse(vx, vy, vz, px, py, pz, falloff);
    const h = Math.hypot(vx, vz);
    if (h > 0.01 && spin > 0) {
      const w = Math.min(10, h * 1.6) * spin * (0.75 + Math.random() * 0.5), tw = (Math.random() - 0.5) * 7 * spin;
      this.phys.spin((vz / h) * w, tw, (-vx / h) * w);
    }
  }

  /** Hit again while getting up / returning: go limp from the current drawn pose. */
  private restart() {
    const root = this.av.root;
    this.phys.init(root.position.x, root.position.y, root.position.z, this.yawOf(root.quaternion));
  }

  /** Cut the rest short (too many ragdolls): get up now. */
  hurry() { this.hurried = true; }
  private hurried = false;
  private lastVy = 0;

  private yawOf(q: THREE.Quaternion) { _v.set(0, 0, -1).applyQuaternion(q); return Math.atan2(-_v.x, -_v.z); }

  /**
   * Advance and write the pose. Call after the avatar's own update for this frame. `env` = the walkable space.
   * Returns false when finished (the avatar is back under the crowd's control).
   */
  update(dt: number, env: RagdollEnv, fx: Fx | null): boolean {
    const root = this.av.root;
    this.t += dt; this.age += dt;
    // where the site (crowd) put the avatar this frame
    const siteX = root.position.x, siteY = root.position.y, siteZ = root.position.z, siteYaw = root.rotation.y;
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 4); this.av.setFlash?.(this.flash); }

    this.sqT += dt;
    switch (this.phase) {
      case 'hit': {
        // hit-stop: squashed by the blow, frozen for a beat
        const bones = this.rig.bones, k = 1 - Math.min(1, this.t / Math.max(0.01, this.hitStop));
        bones[BODY].scale.set(1 + 0.12 * k, 1 - 0.14 * k, 1 + 0.12 * k);
        // recoil: already leaning away from the blow while frozen
        const hx = this.imp[0], hz = this.imp[2], hl = Math.hypot(hx, hz);
        if (hl > 0.01) {
          const r = Math.min(1, this.t / 0.025) * 0.3;
          _v.set(hz / hl, 0, -hx / hl);
          _q.setFromAxisAngle(_v, r);
          root.quaternion.premultiply(_q);
          root.position.x += (hx / hl) * 0.04 * r / 0.3; root.position.z += (hz / hl) * 0.04 * r / 0.3;
        }
        if (this.t >= this.hitStop) {
          this.phys.init(siteX, siteY, siteZ, siteYaw);
          this.seedLimbs();
          this.phase = 'fall'; this.t = 0;
          const i = this.imp;
          this.launch(i[0], i[1], i[2], i[3], i[4], i[5], i[6], i[7]);
          this.av.setDizzy?.(true);
        }
        this.head.set(siteX, siteY + this.rig.headTop, siteZ);
        return true;
      }
      case 'fall': case 'down': {
        this.phys.step(dt, env);
        if (this.phase === 'fall' && ((this.phys.still > 0.25 && this.t > 0.5) || this.t > MAX_FALL)) { this.phase = 'down'; this.t = 0; }
        // a puff of dust whenever the body slams into the ground
        if (fx && this.phase === 'fall') {
          const ph = this.phys, g = env.groundAt(ph.p[0], ph.p[2]);
          const vy = (ph.p[1] - ph.prev[1]) * 60;
          if (ph.p[1] - g < this.rig.w + 0.05 && this.lastVy < -1.6 && vy > this.lastVy + 1.2) {
            fx.dust(ph.p[0], g, ph.p[2], 7, 0.85, 0.8, 0.72, 0.9, 0.5);
            this.sq = Math.min(1, -this.lastVy / 5); this.sqT = 0;
            // a cartoon "boing": the first landing springs the body back up a little (the solver alone eats it)
            if (this.bounces++ === 0) ph.impulse(0, Math.min(2.8, -this.lastVy * 0.6), 0, ph.p[0], ph.p[1], ph.p[2], 0);
          }
          this.lastVy = vy;
        }
        if ((this.phase === 'down' && this.t > DOWN_TIME) || this.hurried) { this.beginGetup(env, fx); this.writeGetup(0); return true; }
        this.writeRagdoll(Math.min(1, (this.phase === 'fall' ? this.t : 1) / BLEND_IN));
        if (fx && (this.phase === 'down' || this.t > 0.35)) this.stars(dt, fx, 1);
        return true;
      }
      case 'getup': {
        const k = Math.min(1, this.t / GETUP_TIME);
        this.writeGetup(k);
        if (fx && k < 0.5) this.stars(dt, fx, 1 - k * 2);
        if (k >= 1) {
          this.phase = 'shake'; this.t = 0;
          this.av.play('land');
          if (fx) {   // the dizziness flies off: a few sparkles from the head
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + fx.rnd();
              fx.emit(SH_STAR, this.head.x, this.head.y - 0.1, this.head.z, Math.cos(a) * 1.6, 1.4 + fx.rnd(), Math.sin(a) * 1.6, 0.55, 0.11, 0.04, 1, 0.88, 0.3, 1, -5, 2, false, fx.rnd() * 6, (fx.rnd() - 0.5) * 10);
            }
          }
        }
        return true;
      }
      case 'shake': {
        // a cute shake-off: the head (the whole blob) wiggles left-right, fast then dying out, on the spot
        const k = Math.min(1, this.t / SHAKE_TIME), d = 1 - k * k;
        root.position.copy(this.stand);
        root.rotation.set(0, this.standYaw, 0);
        const body = this.rig.bones[BODY], w = this.t * 30;
        body.rotation.y += Math.sin(w) * 0.4 * d;
        body.rotation.z += Math.sin(w + 0.3) * 0.34 * d;   // a side-to-side wobble reads in silhouette
        body.position.y += Math.abs(Math.sin(w)) * 0.02 * d;
        const sq = 1 + Math.cos(w * 2) * 0.05 * d;
        body.scale.set(body.scale.x / Math.sqrt(sq), body.scale.y * sq, body.scale.z / Math.sqrt(sq));
        this.head.set(root.position.x, root.position.y + this.rig.headTop, root.position.z);
        if (k >= 1) {
          this.av.setDizzy?.(false);
          this.phase = 'return'; this.t = 0;
          const d2 = Math.hypot(siteX - this.stand.x, siteZ - this.stand.z);
          this.retLen = Math.min(2.5, Math.max(0.25, d2 / 2.2));
        }
        return true;
      }
      case 'return': {
        const k = Math.min(1, this.t / this.retLen), e = ease(k);
        root.position.set(this.stand.x + (siteX - this.stand.x) * e, this.stand.y + (siteY - this.stand.y) * e, this.stand.z + (siteZ - this.stand.z) * e);
        let dy = siteYaw - this.standYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        root.rotation.set(0, this.standYaw + dy * ease(Math.min(1, k * 2)), 0);
        this.head.set(root.position.x, root.position.y + this.rig.headTop, root.position.z);
        if (k >= 1) { this.finish(); return false; }
        return true;
      }
      default: return false;
    }
  }

  /** Put the paw / foot / tail particles where the animated pose has them, so the fall starts from the pose. */
  private seedLimbs() {
    const b = this.rig.bones, root = this.av.root;
    root.updateMatrixWorld(true);
    const ends: [number, THREE.Vector3][] = [[ARM_L, this.rig.handL], [ARM_R, this.rig.handR]];
    for (let k = 0; k < 2; k++) {
      const [bi, hand] = ends[k];
      _v.copy(hand).applyMatrix4(b[bi].matrixWorld);
      this.phys.place(4 + k, _v.x, _v.y, _v.z);
    }
  }

  private writeRagdoll(w: number) {
    const root = this.av.root, ph = this.phys, m = ph.basis, bones = this.rig.bones;
    _m.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    root.quaternion.setFromRotationMatrix(_m);
    const a = ph.aRest;
    _v.set(a[0], a[1], a[2]).applyQuaternion(root.quaternion);
    root.position.set(ph.p[A * 3] - _v.x, ph.p[A * 3 + 1] - _v.y, ph.p[A * 3 + 2] - _v.z);
    // body bone at rest (the physics body is the whole blob); limbs from the particles
    const body = bones[BODY], rb = this.rig.rest[BODY];
    body.position.set(body.position.x + (rb.x - body.position.x) * w, body.position.y + (rb.y - body.position.y) * w, body.position.z + (rb.z - body.position.z) * w);
    _q.identity(); body.quaternion.slerp(_q, w);
    body.scale.set(1, 1, 1);
    if (this.sq > 0 && this.sqT < 0.36) {
      // landing squash along whichever body axis points up now (the blob flattens against the ground, then springs)
      const e = this.sqT / 0.36, a = this.sq * 0.4 * Math.sin(Math.min(1, e * 3) * Math.PI / 2) * (1 - e) * (1 - e) * (1 + 0.6 * Math.cos(e * 9));
      const ux = Math.abs(m[3]), uy = Math.abs(m[4]), uz = Math.abs(m[5]);   // world up in body-local axes
      const s1 = 1 - a, s2 = 1 + a * 0.5;
      body.scale.set(ux >= uy && ux >= uz ? s1 : s2, uy > ux && uy >= uz ? s1 : s2, uz > ux && uz > uy ? s1 : s2);
    }
    for (let k = 0; k < 5; k++) {
      const bone = bones[LIMB_BONES[k]];
      if (!bone) continue;
      ph.limbLocal(k, _d);
      _a.set(_d[3], _d[4], _d[5]); _b.set(_d[0], _d[1], _d[2]);
      _q.setFromUnitVectors(_a, _b);
      bone.quaternion.slerp(_q, w);
    }
    if (bones[TAIL2]) bones[TAIL2].quaternion.slerp(_q.identity(), w);
    this.head.set(ph.p[C * 3], ph.p[C * 3 + 1] + this.rig.w + 0.2, ph.p[C * 3 + 2]);
  }

  private beginGetup(env: RagdollEnv, fx?: Fx | null) {
    const root = this.av.root, ph = this.phys, bones = this.rig.bones;
    this.writeRagdoll(1);
    for (let k = 0; k < 5; k++) this.restQ[k].copy(bones[LIMB_BONES[k]].quaternion);
    this.lieQ.copy(root.quaternion);
    this.lieC.copy(this.cModel).applyQuaternion(root.quaternion).add(root.position);
    // stand up facing where the head was
    const hx = ph.p[C * 3] - ph.p[A * 3], hz = ph.p[C * 3 + 2] - ph.p[A * 3 + 2];
    this.standYaw = Math.hypot(hx, hz) > 0.05 ? Math.atan2(-hx, -hz) : this.yawOf(root.quaternion);
    this.upQ.setFromAxisAngle(UP, this.standYaw);
    const sx = (ph.p[0] + ph.p[3]) / 2, sz = (ph.p[2] + ph.p[5]) / 2;
    this.stand.set(sx, env.groundAt(sx, sz), sz);
    this.hurried = false;
    fx?.dust(this.stand.x, this.stand.y, this.stand.z, 5, 0.85, 0.8, 0.72, 0.6, 0.6);
    this.phase = 'getup'; this.t = 0;
  }

  /**
   * Get-up (k 0..1 over GETUP_TIME): a short struggle on the ground (a wiggle), then a springy roll up onto the feet
   * with a small hop, a landing squash and a settle. Limbs blend from the ragdoll pose back into the live animation.
   */
  private writeGetup(k: number) {
    const root = this.av.root, bones = this.rig.bones;
    const kr = Math.min(1, Math.max(0, (k - 0.22) / 0.4));
    const r = kr < 1 ? backOut(kr) : 1, e = ease(kr);
    _q2.copy(this.lieQ).slerp(this.upQ, Math.min(1.08, r));
    if (k < 0.22) {   // struggle: a little wiggle where it lies
      const w = Math.sin(k * 60) * 0.1 * (k / 0.22);
      _q.setFromAxisAngle(UP, w); _q2.premultiply(_q);
    }
    root.quaternion.copy(_q2);
    this.standC.copy(this.cModel).applyQuaternion(this.upQ).add(this.stand);
    _v2.copy(this.lieC).lerp(this.standC, e);
    _v2.y += Math.sin(Math.PI * kr) * 0.17;   // a little hop
    _v.copy(this.cModel).applyQuaternion(_q2);
    root.position.copy(_v2).sub(_v);
    // limbs: from the ragdoll pose back into the live animation
    for (let i = 0; i < 5; i++) bones[LIMB_BONES[i]].quaternion.slerp(this.restQ[i], 1 - e);
    // land: squash and spring back
    if (k > 0.62) {
      const q = (k - 0.62) / 0.38, a = Math.sin(Math.min(1, q * 2.5) * Math.PI / 2) * (1 - q) * (1 - q) * 0.2;
      const b = bones[BODY]; b.scale.set(b.scale.x * (1 + a * 0.5), b.scale.y * (1 - a), b.scale.z * (1 + a * 0.5));
    } else if (k < 0.22) {
      const b = bones[BODY], a = Math.abs(Math.sin(k * 60)) * 0.05;
      b.scale.set(b.scale.x * (1 + a), b.scale.y * (1 - a), b.scale.z * (1 + a));
    }
    this.head.set(root.position.x, root.position.y + this.rig.headTop, root.position.z);
  }

  /** Dizzy stars: four big cartoon stars circling over the head, tilted like a halo, plus a faint glow each. */
  private stars(dt: number, fx: Fx, amt: number) {
    this.starPh += dt * 4.6;
    this.starA = Math.min(1, this.starA + dt * 5) * amt;
    if (this.starA < 0.02) return;
    const ph = this.phys;
    const cx = this.head.x, cy = this.head.y - 0.12, cz = this.head.z;
    for (let i = 0; i < 4; i++) {
      const a = this.starPh + (i * Math.PI * 2) / 4, R = 0.3;
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R, y = cy + Math.sin(a + 0.8) * 0.06;
      const s = 0.24 * this.starA * (0.85 + 0.15 * Math.sin(a * 2));
      fx.emit(SH_GLOW, x, y, z, 0, 0, 0, 0, s * 1.5, s * 1.5, 1, 0.85, 0.35, 0.45 * this.starA, 0, 0, true);
      fx.emit(SH_STAR, x, y, z, 0, 0, 0, 0, s, s, 1, 0.9, 0.32, 1, 0, 0, false, a * 1.5);
    }
    void ph;
  }

  /** Back to normal (also when the avatar went away or combat was switched off). */
  finish() {
    const root = this.av.root;
    root.rotation.set(0, root.rotation.y, 0);
    if (this.phase !== 'return') root.quaternion.setFromAxisAngle(UP, this.yawOf(root.quaternion));
    root.rotation.x = 0; root.rotation.z = 0;
    this.rig.bones[BODY].scale.set(1, 1, 1);
    this.av.setDizzy?.(false);
    this.av.setFlash?.(0);
    this.phase = 'done';
  }
}
