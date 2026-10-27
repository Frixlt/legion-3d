/**
 * Free 3D flight (owner feedback v0.4.0): with a fly map the controller flies over rivers / fences / walk-grid gaps,
 * bumps into walls below their tops, lands on roofs, walks on them and drops back onto the walk grid; Ctrl = down.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { CityLayout } from '../src/contracts';
import { createPlayerController } from '../src/engine/player';
import { FlightLogic, FLY } from '../src/flight/rules';
import { dilate, gridTop, type HeightGrid } from '../src/flight/heightfield';

// test city (px): x 0..4000, depth 800..2000; a 5 m house, a 0.9 m fence across the street, a canal (water −0.6 m)
const HOUSE = [1000, 1000, 1400, 1200] as const;
const FENCE = [0, 1395, 4000, 1405] as const;
const CANAL = [0, 1500, 4000, 1600] as const;
const inB = (x: number, y: number, b: readonly number[]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const inArea = (x: number, y: number) => x >= 0 && x <= 4000 && y >= 800 && y <= 2000;
const free = (x: number, y: number) => inArea(x, y) && !inB(x, y, HOUSE) && !inB(x, y, FENCE) && !inB(x, y, CANAL);
const solidTop = (x: number, y: number) => !inArea(x, y) ? Infinity : inB(x, y, HOUSE) ? Infinity : inB(x, y, FENCE) ? 0.9 : inB(x, y, CANAL) ? Infinity : -Infinity;
const flyTop = (x: number, y: number) => !inArea(x, y) ? Infinity : inB(x, y, HOUSE) ? 5 : inB(x, y, FENCE) ? 0.9 : inB(x, y, CANAL) ? -0.6 : 0;
const layout: CityLayout = { id: 't', styleId: 'cats', W: 4000, H: 2000, QW: 0, area: { x0: 0, x1: 4000, y0: 800, y1: 2000 }, obstacles: [], buildings: [], free, nearest: (x, y) => [x, y] };
const DT = 1 / 60;
const inp = (x: number, y: number, run = false) => ({ move: { x, y }, run, jump: false }) as any;
const TO_PLUS_Y = Math.PI, TO_PLUS_X = -Math.PI / 2;   // camera yaw for "forward = +y" / "+x"
const mk = () => { const p = createPlayerController(layout, () => 0, { solidTop }); p.setFlyMap(flyTop); return p; };
const run = (p: ReturnType<typeof mk>, s: number, i: any, yaw: number) => { for (let k = 0; k < s * 60; k++) p.update(DT, i, yaw); };

describe('free 3D flight (fly map)', () => {
  it('flies over the fence and the canal (walls for walking)', () => {
    const p = mk(); p.teleport(2500, 1300);
    p.setFlight(1.3);
    expect(p.free3d).toBe(true);
    run(p, 1, inp(0, 0), 0);
    run(p, 3, inp(0, 1), TO_PLUS_Y);
    expect(p.y).toBeGreaterThan(1600);   // past the fence and the canal
    expect(p.feetY).toBeGreaterThan(1);
  });

  it('a wall stops you below its top; above it you fly over the roof and the hover follows the roof', () => {
    const p = mk(); p.teleport(800, 1100);
    p.setFlight(2);
    run(p, 1.5, inp(0, 0), 0);
    run(p, 2, inp(0, 1), TO_PLUS_X);
    expect(p.x).toBeLessThan(1000);       // the facade at 2 m: blocked
    p.setFlight(4);
    run(p, 3, inp(0, 0), 0);              // feet ≈ 4 m > the 5 m roof? no: still below → blocked
    run(p, 1, inp(0, 1), TO_PLUS_X);
    expect(p.x).toBeLessThan(1000);
    p.setFlight(6);
    run(p, 3, inp(0, 0), 0);
    run(p, 1.2, inp(0, 1), TO_PLUS_X);
    expect(p.x).toBeGreaterThan(1050);    // over the roof
    expect(p.ground).toBe(5);
    run(p, 3, inp(0, 0), 0);
    expect(p.feetY).toBeGreaterThan(10);  // 6 m above the roof
  });

  it('lands on a roof and stays there, walks on it, walks off its edge and is back on the walk grid', () => {
    const p = mk(); p.teleport(800, 1100);
    let lands = 0; p.onLand(() => lands++);
    p.setFlight(6); run(p, 3, inp(0, 0), 0);
    run(p, 1.2, inp(0, 1), TO_PLUS_X);
    p.setFlight(0); run(p, 4, inp(0, 0), 0);
    p.setFlight(null); run(p, 0.5, inp(0, 0), 0);
    expect(lands).toBe(1);
    expect(p.flying).toBe(false);
    expect(p.feetY).toBeCloseTo(5, 3);
    expect(p.free3d).toBe(true);
    expect(free(p.x, p.y)).toBe(false);    // on the roof, off the walk grid
    run(p, 1, inp(0, 1), TO_PLUS_X);       // walk along the roof
    expect(p.feetY).toBeCloseTo(5, 3);
    expect(p.airborne).toBe(false);
    run(p, 6, inp(0, 1), TO_PLUS_X);       // off the far edge: fall to the street
    expect(p.x).toBeGreaterThan(1400);
    expect(p.feetY).toBeCloseTo(0, 3);
    expect(lands).toBe(2);
    expect(p.free3d).toBe(false);          // back to the normal rules
    expect(free(p.x, p.y)).toBe(true);
  });

  it('random flights never leave the map and never end inside a solid', () => {
    let seed = 11;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const s of [[500, 900], [2000, 1300], [3900, 1990], [1200, 1900]] as const) {
      const p = mk(); p.teleport(s[0], s[1]);
      let yaw = 0, mx = 0, my = 1, h = 3, bad = 0;
      p.setFlight(h);
      for (let i = 0; i < 60 * 30; i++) {
        if (i % 50 === 0) { yaw = rnd() * 6.28; mx = Math.round(rnd() * 2 - 1); my = Math.round(rnd() * 2 - 1) || 1; h = rnd() * 8; p.setFlight(h); }
        p.update(DT, inp(mx, my, rnd() < 0.3), yaw);
        if (!inArea(p.x, p.y)) bad++;
        if (p.feetY < flyTop(p.x, p.y) - 1e-6) bad++;
      }
      expect(bad).toBe(0);
    }
  });

  it('removing the fly map on a roof puts the hero back on the walk grid', () => {
    const p = mk(); p.teleport(800, 1100);
    p.setFlight(6); run(p, 3, inp(0, 0), 0); run(p, 1.2, inp(0, 1), TO_PLUS_X);
    p.setFlight(null); run(p, 3, inp(0, 0), 0);
    expect(free(p.x, p.y)).toBe(false);
    p.setFlyMap(null);
    expect(free(p.x, p.y)).toBe(true);
    expect(p.free3d).toBe(false);
    expect(p.feetY).toBe(0);
  });

  it('over water the flight refuses to land (keeps a floor), next to it it lands', () => {
    const f = new FlightLogic();
    for (let i = 0; i < 30 && f.phase === 'off'; i++) f.update(DT, { up: true, down: false, airborne: true, above: 0.5, allowed: true, max: FLY.maxStreet });
    let h: number | null = 0;
    for (let i = 0; i < 60 * 4; i++) h = f.update(DT, { up: false, down: true, airborne: true, above: h ?? 0, allowed: true, max: FLY.maxStreet, floor: 0.45 });
    expect(f.phase).toBe('fly'); expect(h).toBeCloseTo(0.45, 5);
    for (let i = 0; i < 60 * 2 && f.phase !== 'off'; i++) h = f.update(DT, { up: false, down: true, airborne: true, above: Math.max(0, (h ?? 0) - 0.3), allowed: true, max: FLY.maxStreet });
    expect(f.phase).toBe('off');
  });
});

describe('height grid', () => {
  it('lookup by world metres and a 3×3 dilation (thin posts are not missed)', () => {
    const g: HeightGrid = { x0: -1, z0: -1, ppm: 10, w: 20, h: 20, data: new Float32Array(400).fill(0) };
    g.data[10 * 20 + 10] = 3;
    expect(gridTop(g, 0.05, 0.05)).toBe(3);
    expect(gridTop(g, 0.15, 0.05)).toBe(0);
    dilate(g);
    expect(gridTop(g, 0.15, 0.15)).toBe(3);
    expect(gridTop(g, -0.05, -0.05)).toBe(3);
    expect(gridTop(g, 0.25, 0.05)).toBe(0);
    expect(gridTop(g, 5, 5)).toBe(-Infinity);
  });
});

/* ---- Ctrl = down while flying (src/engine/input.ts holdCtrl) ---- */
const listeners = new Map<string, Set<(e: any) => void>>();
const on = (k: string, f: (e: any) => void) => { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(f); };
const off = (k: string, f: (e: any) => void) => { listeners.get(k)?.delete(f); };
const fire = (k: string, e: any) => { for (const f of listeners.get(k) ?? []) f(e); };
const key = (code: string, mods: { ctrl?: boolean } = {}) => ({ code, key: code, target: null, repeat: false, ctrlKey: !!mods.ctrl, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });

describe('input: bare Ctrl while flying', () => {
  beforeAll(() => {
    (globalThis as any).Element = class {};
    (globalThis as any).window = Object.assign(globalThis as any, { addEventListener: (k: string, f: any) => on('w:' + k, f), removeEventListener: (k: string, f: any) => off('w:' + k, f) });
    (globalThis as any).document = {
      addEventListener: (k: string, f: any) => on('d:' + k, f), removeEventListener: (k: string, f: any) => off('d:' + k, f),
      pointerLockElement: null, exitPointerLock: vi.fn(), activeElement: null,
    };
  });
  const target = () => ({ addEventListener() {}, removeEventListener() {}, requestPointerLock() {} }) as unknown as HTMLElement;

  it('holdCtrl: Ctrl is held as a key and W stays pressed; Ctrl+<key> still releases (browser chord)', async () => {
    const { createInput } = await import('../src/engine/input');
    const i = createInput(target());
    fire('w:keydown', key('KeyW'));
    expect(i.move.y).toBe(1);
    // not flying: a Ctrl press releases everything (old behaviour)
    fire('w:keydown', key('ControlLeft', { ctrl: true }));
    expect(i.move.y).toBe(0); expect(i.ctrl).toBe(false);
    fire('w:keyup', key('ControlLeft'));
    // flying
    i.holdCtrl = true;
    fire('w:keydown', key('KeyW'));
    fire('w:keydown', key('ControlLeft', { ctrl: true }));
    expect(i.move.y).toBe(1);
    expect(i.ctrl).toBe(true);
    fire('w:keyup', key('ControlLeft'));
    expect(i.ctrl).toBe(false); expect(i.move.y).toBe(1);
    fire('w:keydown', key('ControlRight', { ctrl: true }));
    fire('w:keydown', key('KeyS', { ctrl: true }));       // Ctrl+S: the browser's
    expect(i.move.y).toBe(0); expect(i.ctrl).toBe(false);
    i.holdCtrl = false;
    i.dispose();
  });
});
