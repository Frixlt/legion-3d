import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventCity, eventHarness, withRealStatic, fakeCat, fakeGame } from './events-fixture';
import { planNewYear, snowCoverMesh } from '../src/events/newyear/placement';
import { firTreeGeometry, snowCapGeometry, TREE_RADIUS, TREE_TOP } from '../src/events/newyear/geo';
import { driftTexture, splatTexture, snowCoverTexture } from '../src/events/newyear/tex';
import newyear, { NEWYEAR_BUDGET, type NewYearInfo } from '../src/events/newyear';
import { Grid, DOOR_CLEAR } from '../src/events/halloween/placement';

const city = eventCity();
const plan = planNewYear(city.place);
const boxDist = (x: number, z: number, b: number[]) => Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - z, 0, z - b[3]));
const d = (y: number, m: number, day: number, h = 12) => new Date(y, m - 1, day, h);

const drawables = (root: THREE.Object3D) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { const m = o as THREE.InstancedMesh; if ((m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) && o.visible && (!m.isInstancedMesh || m.count > 0)) { let v = true; o.traverseAncestors((a) => { if (!a.visible) v = false; }); if (v) out.push(o); } });
  return out;
};

describe('new year: calendar', () => {
  it('Dec 20 – Jan 10 inclusive, across the year boundary, at any hour', () => {
    for (const [y, m, day, want] of [[2026, 12, 19, false], [2026, 12, 20, true], [2026, 12, 31, true], [2027, 1, 1, true], [2027, 1, 10, true], [2027, 1, 11, false], [2026, 7, 1, false]] as [number, number, number, boolean][]) {
      expect(newyear.active(d(y, m, day)), `${m}/${day}`).toBe(want);
      expect(newyear.active(d(y, m, day, 0)), `${m}/${day} 00h`).toBe(want);
      expect(newyear.active(new Date(y, m - 1, day, 23, 59, 59)), `${m}/${day} 23:59`).toBe(want);
    }
    expect(newyear.distance!(d(2026, 12, 15))).toBe(5);
    expect(newyear.distance!(d(2027, 1, 13))).toBe(3);
  });
});

describe('new year: placement', () => {
  it('is deterministic; the tree stands on the most open flat spot near the spawn, clear of doors and the spawn', () => {
    expect(JSON.stringify(planNewYear(city.place))).toBe(JSON.stringify(plan));
    const t = plan.tree!;
    expect(t).toBeTruthy();
    const g = new Grid(city.place);
    expect(g.flat(t.x, t.z, TREE_RADIUS, 0.03)).toBe(true);
    for (const dd of city.place.doors) expect(boxDist(t.x, t.z, dd.box) - TREE_RADIUS).toBeGreaterThanOrEqual(DOOR_CLEAR - 1e-6);
    expect(Math.hypot(t.x - city.spawn.x, t.z - city.spawn.z)).toBeGreaterThan(3);
    expect(Math.abs(t.y - city.place.groundAt(t.x, t.z))).toBeLessThan(1e-6);
  });
  it('drifts hug walls: never float over lower ground (higher ground / walls only hide their edge), never on stairs, ≥ 0.6 m from doors', () => {
    expect(plan.drifts.length).toBeGreaterThanOrEqual(NEWYEAR_BUDGET[2].drifts);
    const g = new Grid(city.place);
    for (const f of plan.drifts) {
      expect(g.distAt(f.x, f.z)).toBeLessThan(0.4);
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) {
        const X = f.x + dx * f.r * 0.95, Z = f.z + dz * f.r * 0.95;
        if (city.place.top(X, Z) === -Infinity) expect(f.y - city.place.groundAt(X, Z), `drop under drift ${f.x},${f.z}`).toBeLessThan(0.031);
      }
      for (const [s0, s1] of city.place.stairs) expect(f.x > s0 - 0.6 && f.x < s1 + 0.6).toBe(false);
      for (const dd of city.place.doors) expect(boxDist(f.x, f.z, dd.box)).toBeGreaterThanOrEqual(DOOR_CLEAR + f.r * 0.8 - 1e-6);
    }
    for (let i = 0; i < plan.drifts.length; i++) for (let j = i + 1; j < plan.drifts.length; j++) expect(Math.hypot(plan.drifts[i].x - plan.drifts[j].x, plan.drifts[i].z - plan.drifts[j].z)).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });
  it('the snow cover lies 1 cm over flat open ground only (never over water, a drop or a stair ramp)', () => {
    const c = snowCoverMesh(city.place), p = c.position;
    expect(p.length / 18).toBeGreaterThan(1500);
    for (let i = 0; i < p.length; i += 3) {
      const g = city.place.groundAt(p[i], p[i + 2]);
      expect(Math.abs(p[i + 1] - g - 0.01), `cover at ${p[i]},${p[i + 2]}`).toBeLessThan(1e-4);
    }
  });
});

describe('new year: geometry + textures', () => {
  it('fir tree ≈ 3 m tall, fits its footprint, cheap; textures have soft alpha', () => {
    const g = firTreeGeometry(); g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.y).toBeGreaterThan(2.8); expect(b.max.y).toBeLessThan(TREE_TOP + 0.05); expect(b.min.y).toBeGreaterThanOrEqual(-0.1);
    expect(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z)).toBeLessThanOrEqual(TREE_RADIUS + 0.05);
    expect(g.getAttribute('position').count / 3).toBeLessThan(8000);
    for (const t of [driftTexture(32), splatTexture(32), snowCoverTexture(64)]) {
      const a = t.image.data as Uint8Array; let mn = 255, mx = 0; for (let i = 3; i < a.length; i += 4) { mn = Math.min(mn, a[i]); mx = Math.max(mx, a[i]); }
      expect(mn).toBe(0); expect(mx).toBeGreaterThan(150);
    }
  });
  it('snow caps grow only from up-facing faces high above the street, lifted off them', async () => {
    const h = eventHarness(2); const meshes = await withRealStatic(h.fake);
    const g = snowCapGeometry(meshes.filter((m) => !/glass|emit|glow|sign|water|dark|paving/i.test(m.name)), h.ctx.groundAt)!;
    expect(g).toBeTruthy();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), T = p.count / 3;
    expect(T).toBeGreaterThan(2000);
    for (let t = 0; t < T; t++) {
      expect(n.getY(t * 3)).toBeGreaterThan(0.34);
      const cx = (p.getX(t * 3) + p.getX(t * 3 + 1) + p.getX(t * 3 + 2)) / 3, cy = (p.getY(t * 3) + p.getY(t * 3 + 1) + p.getY(t * 3 + 2)) / 3, cz = (p.getZ(t * 3) + p.getZ(t * 3 + 1) + p.getZ(t * 3 + 2)) / 3;
      expect(cy).toBeGreaterThan(h.ctx.groundAt(cx, cz) + 0.35);
    }
  });
});

describe('new year: lifecycle', () => {
  it('q2 budget: ≤ 15 draw calls, no real lights, CPU well under 0.5 ms/frame', async () => {
    const h = eventHarness(2); await withRealStatic(h.fake);
    const dispose = newyear.setup(h.ctx);
    const per = h.frame(300);
    const objs = drawables(h.ctx.group);
    expect(objs.length).toBeLessThanOrEqual(15);
    expect(objs.map((o) => o.name).sort()).toEqual(expect.arrayContaining(['newyear:caps', 'newyear:cover', 'newyear:drifts', 'newyear:tree', 'newyear:star', 'newyear:lights', 'newyear:snowfall']));
    expect(per).toBeLessThan(0.5);
    h.ctx.group.traverse((o) => { expect((o as THREE.Light).isLight).toBeFalsy(); expect(o.castShadow).toBeFalsy(); });
    dispose();
  });
  it('quality scales flakes / drifts / lights; reduced motion switches the snowfall off', () => {
    const counts = ([0, 1, 2, 3] as const).map((q) => {
      const h = eventHarness(q); const dispose = newyear.setup(h.ctx); h.frame(2);
      const flakes = h.ctx.group.getObjectByName('newyear:snowfall') as THREE.Points, drifts = h.ctx.group.getObjectByName('newyear:drifts') as THREE.InstancedMesh;
      const r = { flakes: flakes.geometry.drawRange.count, drifts: drifts.count, calls: drawables(h.ctx.group).length };
      dispose(); return r;
    });
    for (let i = 1; i < 4; i++) { expect(counts[i].flakes).toBeGreaterThan(counts[i - 1].flakes); expect(counts[i].drifts).toBeGreaterThanOrEqual(counts[i - 1].drifts); }
    expect(counts[0].flakes).toBeLessThanOrEqual(300);
    const h = eventHarness(2); const { game } = fakeGame(new Map()); h.ctx.game = { ...game, reducedMotion: true };
    const dispose = newyear.setup(h.ctx); h.frame(2);
    expect(h.ctx.group.getObjectByName('newyear:snowfall')!.visible).toBe(false);
    dispose();
  });
  it('toggle off restores everything: bulbs, paving colour, scene, hooks, key binding; geometries disposed; twice', async () => {
    const h = eventHarness(3), f = h.fake; await withRealStatic(f);
    const { game, keys } = fakeGame(new Map()); h.ctx.game = game;
    const bulbCol = Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array);
    const paving = (f.root.getObjectByName('world:static')!.children as THREE.Mesh[]).filter((m) => /paving/i.test(m.name)).map((m) => m.material as THREE.MeshStandardMaterial);
    expect(paving.length).toBeGreaterThan(0);
    const pav0 = paving.map((m) => m.color.toArray().join());
    const before = { scene: h.scene.children.length, root: f.root.children.length, group: h.ctx.group.children.length };
    const disposed: string[] = [];
    const dispose = newyear.setup(h.ctx);
    h.ctx.group.traverse((o) => { const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (g) g.addEventListener('dispose', () => disposed.push(g.uuid)); });
    h.frame(30);
    expect(Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array)).not.toEqual(bulbCol);
    expect(paving[0].color.b).toBeGreaterThan(1.05);
    expect(keys.get('event.snowball')?.code).toBe('KeyG');
    expect(h.hooks).toBeGreaterThan(0);
    dispose();
    expect(h.ctx.group.children.length).toBe(before.group); expect(h.scene.children.length).toBe(before.scene); expect(f.root.children.length).toBe(before.root);
    expect(h.hooks).toBe(0); expect(keys.size).toBe(0);
    expect(Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array)).toEqual(bulbCol);
    expect(paving.map((m) => m.color.toArray().join())).toEqual(pav0);
    expect(disposed.length).toBeGreaterThanOrEqual(9);
    const d2 = newyear.setup(h.ctx); h.frame(5); d2();
    expect(h.ctx.group.children.length).toBe(0); expect(paving.map((m) => m.color.toArray().join())).toEqual(pav0);
  });
});

describe('new year: snowballs (#22)', () => {
  const setup = async (cats = new Map<string, ReturnType<typeof fakeCat>>()) => {
    const h = eventHarness(2);
    const fg = fakeGame(cats); h.ctx.game = fg.game;
    const dispose = newyear.setup(h.ctx);
    const info = h.ctx.group.getObjectByName('event:newyear')!.userData.newyear as NewYearInfo;
    return { h, fg, dispose, snow: info.snow! };
  };
  it('G throws only when the game says the street action is allowed (no room / menu / modal / typing / photo / aimed)', async () => {
    const { h, fg, dispose, snow } = await setup();
    const key = fg.keys.get('event.snowball')!;
    fg.st.act = false; expect(key.run()).toBe(false); h.frame(2); expect(snow.stats.thrown).toBe(0);
    fg.st.act = true; expect(key.run()).toBe(true); expect(snow.stats.thrown).toBe(1); expect(fg.st.swings).toBe(1);
    expect(key.run()).toBe(true); expect(snow.stats.thrown, 'cooldown').toBe(1);
    dispose();
  });
  it('a ball flies an arc and splats on the wall it hits (12 mm off the surface, facing out); melts away', async () => {
    const { h, dispose, snow } = await setup();
    const cam = h.ctx.camera; cam.position.set(21.8, 1.6, 3.5); cam.lookAt(21.8, 2.2, -2); cam.updateMatrixWorld();
    snow.throw(); h.frame(60);
    expect(snow.active()).toBe(0);
    expect(snow.stats.wall + snow.stats.prop).toBe(1);
    expect(snow.splats.count).toBe(1);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); snow.splats.getMatrixAt(0, m); p.setFromMatrixPosition(m);
    expect(p.z).toBeCloseTo(0.012, 3);
    h.frame(400);
    expect(snow.splats.count).toBe(0);
    dispose();
  });
  it('thrown at the ground it leaves a ground splat ≥ 6 mm above the paving; a cat in the way gets a puff + knock', async () => {
    const cats = new Map([['cat1', fakeCat(24.6, city.place.groundAt(24.6, 1.6), 1.6)]]);
    const { h, fg, dispose, snow } = await setup(cats);
    const cam = h.ctx.camera; cam.position.set(24.6, 1.15, 4.2); cam.lookAt(24.6, 0.3, 1.6); cam.updateMatrixWorld();
    snow.throw(); h.frame(60);
    expect(snow.stats.cat).toBe(1); expect(fg.knocks).toEqual(['cat1']);
    cats.clear();
    cam.lookAt(26.5, -2, 3.3); cam.updateMatrixWorld();
    h.frame(30); snow.throw(); h.frame(60);
    expect(snow.stats.ground).toBe(1);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); snow.splats.getMatrixAt(snow.splats.count - 1, m); p.setFromMatrixPosition(m);
    expect(p.y - city.place.groundAt(p.x, p.z)).toBeGreaterThanOrEqual(0.006);
    dispose();
  });
});
