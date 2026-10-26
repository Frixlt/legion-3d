/**
 * 3D item models for shop shelves, loot and tooltips: `registerItemModels(reg)` fills the game's item-model registry.
 *
 * Keys: 'weapon:<kind>', 'shield:<kind>', 'armor:<kind>', 'hat:<id>', 'charm:<id>' (class charms and aura amulets),
 * 'slot:<slot>' (generic per-slot model: food by id hints, potion coloured by effect, scroll, material, relic…),
 * 'food:<site food id>', and '*' (a gift box). The full list is SUPPORTED_ITEM_MODEL_KEYS (supported.ts).
 *
 * Model convention (matches the shop shelves in src/rooms): pivot at the bottom centre (y = 0), the FRONT faces +Z
 * (towards a viewer standing in front), size ≈ a display size per kind (weapons ~0.55 m, charms ~0.2 m) — callers
 * usually re-fit anyway. Every call returns a fresh Group sharing cached geometry + materials (never dispose them):
 *   group
 *   ├─ 'item-model'    Mesh (toon, vertex colours)
 *   ├─ 'item-outline'  Mesh (inverted hull, BackSide)
 *   └─ 'rarity-ring'   optional glow ring (pass `{ ring: true }` in look/opts or call addRarityRing)
 * userData: { itemKey, size: [x, y, z] }. Each model ≤ ~1.5k triangles.
 */
import * as THREE from 'three';
import type { Item, Unsub } from '../contracts';
import type { ItemModelFactory, Registry } from '../contracts/ext';
import { Parts, T, sphere, cyl, cone, box, torus, star, slab, tube, capsule, bodyDims, bodyShell, radiusAt, setDetail, col, INK } from './geom';
import { addWeapon, addShield } from './gear';
import { addHat } from './hats';
import { addArmor } from './armor';
import { CATALOG, RARITY_COLOR } from './appearance';
import { toonMat, outlineMat, glowMat, glowSolidMat } from './materials';
import { ITEM_HATS, ITEM_CHARMS, ITEM_SLOTS, ITEM_FOODS, SUPPORTED_ITEM_MODEL_KEYS } from './supported';

export { SUPPORTED_ITEM_MODEL_KEYS };

type Look = Record<string, unknown>;
interface Opts { rarity: string; slot: string; id?: string; ring?: boolean }

const WOOD = '#8a5a2b', DWOOD = '#5a3a1c', GOLD = '#e8b923', PAPER = '#f3e2b8', GLASS = '#d8ecff';
/** Display size (largest side, m) per family. */
const SIZE: Record<string, number> = { weapon: 0.55, shield: 0.42, armor: 0.62, hat: 0.34, charm: 0.2, food: 0.18, potion: 0.2, scroll: 0.22, material: 0.18, relic: 0.24, gift: 0.24 };

/* ------------------------------------------------------------------ cache + wrapping */

interface Built { geo: THREE.BufferGeometry; size: [number, number, number] }
const cache = new Map<string, Built>();

/**
 * Build (once) the geometry for `ck`: parts are made in avatar convention (front −Z) at detail 0.6, then turned to
 * face +Z, scaled so the largest side = `size` and moved so the bottom centre is the origin.
 */
function cached(ck: string, size: number, make: (p: Parts) => void): Built {
  let b = cache.get(ck);
  if (b) return b;
  const p = new Parts();
  setDetail(0.6);
  try { make(p); } finally { setDetail(1); }
  const geo = p.build(false);
  geo.rotateY(Math.PI);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!, sz = new THREE.Vector3(), c = new THREE.Vector3();
  bb.getSize(sz); bb.getCenter(c);
  const k = size / Math.max(1e-4, sz.x, sz.y, sz.z);
  geo.translate(-c.x, -bb.min.y, -c.z);
  geo.scale(k, k, k);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  b = { geo, size: [sz.x * k, sz.y * k, sz.z * k] };
  cache.set(ck, b);
  return b;
}

function wrap(key: string, b: Built, o: Opts, look: Look): THREE.Group {
  const g = new THREE.Group();
  g.name = 'item:' + key;
  const m = new THREE.Mesh(b.geo, toonMat('n'));
  m.name = 'item-model'; m.castShadow = true;
  const ol = new THREE.Mesh(b.geo, outlineMat('n', 8, 0.006));
  ol.name = 'item-outline';
  g.add(m, ol);
  g.userData.itemKey = key; g.userData.size = b.size;
  if (o.ring || look.ring === true) addRarityRing(g, o.rarity);
  return g;
}

const ringGeo = new THREE.TorusGeometry(1, 0.035, 6, 32).rotateX(Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
/** Glow ring + soft disc under an item model in its rarity colour (nothing for 'common'). Returns the ring group. */
export function addRarityRing(obj: THREE.Object3D, rarity: string): THREE.Object3D | null {
  if (!rarity || rarity === 'common' || !RARITY_COLOR[rarity]) return null;
  const size = (obj.userData.size as number[] | undefined) || [0.2, 0.2, 0.2];
  const r = Math.max(0.08, Math.max(size[0], size[2]) * 0.6);
  const g = new THREE.Group(); g.name = 'rarity-ring';
  const ring = new THREE.Mesh(ringGeo, glowSolidMat(RARITY_COLOR[rarity]));
  ring.scale.set(r, r * 0.6, r); ring.position.y = 0.006;
  const disc = new THREE.Mesh(discGeo, glowMat(RARITY_COLOR[rarity], 0.55));
  disc.scale.setScalar(r * 1.35); disc.position.y = 0.003; disc.renderOrder = -1;
  g.add(disc, ring);
  obj.add(g);
  return g;
}

/* ------------------------------------------------------------------ gear */

function weaponFactory(kind: string): ItemModelFactory {
  return (_look, o) => {
    const r = o.rarity || 'common', key = 'weapon:' + kind;
    return wrap(key, cached(key + '|' + r, SIZE.weapon * (kind === 'dagger' || kind === 'kris' ? 0.7 : kind === 'grimoire' ? 0.55 : 1), (p) => {
      // bow: turn so its curve is seen from the front; everything else stands blade / head up
      addWeapon(p, kind, r, kind === 'bow' ? T(0, 0, 0, 0, Math.PI / 2, 0) : kind === 'grimoire' ? T(0, 0, 0, 0.12, 0, 0) : T(0, 0, 0));
      if (kind === 'censer') {   // it hangs on its chain from a little wooden gallows
        p.add(cyl(0.012, 0.012, 0.34, 6), DWOOD, T(-0.13, -0.15, 0));
        p.add(cyl(0.01, 0.01, 0.14, 6), DWOOD, T(-0.065, 0.012, 0, 0, 0, Math.PI / 2));
        p.add(cyl(0.06, 0.07, 0.025, 12), WOOD, T(-0.13, -0.32, 0));
      }
    }), o, (_look || {}) as Look);
  };
}

function shieldFactory(kind: string): ItemModelFactory {
  return (look, o) => {
    const r = o.rarity || 'common', key = 'shield:' + kind;
    return wrap(key, cached(key + '|' + r, SIZE.shield, (p) => {
      addShield(p, kind, r, T(0, 0, 0, -0.12, 0, 0));
      // a small wooden prop behind it so it stands on a shelf
      p.add(box(0.03, 0.2, 0.03), DWOOD, T(0, -0.08, 0.1, -0.5, 0, 0));
    }), o, (look || {}) as Look);
  };
}

/** Armour on a little wooden cat mannequin on a stand: the same shell heroes wear. */
function armorFactory(kind: string): ItemModelFactory {
  return (look, o) => {
    const r = o.rarity || 'common', L = (look || {}) as Look, am = String(L.gear || L.am || (kind === 'lorica' ? 'heavy' : ''));
    const key = 'armor:' + kind;
    return wrap(key, cached(`${key}|${r}|${am}`, SIZE.armor, (p) => {
      const d = bodyDims('bean', 0.5);
      const mann = col('#d9b48a'), neckY = d.mouthY - 0.105;
      // stand: base + pole up into the body
      p.add(cyl(0.16, 0.19, 0.05, 16), WOOD, T(0, -0.25, 0));
      p.add(cyl(0.022, 0.022, 0.3, 8), DWOOD, T(0, -0.1, 0));
      p.add(bodyShell(d, { yA: d.y0, yB: d.top, segs: 18, rings: 12, color: (_t, _y, _tt, out) => { out.copy(mann); } }));
      p.add(new THREE.CircleGeometry(radiusAt(d, d.y0 + 0.004), 14), mann, T(0, d.y0 + 0.001, 0, Math.PI / 2, 0, 0, [1, d.depth, 1]));
      // wooden cat ears (it is a cat-legion shop)
      for (const s of [-1, 1]) p.add(cone(0.08, 0.16, 4), mann, T(s * radiusAt(d, d.top - 0.05) * 0.66, d.top + 0.02, 0, 0, Math.PI / 4, s * -0.3, [1, 1, 0.5]));
      // stitched button eyes, so the front reads as the front
      for (const s of [-1, 1]) p.add(cyl(0.022, 0.022, 0.012, 10), '#5a3a1c', T(s * 0.11, d.eyeY, -radiusAt(d, d.eyeY) * d.depth * Math.sqrt(1 - (0.11 / radiusAt(d, d.eyeY)) ** 2) - 0.002, Math.PI / 2, 0, 0));
      addArmor(p, d, kind, r, am, { yB: neckY, sx: radiusAt(d, d.armY) * 0.97, segs: 20, rings: 10 });
    }), o, L);
  };
}

/** Hat on a little head form (the top of a ball-shaped body) on a stand. */
function hatFactory(id: string): ItemModelFactory {
  return (look, o) => {
    const r = o.rarity || 'common', key = 'hat:' + id;
    return wrap(key, cached(key + '|' + r, SIZE.hat, (p) => {
      const d = bodyDims('ball', 0.5);
      const yA = d.eyeY - 0.1, form = col('#e8d8c0');
      p.add(bodyShell(d, { yA, yB: d.top, segs: 18, rings: 8, color: (_t, _y, _tt, out) => { out.copy(form); } }));
      p.add(new THREE.CircleGeometry(radiusAt(d, yA), 16), form, T(0, yA, 0, Math.PI / 2, 0, 0, [1, d.depth, 1]));
      p.add(cyl(0.04, 0.05, 0.14, 8), DWOOD, T(0, yA - 0.07, 0));
      p.add(cyl(0.13, 0.15, 0.035, 14), WOOD, T(0, yA - 0.155, 0));
      addHat(p, id, { d, c1: '#ff9fb2', c2: '#4ab0ff', rar: r, style: 'cats' });
    }), o, (look || {}) as Look);
  };
}

/* ------------------------------------------------------------------ charms */

const AURA: Record<string, [string, string]> = { sparks: ['#ffe27a', '#ff9f3d'], frost: ['#bff1ff', '#4ab0ff'], shadow: ['#b06bff', '#3a1a6a'], gold: ['#ffe08a', '#e8a32a'], halo: ['#fff6c8', '#ffd76a'], plain: ['#ffd76a', '#d9a441'] };
const BONE = '#ebe2c9';

function charmFactory(id: string): ItemModelFactory {
  return (look, o) => {
    const r = o.rarity || 'common', key = 'charm:' + id;
    return wrap(key, cached(key + '|' + r, SIZE.charm, (p) => {
      // cord loop on top, pendant hanging below; the rarity ring of the site's icon as a thin hoop
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) { const a = Math.PI * (0.2 + 0.6 * (i / 10)); pts.push([Math.cos(a) * 0.055, 0.03 + Math.sin(a) * 0.07, 0]); }
      p.add(tube(pts, 0.005, 14, 5), '#c9a35a');
      const rc = r !== 'common' ? RARITY_COLOR[r] : null;
      if (rc) p.add(torus(0.062, 0.005, 4, 24), rc, T(0, 0, 0.014));
      pendant(p, id);
    }), o, (look || {}) as Look);
  };
}

function pendant(p: Parts, id: string) {
  switch (id) {
    case 'lockpick':
      p.add(torus(0.025, 0.009, 6, 16), '#c9cfd6', T(0, 0.02, 0));
      p.add(cyl(0.008, 0.008, 0.075, 6), '#c9cfd6', T(-0.004, -0.03, 0));
      for (const y of [-0.06, -0.042]) p.add(box(0.02, 0.009, 0.008), '#c9cfd6', T(0.006, y, 0));
      p.add(cyl(0.006, 0.006, 0.07, 6), '#aab2b8', T(0.018, -0.022, 0.006, 0, 0, -0.35));
      break;
    case 'vial':
      p.add(new THREE.LatheGeometry([[0, -0.05], [0.03, -0.05], [0.034, -0.02], [0.012, 0.01], [0.012, 0.03], [0, 0.03]].map(([x, y]) => new THREE.Vector2(x, y)), 10), '#d8f2e2');
      p.add(cyl(0.028, 0.031, 0.025, 10), '#5fd35a', T(0, -0.037, 0));
      p.add(cyl(0.014, 0.014, 0.015, 8), '#8a5a2b', T(0, 0.036, 0));
      break;
    case 'cateye':
      p.add(sphere(0.04, 14, 10), '#d6e84a', T(0, 0, 0, 0, 0, 0, [1, 0.8, 0.45]));
      p.add(sphere(0.012, 8, 6), '#1a1410', T(0, 0, -0.016, 0, 0, 0, [0.6, 2.4, 0.4]));
      p.add(sphere(0.007, 6, 4), '#ffffff', T(-0.014, 0.012, -0.017));
      break;
    case 'bone':
      p.add(cyl(0.011, 0.011, 0.07, 6), BONE, T(0, 0, 0));
      for (const y of [-0.035, 0.035]) for (const x of [-0.011, 0.011]) p.add(sphere(0.014, 8, 6), BONE, T(x, y, 0));
      break;
    case 'souljar':
      p.add(cyl(0.032, 0.032, 0.07, 12), '#cfefff', T(0, -0.01, 0));
      p.add(cyl(0.022, 0.022, 0.018, 10), '#8a5a2b', T(0, 0.033, 0));
      p.add(sphere(0.016, 8, 6), '#7fe8ff', T(0, -0.008, 0));
      break;
    case 'phylactery':
      p.add(box(0.07, 0.065, 0.03), '#3a2450', T(0, 0, 0));
      p.add(box(0.074, 0.008, 0.034), '#d9b45a', T(0, 0.004, 0));
      p.add(sphere(0.016, 8, 6), '#b06bff', T(0, -0.006, -0.016));
      break;
    case 'ladanka':
      p.add(slab([[-0.032, 0.035], [0.032, 0.035], [0.032, 0.005], [0, -0.045], [-0.032, 0.005]], 0.014), '#efe4c8');
      p.add(box(0.008, 0.05, 0.004), '#d9a441', T(0, 0.004, -0.009));
      p.add(box(0.036, 0.008, 0.004), '#d9a441', T(0, 0.012, -0.009));
      break;
    case 'sun': case 'dawn': {
      const n = id === 'sun' ? 8 : 16;
      p.add(sphere(0.026, 12, 8), id === 'sun' ? '#ffcf4d' : '#ffffff', T(0, 0, 0, 0, 0, 0, [1, 1, 0.5]));
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, l = i % 2 || id === 'sun' ? 0.022 : 0.032; p.add(cone(0.009, l, 4), '#ffcf4d', T(Math.cos(a) * (0.026 + l / 2), Math.sin(a) * (0.026 + l / 2), 0, 0, 0, a - Math.PI / 2, [1, 1, 0.5])); }
      break;
    }
    default: {   // aura amulet: faceted gem in the aura colours (+ a halo ring for 'halo')
      const [c1, c2] = AURA[id] || AURA.plain;
      p.add(new THREE.OctahedronGeometry(0.04, 0), c1, T(0, -0.005, 0, 0, Math.PI / 4, 0, [0.9, 1.25, 0.55]));
      p.add(new THREE.OctahedronGeometry(0.026, 0), c2, T(0, -0.02, 0.004, 0, Math.PI / 4, 0, [0.9, 1.1, 0.5]));
      p.add(torus(0.014, 0.004, 4, 10), GOLD, T(0, 0.045, 0));
      if (id === 'halo') p.add(torus(0.05, 0.006, 4, 22), '#ffd76a', T(0, 0.075, 0, Math.PI / 2 - 0.25));
    }
  }
}

/* ------------------------------------------------------------------ consumables */

const FOOD_HINTS: [RegExp, string][] = [
  [/fish|рыб|кильк|лосос|salmon|sprat|карас/i, 'fish'], [/apple|яблок/i, 'apple'], [/pear|груш/i, 'pear'],
  [/ham|roast|meat|мяс|окорок|ветчин|жарк|колбас|sausage/i, 'meat'], [/cheese|сыр/i, 'cheese'], [/pie|пирог/i, 'pie'],
  [/bread|хлеб|батон/i, 'bread'], [/pretzel|крендел/i, 'pretzel'], [/kvass|квас|mug|кружк|beer|пиво|сидр/i, 'mug'],
  [/tea|чай|cup|чаш/i, 'cup'], [/stew|уха|суп|рагу|bowl|миск|каш/i, 'bowl'], [/cake|торт|пирожн|honey|мёд|мед/i, 'cake'],
  [/milk|молок|сметан/i, 'milk'],
];
/** Food model id from the site id / name ('bread' when nothing matches). */
export function foodKind(id = '', name = ''): string {
  const s = id + ' ' + name;
  for (const [re, k] of FOOD_HINTS) if (re.test(s)) return k;
  return 'bread';
}

function addFood(p: Parts, kind: string) {
  const plate = () => p.add(cyl(0.13, 0.11, 0.018, 18), '#f2ead8', T(0, 0.009, 0));
  const fish = (x: number, y: number, z: number, k: number, c: string, ry = 0) => {
    p.add(sphere(0.1 * k, 12, 8), c, T(x, y, z, 0, ry, 0, [1, 0.5, 0.36]));
    p.add(cone(0.05 * k, 0.07 * k, 4), c, T(x + Math.cos(ry) * 0.12 * k, y, z - Math.sin(ry) * 0.12 * k, 0, ry, -Math.PI / 2, [1, 1, 0.3]));
    p.add(sphere(0.013 * k, 6, 4), INK, T(x - Math.cos(ry) * 0.065 * k, y + 0.014 * k, z + Math.sin(ry) * 0.065 * k - 0.03 * k));
    p.add(cone(0.03 * k, 0.04 * k, 3), new THREE.Color(c).multiplyScalar(0.8), T(x, y + 0.05 * k, z, 0, ry, 0, [1, 1, 0.3]));
  };
  switch (kind) {
    case 'fish': plate(); fish(0, 0.05, 0, 1, '#8fb6c8', 0.2); fish(0.02, 0.085, 0.02, 0.8, '#9fc6d8', -0.3); break;
    case 'apple': case 'pear': {
      const c = kind === 'pear' ? '#9fe39a' : '#e8455c';
      p.add(sphere(0.07, 14, 10), c, T(0, 0.07, 0, 0, 0, 0, kind === 'pear' ? [0.85, 1.15, 0.85] : [1, 0.92, 1]));
      p.add(cyl(0.005, 0.006, 0.035, 5), '#6b4423', T(0.005, 0.15, 0, 0, 0, -0.25));
      p.add(sphere(0.022, 8, 6), '#6fbf4a', T(0.028, 0.155, 0, 0, 0, -0.6, [1, 0.35, 0.6]));
      break;
    }
    case 'meat':
      p.add(sphere(0.09, 14, 10), '#c0604a', T(-0.02, 0.07, 0, 0, 0, 0.3, [1.15, 0.8, 0.85]));
      p.add(sphere(0.07, 12, 8), '#e88a7a', T(-0.05, 0.075, -0.03, 0, 0, 0.3, [0.9, 0.7, 0.4]));
      p.add(cyl(0.014, 0.014, 0.12, 6), '#f5f2ff', T(0.09, 0.11, 0, 0, 0, -1.0));
      for (const s of [-1, 1]) p.add(sphere(0.02, 6, 4), '#f5f2ff', T(0.14 + s * 0.008, 0.145 + s * 0.012, 0));
      break;
    case 'cheese':
      p.add(slab([[0, 0], [0.22, 0], [0, 0.13]], 0.12), '#ffd34d', T(-0.08, 0, 0.06, -Math.PI / 2, 0, 0));
      for (const [x, z] of [[-0.03, 0.02], [0.03, -0.01], [-0.05, -0.03]]) p.add(sphere(0.016, 6, 4), '#e8b923', T(x, 0.06, z));
      break;
    case 'pie':
      p.add(cyl(0.12, 0.1, 0.05, 18), '#d9993f', T(0, 0.025, 0));
      p.add(sphere(0.115, 18, 6), '#e8455c', T(0, 0.05, 0, 0, 0, 0, [1, 0.28, 1]));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI; p.add(box(0.22, 0.012, 0.014), '#e8b070', T(0, 0.075, 0, 0, a, 0)); }
      break;
    case 'pretzel':
      p.add(torus(0.05, 0.018, 6, 18), '#b5762f', T(-0.035, 0.07, 0, 0, 0, 0, [1, 1, 0.8]));
      p.add(torus(0.05, 0.018, 6, 18), '#b5762f', T(0.035, 0.07, 0, 0, 0, 0, [1, 1, 0.8]));
      p.add(cyl(0.016, 0.016, 0.1, 6), '#b5762f', T(0, 0.04, 0, 0, 0, Math.PI / 2));
      break;
    case 'mug':
      p.add(cyl(0.065, 0.06, 0.15, 14), '#c58a45', T(0, 0.075, 0));
      p.add(cyl(0.06, 0.06, 0.03, 14), '#fff3d6', T(0, 0.15, 0));
      p.add(torus(0.04, 0.012, 6, 12, Math.PI), '#c58a45', T(0.065, 0.075, 0, 0, 0, -Math.PI / 2));
      for (const y of [0.03, 0.12]) p.add(torus(0.066, 0.006, 4, 16), '#6a4421', T(0, y, 0, Math.PI / 2));
      break;
    case 'cup': case 'milk':
      p.add(cyl(0.065, 0.045, 0.1, 14), kind === 'milk' ? '#f2ead8' : '#9fe39a', T(0, 0.05, 0));
      p.add(cyl(0.06, 0.06, 0.008, 14), kind === 'milk' ? '#fff8ee' : '#c58a45', T(0, 0.095, 0));
      p.add(torus(0.03, 0.009, 5, 12, Math.PI), kind === 'milk' ? '#f2ead8' : '#9fe39a', T(0.06, 0.05, 0, 0, 0, -Math.PI / 2));
      break;
    case 'bowl':
      p.add(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#a0703a', T(0, 0.1, 0, 0, 0, 0, [1, 0.8, 1]));
      p.add(cyl(0.1, 0.1, 0.01, 16), '#e8455c', T(0, 0.085, 0));
      fish(0, 0.1, 0, 0.35, '#ff9a6a');
      p.add(cyl(0.05, 0.05, 0.015, 12), '#8a5a2b', T(0, 0.0075, 0));
      break;
    case 'cake':
      p.add(cyl(0.1, 0.1, 0.09, 16), '#ffd38a', T(0, 0.045, 0));
      p.add(cyl(0.104, 0.104, 0.025, 16), '#ff9fb2', T(0, 0.09, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.add(sphere(0.016, 6, 4), '#ff9fb2', T(Math.cos(a) * 0.1, 0.075, Math.sin(a) * 0.1)); }
      p.add(sphere(0.022, 8, 6), '#e8455c', T(0, 0.115, 0));
      break;
    case 'bread': default:
      p.add(capsule(0.05, 0.14, 4, 12), '#d9993f', T(0, 0.05, 0, 0, 0, Math.PI / 2, [1, 1, 0.85]));
      for (const x of [-0.05, 0, 0.05]) p.add(box(0.012, 0.01, 0.06), '#8a5a2b', T(x, 0.095, 0, 0, 0.5, 0));
  }
}

function foodFactory(fixed?: string): ItemModelFactory {
  return (look, o) => {
    const L = (look || {}) as Look, kind = fixed || foodKind(o.id || '', String(L.name || ''));
    const key = fixed ? 'food:' + (o.id || fixed) : 'slot:food';
    return wrap(key, cached('food|' + kind, SIZE.food, (p) => addFood(p, kind)), o, L);
  };
}

/** Potion colour from its effect object (keys) or id hints. */
export function potionColor(effect: unknown, id = ''): { liquid: string; big: boolean } {
  const e = (effect && typeof effect === 'object' ? effect : {}) as Record<string, unknown>;
  const has = (k: string) => k in e || new RegExp(k, 'i').test(id);
  const heal = +(e.heal as number) || 0;
  const big = heal >= 20 || /big|large|great|больш/i.test(id);
  const liquid = has('revive') ? '#ffe27a' : has('mana') || has('mag') ? '#4a8cff' : has('atk') || has('str') || has('rage') ? '#ff8a2a'
    : has('def') || has('armor') ? '#5ec46a' : has('xp') || has('exp') ? '#ffd23f' : has('luck') ? '#7fe0b0' : has('speed') || has('haste') ? '#7fd6ff'
      : has('poison') || has('tox') ? '#9acd32' : big ? '#e8455c' : '#ff8aa0';
  return { liquid, big };
}

const potionFactory: ItemModelFactory = (look, o) => {
  const L = (look || {}) as Look, { liquid, big } = potionColor(L.effect, o.id || '');
  return wrap('slot:potion', cached(`potion|${liquid}|${big}`, SIZE.potion * (big ? 1.15 : 1), (p) => {
    const pts: [number, number][] = big ? [[0, 0], [0.07, 0], [0.085, 0.03], [0.085, 0.1], [0.06, 0.15], [0.025, 0.17], [0.025, 0.22], [0.032, 0.225], [0, 0.225]]
      : [[0, 0], [0.05, 0], [0.065, 0.02], [0.07, 0.06], [0.06, 0.1], [0.022, 0.125], [0.022, 0.165], [0.028, 0.17], [0, 0.17]];
    p.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 14), GLASS);
    // the liquid is a slightly larger inner lathe at the bottom (shows through as the bottle's colour)
    const lp: [number, number][] = big ? [[0, 0.004], [0.072, 0.004], [0.088, 0.032], [0.088, 0.095], [0, 0.095]] : [[0, 0.004], [0.052, 0.004], [0.068, 0.022], [0.073, 0.06], [0, 0.06]];
    p.add(new THREE.LatheGeometry(lp.map(([x, y]) => new THREE.Vector2(x, y)), 14), liquid);
    p.add(cyl(0.02, 0.024, 0.04, 8), '#b08a5a', T(0, big ? 0.235 : 0.18, 0));
    p.add(box(big ? 0.08 : 0.06, 0.04, 0.006), PAPER, T(0, big ? 0.13 : 0.085, big ? -0.074 : -0.069, 0, 0, 0));
    p.add(sphere(0.06, 10, 6), '#ffffff', T(-0.035, big ? 0.07 : 0.05, -0.04, 0, 0, 0, [0.12, 0.35, 0.12]));
  }), o, L);
};

const scrollFactory: ItemModelFactory = (look, o) => {
  const L = (look || {}) as Look, e = (L.effect || {}) as Record<string, unknown>;
  const revive = !!e.revive || /revive|воскр|resur/i.test(o.id || '');
  return wrap('slot:scroll', cached('scroll|' + revive, SIZE.scroll, (p) => {
    // a half-unrolled scroll leaning on its rolled end
    p.add(box(0.18, 0.13, 0.004), PAPER, T(0, 0.085, 0, -0.25, 0, 0));
    for (const s of [-1, 1]) {
      p.add(cyl(0.022, 0.022, 0.19, 12), '#e0c690', T(0, s > 0 ? 0.15 : 0.022, s > 0 ? 0.035 : -0.012, 0, 0, Math.PI / 2));
      for (const x of [-0.105, 0.105]) p.add(sphere(0.014, 6, 4), WOOD, T(x, s > 0 ? 0.15 : 0.022, s > 0 ? 0.035 : -0.012));
    }
    for (const y of [0.1, 0.075, 0.05]) p.add(box(0.12, 0.006, 0.002), '#8a6a3a', T(-0.01, y, -0.012 - (y - 0.05) * 0.25, -0.25, 0, 0));
    p.add(torus(0.024, 0.006, 4, 12), '#a3122a', T(0.05, 0.022, -0.012, 0, Math.PI / 2, 0));
    if (revive) p.add(cyl(0.022, 0.022, 0.008, 12), '#e8455c', T(0.05, 0.04, -0.03, Math.PI / 2 - 0.25, 0, 0));
  }), o, L);
};

/* ------------------------------------------------------------------ materials, relic, gift */

const ORE_C: Record<string, [string, string]> = {
  stone: ['#a39a8e', '#6f675d'], basalt: ['#5b5560', '#36323a'], frost_stone: ['#cfe3ee', '#7fa3b8'], limestone: ['#e6dcc0', '#b3a37c'], sandstone: ['#e2b77a', '#a8783f'],
  rubble: ['#b0a596', '#776b5c'], coal: ['#4a4a52', '#1d1d22'], iron: ['#c9a28a', '#8a5a44'], copper: ['#e3925a', '#a3542a'], sulfur: ['#f2df4a', '#b19a17'],
  peat: ['#7a5a3a', '#4a331d'], bone_dust: ['#efe6d2', '#b7a98a'], salt: ['#f4f2ee', '#bdb6aa'], silver: ['#e6ecf2', '#9aa7b4'], relic: ['#d6b56a', '#8a6a2a'],
  gold: ['#ffd84a', '#c48a12'], crystal: ['#b7f0ff', '#4aa9d6'], adamant: ['#9fb6ff', '#3a4fb8'], fire_opal: ['#ff8a4a', '#c0341c'], emerald: ['#5ee08a', '#1a8a4a'],
  amber: ['#ffc24a', '#c47a12'], sapphire: ['#5a8cff', '#1c3aa8'], topaz: ['#ffd27a', '#d08a1a'], malachite: ['#3ad0a0', '#11735a'], morion: ['#6a5a7a', '#2a1f36'],
  aquamarine: ['#8af0e8', '#2aa8b0'], ruby: ['#ff4a6a', '#a8142e'],
};
const GEMS = new Set(['crystal', 'adamant', 'fire_opal', 'emerald', 'amber', 'sapphire', 'topaz', 'malachite', 'morion', 'aquamarine', 'ruby']);

/** Material kind from look fields / id: 'star' | 'sphere' | 'seal' | 'gem:<res>' | 'ore:<res>'. */
export function materialKind(L: Look, id = ''): string {
  const mat = String(L.mat || '');
  if (mat === 'star' || /star|звезд/i.test(id)) return 'star';
  if (mat === 'sphere' || /sphere|сфер|orb/i.test(id)) return 'sphere';
  if (mat === 'seal' || L.seal != null || /seal|печат/i.test(id)) return 'seal';
  const res = String(L.res || id.replace(/^ore_/, '').replace(/^gem_/, ''));
  if (L.ore === 'gem' || GEMS.has(res)) return 'gem:' + (ORE_C[res] ? res : 'crystal');
  return 'ore:' + (ORE_C[res] ? res : 'stone');
}

function addMaterial(p: Parts, kind: string) {
  if (kind === 'star') {
    p.add(star(0.1, 0.04), '#ffd23f', T(0, 0.11, 0));
    p.add(sphere(0.03, 8, 6), '#fff6c8', T(0, 0.11, -0.022, 0, 0, 0, [1, 1, 0.4]));
    p.add(cyl(0.05, 0.06, 0.02, 12), '#a3122a', T(0, 0.01, 0));
    return;
  }
  if (kind === 'sphere') {
    p.add(cyl(0.07, 0.08, 0.025, 14), '#a0703a', T(0, 0.0125, 0));
    p.add(sphere(0.075, 16, 12), '#7fd6e6', T(0, 0.1, 0));
    p.add(torus(0.1, 0.006, 4, 24), '#e7f6ff', T(0, 0.1, 0, Math.PI / 2 - 0.3, 0, -0.3));
    p.add(sphere(0.022, 8, 6), '#ffffff', T(-0.03, 0.13, -0.05, 0, 0, 0, [1, 1, 0.5]));
    return;
  }
  if (kind === 'seal') {
    p.add(cyl(0.085, 0.085, 0.022, 20), '#d9a441', T(0, 0.09, 0, Math.PI / 2 - 0.2, 0, 0));
    p.add(torus(0.07, 0.008, 4, 22), '#a8742a', T(0, 0.09, -0.012, -0.2, 0, 0));
    p.add(star(0.035, 0.008), '#fff3c4', T(0, 0.09, -0.014, -0.2, 0, 0));
    p.add(box(0.05, 0.02, 0.06), DWOOD, T(0, 0.01, 0.02));
    return;
  }
  const [k, res] = kind.split(':'), [c1, c2] = ORE_C[res] || ORE_C.stone;
  if (k === 'gem') {
    p.add(new THREE.OctahedronGeometry(0.07, 0), c1, T(0, 0.075, 0, 0, Math.PI / 4, 0, [1, 1.1, 1]));
    p.add(new THREE.OctahedronGeometry(0.045, 0), c2, T(0.06, 0.04, 0.03, 0.3, 0.2, 0.4));
    p.add(sphere(0.012, 6, 4), '#ffffff', T(-0.02, 0.11, -0.04));
    return;
  }
  // a little heap of nuggets: base rock + coloured lumps
  const lump = (x: number, y: number, z: number, r: number, c: string) => p.add(new THREE.DodecahedronGeometry(r, 0), c, T(x, y, z, x * 9, z * 7, y * 5, [1, 0.8, 1]));
  lump(0, 0.045, 0, 0.06, c2); lump(-0.06, 0.035, 0.02, 0.045, c1); lump(0.055, 0.035, -0.01, 0.05, c1);
  lump(0.01, 0.09, 0.01, 0.04, c1); lump(-0.02, 0.03, -0.055, 0.035, c2);
}

const materialFactory: ItemModelFactory = (look, o) => {
  const L = (look || {}) as Look, kind = materialKind(L, o.id || '');
  return wrap('slot:material', cached('mat|' + kind, SIZE.material, (p) => addMaterial(p, kind)), o, L);
};

/** Relic: the site's «Печать Метаморфозы» — a glowing rune disc with two turning arrows, on a small stand. */
const relicFactory: ItemModelFactory = (look, o) => wrap('slot:relic', cached('relic', SIZE.relic, (p) => {
  p.add(cyl(0.1, 0.1, 0.025, 24), '#9b4dff', T(0, 0.13, 0, Math.PI / 2, 0, 0));
  p.add(torus(0.1, 0.012, 5, 28), '#c78bff', T(0, 0.13, 0));
  p.add(torus(0.078, 0.004, 4, 24), '#e7c8ff', T(0, 0.13, -0.014));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; p.add(sphere(i % 3 ? 0.006 : 0.01, 6, 4), '#fff3c4', T(Math.cos(a) * 0.078, 0.13 + Math.sin(a) * 0.078, -0.016)); }
  for (const s of [-1, 1]) {
    p.add(torus(0.04, 0.007, 4, 12, Math.PI * 0.8), '#ffffff', T(0, 0.13, -0.016, 0, 0, s > 0 ? 0.3 : Math.PI + 0.3));
    p.add(cone(0.014, 0.025, 4), '#ffffff', T(s * 0.03, 0.13 + s * 0.03, -0.016, 0, 0, s > 0 ? -2.2 : 0.9, [1, 1, 0.4]));
  }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.add(cone(0.008, i % 2 ? 0.03 : 0.045, 4), '#e7c8ff', T(Math.cos(a) * 0.125, 0.13 + Math.sin(a) * 0.125, 0, 0, 0, a - Math.PI / 2, [1, 1, 0.4])); }
  p.add(cyl(0.05, 0.065, 0.025, 14), '#3a1670', T(0, 0.0125, 0));
  p.add(box(0.03, 0.04, 0.02), '#3a1670', T(0, 0.04, 0));
}), o, (look || {}) as Look);

const giftFactory: ItemModelFactory = (look, o) => wrap('*', cached('gift|' + (o.rarity || 'common'), SIZE.gift, (p) => {
  const rib = o.rarity && o.rarity !== 'common' ? RARITY_COLOR[o.rarity] : '#ffc94d';
  p.add(box(0.2, 0.15, 0.2), '#e8455c', T(0, 0.075, 0));
  p.add(box(0.215, 0.03, 0.215), '#d63a50', T(0, 0.15, 0));
  p.add(box(0.03, 0.152, 0.205), rib, T(0, 0.076, 0));
  p.add(box(0.205, 0.152, 0.03), rib, T(0, 0.076, 0));
  for (const s of [-1, 1]) p.add(torus(0.035, 0.012, 5, 12), rib, T(s * 0.03, 0.185, 0, 0, 0, s * 0.6, [1, 0.8, 0.6]));
  p.add(sphere(0.018, 8, 6), rib, T(0, 0.17, 0));
}), o, (look || {}) as Look);

/* ------------------------------------------------------------------ registration + keys */

/** Every factory by key (built lazily on first use; geometry cached per key + rarity/variant). */
export function itemModelFactories(): Map<string, ItemModelFactory> {
  const m = new Map<string, ItemModelFactory>();
  for (const k of CATALOG.weapons) m.set('weapon:' + k, weaponFactory(k));
  for (const k of CATALOG.shields) m.set('shield:' + k, shieldFactory(k));
  for (const k of CATALOG.armors) m.set('armor:' + k, armorFactory(k));
  for (const k of ITEM_HATS) m.set('hat:' + k, hatFactory(k));
  for (const k of ITEM_CHARMS) m.set('charm:' + k, charmFactory(k));
  const slot: Record<(typeof ITEM_SLOTS)[number], ItemModelFactory> = {
    weapon: weaponFactory('sword'), shield: shieldFactory('round'), armor: armorFactory('lorica'), helmet: hatFactory('legion'),
    trinket: charmFactory('plain'), food: foodFactory(), potion: potionFactory, scroll: scrollFactory, material: materialFactory, relic: relicFactory,
  };
  for (const k of ITEM_SLOTS) m.set('slot:' + k, slot[k]);
  const FIXED: Record<string, string> = { apple: 'apple', pear: 'pear', bread: 'bread', pretzel: 'pretzel', cheese: 'cheese', pie: 'pie', ham: 'meat', roast: 'meat',
    kvass: 'mug', honey_cake: 'cake', sage_tea: 'cup', spicy_stew: 'bowl', fish: 'fish' };
  for (const k of ITEM_FOODS) m.set('food:' + k, foodFactory(FIXED[k] || 'bread'));
  m.set('*', giftFactory);
  return m;
}

/** Register all item models (keys = SUPPORTED_ITEM_MODEL_KEYS). Returns an unregister function. */
export function registerItemModels(reg: Registry<ItemModelFactory>): Unsub {
  const offs: Unsub[] = [];
  for (const [k, f] of itemModelFactories()) offs.push(reg.register(k, f));
  return () => { for (const off of offs) off(); };
}

type ItemLike = Pick<Item, 'slot'> & Partial<Pick<Item, 'id' | 'name' | 'gear' | 'look' | 'effect' | 'rarity'>> & Record<string, unknown>;

/** Primary registry key of an item (look.weapon/shield/armor/hat/charm, then the slot). Pure, no registry needed. */
export function itemModelKey(it: ItemLike): string {
  const L = (it.look || {}) as Look, slot = String(it.slot || '');
  if (L.weapon) return 'weapon:' + L.weapon;
  if (L.shield) return 'shield:' + L.shield;
  if (L.armor) return 'armor:' + L.armor;
  if (L.hat) return 'hat:' + L.hat;
  if (L.charm) return 'charm:' + L.charm;
  switch (slot) {
    case 'armor': return 'armor:' + (it.id === 'robe' || /мант/i.test(String(it.name || '')) || it.gear === 'cloth' ? 'robe' : 'lorica');   // like the site's art
    case 'helmet': return 'hat:legion';
    case 'trinket': return 'charm:' + String(L.aura || 'plain');
    default: return 'slot:' + (slot || 'material');
  }
}

/** Candidate keys in lookup order: exact ('food:<id>' for food), primary, slot fallback, '*'. */
export function itemModelKeys(it: ItemLike): string[] {
  const k = itemModelKey(it), out: string[] = [];
  if (it.slot === 'food' && it.id) out.push('food:' + it.id);
  out.push(k);
  if (!k.startsWith('slot:')) out.push('slot:' + it.slot);
  out.push('*');
  return out;
}

/** The look object a factory gets for an item: item.look + the fields generic models read (effect, mat, res, gear, name). */
export function itemModelLook(it: ItemLike, ring = false): Look {
  return { ...((it.look || {}) as Look), gear: it.gear, effect: it.effect, mat: it.mat, res: it.res, ore: it.ore, seal: it.seal, name: it.name, ...(ring ? { ring: true } : {}) };
}

/**
 * Build the 3D model of an item through the registry: first registered candidate key wins. An unknown gear key
 * (a new weapon kind on the site) is reported once as drift via `reg.resolve` before falling back to the slot model.
 */
export function buildItemModel(reg: Registry<ItemModelFactory>, it: ItemLike, o: { ring?: boolean } = {}): THREE.Object3D {
  const keys = itemModelKeys(it), opts: Opts = { rarity: String(it.rarity || 'common'), slot: String(it.slot || ''), id: it.id, ring: o.ring };
  const look = itemModelLook(it, o.ring);
  const primary = itemModelKey(it);
  if (!primary.startsWith('slot:') && !reg.has(primary)) reg.resolve(primary);   // drift report only
  for (const k of keys) { const f = reg.get(k); if (f) return f(look, opts); }
  return reg.resolve('*')(look, opts);
}

/** Free the cached item geometries (tests / hot reload). */
export function clearItemModelCache() { for (const b of cache.values()) b.geo.dispose(); cache.clear(); }
