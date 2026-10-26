import { describe, it, expect } from 'vitest';
import { createStore } from '../src/store/store';
import type { ChatMsg, Walker } from '../src/contracts';

const msg = (id: string, at: number, text = 'hi'): ChatMsg => ({ id, login: 'a', name: 'A', text, at, kind: 'g' });
const walker = (login: string): Walker => ({ login, app: { login, name: login, styleId: 'legion', look: {}, gear: {} } as any, x: 0, y: 0, face: 0, speed: 0, alpha: 1 });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('store', () => {
  it('batches events per microtask', async () => {
    const s = createStore(); let n = 0;
    s.on('walkers', () => n++);
    s.upsertWalker(walker('a')); s.upsertWalker(walker('b')); s.removeWalker('a');
    expect(n).toBe(0);
    await tick();
    expect(n).toBe(1);
    expect([...s.walkers.keys()]).toEqual(['b']);
  });

  it('dedupes chat, keeps order and returns only new messages', async () => {
    const s = createStore();
    expect(s.pushChat([msg('2', 20), msg('1', 10)]).map((m) => m.id)).toEqual(['2', '1']);
    expect(s.pushChat([msg('1', 10), msg('3', 30)]).map((m) => m.id)).toEqual(['3']);
    expect(s.chat.map((m) => m.id)).toEqual(['1', '2', '3']);
    const before = s.chat;
    s.pushChat([msg('4', 40)]);
    expect(s.chat).not.toBe(before);   // new array → UI can compare by reference
  });

  it('caps chat and forgets dropped ids', () => {
    const s = createStore();
    s.pushChat(Array.from({ length: 250 }, (_, i) => msg(String(i), i)));
    expect(s.chat.length).toBe(200);
    expect(s.chat[0].id).toBe('50');
    // an id that fell off can come back (e.g. history re-sent after re-enter) — it is accepted again
    expect(s.pushChat([msg('0', 0)]).length).toBe(1);
  });

  it('deletes chat messages', async () => {
    const s = createStore(); let n = 0;
    s.pushChat([msg('1', 1), msg('2', 2)]);
    await tick();
    s.on('chat', () => n++);
    s.deleteChat(['1', 'x']);
    await tick();
    expect(s.chat.map((m) => m.id)).toEqual(['2']);
    expect(n).toBe(1);
  });

  it('online emits only on change', async () => {
    const s = createStore(); let n = 0;
    s.on('online', () => n++);
    s.setOnline(5); await tick(); s.setOnline(5); await tick();
    expect(n).toBe(1);
    expect(s.online).toBe(5);
  });

  it('a throwing listener does not break the others', async () => {
    const s = createStore(); let ok = 0;
    const warn = console.warn; console.warn = () => {};
    s.on('hero', () => { throw new Error('boom'); });
    s.on('hero', () => ok++);
    s.setHero(null);
    await tick();
    console.warn = warn;
    expect(ok).toBe(1);
  });
});
