/**
 * Owner bug (round 2): the street mine portal could be seen INTO from the ledge / beside it — the tunnel box, timber
 * sets, rails and cart showed between the rocks. Rule: from any spot a player (or the camera above them, up to the
 * high third-person arm) can reach, a sight line to a point inside the adit either passes through the mouth or is
 * stopped by a surface that faces the viewer (back faces are culled on screen, so they block nothing).
 */
import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { fixtureLayout } from '../dev/fixtures';
import { Batch } from '../src/world/batch';
import { groundSpec, makeGroundAt } from '../src/world/ground';
import { paletteOf } from '../src/world/palette';
import { rng } from '../src/world/textures';
import { Instancer } from '../src/world/instancer';
import { toX, toZ } from '../src/world/coords';
import type { Ctx } from '../src/world/kit';
import type { SignAtlas } from '../src/world/textures';
import { buildStatic } from '../src/world/static';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { mineAdit } from '../src/world/lowstreet';

const DOUBLE = new Set(['flat', 'canvas']);

function city() {
  const L = fixtureLayout(), spec = groundSpec(L), groundAt = makeGroundAt(spec);
  const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
  const k: Ctx = {
    b: new Batch(14), pal: paletteOf(L.styleId), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1234), quality: 2,
    lowH: spec.lowH, wallZ: toZ(spec.wallY), colliders: [], pools: [], solids: [],
  };
  const tri: number[] = [], dbl: boolean[] = [], own: string[] = [];
  k.b.recorder = (mat: string, g: THREE.BufferGeometry, tag: string) => {
    if (mat === 'back') return;
    const p = g.attributes.position as THREE.BufferAttribute, ix = g.index, n = ix ? ix.count : p.count;
    for (let i = 0; i < n; i++) { const j = ix ? ix.getX(i) : i; tri.push(p.getX(j), p.getY(j), p.getZ(j)); }
    for (let i = 0; i < n; i += 3) { dbl.push(DOUBLE.has(mat)); own.push(tag + ':' + mat); }
  };
  buildStatic(k, L, spec, groundAt, 2.75);
  const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
  return { L, k, groundAt, top, T: new Float64Array(tri), dbl, own };
}

describe('mine portal enclosure', () => {
  it('the adit is visible only through its mouth from every reachable viewpoint', () => {
    const { L, groundAt, top, T, dbl, own } = city();
    const b = L.buildings.find((q) => q.id === 'mine')!;
    expect(b).toBeTruthy();
    const A = mineAdit(b, groundSpec(L).lowH);
    // 2D grid (0.5 m cells over x/z) of the triangles around the mine
    const C = 0.5, gx0 = A.cx - 30, gz0 = -12, NX = 120, NZ = 70;
    const cells: number[][] = Array.from({ length: NX * NZ }, () => []);
    for (let t = 0; t < dbl.length; t++) {
      const o = t * 9;
      const a0 = Math.floor((Math.min(T[o], T[o + 3], T[o + 6]) - gx0) / C), a1 = Math.floor((Math.max(T[o], T[o + 3], T[o + 6]) - gx0) / C);
      const c0 = Math.floor((Math.min(T[o + 2], T[o + 5], T[o + 8]) - gz0) / C), c1 = Math.floor((Math.max(T[o + 2], T[o + 5], T[o + 8]) - gz0) / C);
      if (a1 < 0 || c1 < 0 || a0 >= NX || c0 >= NZ || a1 - a0 > 60 || c1 - c0 > 60) continue;   // far away / the backdrop ring
      for (let x = Math.max(0, a0); x <= Math.min(NX - 1, a1); x++) for (let z = Math.max(0, c0); z <= Math.min(NZ - 1, c1); z++) cells[z * NX + x].push(t);
    }
    const stamp = new Int32Array(dbl.length); let ray = 0;
    /** Nearest surface along o + d·t (t < far): triangle index and whether it is seen from behind (-1: nothing). */
    const trace = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number): [number, boolean] => {
      ray++;
      let best = far, bt = -1, back = false;
      let cx = Math.floor((ox - gx0) / C), cz = Math.floor((oz - gz0) / C);
      const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, tdx = Math.abs(C / (dx || 1e-12)), tdz = Math.abs(C / (dz || 1e-12));
      let tx = dx ? (gx0 + (cx + (dx > 0 ? 1 : 0)) * C - ox) / dx : 1e18, tz = dz ? (gz0 + (cz + (dz > 0 ? 1 : 0)) * C - oz) / dz : 1e18, tc = 0;
      while (tc < best) {
        if (cx >= 0 && cz >= 0 && cx < NX && cz < NZ) for (const t of cells[cz * NX + cx]) {
          if (stamp[t] === ray) continue; stamp[t] = ray;
          const o = t * 9;
          const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
          const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det, qx0 = ox - T[o], qy0 = oy - T[o + 1], qz0 = oz - T[o + 2];
          const u = (qx0 * px + qy0 * py + qz0 * pz) * inv; if (u < 0 || u > 1) continue;
          const qx = qy0 * e1z - qz0 * e1y, qy = qz0 * e1x - qx0 * e1z, qz = qx0 * e1y - qy0 * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > 1e-4 && tt < best) { best = tt; bt = t; back = det < 0 && !dbl[t]; }
        }
        if (tx < tz) { tc = tx; tx += tdx; cx += sx; } else { tc = tz; tz += tdz; cz += sz; }
        if (cx < -1 || cz < -1 || cx > NX || cz > NZ) break;
      }
      return [bt, back];
    };
    // aim points: the adit (tunnel + frame) and a margin around it, where the rocks meet it
    let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const aim = (): [number, number, number] => [A.cx + (rnd() * 2 - 1) * (A.hw + 0.6), A.base + rnd() * (A.th + 0.8), A.zBack - 0.3 + rnd() * (A.zf - A.zBack + 0.6)];
    // viewpoints: reachable spots within ~13 m (upper street, ledge, stairs, lower street), the eye 1.15 above what you
    // stand on and camera heights above them (the third-person arm reaches ~7 m)
    const views: [number, number, number][] = [];
    for (let y = 800; y <= 1700; y += 30) for (let x = b.hit[0] - 1300; x <= b.hit[1] + 1300; x += 70) {
      if (!L.free(x, y)) continue;
      const st = top(x, y); if (st === Infinity) continue;
      const g = Math.max(groundAt(x, y), Number.isFinite(st) ? st : -1e9);
      for (const h of [1.15, 3, 6]) views.push([toX(x), g + h, toZ(y)]);
    }
    expect(views.length).toBeGreaterThan(1000);
    // the first surface a sight line meets is never a mine surface seen from behind (= the inside of the tunnel or of
    // the rock mass showing through a gap)
    let leaks = 0, rays = 0; const samples: string[] = [];
    for (const [ox, oy, oz] of views) for (let i = 0; i < 120; i++) {
      const [tx, ty, tz] = aim();
      let dx = tx - ox, dy = ty - oy, dz = tz - oz; const len = Math.hypot(dx, dy, dz); dx /= len; dy /= len; dz /= len;
      rays++;
      const [t, back] = trace(ox, oy, oz, dx, dy, dz, len + 3);
      if (t >= 0 && back && own[t].startsWith('mine:')) { leaks++; if (samples.length < 8) samples.push(`eye ${[ox, oy, oz].map((q) => q.toFixed(2))} dir ${[dx, dy, dz].map((q) => q.toFixed(2))} → back of ${own[t]}`); }
    }
    expect(rays).toBeGreaterThan(100000);
    if (leaks) console.log(`${leaks} of ${rays} sight lines see a mine surface from behind:\n` + samples.join('\n'));
    expect(leaks).toBe(0);
  });
});
