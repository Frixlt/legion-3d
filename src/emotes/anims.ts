/**
 * Emote animations on the own avatar, driven through the public avatar hooks: the built-in emotes (Avatar.play:
 * wave, laugh), the face (AvatarSocial.setMood), the seated pose (AvatarSocial.setSit), and for the rest bone
 * overrides applied AFTER the avatar animated itself this frame (feature onFrame), like the combat ragdolls do:
 * dance, purr (hug + hearts), cry (paws to the eyes + tears), huff (arms crossed + steam), bow, sit on the ground.
 * Particles go to the shared fun Fx (src/combat/funfx.ts). No allocations per frame.
 */
import * as THREE from 'three';
import type { CombatRig } from '../avatar/avatar';
import { Fx, SH_GLOW, SH_HEART, SH_DUST, SH_STAR } from '../combat/fx';
import type { EmoteId } from './defs';

const BODY = 1, ARM_L = 2, ARM_R = 3, LEG_L = 4, LEG_R = 5, TAIL1 = 6, TAIL2 = 7;
const _v = new THREE.Vector3();

/** Envelope: eased in over the first 15 %, out over the last 15 %. */
export const emoteEnv = (k: number) => Math.max(0, Math.min(1, k / 0.15, (1 - k) / 0.15));

/**
 * Pose one frame of emote `id` at progress k (0..1, `e` seconds in) on the bones (already animated this frame).
 * Returns the extra drop of the root (m, sitting on the ground) the caller subtracts from root.y.
 */
export function poseEmote(id: EmoteId, rig: CombatRig, k: number, e: number, reduced: boolean): number {
  const b = rig.bones, body = b[BODY], armL = b[ARM_L], armR = b[ARM_R], legL = b[LEG_L], legR = b[LEG_R];
  const env = emoteEnv(k), m = reduced ? 0.4 : 1;
  switch (id) {
    case 'dance': {
      const beat = e * 7.2;            // ~2 steps a second
      const s = Math.sin(beat), up = Math.abs(Math.sin(beat));
      body.position.y += up * 0.07 * env * m;
      body.rotation.z += s * 0.24 * env * m;
      body.rotation.y += Math.sin(beat * 0.5) * 0.35 * env * m;
      armL.rotation.set(0.2 * env, 0, -0.25 - env * (1.6 + 0.9 * Math.max(0, s)));
      armR.rotation.set(0.2 * env, 0, 0.25 + env * (1.6 + 0.9 * Math.max(0, -s)));
      legL.rotation.x += (Math.max(0, s) * 0.6 - legL.rotation.x) * env;
      legR.rotation.x += (Math.max(0, -s) * 0.6 - legR.rotation.x) * env;
      if (rig.hasTail) b[TAIL1].rotation.z += Math.sin(beat) * 0.5 * env;
      return 0;
    }
    case 'purr': {      // paws hugging the chest, a slow happy sway, the tail curls
      const sw = Math.sin(e * 3.2);
      armL.rotation.set(env * 1.25, 0, -0.18 + env * 1.0);
      armR.rotation.set(env * 1.25, 0, 0.18 - env * 1.0);
      body.rotation.z += sw * 0.12 * env * m;
      body.rotation.x += 0.05 * env;
      body.scale.y *= 1 + Math.sin(e * 6) * 0.02 * env * m;
      if (rig.hasTail) { b[TAIL1].rotation.z += sw * 0.4 * env; b[TAIL2].rotation.z += sw * 0.5 * env; }
      return 0;
    }
    case 'cry': {       // paws up to the eyes, the head down, little sobs
      const sob = Math.abs(Math.sin(e * 11)) * env * m;
      armL.rotation.set(env * 1.9, 0, -0.18 + env * 0.95);
      armR.rotation.set(env * 1.9, 0, 0.18 - env * 0.95);
      body.rotation.x -= 0.2 * env;
      body.position.y += sob * 0.018;
      body.scale.y *= 1 - sob * 0.02;
      if (rig.hasTail) b[TAIL1].rotation.x += 0.45 * env;   // tail droops
      return 0;
    }
    case 'huff': {      // arms crossed, turned half away, a stomp
      const st = Math.max(0, Math.sin(e * 9)) * env * m;
      armL.rotation.set(env * 1.45, 0, -0.18 + env * 1.15);
      armR.rotation.set(env * 1.3, 0, 0.18 - env * 1.15);
      body.rotation.y += 0.55 * env;
      body.rotation.x += 0.08 * env;
      legR.rotation.x += (-0.35 * st - legR.rotation.x * env);
      if (rig.hasTail) { b[TAIL1].rotation.z += Math.sin(e * 16) * 0.35 * env; }
      return 0;
    }
    case 'bow': {       // a deep bow with a paw on the chest, the other behind
      const d = Math.sin(Math.min(1, k * 2.2) * Math.PI / 2) * Math.min(1, (1 - k) / 0.25);
      body.rotation.x -= 0.62 * d;
      armR.rotation.set(d * 1.3, 0, 0.18 - d * 0.8);
      armL.rotation.set(-d * 0.6, 0, -0.18 - d * 0.25);
      return 0;
    }
    case 'sit': {       // seated pose of the avatar (setSit) right on the ground: lower the root onto the seat
      return 0;
    }
    default: return 0;
  }
}

/** Particles of an emote (hearts, tears, steam, notes). `every` call per frame; q = quality (q0: none). */
export class EmoteFx {
  private acc = 0;
  reset() { this.acc = 0; }

  emit(fx: Fx | null, id: EmoteId, dt: number, k: number, root: THREE.Object3D, rig: CombatRig | null, q: number, reduced: boolean) {
    if (!fx || q <= 0 || !rig || k > 0.9) return;
    this.acc += dt;
    const R = () => fx.rnd();
    const yaw = root.rotation.y, fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const p = root.position;
    const gap = (base: number) => base * (reduced ? 2 : q >= 2 ? 1 : 1.6);
    switch (id) {
      case 'purr':
        while (this.acc > gap(0.28)) {
          this.acc -= gap(0.28);
          const s = R() - 0.5;
          fx.emit(SH_HEART, p.x + rx * s * 0.5 + fwdX * 0.15, p.y + rig.top + 0.1, p.z + rz * s * 0.5 + fwdZ * 0.15, rx * s * 0.6, 0.8 + R() * 0.4, rz * s * 0.6, 1.4, 0.13, 0.2, 1, 0.45 + R() * 0.2, 0.62, 1, -0.2, 1.2, false, s, s * 2);
        }
        break;
      case 'cry':
        while (this.acc > gap(0.12)) {
          this.acc -= gap(0.12);
          const side = R() < 0.5 ? -1 : 1;
          _v.set(p.x + rx * side * rig.ex * 1.1 + fwdX * rig.depth * 0.5, p.y + rig.eyeY - 0.03, p.z + rz * side * rig.ex * 1.1 + fwdZ * rig.depth * 0.5);
          fx.emit(SH_GLOW, _v.x, _v.y, _v.z, rx * side * 0.9 + fwdX * 0.4, 1.0 + R() * 0.6, rz * side * 0.9 + fwdZ * 0.4, 0.55, 0.05, 0.035, 0.45, 0.75, 1, 1, -9, 0.4, true);
        }
        break;
      case 'huff':
        while (this.acc > gap(0.16)) {
          this.acc -= gap(0.16);
          const side = R() < 0.5 ? -1 : 1;
          fx.emit(SH_DUST, p.x + rx * side * 0.14, p.y + rig.top + 0.05, p.z + rz * side * 0.14, rx * side * 0.5, 1.1 + R() * 0.5, rz * side * 0.5, 0.75, 0.08, 0.28, 0.97, 0.97, 1, 0.8, 0, 2.2, false, R() * 6, 1.5);
        }
        break;
      case 'dance':
        while (this.acc > gap(0.4)) {
          this.acc -= gap(0.4);
          const a = R() * Math.PI * 2;
          fx.emit(SH_STAR, p.x + Math.cos(a) * 0.35, p.y + rig.top * 0.9, p.z + Math.sin(a) * 0.35, Math.cos(a) * 0.4, 0.9, Math.sin(a) * 0.4, 1.0, 0.09, 0.05, 1, 0.85 + R() * 0.15, 0.4 + R() * 0.4, 1, -0.5, 1, false, a, 3);
        }
        break;
      case 'wave': case 'bow': case 'laugh': case 'sit':
        if (k < 0.05 && this.acc < 1) {   // one little sparkle when it starts
          this.acc = 2;
          fx.emit(SH_GLOW, p.x, p.y + rig.top + 0.2, p.z, 0, 0.5, 0, 0.5, 0.12, 0.25, 1, 0.95, 0.75, 0.6, 0, 1, true);
        }
        break;
    }
  }
}
