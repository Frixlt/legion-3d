import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Ragdoll, makeShape, separateRagdolls, pushOutOfCapsule, type RagdollEnv, type ShapeDims } from '../src/combat/physics';
import { Zombies, separation, ZOMBIE_SPACE, type ZombieTarget } from '../src/combat/zombies';
import { Fx } from '../src/combat/fx';
import { SwingTrail } from '../src/combat/trail';
import type { Avatar } from '../src/contracts/modules';

const DIMS: ShapeDims = {
  y0: 0.07, top: 1.2, w: 0.3, depth: 0.9, armY: 0.62, shoulder: [0.27, 0.62, 0], hand: [0.085, -0.175, -0.03],
  hip: [0.12, 0.11, 0], tailBase: [0, 0.2, 0.25], tailTip: [0.09, 0.56, 0.45], hasLegs: true, hasTail: true,
};
const flat: RagdollEnv = { groundAt: () => 0, blocked: () => false };
const dist = (a: Ragdoll, b: Ragdoll) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);

describe('cats bump into each other (ragdoll separation)', () => {
  it('two knocked-over cats that land on the same spot end up side by side, not inside each other', () => {
    const a = new Ragdoll(makeShape(DIMS)), b = new Ragdoll(makeShape(DIMS));
    a.init(0, 0, 0, 0); b.init(0.1, 0, 0.05, 0.5);
    a.impulse(0.5, 2.5, 0, 0, 0.9, 0, 0.3); b.impulse(-0.5, 2.5, 0, 0.1, 0.9, 0.05, 0.3);   // both tossed onto one spot
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      a.step(1 / 60, flat); b.step(1 / 60, flat);
      separateRagdolls(a, b, 0.5);
      if (i > 60) worst = Math.max(worst, separateRagdolls(a, b, 0));
    }
    const r = a.sphere(0).r + b.sphere(0).r;
    expect(dist(a, b)).toBeGreaterThan(r * 0.8);
    expect(worst).toBeLessThan(r * 0.25);   // no deep overlap once they have settled
    expect(Array.from(a.p).every(Number.isFinite) && Array.from(b.p).every(Number.isFinite)).toBe(true);
  });

  it('without separation the same throw ends with the bodies overlapping (the test above is meaningful)', () => {
    const a = new Ragdoll(makeShape(DIMS)), b = new Ragdoll(makeShape(DIMS));
    a.init(0, 0, 0, 0); b.init(0.1, 0, 0.05, 0.5);
    a.impulse(0.5, 2.5, 0, 0, 0.9, 0, 0.3); b.impulse(-0.5, 2.5, 0, 0.1, 0.9, 0.05, 0.3);
    for (let i = 0; i < 180; i++) { a.step(1 / 60, flat); b.step(1 / 60, flat); }
    expect(separateRagdolls(a, b, 0)).toBeGreaterThan(0.05);
  });

  it('a lying cat slides out of a standing one', () => {
    const a = new Ragdoll(makeShape(DIMS));
    a.init(0.1, 0, 0, 0);
    for (let i = 0; i < 90; i++) { a.step(1 / 60, flat); pushOutOfCapsule(a, 0, 0, 0, 0.3, 1.2, 0.5); }
    const s = a.sphere(0);
    expect(Math.hypot(s.x, s.z)).toBeGreaterThan((s.r + 0.3) * 0.85);
  });
});

/** A minimal avatar for the minions (no meshes). */
function fakeAv(): Avatar {
  const root = new THREE.Group();
  return { root, headTop: 1.2, update() {}, setLod() {}, play() {}, dispose() { root.removeFromParent(); }, setAlpha() {}, setFirstPerson() {}, setAppearance() {} } as unknown as Avatar;
}

describe('zombie separation', () => {
  it('separation pushes away from close neighbours only, harder when closer', () => {
    const o = { x: 0, z: 0 };
    separation(0, 0, [0.2, 5], [0, 0], 2, -1, ZOMBIE_SPACE, o);
    expect(o.x).toBeLessThan(0);
    expect(o.z).toBeCloseTo(0);
    const near = { x: 0, z: 0 }, far = { x: 0, z: 0 };
    separation(0, 0, [0.1], [0], 1, -1, ZOMBIE_SPACE, near);
    separation(0, 0, [0.6], [0], 1, -1, ZOMBIE_SPACE, far);
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x));
    const self = { x: 0, z: 0 };
    separation(0, 0, [0], [0], 1, 0, ZOMBIE_SPACE, self);   // skips itself
    expect(self.x).toBe(0);
  });

  it('three minions raised on one spot spread out while walking to the same cat, and keep off other cats', () => {
    const z = new Zombies(() => fakeAv());
    const fx = new Fx();
    for (let i = 0; i < 3; i++) z.summon(0.01 * i, 0, 0, 0, fx);
    const targets: ZombieTarget[] = [{ id: 'a', x: 0, y: 0, z: -8, down: false }, { id: 'b', x: 0.3, y: 0, z: -3, down: false }];
    let minCat = Infinity;
    for (let i = 0; i < 60 * 4; i++) {
      z.update(1 / 60, i / 60, targets, flat, fx, () => {});
      fx.update(1 / 60, new THREE.PerspectiveCamera(), 720);
      if (i > 90) for (const q of z.list) minCat = Math.min(minCat, Math.hypot(q.x - 0.3, q.z + 3));
    }
    const L = z.list;
    expect(L.length).toBe(3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(L[i].x - L[j].x, L[i].z - L[j].z)).toBeGreaterThan(0.45);
    for (const q of L) expect(q.z).toBeLessThan(-1);   // they did walk towards the target
    expect(minCat).toBeGreaterThan(0.35);              // and went round the cat in the way
    z.dispose();
  });
});

describe('effects plumbing', () => {
  it('the swing trail fills while swinging and hides 150 ms after the last sample', () => {
    const tr = new SwingTrail();
    tr.begin('#fff');
    for (let i = 0; i < 6; i++) { tr.push(0, 1, -i * 0.1, 0.5, 1, -i * 0.1, i / 60); tr.update(i / 60); }
    expect(tr.count).toBeGreaterThan(6);       // refined between raw samples
    expect(tr.mesh.visible).toBe(true);
    tr.update(5 / 60 + 0.16);
    expect(tr.mesh.visible).toBe(false);
    tr.dispose();
  });

  it('all ground rings and light pools share one instanced draw call; one-frame pools free themselves', () => {
    const fx = new Fx(), cam = new THREE.PerspectiveCamera();
    for (let i = 0; i < 5; i++) fx.ring(i, 0, 0, 0.1, 1, 0.5, '#fff');
    fx.ring(0, 0, 0, 0, 0.8, -1, '#8fd4ff', 0.6, 1, 1);
    fx.update(1 / 60, cam, 720);
    const meshes: THREE.Object3D[] = [];
    fx.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === 'combat-rings') meshes.push(o); });
    expect(meshes.length).toBe(1);
    expect((meshes[0] as THREE.InstancedMesh).count).toBe(6);
    fx.update(1 / 60, cam, 720);
    expect(fx.ringCount).toBe(5);
    fx.dispose();
  });
});
