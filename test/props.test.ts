/**
 * PropKit geometry tests (node, no DOM): textures are stubbed with a fake canvas so materials can be created.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

beforeAll(() => {
  // minimal canvas stub: enough for getTexture() to run without a DOM
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'getImageData' || k === 'createImageData') return (_x: number, _y?: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4), width: w, height: h });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }),
  };
});

describe('PropKit', () => {
  it('builds every kind within the triangle budget and merges parts per material', async () => {
    const { PropKit, PROP_KINDS, propStats } = await import('../src/world/props');
    const stats = propStats();
    expect(stats.length).toBe(PROP_KINDS.length);
    for (const s of stats) {
      const limit = s.kind === 'bridge' ? 6000 : s.kind === 'stall' ? 4000 : 2500;
      expect(s.tris, s.kind).toBeLessThanOrEqual(limit);
      expect(s.tris, s.kind).toBeGreaterThan(20);
      const mats = PropKit.parts(s.kind).map((p) => p.mat);
      expect(new Set(mats).size, s.kind + ' one geometry per material').toBe(mats.length);
    }
  });

  it('instanced() returns one InstancedMesh per material part + outline, sharing cached geometry', async () => {
    const { PropKit } = await import('../src/world/props');
    const list = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 1, rotY: 1, scale: 1.2 }];
    const a = PropKit.instanced('lamp', list);
    const b = PropKit.instanced('lamp', [{ x: 5, y: 0, z: 0 }]);
    const ma = a.children as THREE.InstancedMesh[];
    expect(ma.length).toBe(PropKit.parts('lamp').length + 1);
    for (const m of ma) { expect(m).toBeInstanceOf(THREE.InstancedMesh); expect(m.count).toBe(2); }
    expect((b.children[0] as THREE.InstancedMesh).geometry).toBe(ma[0].geometry);
    const mm = new THREE.Matrix4(); ma[0].getMatrixAt(1, mm);
    const p = new THREE.Vector3().setFromMatrixPosition(mm);
    expect(p.x).toBeCloseTo(3); expect(p.z).toBeCloseTo(1);
    const noOutline = PropKit.instanced('lamp', list, { outline: false });
    expect(noOutline.children.length).toBe(PropKit.parts('lamp').length);
  });

  it('props stand on the ground (min y ≈ 0) and are sized for chibi characters', async () => {
    const { PropKit, PROP_KINDS } = await import('../src/world/props');
    for (const k of PROP_KINDS) {
      if (k === 'stairs' || k === 'bridge') continue;
      const bb = new THREE.Box3();
      for (const p of PropKit.parts(k)) bb.union(p.geo.boundingBox!);
      expect(bb.min.y, k).toBeGreaterThan(-0.05);
      expect(bb.min.y, k).toBeLessThan(0.08);
      expect(bb.max.y, k).toBeLessThan(4.5);
    }
    expect(PropKit.footprint('lamp').h).toBeGreaterThan(2.6);
    expect(PropKit.lampHeadOffset.y).toBeGreaterThan(2.5);
  });

  it('garland(): bulbs instanced with per-instance colours, sagging below the anchors', async () => {
    const { PropKit } = await import('../src/world/props');
    const g = PropKit.garland([[new THREE.Vector3(0, 3, 0), new THREE.Vector3(6, 3, 0), new THREE.Vector3(10, 2.5, 2)]], { glow: false });
    const bulbs = g.children.find((c) => c.name === 'prop:garland:bulbs') as THREE.InstancedMesh;
    expect(bulbs.count).toBeGreaterThan(20);
    expect(bulbs.instanceColor).toBeTruthy();
    const mm = new THREE.Matrix4(); bulbs.getMatrixAt(Math.floor(bulbs.count / 4), mm);
    expect(new THREE.Vector3().setFromMatrixPosition(mm).y).toBeLessThan(2.8);
    PropKit.disposeObject(g);
  });

  it('variants are cached separately; disposePropKit clears caches', async () => {
    const { PropKit, disposePropKit } = await import('../src/world/props');
    const a = PropKit.parts('stall', { variant: 0 }), b = PropKit.parts('stall', { variant: 1 });
    expect(a[0].geo).not.toBe(b[0].geo);
    expect(PropKit.parts('stall', { variant: 1 })[0].geo).toBe(b[0].geo);
    disposePropKit();
    expect(PropKit.parts('stall', { variant: 1 })[0].geo).not.toBe(b[0].geo);
  });
});

describe('tex', () => {
  it('getTexture caches by key and returns sRGB maps + linear normal maps', async () => {
    const { getTexture, TEX_KINDS } = await import('../src/world/tex');
    for (const k of TEX_KINDS) {
      const t = getTexture(k);
      expect(t.map.colorSpace, k).toBe(THREE.SRGBColorSpace);
      if (t.normalMap) expect(t.normalMap.colorSpace).toBe(THREE.NoColorSpace);
      expect(getTexture(k)).toBe(t);
    }
    expect(getTexture('canvas', { colors: ['#000', '#fff'] })).not.toBe(getTexture('canvas'));
  });
});
