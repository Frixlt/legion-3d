import { describe, it, expect } from 'vitest';
import { staticCity } from './world-fixture';

describe('world static geometry', () => {
  it('has no coplanar overlapping surfaces (z-fighting)', () => {
    const { rec, ground } = staticCity();
    const hits = rec.find(0.004, 2e-4, ground);
    const by = new Map<string, number>();
    for (const h of hits) by.set(h.a + ' × ' + h.b, (by.get(h.a + ' × ' + h.b) || 0) + 1);
    if (hits.length) console.log([...by].sort((p, q) => q[1] - p[1]).map(([k, n]) => n + '  ' + k).join('\n'));
    if (hits.length) console.log(hits.slice(0, 400).map((h) => `${h.a} × ${h.b}  ${(h.area * 1e4).toFixed(0)} cm²  n=${h.normal} d=${h.d.toFixed(3)} at ${h.at}`).join('\n'));
    expect(hits.length).toBe(0);
  });
});
