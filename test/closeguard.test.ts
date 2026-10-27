/** Close guard (src/features/closeguard.ts): when the beforeunload confirm is armed, and that it really asks. */
import { describe, it, expect } from 'vitest';
import { createCloseGuard, guardWanted, isCloseChord, LOCK_KEYS } from '../src/features/closeguard';

describe('close guard', () => {
  it('armed only with the setting on, after a user interaction, outside the classic site, until disposed', () => {
    const base = { setting: true, activated: true, classic: false, disposed: false };
    expect(guardWanted(base)).toBe(true);
    expect(guardWanted({ ...base, setting: false })).toBe(false);
    expect(guardWanted({ ...base, activated: false })).toBe(false);   // Chrome needs sticky activation
    expect(guardWanted({ ...base, classic: true })).toBe(false);      // F8: the plain site
    expect(guardWanted({ ...base, disposed: true })).toBe(false);
  });

  it('adds one beforeunload listener that cancels the unload, removes it again (idempotent)', () => {
    const t = new EventTarget();
    const g = createCloseGuard(t as unknown as Window);
    const ev = () => { const e = new Event('beforeunload', { cancelable: true }) as Event & { returnValue?: unknown }; t.dispatchEvent(e); return e; };
    expect(ev().defaultPrevented).toBe(false);
    g.set(true); g.set(true);
    expect(g.armed).toBe(true);
    expect(ev().defaultPrevented).toBe(true);
    g.set(false);
    expect(ev().defaultPrevented).toBe(false);
    g.set(false);
    expect(g.armed).toBe(false);
  });

  it('close chords: Ctrl/⌘ + W, Q, N, T; locked keys cover them and Esc', () => {
    expect(isCloseChord({ code: 'KeyW', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCloseChord({ code: 'KeyW', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isCloseChord({ code: 'KeyW', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isCloseChord({ code: 'KeyA', ctrlKey: true, metaKey: false })).toBe(false);
    for (const k of ['KeyW', 'KeyQ', 'KeyN', 'KeyT', 'Escape']) expect(LOCK_KEYS).toContain(k);
  });
});
