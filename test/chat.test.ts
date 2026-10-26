import { describe, it, expect, beforeAll } from 'vitest';
import type { ChatMsg } from '../src/contracts';
import { chatFlags, tabOf, tabOk, chatVis, dmPeers, nickColor, CLS_ICO } from '../src/ui/chat';

// src/net/site.ts reads `window` at module level
let site: typeof import('../src/net/site');
beforeAll(async () => { (globalThis as any).window = globalThis; site = await import('../src/net/site'); });

const msg = (id: string, kind: ChatMsg['kind'], login = 'a', extra: Partial<ChatMsg> = {}): ChatMsg =>
  ({ id, login, name: login.toUpperCase(), text: 't' + id, at: 1000 + +id.replace(/\D/g, '') || 0, kind, ...extra });

const ALL = chatFlags({ cc: 1, ct: 1, cd: 1 } as any);
const NONE = chatFlags({ cc: 1 } as any);

describe('chat tabs (site-chat.js parity)', () => {
  it('reads hero flags: cc chat, ct trade + achievements, cd DMs', () => {
    expect(ALL).toEqual({ on: true, tr: true, dm: true, ev: true });
    expect(NONE).toEqual({ on: true, tr: false, dm: false, ev: false });
    expect(chatFlags(null).on).toBe(false);
  });
  it('puts achievement events into Достижения with the trade flag, into Общий without it', () => {
    expect(tabOf(msg('1', 'ev'), ALL)).toBe('ev');
    expect(tabOf(msg('1', 'ev'), NONE)).toBe('g');
    expect(tabOf(msg('2', 'tr'), ALL)).toBe('tr');
    expect(tabOf(msg('3', 'dm'), ALL)).toBe('dm');
    expect(tabOf(msg('4', 'g'), ALL)).toBe('g');
    expect(tabOf(msg('5', 'sys'), ALL)).toBe('g');
    expect(tabOf({ ...msg('6', 'g'), kind: undefined }, ALL)).toBe('g');
  });
  it('allows tabs by flags only', () => {
    expect(['g', 'tr', 'ev', 'dm'].map((t) => tabOk(t as any, ALL))).toEqual([true, true, true, true]);
    expect(['g', 'tr', 'ev', 'dm'].map((t) => tabOk(t as any, NONE))).toEqual([true, false, false, false]);
  });
  it('Общий is not flooded by achievements when Достижения exists', () => {
    const list = [msg('1', 'g'), msg('2', 'ev'), msg('3', 'ev'), msg('4', 'tr'), msg('5', 'g'), msg('6', 'dm', 'b', { to: 'me' })];
    expect(chatVis(list, 'g', ALL, null, new Set()).map((m) => m.id)).toEqual(['1', '5']);
    expect(chatVis(list, 'ev', ALL, null, new Set()).map((m) => m.id)).toEqual(['2', '3']);
    expect(chatVis(list, 'tr', ALL, null, new Set()).map((m) => m.id)).toEqual(['4']);
    expect(chatVis(list, 'g', NONE, null, new Set()).map((m) => m.id)).toEqual(['1', '2', '3', '5']);
  });
  it('hides ignored players everywhere and filters Личные by peer', () => {
    const list = [msg('1', 'g', 'x'), msg('2', 'dm', 'x', { to: 'me' }), msg('3', 'dm', 'me', { to: 'y' }), msg('4', 'dm', 'y', { to: 'me' }), msg('5', 'sys', '')];
    expect(chatVis(list, 'g', ALL, null, new Set(['x'])).map((m) => m.id)).toEqual(['5']);
    expect(chatVis(list, 'dm', ALL, null, new Set()).map((m) => m.id)).toEqual(['2', '3', '4']);
    expect(chatVis(list, 'dm', ALL, 'y', new Set()).map((m) => m.id)).toEqual(['3', '4']);
  });
  it('lists recent DM peers newest first, chosen peer included, ignored skipped', () => {
    const list = [msg('1', 'dm', 'x', { to: 'me' }), msg('2', 'dm', 'me', { to: 'y' }), msg('3', 'dm', 'z', { to: 'me' }), msg('4', 'g', 'q')];
    expect(dmPeers(list, 'me', null, new Set())).toEqual(['z', 'y', 'x']);
    expect(dmPeers(list, 'me', 'w', new Set(['z']))).toEqual(['w', 'y', 'x']);
  });
  it('colours nicks exactly like the site', () => {
    // the site's function, verbatim
    const NC = ['#ffc94d', '#ff8a80', '#ffab6e', '#f4ff81', '#b9f6ca', '#69f0ae', '#84ffff', '#80d8ff', '#9fa8ff', '#b388ff', '#ea80fc', '#ff80ab', '#ffd180', '#a7ffeb', '#ccff90', '#ffcdd2'];
    const siteColor = (l: string) => { let h = 2166136261; const t = String(l || ''); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return NC[(h >>> 0) % NC.length]; };
    for (const n of ['player1', 'cat_lover', 'x', '', 'ник']) expect(nickColor(n)).toBe(siteColor(n));
    expect(CLS_ICO.necromancer).toBe('💀');
  });
});

describe('site chat mapping (src/net/site.ts)', () => {
  it('maps site lines to kinds like tabOf (tb first)', () => {
    const k = site.chatKind;
    expect(k({ ev: 1 })).toBe('ev');
    expect(k({ k: 'tr' })).toBe('tr');
    expect(k({ k: 'dm', to: 'x' })).toBe('dm');
    expect(k({})).toBe('g');
    expect(k({ sys: true, tb: 'tr' })).toBe('sys');
    expect(k({ tb: 'ev', k: 'tr' })).toBe('ev');
    expect(k({ tb: 'g', ev: 1 })).toBe('g');
    const m = site.toChat({ id: 7, l: 'abc', n: 'Abc', t: 'hi', at: 5, c: 'mage', cn: 'Маг', k: 'dm', to: 'me' });
    expect(m).toMatchObject({ id: '7', login: 'abc', name: 'Abc', text: 'hi', at: 5, kind: 'dm', role: 'mage', roleName: 'Маг', to: 'me' });
  });
  it('bubbles only general and trade lines of non-ignored players, not history', () => {
    const now = 100000, ign = new Set(['bad']);
    const b = (kind: ChatMsg['kind'], login = 'a', at = now) => site.bubbleFor({ id: '1', login, name: login, text: 'x', at, kind }, ign, now);
    expect(b('g')).toBe(true);
    expect(b('tr')).toBe(true);
    expect(b('ev')).toBe(false);
    expect(b('dm')).toBe(false);
    expect(b('sys')).toBe(false);
    expect(b('g', 'bad')).toBe(false);
    expect(b('g', 'Bad')).toBe(false);
    expect(b('g', '')).toBe(false);
    expect(b('g', 'a', now - 61000)).toBe(false);
  });
});
