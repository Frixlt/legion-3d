/** Test helper: the static city (node, no DOM) wrapped as the pieces a seasonal event needs. */
import * as THREE from 'three';
import { staticCity } from './world-fixture';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { fromX, fromZ, toX, toZ } from '../src/world/coords';
import { doorInteractables } from '../src/world/worldExt';
import type { PlaceCity } from '../src/events/halloween/placement';
import type { EventContext } from '../src/events/types';
import type { QualityLevel } from '../src/contracts';

export function eventCity() {
  const { L, k, spec, groundAt } = staticCity();
  const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
  const inter = doorInteractables(L, groundAt, () => undefined);
  const doors = inter.map((d, i) => { const b = d.hit as THREE.Box3; const bd = L.buildings[i]; return { x: toX(bd.door.x), z: toZ(bd.door.y), box: [b.min.x, b.max.x, b.min.z, b.max.z] as [number, number, number, number] }; });
  const spawn = { x: toX(L.QW + 660), z: toZ(1010) };
  const place: PlaceCity = {
    groundAt: (X, Z) => groundAt(fromX(X), fromZ(Z)), top: (X, Z) => top(fromX(X), fromZ(Z)), free: (X, Z) => L.free(fromX(X), fromZ(Z)),
    area: { x0: toX(L.area.x0), x1: toX(L.area.x1), z0: 0, z1: toZ(L.area.y1) }, doors,
    stairs: spec.stairs.map((s) => [toX(s[0]), toX(s[1])] as [number, number]), ledgeZ: toZ(spec.rampY0), spawn,
  };
  return { L, spec, groundAt, top, inter, place, spawn };
}

/** A minimal fake world root with the named parts the Halloween hooks look for (bulbs, lamp glows, sky dome, moon, a wall). */
export function fakeWorldRoot() {
  const root = new THREE.Group(); root.name = 'world';
  const garlands = new THREE.Group(); garlands.name = 'world:garlands';
  const bg = new THREE.BufferGeometry(), N = 60, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N).fill(0.2);
  for (let i = 0; i < N; i++) { pos[i * 3] = 5 + i * 0.8; pos[i * 3 + 1] = 3.6 - Math.sin(i / 9) * 0.3; pos[i * 3 + 2] = 3.2; col[i * 3] = 1.4; col[i * 3 + 1] = 1.1; col[i * 3 + 2] = 0.3; }
  bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3)); bg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const bulbs = new THREE.Points(bg, new THREE.PointsMaterial()); bulbs.name = 'fx:bulbs'; garlands.add(bulbs); root.add(garlands);
  const cg = new THREE.BufferGeometry(), cp: number[] = [];
  for (let i = 0; i < 40; i++) { const x0 = 5 + i * 1.0, x1 = x0 + 1.0, y0 = 3.6 - 0.3 * Math.sin((i / 40) * Math.PI), y1 = 3.6 - 0.3 * Math.sin(((i + 1) / 40) * Math.PI); cp.push(x0, y0, 3.2, x1, y1, 3.2); }
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  const cable = new THREE.LineSegments(cg, new THREE.LineBasicMaterial()); cable.name = 'fx:cable'; garlands.add(cable);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([8, 3.2, 2.5, 18, 3.2, 2.5, 30, 3.2, 2.5, 44, 3.2, 2.5]), 3));
  lg.setAttribute('size', new THREE.BufferAttribute(new Float32Array([1.7, 1.7, 1.7, 1.7]), 1));
  const lamps = new THREE.Points(lg, new THREE.PointsMaterial()); lamps.name = 'fx:glow'; root.add(lamps);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 4, 4), new THREE.ShaderMaterial({ uniforms: {
    c0: { value: new THREE.Color('#0f0d2a') }, c1: { value: new THREE.Color('#1d1a4a') }, c2: { value: new THREE.Color('#3a2f6e') }, c3: { value: new THREE.Color('#5a3a7a') }, hz: { value: new THREE.Color('#9a6aa0') } } }));
  dome.name = 'sky:dome'; root.add(dome);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial()); moon.scale.setScalar(46); moon.renderOrder = -8; root.add(moon);
  const st = new THREE.Group(); st.name = 'world:static';
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(200, 12), new THREE.MeshBasicMaterial()); wall.name = 'city:plaster'; wall.position.set(28, 6, 0); wall.updateMatrixWorld(); st.add(wall);
  root.add(st);
  return { root, bulbs, moon, dome, wall };
}

export interface Harness { ctx: EventContext; scene: THREE.Scene; frame(n: number, dt?: number): number; setQuality(q: QualityLevel): void; hooks: number }
export function eventHarness(q: QualityLevel = 2): Harness & { city: ReturnType<typeof eventCity>; fake: ReturnType<typeof fakeWorldRoot> } {
  const city = eventCity(), fake = fakeWorldRoot();
  const scene = new THREE.Scene(); scene.add(fake.root);
  scene.fog = new THREE.Fog('#8a6a9a', 34, 260); scene.background = new THREE.Color('#0f0d2a');
  const group = new THREE.Group(); scene.add(group);
  const frames = new Set<(dt: number, t: number) => void>(), qfns = new Set<(q: QualityLevel) => void>();
  let level = q, t = 0;
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400); camera.position.set(city.spawn.x, 1.15, city.spawn.z);
  const world = {
    root: fake.root, spawn: [city.L.QW + 660, 1010] as [number, number], doors: [], update() {}, setQuality() {}, dispose() {},
    groundAt: (x: number, y: number) => city.groundAt(x, y), solidTop: (x: number, y: number) => city.top(x, y), interactables: () => city.inter,
  } as unknown as EventContext['world'];
  const ctx: EventContext = {
    group, scene, world, layout: city.L, groundAt: (X, Z) => city.place.groundAt(X, Z),
    onFrame: (fn) => { frames.add(fn); return () => frames.delete(fn); },
    quality: () => level, onQuality: (fn) => { qfns.add(fn); return () => qfns.delete(fn); },
    renderer: { domElement: { height: 720 } }, camera, toast: () => {},
  };
  return {
    ctx, scene, city, fake,
    frame(n, dt = 1 / 60) { const t0 = performance.now(); for (let i = 0; i < n; i++) { t += dt; for (const f of [...frames]) f(dt, t); } return (performance.now() - t0) / n; },
    setQuality(nq) { level = nq; for (const f of [...qfns]) f(nq); },
    get hooks() { return frames.size + qfns.size; },
  };
}

/** Put the real batched static city (named 'city:<material>' meshes, standard materials) under the fake root's 'world:static'. */
export async function withRealStatic(fake: ReturnType<typeof fakeWorldRoot>): Promise<THREE.Mesh[]> {
  const { staticCity } = await import('./world-fixture');
  const { k } = staticCity();
  const mats: Record<string, THREE.Material> = {};
  for (const key of ['brick', 'plaster', 'wood', 'roof', 'stone', 'rock', 'metal', 'canvas', 'paving', 'lowPaving', 'leaf', 'flat', 'dark', 'glass', 'back', 'emit', 'glow', 'sign', 'water']) {
    mats[key] = new THREE.MeshStandardMaterial({ color: '#ffffff' }); mats[key].name = 'city:' + key;
  }
  const meshes = k.b.build(mats as never, { castShadow: () => false, receiveShadow: () => false });
  const st = fake.root.getObjectByName('world:static')!;
  for (const m of meshes) st.add(m);
  fake.root.updateMatrixWorld(true);
  return meshes;
}

/** A fake cat for the event game API: a root with a two-bone rig (root, body) like src/avatar (head skinned to the body). */
export function fakeCat(x: number, y: number, z: number, opts: { top?: number; headTop?: number } = {}) {
  const root = new THREE.Group(); root.position.set(x, y, z);
  const b0 = new THREE.Bone(), b1 = new THREE.Bone(); b1.position.set(0, 0.6, 0); b0.add(b1); root.add(b0);
  const top = opts.top ?? 1.2, headTop = opts.headTop ?? top + 0.1;
  const rest = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.6, 0)];
  root.updateMatrixWorld(true);
  return { root, headTop, combatRig: () => ({ bones: [b0, b1], rest, top, headTop, w: 0.3 }) };
}

/** A fake EventGame recording keys and knocks; `act` toggles canAct(). */
export function fakeGame(cats: Map<string, ReturnType<typeof fakeCat>>, me?: ReturnType<typeof fakeCat>) {
  const keys = new Map<string, { code: string; run: () => boolean }>(), knocks: string[] = [];
  const st = { act: true, meVisible: true, swings: 0 };
  const game: import('../src/events/types').EventGame = {
    key: (id, code, _label, run) => { keys.set(id, { code, run }); return () => keys.delete(id); },
    canAct: () => st.act,
    forEachCat: (fn) => { for (const [id, c] of cats) fn(id, c); },
    me: () => (me ? { av: me, visible: st.meVisible } : null),
    knock: (id) => { knocks.push(id); return true; },
    swing: () => { st.swings++; },
    reducedMotion: false,
  };
  return { game, keys, knocks, st };
}
