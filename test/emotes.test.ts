import { describe, it, expect } from 'vitest';
import { EMOTES, WHEEL, wheelIndex, clampToRim } from '../src/emotes/defs';
import { emoteEnv } from '../src/emotes/anims';
import { MOOD_FACE } from '../src/avatar/face';
import { SFX } from '../src/audio/defs';

describe('emote wheel', () => {
  it('has 8 distinct emotes with a known face mood and a known sound', () => {
    expect(EMOTES.length).toBe(8);
    expect(new Set(EMOTES.map((e) => e.id)).size).toBe(8);
    for (const e of EMOTES) {
      expect(e.mood in MOOD_FACE).toBe(true);
      if (e.sfx) expect(e.sfx in SFX).toBe(true);
      expect(e.len).toBeGreaterThan(0.5);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it('picks sectors clockwise from the top (screen y grows down); the dead zone picks nothing', () => {
    const r = 80;
    const at = (deg: number) => wheelIndex(Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r);
    expect(at(0)).toBe(0);      // up
    expect(at(45)).toBe(1);     // up-right
    expect(at(90)).toBe(2);     // right
    expect(at(135)).toBe(3);
    expect(at(180)).toBe(4);    // down
    expect(at(270)).toBe(6);    // left
    expect(at(315)).toBe(7);
    expect(at(359)).toBe(0);
    // sector edges at ±22.5°
    expect(at(22)).toBe(0); expect(at(23)).toBe(1); expect(at(-22)).toBe(0); expect(at(-23)).toBe(7);
    expect(wheelIndex(0, 0)).toBe(-1);
    expect(wheelIndex(WHEEL.dead - 1, 0)).toBe(-1);
    expect(wheelIndex(WHEEL.dead + 1, 0)).toBe(2);
    expect(wheelIndex(NaN, NaN)).toBe(-1);
  });

  it('keeps the virtual pointer on the rim and leaves inner points alone', () => {
    const p = clampToRim({ x: 300, y: 400 });
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(WHEEL.rim, 6);
    expect(wheelIndex(p.x, p.y)).toBe(wheelIndex(300, 400));
    const q = clampToRim({ x: 10, y: -20 });
    expect(q).toEqual({ x: 10, y: -20 });
  });

  it('the emote envelope eases in and out', () => {
    expect(emoteEnv(0)).toBe(0); expect(emoteEnv(0.5)).toBe(1); expect(emoteEnv(1)).toBe(0);
    expect(emoteEnv(0.075)).toBeCloseTo(0.5, 6);
  });
});
