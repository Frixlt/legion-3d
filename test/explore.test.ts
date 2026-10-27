import { describe, it, expect } from 'vitest';
import { FIGURES, placeConstellations, buildSkyBuffers, skySeed, gazeStep, angleBetween, DWELL_FULL } from '../src/explore/constellations';
import { boatPath, boatSpecs, boatState, type BoatState } from '../src/explore/boats';
import { newTrail, step, alpha, PAW_COUNT, PAW_LIFE, PAW_LIFT, strideFor } from '../src/explore/paws';
import { LANDMARK_TEXTS, GENERIC_LANDMARK, landmarkText, neighbour, relDir, hintLine } from '../src/explore/landmarks';
import { fixtureLayout } from '../dev/fixtures';
import { DEFAULT_BUILDINGS } from '../src/core/registries';
import { toZ } from '../src/world/coords';

describe('constellations', () => {
  it('has 4 named cat figures with valid edges', () => {
    expect(FIGURES).toHaveLength(4);
    for (const f of FIGURES) {
      expect(f.name.startsWith('Созвездие')).toBe(true);
      for (const [a, b] of f.edges) { expect(a).toBeLessThan(f.stars.length); expect(b).toBeLessThan(f.stars.length); }
    }
  });
  it('is stable for a seed and differs between seeds', () => {
    const a = placeConstellations(skySeed('fair', 'cats')), b = placeConstellations(skySeed('fair', 'cats')), c = placeConstellations(skySeed('town2', 'cats'));
    expect(a.map((p) => p.dirs)).toEqual(b.map((p) => p.dirs));
    expect(a.map((p) => p.az)).not.toEqual(c.map((p) => p.az));
  });
  it('keeps every star above the horizon, on the unit sphere, reachable from third person (centre ≤ 55°)', () => {
    for (const p of placeConstellations(skySeed('fair', 'cats'))) {
      expect(p.el * 180 / Math.PI).toBeLessThanOrEqual(55);
      for (let i = 0; i < p.dirs.length; i += 3) { expect(Math.hypot(p.dirs[i], p.dirs[i + 1], p.dirs[i + 2])).toBeCloseTo(1, 5); expect(p.dirs[i + 1]).toBeGreaterThan(0.2); }
    }
  });
  it('builds ONE index buffer: a quad per star and per edge, indices in range', () => {
    const placed = placeConstellations(1), b = buildSkyBuffers(placed);
    const quads = FIGURES.reduce((n, f) => n + f.stars.length + f.edges.length, 0);
    expect(b.index.length).toBe(quads * 6); expect(b.position.length).toBe(quads * 12);
    expect(Math.max(...b.index)).toBe(quads * 4 - 1);
    expect(new Set(b.con)).toEqual(new Set([0, 1, 2, 3]));
  });
  it('reveals after a moment of looking and fades when you look away', () => {
    let dwell = 0, rev = 0;
    for (let i = 0; i < 10; i++) [dwell, rev] = gazeStep(dwell, 0.05, 0.1);
    expect(rev).toBeGreaterThan(0); expect(rev).toBeLessThan(1);   // after 1 s: brightening, not yet full
    for (let i = 0; i < 20; i++) [dwell, rev] = gazeStep(dwell, 0.05, 0.1);
    expect(rev).toBe(1); expect(dwell).toBeGreaterThanOrEqual(DWELL_FULL);
    for (let i = 0; i < 40; i++) [dwell, rev] = gazeStep(dwell, 1.2, 0.1);
    expect(rev).toBe(0); expect(dwell).toBe(0);
    expect(angleBetween(0, 1, 0, 0, 1, 0)).toBeCloseTo(0, 5);
  });
});

describe('paper boats', () => {
  const L = fixtureLayout();
  const path = boatPath(L)!;
  it('derives the path from the canal data', () => {
    expect(path).toBeTruthy();
    const mid = (toZ(L.low!.canal[0]) + toZ(L.low!.canal[1])) / 2;
    expect(path.lanes).toHaveLength(2);
    for (const l of path.lanes) expect(Math.abs(l.z - mid)).toBeGreaterThan(0.3);   // clear of the 0.5 m bridge pier
    expect(path.bridgesX).toHaveLength(L.low!.bridges.length);
  });
  it('has no path without a canal', () => { expect(boatPath({ ...L, low: undefined })).toBeNull(); });
  it('keeps boats inside the canal, off the pier and bobbing gently for a full lap', () => {
    const specs = boatSpecs(path, 3), st: BoatState = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0, scale: 1 };
    expect(specs.length).toBeGreaterThanOrEqual(2);
    const c0 = toZ(L.low!.canal[0]), c1 = toZ(L.low!.canal[1]), mid = (c0 + c1) / 2;
    let minY = 9, maxY = -9;
    for (const s of specs) for (let t = 0; t < 400; t += 0.5) {
      boatState(path, s, t, st);
      expect(st.x).toBeGreaterThanOrEqual(path.x0 - 1e-6); expect(st.x).toBeLessThanOrEqual(path.x1 + 1e-6);
      expect(st.z).toBeGreaterThan(c0 + 0.2); expect(st.z).toBeLessThan(c1 - 0.2);
      expect(Math.abs(st.z - mid)).toBeGreaterThan(0.38);          // pier ±0.25 + half the hull
      expect(Math.abs(st.roll)).toBeLessThan(0.1);
      expect(st.scale).toBeGreaterThanOrEqual(0); expect(st.scale).toBeLessThanOrEqual(1);
      minY = Math.min(minY, st.y); maxY = Math.max(maxY, st.y);
    }
    expect(maxY - minY).toBeLessThan(0.04);
  });
});

describe('paw prints', () => {
  it('leaves a print every stride while walking, alternating sides, never while standing or off-cobble', () => {
    const t = newTrail(); let now = 0, x = 0, n = 0;
    step(t, x, 0, true, 0, now, 0.05);
    for (let i = 0; i < 100; i++) { now += 0.05; x += 0.05 * 3; if (step(t, x, 0, true, 0, now, 0.05)) n++; }
    expect(n).toBeGreaterThan(5); expect(n).toBeLessThan(25);
    const z0 = t.data[2], z1 = t.data[6];
    expect(z0 * z1).toBeLessThan(0);                                  // left / right
    const before = t.head;
    for (let i = 0; i < 40; i++) { now += 0.05; step(t, x, 0, true, 0, now, 0.05); }          // standing
    for (let i = 0; i < 40; i++) { now += 0.05; x += 0.15; step(t, x, 0, false, 0, now, 0.05); }   // walking on water
    expect(t.head).toBe(before);
  });
  it('is a ring buffer of ≥ 6 prints lifted ≥ 6 mm and fading in about 5 s', () => {
    expect(PAW_COUNT).toBeGreaterThanOrEqual(6); expect(PAW_COUNT).toBeLessThanOrEqual(8);
    expect(PAW_LIFT).toBeGreaterThanOrEqual(0.006);
    expect(PAW_LIFE).toBeGreaterThanOrEqual(4); expect(PAW_LIFE).toBeLessThanOrEqual(6);
    const t = newTrail(); let now = 0, x = 0;
    step(t, 0, 0, true, -1.4, 0, 0.05);
    for (let i = 0; i < 300; i++) { now += 0.05; x += 0.2; step(t, x, 0, true, -1.4, now, 0.05); }
    expect(t.born.filter((b) => b >= 0).length).toBe(PAW_COUNT);
    expect(t.data[1]).toBeCloseTo(-1.4 + PAW_LIFT, 5);
    expect(alpha(10, 10.3)).toBeGreaterThan(0.8); expect(alpha(10, 10 + PAW_LIFE / 2)).toBeCloseTo(0.5, 1); expect(alpha(10, 10 + PAW_LIFE + 0.01)).toBe(0); expect(alpha(-1, 3)).toBe(0);
    expect(strideFor(6)).toBeGreaterThan(strideFor(1));
  });
  it('ignores teleports', () => {
    const t = newTrail(); step(t, 0, 0, true, 0, 0, 0.05); step(t, 40, 0, true, 0, 0.05, 0.05);
    expect(t.born.every((b) => b < 0)).toBe(true);
  });
});

describe('landmark cards', () => {
  it('has Russian texts for every building the game knows, and a generic fallback', () => {
    for (const id of Object.keys(DEFAULT_BUILDINGS)) expect(LANDMARK_TEXTS[id], id).toBeTruthy();
    for (const id of ['forge', 'tent', 'hall', 'gate', 'magic', 'mine', 'storage', 'auction', 'board', 'trainer', 'shop']) expect(landmarkText(id).what).toMatch(/[а-яё]/i);
    expect(landmarkText('no-such-building')).toBe(GENERIC_LANDMARK);
  });
  it('finds the neighbouring landmark and points to it relative to the view', () => {
    const L = fixtureLayout();
    const list = L.buildings.map((b) => ({ id: b.id, title: b.title, x: (b.hit[0] + b.hit[1]) / 200, z: toZ(b.door.y) }));
    const forge = list.find((l) => l.id === 'forge')!;
    const n = neighbour(list, forge)!;
    expect(n.lm.id).not.toBe('forge'); expect(n.dist).toBeGreaterThan(0);
    // looking north (−z): a target to the +x side is on the right
    expect(relDir(0, -1, 5, 0).word).toBe('справа'); expect(relDir(0, -1, -5, 0).arrow).toBe('←');
    expect(relDir(0, -1, 0, -5).arrow).toBe('↑'); expect(relDir(0, -1, 0, 5).arrow).toBe('↓');
    const line = hintLine(list, forge, forge.x, forge.z + 3, 0, -1);
    expect(line).toContain(n.lm.title); expect(line).toMatch(/\d+ м/);
    expect(hintLine([forge], forge, 0, 0, 0, -1)).toBe('');
  });
});
