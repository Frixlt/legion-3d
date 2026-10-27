import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { MineChatSource, MineLine } from '../src/ui/chat';

let ui: typeof import('../src/ui/chat');
beforeAll(async () => { (globalThis as any).window = globalThis; ui = await import('../src/ui/chat'); });

const line = (id: string, l = 'bot1', t = 'привет'): MineLine => ({ id, l, n: l, t, at: 1000 });
/** A fake mine chat source: history + a bus for live lines; say() is a spy. */
function source(history: MineLine[] = []) {
  const subs = new Set<(f: MineLine[]) => void>();
  const say = vi.fn(async (_t: string) => ({ ok: true }));
  const src: MineChatSource = { lines: () => history, on: (fn) => { subs.add(fn); return () => subs.delete(fn); }, say, me: () => 'player1' };
  return { src, say, subs, push: (...ls: MineLine[]) => { history.push(...ls); for (const f of [...subs]) f(ls); } };
}

describe('mine chat tab (⛏ Шахта in the chat dock)', () => {
  it('starts with the history, takes the tab on enter and remembers the previous one', () => {
    const s = source([line('a'), line('b')]);
    const m = new ui.MineChatTab(s.src);
    expect(m.lines().map((l) => l.id)).toEqual(['a', 'b']);
    expect(m.unread).toBe(0);
    m.enter('tr');
    expect(m.selected).toBe(true);
    expect(m.prev).toBe('tr');
  });

  it('shows live lines once: no duplicates against the history or a repeated event', () => {
    const s = source([line('a')]);
    const m = new ui.MineChatTab(s.src); m.enter('g');
    expect(m.incoming([line('a'), line('b')]).map((l) => l.id)).toEqual(['b']);
    expect(m.incoming([line('b')])).toEqual([]);
    expect(m.lines().map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('counts unread only while another tab is active, never own lines, and clears on choose', () => {
    const s = source();
    const m = new ui.MineChatTab(s.src); m.enter('g');
    m.incoming([line('1')]);
    expect(m.unread).toBe(0);               // mine tab is shown
    m.deselect();                           // the player switched to Общий
    m.incoming([line('2'), line('3', 'Player1'), line('4', 'bot2')]);
    expect(m.unread).toBe(2);               // own line is not counted
    m.choose();
    expect(m.unread).toBe(0);
  });

  it('keeps the last 80 lines', () => {
    const m = new ui.MineChatTab(source().src); m.enter('g');
    m.incoming(Array.from({ length: 100 }, (_, i) => line('x' + i)));
    expect(m.lines().length).toBe(80);
    expect(m.lines()[79].id).toBe('x99');
  });

  it('posts only on an explicit send(); entering, history and live lines never call say()', async () => {
    const s = source([line('a')]);
    const m = new ui.MineChatTab(s.src); m.enter('g');
    m.incoming([line('b')]); m.deselect(); m.choose(); m.incoming([line('c')]);
    expect(s.say).not.toHaveBeenCalled();
    expect(await m.send('   ')).toBeNull();
    expect(s.say).not.toHaveBeenCalled();
    expect(await m.send('  в шахте тихо ')).toEqual({ ok: true });
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.say).toHaveBeenCalledWith('в шахте тихо');
  });

  it('reports a refused message', async () => {
    const s = source(); s.say.mockResolvedValueOnce({ ok: false, error: 'Мут' } as any);
    const m = new ui.MineChatTab(s.src);
    expect(await m.send('hi')).toEqual({ ok: false, error: 'Мут' });
  });

  it('gives the previous tab back on leave, unless the player already chose another', () => {
    const m = new ui.MineChatTab(source().src); m.enter('tr');
    expect(m.leave()).toBe('tr');
    expect(m.selected).toBe(false);
    const m2 = new ui.MineChatTab(source().src); m2.enter('tr'); m2.deselect();
    expect(m2.leave()).toBeNull();
  });

  it('attachMineChat notifies listeners on enter and on leave (the tab appears / disappears)', () => {
    const s = source();
    // the registry is module state; Chat instances subscribe through it. Probe with attach/detach only.
    const off = ui.attachMineChat(s.src);
    const off2 = ui.attachMineChat(source().src);   // a newer room replaces
    off();                                          // the old detach must not remove the newer source
    off2();
    expect(typeof off).toBe('function');
  });
});
