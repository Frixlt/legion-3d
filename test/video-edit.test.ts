// The edit trailer's cut (scripts/video/edit-cut.mjs) and the compositor's time maths (edit-compose.mjs):
// beat-grid splice, every shot on the grid, no gaps, sane shot lengths, readable captions, slow-mo time map.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — plain ESM scripts without type declarations
import { buildTimeline, editGrid, lint, WIN0, FPS } from '../scripts/video/edit-cut.mjs';
// @ts-expect-error — plain ESM scripts without type declarations
import { interp, simOf } from '../scripts/video/edit-compose.mjs';
import { rateAt } from '../scripts/video/page/kit';

const grid = JSON.parse(readFileSync(resolve(__dirname, '../scripts/video/edit-grid.json'), 'utf8'));
const tl = buildTimeline(grid);
const EPS = 1e-6;

describe('edit trailer: beat grid', () => {
  it('splices the track: bars 0–31, then its last brutal bar and the cute tail', () => {
    const g = editGrid(grid);
    expect(g.music).toHaveLength(2);
    expect(g.music[0]).toMatchObject({ from: 0, at: 0 });
    expect(g.music[1].at).toBeCloseTo(g.music[0].to, 6);
    expect(g.music[1].from).toBeGreaterThan(90);           // the end of the 113-s track
    // the splice is on a bar of the track (both sides)
    expect(grid.downbeats.some((t: number) => Math.abs(t - g.music[1].from) < 1e-3)).toBe(true);
    expect(grid.downbeats.some((t: number) => Math.abs(t - g.music[0].to) < 1e-3)).toBe(true);
    // bars stay one bar apart across the splice
    for (let i = 1; i < g.bars.length; i++) expect(g.bars[i] - g.bars[i - 1]).toBeGreaterThan(4 * g.period * 0.95);
  });
  it('runs about a minute', () => {
    expect(tl.duration).toBeGreaterThan(55);
    expect(tl.duration).toBeLessThan(66);
  });
});

describe('edit trailer: the cut', () => {
  it('has no gaps, overlaps or out-of-range shots (lint)', () => {
    const win: Record<string, [number, number]> = {};
    for (const c of tl.clips) if (!win[c.src]) win[c.src] = [WIN0[c.src] ?? 0, (WIN0[c.src] ?? 0) + 8];
    expect(lint(tl, win)).toEqual([]);
  });
  it('cuts on the beat grid (full-frame cuts on beats, grid tiles on 1/8 beats; frame-snapped)', () => {
    const P = tl.grid.period, bars: number[] = tl.grid.bars;
    const onGrid = (t: number, div: number) => bars.some((b) => { const k = (t - b) / (P / div); return k > -0.01 && k < 4 * div + 0.01 && Math.abs(k - Math.round(k)) * (P / div) < 1.5 / FPS; });
    for (const c of tl.clips) {
      expect(Math.abs(c.t0 * FPS - Math.round(c.t0 * FPS))).toBeLessThan(EPS * FPS);
      if (c.t0 > 0) expect(onGrid(c.t0, c.z === 1 ? 8 : 1)).toBe(true);
    }
  });
  it('is fast: full-frame shots 0.4–3 s (cards excepted), most ≤ one bar (1.7 s)', () => {
    const full = tl.clips.filter((c: any) => c.z === 0 && !tl.cards.some((k: any) => k.t0 <= c.t0 + EPS && k.t1 >= c.t1 - EPS));
    const d = full.map((c: any) => c.t1 - c.t0);
    for (const x of d) { expect(x).toBeGreaterThan(0.4 - 0.02); expect(x).toBeLessThan(3.0); }
    expect(d.filter((x: number) => x <= 4 * tl.grid.period + 0.02).length / d.length).toBeGreaterThan(0.85);
  });
  it('has grids (2×2 and 3×3), freeze frames, punch-ins, whip pans and a slow-mo boom on the drop', () => {
    const tiles = tl.clips.filter((c: any) => c.z === 1);
    expect(tiles.length).toBeGreaterThanOrEqual(4 * 3 + 9 * 3);
    expect(tl.clips.some((c: any) => c.freeze)).toBe(true);
    expect(tl.clips.some((c: any) => c.punch.length)).toBe(true);
    expect(tl.clips.some((c: any) => c.whipIn > 0)).toBe(true);
    const drop = grid.drops_rank[0];
    const boom = tl.clips.find((c: any) => c.src === 'e-boom' && Math.abs(c.t0 - drop) < 0.05);
    expect(boom).toBeTruthy();
    expect(tl.flashes.some((f: any) => Math.abs(f.t - drop) < 0.05)).toBe(true);
  });
  it('captions are short, readable and carry no nicknames (demo text only), the end card has the install link', () => {
    for (const t of tl.texts) {
      expect(t.t1 - t.t0).toBeGreaterThanOrEqual(0.8);
      expect(t.text.length).toBeLessThanOrEqual(34);
      // Russian words only (the «E» key excepted): no nicknames, no Latin handles
      expect(/^[а-яё0-9 .,!?*…—«»E-]+$/i.test(t.text)).toBe(true);
    }
    const end = tl.cards.find((k: any) => k.kind === 'end');
    expect(end.t1).toBeCloseTo(tl.duration, 3);
    expect(readFileSync(resolve(__dirname, '../scripts/video/edit-compose.mjs'), 'utf8')).toContain('github.com/ascorblack/legion-3d/releases/latest');
  });
});

describe('edit trailer: slow-motion time map', () => {
  it('interp is piecewise linear and held outside', () => {
    const k: [number, number][] = [[1, 10], [2, 20]];
    expect(interp(k, 0)).toBe(10); expect(interp(k, 1.5)).toBe(15); expect(interp(k, 3)).toBe(20);
  });
  it('simOf integrates the director rate exactly like the director (per frame)', () => {
    const rate: [number, number][] = [[0, 1], [2.2, 1], [2.3, 0.25], [5.6, 0.25], [6.2, 1]];
    let s = 0;
    for (let f = 1; f <= 6 * FPS; f++) s += rateAt(rate, f / FPS) / FPS;
    expect(simOf(rate, 6)).toBeCloseTo(s, 9);
    expect(simOf(null, 3)).toBe(3);
    // 0.25× for 3.3 s of output ≈ 0.83 s of game time
    expect(simOf(rate, 5.6) - simOf(rate, 2.3)).toBeCloseTo(0.25 * 3.3, 1);
  });
});
