import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fx, SH_GLOW, SH_STAR } from '../src/combat/fx';
import { Projectiles } from '../src/combat/projectiles';

const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 100);

describe('combat particles', () => {
  it('ages out particles and keeps the pool packed', () => {
    const fx = new Fx();
    for (let i = 0; i < 50; i++) fx.emit(SH_GLOW, 0, 1, 0, 1, 1, 0, 0.5 + (i % 5) * 0.1, 0.1, 0.05, 1, 1, 1);
    expect(fx.count).toBe(50);
    fx.update(0.55, cam, 720);
    expect(fx.count).toBe(40);
    for (let i = 0; i < 20; i++) fx.update(0.05, cam, 720);
    expect(fx.count).toBe(0);
  });
  it('one-frame particles survive exactly one update at any frame rate', () => {
    const fx = new Fx();
    fx.emit(SH_STAR, 0, 1, 0, 0, 0, 0, 0, 0.2, 0.2, 1, 1, 0);
    fx.update(0.25, cam, 720);       // a slow frame: still drawn this frame
    expect(fx.count).toBe(1);
    fx.update(0.016, cam, 720);
    expect(fx.count).toBe(0);
  });
  it('never grows past its pool', () => {
    const fx = new Fx();
    for (let i = 0; i < 5000; i++) fx.emit(SH_GLOW, 0, 0, 0, 0, 0, 0, 1, 0.1, 0.1, 1, 1, 1);
    expect(fx.count).toBeLessThanOrEqual(700);
    fx.update(0.016, cam, 720);
    fx.dispose();
  });
});

describe('projectiles', () => {
  const env = { groundAt: () => 0, blocked: (_x: number, z: number) => z < -10 };
  it('an arrow hits a cat in its path and reports the hit', () => {
    const fx = new Fx(), shots = new Projectiles();
    shots.fire('arrow', 0, 1, 0, 0, 0.5, -25);
    const hits: string[] = [];
    for (let i = 0; i < 60 && shots.active; i++) shots.update(1 / 60, [{ id: 'cat', x: 0, y: 0, z: -5, r: 0.34, h: 1.2, down: false }], env, fx, (_k, i2) => hits.push(['cat'][i2]), () => {});
    expect(hits).toEqual(['cat']);
    expect(shots.active).toBe(0);
  });
  it('a missed arrow falls under gravity, sticks in the wall, then disappears', () => {
    const fx = new Fx(), shots = new Projectiles();
    shots.fire('arrow', 0, 1.2, 0, 0, 1, -30);
    let stuck = 0;
    for (let i = 0; i < 60; i++) shots.update(1 / 60, [], env, fx, () => {}, () => { stuck++; });
    expect(stuck).toBe(1);
    expect(shots.active).toBe(1);
    expect(shots.flying).toBe(0);
    for (let i = 0; i < 60 * 6; i++) shots.update(1 / 60, [], env, fx, () => {}, () => {});
    expect(shots.active).toBe(0);
    shots.dispose(); fx.dispose();
  });
  it('arrows shot down stick into the ground', () => {
    const fx = new Fx(), shots = new Projectiles();
    shots.fire('arrow', 0, 1, 0, 0, -5, -8);
    let at: number[] = [];
    for (let i = 0; i < 60; i++) shots.update(1 / 60, [], env, fx, () => {}, (_k, x, y, z) => { at = [x, y, z]; });
    expect(at.length).toBe(3);
    expect(at[1]).toBeLessThan(0.3);
  });
});
