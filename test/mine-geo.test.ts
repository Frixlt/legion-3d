import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as G from '../src/rooms/mine/geo';
import enter from './fixtures/mine-enter.json';
import fresh from './fixtures/mine-fresh.json';

const dugOf = (s: string) => s.split('').map((c) => (c === '1' ? 1 : 0));
const types = (st: any) => st.fl.c.map((c: any) => c[0]);

describe('mine geometry (port of LGWorldLib.mine)', () => {
  it('has the site constants', () => {
    expect([G.GW, G.GH, G.CW, G.W, G.H, G.YB, G.REACH]).toEqual([7, 12, 128, 1024, 2476, 1956, 200]);
  });
  it('maps px ⇄ room metres (2.4 m per cell, hall at Z < 0)', () => {
    expect(G.mx(512)).toBeCloseTo(0); expect(G.mz(G.YB)).toBeCloseTo(0);
    expect(G.mx(64 + 128) - G.mx(64)).toBeCloseTo(2.4);
    expect(G.mz(G.Y0)).toBeCloseTo(-28.8);
    expect(G.px(G.mx(333))).toBeCloseTo(333); expect(G.py(G.mz(2100))).toBeCloseTo(2100);
  });
  it('reproduces the front stones of a captured live view', () => {
    const st = (enter as any).st;
    expect(G.frontOf(dugOf(st.dug), types(st)).sort((a, b) => a - b)).toEqual([...st.front].sort((a: number, b: number) => a - b));
  });
  it('fresh floor: front = neighbours of the entry and voids', () => {
    const st = (fresh as any).st;
    const f = G.frontOf(dugOf(st.dug), types(st));
    expect(f).toEqual(st.front);
    expect(f.length).toBeGreaterThan(3);
    for (const i of f) expect(G.nbrs(i).some((j) => G.walkable(dugOf(st.dug), j))).toBe(true);
  });
  it('paths only through cleared cells; dig spot prefers the cell below', () => {
    const st = (enter as any).st, dug = dugOf(st.dug);
    const from = G.cellOfPt(300, 2400);
    expect(from).toBeGreaterThanOrEqual(G.N_CELLS);
    const p = G.pathTo(dug, from, 9);
    expect(p).not.toBeNull();
    for (const c of p!.slice(1)) expect(G.walkable(dug, c)).toBe(true);
    expect(G.digSpot(dug, 3)).toBe(10);   // stone 3 (row 0): cell 10 below is dug in the capture
  });
  it('standable: cleared cells and the entrance area minus the objects', () => {
    const dug = dugOf((enter as any).st.dug);
    expect(G.standable(dug, 512, 2300)).toBe(true);          // open entrance floor (between the board and the stall)
    expect(G.standable(dug, 130, 2380)).toBe(false);         // inside the lift
    expect(G.standable(dug, 800, 2350)).toBe(false);         // inside the stall
    const c0 = G.cellXY(0); expect(G.standable(dug, c0.cx, c0.cy)).toBe(false);   // undug stone
    const c2 = G.cellXY(2); expect(G.standable(dug, c2.cx, c2.cy)).toBe(true);    // dug
    expect(G.standable(dug, 20, 1000)).toBe(false);          // side wall of the hall
  });
  it('spawn point is free and in front of the cart', () => {
    const p = G.spawnPt('player1');
    expect(G.standable([], p.x, p.y)).toBe(true);
    expect(p.y).toBeGreaterThan(2300);
  });

  // parity with the site's own library when the read-only site dump is present (.local, git-ignored)
  const LIB = '.local/site-new/world.js';
  it.skipIf(!existsSync(LIB))('matches the site world.js on random inputs', () => {
    const sb: any = { self: {} }; sb.self = sb; runInNewContext(readFileSync(LIB, 'utf8'), sb);
    const WL = sb.LGWorldLib.mine;
    const st = (enter as any).st, dug = dugOf(st.dug);
    let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 400; k++) {
      const x = r() * 1100 - 40, y = r() * 2600 - 60;
      expect(G.cellOfPt(x, y)).toBe(WL.cellOfPt(x, y));
      expect(G.cellAt(x, y)).toBe(WL.cellAt(x, y));
      expect(G.free(x, y)).toEqual(WL.free(x, y));
      expect(G.walkPt(dug, { x, y })).toEqual(WL.walkPt(dug, { x, y }));
      const i = Math.floor(r() * 84), j = Math.floor(r() * 91);
      expect(G.digSpot(dug, i)).toEqual(WL.digSpot(dug, i));
      expect(G.pathTo(dug, j, i)).toEqual(WL.pathTo(dug, j, i));
      const a = G.free(r() * 1000, 1960 + r() * 500), b = G.free(r() * 1000, 1960 + r() * 500);
      expect(G.route(a, b)).toEqual(WL.route(a, b));
    }
  });
});
