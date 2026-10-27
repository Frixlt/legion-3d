import { describe, it, expect } from 'vitest';
import { classifyMood, moodFor, RateGate, SeenIds } from '../src/social/mood';
import { pickCheerers, cheerFor, cheerMax, CHEER_RADIUS } from '../src/social/cheer';
import { benchesOf, seatPos, freeSeat, SEAT_TOP, BENCH_SCALE, type Bench } from '../src/social/bench';
import { milestoneOf, journalEntries } from '../src/social/confetti';
import { MOOD_FACE, moodFace } from '../src/avatar/face';
import { BUBBLE_STYLES } from '../src/avatar/labels';
import { SFX } from '../src/audio/defs';
import { existsSync } from 'node:fs';
import type { CityLayout } from '../src/contracts';

describe('chat mood', () => {
  it('reads clear markers', () => {
    expect(classifyMood('ура!')).toBe('happy');
    expect(classifyMood('ура, новый уровень!')).toBe('happy');
    expect(classifyMood('хахаха')).toBe('laugh');
    expect(classifyMood('ахахах ну ты даёшь')).toBe('laugh');
    expect(classifyMood('😹')).toBe('laugh');
    expect(classifyMood('где тренер?')).toBe('puzzled');
    expect(classifyMood('что?!')).toBe('surprised');
    expect(classifyMood('нет!!!')).toBe('surprised');
    expect(classifyMood('кузнец опять сломал мне меч :(')).toBe('sad');
    expect(classifyMood('люблю эту ярмарку ❤')).toBe('love');
    expect(classifyMood('бесит этот голем')).toBe('angry');
  });
  it('stays neutral otherwise', () => {
    expect(classifyMood('привет всем')).toBeNull();
    expect(classifyMood('мяу')).toBeNull();
    expect(classifyMood('')).toBeNull();
    expect(classifyMood('хозяин')).toBeNull();                 // «ха» inside a word is not a laugh
    expect(classifyMood('продам кирку: ' + 'а'.repeat(80) + '!!!')).toBeNull();   // long lines: no mood
  });
  it('never reads private, event or system lines', () => {
    expect(moodFor({ login: 'a', text: 'ура!', kind: 'g' })).toBe('happy');
    expect(moodFor({ login: 'a', text: 'ура!', kind: 'dm' })).toBeNull();
    expect(moodFor({ login: 'a', text: 'ура!', kind: 'g', to: 'b' })).toBeNull();
    expect(moodFor({ login: 'a', text: 'ура!', kind: 'ev' })).toBeNull();
    expect(moodFor({ login: 'a', text: 'ура!', kind: 'sys' })).toBeNull();
    expect(moodFor({ login: '', text: 'ура!', kind: 'g' })).toBeNull();
  });
  it('rate-limits per speaker and overall', () => {
    const g = new RateGate(4, 3, 10);
    expect(g.take('a', 0)).toBe(true);
    expect(g.take('a', 1)).toBe(false);
    expect(g.take('a', 4.5)).toBe(true);
    expect(g.take('b', 5)).toBe(true);
    expect(g.take('c', 6)).toBe(false);   // 3 in the last 10 s
    expect(g.take('c', 10.1)).toBe(true);
  });
  it('dedupes ids with a bounded memory', () => {
    const s = new SeenIds(3);
    expect(s.add('1')).toBe(true); expect(s.add('1')).toBe(false);
    s.add('2'); s.add('3'); s.add('4');
    expect(s.has('1')).toBe(false); expect(s.has('4')).toBe(true);
  });
  it('every mood has a face and a bubble style', () => {
    for (const m of Object.keys(MOOD_FACE) as (keyof typeof MOOD_FACE)[]) {
      expect(BUBBLE_STYLES[m]).toBeTruthy();
      const f = moodFace({ eyes: 'dots', mouth: 'grin', blush: false, iris: 0, style: 'cats', narrow: false, ghost: false }, m);
      expect(f.eyes).toBe(MOOD_FACE[m].eyes);
    }
    const f0 = { eyes: 'dots', mouth: 'grin', blush: false, iris: 0, style: 'cats', narrow: false, ghost: false };
    expect(moodFace(f0, null)).toBe(f0);
  });
});

describe('cheering crowd', () => {
  const c = [{ id: 'a', x: 1, z: 0 }, { id: 'b', x: 3, z: 0 }, { id: 'c', x: 5, z: 0 }, { id: 'far', x: CHEER_RADIUS + 1, z: 0 }, { id: 'hit', x: 0.5, z: 0 }];
  it('nearest first, never the target or far ones, 1…max', () => {
    const ids = pickCheerers(c, 0, 0, 3, (id) => id === 'hit', () => 0.99);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(pickCheerers(c, 0, 0, 3, (id) => id === 'hit', () => 0)).toEqual(['a']);
    expect(pickCheerers(c, 0, 0, 0, () => false)).toEqual([]);
    expect(pickCheerers([], 0, 0, 3, () => false)).toEqual([]);
  });
  it('varied reactions and quality caps', () => {
    expect(cheerFor(0, () => 0)).not.toBe(cheerFor(1, () => 0));
    expect(cheerMax(0)).toBe(0); expect(cheerMax(1)).toBe(1); expect(cheerMax(2)).toBe(3);
  });
});

describe('benches', () => {
  const L = { id: 'fair', low: { benches: [[1600, 1290], [900, 1790]] } } as unknown as CityLayout;
  const bs = benchesOf(L, () => 0.2);
  it('mirror the world placement (rotation by the lower row)', () => {
    expect(bs.length).toBe(2);
    expect(bs[0].rotY).toBe(0); expect(bs[1].rotY).toBe(Math.PI);
    expect(bs[0].id).not.toBe(bs[1].id);
  });
  it('seats on the seat top, facing out of the bench front', () => {
    const p = { x: 0, y: 0, z: 0 };
    const b: Bench = { id: 'b', x: 10, y: 0.2, z: 5, rotY: 0, px: 0, py: 0 };
    const face = seatPos(b, 0, p);
    expect(p.y).toBeCloseTo(0.2 + SEAT_TOP * BENCH_SCALE);
    expect(p.x).toBeLessThan(10);
    expect(p.z).toBeGreaterThan(5);                       // a little forward (+Z = the front at rotY 0)
    expect(Math.cos(face)).toBeCloseTo(-1);               // face π: looks to +Z
    const b2 = { ...b, rotY: Math.PI };
    seatPos(b2, 0, p);
    expect(p.x).toBeGreaterThan(10); expect(p.z).toBeLessThan(5);
  });
  it('a taken seat is skipped, a full bench gives −1', () => {
    const b: Bench = { id: 'b', x: 0, y: 0, z: 0, rotY: 0, px: 0, py: 0 };
    const p = { x: 0, y: 0, z: 0 };
    expect(freeSeat(b, -2, 0, () => {})).toBe(0);
    seatPos(b, 0, p);
    const left = { ...p };
    expect(freeSeat(b, -2, 0, (fn) => fn(left.x, left.z))).toBe(1);
    seatPos(b, 1, p);
    const right = { ...p };
    expect(freeSeat(b, -2, 0, (fn) => { fn(left.x, left.z); fn(right.x, right.z); })).toBe(-1);
  });
});

describe('quiet hurray', () => {
  it('picks achievements and level-ups from journal entries', () => {
    expect(milestoneOf({ id: '7', k: 'ach', t: 'Достижение: «Первая кровь»' })).toBe('ach:7');
    expect(milestoneOf({ id: '8', k: 'hero', t: 'Новый уровень: 6' })).toBe('lvl:8');
    expect(milestoneOf({ id: '9', k: 'fight', t: 'Победа над волками' })).toBeNull();
    expect(milestoneOf(null)).toBeNull();
    expect(milestoneOf('x')).toBeNull();
  });
  it('accepts the payload shapes', () => {
    const e = { id: '1', k: 'ach' };
    expect(journalEntries(e)).toEqual([e]);
    expect(journalEntries([e, e]).length).toBe(2);
    expect(journalEntries({ list: [e] })).toEqual([e]);
    expect(journalEntries({ e })).toEqual([e]);
    expect(journalEntries(null)).toEqual([]);
  });
});

describe('social sounds', () => {
  it('use existing recordings only', () => {
    for (const id of ['social.sit', 'social.cheer', 'social.chime'] as const) {
      const d = SFX[id];
      expect(d).toBeTruthy();
      for (const f of d.files) expect(existsSync(`src/audio/sounds/${f}.ogg`)).toBe(true);
    }
  });
});
