/**
 * Combat effects in ONE draw call: a pooled particle system (THREE.Points, custom shader) whose particles can be
 * soft glows and sparks (additive) or stars, feathers and dust puffs (normal blending) — premultiplied alpha lets
 * both live in one material. Plus two pooled shockwave rings (holy burst, summon circle), drawn only while active.
 * No allocations per frame.
 */
import * as THREE from 'three';

export const SH_GLOW = 0, SH_STAR = 1, SH_FEATHER = 2, SH_DUST = 3, SH_SPARK = 4, SH_HEART = 5, SH_RING = 6;
const N = 700;

const VERT = /* glsl */`
attribute vec4 aCol;
attribute vec3 aMisc;   // size, shape(+8 = additive), rotation
uniform float uScale;
uniform float uMax;
varying vec4 vCol;
varying float vShape;
varying float vAdd;
varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aMisc.x * uScale / max(0.05, -mv.z), 0.0, uMax);
  vCol = aCol;
  vAdd = aMisc.y >= 8.0 ? 1.0 : 0.0;
  vShape = aMisc.y - vAdd * 8.0;
  vRot = aMisc.z;
}`;
const FRAG = /* glsl */`
varying vec4 vCol;
varying float vShape;
varying float vAdd;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float a;
  vec3 col = vCol.rgb;
  if (vShape < 0.5) {            // soft glow with a hot core
    float d = length(p);
    a = smoothstep(1.0, 0.0, d); a *= a;
    col = mix(col, vec3(1.0), smoothstep(0.35, 0.0, d) * 0.6);
  } else if (vShape < 1.5) {     // five-pointed star with an ink rim
    float ang = atan(p.y, p.x), r = length(p);
    float k = cos(3.14159 / 5.0) / cos(mod(ang + 1.5708, 6.28318 / 5.0) - 3.14159 / 5.0);
    float edge = mix(0.48, 0.95, pow(k, 6.0));
    a = smoothstep(edge, edge - 0.12, r);
    col = mix(vec3(0.17, 0.11, 0.09), col, smoothstep(edge, edge - 0.2, r));
  } else if (vShape < 2.5) {     // feather / leaf: a slim ellipse with a darker rib
    vec2 q = vec2(p.x * 2.6, p.y);
    float d = length(q);
    a = smoothstep(1.0, 0.85, d);
    col *= 1.0 - 0.35 * smoothstep(0.12, 0.0, abs(p.x));
  } else if (vShape < 3.5) {     // dust puff: soft, lumpy disc
    float d = length(p) + 0.08 * sin(atan(p.y, p.x) * 5.0 + vRot * 3.0);
    a = smoothstep(1.0, 0.55, d) * 0.85;
    col *= 0.85 + 0.15 * (1.0 - d);
  } else if (vShape < 4.5) {     // spark: a bright streak along x
    vec2 q = vec2(p.x * 0.55, p.y * 3.2);
    float d = length(q);
    a = smoothstep(1.0, 0.0, d);
    col = mix(col, vec3(1.0), smoothstep(0.5, 0.0, d));
  } else if (vShape > 5.5) {     // impact ring: a thin bright circle (expands with its size)
    float d = length(p);
    a = smoothstep(1.0, 0.9, d) * smoothstep(0.62, 0.84, d);
    col = mix(col, vec3(1.0), 0.5);
  } else {                        // heart
    vec2 q = p * 1.15; q.y += 0.25;
    float x = q.x, y = q.y - sqrt(abs(x)) * 0.62;
    float d = x * x + y * y;
    a = smoothstep(0.95, 0.75, d);
    col = mix(vec3(0.17, 0.11, 0.09), col, smoothstep(0.95, 0.7, d));
  }
  a = min(1.0, a * vCol.a);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, vAdd > 0.5 ? 0.0 : a);
}`;

const RING_VERT = /* glsl */`
attribute vec3 iCol;
attribute vec3 iP;      // alpha, soft (band width), fill
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vP;
void main() {
  vUv = uv; vCol = iCol; vP = iP;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const RING_FRAG = /* glsl */`
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vP;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float band = smoothstep(1.0, 0.9, r) * smoothstep(0.62 - vP.y, 0.9, r);
  float fill = smoothstep(1.0, 0.0, r) * (0.25 * vP.y + vP.z * smoothstep(1.0, 0.2, r));
  float a = (band * (1.0 - vP.z * 0.8) + fill) * vP.x;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, 0.0);
}`;
const RINGS = 8;

export class Fx {
  readonly root = new THREE.Group();
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private col = new Float32Array(N * 4);
  private misc = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private max = new Float32Array(N);
  private s0 = new Float32Array(N);
  private s1 = new Float32Array(N);
  private grav = new Float32Array(N);
  private drag = new Float32Array(N);
  private spin = new Float32Array(N);
  private alpha0 = new Float32Array(N);
  private alive = 0;          // particles are packed [0, alive)
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private points: THREE.Points;
  /** Ground rings / light pools: ONE instanced draw call. len < 0 = drawn for one frame (re-emit to follow). */
  private rings: { on: boolean; x: number; y: number; z: number; t: number; len: number; r0: number; r1: number; a: number; soft: number; fill: number; col: THREE.Color }[] = [];
  private ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private ringMesh: THREE.InstancedMesh;
  private ringCol = new Float32Array(RINGS * 3);
  private ringP = new Float32Array(RINGS * 3);
  private _m = new THREE.Matrix4();
  private seed = 1;

  constructor() {
    this.root.name = 'combat-fx';
    const pa = new THREE.BufferAttribute(this.pos, 3), ca = new THREE.BufferAttribute(this.col, 4), ma = new THREE.BufferAttribute(this.misc, 3);
    pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage); ma.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa); this.geo.setAttribute('aCol', ca); this.geo.setAttribute('aMisc', ma);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 400 }, uMax: { value: 160 } },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 5; this.points.name = 'combat-particles';
    this.root.add(this.points);
    const g = this.ringGeo;
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.ringCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iP', new THREE.InstancedBufferAttribute(this.ringP, 3).setUsage(THREE.DynamicDrawUsage));
    const rm = new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.ringMesh = new THREE.InstancedMesh(g, rm, RINGS);
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.count = 0; this.ringMesh.visible = false; this.ringMesh.renderOrder = 4; this.ringMesh.frustumCulled = false;
    this.ringMesh.name = 'combat-rings';
    this.root.add(this.ringMesh);
    for (let i = 0; i < RINGS; i++) this.rings.push({ on: false, x: 0, y: 0, z: 0, t: 0, len: 0, r0: 0, r1: 0, a: 0, soft: 0, fill: 0, col: new THREE.Color() });
  }

  /** Largest drawn particle (px; default 160). Big effects (src/combat/boom.ts) raise it on their own Fx. */
  set maxPointPx(v: number) { this.mat.uniforms.uMax.value = v; }

  /** Deterministic cheap random 0..1. */
  rnd(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** Live particle count (tests / stats). */
  get count(): number { return this.alive; }

  /** life 0 = a one-frame particle (re-emit every frame for things that follow something). */
  emit(shape: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number,
    r: number, g: number, b: number, a = 1, grav = 0, drag = 0, additive = false, rot = 0, spin = 0) {
    let i = this.alive;
    if (i >= N) i = (this.rnd() * N) | 0;   // full: overwrite a random one
    else this.alive++;
    const o = i * 3, c = i * 4;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = a;
    this.misc[o] = size0; this.misc[o + 1] = shape + (additive ? 8 : 0); this.misc[o + 2] = rot;
    this.life[i] = life; this.max[i] = life; this.s0[i] = size0; this.s1[i] = size1;
    this.grav[i] = grav; this.drag[i] = drag; this.spin[i] = spin; this.alpha0[i] = a;
  }

  /**
   * Expanding ground ring (holy burst, summon circle, slam). `fill` > 0 adds a soft disc (a light pool). len < 0 = a
   * one-frame ring of radius r1 (call every frame to follow something, e.g. the orb's light on the ground).
   */
  ring(x: number, y: number, z: number, r0: number, r1: number, len: number, color: THREE.ColorRepresentation, a = 1, soft = 0, fill = 0) {
    let best = this.rings[0];
    for (const r of this.rings) if (!r.on) { best = r; break; } else if (r.len > 0 && (best.len < 0 || r.t / r.len > best.t / best.len)) best = r;
    best.on = true; best.t = 0; best.len = len; best.r0 = r0; best.r1 = r1; best.a = a; best.soft = soft; best.fill = fill;
    best.x = x; best.y = y + 0.03; best.z = z;
    best.col.set(color);
  }

  /** Live rings (tests / stats). */
  get ringCount(): number { let n = 0; for (const r of this.rings) if (r.on) n++; return n; }

  update(dt: number, camera: THREE.PerspectiveCamera, viewHeightPx: number) {
    this.mat.uniforms.uScale.value = viewHeightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    let n = this.alive;
    for (let i = 0; i < n; i++) {
      if (this.max[i] <= 0) {
        // one-frame particle (life 0 at emit): drawn by the next render whatever the frame rate, gone after
        if (this.max[i] < 0) { n--; if (i !== n) this.move(n, i); i--; continue; }
        this.max[i] = -1; this.col[i * 4 + 3] = Math.min(1, this.alpha0[i]);
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {   // swap-remove with the last live particle
        n--;
        if (i !== n) this.move(n, i);
        i--;
        continue;
      }
      const o = i * 3, k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[o] *= k; this.vel[o + 1] = this.vel[o + 1] * k + this.grav[i] * dt; this.vel[o + 2] *= k;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      this.misc[o] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.misc[o + 2] += this.spin[i] * dt;
      // fade in fast, out over the last 40 %
      this.col[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 30, (1 - t) / 0.4);
    }
    this.alive = n;
    this.geo.setDrawRange(0, n);
    if (n > 0) {
      const g = this.geo.attributes;
      (g.position as THREE.BufferAttribute).needsUpdate = true; (g.aCol as THREE.BufferAttribute).needsUpdate = true; (g.aMisc as THREE.BufferAttribute).needsUpdate = true;
      (g.position as THREE.BufferAttribute).clearUpdateRanges?.(); (g.position as THREE.BufferAttribute).addUpdateRange?.(0, n * 3);
      (g.aCol as THREE.BufferAttribute).clearUpdateRanges?.(); (g.aCol as THREE.BufferAttribute).addUpdateRange?.(0, n * 4);
      (g.aMisc as THREE.BufferAttribute).clearUpdateRanges?.(); (g.aMisc as THREE.BufferAttribute).addUpdateRange?.(0, n * 3);
    }
    this.points.visible = n > 0;
    let k = 0;
    for (const r of this.rings) {
      if (!r.on) continue;
      let sc: number, al: number;
      if (r.len < 0) {
        // one-frame: drawn by the next render, freed on the update after it
        if (r.t > 0) { r.on = false; continue; }
        r.t = 1; sc = r.r1; al = r.a;
      } else {
        r.t += dt;
        const q = r.t / r.len;
        if (q >= 1) { r.on = false; continue; }
        const e = 1 - (1 - q) * (1 - q) * (1 - q);
        sc = r.r0 + (r.r1 - r.r0) * e; al = r.a * (1 - q) * Math.min(1, q * 30);
      }
      this._m.makeScale(sc, 1, sc).setPosition(r.x, r.y, r.z);
      this.ringMesh.setMatrixAt(k, this._m);
      this.ringCol[k * 3] = r.col.r; this.ringCol[k * 3 + 1] = r.col.g; this.ringCol[k * 3 + 2] = r.col.b;
      this.ringP[k * 3] = al; this.ringP[k * 3 + 1] = r.soft; this.ringP[k * 3 + 2] = r.fill;
      k++;
    }
    this.ringMesh.count = k;
    this.ringMesh.visible = k > 0;
    if (k > 0) {
      this.ringMesh.instanceMatrix.needsUpdate = true;
      (this.ringGeo.attributes.iCol as THREE.BufferAttribute).needsUpdate = true;
      (this.ringGeo.attributes.iP as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private move(from: number, to: number) {
    const a = from * 3, b = to * 3;
    for (let k = 0; k < 3; k++) { this.pos[b + k] = this.pos[a + k]; this.vel[b + k] = this.vel[a + k]; this.misc[b + k] = this.misc[a + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from]; this.max[to] = this.max[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.spin[to] = this.spin[from]; this.alpha0[to] = this.alpha0[from];
  }

  clear() { this.alive = 0; this.geo.setDrawRange(0, 0); for (const r of this.rings) r.on = false; this.ringMesh.count = 0; this.ringMesh.visible = false; }

  dispose() {
    this.geo.dispose(); this.mat.dispose(); this.ringGeo.dispose();
    (this.ringMesh.material as THREE.Material).dispose(); this.ringMesh.dispose();
    this.root.removeFromParent();
  }

  /* ---------------------------------------------------------------- presets */

  /** Impact: white-gold flash, sparks along the strike, a ring of cartoon stars and a few feathers/fur tufts. */
  impact(x: number, y: number, z: number, dx: number, dz: number, fur: THREE.Color, holy = false) {
    const R = this.rnd.bind(this);
    this.emit(SH_GLOW, x, y, z, 0, 0, 0, 0.12, 0.25, 0.55, 1, holy ? 0.95 : 0.92, holy ? 0.7 : 0.75, 0.7, 0, 0, true);
    // a cartoon "POW": one big star that pops and shrinks at the point of contact, and a fast impact ring
    this.emit(SH_STAR, x, y, z, 0, 0.3, 0, 0.2, 0.55, 0.15, 1, 0.97, 0.75, 1, 0, 0, false, R() * 6, 9);
    this.emit(SH_RING, x, y, z, 0, 0, 0, 0.16, 0.15, 0.9, 1, 0.95, 0.8, 1, 0, 0, true);
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, sp = 3 + R() * 4;
      const vx = dx * sp * 0.7 + Math.cos(a) * sp * 0.6, vz = dz * sp * 0.7 + Math.sin(a) * sp * 0.6, vy = 1 + R() * 3;
      this.emit(SH_SPARK, x, y, z, vx, vy, vz, 0.18 + R() * 0.14, 0.12, 0.04, 1, 0.85, 0.45, 1, -6, 3, true, Math.atan2(vy, Math.hypot(vx, vz)));
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + R() * 0.4;
      this.emit(SH_STAR, x, y + 0.1, z, Math.cos(a) * 1.6, 1.5 + R() * 1.2, Math.sin(a) * 1.6, 0.7 + R() * 0.25, 0.14, 0.07, 1, 0.86, 0.3, 1, -4, 2.5, false, R() * 6, (R() - 0.5) * 8);
    }
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2;
      this.emit(SH_FEATHER, x, y, z, Math.cos(a) * 1.2 + dx, 1 + R() * 1.5, Math.sin(a) * 1.2 + dz, 1.1 + R() * 0.6, 0.09, 0.08, fur.r, fur.g, fur.b, 1, -1.2, 2.2, false, R() * 6, (R() - 0.5) * 5);
    }
    if (holy) this.holySparkles(x, y, z, 8);
  }

  holySparkles(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, r = this.rnd() * 0.5;
      this.emit(SH_GLOW, x + Math.cos(a) * r, y + this.rnd() * 0.4, z + Math.sin(a) * r, 0, 0.6 + this.rnd(), 0, 0.8 + this.rnd() * 0.5, 0.09, 0.02, 1, 0.92, 0.55, 1, 0, 1, true);
    }
  }

  /** Puff of dust on the ground (landing, rising zombies, crumbling). */
  dust(x: number, y: number, z: number, n: number, r: number, g: number, b: number, spread = 0.5, up = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, s = (0.4 + this.rnd()) * spread;
      this.emit(SH_DUST, x + Math.cos(a) * 0.1, y + 0.05, z + Math.sin(a) * 0.1, Math.cos(a) * s, up * (0.3 + this.rnd()), Math.sin(a) * s, 0.6 + this.rnd() * 0.5, 0.16, 0.42, r, g, b, 0.75, -0.3, 2.5, false, this.rnd() * 6, (this.rnd() - 0.5) * 2);
    }
  }
}
