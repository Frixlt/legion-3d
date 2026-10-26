/**
 * Body armour as a shell over the body surface (shared by characters and the item models' mannequins).
 * Vertex-coloured parts added to a `Parts` builder; the character looks towards −Z.
 */
import * as THREE from 'three';
import { T, bodyShell, radiusAt, col, cone, torus, star, type BodyDims, type Parts } from './geom';
import { RARITY_COLOR } from './appearance';

export const LEATHER = ['#7a5436', '#5a3f2c', '#3a2c26', '#2a2230', '#221a26'];
export const SHROUD = ['#5f5a68', '#33403a', '#2a2a44', '#2b1a40', '#1e1024'];
export const PLATE = ['#c4cad3', '#dde3eb', '#eaeef4', '#f4f6fa', '#fff8ea'];
export const W_METAL: Record<string, string> = { common: '#aab2b8', uncommon: '#b9c8b6', rare: '#a9c2da', epic: '#c0b0e0', legendary: '#f2c75c' };
export const W_CLOTH: Record<string, string> = { common: '#8a7a62', uncommon: '#3f6fb0', rare: '#2f58a8', epic: '#5a2fa8', legendary: '#7a1f3a' };
export const RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
/** Radial offset of the armour shell over the body (m). */
export const ARMOR_OFF = 0.012;

export interface ArmorOpts {
  /** Top of the shell (the neck line). */
  yB: number;
  /** Shoulder x (pauldrons). */
  sx: number;
  ghost?: boolean;
  /** Bones for the pauldrons (characters); omitted → the current default bone of the builder. */
  boneL?: number; boneR?: number;
  /** Segment counts (defaults: 32 × 16). */
  segs?: number; rings?: number;
}

/** Armour kind actually drawn: light lorica looks like a brown leather jerkin. */
export const armorKind = (a: string, am?: string) => (a === 'lorica' && am === 'light' ? 'light' : a);

/** Main colour of an armour kind at a rarity (also used by the LOD2 mesh). */
export function armorBase(kind: string, rar?: string): string {
  const rk = RANK[rar || 'common'] || 0;
  return kind === 'robe' ? W_CLOTH[rar || 'common'] || W_CLOTH.common : kind === 'leather' ? LEATHER[rk] : kind === 'shroud' ? SHROUD[rk]
    : kind === 'plate' ? PLATE[rk] : kind === 'light' ? '#9a6a3e' : W_METAL[rar || 'common'] || W_METAL.common;
}

/** Adds the armour shell (+ pauldrons, plate star, shroud spikes). Returns the shell's extent for accessories. */
export function addArmor(p: Parts, d: BodyDims, a: string, rar: string | undefined, am: string | undefined, o: ArmorOpts): { yA: number; yB: number; off: number } {
  const rk = RANK[rar || 'common'] || 0, rc = rar && rar !== 'common' ? RARITY_COLOR[rar] : null;
  const kind = armorKind(a, am);
  const full = kind === 'robe' || kind === 'shroud';
  const yB = o.yB, yA = full ? d.y0 + (o.ghost ? 0.02 : 0.0) : Math.max(d.y0 + 0.08, yB - 0.42);
  const base = armorBase(kind, rar);
  const trim = col(rc || (kind === 'robe' ? '#c9b28a' : kind === 'plate' ? (rk ? '#e8b923' : '#b89a52') : kind === 'shroud' ? '#ebe2c9' : kind === 'leather' ? '#1e140e' : '#8a6a4a'));
  const B0 = col(base), dark = new THREE.Color().copy(B0).multiplyScalar(0.7), bone = col('#ebe2c9');
  p.add(bodyShell(d, {
    yA, yB, segs: o.segs ?? 32, rings: o.rings ?? 16, off: ARMOR_OFF,
    yWarp: kind === 'shroud' ? (th, y, t) => (t === 0 ? y - 0.03 * Math.abs(Math.sin(th * 7)) : y) : undefined,
    color: (th, y, t, out) => {
      out.copy(B0);
      const front = Math.cos(th), sx_ = Math.sin(th);
      if (t > 0.9) { out.copy(trim); return; }
      if (kind === 'lorica' && Math.sin((y - yA) * 70) > 0.6) out.copy(dark);
      if (kind === 'lorica' && t < 0.12) out.copy(trim);
      if (kind === 'robe') { if (front > 0.97) out.copy(trim); if (t < 0.06) out.copy(trim); }
      if (kind === 'light' || kind === 'leather') {
        const diag = (y - yA) / (yB - yA) - (0.5 + sx_ * 0.45);
        if (front > 0 && Math.abs(diag) < 0.07) out.set(kind === 'leather' ? '#1e140e' : '#5a3a20');
        if (Math.abs(t - 0.35) < 0.06) out.set('#1e140e');
        if (t < 0.05) out.copy(trim);
      }
      if (kind === 'shroud' && rk >= 1 && front > 0.6 && t > 0.55 && t < 0.85 && Math.sin(t * 60) > 0.3) out.copy(bone);
      if (kind === 'shroud' && t < 0.08) out.copy(rk >= 3 ? col('#120a16') : bone);
      if (kind === 'plate') { if (t < 0.08) out.copy(trim); if (Math.sin((y - yA) * 50) > 0.85) out.multiplyScalar(0.85); }
    },
  }));
  const sx = o.sx;
  if (kind === 'plate' || ((kind === 'leather' || kind === 'lorica') && rk >= 2)) {
    for (const s of [-1, 1]) {
      const bone_ = s < 0 ? o.boneL : o.boneR;
      p.add(new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), base, T(s * sx, d.armY + 0.03, 0, 0, 0, s * -0.5, [1, 0.7, 1.05]), bone_);
      p.add(torus(0.084, 0.01, 4, 16), trim, T(s * sx, d.armY + 0.03, 0, Math.PI / 2, s * -0.5, 0, [1, 1.05, 1]), bone_);
    }
  }
  if (kind === 'shroud' && rk >= 2) for (const s of [-1, 1]) for (const k of [-1, 0, 1]) p.add(cone(0.018, 0.08, 5), '#ebe2c9', T(s * sx + k * 0.03, d.armY + 0.06, k * 0.02, 0, 0, s * -0.4));
  if (kind === 'plate') { const zf = -radiusAt(d, yA + 0.2) * d.depth - 0.016; p.add(star(0.04, 0.01), rk ? '#e8b923' : '#b89a52', T(0, yA + 0.22, zf)); }
  return { yA, yB, off: ARMOR_OFF };
}
