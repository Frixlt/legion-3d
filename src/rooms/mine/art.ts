/**
 * Mine art: palettes (port of craftworld.js LAYERS / BIO / ASH and mine-art.js ORE colours) and procedural, shared
 * geometries (rock lumps, crystals, nuggets, mushrooms, pickaxe). Everything is built once per page and cached —
 * scenes never dispose these (disposeMineArt() for tests/dev).
 */
import * as THREE from 'three';

/* ============================================================ palettes */

export interface MinePal {
  rock: [string, string, string]; hard: [string, string, string];
  floor: string; floorL: string; wall: string; wallL: string;
  moss?: boolean; glow?: string; lava?: string; deco?: string; pud?: string;
  /** Glowing mushrooms / spores colour of this nature. */
  mush: string;
  /** Fog / far darkness colour. */
  fog: string;
}
const LAYERS: (Omit<MinePal, 'mush' | 'fog'> & { from: number })[] = [
  { from: 1, rock: ['#a08a72', '#c0aa90', '#73624f'], hard: ['#7e7468', '#9c9284', '#57504a'], floor: '#5e4c40', floorL: '#725e4e', wall: '#3e3240', wallL: '#54465a', moss: true },
  { from: 10, rock: ['#8e8c94', '#b0aeb8', '#62606a'], hard: ['#666874', '#848694', '#45464f'], floor: '#4a4650', floorL: '#5c5864', wall: '#2e2c3a', wallL: '#44425a' },
  { from: 30, rock: ['#5e5a72', '#7c7894', '#3e3a50'], hard: ['#45425a', '#5e5a78', '#2c2a3c'], floor: '#34303e', floorL: '#46405a', wall: '#1e1a2a', wallL: '#322c46', glow: '#9a7aff' },
];
const ASH: Omit<MinePal, 'mush' | 'fog'> = { rock: ['#5c4c4a', '#7a6662', '#3e3232'], hard: ['#3a3338', '#524850', '#262126'], floor: '#2e2224', floorL: '#3e2e30', wall: '#1e1416', wallL: '#3a2224', lava: '#ff5a1a' };
const BIO: Record<string, Omit<MinePal, 'mush' | 'fog'>> = {
  forest: { rock: ['#7e7a5a', '#9e9a72', '#56523a'], hard: ['#5e6248', '#7a7e60', '#3e4230'], floor: '#3e3a28', floorL: '#56502e', wall: '#22301e', wallL: '#3a4e2a', moss: true, deco: 'moss' },
  taiga: { rock: ['#8a949a', '#aeb8be', '#5e686e'], hard: ['#68727a', '#86909a', '#454e56'], floor: '#3c4248', floorL: '#5a646c', wall: '#1e2a30', wallL: '#34464e', deco: 'snow' },
  ice: { rock: ['#9cc0d8', '#d6ecf8', '#6a90a8'], hard: ['#7aa0c0', '#b0d0e8', '#4a7090'], floor: '#3a5468', floorL: '#5a7a90', wall: '#1a2c3e', wallL: '#2e4a62', deco: 'snow' },
  meadow: { rock: ['#c8b890', '#e4d6b0', '#988a66'], hard: ['#a89a78', '#c4b896', '#7a6e54'], floor: '#6a5a40', floorL: '#7e6c4e', wall: '#4a3e2e', wallL: '#62543e', deco: 'grass' },
  swamp: { rock: ['#4e5a46', '#6a7860', '#323a2c'], hard: ['#3a4436', '#56624e', '#232a20'], floor: '#2a3024', floorL: '#3a4232', wall: '#161c14', wallL: '#28321e', moss: true, deco: 'moss', pud: '#3a5a4a' },
  blight: { rock: ['#4e3e5a', '#6e5a7e', '#2e2238'], hard: ['#3a2c46', '#54426a', '#1e1428'], floor: '#241a2c', floorL: '#342640', wall: '#140e1a', wallL: '#2a1c36', deco: 'spores' },
  coast: { rock: ['#7a8a90', '#9aaab0', '#525e64'], hard: ['#5e6e76', '#7a8c94', '#3c484e'], floor: '#5a5440', floorL: '#7a7258', wall: '#22343a', wallL: '#34505a', deco: 'shells', pud: '#4a8ab0' },
  desert: { rock: ['#d09a5a', '#e8b878', '#a06a3a'], hard: ['#b07a44', '#cc9660', '#7e5028'], floor: '#8a6038', floorL: '#a87a4a', wall: '#5a3a22', wallL: '#7a5232', deco: 'sand' },
  ruin: { rock: ['#9a948a', '#bab4aa', '#6a645a'], hard: ['#7a746a', '#968f84', '#4e4840'], floor: '#4a4640', floorL: '#5e5a52', wall: '#2a2824', wallL: '#3e3a34', deco: 'carved' },
};
const MUSH: Record<string, string> = { meadow: '#5ff0d8', forest: '#b8f060', taiga: '#8ad8ff', ice: '#a8e8ff', swamp: '#7af07a', blight: '#d07aff', coast: '#6ad0ff', desert: '#ffb84a', ruin: '#9ae0c8', ash: '#ff8a3a', mount: '#5ff0d8' };
/** Palette of a floor: by nature (biome) or by depth layer (craftworld layerOf). */
export function minePal(biome: string, n: number): MinePal {
  let L: Omit<MinePal, 'mush' | 'fog'>;
  if (biome === 'ash') L = ASH; else if (BIO[biome]) L = BIO[biome];
  else { L = LAYERS[0]; for (const l of LAYERS) if (n >= l.from) L = l; }
  // cool, deep fog: distance falls into blue-violet shadow (warm lanterns read against it)
  const fog = '#' + new THREE.Color(L.wall).multiplyScalar(0.45).lerp(new THREE.Color('#121830'), 0.45).getHexString();
  return { ...L, mush: L.glow || MUSH[biome] || MUSH.mount, fog };
}

/** Ore / gem colours [main, light, dark] (mine-art.js ORE). */
export const ORE: Record<string, [string, string, string]> = {
  coal: ['#2a2a34', '#5a5c72', '#121218'], iron: ['#c8643a', '#f0965e', '#7a3018'], copper: ['#e08a3e', '#ffc07a', '#8a4a1e'], silver: ['#dfe6f2', '#ffffff', '#8a94aa'],
  gold: ['#ffcf3a', '#fff0a0', '#c07a10'], crystal: ['#7fe8ff', '#e0fbff', '#2a9ac0'], sulfur: ['#f2e24a', '#fff8a8', '#a89418'], peat: ['#6a4a32', '#9a7050', '#3a2618'],
  bone_dust: ['#eee6cc', '#ffffff', '#a89a78'], salt: ['#f4f8ff', '#ffffff', '#a8b8d0'], relic: ['#e0b04a', '#fff0a0', '#8a6018'],
  adamant: ['#9fc0e8', '#f0f8ff', '#4a6a9a'], fire_opal: ['#ff6a2a', '#ffd08a', '#b02a10'], emerald: ['#2fd07a', '#b0ffd0', '#0e7a40'], amber: ['#ffa52a', '#ffe0a0', '#b0600a'],
  sapphire: ['#3a7aff', '#b0d0ff', '#1a3aa8'], topaz: ['#ffc23a', '#fff0b0', '#c07a0a'], malachite: ['#1fa07a', '#7ae0b0', '#0a5a40'], morion: ['#6a3a8a', '#c8a0e8', '#2a1440'],
  aquamarine: ['#6fe8e8', '#e0ffff', '#2a9aa8'], ruby: ['#ff2a4a', '#ffb0b8', '#a00a24'], runestone: ['#a87aff', '#e8d8ff', '#5a3aa8'],
};
/** Rock colour of the stone's own rock kind (cell.r for plain rock: limestone, basalt, …). */
export const ROCK: Record<string, string> = { stone: '#9a8e80', basalt: '#4a4248', frost_stone: '#bcd8ea', limestone: '#e4d6b0', sandstone: '#e0a868', rubble: '#b0a090' };
/** Crystal-like resources (sharp prisms that glow) vs nuggets (lumps). */
export const CRYSTAL = new Set(['crystal', 'adamant', 'fire_opal', 'emerald', 'amber', 'sapphire', 'topaz', 'malachite', 'morion', 'aquamarine', 'ruby', 'runestone', 'salt']);
export const oreCol = (r: string) => (ORE[r] || ['#ffcf3a', '#ffffff', '#6a5a40']);

/* ============================================================ geometries */

const hash3 = (x: number, y: number, z: number, s: number) => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + s * 4.581) * 43758.5453;
  return h - Math.floor(h);
};
/** Smooth-ish value noise on the unit sphere direction (deterministic). */
function bumpy(d: THREE.Vector3, seed: number, amp: number, freq: number): number {
  let v = 0;
  for (let o = 0; o < 3; o++) {
    const f = freq * (1 << o), a = amp / (1 << o);
    v += a * Math.sin(d.x * f * 1.7 + seed * 1.3 + o) * Math.sin(d.y * f * 1.3 + seed * 0.7 + o * 2.1) * Math.sin(d.z * f * 1.9 + seed * 2.9 + o * 0.5);
  }
  return v;
}

export interface RockGeo { geo: THREE.BufferGeometry; tops: { p: THREE.Vector3; n: THREE.Vector3 }[] }
const cache = new Map<string, unknown>();
function memo<T>(k: string, f: () => T): T { if (!cache.has(k)) cache.set(k, f()); return cache.get(k) as T; }

/**
 * Rock lump, unit size: footprint radius ≈ 1, height ≈ 1 (bottom flat at y = 0). Flat-shaded facets, vertex colours
 * are a grey ramp (top light, bottom dark, per-face jitter) that multiplies the instance colour.
 * kind: 'round' (boulder), 'slab' (faceted block), 'hard' (angular with ridges), 'pillar' (wall rock).
 */
export function rockGeo(kind: 'round' | 'slab' | 'hard' | 'pillar', variant: number): RockGeo {
  return memo(`rock:${kind}:${variant}`, () => {
    const detail = kind === 'hard' || kind === 'slab' ? 1 : 2;
    const g0 = new THREE.IcosahedronGeometry(1, detail);
    const pos = g0.attributes.position as THREE.BufferAttribute;
    const d = new THREE.Vector3(), seed = variant * 7.3 + (kind === 'hard' ? 31 : kind === 'slab' ? 17 : kind === 'pillar' ? 53 : 3);
    const amp = kind === 'hard' ? 0.22 : kind === 'slab' ? 0.16 : kind === 'pillar' ? 0.2 : 0.13;
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      let r = 1 + bumpy(d, seed, amp, kind === 'hard' ? 2.2 : 1.6);
      if (kind === 'slab') r *= 1 + 0.18 * Math.max(-0.5, Math.min(0.5, Math.round(d.x * 2) / 2 * 0.3 + Math.round(d.z * 2) / 2 * 0.2));
      let x = d.x * r, y = d.y * r, z = d.z * r;
      if (kind === 'slab' && y > 0.45) y = 0.45 + (y - 0.45) * 0.35;   // flat-ish top facet
      y = Math.max(y, -0.25);
      pos.setXYZ(i, x, y + 0.25, z);
    }
    // normalise: footprint radius 1, height 1
    g0.computeBoundingBox();
    const bb = g0.boundingBox!, sy = 1 / (bb.max.y - bb.min.y), sxz = 1 / Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
    g0.scale(sxz, sy, sxz); g0.translate(0, -bb.min.y * sy, 0);
    const g = g0.toNonIndexed(); g0.dispose();
    g.computeVertexNormals();
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const tops: RockGeo['tops'] = [];
    for (let f = 0; f < p.count; f += 3) {
      const cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
      const j = 0.86 + hash3(p.getX(f), p.getY(f), p.getZ(f), seed) * 0.2;
      const up = n.getY(f);
      // strata: tilted bands of lighter / darker rock + a few dark crack facets — detail at no extra geometry
      const fx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, fz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
      const band = Math.sin((cy + fx * 0.22 - fz * 0.12) * (kind === 'hard' ? 15 : 11) + seed);
      const crack = hash3(fx * 3.1, cy * 2.7, fz * 3.3, seed + 9) > 0.93 && up < 0.6 ? 0.62 : 1;
      const v = Math.min(1.2, (0.6 + cy * 0.44 + Math.max(0, up) * 0.16) * j * (1 + band * 0.07) * crack);
      const warm = 1 + band * 0.025;
      for (let k = 0; k < 3; k++) { col[(f + k) * 3] = v * warm; col[(f + k) * 3 + 1] = v; col[(f + k) * 3 + 2] = v * (1.03 - band * 0.02); }
      if (cy > 0.3 && up > -0.1 && tops.length < 400) tops.push({ p: new THREE.Vector3((p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, cy, (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3), n: new THREE.Vector3(n.getX(f), n.getY(f), n.getZ(f)) });
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return { geo: g, tops };
  });
}

/** Crystal prism: base at y = 0, tip at y = 1, radius ~0.22. */
export function crystalGeo(): THREE.BufferGeometry {
  return memo('crystal', () => {
    const a = new THREE.CylinderGeometry(0.2, 0.24, 0.62, 6, 1).translate(0, 0.31, 0);
    const b = new THREE.ConeGeometry(0.2, 0.38, 6, 1).translate(0, 0.81, 0);
    const g = mergeSimple([a, b]); a.dispose(); b.dispose();
    return flat(g);
  });
}
/** Ore nugget (lumpy dodecahedron), radius ~0.5. */
export function nuggetGeo(): THREE.BufferGeometry {
  return memo('nugget', () => {
    const g = new THREE.DodecahedronGeometry(0.5, 0); const p = g.attributes.position as THREE.BufferAttribute; const d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { d.fromBufferAttribute(p, i); const s = 0.85 + hash3(Math.round(d.x * 9), Math.round(d.y * 9), Math.round(d.z * 9), 5) * 0.3; p.setXYZ(i, d.x * s, d.y * s * 0.8, d.z * s); }
    return flat(g);
  });
}
/** Glowing mushroom: stem (y 0…0.6) + cap. Two geometries (stem lit, cap glowing). */
export function mushroomGeos(): { stem: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  return memo('mush', () => {
    const stem = new THREE.CylinderGeometry(0.07, 0.1, 0.6, 7).translate(0, 0.3, 0);
    const cap = new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.56, 0);
    return { stem, cap };
  });
}
/**
 * Pickaxe in hand space (same convention as src/avatar weapons): grip at the origin near the end of the handle,
 * handle along +Y, the head at the top lying IN THE SWING PLANE (Y-Z): the long striking point towards −Z (forward,
 * the side that leads when the tool is swung down), a shorter point towards +Z. ~0.62 m long.
 */
export function pickaxeGeo(): { wood: THREE.BufferGeometry; iron: THREE.BufferGeometry } {
  return memo('pick', () => {
    const wood = new THREE.CylinderGeometry(0.026, 0.032, 0.62, 7).translate(0, 0.25, 0);
    // cones point along +Y; rotateX(−π/2) turns the tip to −Z, rotateX(π/2) to +Z; tips droop slightly towards the grip
    const blade = new THREE.ConeGeometry(0.05, 0.34, 6).rotateX(-Math.PI / 2).rotateX(0.12).translate(0, 0.52, -0.18);
    const blade2 = new THREE.ConeGeometry(0.045, 0.24, 6).rotateX(Math.PI / 2).rotateX(-0.12).translate(0, 0.52, 0.13);
    const hub = new THREE.BoxGeometry(0.09, 0.1, 0.09).translate(0, 0.53, 0);
    const iron = mergeSimple([blade, blade2, hub]); blade.dispose(); blade2.dispose(); hub.dispose();
    return { wood, iron: flat(iron) };
  });
}

function flat(g: THREE.BufferGeometry): THREE.BufferGeometry { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); n.computeVertexNormals(); return n; }
/** Merge geometries that share attributes position/normal (+uv dropped). */
export function mergeSimple(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, o); o += g.attributes.position.count * 3; }
  for (let i = 0; i < parts.length; i++) if (parts[i] !== gs[i]) parts[i].dispose();
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals();
  return out;
}

/** Canvas badge «level in a circle» (yellow = can be dug, grey = not yet). Cached per (lv, on). */
export function badgeTexture(lv: number, on: boolean): THREE.CanvasTexture {
  return memo(`badge:${lv}:${on ? 1 : 0}`, () => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d')!;
    x.beginPath(); x.arc(32, 32, 27, 0, Math.PI * 2);
    x.fillStyle = on ? '#ffd23f' : '#8a8494'; x.fill();
    x.lineWidth = 6; x.strokeStyle = '#15122e'; x.stroke();
    x.fillStyle = '#15122e'; x.font = 'bold 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(lv), 32, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
    return t;
  });
}

export function disposeMineArt(): void {
  for (const v of cache.values()) {
    const o = v as any;
    if (o && o.geo && o.geo.dispose) o.geo.dispose();
    else if (o && o.dispose) o.dispose();
    else if (o && typeof o === 'object') for (const g of Object.values(o)) (g as any)?.dispose?.();
  }
  cache.clear();
}
