/**
 * New Year geometry (built once on the CPU): the decorated fir tree (one merged vertex-coloured mesh: trunk, four
 * snowy tiers, baubles, gift boxes), its star, the tree-light spiral, and the snow caps grown from the city's own
 * up-facing faces (roofs, ledges, sills, awnings, wall tops).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const strip = (g: THREE.BufferGeometry) => {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') n.deleteAttribute(k);
  return n;
};
const paint = (g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, i: number) => [number, number, number]) => {
  const p = g.getAttribute('position'), c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i), i); c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
};
const hex = (h: string): [number, number, number] => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

/** Tiers of the fir tree: base height, height, radius (m). */
export const TREE_TIERS: readonly [number, number, number][] = [[0.42, 1.25, 1.18], [1.05, 1.08, 0.94], [1.6, 0.92, 0.72], [2.1, 0.86, 0.5]];
export const TREE_TOP = 2.1 + 0.86;
/** Footprint radius incl. the gifts (m). */
export const TREE_RADIUS = 1.6;

const BAUBLES = ['#e8384f', '#ffc94a', '#4aa3ff', '#ff7ac8', '#e8384f', '#f4f4ff', '#8f6bff'].map(hex);
const GIFTS: [string, string][] = [['#d93b4f', '#ffe08a'], ['#3f7be0', '#f6f6ff'], ['#f2b630', '#d93b4f'], ['#46a86a', '#ffe08a'], ['#c46be0', '#f6f6ff']];

/**
 * The fir tree at the origin (ground at y = 0): a trunk, four jagged cone tiers in two greens with snow on their
 * shoulders, ~30 shiny baubles and five gift boxes with ribbons round the foot. ≈ 3 m tall, ≈ 2.4 m across.
 */
export function firTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.15, 0.2, 0.6, 8, 1); trunk.translate(0, 0.3, 0);
  parts.push(paint(trunk, () => hex('#6b4428')));
  TREE_TIERS.forEach(([y0, h, r], ti) => {
    const seg = 22, cone = new THREE.ConeGeometry(r, h, seg, 6, false);
    const p = cone.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = (y + h / 2) / h;   // 0 brim … 1 apex
      const a = Math.atan2(z, x), k = Math.round(a / (Math.PI * 2 / seg));
      if (f < 0.01 && Math.hypot(x, z) > 0.01) {               // jagged brim: alternate long / short branches, tips droop
        const s = k % 2 === 0 ? 1.09 : 0.9; p.setXYZ(i, x * s, y - (k % 2 === 0 ? 0.08 : 0.0), z * s);
      }
    }
    cone.computeVertexNormals();
    cone.translate(0, y0 + h / 2, 0);
    const g1 = hex(ti % 2 ? '#2a7a45' : '#21673b'), g2 = hex('#3a9a55'), snow = hex('#f2f7ff');
    paint(cone, (x, y, z) => {
      // snow lies on the visible shoulder of each tier (below the next tier's brim) and on the top tier's tip
      const f = (y - y0) / h, a = Math.atan2(z, x), next = TREE_TIERS[ti + 1], fv = next ? (next[0] - y0) / h : 1;
      const edge = (next ? fv * 0.5 : 0.55) + 0.08 * Math.sin(a * 5 + ti * 1.3) + 0.05 * Math.sin(a * 11 + ti);
      const snowy = (f > edge && (f < fv + 0.05 || !next)) || (f < 0.05 && Math.sin(a * 8 + ti * 2) > 0.6);
      if (snowy) return snow;
      const t = Math.min(1, f * 1.2); return [g1[0] + (g2[0] - g1[0]) * t, g1[1] + (g2[1] - g1[1]) * t, g1[2] + (g2[2] - g1[2]) * t];
    });
    parts.push(cone);
    // baubles hang just under the brim and in the middle of the tier
    const n = [9, 8, 6, 4][ti];
    for (let b = 0; b < n; b++) {
      const a = (b / n) * Math.PI * 2 + ti * 0.7, row = b % 2, f = row ? 0.12 : 0.42, rr = r * (1 - f) + 0.035;
      const s = new THREE.SphereGeometry(0.075 - ti * 0.006, 8, 6);
      s.translate(Math.cos(a) * rr, y0 + h * f - 0.03, Math.sin(a) * rr);
      const c = BAUBLES[(b * 3 + ti * 2) % BAUBLES.length], cy = y0 + h * f - 0.03;
      parts.push(paint(s, (_x, y) => { const k = 0.65 + 0.6 * Math.max(0, (y - cy) / 0.07); return [Math.min(1.4, c[0] * k + 0.05), Math.min(1.4, c[1] * k + 0.05), Math.min(1.4, c[2] * k + 0.05)]; }));
    }
  });
  // gifts round the foot
  GIFTS.forEach(([body, rib], i) => {
    const a = i * 1.31 + 0.4, d = 1.25 * (0.98 + 0.1 * (i % 2)), w = 0.32 + 0.07 * ((i * 5) % 3), h = 0.26 + 0.06 * ((i * 3) % 3);
    const box = new THREE.BoxGeometry(w, h, w * 0.9), r1 = new THREE.BoxGeometry(w * 1.03, h * 1.03, 0.07), r2 = new THREE.BoxGeometry(0.07, h * 1.03, w * 0.93);
    const bow = [-1, 1].map((s) => { const b = new THREE.SphereGeometry(0.06, 6, 4); b.scale(1.2, 0.7, 0.6); b.rotateZ(s * 0.5); b.translate(s * 0.05, h / 2 + 0.035, 0); return b; });
    const bc = hex(body), rc = hex(rib);
    const gift = mergeGeometries([paint(strip(box), () => bc), paint(strip(r1), () => rc), paint(strip(r2), () => rc), ...bow.map((b) => paint(strip(b), () => rc))], false)!;
    gift.rotateY(a * 1.7); gift.translate(Math.cos(a) * d, h / 2 + 0.003, Math.sin(a) * d);
    parts.push(gift);
  });
  const g = mergeGeometries(parts.map(strip), false)!;
  g.computeBoundingSphere();
  return g;
}

/** A plump five-pointed star (radius ≈ 0.22 m) standing on the tree top, facing ±Z. */
export function starGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.1 : 0.23; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -0.025); g.translate(0, TREE_TOP + 0.12, 0);
  const out = strip(g); out.computeBoundingSphere();
  return out;
}

/** Points of the tree-light spiral (local, tree at the origin): x, y, z, size, r, g, b per light. */
export function treeLights(n = 64): number[] {
  const out: number[] = [];
  const pal = [[1, 0.35, 0.25], [1, 0.8, 0.3], [0.45, 1, 0.5], [0.45, 0.7, 1], [1, 0.5, 0.85]];
  for (let i = 0; i < n; i++) {
    const t = i / n, y = 0.55 + t * (TREE_TOP - 0.8), a = t * Math.PI * 2 * 5.5;
    // radius of the tree surface at this height: the widest tier that covers y
    let r = 0.1;
    for (const [y0, h, rr] of TREE_TIERS) if (y >= y0 && y <= y0 + h) r = Math.max(r, rr * (1 - (y - y0) / h));
    const c = pal[i % pal.length];
    out.push(Math.cos(a) * (r + 0.05), y, Math.sin(a) * (r + 0.05), 0.42, c[0], c[1], c[2]);
  }
  return out;
}

/**
 * Snow caps: a copy of every up-facing triangle (normal·up ≥ minUp) of the given city meshes that lies at least
 * `above` m over the street, pushed `lift` m out along its normal. Vertex colours shade steeper faces a little bluer.
 * Returns null when nothing qualifies. Pure CPU (works in node tests).
 */
export function snowCapGeometry(meshes: readonly THREE.Mesh[], groundAt: (X: number, Z: number) => number, opts: { minUp?: number; above?: number; lift?: number; maxTris?: number } = {}): THREE.BufferGeometry | null {
  const minUp = opts.minUp ?? 0.35, above = opts.above ?? 0.35, lift = opts.lift ?? 0.04, maxTris = opts.maxTris ?? 40000;
  const pos: number[] = [], col: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry, p = g.getAttribute('position'), idx = g.index;
    if (!p) continue;
    m.updateWorldMatrix(true, false);
    const mw = m.matrixWorld, T = (idx ? idx.count : p.count) / 3;
    for (let t = 0; t < T && pos.length / 9 < maxTris; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(mw); b.fromBufferAttribute(p, i1).applyMatrix4(mw); c.fromBufferAttribute(p, i2).applyMatrix4(mw);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      const len = n.length(); if (len < 1e-6) continue;
      n.multiplyScalar(1 / len);
      if (n.y < minUp) continue;
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
      if (cy < groundAt(cx, cz) + above) continue;
      const k = lift + 0.01 * (1 - n.y);
      for (const v of [a, b, c]) pos.push(v.x + n.x * k, v.y + n.y * k + 0.004, v.z + n.z * k);
      const sh = 0.9 + 0.1 * n.y;
      for (let j = 0; j < 3; j++) col.push(0.93 * sh, 0.96 * sh, 1.0);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A lumpy snowball (radius ≈ 1, scaled per instance). */
export function snowballGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.08 * Math.sin(x * 7 + y * 5) * Math.cos(z * 6); p.setXYZ(i, x * k, y * k, z * k); }
  g.computeVertexNormals();
  return paint(strip(g), (_x, y) => [0.93 + 0.07 * y, 0.96 + 0.04 * y, 1]);
}
