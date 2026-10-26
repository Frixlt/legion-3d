import { describe, it, expect } from 'vitest';
import { MineClient, type Timers } from '../src/rooms/mine/net';
import { FakeMine, makeBus } from '../src/rooms/mine/fake';
import enter from './fixtures/mine-enter.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const LOGIN = 'player1';
/** Timers that never fire (the client's poll / ping are not under test here). */
const idle: Timers = { setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} };

describe('mine chat (room "mine")', () => {
  const setup = async () => {
    const bus = makeBus();
    const hero = { login: LOGIN, money: 0, items: [] as any[], mn: {} };
    const fake = new FakeMine({ login: LOGIN, enter: clone(enter) as any, hero, bus, bots: false });
    const client = new MineClient({ api: (p, b) => fake.api(p, b), login: LOGIN, c: 'home', bus, timers: idle, hero: () => hero as any });
    const got: string[][] = [];
    client.on((e) => { if (e.type === 'chat') got.push(e.lines.map((l) => l.t)); });
    expect(await client.enter({ x: 300, y: 2400 })).toBe(true);
    return { bus, fake, client, got };
  };

  it('takes the enter history, then live lines once (dedup by id), ignores the city chat', async () => {
    const { bus, client, got, fake } = await setup();
    expect(client.chat.on).toBe(true);
    const n0 = client.chat.lines.length;
    expect(n0).toBe((enter as any).mchat.chat.length);
    const line = { id: 'z1', s: 99999, l: 'bot1', n: 'bot1', t: 'тут жила', at: Date.now() };
    bus.emit('sse:mine', { chatRoom: 'mine', chat: [line] });
    bus.emit('sse:mine', { chatRoom: 'mine', chat: [line] });
    bus.emit('sse:mine', { chatRoom: 'city', chat: [{ ...line, id: 'z2' }] });
    expect(client.chat.lines.length).toBe(n0 + 1);
    expect(got[got.length - 1]).toEqual(['тут жила']);
    expect(client.chat.c).toBe(99999);
    fake.dispose(); client.close();
  });

  it('say() posts to the mine room and the line comes back', async () => {
    const { client, fake, got } = await setup();
    await client.say('  привет, шахта  ');
    const call = fake.calls.find((c) => c.p.startsWith('/api/mine/chat/say'))!;
    expect(call.p).toBe('/api/mine/chat/say?c=home');
    expect(call.b).toEqual({ text: 'привет, шахта' });
    expect(got.flat()).toContain('привет, шахта');
    expect(await client.say('   ')).toBe(null);
    fake.dispose(); client.close();
  });

  it('client.login is the lower-cased login (own lines are highlighted in the HUD)', async () => {
    const c = new MineClient({ api: async () => ({ ok: false }), login: 'Player1', c: 'home', timers: idle });
    expect(c.login).toBe('player1');
    c.close();
  });
});
