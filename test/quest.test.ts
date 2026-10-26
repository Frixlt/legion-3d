import { describe, it, expect } from 'vitest';
import { cardOf } from '../src/quest';

const base = (r: string) => ({ archer: 'выстрел', mage: 'магия', priest: 'лечить' } as Record<string, string>)[r] || 'удар';
const me = { login: 'player1', role: 'archer' };

describe('quest card', () => {
  it('is empty when no expedition', () => {
    expect(cardOf(null, me, base)).toBeNull();
    expect(cardOf({ on: false }, me, base)).toBeNull();
  });
  it('battle, party turn: tells the class command with side on two fronts', () => {
    const c = cardOf({ on: true, party: 'in', b: { id: 'x', round: 2, st: 'party', until: 1, hp: 0.8, me: 0, form: [['player1', 'archer', 'L']], two: true, foes: [] } } as any, me, base)!;
    expect(c.urge).toEqual({ kind: 'say', text: 'выстрел лево' });
    expect(c.where).toContain('левое крыло');
  });
  it('battle, enemy turn: the word is a canvas word', () => {
    const c = cardOf({ on: true, b: { id: 'x', round: 1, st: 'tele', until: 1, hp: 1, me: 0, form: [['player1', 'archer']], foes: [], tele: { word: 'щит', got: 0, need: 3 } } } as any, me, base)!;
    expect(c.urge).toEqual({ kind: 'word', text: 'щит' });
  });
  it('gather: say «поход» when not in party', () => {
    const c = cardOf({ on: true, k: 'gather', gather: { until: 5 } } as any, me, base)!;
    expect(c.urge).toEqual({ kind: 'say', text: 'поход' });
  });
  it('vote: options with counts', () => {
    const c = cardOf({ on: true, party: 'in', vote: { id: 7, title: 'Куда идём?', end: 9, opts: [[1, 'Лес', '', 3], [2, 'Горы', '', 1]] } } as any, me, base)!;
    expect(c.voteId).toBe(7);
    expect(c.opts!.map((o) => o.votes)).toEqual([3, 1]);
  });
  it('trap gas means silence', () => {
    const c = cardOf({ on: true, tr: { name: 'Газ', st: 'act', gas: true } } as any, me, base)!;
    expect(c.urge!.kind).toBe('silent');
  });
});
