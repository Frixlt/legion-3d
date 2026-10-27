import { describe, it, expect } from 'vitest';
import { inWindow, windowDistance, pickEvent, parseMode } from '../src/events/calendar';
import { EVENTS, EVENT_SETTING } from '../src/events';
import halloween from '../src/events/halloween';
import type { SeasonalEvent } from '../src/events/types';
import { forcedEvent } from '../src/features/seasonal';

const d = (y: number, m: number, day: number, h = 12) => new Date(y, m - 1, day, h, 0, 0);

describe('calendar windows (local time)', () => {
  it('Halloween: Oct 24 – Nov 3 inclusive', () => {
    for (const [m, day, want] of [[10, 23, false], [10, 24, true], [10, 31, true], [11, 1, true], [11, 3, true], [11, 4, false], [7, 4, false], [12, 31, false]] as [number, number, boolean][]) {
      expect(halloween.active(d(2026, m, day)), `${m}/${day}`).toBe(want);
      expect(halloween.active(d(2026, m, day, 0)), `${m}/${day} 00h`).toBe(want);
      expect(halloween.active(new Date(2026, m - 1, day, 23, 59, 59)), `${m}/${day} 23:59`).toBe(want);
    }
  });
  it('a window that wraps the year (New Year: Dec 20 – Jan 10)', () => {
    const ny = (x: Date) => inWindow(x, [12, 20], [1, 10]);
    expect(ny(d(2026, 12, 19))).toBe(false); expect(ny(d(2026, 12, 20))).toBe(true); expect(ny(d(2027, 1, 1))).toBe(true);
    expect(ny(d(2027, 1, 10))).toBe(true); expect(ny(d(2027, 1, 11))).toBe(false); expect(ny(d(2026, 6, 1))).toBe(false);
  });
  it('windowDistance: 0 inside, days to the nearest edge outside, across the year boundary', () => {
    expect(windowDistance(d(2026, 10, 30), [10, 24], [11, 3])).toBe(0);
    expect(windowDistance(d(2026, 10, 20), [10, 24], [11, 3])).toBe(4);
    expect(windowDistance(d(2026, 11, 10), [10, 24], [11, 3])).toBe(7);
    expect(windowDistance(d(2027, 1, 15), [12, 20], [1, 10])).toBe(5);
    expect(windowDistance(d(2026, 12, 15), [12, 20], [1, 10])).toBe(5);
  });
});

describe('pickEvent', () => {
  const fake = (id: string, from: number, to: number): SeasonalEvent => ({ id, title: id, active: (x) => inWindow(x, [from, 1], [to, 28]), distance: (x) => windowDistance(x, [from, 1], [to, 28]), setup: () => () => {} });
  const a = fake('a', 3, 4), b = fake('b', 10, 11);
  it('auto: only inside the window; off: never; on: inside, else the nearest window', () => {
    expect(pickEvent([a, b], d(2026, 3, 10), 'auto')?.id).toBe('a');
    expect(pickEvent([a, b], d(2026, 7, 10), 'auto')).toBeNull();
    expect(pickEvent([a, b], d(2026, 3, 10), 'off')).toBeNull();
    expect(pickEvent([a, b], d(2026, 3, 10), 'on')?.id).toBe('a');
    expect(pickEvent([a, b], d(2026, 8, 20), 'on')?.id).toBe('b');
    expect(pickEvent([a, b], d(2026, 1, 20), 'on')?.id).toBe('a');
    expect(pickEvent([], d(2026, 1, 20), 'on')).toBeNull();
  });
  it('the dev override wins over the mode and the date; an unknown id runs nothing', () => {
    expect(pickEvent([a, b], d(2026, 7, 10), 'off', 'b')?.id).toBe('b');
    expect(pickEvent([a, b], d(2026, 7, 10), 'auto', 'zzz')).toBeNull();
  });
  it('the real registry: Halloween is registered, today in October runs it, July does not', () => {
    expect(EVENTS.map((e) => e.id)).toContain('halloween');
    expect(pickEvent(EVENTS, d(2026, 10, 27), 'auto')?.id).toBe('halloween');
    expect(pickEvent(EVENTS, d(2026, 7, 27), 'auto')).toBeNull();
    expect(pickEvent(EVENTS, d(2026, 7, 27), 'on')?.id).toBe('halloween');
  });
  it('parseMode accepts the three modes and falls back to auto; the setting key is stable', () => {
    expect(['auto', 'on', 'off', 'x', null, 3].map(parseMode)).toEqual(['auto', 'on', 'off', 'auto', 'auto', 'auto']);
    expect(EVENT_SETTING).toBe('l3d.event.mode');
  });
  it('?event= is ignored outside dev builds (no __DEV__ in tests)', () => {
    expect(forcedEvent('?event=halloween')).toBeNull();
  });
});
