/**
 * Geometry toolkit for procedural characters: a body surface generator (profile × superellipse cross-section)
 * and a tiny "vertex-coloured parts" builder whose output is merged into one geometry per draw call.
 * Everything here runs at build time only (never per frame).
 */
import * as THREE from 'three';

export const K = 0.0113;   // metres per site SVG unit (doodle viewBox is 120×170; body ≈ 92 units ≈ 1.04 m)
export const INK = '#2b1d18';

/* ------------------------------------------------------------------ body dims per shape */

export interface BodyDims {
  shape: string;
  y0: number;          // bottom of the body (m)
  H: number;           // body height (m)
  w: number;           // widest radius (m)
  depth: number;       // z radius / x radius
  n: number;           // cross-section superellipse exponent (2 = round)
  top: number;         // y of the top
  eyeY: number; mouthY: number; armY: number;
  ex: number;          // half distance between eyes along the surface (m)
  narrow: boolean;
  ghost: boolean;
  profile(t: number): number;   // radius fraction 0..1 along height t∈[0,1]
}

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dome = (t: number, c: number, e = 2) => { const s = (t - c) / (1 - c); return Math.pow(Math.max(0, 1 - Math.pow(s, e)), 1 / e); };
const roundBottom = (t: number, h = 0.11) => { const u = Math.min(1, t / h); return Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))); };

export function bodyDims(shape: string, w01: number, ghostShape = false): BodyDims {
  const s = ['bean', 'box', 'ball', 'tall', 'ghost', 'cone', 'egg'].includes(shape) ? shape : 'bean';
  let H = 92 * K, w = (25 + 9 * w01) * K, eyeOff = 24 * K, armOff = 36 * K, n = 2, depth = 0.9, y0 = 0.07;
  let profile: (t: number) => number;
  switch (s) {
    case 'box':
      H = (88 - 10 * w01) * K; w = (24 + 9 * w01) * K * 0.95; eyeOff = 26 * K; armOff = 34 * K; n = 4.2; depth = 0.85;
      profile = (t) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 7)), 1 / 7);
      break;
    case 'ball':
      H = 72 * K; w = (33 + 6 * w01) * K; eyeOff = 24 * K; armOff = 30 * K; depth = 0.93;
      profile = (t) => (t > 0.36 ? dome(t, 0.36) : 0.84 + 0.16 * Math.sin((t / 0.36) * Math.PI / 2)) * roundBottom(t, 0.13);
      break;
    case 'tall':
      H = 110 * K; w = (19 + 4 * w01) * K; eyeOff = 24 * K; armOff = 38 * K;
      profile = (t) => (t > 0.7 ? dome(t, 0.7) : 1 + 0.03 * Math.sin((t / 0.7) * Math.PI)) * roundBottom(t, 0.08);
      break;
    case 'ghost':
      H = 90 * K; w = (25 + 6 * w01) * K; eyeOff = 24 * K; armOff = 36 * K; y0 = 0.12;
      profile = (t) => (t > 0.45 ? dome(t, 0.45) : 1 + 0.02 * Math.sin((t / 0.45) * Math.PI)) * roundBottom(t, 0.06);
      break;
    case 'cone':
      H = 94 * K; w = (28 + 6 * w01) * K; eyeOff = 28 * K; armOff = 44 * K;
      profile = (t) => (t > 0.74 ? 0.52 * dome(t, 0.74) : 1 - 0.48 * sstep(0.1, 0.74, t)) * roundBottom(t, 0.09);
      break;
    case 'egg': {
      H = 100 * K; w = (27 + 5 * w01) * K; eyeOff = 28 * K; armOff = 46 * K; y0 = 0.07;
      profile = (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.62);
      break;
    }
    default:
      w *= 0.95;
      profile = (t) => (t > 0.44 ? dome(t, 0.44, 2.2) : 1 + 0.035 * Math.sin((t / 0.44) * Math.PI)) * roundBottom(t);
  }
  // chibi: squatter and top-heavy (the blob IS the head) — widen the face zone, slim the base a little
  H *= 0.94; w *= 1.06; eyeOff *= 0.97; armOff *= 1.04;
  const base = profile;
  const bulge = s === 'box' ? 0.04 : s === 'cone' ? 0.02 : 0.08;
  profile = (t) => base(t) * (1 + bulge * Math.exp(-((t - 0.66) * (t - 0.66)) / 0.05) - bulge * 0.9 * (1 - sstep(0.05, 0.5, t)));
  const top = y0 + H, narrow = s === 'tall' || s === 'cone';
  return {
    shape: s, y0, H, w, depth, n, top, eyeY: top - eyeOff, mouthY: top - eyeOff - 14 * K, armY: top - armOff,
    ex: (narrow ? 8 : 10) * K, narrow, ghost: ghostShape || s === 'ghost', profile,
  };
}

/** Radius (x) of the body at height y. */
export const radiusAt = (d: BodyDims, y: number) => d.w * d.profile(Math.min(1, Math.max(0, (y - d.y0) / d.H)));

/** Point on the superellipse cross-section: angle 0 = front (−Z), +θ towards +X (character's left from the viewer… its right side is −X). */
export function sectionXZ(d: BodyDims, r: number, theta: number, out: { x: number; z: number }) {
  const s = Math.sin(theta), c = Math.cos(theta), e = 2 / d.n;
  out.x = r * Math.sign(s) * Math.pow(Math.abs(s), e);
  out.z = -r * d.depth * Math.sign(c) * Math.pow(Math.abs(c), e);
  return out;
}

export type ColorFn = (theta: number, y: number, t: number, out: THREE.Color) => void;

/**
 * A grid over the body surface: θ∈[thA,thB] (segs), height y∈[yA,yB] (rings), radius scaled by `scale(y)` and offset `off`.
 * Closed full rings when thB - thA ≈ 2π. Returns an indexed geometry with position/normal/color.
 */
export function bodyShell(d: BodyDims, o: {
  yA: number; yB: number; thA?: number; thB?: number; segs?: number; rings?: number;
  scale?: (y: number, theta: number) => number; off?: number; color: ColorFn; yWarp?: (theta: number, y: number, t: number) => number;
  capTop?: boolean;
}): THREE.BufferGeometry {
  const thA = o.thA ?? -Math.PI, thB = o.thB ?? Math.PI, segs = dq(o.segs ?? 40, 8), rings = dq(o.rings ?? 24, 3);
  const full = Math.abs(thB - thA - Math.PI * 2) < 1e-4;
  const cols = full ? segs : segs + 1;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const p = { x: 0, z: 0 }, c = new THREE.Color();
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, y0 = o.yA + (o.yB - o.yA) * t;
    for (let i = 0; i < cols; i++) {
      const th = thA + (thB - thA) * (i / segs);
      const y = o.yWarp ? o.yWarp(th, y0, t) : y0;
      const r = radiusAt(d, y0) * (o.scale ? o.scale(y0, th) : 1) + (o.off ?? 0);
      sectionXZ(d, r, th, p);
      pos.push(p.x, y, p.z);
      o.color(th, y0, t, c); col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * cols + i, b = j * cols + ((i + 1) % cols), cc = (j + 1) * cols + i, dd = (j + 1) * cols + ((i + 1) % cols);
    // winding: outward normals (θ grows towards +X from −Z → counter-clockwise seen from above)
    idx.push(a, cc, b, b, cc, dd);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ parts builder */

const tmpC = new THREE.Color();
/** Linear-space colour from a CSS string (cached). */
const colCache = new Map<string, THREE.Color>();
export function col(css: string): THREE.Color {
  let c = colCache.get(css);
  if (!c) { c = new THREE.Color(css); colCache.set(css, c); }
  return c;
}

/** Strip a geometry to position/normal/color (indexed), painting it with a flat colour if it has none. */
export function prep(g: THREE.BufferGeometry, color?: string | THREE.Color, m?: THREE.Matrix4): THREE.BufferGeometry {
  let geo = g;
  if (!geo.index) { const n = geo.attributes.position.count; geo.setIndex(Array.from({ length: n }, (_, i) => i)); }
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (color !== undefined || !geo.attributes.color) {
    const c = color === undefined ? tmpC.set('#ffffff') : typeof color === 'string' ? col(color) : color;
    const n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  if (m) geo.applyMatrix4(m);
  return geo;
}

/** Merge prepared geometries (position/normal/color, indexed). */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index!.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    P.set(g.attributes.position.array as Float32Array, ov * 3);
    N.set(g.attributes.normal.array as Float32Array, ov * 3);
    C.set(g.attributes.color.array as Float32Array, ov * 3);
    const src = g.index!.array;
    for (let i = 0; i < src.length; i++) I[oi + i] = src[i] + ov;
    ov += n; oi += src.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

/** Skin binding of a part: one bone index (rigid) or a function of the bind-pose vertex → [boneA, boneB, weightA]. */
export type Skin = number | ((x: number, y: number, z: number) => [number, number, number]);

/** Collects coloured parts; `build()` merges them into one geometry (with skinIndex/skinWeight when `skinned`). */
export class Parts {
  list: THREE.BufferGeometry[] = [];
  skins: Skin[] = [];
  /** Current default bone for `add()` without explicit skin. */
  bone = 0;
  add(g: THREE.BufferGeometry, color?: string | THREE.Color, m?: THREE.Matrix4, skin?: Skin): this {
    this.list.push(prep(g, color, m)); this.skins.push(skin ?? this.bone); return this;
  }
  build(skinned = false): THREE.BufferGeometry {
    let si: Uint16Array | null = null, sw: Float32Array | null = null;
    if (skinned) {
      let nv = 0; for (const g of this.list) nv += g.attributes.position.count;
      si = new Uint16Array(nv * 4); sw = new Float32Array(nv * 4);
      let o = 0;
      this.list.forEach((g, k) => {
        const s = this.skins[k], p = g.attributes.position;
        for (let i = 0; i < p.count; i++, o++) {
          if (typeof s === 'number') { si![o * 4] = s; sw![o * 4] = 1; }
          else { const [a, b, w] = s(p.getX(i), p.getY(i), p.getZ(i)); si![o * 4] = a; si![o * 4 + 1] = b; sw![o * 4] = w; sw![o * 4 + 1] = 1 - w; }
        }
      });
    }
    const out = merge(this.list);
    if (si && sw) { out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }
    this.list = []; this.skins = [];
    return out;
  }
  get empty() { return this.list.length === 0; }
}

/* ------------------------------------------------------------------ matrix helpers */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Matrix from position, euler (rx, ry, rz) and scale (number or [x,y,z]). */
export function T(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z);
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
export const mul = (a: THREE.Matrix4, b: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(a, b);

/* ------------------------------------------------------------------ small shapes */
/** Build-time detail factor for segment counts (1 = full; 0.5 = the LOD1 mid mesh). */
let DETAIL = 1;
export function setDetail(d: number) { DETAIL = d; }
const dq = (n: number, min: number) => Math.max(min, Math.round(n * DETAIL));
export const sphere = (r: number, ws = 14, hs = 10) => new THREE.SphereGeometry(r, dq(ws, 5), dq(hs, 3));
export const cyl = (rt: number, rb: number, h: number, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, dq(seg, 4), 1, open);
export const cone = (r: number, h: number, seg = 10) => new THREE.ConeGeometry(r, h, seg <= 4 ? seg : dq(seg, 4));
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const torus = (r: number, tube: number, rs = 8, ts = 24, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, dq(rs, 3), dq(ts, 6), arc);
export const capsule = (r: number, len: number, cs = 4, rs = 10) => new THREE.CapsuleGeometry(r, len, cs, rs);
/** Five-point star extruded (z thickness). */
export function star(r: number, depth: number, inner = 0.45): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * inner : r; const x = Math.cos(a) * q, y = Math.sin(a) * q; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** Flat polygon shape extruded (points in XY). */
export function slab(pts: [number, number][], depth: number, bevel = 0): THREE.BufferGeometry {
  const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** Tube along points. */
export function tube(pts: [number, number, number][], r: number, seg = 16, rs = 6, taper = 0): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  seg = dq(seg, 4); rs = dq(rs, 4);
  const g = new THREE.TubeGeometry(curve, seg, r, rs, false);
  if (taper) {   // shrink towards the end
    const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg; curve.getPointAt(t, c); const k = 1 - taper * t;
      for (let j = 0; j <= rs; j++) { const idx = i * (rs + 1) + j; v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(k).add(c); p.setXYZ(idx, v.x, v.y, v.z); }
    }
    // keep TubeGeometry's radial normals: recomputing them from the indexed mesh leaves a shading seam where the
    // ring's first and last vertices (duplicates) only see one side each (the "glitch" stripe along tails)
  }
  return g;
}

/**
 * Recompute smooth normals and weld them across coincident vertices (UV seams of tubes/tori/spheres duplicate the
 * first and last vertex of each ring; without welding the toon ramp shows a hard stripe along the seam).
 */
export function smoothNormals(g: THREE.BufferGeometry, eps = 1e-5): THREE.BufferGeometry {
  if (g.attributes.normal) g.deleteAttribute('normal');
  g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal as THREE.BufferAttribute;
  const groups = new Map<string, number[]>(), q = 1 / eps;
  for (let i = 0; i < P.count; i++) {
    const k = `${Math.round(P.getX(i) * q)},${Math.round(P.getY(i) * q)},${Math.round(P.getZ(i) * q)}`;
    const a = groups.get(k); if (a) a.push(i); else groups.set(k, [i]);
  }
  const v = new THREE.Vector3();
  for (const a of groups.values()) {
    if (a.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of a) v.x += N.getX(i), v.y += N.getY(i), v.z += N.getZ(i);
    if (v.lengthSq() < 1e-12) continue;   // opposite faces (thin slabs): keep their own normals
    v.normalize();
    for (const i of a) N.setXYZ(i, v.x, v.y, v.z);
  }
  N.needsUpdate = true;
  return g;
}
