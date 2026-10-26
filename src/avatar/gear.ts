/**
 * 3D weapons and shields (vertex-coloured parts). Weapon space: grip at the origin, business end towards +Y.
 * Shield space: face towards −Z, centre at the origin.
 */
import * as THREE from 'three';
import { Parts, T, cyl, cone, sphere, box, torus, slab, tube, star, INK } from './geom';
import { RARITY_COLOR } from './appearance';

export const METAL: Record<string, string> = { common: '#b7bec4', uncommon: '#cdeec4', rare: '#bfe3ff', epic: '#e0c8ff', legendary: '#ffd76a' };
const WOOD = '#8a5a2b', DWOOD = '#5a3a1c', GOLD = '#e8b923', BONE = '#ebe2c9';
const accent = (r?: string) => (r && r !== 'common' ? RARITY_COLOR[r] : null);

/** Add weapon parts (in weapon space transformed by `m`) to `p`. */
export function addWeapon(p: Parts, kind: string, rar: string | undefined, m: THREE.Matrix4, lowDetail = false): void {
  const metal = METAL[rar || 'common'] || METAL.common, acc = accent(rar);
  const M = (x: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(m, x);
  const seg = lowDetail ? 6 : 10;
  const grip = (y0: number, y1: number, r = 0.018, c = WOOD) => p.add(cyl(r, r, y1 - y0, seg), c, M(T(0, (y0 + y1) / 2, 0)));
  const gem = (y: number, z = -0.02, r = 0.016) => { if (acc) p.add(new THREE.OctahedronGeometry(r, 0), acc, M(T(0, y, z))); };
  switch (kind) {
    case 'gladius': {
      grip(-0.09, 0.0, 0.017, DWOOD); p.add(sphere(0.025, seg, 6), metal, M(T(0, -0.1, 0)));
      p.add(box(0.12, 0.035, 0.05), '#b8892a', M(T(0, 0.012, 0)));
      p.add(slab([[-0.035, 0], [-0.045, 0.12], [-0.03, 0.24], [0, 0.32], [0.03, 0.24], [0.045, 0.12], [0.035, 0]], 0.018), metal, M(T(0, 0.025, 0)));
      gem(0.012, -0.03); break;
    }
    case 'dagger': {
      grip(-0.07, 0.0, 0.016, DWOOD);
      p.add(box(0.09, 0.03, 0.04), '#6d5a45', M(T(0, 0.01, 0)));
      p.add(slab([[-0.025, 0], [-0.025, 0.14], [0, 0.19], [0.025, 0.14], [0.025, 0]], 0.014), metal, M(T(0, 0.02, 0)));
      gem(0.01, -0.025); break;
    }
    case 'kris': {
      grip(-0.08, 0.0, 0.016, '#3a2a40'); p.add(sphere(0.022, seg, 6), metal, M(T(0, -0.09, 0)));
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) pts.push([-0.024 + Math.sin(i * 1.3) * 0.012, i * 0.032]);
      pts.push([0, 0.29]);
      for (let i = 8; i >= 0; i--) pts.push([0.024 + Math.sin(i * 1.3) * 0.012, i * 0.032]);
      p.add(slab(pts, 0.014), '#cfe3f5', M(T(0, 0.01, 0)));
      gem(0.0, -0.02); break;
    }
    case 'axe': {
      grip(-0.12, 0.4, 0.02);
      p.add(slab([[0, 0], [0.11, -0.05], [0.15, 0.04], [0.13, 0.13], [0.0, 0.1]], 0.025, 0.004), metal, M(T(0.015, 0.27, 0)));
      p.add(box(0.05, 0.08, 0.05), '#6d5a45', M(T(0, 0.33, 0)));
      gem(0.33, -0.03); break;
    }
    case 'club': {
      p.add(cyl(0.06, 0.022, 0.45, seg), WOOD, M(T(0, 0.12, 0)));
      p.add(sphere(0.06, seg, 6), WOOD, M(T(0, 0.345, 0)));
      p.add(sphere(0.015, 6, 4), DWOOD, M(T(0.05, 0.25, -0.02)));
      p.add(sphere(0.013, 6, 4), DWOOD, M(T(-0.04, 0.17, -0.02)));
      break;
    }
    case 'mace': {
      grip(-0.1, 0.32, 0.019);
      p.add(sphere(0.07, seg, 8), metal, M(T(0, 0.35, 0)));
      if (!lowDetail) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.add(cone(0.02, 0.05, 5), metal, M(T(Math.cos(a) * 0.07, 0.35, Math.sin(a) * 0.07, 0, -a, -Math.PI / 2))); }
      p.add(cone(0.02, 0.05, 5), metal, M(T(0, 0.43, 0)));
      gem(0.35, -0.07); break;
    }
    case 'hammer': {
      grip(-0.1, 0.34, 0.019);
      p.add(box(0.2, 0.1, 0.1), metal, M(T(0, 0.36, 0)));
      p.add(box(0.21, 0.02, 0.105), '#6d5a45', M(T(0, 0.36, 0)));
      gem(0.36, -0.055); break;
    }
    case 'spear': {
      grip(-0.25, 0.55, 0.016);
      p.add(cone(0.035, 0.16, 4), metal, M(T(0, 0.63, 0, 0, Math.PI / 4, 0, [1, 1, 0.45])));
      p.add(torus(0.02, 0.008, 4, 10), acc || '#e8455c', M(T(0, 0.55, 0, Math.PI / 2)));
      if (!lowDetail) p.add(slab([[0, 0], [0.05, -0.05], [0.07, -0.13], [0.02, -0.06]], 0.006), acc || '#e8455c', M(T(0.01, 0.55, 0)));
      break;
    }
    case 'pitchfork': {
      grip(-0.25, 0.48, 0.018, '#e8914a');
      p.add(box(0.16, 0.025, 0.025), metal, M(T(0, 0.49, 0)));
      for (const x of [-0.07, 0, 0.07]) p.add(cyl(0.008, 0.012, 0.15, 6), metal, M(T(x, 0.57, 0)));
      for (const x of [-0.07, 0, 0.07]) p.add(cone(0.012, 0.03, 6), metal, M(T(x, 0.66, 0)));
      break;
    }
    case 'bow': {
      const arc: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) { const a = -1.1 + (2.2 * i) / 10; arc.push([0, Math.sin(a) * 0.32 + 0.08, -Math.cos(a) * 0.12 + 0.05]); }
      p.add(tube(arc, 0.017, lowDetail ? 10 : 18, 5), '#c48a4a', m);   // wood always (pale limbs vanished against the sky); rarity shows in the gem + tips
      if (acc) for (const sy of [-1, 1]) p.add(sphere(0.014, 6, 4), acc, M(T(0, Math.sin(1.1 * sy) * 0.32 + 0.08, -Math.cos(1.1) * 0.12 + 0.05)));
      p.add(cyl(0.004, 0.004, Math.sin(1.1) * 0.64, 4), '#ff5a7a', M(T(0, 0.08, Math.cos(1.1) * -0.12 + 0.05)));
      p.add(cyl(0.022, 0.022, 0.08, seg), '#7a4a2a', M(T(0, 0.08, -0.07)));
      gem(0.08, -0.095, 0.014); break;
    }
    case 'staff': {
      grip(-0.3, 0.55, 0.018);
      p.add(torus(0.05, 0.012, 5, 12), GOLD, M(T(0, 0.6, 0)));
      p.add(sphere(0.042, seg, 8), acc || '#6ec6ff', M(T(0, 0.6, 0)));
      break;
    }
    case 'crook': {
      grip(-0.3, 0.5, 0.018, '#a0703a');
      p.add(torus(0.07, 0.018, 5, 12, Math.PI * 1.25), '#a0703a', M(T(0.07, 0.5, 0, 0, 0, -0.1)));
      p.add(sphere(0.03, 8, 6), acc || '#bfe3ff', M(T(0.14, 0.48, 0)));
      break;
    }
    case 'censer': {
      // hangs down from the paw (chain towards −Y)
      p.add(cyl(0.004, 0.004, 0.18, 4), '#8a8a8a', M(T(0, -0.09, 0)));
      p.add(sphere(0.06, seg, 8, ), metal, M(T(0, -0.22, 0, 0, 0, 0, [1, 0.8, 1])));
      p.add(cone(0.04, 0.05, seg), metal, M(T(0, -0.16, 0)));
      p.add(torus(0.06, 0.008, 4, 14), acc || GOLD, M(T(0, -0.21, 0, Math.PI / 2)));
      if (!lowDetail) { p.add(sphere(0.022, 6, 4), '#bfeabf', M(T(-0.03, -0.1, -0.02))); p.add(sphere(0.03, 6, 4), '#d6f5d6', M(T(0.02, -0.04, -0.02))); }
      break;
    }
    case 'skullstaff': {
      grip(-0.3, 0.55, 0.018, '#4a3a2a');
      p.add(sphere(0.07, seg, 8), BONE, M(T(0, 0.64, 0)));
      p.add(box(0.08, 0.05, 0.07), BONE, M(T(0, 0.58, -0.01)));
      p.add(sphere(0.018, 6, 4), acc || INK, M(T(-0.026, 0.645, -0.06)));
      p.add(sphere(0.018, 6, 4), acc || INK, M(T(0.026, 0.645, -0.06)));
      p.add(cyl(0.008, 0.008, 0.08, 4), '#4a3a2a', M(T(-0.05, 0.4, 0, 0, 0, 0.8)));
      break;
    }
    case 'grimoire': {
      p.add(box(0.2, 0.25, 0.06), '#4a2a6a', M(T(0, 0.12, 0)));
      p.add(box(0.185, 0.235, 0.064), '#efe6d2', M(T(0.012, 0.12, 0)));
      p.add(box(0.204, 0.254, 0.044), '#4a2a6a', M(T(0, 0.12, 0)));
      p.add(box(0.04, 0.26, 0.068), '#2e1a44', M(T(-0.085, 0.12, 0)));
      p.add(star(0.04, 0.012), acc || GOLD, M(T(0.01, 0.13, -0.034)));
      break;
    }
    case 'holymace': {
      grip(-0.1, 0.32, 0.019);
      p.add(cyl(0.035, 0.035, 0.04, seg), '#cfe3f5', M(T(0, 0.32, 0)));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI; p.add(box(0.16, 0.12, 0.02), metal, M(T(0, 0.4, 0, 0, a, 0))); }
      p.add(sphere(0.03, 8, 6), GOLD, M(T(0, 0.48, 0)));
      gem(0.4, -0.085); break;
    }
    case 'sword': default: {
      grip(-0.1, 0.0, 0.017, DWOOD); p.add(sphere(0.026, seg, 6), metal, M(T(0, -0.11, 0)));
      p.add(box(0.15, 0.035, 0.045), '#6d5a45', M(T(0, 0.012, 0)));
      p.add(slab([[-0.03, 0], [-0.03, 0.34], [0, 0.4], [0.03, 0.34], [0.03, 0]], 0.016), metal, M(T(0, 0.025, 0)));
      gem(0.012, -0.028); break;
    }
  }
}

const HOLD_EDGE_FWD = new Set(['sword', 'gladius', 'dagger', 'kris', 'axe', 'hammer', 'spear', 'crook']);
/**
 * Canonical hold of a weapon in HAND space, shared by the third-person body (model.ts) and the first-person
 * view-model (viewmodel.ts), so a held item always "looks" the same way:
 * grip at the origin, +Y along the grip towards the business end, −Z = forward (where the holder faces / strikes),
 * +Z = towards the holder (the camera in FP and in TP from behind), +X = the holder's right.
 * - sword / gladius / dagger / kris: edge forward, flat sideways;  axe / hammer: the striking head forward;
 *   spear: blade edges forward;  crook: the hook forward;  skullstaff: the skull already faces forward (−Z);
 * - bow: limbs up/down in the aim plane (YZ), string towards the holder, the grip (arrow rest) at the origin;
 * - grimoire: cover (star) towards the holder, the spine in the paw;  censer: chain straight down (−Y);
 * - mace / holymace / club / staff / pitchfork: symmetric enough — unchanged.
 * Compose as `handMatrix × weaponHold(kind)` and pass the product to addWeapon.
 */
export function weaponHold(kind: string): THREE.Matrix4 {
  if (HOLD_EDGE_FWD.has(kind)) return T(0, 0, 0, 0, Math.PI / 2, 0);
  if (kind === 'bow') return T(0, -0.08, 0.07);                       // grip (0, 0.08, −0.07) → origin; string already at +Z
  if (kind === 'grimoire') return T(-0.085, -0.06, 0, 0, Math.PI, 0);   // cover → +Z, spine (x −0.085) → grip
  return new THREE.Matrix4();
}

/** Shield parts (face towards −Z). */
export function addShield(p: Parts, kind: string, rar: string | undefined, m: THREE.Matrix4, lowDetail = false): void {
  const acc = accent(rar), M = (x: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(m, x), seg = lowDetail ? 10 : 20;
  const disc = (r: number, h: number, c: string, z = 0) => p.add(cyl(r, r, h, seg), c, M(T(0, 0, z, Math.PI / 2)));
  switch (kind) {
    case 'scutum': {
      // curved rectangle: part of an open cylinder (convex towards −Z)
      const R = 0.32, arc = 0.85, h = 0.42;
      const g = new THREE.CylinderGeometry(R, R, h, 10, 1, true, Math.PI - arc / 2, arc);
      p.add(g, '#c0182b', M(T(0, 0, R - 0.02)));
      // inner (back) side: a slightly smaller arc on the SAME axis, winding reversed by mirroring x (the arc is
      // symmetric about x = 0). It used to be rotated by π as well, which put a dark sheet ~0.6 m behind the
      // shield, sticking out of the character's back (owner's bug #8).
      const TH = 0.014;
      const back = new THREE.CylinderGeometry(R - TH, R - TH, h - 0.004, 10, 1, true, Math.PI - arc / 2, arc);
      back.scale(-1, 1, 1);
      p.add(back, '#a87a4a', M(T(0, 0, R - 0.02)));
      p.add(box(0.03, h * 0.5, 0.025), '#5a3a1c', M(T(0, 0, 0.012 - 0.02 + TH)));
      // rim: close the gap between the two layers along the edges
      const edgeX = Math.sin(arc / 2) * (R - TH / 2), edgeZ = R - 0.02 - Math.cos(arc / 2) * (R - TH / 2);
      for (const sx of [-1, 1]) p.add(box(TH + 0.006, h, TH + 0.004), GOLD, M(T(sx * edgeX, 0, edgeZ, 0, sx * arc / 2, 0)));
      for (const sy of [-1, 1]) {
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 8; i++) { const a = Math.PI - arc / 2 + (arc * i) / 8; pts.push([Math.sin(a) * (R - TH / 2), sy * h / 2, Math.cos(a) * (R - TH / 2) + R - 0.02]); }
        p.add(tube(pts, TH / 2 + 0.003, 10, 4), GOLD, m);
      }
      p.add(sphere(0.045, 10, 6), acc || GOLD, M(T(0, 0, -0.035, 0, 0, 0, [1, 1, 0.6])));
      p.add(box(0.025, h * 0.9, 0.02), GOLD, M(T(0, 0, -0.012)));
      p.add(box(0.27, 0.022, 0.02), GOLD, M(T(0, 0, -0.012)));
      break;
    }
    case 'buckler': {
      disc(0.11, 0.025, METAL[rar || 'common'] || METAL.common);
      p.add(torus(0.11, 0.012, 5, seg), acc || '#8a8a8a', M(T(0, 0, 0)));
      p.add(sphere(0.04, 10, 6), acc || '#6ec6ff', M(T(0, 0, -0.012, 0, 0, 0, [1, 1, 0.7])));
      break;
    }
    case 'barrel': {
      disc(0.17, 0.05, '#a0703a');
      for (const x of [-0.08, 0, 0.08]) p.add(box(0.006, 0.3, 0.004), '#6a4421', M(T(x, 0, -0.026)));
      p.add(torus(0.17, 0.016, 5, seg), '#8e8e98', M(T(0, 0, -0.01)));
      p.add(torus(0.12, 0.01, 4, seg), acc || '#8e7aa8', M(T(0, 0, -0.026)));
      break;
    }
    case 'round': default: {
      disc(0.17, 0.035, '#7a4a2a');
      p.add(torus(0.17, 0.016, 5, seg), acc || '#bfc6cf', M(T(0, 0, 0)));
      p.add(sphere(0.05, 10, 6), '#c88a50', M(T(0, 0, -0.016, 0, 0, 0, [1, 1, 0.6])));
      if (!lowDetail) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.add(sphere(0.014, 6, 4), '#c88a50', M(T(Math.cos(a) * 0.11, Math.sin(a) * 0.11, -0.02))); }
      break;
    }
  }
}
