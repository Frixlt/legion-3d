/**
 * Swing trail ("swoosh"): a ribbon swept by the striking edge of the weapon (base → tip), additive, every sample
 * fading out over LIFE seconds. One mesh, one draw call, drawn only while something is left. The raw samples (one
 * per frame) are refined with Catmull-Rom points, so even a 4-frame strike draws a round crescent, not a fan.
 * Samples are in world space; `fp(on)` puts it above the first-person view-model (no depth test).
 */
import * as THREE from 'three';

export const TRAIL_LIFE = 0.15;
const N = 64;            // sample pairs
const SUB = 5;           // refined points between two raw samples

const VERT = /* glsl */`
attribute float aT;
attribute float aS;
attribute vec3 aTip;
uniform float uNow;
uniform float uLife;
varying float vA;
varying float vS;
void main() {
  vA = clamp(1.0 - (uNow - aT) / uLife, 0.0, 1.0);
  vS = aS;
  // a crescent, not a fan: the inner edge starts a third of the way out and closes in on the tip with age
  vec3 p = aS > 0.5 ? position : mix(position, aTip, 0.12 + 0.84 * (1.0 - vA));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uA;
varying float vA;
varying float vS;
void main() {
  // bright along the tip edge, fading towards the hilt; the oldest part thins out first
  float edge = smoothstep(0.0, 1.0, vS);
  float a = (0.04 + 0.96 * edge * edge * edge) * uA * (0.3 + 0.7 * vA) * smoothstep(0.0, 0.3, vA);
  vec3 c = mix(uCol * 0.85, vec3(1.0), smoothstep(0.8, 1.0, vS) * vA);
  if (a < 0.003) discard;
  gl_FragColor = vec4(c * a, 0.0);
}`;

const _c = new Float32Array(4);
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _u0 = new THREE.Vector3(), _u1 = new THREE.Vector3();
/** Point between p0 and p1 swung round the pivot (slerp of the directions, lerp of the distances). */
function arc(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Vector3, u: number, out: THREE.Vector3) {
  _u0.set(x0 - c.x, y0 - c.y, z0 - c.z); _u1.set(x1 - c.x, y1 - c.y, z1 - c.z);
  const l0 = _u0.length(), l1 = _u1.length();
  if (l0 < 1e-4 || l1 < 1e-4) { out.set(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u); return; }
  _u0.divideScalar(l0); _u1.divideScalar(l1);
  const d = Math.max(-1, Math.min(1, _u0.dot(_u1))), om = Math.acos(d);
  if (om < 1e-3) out.copy(_u0); else {
    const so = Math.sin(om), k0 = Math.sin((1 - u) * om) / so, k1 = Math.sin(u * om) / so;
    out.set(_u0.x * k0 + _u1.x * k1, _u0.y * k0 + _u1.y * k1, _u0.z * k0 + _u1.z * k1);
  }
  out.multiplyScalar(l0 + (l1 - l0) * u).add(c);
}
/** Catmull-Rom component k at the weights in _c (p3 extrapolated from the new sample v). */
function cr(p0: Float32Array, p1: Float32Array, k: number, v: number): number {
  return _c[0] * p0[k] + _c[1] * p1[k] + _c[2] * v + _c[3] * (2 * v - p1[k]);
}

export class SwingTrail {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(N * 2 * 3);
  private tt = new Float32Array(N * 2);
  private tip = new Float32Array(N * 2 * 3);
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private n = 0;
  /** Last two raw samples: base xyz, tip xyz, time. */
  private r0 = new Float32Array(7); private r1 = new Float32Array(7);
  private raw = 0;
  private last = -1e9;
  private life: number;

  constructor(life = TRAIL_LIFE) {
    this.life = life;
    const side = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { side[i * 2] = 0; side[i * 2 + 1] = 1; }
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const pa = new THREE.BufferAttribute(this.pos, 3), ta = new THREE.BufferAttribute(this.tt, 1), pb = new THREE.BufferAttribute(this.tip, 3);
    pa.setUsage(THREE.DynamicDrawUsage); ta.setUsage(THREE.DynamicDrawUsage); pb.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aTip', pb);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('aT', ta);
    this.geo.setAttribute('aS', new THREE.BufferAttribute(side, 1));
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uNow: { value: 0 }, uLife: { value: life }, uCol: { value: new THREE.Color('#dff3ff') }, uA: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 6; this.mesh.name = 'combat-trail';
  }

  /** Live samples (tests). */
  get count(): number { return this.n; }

  /** Start a new stroke (forgets the previous one's tangents; old samples keep fading). */
  begin(color: THREE.ColorRepresentation, alpha = 1) {
    (this.mat.uniforms.uCol.value as THREE.Color).set(color);
    this.mat.uniforms.uA.value = alpha;
    this.raw = 0;
    this.n = 0;
  }

  /**
   * Never depth-tested: in first person it is drawn over the view-model; in third person the swoosh sweeps in front of
   * a hero seen from behind, so it is drawn over the body (a smear around it) — it only lives 150 ms.
   */
  fp(on: boolean) {
    this.mat.depthTest = false;
    this.mesh.renderOrder = on ? 1002 : 7;
  }

  /**
   * Add the edge position at time t (world metres). With a pivot (the shoulder), the points between this sample and
   * the previous one are swung round it (directions slerped, distances lerped): a true arc even from 3 samples.
   */
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, pivot?: THREE.Vector3) {
    if (this.raw >= 1 && pivot) {
      const p1 = this.r1;
      for (let s = 1; s <= SUB; s++) {
        const u = s / (SUB + 1);
        arc(p1[0], p1[1], p1[2], ax, ay, az, pivot, u, _pa);
        arc(p1[3], p1[4], p1[5], bx, by, bz, pivot, u, _pb);
        this.add(_pa.x, _pa.y, _pa.z, _pb.x, _pb.y, _pb.z, p1[6] + (t - p1[6]) * u);
      }
    } else if (this.raw >= 2) {
      // Catmull-Rom between r1 and the new sample (r0 before it; the end tangent extrapolated)
      const p0 = this.r0, p1 = this.r1;
      for (let s = 1; s <= SUB; s++) {
        const u = s / (SUB + 1), u2 = u * u, u3 = u2 * u;
        const c0 = -0.5 * u3 + u2 - 0.5 * u, c1 = 1.5 * u3 - 2.5 * u2 + 1, c2 = -1.5 * u3 + 2 * u2 + 0.5 * u, c3 = 0.5 * u3 - 0.5 * u2;
        _c[0] = c0; _c[1] = c1; _c[2] = c2; _c[3] = c3;
        this.add(cr(p0, p1, 0, ax), cr(p0, p1, 1, ay), cr(p0, p1, 2, az), cr(p0, p1, 3, bx), cr(p0, p1, 4, by), cr(p0, p1, 5, bz), p1[6] + (t - p1[6]) * u);
      }
    } else if (this.raw === 1) {
      const p1 = this.r1;
      for (let s = 1; s <= SUB; s++) {
        const u = s / (SUB + 1);
        this.add(p1[0] + (ax - p1[0]) * u, p1[1] + (ay - p1[1]) * u, p1[2] + (az - p1[2]) * u, p1[3] + (bx - p1[3]) * u, p1[4] + (by - p1[4]) * u, p1[5] + (bz - p1[5]) * u, p1[6] + (t - p1[6]) * u);
      }
    }
    this.add(ax, ay, az, bx, by, bz, t);
    this.r0.set(this.r1);
    const r = this.r1; r[0] = ax; r[1] = ay; r[2] = az; r[3] = bx; r[4] = by; r[5] = bz; r[6] = t;
    this.raw++;
    this.last = t;
  }

  private add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number) {
    // newest at the end; when full, drop the oldest pair
    if (this.n >= N) { this.pos.copyWithin(0, 6); this.tip.copyWithin(0, 6); this.tt.copyWithin(0, 2); this.n = N - 1; }
    const o = this.n * 6;
    this.pos[o] = ax; this.pos[o + 1] = ay; this.pos[o + 2] = az;
    this.pos[o + 3] = bx; this.pos[o + 4] = by; this.pos[o + 5] = bz;
    this.tip[o] = bx; this.tip[o + 1] = by; this.tip[o + 2] = bz;
    this.tip[o + 3] = bx; this.tip[o + 4] = by; this.tip[o + 5] = bz;
    this.tt[this.n * 2] = t; this.tt[this.n * 2 + 1] = t;
    this.n++;
  }

  update(now: number) {
    this.mat.uniforms.uNow.value = now;
    const on = this.n >= 2 && now - this.last < this.life;
    this.mesh.visible = on;
    if (!on) return;
    this.geo.setDrawRange(0, (this.n - 1) * 6);
    const pa = this.geo.attributes.position as THREE.BufferAttribute, ta = this.geo.attributes.aT as THREE.BufferAttribute;
    const pb = this.geo.attributes.aTip as THREE.BufferAttribute;
    pa.needsUpdate = true; ta.needsUpdate = true; pb.needsUpdate = true;
    pa.clearUpdateRanges?.(); pa.addUpdateRange?.(0, this.n * 6);
    pb.clearUpdateRanges?.(); pb.addUpdateRange?.(0, this.n * 6);
    ta.clearUpdateRanges?.(); ta.addUpdateRange?.(0, this.n * 2);
  }

  /** Depth-tested (world effects like the orb's spiral) or drawn on top (the swing smear, default). */
  depth(on: boolean) { this.mat.depthTest = on; this.mesh.renderOrder = on ? 5 : 7; }

  clear() { this.n = 0; this.raw = 0; this.mesh.visible = false; }
  dispose() { this.geo.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}
