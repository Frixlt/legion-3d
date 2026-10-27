import { describe, it, expect } from 'vitest';
import type { CityLayout } from '../src/contracts';
import { createPlayerController } from '../src/engine/player';
import { canFly, FlightLogic, FLY } from '../src/flight/rules';

/**
 * Test city (px), like test/engine-jump.test.ts: open field x 0..4000, depth 800..2000, a bench (grid-blocked,
 * top 0.5 m), a wall (Infinity), a ledge gap 1600..1660 (lower street at −1.4 m).
 */
const BENCH = [1950, 1300, 2050, 1325, 0.5] as const;
const WALL = [950, 1300, 1050, 1325, Infinity] as const;
const SOLIDS = [BENCH, WALL];
const inBox = (x: number, y: number, b: readonly number[]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const free = (x: number, y: number) => {
  if (x < 0 || x > 4000 || y < 800 || y > 2000) return false;
  if (y >= 1600 && y <= 1660) return false;
  for (const b of SOLIDS) if (inBox(x, y, b)) return false;
  return true;
};
const groundAt = (_x: number, y: number) => (y < 1630 ? 0 : -1.4);
const solidTop = (x: number, y: number) => {
  if (x < 0 || x > 4000 || y < 800 || y > 2000) return Infinity;
  for (const b of SOLIDS) if (inBox(x, y, b)) return b[4];
  return -Infinity;
};
const layout: CityLayout = { id: 't', styleId: 'cats', W: 4000, H: 2000, QW: 0, area: { x0: 0, x1: 4000, y0: 800, y1: 2000 }, obstacles: [], buildings: [], free, nearest: (x, y) => [x, y] };
const DT = 1 / 60;
const inp = (x: number, y: number, jump = false, run = false) => ({ move: { x, y }, run, jump }) as any;
const mk = () => createPlayerController(layout, groundAt, { solidTop });

describe('flight: who flies', () => {
  it('mages, necromancers and priests by role; staffs / tomes / crooks by weapon; others not', () => {
    expect(canFly({ role: 'mage', gear: {} } as any)).toBe(true);
    expect(canFly({ role: 'necromancer', gear: {} } as any)).toBe(true);
    expect(canFly({ role: 'priest', gear: {} } as any)).toBe(true);
    expect(canFly({ role: 'archer', gear: { w: 'bow' } } as any)).toBe(false);
    expect(canFly({ role: 'legionary', gear: { w: 'sword' } } as any)).toBe(false);
    expect(canFly({ gear: { w: 'staff' } } as any)).toBe(true);
    expect(canFly({ gear: { w: 'grimoire' } } as any)).toBe(true);
    expect(canFly({ gear: { w: 'crook' } } as any)).toBe(true);
    expect(canFly(null)).toBe(false);
  });
});

describe('flight: controller (setFlight)', () => {
  it('rises to the flight height, never jumps while flying, and lands with onLand after setFlight(null)', () => {
    const p = mk(); p.teleport(2500, 1000);
    let lands = 0, jumps = 0;
    p.onLand(() => lands++); p.onJump(() => jumps++);
    p.setFlight(5);
    expect(p.flying).toBe(true);
    for (let i = 0; i < 180; i++) p.update(DT, inp(0, 0, i % 20 === 0), 0);
    expect(p.feetY).toBeGreaterThan(4.8);
    expect(p.airborne).toBe(true);
    expect(jumps).toBe(0);
    // glide down then end the flight
    p.setFlight(0);
    for (let i = 0; i < 180; i++) p.update(DT, inp(0, 0), 0);
    expect(p.feetY).toBeLessThan(0.05);
    p.setFlight(null);
    for (let i = 0; i < 30; i++) p.update(DT, inp(0, 0), 0);
    expect(p.flying).toBe(false);
    expect(p.airborne).toBe(false);
    expect(lands).toBe(1);
    // and normal jumps work again
    p.update(DT, inp(0, 0, true), 0);
    expect(jumps).toBe(1);
  });

  it('without a 3D fly map (rooms, map not built yet) x/y stay on the walk grid: walls, benches, the ledge gap and the city edge stop you', () => {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const start of [[1000, 1250], [2000, 1280], [1500, 1580], [100, 820], [3900, 1990]] as const) {
      const p = mk(); p.teleport(start[0], start[1]);
      p.setFlight(8);
      let yaw = rnd() * 6.28, mx = 0, my = 1, run = false, bad = 0;
      for (let i = 0; i < 60 * 40; i++) {
        if (i % 45 === 0) { yaw = rnd() * 6.28; mx = Math.round(rnd() * 2 - 1); my = Math.round(rnd() * 2 - 1) || 1; run = rnd() < 0.5; }
        p.update(DT, inp(mx, my, false, run), yaw);
        if (!free(p.x, p.y)) bad++;
      }
      expect(bad).toBe(0);
      expect(p.feetY).toBeGreaterThan(5);
    }
  });

  it('without a fly map flying over the ledge does not cross the walk-grid gap (it would when jumping)', () => {
    const p = mk(); p.teleport(2500, 1550);
    p.setFlight(4);
    for (let i = 0; i < 240; i++) p.update(DT, inp(0, 1), Math.PI);   // towards +y
    expect(p.y).toBeLessThan(1600);
    expect(free(p.x, p.y)).toBe(true);
  });

  it('teleport / setSpace end a flight', () => {
    const p = mk(); p.teleport(2500, 1000); p.setFlight(3);
    for (let i = 0; i < 30; i++) p.update(DT, inp(0, 0), 0);
    p.teleport(2600, 1000);
    expect(p.flying).toBe(false);
    expect(p.feetY).toBe(0);
  });
});

describe('flight: Space / X logic', () => {
  const base = { up: false, down: false, airborne: false, above: 0, allowed: true, max: FLY.maxStreet };

  it('double-tap Space in the air takes off; on the ground or for non-mages it does not', () => {
    const f = new FlightLogic();
    expect(f.tap(false, true, 0, 8)).toBeNull();
    f.update(0.1, base);
    expect(f.tap(false, true, 0, 8)).toBeNull();          // double tap on the ground: nothing
    f.update(0.5, base);
    expect(f.tap(true, false, 0.6, 8)).toBeNull();
    f.update(0.1, { ...base, airborne: true, allowed: false });
    expect(f.tap(true, false, 0.6, 8)).toBe('deny');       // «летают маги»
    f.update(0.5, base);
    f.tap(true, true, 0.6, 8); f.update(0.1, { ...base, airborne: true, above: 0.7 });
    expect(f.tap(true, true, 0.7, 8)).toBe('start');
    expect(f.phase).toBe('fly');
    expect(f.h).toBeGreaterThanOrEqual(FLY.startLift);
  });

  it('holding Space through a jump takes off; Space = up to the max, X = down to a landing', () => {
    const f = new FlightLogic();
    let h: number | null = null;
    for (let i = 0; i < 30 && f.phase === 'off'; i++) h = f.update(DT, { ...base, up: true, airborne: true, above: 0.5 });
    expect(f.phase).toBe('fly');
    for (let i = 0; i < 60 * 5; i++) h = f.update(DT, { ...base, up: true, airborne: true, above: h ?? 0 });
    expect(h).toBe(FLY.maxStreet);
    let above = h!;
    for (let i = 0; i < 60 * 5 && f.phase !== 'off'; i++) { h = f.update(DT, { ...base, down: true, airborne: true, above }); above = Math.max(0, (h ?? 0) * 0.5 + above * 0.5 - 0.01); }
    expect(f.phase).toBe('off');
    expect(h).toBeNull();
  });

  it('a menu / room without flight makes it glide down and end; rooms cap the height at 1 m', () => {
    const f = new FlightLogic();
    for (let i = 0; i < 30 && f.phase === 'off'; i++) f.update(DT, { ...base, up: true, airborne: true, above: 0.5 });
    for (let i = 0; i < 60; i++) f.update(DT, { ...base, up: true, airborne: true, above: 3, max: FLY.maxRoom });
    expect(f.h).toBeLessThanOrEqual(FLY.maxRoom + 1e-9);
    let above = 1;
    for (let i = 0; i < 60 * 4 && f.phase !== 'off'; i++) { const h = f.update(DT, { ...base, allowed: false, airborne: true, above }); above = Math.max(0, (h ?? 0) - 0.02); }
    expect(f.phase).toBe('off');
  });
});
