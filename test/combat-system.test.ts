import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CombatSystem, MAX_RAGDOLLS, MAX_FLASHES, type CombatHost } from '../src/combat';
import type { CombatAvatar } from '../src/combat/ragdoll';
import type { CombatRig } from '../src/avatar/avatar';

/** A stand-in for an avatar: the real bone layout (src/avatar/model.ts B) without meshes. */
function fakeAvatar(): CombatAvatar & { site: THREE.Vector3; flash: number; dizzy: boolean } {
  const root = new THREE.Group();
  const rest = [[0, 0, 0], [0, 0.07, 0], [-0.27, 0.62, 0], [0.27, 0.62, 0], [-0.12, 0.11, 0], [0.12, 0.11, 0], [0, 0.2, 0.25], [0, 0.43, 0.42], [0, 0.95, 0.2], [0, 0.5, 0.3], [0.355, 0.445, -0.03]]
    .map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const parent = [-1, 0, 1, 1, 0, 0, 1, 6, 1, 8, 3];
  const bones = rest.map(() => new THREE.Bone());
  bones.forEach((b, i) => { b.position.copy(rest[i]); if (parent[i] >= 0) { b.position.sub(rest[parent[i]]); bones[parent[i]].add(b); } });
  root.add(bones[0]);
  const rig: CombatRig = { bones, rest, handL: new THREE.Vector3(-0.085, -0.175, -0.03), handR: new THREE.Vector3(0.085, -0.175, -0.03), y0: 0.07, top: 1.2, w: 0.3, depth: 0.9, eyeY: 0.85, ex: 0.11, armY: 0.62, headTop: 1.3, hasTail: true, hasLegs: true };
  const av = {
    root, headTop: 1.3, site: new THREE.Vector3(), flash: 0, dizzy: false,
    combatRig: () => rig, setFlash(a: number) { av.flash = a; }, setDizzy(on: boolean) { av.dizzy = on; },
    setDraw() {}, hitStop() {}, play() {}, update() {}, setLod() {}, setAlpha() {}, setFirstPerson() {}, setAppearance() {}, dispose() {},
  };
  return av as unknown as CombatAvatar & { site: THREE.Vector3; flash: number; dizzy: boolean };
}

function world(n: number) {
  const scene = new THREE.Scene();
  const cats = Array.from({ length: n }, (_, i) => { const a = fakeAvatar(); a.site.set((i % 4) * 1.5 - 2, 0, -1.5 - Math.floor(i / 4) * 1.5); a.root.position.copy(a.site); scene.add(a.root); return a; });
  const me = fakeAvatar(); scene.add(me.root);
  const host: CombatHost = {
    scene, camera: new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 100),
    forEachTarget: (fn) => cats.forEach((c, i) => fn('cat' + i, c)),
    env: () => ({ groundAt: () => 0, blocked: () => false }),
    me: { av: me, feet: new THREE.Vector3(), fp: () => true, app: () => ({ login: 'me', name: 'me', styleId: 'cats', look: {}, gear: { w: 'sword' } } as never) },
    createAvatar: () => fakeAvatar(), viewHeight: () => 720, quality: () => 2,
  };
  const sys = new CombatSystem(host);
  // the "crowd": every frame the site position is restored before combat runs
  const frame = (t: number) => { for (const c of cats) { c.root.position.copy(c.site); c.root.rotation.set(0, 0, 0); } sys.update(1 / 60, t); };
  return { sys, cats, frame };
}

describe('combat system', () => {
  it('a slash knocks over the cats in front, and they all come back to their site spot upright', () => {
    const { sys, cats, frame } = world(4);
    let t = 0;
    frame(t);
    expect(sys.press()).toBe(true);
    expect(sys.press()).toBe(false);              // cooldown
    for (let i = 0; i < 30; i++) frame((t += 1 / 60));
    expect(sys.ragdolls.size).toBeGreaterThan(0);
    const hit = [...sys.ragdolls.keys()];
    for (let i = 0; i < 60; i++) frame((t += 1 / 60));
    const lying = [...sys.ragdolls.values()].filter((r) => r.phase === 'fall' || r.phase === 'down');
    expect(lying.length).toBeGreaterThan(0);
    for (const r of sys.ragdolls.values()) expect(Array.from(r.phys.p).every(Number.isFinite)).toBe(true);
    for (let i = 0; i < 60 * 10; i++) frame((t += 1 / 60));
    expect(sys.ragdolls.size).toBe(0);
    for (const id of hit) {
      const c = cats[+id.slice(3)];
      expect(c.root.position.distanceTo(c.site)).toBeLessThan(1e-6);
      expect(Math.abs(c.root.rotation.x) + Math.abs(c.root.rotation.z)).toBeLessThan(1e-6);
      expect(c.dizzy).toBe(false);
      expect(c.flash).toBe(0);
    }
  });

  it(`keeps at most ${MAX_RAGDOLLS} ragdolls lying at once (the oldest gets up early)`, () => {
    const { sys, cats, frame } = world(9);
    let t = 0;
    cats.forEach((c, i) => { sys.hit('cat' + i, c, 3, 3, 0, c.site.x, 1, c.site.z, 0.02); for (let k = 0; k < 20; k++) frame((t += 1 / 60)); });
    const lying = [...sys.ragdolls.values()].filter((r) => r.phase === 'fall' || r.phase === 'down');
    expect(lying.length).toBeLessThanOrEqual(MAX_RAGDOLLS);
  });

  it('reset puts everyone back at once', () => {
    const { sys, cats, frame } = world(3);
    cats.forEach((c, i) => sys.hit('cat' + i, c, 4, 3, 0, c.site.x, 1, c.site.z, 0));
    for (let k = 0; k < 40; k++) frame(k / 60);
    sys.reset();
    expect(sys.ragdolls.size).toBe(0);
    for (const c of cats) expect(c.dizzy).toBe(false);
  });

  it('the per-frame cost with 6 ragdolls stays far below budget', () => {
    const { sys, cats, frame } = world(6);
    cats.forEach((c, i) => sys.hit('cat' + i, c, 4, 3, -1, c.site.x, 1, c.site.z, 0));
    let t = 0;
    for (let k = 0; k < 30; k++) frame((t += 1 / 60));
    const t0 = performance.now();
    for (let k = 0; k < 300; k++) frame((t += 1 / 60));
    const ms = (performance.now() - t0) / 300;
    expect(ms).toBeLessThan(0.6);
  });

  it(`flashes at most ${MAX_FLASHES} cats at once (each flash is a draw call)`, () => {
    const { sys, cats, frame } = world(6);
    cats.forEach((c, i) => sys.hit('cat' + i, c, 3, 3, 0, c.site.x, 1, c.site.z, 0.02));
    expect(cats.filter((c) => c.flash > 0).length).toBeLessThanOrEqual(MAX_FLASHES);
    frame(1 / 60);
    expect(cats.filter((c) => c.flash > 0).length).toBeLessThanOrEqual(MAX_FLASHES);
  });

  it('knocked-over cats that land together are pushed apart, and get up with a shake-off', () => {
    const { sys, cats, frame } = world(2);
    // throw both onto the same spot
    sys.hit('cat0', cats[0], 1.4, 3, 0, cats[0].site.x, 1, cats[0].site.z, 0, 0, 0);
    sys.hit('cat1', cats[1], -1.4, 3, 0, cats[1].site.x, 1, cats[1].site.z, 0, 0, 0);
    let t = 0;
    const phases = new Set<string>();
    for (let i = 0; i < 60 * 8; i++) {
      frame((t += 1 / 60));
      for (const r of sys.ragdolls.values()) phases.add(r.phase);
      if (i === 120) {
        const [a, b] = [...sys.ragdolls.values()].map((r) => r.phys);
        expect(Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2])).toBeGreaterThan(0.35);
      }
    }
    expect(phases.has('shake')).toBe(true);
    expect(sys.ragdolls.size).toBe(0);
  });
});
