/**
 * Small "lived-in" set dressing for rooms, all baked into the room's static batch (no extra draw calls): bunting and
 * string lights, baskets of fruit, sacks, potted plants, candles, wall lamps with a pool of light, tablecloths,
 * paintings, hanging herbs, stools, books, mugs. Positions are room metres; `ry` = yaw the thing faces (0 = +Z).
 */
import * as THREE from 'three';
import type { RoomKit } from './kit';
import { M, GEO } from '../../world/batch';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** Point on a sagging string between a and b (t 0..1). */
function sag(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, s: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(ax + (bx - ax) * t, ay + (by - ay) * t - Math.sin(t * Math.PI) * s, az + (bz - az) * t);
}

/** Pennant bunting: a dark string with n triangular flags in `colors`, sagging by `s`. */
export function bunting(K: RoomKit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, n: number, colors: string[], s = 0.3): void {
  const yaw = Math.atan2(-(bz - az), bx - ax);
  const len = Math.hypot(bx - ax, bz - az), seg = len / n;
  for (let i = 0; i < n; i++) {
    sag(ax, ay, az, bx, by, bz, (i + 0.5) / n, s, _a);
    sag(ax, ay, az, bx, by, bz, i / n, s, _b);
    const t2 = sag(ax, ay, az, bx, by, bz, (i + 1) / n, s, new THREE.Vector3());
    const pitch = Math.atan2(t2.y - _b.y, seg);
    K.b.add('back', GEO.box, M(_a.x, _a.y + 0.01, _a.z, seg, 0.012, 0.012, 0, yaw, pitch), '#3a2a24', 1);
    K.geo('flat', FLAG, M(_a.x, _a.y - 0.01, _a.z, seg * 0.8, seg * 0.95, 1, 0, yaw, 0), colors[i % colors.length]);
  }
}
/** Downward triangle (flag), top edge at y = 0, 1 wide, 1 tall. */
const FLAG = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  return g;
})();

/** Festoon of bulbs (emissive, glow halos), the night-fair look. */
export function stringLights(K: RoomKit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, n: number, colors = ['#ffcf6a', '#ff8fa3', '#7fd6e6', '#b9ff9a'], s = 0.3, halo = 0.5): void {
  const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
  for (let i = 0; i <= n; i++) {
    sag(ax, ay, az, bx, by, bz, i / n, s, _a);
    if (i < n) { sag(ax, ay, az, bx, by, bz, (i + 0.5) / n, s, _b); const t2 = sag(ax, ay, az, bx, by, bz, (i + 1) / n, s, new THREE.Vector3()); K.b.add('back', GEO.box, M(_b.x, (_a.y + t2.y) / 2 + 0.03, _b.z, len / n, 0.01, 0.01, 0, yaw, Math.atan2(t2.y - _a.y, len / n)), '#2b1d18', 1); }
    if (i === 0 || i === n) continue;
    const c = colors[i % colors.length];
    K.geo('emit', BULB, M(_a.x, _a.y - 0.04, _a.z, 0.08, 0.1, 0.08), c);
    if (halo > 0 && i % 2 === 0) K.glow(_a.x, _a.y - 0.04, _a.z, halo, c, 0.7);
  }
}

/** Wicker basket with fruit / bread on top (`fill` colours; null = empty). */
export function basket(K: RoomKit, x: number, y: number, z: number, r = 0.22, fill: string[] | null = null, h = 0.16): void {
  K.cyl('wood', '#c99a5a', x, y, z, r, h, 12);
  K.cyl('wood', '#a87a42', x, y + h - 0.02, z, r + 0.02, 0.035, 12);
  if (!fill) return;
  const n = r > 0.18 ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, rr = i === 0 ? 0 : r * 0.5;
    K.ball('back', fill[i % fill.length], x + Math.cos(a) * rr, y + h + 0.03 + (i === 0 ? 0.04 : 0), z + Math.sin(a) * rr, r * 0.38);
  }
}

/** Cloth sack (tied top). */
export function sack(K: RoomKit, x: number, z: number, col = '#d8c08a', s = 1, y = 0): void {
  K.ball('canvas', col, x, y + 0.28 * s, z, 0.27 * s, 1.15);
  K.cyl('canvas', col, x, y + 0.55 * s, z, 0.08 * s, 0.1 * s, 8);
  K.cyl('back', '#8a5a2b', x, y + 0.56 * s, z, 0.08 * s + 0.008, 0.025, 8);   // the tie stands ≥ 7 mm proud of the neck
}

/** Potted plant: terracotta pot + leafy balls (+ optional flowers). */
export function potPlant(K: RoomKit, x: number, y: number, z: number, s = 1, flower: string | null = '#ff8fa3'): void {
  K.cyl('stone', '#c8643a', x, y, z, 0.16 * s, 0.24 * s, 12);
  K.cyl('stone', '#b05530', x, y + 0.22 * s, z, 0.18 * s, 0.05 * s, 12);
  for (let i = 0; i < 4; i++) { const a = i * 1.7; K.ball('leaf', i % 2 ? '#4f9a4a' : '#6ab85a', x + Math.cos(a) * 0.09 * s, y + (0.36 + (i % 2) * 0.1) * s, z + Math.sin(a) * 0.09 * s, 0.13 * s); }
  if (flower) for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; K.ball('back', flower, x + Math.cos(a) * 0.12 * s, y + 0.5 * s, z + Math.sin(a) * 0.12 * s, 0.045 * s); }
}

/** Candle (stick + flame + small glow). */
export function candle(K: RoomKit, x: number, y: number, z: number, h = 0.14, glow = true): void {
  K.cyl('back', '#f7ead0', x, y, z, 0.028, h, 8);
  K.ball('emit', '#ffcf6a', x, y + h + 0.04, z, 0.022, 1.6);
  if (glow) K.glow(x, y + h + 0.05, z, 0.45, '#ffcf6a', 0.9);
}

/**
 * Wall lamp: bracket + warm bulb + a pool of light on the wall below it and on the floor (splashes) — reads as "lit"
 * at every quality. `ry` = the direction the wall faces. Optionally a real light (prio).
 */
export function wallLamp(K: RoomKit, x: number, y: number, z: number, ry: number, o: { color?: string; real?: number; pool?: number } = {}): void {
  const c = o.color || '#ffcf6a', sx = Math.sin(ry), sz = Math.cos(ry);
  K.rbox('metal', K.pal.metal, x + sx * 0.12, y, z + sz * 0.12, 0.04, 0.04, 0.24, ry);
  K.cone('metal', '#3a3040', x + sx * 0.24, y + 0.05, z + sz * 0.24, 0.1, 0.08, true);
  K.ball('emit', c, x + sx * 0.24, y - 0.04, z + sz * 0.24, 0.07);
  K.glow(x + sx * 0.26, y - 0.04, z + sz * 0.26, 0.9, c, 0.8);
  const p = o.pool ?? 1;
  K.splash(x + sx * 0.03, y - 0.3, z + sz * 0.03, 1.8 * p, 1.6 * p, c, 0.32, ry);
  if (o.real) K.light(x + sx * 0.5, y - 0.1, z + sz * 0.5, c, 3, 5, 0, o.real);
}

/** Tablecloth over a table top (y = top), hanging `hang` m down on every side. */
export function cloth(K: RoomKit, x0: number, x1: number, z0: number, z1: number, y: number, col: string, hang = 0.14, trim?: string): void {
  // the hanging sides reach the top sheet's top (y + 0.012): their tops never lie in the table top's plane
  const t = y + 0.012;
  K.box('canvas', col, x0 - 0.03, x1 + 0.03, y, t, z0 - 0.03, z1 + 0.03);
  K.box('canvas', col, x0 - 0.04, x1 + 0.04, y - hang, t, z0 - 0.04, z0 - 0.03);
  K.box('canvas', col, x0 - 0.04, x1 + 0.04, y - hang, t, z1 + 0.03, z1 + 0.04);
  K.box('canvas', col, x0 - 0.04, x0 - 0.03, y - hang, t, z0 - 0.03, z1 + 0.03);
  K.box('canvas', col, x1 + 0.03, x1 + 0.04, y - hang, t, z0 - 0.03, z1 + 0.03);
  if (trim) { K.box('canvas', trim, x0 - 0.04, x1 + 0.04, y - hang - 0.03, y - hang, z1 + 0.03, z1 + 0.05); K.box('canvas', trim, x0 - 0.04, x1 + 0.04, y - hang - 0.03, y - hang, z0 - 0.05, z0 - 0.03); }
}

/** Framed picture on a wall: frame + 2–3 colour bands (a landscape / portrait read). */
export function painting(K: RoomKit, x: number, y: number, z: number, ry: number, w: number, h: number, cols = ['#7fb0e8', '#9fe39a', '#ffcf6a'], frame = '#c9a04a'): void {
  const sx = Math.sin(ry), sz = Math.cos(ry);
  K.rbox('wood', frame, x + sx * 0.03, y, z + sz * 0.03, w + 0.12, h + 0.12, 0.05, ry);
  const n = cols.length;
  for (let i = 0; i < n; i++) K.rbox('back', cols[i], x + sx * 0.06, y - h / 2 + h * (i + 0.5) / n, z + sz * 0.06, w, h / n, 0.01, ry);   // butt-joined bands
  K.rbox('back', '#fff3c4', x + sx * 0.07 + Math.cos(ry) * w * 0.25, y + h * 0.25, z + sz * 0.07 - Math.sin(ry) * w * 0.25, h * 0.16, h * 0.16, 0.01, ry);
}

/** Bundle hanging from a beam: string + a cluster (herbs, garlic, peppers). */
export function hanging(K: RoomKit, x: number, y: number, z: number, top: number, col: string, kind: 'herb' | 'garlic' | 'pepper' | 'sausage' = 'herb'): void {
  K.box('back', '#3a2a24', x - 0.006, x + 0.006, y, top, z - 0.006, z + 0.006);
  if (kind === 'herb') for (let i = 0; i < 4; i++) K.cone('leaf', i % 2 ? col : '#6ab85a', x + (i - 1.5) * 0.04, y - 0.3 - i * 0.012, z, 0.06, 0.32);   // staggered: overlapping bases never share a plane
  else if (kind === 'garlic') for (let i = 0; i < 4; i++) K.ball('back', col, x + (i % 2 ? 0.05 : -0.05), y - 0.06 - i * 0.1, z, 0.06, 0.9);
  else if (kind === 'pepper') for (let i = 0; i < 5; i++) K.cone('back', col, x + (i - 2) * 0.035, y - 0.22, z + (i % 2) * 0.02, 0.025, 0.2);
  else K.cyl('back', col, x, y - 0.32, z, 0.05, 0.3, 8);
}

/** Round stool / pouf. */
export function stool(K: RoomKit, x: number, z: number, col: string, h = 0.42, r = 0.2, legs = true): void {
  if (legs) for (let i = 0; i < 3; i++) { const a = i * 2.094; K.box('wood', K.pal.woodD, x + Math.cos(a) * r * 0.6 - 0.02, x + Math.cos(a) * r * 0.6 + 0.02, 0, h - 0.04, z + Math.sin(a) * r * 0.6 - 0.02, z + Math.sin(a) * r * 0.6 + 0.02); }
  K.cyl(legs ? 'wood' : 'canvas', col, x, legs ? h - 0.06 : 0, z, r, legs ? 0.06 : h, 12);
  if (!legs) K.ball('canvas', col, x, h, z, r * 0.9, 0.25);
  K.solid(x - r, x + r, z - r, z + r, h);
}

/** A row of books standing on a shelf at y, along x from x0 (facing +Z/−Z doesn't matter: thin boxes). */
export function books(K: RoomKit, x0: number, x1: number, y: number, z: number, d = 0.2, seed = 1, axis: 'x' | 'z' = 'x'): void {
  const cols = ['#a3122a', '#3a6aa8', '#5a9a4a', '#c9884a', '#6a4a9a', '#e0b040'];
  let u = x0, k = seed;
  while (u < x1 - 0.05) {
    const bw = 0.04 + ((k * 37) % 5) * 0.01, bh = 0.18 + ((k * 13) % 4) * 0.03;
    if (axis === 'x') K.box('back', cols[k % cols.length], u, u + bw, y, y + bh, z - d / 2, z + d / 2);
    else K.box('back', cols[k % cols.length], z - d / 2, z + d / 2, y, y + bh, u, u + bw);
    u += bw + 0.008; k++;
  }
}

/** Mug (cylinder + handle). */
export function mug(K: RoomKit, x: number, y: number, z: number, col = '#e8dcc8'): void {
  K.cyl('back', col, x, y, z, 0.045, 0.1, 8);
  K.box('back', col, x + 0.045, x + 0.07, y + 0.025, y + 0.075, z - 0.01, z + 0.01);
}

/** Round rug (two discs). */
export function roundRug(K: RoomKit, x: number, z: number, r: number, col: string, border: string): void {
  K.floorDisc('canvas', border, x, z, r);
  K.floorDisc('canvas', col, x, z, r - 0.12);
}
const DISC = new THREE.CylinderGeometry(0.5, 0.5, 0.012, 28, 1);
/** Low-poly bulb / star (8 triangles) for the many small emissive dots. */
export const BULB = new THREE.OctahedronGeometry(0.5, 0);
/** A small emissive dot (bulb, star, gem) — 8 triangles. */
export function dot(K: RoomKit, x: number, y: number, z: number, r: number, col: string): void { K.geo('emit', BULB, M(x, y, z, r * 2, r * 2, r * 2), col); }

/** Brazier: iron bowl on legs with glowing coals, a flame glow and a warm light (prio). */
export function brazier(K: RoomKit, x: number, z: number, prio = 2): void {
  for (let i = 0; i < 3; i++) { const a = i * 2.094; K.rbox('metal', '#3a3440', x + Math.cos(a) * 0.18, 0.3, z + Math.sin(a) * 0.18, 0.04, 0.62, 0.04, -a, 0, 0.25); }
  K.cyl('metal', '#4a4458', x, 0.55, z, 0.3, 0.16, 12);
  for (let i = 0; i < 5; i++) K.ball('emit', i % 2 ? '#ffb347' : '#ff5a1a', x + Math.cos(i * 1.3) * 0.13, 0.72, z + Math.sin(i * 1.3) * 0.13, 0.08, 0.6);
  K.glow(x, 0.95, z, 1.4, '#ff9a4a', 0.9);
  K.light(x, 1.1, z, '#ff9a4a', 5, 7, 0, prio);
  K.splash(x, 0.02, z, 2.8, 2.8, '#ff8a3a', 0.3, 0, -Math.PI / 2);
  K.solid(x - 0.32, x + 0.32, z - 0.32, z + 0.32, Infinity, false);
}

/** Wall shelf (one plank on brackets) with jars, books or boxes, along a wall facing `ry` (π/2 = left wall, −π/2 = right). */
export function wallShelf(K: RoomKit, x: number, y: number, z: number, ry: number, w: number, kind: 'jars' | 'books' | 'boxes' = 'jars'): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  // along-wall axis = (c, −sn); out of the wall = (sn, c)
  const at = (u: number, o: number): [number, number] => [x + c * u + sn * o, z - sn * u + c * o];
  const [cx, cz] = at(0, 0.14);
  K.rbox('wood', K.pal.woodL, cx, y, cz, w, 0.04, 0.28, ry);
  for (const u of [-w / 2 + 0.12, w / 2 - 0.12]) { const [bx, bz] = at(u, 0.08); K.rbox('wood', K.pal.woodD, bx, y - 0.1, bz, 0.04, 0.18, 0.16, ry); }
  const n = Math.max(2, Math.floor(w / 0.22));
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + 0.14 + (w - 0.28) * i / (n - 1), [px, pz] = at(u, 0.14);
    if (kind === 'jars') { K.cyl('glass', '#e8f4ff', px, y + 0.02, pz, 0.06, 0.16, 8); K.cyl('back', ['#ff9fb2', '#9fe39a', '#ffe27a', '#7fd6e6'][i % 4], px, y + 0.02, pz, 0.05, 0.1, 8); }
    else if (kind === 'books') K.rbox('back', ['#a3122a', '#3a6aa8', '#5a9a4a', '#c9884a', '#6a4a9a'][i % 5], px, y + 0.13, pz, 0.07, 0.22 + (i % 3) * 0.03, 0.18, ry);
    else K.rbox('wood', ['#c9884a', '#a8754f', '#d9a066'][i % 3], px, y + 0.1, pz, 0.18, 0.16, 0.2, ry + (i % 2) * 0.2);
  }
}

/** Patterned rectangular rug: border, field, a row of diamonds and end fringes (reads as a woven carpet). */
export function patternRug(K: RoomKit, x0: number, x1: number, z0: number, z1: number, field: string, border: string, accent: string): void {
  // stacked floor decals (border → field → diamonds), never coplanar
  K.floorBox('canvas', border, x0, x1, z0, z1);
  K.floorBox('canvas', field, x0 + 0.14, x1 - 0.14, z0 + 0.14, z1 - 0.14);
  const long = (z1 - z0) >= (x1 - x0), L = long ? z1 - z0 : x1 - x0, n = Math.max(2, Math.round((L - 0.4) / 0.55));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, cx = long ? (x0 + x1) / 2 : x0 + 0.2 + (L - 0.4) * t, cz = long ? z0 + 0.2 + (L - 0.4) * t : (z0 + z1) / 2;
    K.floorRBox('canvas', i % 2 ? accent : border, cx, cz, 0.26, 0.26, Math.PI / 4);
  }
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    if (long) for (const z of [z0 - 0.06, z1]) K.floorBox('canvas', '#f2ead8', x0 + (x1 - x0) * t - 0.013, x0 + (x1 - x0) * t + 0.013, z, z + 0.06, 0.006);
    else for (const x of [x0 - 0.06, x1]) K.floorBox('canvas', '#f2ead8', x, x + 0.06, z0 + (z1 - z0) * t - 0.013, z0 + (z1 - z0) * t + 0.013, 0.006);
  }
}
