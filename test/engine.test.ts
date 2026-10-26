import { describe, it, expect } from 'vitest';
import type { CityLayout } from '../src/contracts';
import { createPlayerController } from '../src/engine/player';
import { AutoGovernor } from '../src/engine/quality';
import { Spring, wrapAngle, dampAngle } from '../src/engine/math';
import { SX, SZ } from '../src/world/coords';
import { fixtureLayout } from '../dev/fixtures';

/** Open field 0..4000 × 800..2000 with optional boxes [x0,y0,x1,y1] (px). */
function field(boxes: [number, number, number, number][] = [], path?: CityLayout['path']): CityLayout {
  const free = (x: number, y: number) => {
    if (x < 0 || x > 4000 || y < 800 || y > 2000) return false;
    for (const b of boxes) if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return false;
    return true;
  };
  return {
    id: 't', styleId: 'cats', W: 4000, H: 2000, QW: 0, area: { x0: 0, x1: 4000, y0: 800, y1: 2000 },
    obstacles: [], buildings: [], free, nearest: (x, y) => [x, y], path,
  };
}
const flat = () => 0;
const input = (x: number, y: number, run = false) => ({ move: { x, y }, run }) as any;
const STILL = input(0, 0);

/** Run n frames of dt with the same input; return metres travelled (3D). */
function run(p: ReturnType<typeof createPlayerController>, inp: any, yaw: number, secs: number, dt = 1 / 60) {
  const x0 = p.x, y0 = p.y;
  for (let t = 0; t < secs - 1e-9; t += dt) p.update(dt, inp, yaw);
  return { dX: (p.x - x0) * SX, dZ: (p.y - y0) * SZ };
}

describe('PlayerController movement', () => {
  it('walks ~2.3 m/s and runs ~4.6 m/s after acceleration', () => {
    const p = createPlayerController(field(), flat);
    p.teleport(2000, 1400);
    const yaw = Math.PI / 2;                       // walk along −X: plenty of room
    run(p, input(0, 1), yaw, 1);                   // accelerate
    const d = run(p, input(0, 1), yaw, 1);
    expect(Math.hypot(d.dX, d.dZ)).toBeCloseTo(2.3, 1);
    expect(p.speed).toBeCloseTo(230, -1);          // x-px/s convention (= site SPEED)
    run(p, input(0, 1, true), yaw, 1);
    const r = run(p, input(0, 1, true), yaw, 1);
    expect(Math.hypot(r.dX, r.dZ)).toBeCloseTo(4.6, 1);
  });

  it('speed is uniform in 3D in every direction (depth px are 2× metres)', () => {
    const dists: number[] = [];
    for (const yaw of [0, Math.PI / 2, Math.PI / 4, 1.1, Math.PI, -2.3]) {
      const p = createPlayerController(field(), flat);
      p.teleport(2000, 1400);
      run(p, input(0, 1), yaw, 1);
      const d = run(p, input(0, 1), yaw, 1);
      dists.push(Math.hypot(d.dX, d.dZ));
    }
    for (const d of dists) expect(d).toBeCloseTo(dists[0], 2);
  });

  it('diagonal input is not faster than straight', () => {
    const p = createPlayerController(field(), flat);
    p.teleport(2000, 1400);
    run(p, input(1, 1), 0, 1);
    const d = run(p, input(1, 1), 0, 1);
    expect(Math.hypot(d.dX, d.dZ)).toBeCloseTo(2.3, 1);
  });

  it('W with yaw 0 goes to −Z (smaller y), D goes to +X; face follows the contract convention', () => {
    const p = createPlayerController(field(), flat);
    p.teleport(2000, 1400);
    const d = run(p, input(0, 1), 0, 0.5);
    expect(d.dZ).toBeLessThan(-0.3);
    expect(Math.abs(d.dX)).toBeLessThan(1e-6);
    expect(Math.abs(wrapAngle(p.face))).toBeLessThan(0.05);   // face 0 = looking to −Z
    const q = createPlayerController(field(), flat);
    q.teleport(2000, 1400);
    const e = run(q, input(1, 0), 0, 0.5);
    expect(e.dX).toBeGreaterThan(0.3);
    // facing +X: forward (−sin f, −cos f) = (1, 0) → f = −π/2
    expect(wrapAngle(q.face)).toBeCloseTo(-Math.PI / 2, 1);
    // yaw = π/2 (looking to −X): W moves to −X
    const r = createPlayerController(field(), flat);
    r.teleport(2000, 1400);
    const g = run(r, input(0, 1), Math.PI / 2, 0.5);
    expect(g.dX).toBeLessThan(-0.3);
  });

  it('is frame-rate independent', () => {
    const a = createPlayerController(field(), flat);
    const b = createPlayerController(field(), flat);
    a.teleport(2000, 1400); b.teleport(2000, 1400);
    run(a, input(0.3, 1), 0.4, 2, 1 / 30);
    run(b, input(0.3, 1), 0.4, 2, 1 / 144);
    expect(Math.abs(a.x - b.x) * SX).toBeLessThan(0.03);
    expect(Math.abs(a.y - b.y) * SZ).toBeLessThan(0.03);
  });

  it('accelerates and stops smoothly', () => {
    const p = createPlayerController(field(), flat);
    p.teleport(2000, 1400);
    p.update(1 / 60, input(0, 1), 0);
    expect(p.speed).toBeGreaterThan(0);
    expect(p.speed).toBeLessThan(100);
    run(p, input(0, 1), 0, 1);
    run(p, STILL, 0, 0.6);
    expect(p.speed).toBe(0);
  });

  it('tolerates a stub input and dt = 0', () => {
    const p = createPlayerController(field(), flat);
    p.teleport(2000, 1400);
    expect(p.update(0, input(0, 1), 0)).toBe(false);
    expect(p.update(1 / 60, { move: { x: 0, y: 0 }, run: false } as any, 0)).toBe(false);
    expect(p.update(1 / 60, undefined as any, 0)).toBe(false);
  });
});

describe('PlayerController collision', () => {
  it('never enters an obstacle and stops at a wall', () => {
    const wall: [number, number, number, number] = [1900, 1000, 2100, 1300];   // in front of the player (−Z)
    const p = createPlayerController(field([wall]), flat);
    p.teleport(2000, 1400);
    for (let i = 0; i < 300; i++) {
      p.update(1 / 60, input(0, 1, true), 0);
      expect(p.y > 1300 || p.x < 1900 || p.x > 2100).toBe(true);
    }
    expect(p.y).toBeGreaterThan(1300);
    expect(p.y).toBeLessThan(1310);
    expect(p.speed).toBeLessThan(5);
  });

  it('slides along a wall when moving diagonally into it', () => {
    const wall: [number, number, number, number] = [0, 1000, 4000, 1300];   // long wall across
    const p = createPlayerController(field([wall]), flat);
    p.teleport(2000, 1320);
    run(p, input(0, 1), Math.PI / 4 * -1, 0.5);   // W with yaw −45°: forward = (sin45, −cos45) → +X and −Z
    const before = p.x;
    const d = run(p, input(0, 1), -Math.PI / 4, 1);
    expect(p.y).toBeGreaterThan(1300);
    expect(p.x).toBeGreaterThan(before + 0.5 / SX);   // keeps sliding along x
    expect(Math.abs(d.dZ)).toBeLessThan(0.05);
    // body turns along the wall (+X ⇒ face ≈ −π/2)
    expect(wrapAngle(p.face)).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('does not tunnel through thin walls at large dt', () => {
    const wall: [number, number, number, number] = [1900, 1380, 2100, 1384];   // 4 px thick in depth
    const p = createPlayerController(field([wall]), flat);
    p.teleport(2000, 1440);
    for (let i = 0; i < 30; i++) p.update(0.1, input(0, 1, true), 0);
    expect(p.y).toBeGreaterThan(1384);
  });

  it('escapes when spawned inside an obstacle', () => {
    const wall: [number, number, number, number] = [1900, 1300, 2100, 1500];
    const p = createPlayerController(field([wall]), flat);
    p.teleport(2000, 1490);
    run(p, input(0, -1), 0, 1);   // walk back (+Z) out of the box
    expect(p.y).toBeGreaterThan(1500);
  });

  it('stays on the walkable grid of the real fair city fixture', () => {
    const L = fixtureLayout();
    const p = createPlayerController(L, flat);
    const [sx, sy] = L.nearest(2750, 1000);
    p.teleport(sx, sy);
    let yaw = 0;
    for (let i = 0; i < 1500; i++) {
      if (i % 90 === 0) yaw += 1.3;
      p.update(1 / 60, input(i % 200 < 100 ? 0.4 : -0.2, 1, i % 300 > 150), yaw);
      expect(L.free(p.x, p.y)).toBe(true);
    }
  });
});

describe('PlayerController walkTo', () => {
  it('walks along layout.path and arrives', () => {
    const path = (a: [number, number], b: [number, number]): [number, number][] => [a, [a[0], 1600], [b[0], 1600], b];
    const p = createPlayerController(field([[1000, 1000, 3000, 1500]], path), flat);
    p.teleport(900, 1400);
    p.walkTo(3200, 1400);
    expect(p.walking).toBe(true);
    for (let i = 0; i < 60 * 20 && p.walking; i++) p.update(1 / 60, STILL, 0);
    expect(p.walking).toBe(false);
    expect(Math.abs(p.x - 3200)).toBeLessThan(6);
    expect(Math.abs(p.y - 1400)).toBeLessThan(3);
  });

  it('is cancelled by movement input', () => {
    const p = createPlayerController(field(), flat);
    p.teleport(2000, 1400);
    p.walkTo(3000, 1400);
    p.update(1 / 60, STILL, 0);
    p.update(1 / 60, input(0, 1), 0);
    expect(p.walking).toBe(false);
  });

  it('works without layout.path (straight line)', () => {
    const p = createPlayerController(field(), flat);
    p.teleport(2000, 1400);
    p.walkTo(2100, 1500);
    for (let i = 0; i < 600 && p.walking; i++) p.update(1 / 60, STILL, 0);
    expect(Math.hypot(p.x - 2100, p.y - 1500)).toBeLessThan(5);
  });

  it('samples ground height', () => {
    const p = createPlayerController(field(), (x) => x * 0.001);
    p.teleport(2000, 1400);
    expect(p.ground).toBeCloseTo(2, 5);
    run(p, input(1, 0), 0, 1);
    expect(p.ground).toBeCloseTo(p.x * 0.001, 5);
  });
});

describe('math + quality', () => {
  it('critically damped spring converges without overshoot, frame-rate independent', () => {
    const a = new Spring(0), b = new Spring(0);
    let maxA = 0;
    for (let i = 0; i < 60; i++) { a.step(1, 12, 1 / 60); maxA = Math.max(maxA, a.x); }
    for (let i = 0; i < 240; i++) b.step(1, 12, 1 / 240);
    expect(maxA).toBeLessThanOrEqual(1 + 1e-9);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.x).toBeGreaterThan(0.99);
  });

  it('dampAngle takes the short way round', () => {
    const r = dampAngle(3.1, -3.1, 1000, 1);
    expect(Math.abs(wrapAngle(r + 3.1))).toBeLessThan(1e-6);
  });

  it('auto governor scales down on slow frames, then steps the level, and recovers', () => {
    const g = new AutoGovernor(2, 3);
    let t = 0;
    const feed = (ms: number, secs: number) => { for (let s = 0; s < secs; s += ms / 1000) { t += ms / 1000; g.sample(ms, t); } };
    feed(30, 1.2);
    expect(g.scale).toBeLessThan(1);
    expect(g.level).toBe(2);
    feed(40, 12);
    expect(g.level).toBeLessThan(2);
    const lv = g.level;
    feed(8, 60);
    expect(g.scale).toBe(1);
    expect(g.level).toBeGreaterThan(lv);
  });
});
