/**
 * Layout-driven placement of props: obstacles (fountain, well, dummy, lamps, signpost), LOW furniture (benches, beds,
 * lamps, decor, statue), street lamps, trees and garlands. Collected into the Instancer (by kind name) and garland
 * spans; index.ts resolves kinds through the prop kit (src/world/props) with placeholder fallbacks.
 */
import * as THREE from 'three';
import type { CityLayout, Obstacle } from '../contracts';
import { toX, toZ } from './coords';
import type { GroundSpec } from './ground';
import { inRanges } from './ground';
import type { Ctx } from './kit';

export const MAST_H = 3.6;

export interface Placed { garlands: THREE.Vector3[][]; lampHeads: number[] }

const isE = (o: Obstacle): o is { e: [number, number, number, number]; water?: boolean } => 'e' in o;
const isR = (o: Obstacle): o is { r: [number, number, number] } => 'r' in o;

export function placeProps(k: Ctx, L: CityLayout, s: GroundSpec, groundAt: (x: number, y: number) => number, lampHead: number): Placed {
  const garlands: THREE.Vector3[][] = [];
  const lampHeads: number[] = [];
  const low = L.low;
  const at = (x: number, y: number) => groundAt(x, y);
  const lowLamp = new Set((low?.lamps || []).map((p) => p[0] + ',' + p[1]));
  const decor = new Set((low?.decor || []).map((p) => p[0] + ',' + p[1]));
  const beds = new Set((low?.beds || []).map((p) => p[0] + ',' + p[1]));
  const statue = low?.statue ? low.statue[0] + ',' + low.statue[1] : '';
  const lamp = (x: number, y: number, rot = 0) => {
    const X = toX(x), Z = toZ(y), Y = at(x, y);
    k.inst.add('lamp', X, Y, Z, rot, 1);
    lampHeads.push(X, Y + lampHead, Z);
  };

  // ------------------------------------------------ obstacles
  for (const o of L.obstacles) {
    if (!isE(o)) continue;
    const [cx, cy, rx, ry] = o.e, key = cx + ',' + cy;
    if (lowLamp.has(key) || decor.has(key) || beds.has(key) || key === statue) continue;   // handled from LOW below
    const X = toX(cx), Z = toZ(cy), Y = at(cx, cy);
    if (o.water) { k.inst.add('fountain', X, Y, Z, 0, Math.max(0.6, rx * 0.01 / 1.27)); continue; }
    if (rx >= 80) { k.inst.add('well', X, Y, Z, 0, Math.min(1.6, rx * 0.01 / 0.7)); continue; }
    if (rx >= 26 && rx <= 40 && ry >= 10) { k.inst.add('dummy', X, Y, Z, 0.3, 1.1); continue; }
    if (rx >= 20 && rx < 26) { k.inst.add('signpost', X, Y, Z, -0.4, 1); continue; }
    if (rx >= 13 && rx <= 16 && cy > 900) { lamp(cx, cy); continue; }
    // tiny ellipses (board legs etc.) are part of buildings
  }
  // narrow "r" obstacles between buildings → small clutter
  for (const o of L.obstacles) {
    if (!isR(o)) continue;
    const [x0, x1, y1] = o.r;
    const inB = L.buildings.some((b) => b.hit[3] < 1000 && x0 >= b.hit[0] - 40 && x1 <= b.hit[1] + 40);
    if (inB || y1 > 1000 || x1 - x0 > 200) continue;
    const X = toX((x0 + x1) / 2), Z = toZ(y1) - 0.5;
    if (x1 - x0 < 100) { k.inst.add('barrel', X, 0, Z, 0, 1); k.inst.add('crate', X + 0.1, 0, Z - 0.6, 0.4, 0.9); }
    else k.inst.add('cart', X, 0, Z - 0.2, -0.35, 1);
  }

  // ------------------------------------------------ lower street (LOW)
  if (low) {
    for (const [x, y] of low.benches || []) k.inst.add('bench', toX(x), at(x, y), toZ(y), y > 1600 ? Math.PI : 0, 1.05);
    for (const [x, y] of low.beds || []) {
      const X = toX(x), Z = toZ(y), Y = at(x, y);
      k.inst.add('bed', X, Y, Z, 0, 1);
      k.inst.add('tree', X, Y + 0.35, Z, k.rnd() * 6, 0.75);
    }
    for (const [x, y] of low.lamps || []) lamp(x, y);
    let i = 0;
    for (const [x, y] of low.decor || []) {
      const X = toX(x), Z = toZ(y), Y = at(x, y), r = k.rnd() * 0.6 - 0.3;
      if (i++ % 2) { k.inst.add('barrel', X - 0.25, Y, Z, r, 1); k.inst.add('barrel', X + 0.4, Y, Z + 0.1, -r, 0.9); }
      else { k.inst.add('crate', X - 0.2, Y, Z, r, 1); k.inst.add('crate', X + 0.45, Y, Z + 0.05, -r, 0.85); k.inst.add('crate', X - 0.15, Y + 0.6, Z, r + 0.3, 0.8); }
    }
    if (low.statue) { const [x, y] = low.statue; k.inst.add('statue', toX(x), at(x, y), toZ(y), 0, 1.3); }
  }

  // ------------------------------------------------ upper street: lamps along the ledge, garlands, trees in gaps
  const W = L.W;
  const ledgeY = s.hasLow ? s.edge[0] - 6 : L.area.y1 - 10;
  const stairsPad = s.stairs.map((r) => [r[0] - 60, r[1] + 60] as [number, number]);
  const lampXs: number[] = [];
  for (let x = 300; x < W - 100; x += 640) {
    let xx = x;
    if (inRanges(xx, stairsPad)) xx = stairsPad.find((r) => xx >= r[0] && xx <= r[1])![0] - 20;
    lampXs.push(xx);
    k.inst.add('mast', toX(xx), 0, toZ(ledgeY), 0, 1);   // thin garland mast (keeps the TP camera view clear)
  }
  // lamps flank the stairs at the top of the ledge
  for (const [s0, s1] of s.stairs) { lamp(s0 - 50, ledgeY - 14); lamp(s1 + 50, ledgeY - 14); }
  // garlands: from the facades (z≈0.2, y 3.4) to the masts, zig-zag along the street
  const fairX0 = L.QW;
  const fz = 0.25, gy = 3.3, lz = toZ(ledgeY), ly = MAST_H;
  for (const lx of lampXs) {
    if (lx < 200) continue;
    const X = toX(lx);
    garlands.push([new THREE.Vector3(X - 3.1, gy, fz), new THREE.Vector3(X, ly, lz), new THREE.Vector3(X + 3.1, gy, fz)]);
  }
  // along the fair facades
  const fac: THREE.Vector3[] = [];
  for (let x = fairX0 + 40; x < W - 40; x += 300) fac.push(new THREE.Vector3(toX(x), gy + 0.3 + (fac.length % 2) * 0.35, fz + 0.15));
  if (fac.length > 1) garlands.push(fac);
  // lower street: garlands between canal lamps on the same bank
  const ll = (low?.lamps || []).slice().sort((a, b) => a[0] - b[0]);
  for (let j = 0; j + 1 < ll.length; j++) {
    const a = ll[j], b = ll[j + 1];
    if (b[0] - a[0] > 450) continue;
    garlands.push([new THREE.Vector3(toX(a[0]), at(a[0], a[1]) + lampHead + 0.05, toZ(a[1])), new THREE.Vector3(toX(b[0]), at(b[0], b[1]) + lampHead + 0.05, toZ(b[1]))]);
  }
  // wires collected by building builders (tent pennants, shop beam)
  for (let j = 0; j + 5 < k.wires.length; j += 6) {
    garlands.push([new THREE.Vector3(k.wires[j], k.wires[j + 1], k.wires[j + 2]), new THREE.Vector3(k.wires[j + 3], k.wires[j + 4], k.wires[j + 5])]);
  }
  return { garlands, lampHeads };
}
