import { describe, it, expect } from 'vitest';
import map from './fixtures/fair-map.json';
import { groundSpec, makeGroundAt, LOW_H, CANAL_WATER } from '../src/world/ground';
import type { LowerStreet } from '../src/contracts';

const low = (map as any).LOW as LowerStreet;
const spec = groundSpec({ low });
const g = makeGroundAt(spec);

describe('world groundAt', () => {
  it('upper street is flat at 0, lower street at LOW_H', () => {
    expect(g(2460, 1010)).toBe(0);
    expect(g(3000, 820)).toBe(0);
    expect(g(2460, 1300)).toBeCloseTo(LOW_H, 6);
    expect(g(2460, 1800)).toBeCloseTo(LOW_H, 6);
    expect(LOW_H).toBeLessThan(-1.2);
  });

  it('stairs are a continuous monotonic ramp between the levels', () => {
    for (const [s0, s1] of low.stairs) {
      const x = (s0 + s1) / 2;
      let prev = g(x, 1000);
      expect(prev).toBe(0);
      for (let y = 1000; y <= 1200; y += 2) {
        const h = g(x, y);
        expect(h).toBeLessThanOrEqual(prev + 1e-9);
        expect(prev - h).toBeLessThan(0.1);           // no cliff on the stairs (≤ 10 cm per 2 px step)
        prev = h;
      }
      expect(prev).toBeCloseTo(LOW_H, 6);
    }
  });

  it('every walkable cell next to the ledge is either up or down (no half-height outside stairs)', () => {
    const [e0, e1] = low.edge;
    const x = 1500;   // not on stairs
    expect(g(x, e0 - 30)).toBe(0);
    expect(g(x, e1 + 30)).toBeCloseTo(LOW_H, 6);
  });

  it('bridges hump over the canal, water is below the street', () => {
    const [c0, c1] = low.canal;
    const [b0, b1] = low.bridges[0];
    const mid = (c0 + c1) / 2;
    expect(g((b0 + b1) / 2, mid)).toBeGreaterThan(LOW_H);
    expect(g((b0 + b1) / 2, c0 - 20)).toBeCloseTo(LOW_H, 6);
    // continuity along the bridge
    let prev = g((b0 + b1) / 2, c0 - 30);
    for (let y = c0 - 30; y <= c1 + 30; y += 2) { const h = g((b0 + b1) / 2, y); expect(Math.abs(h - prev)).toBeLessThan(0.05); prev = h; }
    expect(g(600, mid)).toBeCloseTo(LOW_H + CANAL_WATER, 6);
  });

  it('a layout without LOW is flat', () => {
    const flat = makeGroundAt(groundSpec({ low: undefined }));
    expect(flat(100, 1500)).toBe(0);
  });
});
