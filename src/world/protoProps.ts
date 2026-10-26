/**
 * Placeholder instanced prop kinds (used until/unless the `props` kit provides a kind). Origin at the footprint
 * centre on the ground, front +Z. Each part carries baked vertex colours; material keys match index.ts materials.
 */
import * as THREE from 'three';
import { Instancer, part } from './instancer';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pal } from './palette';

const merge = (gs: THREE.BufferGeometry[]) => { const m = mergeGeometries(gs, false)!; gs.forEach((g) => g.dispose()); return m; };

export const LAMP_HEAD_Y = 2.75;

/** Set a part's vertex colour to an HDR value (> 1 allowed: emissive glass that should reach the bloom threshold). */
function hdr(g: THREE.BufferGeometry, r: number, gg: number, b: number): THREE.BufferGeometry {
  const c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, r, gg, b);
  return g;
}

export function registerProtoProps(inst: Instancer, P: Pal): void {
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10), cone4 = new THREE.ConeGeometry(0.5, 1, 4);
  const sph = new THREE.SphereGeometry(0.5, 8, 6), sphS = new THREE.SphereGeometry(0.5, 5, 3);
  // street lamp: stepped base, slim post with a ring, lantern (4 corner rods + emissive core), cap + finial
  const H = LAMP_HEAD_Y, rods: THREE.BufferGeometry[] = [];
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) rods.push(part(box, P.metal, dx * 0.13, H, dz * 0.13, 0.035, 0.42, 0.035));
  inst.registerKind('lamp', [
    { mat: 'metal', castShadow: true, geo: merge([
      part(cyl, P.metal, 0, 0.08, 0, 0.42, 0.16, 0.42), part(cyl, P.metal, 0, 0.3, 0, 0.24, 0.3, 0.24),
      part(cyl, P.metal, 0, 1.45, 0, 0.09, 2.3, 0.09), part(cyl, '#ffcf4a', 0, 1.1, 0, 0.15, 0.06, 0.15),
      part(cyl, P.metal, 0, H - 0.24, 0, 0.34, 0.05, 0.34), part(cyl, P.metal, 0, H - 0.3, 0, 0.14, 0.12, 0.14),
      ...rods,
      part(cone4, P.metal, 0, H + 0.33, 0, 0.5, 0.26, 0.5, 0, Math.PI / 4), part(sphS, '#ffcf4a', 0, H + 0.5, 0, 0.09, 0.09, 0.09),
    ]) },
    // lantern glass: linear ≈ (1.95, 1.37, 0.65) after the emit ×1.3 → luminance ≈ 1.45, just over the bloom knee (soft glow)
    { mat: 'emit', geo: hdr(part(cyl, '#ffd27a', 0, H, 0, 0.22, 0.36, 0.22), 1.5, 1.05, 0.5) },
  ]);
  // garland mast: thin pole with a gold finial and a small pennant
  inst.registerKind('mast', [{ mat: 'metal', geo: merge([
    part(cyl, P.metal, 0, 0.1, 0, 0.22, 0.2, 0.22), part(cyl, P.metal, 0, 1.85, 0, 0.06, 3.6, 0.06), part(sphS, '#ffcf4a', 0, 3.7, 0, 0.12, 0.12, 0.12),
  ]) }, { mat: 'flat', geo: part(cone4, P.flag, 0.22, 3.35, 0, 0.12, 0.42, 0.04, 0, 0, -Math.PI / 2) }]);
  // bench: seat + back + legs + armrests
  inst.registerKind('bench', [{ mat: 'wood', castShadow: true, geo: merge([
    part(box, P.woodL, 0, 0.42, 0, 1.5, 0.08, 0.42), part(box, P.woodL, 0, 0.78, -0.2, 1.5, 0.3, 0.06, -0.15),
    part(box, P.woodD, -0.65, 0.2, 0, 0.08, 0.4, 0.4), part(box, P.woodD, 0.65, 0.2, 0, 0.08, 0.4, 0.4),
    part(box, P.woodD, -0.72, 0.58, 0, 0.08, 0.06, 0.42), part(box, P.woodD, 0.72, 0.58, 0, 0.08, 0.06, 0.42),
  ]) }, { mat: 'flat', geo: merge([part(cone4, P.flag, -0.55, 1.02, -0.22, 0.16, 0.18, 0.06), part(cone4, P.flag, 0.55, 1.02, -0.22, 0.16, 0.18, 0.06)]) }]);
  // crate
  inst.registerKind('crate', [{ mat: 'wood', castShadow: true, geo: merge([
    part(box, P.wood, 0, 0.27, 0, 0.55, 0.54, 0.55),
    part(box, P.woodD, 0, 0.27, 0.28, 0.6, 0.08, 0.02), part(box, P.woodD, 0, 0.27, -0.28, 0.6, 0.08, 0.02),
    part(box, P.woodD, 0.28, 0.27, 0, 0.02, 0.08, 0.6), part(box, P.woodD, -0.28, 0.27, 0, 0.02, 0.08, 0.6),
  ]) }]);
  // barrel
  const bar = new THREE.CylinderGeometry(0.28, 0.24, 0.75, 12);
  inst.registerKind('barrel', [{ mat: 'wood', castShadow: true, geo: merge([
    part(bar, P.wood, 0, 0.375, 0), part(cyl, P.metal, 0, 0.18, 0, 0.53, 0.05, 0.53), part(cyl, P.metal, 0, 0.6, 0, 0.55, 0.05, 0.55),
    part(cyl, P.woodD, 0, 0.752, 0, 0.5, 0.01, 0.5),
  ]) }]);
  bar.dispose();
  // flower bed (ellipse planter with bushes and flowers) — scale x by caller
  const flowers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2, r = 0.55;
    flowers.push(part(sphS, ['#ff8fa3', '#ffcf4a', '#c8a8ff'][i % 3], Math.cos(a) * r * 1.6, 0.62, Math.sin(a) * r * 0.5, 0.14, 0.14, 0.14));
  }
  inst.registerKind('bed', [
    { mat: 'stone', geo: part(cyl, '#8b7f8f', 0, 0.2, 0, 2.0, 0.4, 0.62) },
    { mat: 'leaf', geo: merge([part(sph, P.leaf, -0.45, 0.5, 0, 0.7, 0.55, 0.5), part(sph, P.leafD, 0.4, 0.5, 0, 0.75, 0.6, 0.5), part(sph, P.leaf, 0, 0.62, 0, 0.6, 0.6, 0.45)]) },
    { mat: 'flat', geo: merge(flowers) },
  ]);
  // potted tree / topiary
  inst.registerKind('tree', [
    { mat: 'wood', geo: merge([part(cyl, '#a9503c', 0, 0.22, 0, 0.5, 0.44, 0.5), part(cyl, P.woodD, 0, 0.8, 0, 0.1, 1.2, 0.1)]) },
    { mat: 'leaf', castShadow: true, geo: merge([part(sph, P.leaf, 0, 1.55, 0, 1.0, 0.95, 1.0), part(sph, P.leafD, 0.2, 1.35, 0.15, 0.6, 0.55, 0.6)]) },
  ]);
  inst.registerKind('bush', [{ mat: 'leaf', geo: merge([part(sph, P.leaf, 0, 0.3, 0, 0.9, 0.7, 0.8), part(sph, P.leafD, 0.35, 0.25, 0.1, 0.6, 0.5, 0.6)]) }]);
  // railing segment (2 m along X): posts + balusters + rails
  const rail: THREE.BufferGeometry[] = [part(box, P.metal, 0, 0.88, 0, 2.02, 0.06, 0.08), part(box, P.metal, 0, 0.12, 0, 2.0, 0.04, 0.04)];
  for (const x of [-1, 1]) { rail.push(part(box, P.metal, x, 0.45, 0, 0.08, 0.9, 0.08)); rail.push(part(sphS, '#ffcf4a', x, 0.96, 0, 0.11, 0.11, 0.11)); }
  for (let i = 1; i < 4; i++) rail.push(part(box, P.metal, -1 + i * 0.5, 0.5, 0, 0.025, 0.76, 0.025));
  inst.registerKind('fence', [{ mat: 'metal', geo: merge(rail) }]);
  box.dispose(); cyl.dispose(); cone4.dispose(); sph.dispose(); sphS.dispose();
}
