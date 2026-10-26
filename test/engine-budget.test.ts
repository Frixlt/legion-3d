import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CrowdLod, CROWD } from '../src/engine/budget';
import { AutoGovernor, PRESETS } from '../src/engine/quality';

function cam(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
  c.position.set(0, 1.6, 0); c.lookAt(0, 1.6, -10); c.updateMatrixWorld(); c.updateProjectionMatrix();
  return c;
}

describe('CrowdLod', () => {
  it('ranks in-view avatars nearest-first and respects the q2 budget', () => {
    const c = cam(), crowd = new CrowdLod(4);
    crowd.begin(c, 2);
    const slots: number[] = [];
    for (let i = 0; i < 40; i++) slots.push(crowd.add(((i % 5) - 2) * 1.5, 0, -2 - i * 0.6));   // 40 in a corridor ahead
    const behind = crowd.add(0, 0, 8);   // behind the camera
    crowd.resolve();
    const b = CROWD[2];
    expect(crowd.lod(behind)).toBe(-1);
    expect(crowd.stats.drawn).toBe(b.maxDrawn);
    expect(crowd.stats.lod0).toBeLessThanOrEqual(b.lod0Max);
    expect(crowd.stats.lod1).toBeLessThanOrEqual(b.lod1Max);
    // nearest is full detail, farthest drawn is the low mesh, the 40th is over budget
    expect(crowd.lod(slots[0])).toBe(0);
    expect(crowd.lod(slots[b.maxDrawn - 1])).toBe(2);
    expect(crowd.lod(slots[39])).toBe(-1);
    // triangle estimate with current avatar meshes (LOD0 7k, LOD1 3.5k, LOD2 0.4k) stays well under 150k
    const tris = crowd.stats.lod0 * 7000 + crowd.stats.lod1 * 3500 + crowd.stats.lod2 * 400;
    expect(tris).toBeLessThan(60000);
    // nameplates: nearest labelMax only
    expect(crowd.label(slots[0])).toBe(true);
    expect(crowd.label(slots[b.labelMax])).toBe(false);
    expect(slots.filter((s) => crowd.label(s)).length).toBe(b.labelMax);
  });
  it('keeps a finer LOD inside the hysteresis band', () => {
    const c = cam(), crowd = new CrowdLod();
    const d = CROWD[2].lod0 * 1.05;   // just past the LOD0 radius (camera at y 1.6 → use horizontal + vertical)
    crowd.begin(c, 2); const s0 = crowd.add(0, 1.6, -d, 0); crowd.resolve();
    expect(crowd.lod(s0)).toBe(0);
    crowd.begin(c, 2); const s1 = crowd.add(0, 1.6, -d, 1); crowd.resolve();
    expect(crowd.lod(s1)).toBe(1);
  });
});

describe('AutoGovernor locked (fixed level)', () => {
  it('scales resolution but never changes the level', () => {
    const g = new AutoGovernor(2, 3); g.locked = true; g.reset(0);
    let t = 0;
    for (let w = 0; w < 30; w++) { for (let i = 0; i < 30; i++) { t += 0.04; g.sample(40, t); } }
    expect(g.level).toBe(2);
    expect(g.scale).toBeCloseTo(PRESETS[2].fixedMinScale, 5);
  });
});
