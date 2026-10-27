/** Date windows ("Oct 24 – Nov 3", "Dec 20 – Jan 10") in local time, and picking the event to run. */
import type { SeasonalEvent, EventMode } from './types';

export type MD = [month: number, day: number];   // month 1..12

const key = (m: number, d: number) => m * 100 + d;

/** Is the local date inside [from, to] (inclusive, year wrap allowed: Dec 20 – Jan 10)? */
export function inWindow(date: Date, from: MD, to: MD): boolean {
  const k = key(date.getMonth() + 1, date.getDate()), a = key(from[0], from[1]), b = key(to[0], to[1]);
  return a <= b ? k >= a && k <= b : k >= a || k <= b;
}

/** Days from `date` to the nearest day of the window (0 inside; looks at this year and the next/previous). */
export function windowDistance(date: Date, from: MD, to: MD): number {
  if (inWindow(date, from, to)) return 0;
  const day = 86400000, d0 = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  let best = Infinity;
  for (const y of [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1]) {
    const a = Date.UTC(y, from[0] - 1, from[1]);
    const b = Date.UTC(to[0] >= from[0] ? y : y + 1, to[0] - 1, to[1]);
    best = Math.min(best, d0 < a ? (a - d0) / day : d0 > b ? (d0 - b) / day : 0);
  }
  return best;
}

/** Normalise a stored / URL value to a mode. */
export function parseMode(v: unknown): EventMode {
  return v === 'on' || v === 'off' || v === 'auto' ? v : 'auto';
}

/**
 * Which event runs now? `forced` (dev override ?event=<id>) wins over the mode. 'off' → none. 'auto' → the event whose
 * window is open (the first registered if several). 'on' → the open one, else the nearest window.
 */
export function pickEvent(list: readonly SeasonalEvent[], date: Date, mode: EventMode, forced?: string | null): SeasonalEvent | null {
  if (forced) return list.find((e) => e.id === forced) ?? null;
  if (mode === 'off' || !list.length) return null;
  const open = list.find((e) => e.active(date));
  if (open) return open;
  if (mode !== 'on') return null;
  let best: SeasonalEvent | null = null, bd = Infinity;
  for (const e of list) { const d = e.distance ? e.distance(date) : Infinity; if (d < bd) { bd = d; best = e; } }
  return best ?? list[0];
}
