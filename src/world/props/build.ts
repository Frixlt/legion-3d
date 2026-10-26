/**
 * Prop building blocks: shared materials, a part builder that bakes vertex colours + box-projected UVs and merges
 * sub-parts per material, and an inverted-hull outline generator (the site's dark ink line).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getTexture } from '../tex';

export type PropMat = 'paint' | 'wood' | 'stone' | 'metal' | 'cloth' | 'roof' | 'glow' | 'water' | 'waterFx' | 'outline';

export interface PropPart { geo: THREE.BufferGeometry; mat: PropMat }

/** Default box-projection tile size (m) per material. */
const TILE: Record<PropMat, number> = {
  paint: 1, wood: 1.1, stone: 0.9, metal: 0.5, cloth: 0.6, roof: 0.7, glow: 1, water: 1.6, waterFx: 1, outline: 1,
};

/* ------------------------------------------------------------------ materials */

/** Brightness multiplier of the emissive ("glow") parts — >1 so AgX/ACES tone mapping reads them as light sources. */
export const GLOW_GAIN = 2.2;
export const INK = '#2b1d18';

let mats: Partial<Record<PropMat, THREE.Material>> = {};

export function propMaterial(key: PropMat): THREE.Material {
  let m = mats[key];
  if (m) return m;
  switch (key) {
    case 'paint': m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }); break;
    case 'wood': {
      const t = getTexture('wood', { neutral: true, seed: 3 });
      m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.8 });
      break;
    }
    case 'stone': {
      const t = getTexture('stone', { neutral: true, seed: 5 });
      m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1 });
      break;
    }
    case 'metal': {
      const t = getTexture('metal', { neutral: true, seed: 2 });
      m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.9, metalness: 0.35 });
      break;
    }
    case 'cloth': {
      const t = getTexture('canvas', { neutral: true, colors: ['#ffffff', '#f4f4f4'] });
      m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.92, side: THREE.DoubleSide });
      break;
    }
    case 'roof': {
      const t = getTexture('slate', { neutral: true, seed: 4 });
      m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1 });
      break;
    }
    case 'glow': {
      const b = new THREE.MeshBasicMaterial({ vertexColors: true });
      b.color.setScalar(GLOW_GAIN);
      m = b; break;
    }
    case 'water': {
      const t = getTexture('water', { neutral: true });
      m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.12, metalness: 0.1, emissive: new THREE.Color('#1a3a6a'), emissiveIntensity: 0.35 });
      break;
    }
    case 'waterFx':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color('#5aa0e0'), emissiveIntensity: 0.4 });
      break;
    case 'outline':
      m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
      break;
  }
  m!.name = 'prop:' + key;
  mats[key] = m!;
  return m!;
}

export function disposeMaterials(): void {
  for (const m of Object.values(mats)) m?.dispose();
  mats = {};
}

/* ------------------------------------------------------------------ primitive shapes (fresh, unindexed later) */

export const rbox = (w: number, h: number, d: number, r = 0.03, seg = 1): THREE.BufferGeometry =>
  new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 10, open = false, t0 = 0, tl = Math.PI * 2): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, t0, tl);
export const sph = (r: number, ws = 10, hs = 7): THREE.BufferGeometry => new THREE.SphereGeometry(r, ws, hs);
export const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);
export const torus = (R: number, r: number, rs = 6, ts = 16, arc = Math.PI * 2): THREE.BufferGeometry => new THREE.TorusGeometry(R, r, rs, ts, arc);
export const capsule = (r: number, len: number, cs = 4, rs = 10): THREE.BufferGeometry => new THREE.CapsuleGeometry(r, len, cs, rs);
/** Lathe around Y from [r, y] pairs. */
export const lathe = (pts: [number, number][], seg = 14): THREE.BufferGeometry =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
/** Thin extruded 2D shape in the XY plane (depth along Z, centred). */
export function slab(shape: THREE.Shape, depth: number, bevel = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/* ------------------------------------------------------------------ part builder */

export interface Xf {
  /** position */ p?: [number, number, number];
  /** euler rotation (rad, XYZ) */ r?: [number, number, number];
  /** scale */ s?: number | [number, number, number];
  /** UVs: number = box-projection tile (m), 'keep' = geometry UVs, [su, sv] = geometry UVs scaled. Default: box with material tile. */
  uv?: number | 'keep' | [number, number];
  /** Swap u/v of the box projection (turns wood planks 90°). */
  swap?: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export class PB {
  private parts = new Map<PropMat, THREE.BufferGeometry[]>();

  /** Add `src` (consumed) with a baked colour. */
  add(mat: PropMat, src: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: Xf = {}): this {
    const g = src.index ? src.toNonIndexed() : src;
    if (g !== src) src.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const s = x.s ?? 1;
    _q.setFromEuler(_e.set(...(x.r ?? [0, 0, 0])));
    _m.compose(_v.set(...(x.p ?? [0, 0, 0])), _q, typeof s === 'number' ? _s.set(s, s, s) : _s.set(...s));
    g.applyMatrix4(_m);
    const pos = g.attributes.position as THREE.BufferAttribute, n = pos.count;
    // UVs
    const uvm = x.uv ?? TILE[mat];
    if (typeof uvm === 'number') {
      const uv = new Float32Array(n * 2), t = 1 / uvm;
      for (let i = 0; i + 2 < n; i += 3) {
        _a.fromBufferAttribute(pos, i + 1).sub(_v.fromBufferAttribute(pos, i));
        _b.fromBufferAttribute(pos, i + 2).sub(_v);
        _n.crossVectors(_a, _b);
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        for (let j = i; j < i + 3; j++) {
          const px = pos.getX(j), py = pos.getY(j), pz = pos.getZ(j);
          let u: number, v: number;
          if (ay >= ax && ay >= az) { u = px; v = pz; } else if (ax >= az) { u = pz; v = py; } else { u = px; v = py; }
          if (x.swap) { const w = u; u = v; v = w; }
          uv[j * 2] = u * t; uv[j * 2 + 1] = v * t;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    } else if (Array.isArray(uvm) && g.attributes.uv) {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvm[0], uv.getY(i) * uvm[1]);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    // colour (linear, as three expects for vertex colours)
    _c.set(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let list = this.parts.get(mat); if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    return this;
  }

  /** Merge into one geometry per material. */
  build(): PropPart[] {
    const out: PropPart[] = [];
    for (const [mat, list] of this.parts) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false)!;
      if (list.length > 1) for (const g of list) g.dispose();
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      out.push({ geo, mat });
    }
    this.parts.clear();
    return out;
  }
}

/**
 * Inverted-hull outline: all parts (except FX) welded by position, smooth normals, pushed out by `w` metres.
 * Rendered with the BackSide 'outline' material it gives the cartoon ink line of the site art.
 */
export function outlineOf(parts: PropPart[], w = 0.012): THREE.BufferGeometry | null {
  const src: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    if (p.mat === 'waterFx' || p.mat === 'water' || p.mat === 'cloth') continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', p.geo.attributes.position.clone());
    src.push(g);
  }
  if (!src.length) return null;
  const merged = src.length === 1 ? src[0] : mergeGeometries(src, false)!;
  const welded = mergeVertices(merged, 1e-3);
  welded.computeVertexNormals();
  const pos = welded.attributes.position as THREE.BufferAttribute, nor = welded.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * w, pos.getY(i) + nor.getY(i) * w, pos.getZ(i) + nor.getZ(i) * w);
  welded.deleteAttribute('normal');
  welded.computeBoundingSphere();
  for (const g of src) g.dispose();
  merged.dispose();
  return welded;
}

/** Triangle count of a geometry. */
export function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}
