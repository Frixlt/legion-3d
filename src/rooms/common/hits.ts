/**
 * Hit volumes of goods must never overlap: a crosshair ray then always resolves to exactly one good (owner's rule:
 * "impossible to buy the wrong item"). Pure functions, no DOM — unit-tested in test/rooms.test.ts.
 */
import * as THREE from 'three';

/**
 * Shrink boxes in place until no two of them intersect. For each intersecting pair the separating plane is put on
 * the axis where their centres are furthest apart (relative to the overlap), halfway through the overlap, with a gap.
 */
export function separateBoxes(boxes: THREE.Box3[], gap = 0.02): void {
  const ca = new THREE.Vector3(), cb = new THREE.Vector3();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!overlaps(a, b, gap * 0.5)) continue;
      a.getCenter(ca); b.getCenter(cb);
      // choose the axis with the smallest overlap relative to the centre distance (cheapest cut that separates)
      let best: 'x' | 'y' | 'z' = 'x', bestScore = -Infinity;
      for (const ax of ['x', 'z', 'y'] as const) {
        const ov = Math.min(a.max[ax], b.max[ax]) - Math.max(a.min[ax], b.min[ax]);
        const d = Math.abs(ca[ax] - cb[ax]);
        const score = d - ov * 0.5 + (ax === 'y' ? -0.05 : 0);
        if (score > bestScore) { bestScore = score; best = ax; }
      }
      const lo = ca[best] <= cb[best] ? a : b, hi = lo === a ? b : a;
      let mid = (Math.max(lo.min[best], hi.min[best]) + Math.min(lo.max[best], hi.max[best])) / 2;
      if (Math.abs(ca[best] - cb[best]) < 1e-6) mid = ca[best];
      lo.max[best] = Math.min(lo.max[best], mid - gap / 2);
      hi.min[best] = Math.max(hi.min[best], mid + gap / 2);
      // never invert a box
      if (lo.max[best] < lo.min[best]) lo.max[best] = lo.min[best] + 1e-3;
      if (hi.min[best] > hi.max[best]) hi.min[best] = hi.max[best] - 1e-3;
      changed = true;
    }
    if (!changed) break;
  }
}

export function overlaps(a: THREE.Box3, b: THREE.Box3, eps = 0): boolean {
  return a.min.x < b.max.x - eps && a.max.x > b.min.x + eps && a.min.y < b.max.y - eps && a.max.y > b.min.y + eps && a.min.z < b.max.z - eps && a.max.z > b.min.z + eps;
}

/** Nearest box hit by the ray within reach (index) or -1 — what an InteractSystem's aim does with Box3 hits. */
export function pickBox(ray: THREE.Ray, boxes: THREE.Box3[], reach = Infinity): number {
  const p = new THREE.Vector3();
  let best = -1, bd = reach;
  boxes.forEach((b, i) => { const q = ray.intersectBox(b, p); if (q) { const d = q.distanceTo(ray.origin); if (d < bd) { bd = d; best = i; } } });
  return best;
}
