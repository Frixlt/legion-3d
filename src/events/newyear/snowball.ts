/**
 * «Снежки» (idea #22): during the New Year event a key (G) throws a soft snowball. CLIENT-SIDE ONLY: nothing is sent
 * to the site and nobody else sees it.
 *
 *  - only when the street gameplay is live (ctx.game.canAct(): pointer locked, no room / menu / modal / text field /
 *    photo mode) and the crosshair is NOT on a door, goods or a stone — those keep their own keys and clicks;
 *  - the ball flies a gentle arc from the paw towards the crosshair; on a wall / the ground / a bench top it bursts into
 *    a «пух» puff and leaves a small snow splat that melts after a few seconds; over the canal it just plops;
 *  - a cat that is hit gets a snow puff on its chest and a tiny knock through the combat system when «Драки» are on.
 * Draw calls: balls, splats, puff = 3 (instanced / one Points); nothing allocates per frame.
 */
import * as THREE from 'three';
import type { EventContext, EventAvatar } from '../types';
import { fromX, fromZ } from '../../world/coords';
import { groundSpec, inRanges } from '../../world/ground';
import { snowballGeometry } from './geo';
import { splatTexture } from './tex';
import { selfLit, staticMeshes, pointScale } from '../common';

export const SNOWBALL_KEY = 'KeyG';
const MAX_BALLS = 5, MAX_SPLATS = 10, PUFFS = 5, PUFF_N = 22;
const SPEED = 12.5, LOFT = 2.6, GRAV = 9.8, RADIUS = 0.085, LIFE = 3, COOLDOWN = 0.33, SPLAT_LIFE = 5.5, CAT_R = 0.42;

interface Ball { on: boolean; p: THREE.Vector3; v: THREE.Vector3; age: number }
interface Splat { on: boolean; age: number; m: THREE.Matrix4; s: number }
interface Puff { age: number; x: number; y: number; z: number; big: number }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);

export interface SnowStats { thrown: number; ground: number; wall: number; prop: number; top: number; cat: number; water: number }
export interface Snowballs { throw(): boolean; stats: SnowStats; balls: THREE.InstancedMesh; splats: THREE.InstancedMesh; puffs: THREE.Points; active(): number; dispose(): void }

/**
 * Build the snowball toy under `parent`. `ctx.game` provides the key / gating / cats; without it (dev page, tests)
 * throwing is still possible through the returned `throw()` (it then only checks the world).
 */
export function setupSnowballs(ctx: EventContext, parent: THREE.Object3D): Snowballs {
  const own: { dispose(): void }[] = [];
  const spec = groundSpec(ctx.layout);
  const water = (X: number, Z: number) => { const px = fromX(X), py = fromZ(Z); return !!spec.canal && py >= spec.canal[0] && py <= spec.canal[1] && !inRanges(px, spec.bridges); };
  const world = ctx.world;

  /* ---- meshes */
  const ballGeo = snowballGeometry(); own.push(ballGeo);
  const ballMat = selfLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 0.35); own.push(ballMat);
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, MAX_BALLS); balls.name = 'newyear:snowballs'; balls.count = 0; balls.visible = false; balls.frustumCulled = false;
  const splatTex = splatTexture(); own.push(splatTex);
  const splatGeo = new THREE.PlaneGeometry(1, 1); own.push(splatGeo);
  const splatMat = new THREE.MeshStandardMaterial({ map: splatTex, transparent: true, depthWrite: false, roughness: 1, emissive: new THREE.Color('#c8d4ff'), emissiveIntensity: 0.3,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide }); own.push(splatMat);
  const splats = new THREE.InstancedMesh(splatGeo, splatMat, MAX_SPLATS); splats.name = 'newyear:splats'; splats.count = 0; splats.visible = false; splats.frustumCulled = false; splats.renderOrder = 2;
  const pg = new THREE.BufferGeometry(), N = PUFFS * PUFF_N;
  const pPos = new Float32Array(N * 3), pA = new Float32Array(N), pS = new Float32Array(N), pDir = new Float32Array(N * 3);
  { let s = 7; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    for (let i = 0; i < N; i++) { _v.set(r(), r() * 0.7 + 0.5, r()).normalize().multiplyScalar(0.6 + 0.4 * Math.abs(r())); pDir[i * 3] = _v.x; pDir[i * 3 + 1] = _v.y; pDir[i * 3 + 2] = _v.z; pS[i] = 0.08 + 0.07 * Math.abs(r()); } }
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pg.setAttribute('aA', new THREE.BufferAttribute(pA, 1)); pg.setAttribute('aS', new THREE.BufferAttribute(pS, 1));
  pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); own.push(pg);
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, uniforms: { uScale: { value: 400 } },
    vertexShader: `attribute float aA; attribute float aS; uniform float uScale; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; vA = aA; gl_PointSize = aA > 0.0 ? aS * uScale / max(-mv.z, 0.1) : 0.0; }`,
    fragmentShader: `varying float vA; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float r = dot(q,q); if (r > 1.) discard; gl_FragColor = vec4(0.96, 0.98, 1.0, vA * (1. - r)); }`,
  }); own.push(pMat);
  const puffs = new THREE.Points(pg, pMat); puffs.name = 'newyear:puff'; puffs.frustumCulled = false; puffs.visible = false; puffs.renderOrder = 7;
  parent.add(balls, splats, puffs);

  /* ---- state pools (no allocation after setup) */
  const B: Ball[] = Array.from({ length: MAX_BALLS }, () => ({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0 }));
  const S: Splat[] = Array.from({ length: MAX_SPLATS }, () => ({ on: false, age: 0, m: new THREE.Matrix4(), s: 0.3 }));
  const P: Puff[] = Array.from({ length: PUFFS }, () => ({ age: 9, x: 0, y: 0, z: 0, big: 1 }));
  let nextSplat = 0, nextPuff = 0, cool = 0, alive = 0;
  const stats: SnowStats = { thrown: 0, ground: 0, wall: 0, prop: 0, top: 0, cat: 0, water: 0 };
  const statics = staticMeshes(ctx);
  const ray = new THREE.Raycaster();

  const puff = (x: number, y: number, z: number, big = 1) => { const p = P[nextPuff]; nextPuff = (nextPuff + 1) % PUFFS; p.age = 0; p.x = x; p.y = y; p.z = z; p.big = big; puffs.visible = true; };
  const splat = (x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number) => {
    const s = S[nextSplat]; nextSplat = (nextSplat + 1) % MAX_SPLATS;
    _n.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(_z, _n);
    _m.makeRotationAxis(_n, (x * 13.1 + z * 7.7) % 6.28);   // spin round the normal for variety
    s.m.makeRotationFromQuaternion(_q).premultiply(_m);
    s.m.setPosition(x + _n.x * 0.012, y + _n.y * 0.012, z + _n.z * 0.012);
    s.on = true; s.age = 0; s.s = size;
  };

  const solidTop = (X: number, Z: number) => (world.solidTop ? world.solidTop(fromX(X), fromZ(Z)) : -Infinity);
  const groundAt = (X: number, Z: number) => ctx.groundAt(X, Z);

  /** Resolve an impact between the last free point a and the blocked point b (both world m). */
  const impactWall = (a: THREE.Vector3, b: THREE.Vector3) => {
    _v.subVectors(b, a); const len = _v.length() + 1.2; _v.normalize();
    ray.set(a, _v); ray.far = len;
    const hit = statics.length ? ray.intersectObjects(statics, false)[0] : undefined;
    if (hit && hit.face) {
      stats.wall++;
      _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (_n.dot(_v) > 0) _n.negate();
      puff(hit.point.x + _n.x * 0.1, hit.point.y + _n.y * 0.1, hit.point.z + _n.z * 0.1);
      if (!/glass|emit|glow|sign/.test(hit.object.name)) splat(hit.point.x, hit.point.y, hit.point.z, _n.x, _n.y, _n.z, 0.46);
      return;
    }
    stats.prop++;
    // no mesh found (a prop / lamp solid): bisect to the solid boundary, face back along the flight
    const lo = _v2.copy(a); let hiX = b.x, hiZ = b.z;
    for (let k = 0; k < 7; k++) {
      const mx = (lo.x + hiX) / 2, mz = (lo.z + hiZ) / 2, s = solidTop(mx, mz);
      if (s === Infinity || s > a.y) { hiX = mx; hiZ = mz; } else { lo.x = mx; lo.z = mz; }
    }
    puff(lo.x, a.y, lo.z);
  };

  // cat test: one persistent visitor (no closure per frame)
  let hp: THREE.Vector3 = _v, hv: THREE.Vector3 = _v, hit = false;
  const catFn = (id: string, av: EventAvatar) => {
    if (hit || !av.root.visible) return;
    const r = av.root.position, h = av.headTop || 1.2;
    const cy = r.y + h * 0.55, dy = hp.y - cy, dx = hp.x - r.x, dz = hp.z - r.z;
    if (Math.abs(dy) > h * 0.55 + RADIUS || dx * dx + dz * dz > CAT_R * CAT_R) return;
    hit = true; stats.cat++;
    puff(hp.x, hp.y, hp.z, 1.6);
    const l = Math.hypot(hv.x, hv.z) || 1;
    ctx.game?.knock?.(id, av, (hv.x / l) * 1.6, 1.4, (hv.z / l) * 1.6, hp.x, hp.y, hp.z);
  };
  const hitCat = (p: THREE.Vector3, v: THREE.Vector3): boolean => {
    if (!ctx.game) return false;
    hp = p; hv = v; hit = false;
    ctx.game.forEachCat(catFn);
    return hit;
  };

  const doThrow = (): boolean => {
    if (cool > 0) return true;                               // swallow the key during the cooldown (no double throws)
    const b = B.find((x) => !x.on); if (!b) return true;
    const cam = ctx.camera, me = ctx.game?.me();
    cam.getWorldDirection(_v);
    if (me && me.visible) b.p.copy(me.av.root.position).addScaledVector(_up, Math.min(1.1, (me.av.headTop || 1.3) * 0.75)).addScaledVector(_v, 0.35);
    else b.p.copy(cam.position).addScaledVector(_v, 0.45).addScaledVector(_up, -0.18);
    // aim at what the crosshair looks at 18 m away
    _v2.copy(cam.position).addScaledVector(_v, 18).sub(b.p).normalize();
    b.v.copy(_v2).multiplyScalar(SPEED).addScaledVector(_up, LOFT);
    b.on = true; b.age = 0; cool = COOLDOWN; alive++; stats.thrown++;
    ctx.game?.swing?.();
    return true;
  };

  const prev = new THREE.Vector3();
  const update = (dt: number) => {
    if (cool > 0) cool -= dt;
    let nb = 0;
    if (alive) for (const b of B) {
      if (!b.on) continue;
      b.age += dt;
      // sub-steps of ≤ 0.12 m so a fast ball never tunnels through a thin wall or a cat
      const steps = Math.max(1, Math.ceil((b.v.length() * dt) / 0.12)), h = dt / steps;
      let end = b.age > LIFE;
      for (let k = 0; k < steps && !end; k++) {
        prev.copy(b.p);
        b.v.y -= GRAV * h; b.p.addScaledVector(b.v, h);
        if (hitCat(b.p, b.v)) { end = true; break; }
        const g = groundAt(b.p.x, b.p.z), s = solidTop(b.p.x, b.p.z), wet = water(b.p.x, b.p.z);
        if (b.p.y - RADIUS <= g) {
          if (wet) { stats.water++; puff(b.p.x, g + 0.05, b.p.z, 0.7); }
          else { stats.ground++; puff(b.p.x, g + 0.08, b.p.z); splat(b.p.x, g, b.p.z, 0, 1, 0, 0.5); }
          end = true;
        } else if (!wet && s !== -Infinity && (s === Infinity ? b.p.y < g + 7 : b.p.y - RADIUS <= s)) {
          if (s !== Infinity && prev.y - RADIUS >= s - 0.02) { stats.top++; puff(b.p.x, s + 0.08, b.p.z); splat(b.p.x, s, b.p.z, 0, 1, 0, 0.36); }
          else impactWall(prev, b.p);
          end = true;
        }
      }
      if (end) { b.on = false; alive--; continue; }
      _s.setScalar(RADIUS); _q.identity(); _m.compose(b.p, _q, _s); balls.setMatrixAt(nb++, _m);
    }
    balls.count = nb; balls.visible = nb > 0; if (nb) balls.instanceMatrix.needsUpdate = true;
    // splats: shrink (melt) over the last 1.5 s
    let ns = 0;
    for (const s of S) {
      if (!s.on) continue;
      s.age += dt; if (s.age > SPLAT_LIFE) { s.on = false; continue; }
      const k = s.s * Math.min(1, s.age * 10) * Math.min(1, (SPLAT_LIFE - s.age) / 1.5);
      _m.copy(s.m); _m.scale(_s.set(k, k, k)); splats.setMatrixAt(ns++, _m);
    }
    splats.count = ns; splats.visible = ns > 0; if (ns) splats.instanceMatrix.needsUpdate = true;
    // puffs: particles burst out, slow down and fade in 0.7 s
    let any = false;
    for (let p = 0; p < PUFFS; p++) {
      const f = P[p]; if (f.age > 0.7) { if (f.age < 9) { f.age = 9; for (let i = 0; i < PUFF_N; i++) pA[p * PUFF_N + i] = 0; } continue; }
      f.age += dt; any = true;
      const t = Math.min(f.age, 0.7), d = (1 - Math.exp(-t * 6)) * 0.42 * f.big, fall = t * t * 0.5;
      for (let i = 0; i < PUFF_N; i++) {
        const j = p * PUFF_N + i;
        pPos[j * 3] = f.x + pDir[j * 3] * d; pPos[j * 3 + 1] = f.y + pDir[j * 3 + 1] * d - fall; pPos[j * 3 + 2] = f.z + pDir[j * 3 + 2] * d;
        pA[j] = Math.max(0, 1 - t / 0.7) * 0.95;
      }
    }
    if (any || puffs.visible) {
      (pg.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true; (pg.getAttribute('aA') as THREE.BufferAttribute).needsUpdate = true;
      pMat.uniforms.uScale.value = pointScale(ctx);
      puffs.visible = any;
    }
  };

  const offFrame = ctx.onFrame((dt) => update(Math.min(dt, 0.1)));
  const offKey = ctx.game ? ctx.game.key('event.snowball', SNOWBALL_KEY, 'Снежок', () => (ctx.game!.canAct() ? doThrow() : false)) : () => {};

  return {
    throw: doThrow, stats, balls, splats, puffs, active: () => alive,
    dispose() {
      offKey(); offFrame();
      balls.removeFromParent(); splats.removeFromParent(); puffs.removeFromParent();
      balls.dispose(); splats.dispose();
      for (const o of own) o.dispose();
    },
  };
}
