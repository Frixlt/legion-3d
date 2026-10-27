/**
 * Gameplay video timeline (scripts/video/gameplay.ts): the narrator slots stay short (≤ 6 s, ≤ 12 words, 4–7 of them
 * in the main cut) and every segment belongs to the gameplay cut. Read as text: the page module needs a browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../scripts/video/gameplay.ts', import.meta.url), 'utf8');
const slots = [...src.matchAll(/\{ mark: '([\w-]+)', off: ([\d.]+), dur: ([\d.]+), text: '([^']+)' \}/g)].map((m) => ({ mark: m[1], off: +m[2], dur: +m[3], text: m[4] }));

describe('gameplay video narrator slots', () => {
  it('4–7 slots, each ≤ 6 s and ≤ 12 words', () => {
    expect(slots.length).toBeGreaterThanOrEqual(4);
    expect(slots.length).toBeLessThanOrEqual(7);
    for (const s of slots) {
      expect(s.dur).toBeLessThanOrEqual(6);
      expect(s.text.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length).toBeLessThanOrEqual(12);
    }
  });
  it('every segment of the file is in the gameplay cut', () => {
    const ids = [...src.matchAll(/id: '(gp-[\w-]+)', cut: '(\w+)'/g)];
    expect(ids.map((m) => m[1])).toEqual(['gp-fair', 'gp-walk', 'gp-mine', 'gp-fun', 'gp-end']);
    for (const m of ids) expect(m[2]).toBe('gameplay');
  });
});
