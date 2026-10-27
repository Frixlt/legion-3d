import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventHarness, fakeCat, fakeGame } from './events-fixture';
import aprilfools, { hatGeometry, hatMatrix, HAT_BUDGET, TALL_HAT } from '../src/events/aprilfools';

const d = (m: number, day: number, h = 12) => new Date(2027, m - 1, day, h);

describe('April fools party hats', () => {
  it('only on April 1 (local, all day)', () => {
    expect(aprilfools.active(d(4, 1, 0))).toBe(true); expect(aprilfools.active(new Date(2027, 3, 1, 23, 59))).toBe(true);
    expect(aprilfools.active(d(3, 31))).toBe(false); expect(aprilfools.active(d(4, 2))).toBe(false);
  });
  it('the hat sits on the head top and follows the body bone (emotes, ragdolls)', () => {
    const cat = fakeCat(3, 0, 2, { top: 1.2, headTop: 1.25 }), m = new THREE.Matrix4(), p = new THREE.Vector3();
    expect(hatMatrix(cat, 0, m)).toBe(true);
    p.setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(3, 1); expect(p.z).toBeCloseTo(2, 1); expect(p.y).toBeGreaterThan(1.1); expect(p.y).toBeLessThan(1.26);
    // tip the body bone over: the hat goes with it
    const rig = cat.combatRig(); rig.bones[1].rotation.z = Math.PI / 2; cat.root.updateMatrixWorld(true);
    hatMatrix(cat, 0, m); p.setFromMatrixPosition(m);
    expect(p.y).toBeLessThan(0.8); expect(Math.abs(p.x - 3)).toBeGreaterThan(0.4);
  });
  it('tall helmets / big hats get no party hat', () => {
    expect(hatMatrix(fakeCat(0, 0, 0, { top: 1.2, headTop: 1.2 + TALL_HAT + 0.05 }), 0, new THREE.Matrix4())).toBe(false);
    expect(hatMatrix(fakeCat(0, 0, 0, { top: 1.2, headTop: 1.3 }), 0, new THREE.Matrix4())).toBe(true);
  });
  it('hats for every visible cat (nearest N by quality), the own cat only in third person, one draw; avatars untouched', () => {
    const cats = new Map<string, ReturnType<typeof fakeCat>>();
    for (let i = 0; i < 30; i++) cats.set('c' + i, fakeCat(20 + (i % 10), 0, 1 + Math.floor(i / 10)));
    cats.set('helmet', fakeCat(21, 0, 4, { top: 1.2, headTop: 1.7 }));
    const hidden = fakeCat(22, 0, 4); hidden.root.visible = false; cats.set('hidden', hidden);
    const me = fakeCat(24.6, 0, 4.2);
    const h = eventHarness(2); h.ctx.camera.position.set(24, 1.2, 4); const fg = fakeGame(cats, me); h.ctx.game = fg.game;
    const kids = [...cats.values()].map((c) => c.root.children.length), keys = [...cats.values()].map((c) => Object.keys(c).join());
    const dispose = aprilfools.setup(h.ctx);
    h.frame(3);
    const hats = h.ctx.group.getObjectByName('aprilfools:hats') as THREE.InstancedMesh;
    expect(hats.count).toBe(31);                                     // 30 cats + me; no helmet, no hidden
    fg.st.meVisible = false; h.frame(1); expect(hats.count).toBe(30);
    let n = 0; h.ctx.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) n++; }); expect(n).toBe(1);
    h.setQuality(0); h.frame(1); expect(hats.count).toBe(HAT_BUDGET[0]);
    expect(h.frame(200)).toBeLessThan(0.5);
    // the avatars themselves are never modified (no child added, no field written)
    expect([...cats.values()].map((c) => c.root.children.length)).toEqual(kids);
    expect([...cats.values()].map((c) => Object.keys(c).join())).toEqual(keys);
    dispose();
    expect(h.ctx.group.children.length).toBe(0); expect(h.hooks).toBe(0);
  });
  it('without the game API (dev page) it runs and shows nothing; dispose restores the bulbs', () => {
    const h = eventHarness(2), bulb = Array.from(h.fake.bulbs.geometry.getAttribute('color').array as Float32Array);
    const dispose = aprilfools.setup(h.ctx); h.frame(5);
    expect((h.ctx.group.getObjectByName('aprilfools:hats') as THREE.InstancedMesh).count).toBe(0);
    dispose();
    expect(Array.from(h.fake.bulbs.geometry.getAttribute('color').array as Float32Array)).toEqual(bulb);
  });
  it('hat geometry is small and cheap', () => {
    const g = hatGeometry(); expect(g.getAttribute('position').count).toBeLessThan(1500);
  });
});
