import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventHarness, fakeGame } from './events-fixture';
import summer, { canalSpans, lanternGeometry, SUMMER_BUDGET } from '../src/events/summer';
import { groundSpec } from '../src/world/ground';
import { toX } from '../src/world/coords';

const d = (m: number, day: number, h = 12) => new Date(2026, m - 1, day, h);
const drawables = (root: THREE.Object3D) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { const m = o as THREE.InstancedMesh; if ((m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) && o.visible && (!m.isInstancedMesh || m.count > 0)) out.push(o); });
  return out;
};
const positions = (m: THREE.InstancedMesh) => { const out: THREE.Vector3[] = [], mm = new THREE.Matrix4(); for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mm); out.push(new THREE.Vector3().setFromMatrixPosition(mm)); } return out; };

describe('summer lanterns', () => {
  it('window Jun 21 – Jul 7', () => {
    for (const [m, day, want] of [[6, 20, false], [6, 21, true], [7, 1, true], [7, 7, true], [7, 8, false], [12, 31, false]] as [number, number, boolean][]) expect(summer.active(d(m, day)), `${m}/${day}`).toBe(want);
  });
  it('canal spans lie between the bridges', () => {
    const h = eventHarness(2), c = canalSpans(h.ctx)!, s = groundSpec(h.ctx.layout);
    expect(c.spans.length).toBeGreaterThanOrEqual(s.bridges.length - 1); expect(c.spans.length).toBeLessThanOrEqual(s.bridges.length + 1);
    for (const [a, b] of c.spans) for (const [b0, b1] of s.bridges) expect(b <= toX(b0) || a >= toX(b1)).toBe(true);
  });
  it('lantern geometry: unit height, cheap', () => {
    const g = lanternGeometry(); g.computeBoundingBox();
    expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(1, 2); expect(g.getAttribute('position').count).toBeLessThan(1000);
  });
  it('q2: ≤ 15 draw calls, no real lights; lanterns float on the canal water between the bridges, the rest above heads', () => {
    const h = eventHarness(2), dispose = summer.setup(h.ctx);
    const per = h.frame(240);
    expect(drawables(h.ctx.group).length).toBeLessThanOrEqual(15);
    expect(per).toBeLessThan(0.5);
    h.ctx.group.traverse((o) => expect((o as THREE.Light).isLight).toBeFalsy());
    const c = canalSpans(h.ctx)!, L = h.ctx.group.getObjectByName('summer:lanterns') as THREE.InstancedMesh;
    const info = h.ctx.group.getObjectByName('event:summer')!.userData.summer;
    expect(info.water).toBeGreaterThanOrEqual(SUMMER_BUDGET[2].water);
    const ps = positions(L);
    expect(ps.length).toBe(SUMMER_BUDGET[2].water + SUMMER_BUDGET[2].sky + Math.min(SUMMER_BUDGET[2].hang, info.hang));
    for (const p of ps.slice(0, SUMMER_BUDGET[2].water)) {
      expect(p.z).toBeGreaterThan(c.z0); expect(p.z).toBeLessThan(c.z1);
      expect(c.spans.some(([a, b]) => p.x >= a - 1e-6 && p.x <= b + 1e-6), `x ${p.x}`).toBe(true);
      expect(p.y - c.y).toBeLessThan(0.3); expect(p.y).toBeGreaterThan(c.y - 0.03);
    }
    for (const p of ps.slice(SUMMER_BUDGET[2].water)) expect(p.y - h.ctx.groundAt(p.x, p.z)).toBeGreaterThan(1.8);
    dispose();
  });
  it('q0 / reduced motion: still lanterns, no fireflies; q2 drifts', () => {
    const still = (q: 0 | 2, reduced = false) => {
      const h = eventHarness(q); const fg = fakeGame(new Map()); h.ctx.game = { ...fg.game, reducedMotion: reduced };
      const dispose = summer.setup(h.ctx); h.frame(2);
      const L = h.ctx.group.getObjectByName('summer:lanterns') as THREE.InstancedMesh, a = positions(L);
      h.frame(120); const b = positions(L);
      const r = { moved: a.some((p, i) => p.distanceTo(b[i]) > 1e-4), halos: h.ctx.group.getObjectByName('summer:halos')!.visible, flies: h.ctx.group.getObjectByName('summer:fireflies')!.visible };
      dispose(); return r;
    };
    expect(still(0)).toEqual({ moved: false, halos: true, flies: false });
    expect(still(2, true)).toMatchObject({ moved: false, flies: false });
    expect(still(2)).toEqual({ moved: true, halos: true, flies: true });
  });
  it('toggle off restores the bulbs, the scene and the hooks', () => {
    const h = eventHarness(3), f = h.fake, bulb = Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array), kids = h.scene.children.length;
    const dispose = summer.setup(h.ctx); h.frame(10);
    expect(Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array)).not.toEqual(bulb);
    dispose();
    expect(Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array)).toEqual(bulb);
    expect(h.ctx.group.children.length).toBe(0); expect(h.scene.children.length).toBe(kids); expect(h.hooks).toBe(0);
  });
});
