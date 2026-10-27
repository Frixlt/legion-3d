/**
 * Projectiles: arrows (gravity, a faint trail, they stick into the ground and walls for a few seconds) and magic orbs
 * (straight, slightly homing, a glowing comet drawn by the particle system). Arrows are ONE InstancedMesh.
 * Each frame a projectile sweeps its path segment against the target capsules and the walkable space.
 */
import * as THREE from 'three';
import { Parts, T, cyl, cone, box } from '../avatar/geom';
import { toonMat } from '../avatar/materials';
import { segCapsule } from './sweep';
import type { RagdollEnv } from './physics';
import { Fx, SH_GLOW, SH_SPARK, SH_FEATHER, SH_STAR } from './fx';
import { SwingTrail } from './trail';

export type ShotKind = 'arrow' | 'orb';
export interface ShotTarget { id: string; x: number; y: number; z: number; r: number; h: number; down: boolean }
export type ShotHit = (kind: ShotKind, targetIndex: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number) => void;
export type ShotStick = (kind: ShotKind, x: number, y: number, z: number) => void;

const MAX = 24, STICK_TIME = 4.5, FLY_TIME = 4, ORB_TIME = 1.8, GRAV = -9.8;
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);

interface Shot {
  kind: ShotKind; on: boolean;
  p: THREE.Vector3; v: THREE.Vector3; t: number;
  stuck: number;        // ≥ 0: seconds stuck, −1 flying
  q: THREE.Quaternion; slot: number;
  color: THREE.Color;
}

export class Projectiles {
  readonly root = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private shots: Shot[] = [];
  private geo: THREE.BufferGeometry;
  readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** The newest projectile's ribbon (one draw call while it shows): a twisting band round an orb's path, a thin
   *  streak behind an arrow. */
  readonly spiral = new SwingTrail(0.32);
  private clock = 0;
  private spiralOrb: Shot | null = null;

  constructor() {
    const p = new Parts();
    // arrow along −Z, centred on the shaft: wooden shaft, steel head, pink fletching (cute)
    p.add(cyl(0.011, 0.011, 0.62, 6), '#c89a62', T(0, 0, 0, Math.PI / 2, 0, 0));
    p.add(cone(0.028, 0.08, 4), '#d4dde5', T(0, 0, -0.34, -Math.PI / 2, 0, 0));
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; p.add(box(0.004, 0.035, 0.1), '#ff7fa0', T(Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0.25, 0, 0, a + Math.PI / 2)); }
    this.geo = p.build();
    this.mesh = new THREE.InstancedMesh(this.geo, toonMat('n'), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.name = 'combat-arrows'; this.mesh.castShadow = false;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.shots.push({ kind: 'arrow', on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, stuck: -1, q: new THREE.Quaternion(), slot: i, color: new THREE.Color() });
    }
    this.mesh.count = MAX;
    this.mesh.visible = false;
    this.root.add(this.mesh);
    this.spiral.depth(true);
    this.root.add(this.spiral.mesh);
  }

  get active(): number { let n = 0; for (const s of this.shots) if (s.on) n++; return n; }
  get flying(): number { let n = 0; for (const s of this.shots) if (s.on && s.stuck < 0) n++; return n; }

  fire(kind: ShotKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.ColorRepresentation = '#9fd8ff') {
    // a free slot, else the oldest stuck arrow, else the oldest anything
    let s = this.shots.find((q) => !q.on);
    if (!s) { s = this.shots.reduce((a, b) => (b.stuck > a.stuck ? b : a)); }
    s.kind = kind; s.on = true; s.t = 0; s.stuck = -1;
    s.p.set(x, y, z); s.v.set(vx, vy, vz); s.color.set(color);
    s.q.setFromUnitVectors(FWD, _d.set(vx, vy, vz).normalize());
    this.spiralOrb = s; this.spiral.begin(kind === 'orb' ? color : '#ffe6f0', kind === 'orb' ? 1.1 : 0.8);
    return s;
  }

  update(dt: number, targets: ShotTarget[], env: RagdollEnv, fx: Fx, onHit: ShotHit, onStick: ShotStick) {
    let anyArrow = false;
    this.clock += dt;
    for (const s of this.shots) {
      if (!s.on) continue;
      s.t += dt;
      if (s.stuck >= 0) {
        s.stuck += dt;
        if (s.stuck > STICK_TIME) { this.kill(s); continue; }
        // sink a little and shrink away at the end
        const k = Math.max(0, (s.stuck - (STICK_TIME - 0.4)) / 0.4);
        _s.setScalar(1 - k);
        _m.compose(s.p, s.q, _s);
        this.mesh.setMatrixAt(s.slot, _m);
        anyArrow = true;
        continue;
      }
      if (s.t > (s.kind === 'orb' ? ORB_TIME : FLY_TIME)) {
        if (s.kind === 'orb') this.fizzle(s, fx);
        this.kill(s); continue;
      }
      const x0 = s.p.x, y0 = s.p.y, z0 = s.p.z;
      if (s.kind === 'arrow') s.v.y += GRAV * dt;
      else this.home(s, targets, dt);
      const x1 = x0 + s.v.x * dt, y1 = y0 + s.v.y * dt, z1 = z0 + s.v.z * dt;
      // targets
      let best = 2, bi = -1;
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        if (c.down) continue;
        const t = segCapsule(x0, y0, z0, x1, y1, z1, c.x, c.y, c.z, c.r, c.h, s.kind === 'orb' ? 0.12 : 0.02);
        if (t >= 0 && t < best) { best = t; bi = i; }
      }
      // world: walls and the ground along the segment (4 samples is plenty for ≤ 0.5 m)
      let wt = 2, ground = false;
      for (let k = 1; k <= 4; k++) {
        const t = k / 4, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
        if (y < env.groundAt(x, z)) { wt = t; ground = true; break; }
        if (env.blocked(x, z, y)) { wt = t; break; }
      }
      if (bi >= 0 && best <= wt) {
        const hx = x0 + (x1 - x0) * best, hy = y0 + (y1 - y0) * best, hz = z0 + (z1 - z0) * best;
        const sp = s.v.length();
        _d.copy(s.v).divideScalar(sp || 1);
        onHit(s.kind, bi, hx, hy, hz, _d.x, _d.y, _d.z, sp);
        if (s.kind === 'arrow') this.splinter(hx, hy, hz, fx);
        else this.fizzle(s, fx, hx, hy, hz, env.groundAt(hx, hz));
        this.kill(s); continue;
      }
      if (wt <= 1) {
        const t = Math.max(0, wt - 0.12), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
        s.p.set(x, ground ? Math.max(y, env.groundAt(x, z) + 0.02) : y, z);
        if (s.kind === 'arrow') {
          // embed the head: move along the flight direction so ~1/3 of the shaft is inside
          _d.copy(s.v).normalize();
          s.p.addScaledVector(_d, 0.12);
          s.stuck = 0;
          fx.dust(s.p.x, s.p.y - 0.1, s.p.z, 3, 0.7, 0.62, 0.5, 0.35, 0.4);
          onStick('arrow', s.p.x, s.p.y, s.p.z);
          _m.compose(s.p, s.q, _s.setScalar(1));
          this.mesh.setMatrixAt(s.slot, _m);
          anyArrow = true;
        } else { this.fizzle(s, fx, s.p.x, s.p.y, s.p.z, env.groundAt(s.p.x, s.p.z)); onStick('orb', s.p.x, s.p.y, s.p.z); this.kill(s); }
        continue;
      }
      s.p.set(x1, y1, z1);
      if (s.kind === 'arrow') {
        s.q.setFromUnitVectors(FWD, _d.copy(s.v).normalize());
        _m.compose(s.p, s.q, _s.setScalar(1));
        this.mesh.setMatrixAt(s.slot, _m);
        anyArrow = true;
        // a soft white-pink streak behind the arrow (ribbon for the newest arrow) and a few glints
        if (s === this.spiralOrb) this.spiral.push(x1, y1 - 0.025, z1, x1, y1 + 0.025, z1, this.clock);
        fx.emit(SH_GLOW, x0, y0, z0, 0, 0, 0, 0.3, 0.09, 0.02, 1, 0.86, 0.92, 0.6, 0, 0, true);
      } else {
        // comet: a big halo, a hot white core with a pulse, two sparkle strands spiralling round the path, a pool of
        // light on the ground under it
        const c = s.color, pulse = 1 + 0.12 * Math.sin(s.t * 40);
        fx.emit(SH_GLOW, x1, y1, z1, 0, 0, 0, 0, 0.75 * pulse, 0.75 * pulse, c.r, c.g, c.b, 1, 0, 0, true);
        fx.emit(SH_GLOW, x1, y1, z1, 0, 0, 0, 0, 0.36, 0.36, 1, 1, 1, 1, 0, 0, true);
        _d.copy(s.v).normalize();
        _p.set(-_d.z, 0, _d.x); if (_p.lengthSq() < 1e-4) _p.set(1, 0, 0); _p.normalize();
        _s.crossVectors(_d, _p);
        for (let k = 0; k < 2; k++) {
          const a = s.t * 22 + k * Math.PI, ca = Math.cos(a) * 0.17, sa = Math.sin(a) * 0.17;
          fx.emit(SH_GLOW, x1 + _p.x * ca + _s.x * sa, y1 + _p.y * ca + _s.y * sa, z1 + _p.z * ca + _s.z * sa, 0, 0, 0, 0.4, 0.13, 0.02, k ? 1 : c.r, k ? 1 : c.g, k ? 1 : c.b, 1, 0, 0, true);
        }
        if (s === this.spiralOrb) {
          // the ribbon: a band from 0.07 to 0.24 m off the path, turning with the sparkles
          const a = s.t * 22, ca = Math.cos(a), sa = Math.sin(a);
          const ox = _p.x * ca + _s.x * sa, oy = _p.y * ca + _s.y * sa, oz = _p.z * ca + _s.z * sa;
          this.spiral.push(x1 + ox * 0.07, y1 + oy * 0.07, z1 + oz * 0.07, x1 + ox * 0.24, y1 + oy * 0.24, z1 + oz * 0.24, this.clock);
        }
        fx.emit(SH_GLOW, x0, y0, z0, (fx.rnd() - 0.5) * 0.6, (fx.rnd() - 0.5) * 0.6, (fx.rnd() - 0.5) * 0.6, 0.35, 0.14, 0.02, c.r, c.g, c.b, 1, 0, 1, true);
        const g = env.groundAt(x1, z1), h = y1 - g;
        if (h < 3) fx.ring(x1, g, z1, 0, 0.75 + h * 0.2, -1, c, 0.6 * (1 - h / 3), 1, 1);
      }
    }
    this.mesh.visible = anyArrow;
    if (anyArrow) this.mesh.instanceMatrix.needsUpdate = true;
    this.spiral.update(this.clock);
  }

  /** Orbs curve gently towards the nearest standing cat ahead (± 25°). */
  private home(s: Shot, targets: ShotTarget[], dt: number) {
    const sp = s.v.length();
    _d.copy(s.v).divideScalar(sp || 1);
    let best = 0.9, bx = 0, by = 0, bz = 0;
    for (const c of targets) {
      if (c.down) continue;
      _p.set(c.x - s.p.x, c.y + c.h * 0.5 - s.p.y, c.z - s.p.z);
      const d = _p.length(); if (d > 18 || d < 0.01) continue;
      const cos = _p.dot(_d) / d;
      if (cos > best) { best = cos; bx = _p.x / d; by = _p.y / d; bz = _p.z / d; }
    }
    if (best > 0.9) {
      const k = Math.min(1, dt * 3.5);
      _d.set(_d.x + (bx - _d.x) * k, _d.y + (by - _d.y) * k, _d.z + (bz - _d.z) * k).normalize();
      s.v.copy(_d).multiplyScalar(sp);
    }
  }

  /** Arrow hits a cat: a puff of pink fletching feathers that flutter down slowly. */
  private splinter(x: number, y: number, z: number, fx: Fx) {
    for (let i = 0; i < 12; i++) {
      const a = fx.rnd() * Math.PI * 2, sp = 0.8 + fx.rnd() * 1.4, w = fx.rnd();
      fx.emit(SH_FEATHER, x, y, z, Math.cos(a) * sp, 1.2 + fx.rnd() * 1.8, Math.sin(a) * sp, 1.3 + fx.rnd() * 0.8, 0.1, 0.09, 1, 0.55 + 0.35 * w, 0.68 + 0.25 * w, 1, -1.4, 3.2, false, fx.rnd() * 6, (fx.rnd() - 0.5) * 7);
    }
    fx.emit(SH_GLOW, x, y, z, 0, 0, 0, 0.14, 0.2, 0.5, 1, 0.85, 0.9, 0.8, 0, 0, true);
  }

  /** Orb bursts: a flash, a puff of sparks and twinkles, a ring of light on the ground. */
  private fizzle(s: Shot, fx: Fx, x = s.p.x, y = s.p.y, z = s.p.z, groundY = Number.NaN) {
    const c = s.color;
    fx.emit(SH_GLOW, x, y, z, 0, 0, 0, 0.3, 0.6, 1.8, c.r, c.g, c.b, 1, 0, 0, true);
    fx.emit(SH_GLOW, x, y, z, 0, 0, 0, 0.14, 0.35, 0.8, 1, 1, 1, 1, 0, 0, true);
    if (groundY === groundY) fx.ring(x, groundY, z, 0.2, 1.6, 0.5, c, 0.9, 0.3, 0.3);
    for (let i = 0; i < 6; i++) {
      const a = fx.rnd() * Math.PI * 2;
      fx.emit(SH_STAR, x, y, z, Math.cos(a) * 1.8, 1 + fx.rnd() * 1.5, Math.sin(a) * 1.8, 0.6, 0.12, 0.04, 1, 0.95, 0.85, 1, -3, 2.5, false, fx.rnd() * 6, (fx.rnd() - 0.5) * 8);
    }
    for (let i = 0; i < 18; i++) {
      const a = fx.rnd() * Math.PI * 2, e = (fx.rnd() - 0.3) * 2, sp = 2 + fx.rnd() * 3;
      fx.emit(SH_SPARK, x, y, z, Math.cos(a) * sp, e * sp * 0.5, Math.sin(a) * sp, 0.3 + fx.rnd() * 0.2, 0.1, 0.03, c.r, c.g, c.b, 1, -3, 2, true, Math.atan2(e, 1));
    }
  }

  private kill(s: Shot) { if (s === this.spiralOrb) this.spiralOrb = null; s.on = false; s.stuck = -1; this.mesh.setMatrixAt(s.slot, this.zero); this.mesh.instanceMatrix.needsUpdate = true; }

  clear() { for (const s of this.shots) if (s.on) this.kill(s); this.mesh.visible = false; this.spiral.clear(); }

  dispose() { this.geo.dispose(); this.mesh.dispose(); this.spiral.dispose(); this.root.removeFromParent(); }
}
