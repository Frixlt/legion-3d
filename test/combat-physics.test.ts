import { describe, it, expect } from 'vitest';
import { Ragdoll, makeShape, NP, A, C, type RagdollEnv, type ShapeDims } from '../src/combat/physics';

const DIMS: ShapeDims = {
  y0: 0.07, top: 1.2, w: 0.3, depth: 0.9, armY: 0.62,
  shoulder: [0.27, 0.62, 0], hand: [0.085, -0.175, -0.03], hip: [0.12, 0.11, 0],
  tailBase: [0, 0.2, 0.25], tailTip: [0.09, 0.56, 0.45], hasLegs: true, hasTail: true,
};
const flat: RagdollEnv = { groundAt: () => 0, blocked: () => false };

const finite = (r: Ragdoll) => Array.from(r.p).every(Number.isFinite) && Array.from(r.basis).every(Number.isFinite);
const minY = (r: Ragdoll) => { let m = Infinity; for (let i = 0; i < NP; i++) m = Math.min(m, r.p[i * 3 + 1]); return m; };

describe('ragdoll physics', () => {
  it('a hit cat falls over, settles and stays finite and rigid', () => {
    const r = new Ragdoll(makeShape(DIMS));
    r.init(2, 0, -3, 0.7);
    r.impulse(5, 3, -1, 2, 1.0, -3);
    for (let i = 0; i < 60 * 4; i++) {
      r.step(1 / 60, flat);
      expect(finite(r)).toBe(true);
    }
    expect(r.bodyError()).toBeLessThan(0.03);
    const le = r.limbError();
    expect(le.len).toBeLessThan(0.01);
    expect(le.angle).toBeLessThan(0.05);
    // lying: the up axis is far from vertical, it rests on the ground and has stopped
    expect(r.basis[4]).toBeLessThan(0.75);
    expect(minY(r)).toBeGreaterThan(-0.02);
    expect(r.speed).toBeLessThan(0.3);
    expect(r.still).toBeGreaterThan(0.2);
  });

  it('energy decays after the impulse', () => {
    const r = new Ragdoll(makeShape(DIMS));
    r.init(0, 0, 0, 0);
    r.impulse(6, 4, 0, 0, 1.1, 0);
    r.step(1 / 60, flat);
    const e0 = r.energy();
    let last = e0;
    for (let s = 0; s < 5; s++) { for (let i = 0; i < 60; i++) r.step(1 / 60, flat); const e = r.energy(); expect(e).toBeLessThan(Math.max(last, e0) + 1e-6); last = e; }
    expect(last).toBeLessThan(e0 * 0.02);
  });

  it('is frame-rate independent enough and survives huge dt and stacked impulses', () => {
    const a = new Ragdoll(makeShape(DIMS)), b = new Ragdoll(makeShape(DIMS));
    a.init(0, 0, 0, 0); b.init(0, 0, 0, 0);
    a.impulse(4, 2, 0, 0, 1, 0); b.impulse(4, 2, 0, 0, 1, 0);
    for (let i = 0; i < 120; i++) a.step(1 / 60, flat);
    for (let i = 0; i < 60; i++) b.step(1 / 30, flat);
    expect(Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2])).toBeLessThan(0.05);
    const c = new Ragdoll(makeShape(DIMS));
    c.init(0, 0, 0, 0);
    for (let k = 0; k < 20; k++) { c.impulse(80, 60, -50, 0, 1, 0, 1); c.step(5, flat); }
    for (let i = 0; i < 600; i++) c.step(1 / 60, flat);
    expect(finite(c)).toBe(true);
    expect(c.bodyError()).toBeLessThan(0.05);
  });

  it('respects walls and uneven ground', () => {
    const env: RagdollEnv = { groundAt: (x) => (x > 1 ? 0.3 : 0), blocked: (x) => x < -0.6 };
    const r = new Ragdoll(makeShape(DIMS));
    r.init(0, 0, 0, 0);
    r.impulse(-9, 1, 0, 0, 0.8, 0, 0.2);
    for (let i = 0; i < 300; i++) r.step(1 / 60, env);
    for (const i of [A, C]) expect(r.p[i * 3]).toBeGreaterThan(-0.62);
    const s = new Ragdoll(makeShape(DIMS));
    s.init(1.5, 0.3, 0, 0);
    for (let i = 0; i < 200; i++) s.step(1 / 60, env);
    expect(minY(s)).toBeGreaterThan(0.27);
  });

  it('without an impulse it only slumps where it stands (no drift, no explosion)', () => {
    const r = new Ragdoll(makeShape(DIMS));
    r.init(0, 0, 0, 0);
    for (let i = 0; i < 240; i++) r.step(1 / 60, flat);
    expect(finite(r)).toBe(true);
    expect(Math.hypot(r.p[0], r.p[2])).toBeLessThan(0.6);
    expect(minY(r)).toBeGreaterThan(-0.02);
  });
});

describe('ragdoll physics: steps', () => {
  it('sliding onto a raised step never launches the body', () => {
    const env: RagdollEnv = { groundAt: (x) => (x > 0.8 ? 0.2 : 0), blocked: () => false };
    const r = new Ragdoll(makeShape(DIMS));
    r.init(0, 0, 0, Math.PI / 2);
    r.impulse(6, 2.5, 0, 0, 1, 0);
    let top = 0;
    for (let i = 0; i < 240; i++) { r.step(1 / 60, env); top = Math.max(top, r.p[1]); }
    expect(top).toBeLessThan(1.2);
  });
});
