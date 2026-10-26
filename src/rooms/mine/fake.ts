/**
 * Offline fake of the game's mine endpoints (dev page dev/mine.ts and tests). Starts from a captured, sanitized
 * enter payload (test/fixtures/mine-*.json) and simulates: digging (fast), stones breaking with loot into the hero's
 * ore items, the buyer (mineBuy → result through the 'me' channel), helmet / pickaxe / ore bag purchases, quests,
 * bots walking and digging. NEVER used against the live site.
 */
import type { MinePayload, MineView, MineMe, Bl } from './state';
import { GW, N_CELLS, frontOf, SPEED, free, spawnPt } from './geo';

export interface FakeBus { on(type: string, fn: (d: any) => void): () => void; emit(type: string, d: any): void }
export function makeBus(): FakeBus {
  const subs = new Map<string, Set<(d: any) => void>>();
  return {
    on(t, fn) { let s = subs.get(t); if (!s) subs.set(t, (s = new Set())); s.add(fn); return () => { s!.delete(fn); }; },
    emit(t, d) { for (const f of [...(subs.get(t) || [])]) f(d); },
  };
}

export interface FakeHero { login: string; money: number; items: any[]; mn: Record<string, MineMe>; [k: string]: unknown }
export interface FakeOpts {
  login: string; enter: MinePayload; hero: FakeHero; bus: FakeBus;
  /** Seconds a stone takes to dig (fast for demos). */
  digSec?: number; bots?: boolean; log?: (p: string, b: unknown) => void;
}

/** Fake game server. api(path, body) answers like the real one (shapes as in docs/MINE.md). */
export class FakeMine {
  st: MineView; me: MineMe; calls: { p: string; b: unknown }[] = [];
  private o: FakeOpts; private timers: any[] = []; private resN = 0; private bots: { l: string; x: number; y: number; tx: number; ty: number }[] = [];
  constructor(o: FakeOpts) {
    this.o = o;
    this.st = JSON.parse(JSON.stringify(o.enter.st));
    this.me = JSON.parse(JSON.stringify(o.enter.me));
    this.me.fx = { m2: 1, b: 1, pk: 1, sh: 1, ...(this.me.fx || {}) };
    this.me.day = 0;   // a fresh day: the captured account had used its daily cap
    o.hero.mn = { ...(o.hero.mn || {}), [o.enter.c || 'home']: this.me };
    this.st.front = frontOf(this.dugA(), this.st.fl!.c.map((c) => c[0]));
    if (o.bots !== false) this.startBots();
    // the server finishes stones: tick every 500 ms
    this.timers.push(setInterval(() => this.tick(), 500));
  }
  dispose(): void { for (const t of this.timers) { clearInterval(t); clearTimeout(t); } }
  private dugA(): number[] { return this.st.dug.split('').map((c) => (c === '1' ? 1 : 0)); }
  private view(withFl = false): MineView { const v = { ...this.st }; if (!withFl) delete v.fl; return JSON.parse(JSON.stringify(v)); }
  private rebase(): void { const now = Date.now(); for (const x of Object.values(this.st.bl || {})) x[0] = Math.max(0, x[0] - x[2] * (now - this.st.at) / 60000); this.st.at = now; }
  private push(): void { this.rebase(); this.st.v++; this.o.bus.emit('sse:mine', { c: this.o.enter.c || 'home', st: this.view(false) }); }
  private heroSnap(results?: any[]): void { this.o.bus.emit('sse:me', { hero: this.o.hero, results: results || [] }); }

  async api(p: string, b?: any): Promise<any> {
    this.calls.push({ p, b }); if (this.o.log) this.o.log(p, b);
    await new Promise((r) => setTimeout(r, 30));
    const path = p.replace(/\?.*$/, ''), L = this.o.login;
    switch (path) {
      case '/api/mine/enter': return { ...this.o.enter, ok: true, sid: 'fake-sid', me: this.me, st: this.view(true), a: this.presenceA() };
      case '/api/mine/state': {
        const v = /[?&]v=(\d+)/.exec(p);
        const r: MinePayload = { ok: true, n: this.bots.length, c: this.o.enter.c, here: 40 + this.bots.length, hw: Object.keys(this.st.dg || {}).length * 2, hm: 30, me: this.me };
        if (!v || +v[1] !== this.st.v) r.st = this.view(!/[?&]f=/.test(p));
        const lk = /[?&]lk=([^&]+)/.exec(p);
        if (lk) r.lk = Object.fromEntries(decodeURIComponent(lk[1]).split(',').map((l, k) => [l, { n: l, lv: 3 + (k % 5), lk: { color: ['#f2c14e', '#b9a2ff', '#7fd35f', '#ff8fa3', '#8ac8e8'][k % 5] }, g: { h: 'miner' } }]));
        return r;
      }
      case '/api/mine/go': case '/api/mine/ping': case '/api/mine/leave': case '/api/mineSeen': return { ok: true };
      case '/api/mineDig': {
        const i = +b.i; if (!(this.st.front || []).includes(i)) return { ok: false, error: 'К этому камню пока не подойти' };
        this.rebase(); this.unDig(L);
        const dg = (this.st.dg = this.st.dg || {}), bl = (this.st.bl = this.st.bl || {});
        dg[i] = [L, ...(dg[i] || []).filter((x) => x !== L)].slice(0, 4);
        // work w is done in digSec by one digger: rate (per minute) = w / (digSec / 60); others add to the rate
        const sec = this.o.digSec ?? 8, w = sec * 10, old = bl[i];
        const leftNow = old ? Math.max(1, old[0]) : w;
        bl[i] = (old ? [leftNow, old[1], old[2] * (1 + 1 / Math.max(1, old[3])), old[3] + 1] : [w, w, w / (sec / 60), 1]) as Bl;
        this.me.i = i; this.push(); return { ok: true };
      }
      case '/api/mineStop': this.unDig(L); this.me.i = -1; this.push(); return { ok: true };
      case '/api/mineBuy': {
        const id = 'r' + ++this.resN, lines: [string, number][] = b.lines || [];
        this.timers.push(setTimeout(() => {
          for (const [uid, q] of lines) { const it = this.o.hero.items.find((x) => x.uid === uid); if (it) { it.q -= q; if (it.q <= 0) this.o.hero.items.splice(this.o.hero.items.indexOf(it), 1); } }
          this.o.hero.money += b.price;
          this.heroSnap([{ id, ok: true, x: { op: 'mineBuy', c: b.price, t: 'Хорошая руда! Держи {coins}.' } }]);
        }, 900));
        return { ok: true, id };
      }
      case '/api/mineSell': this.me.bag = { c: 0, r: {}, p: {} }; return { ok: true };
      case '/api/mineLamp': this.timers.push(setTimeout(() => { this.o.hero.items.push({ uid: 'ihelm' + this.resN++, id: 'miner_helmet', name: 'Каска шахтёра', slot: 'helmet', on: false, wearable: true }); this.heroSnap(); }, 600)); return { ok: true };
      case '/api/mineClaim': { for (const x of [...(this.me.q?.d || []), ...(this.me.q?.w || [])]) if (x.done) x.cl = 1; return { ok: true }; }
      case '/api/minePick': { const id = 'r' + ++this.resN; this.timers.push(setTimeout(() => { if (this.me.pkx) this.me.pkx.lv = b.to; this.heroSnap([{ id, ok: true, x: { op: 'minePick', to: b.to } }]); }, 700)); return { ok: true, id }; }
      case '/api/mineOreBag': { const id = 'r' + ++this.resN; this.timers.push(setTimeout(() => { if (this.me.pkx) this.me.pkx.ob = { cap: this.me.pkx.obC, used: 0 }; this.heroSnap([{ id, ok: true, x: { op: 'mineOreBag' } }]); }, 700)); return { ok: true, id }; }
      case '/api/mine/chat/say': this.o.bus.emit('sse:mine', { chatRoom: 'mine', chat: [{ id: 'c' + Date.now(), l: L, n: L, t: b.text, at: Date.now() }] }); return { ok: true };
      case '/api/equip': { const it = this.o.hero.items.find((x) => x.uid === b.uid); if (it) { for (const o of this.o.hero.items) if (o.slot === it.slot) o.on = false; it.on = true; } this.heroSnap(); return { ok: true }; }
    }
    return { ok: false, error: 'fake: ' + path };
  }
  private unDig(L: string): void {
    for (const [k, ls] of Object.entries(this.st.dg || {})) {
      if (!ls.includes(L)) continue;
      const left = ls.filter((x) => x !== L); if (left.length) this.st.dg![k] = left; else { delete this.st.dg![k]; delete this.st.bl![k]; }
    }
  }
  private tick(): void {
    const now = Date.now(); let ch = false;
    for (const [k, b] of Object.entries(this.st.bl || {})) {
      const left = b[0] - b[2] * (now - this.st.at) / 60000;
      if (left > 0) continue;
      const i = +k, cell = this.st.fl!.c[i], ls = (this.st.dg || {})[k] || [];
      const d = this.st.dug.split(''); d[i] = '1'; this.st.dug = d.join('');
      delete this.st.bl![k]; delete this.st.dg![k];
      const r = cell[2] || 'stone', got: Record<string, number> = {};
      for (const l of ls) got[l] = cell[0] === 'ore' || cell[0] === 'rare' ? 120 + Math.floor(Math.random() * 150) : 30 + Math.floor(Math.random() * 40);
      this.st.dl = [[i, this.st.n, r, {}, got], ...(this.st.dl || [])].slice(0, 16) as any;
      if (ls.includes(this.o.login)) {
        const q = got[this.o.login]; const it = this.o.hero.items.find((x) => x.qty && x.res === r);
        if (it) it.q += q; else this.o.hero.items.push({ uid: 'ore_' + r, id: 'ore_' + r, name: r, slot: 'material', mat: 'ore', qty: true, q, res: r });
        this.me.i = -1; this.me.bag = { ...(this.me.bag || { c: 0, r: {} }), cx: +((this.me.bag?.cx || 0) + 0.4).toFixed(2) };
        this.heroSnap();
      }
      this.st.log = [{ t: `${ls[0] || 'кто-то'} выкопал камень ${cell[1]} ур.`, at: now }, ...(this.st.log || [])].slice(0, 12);
      ch = true;
    }
    if (ch) { this.st.front = frontOf(this.dugA(), this.st.fl!.c.map((c) => c[0])); this.push(); }
  }
  private presenceA() { return this.bots.map((b) => ({ l: b.l, n: b.l, lv: 4, lk: { color: '#b9a2ff' }, g: { h: 'miner' }, x: b.x, y: b.y, tx: b.tx, ty: b.ty, dt: 0 })); }
  private startBots(): void {
    for (let k = 0; k < 5; k++) { const p = spawnPt('bot' + k); this.bots.push({ l: 'bot' + (k + 1), x: p.x, y: p.y, tx: p.x, ty: p.y }); }
    this.timers.push(setInterval(() => {
      const b = this.bots[Math.floor(Math.random() * this.bots.length)];
      const dug = this.dugA(); const cells = dug.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
      let t = { x: 0, y: 0 };
      if (Math.random() < 0.5 && cells.length) { const i = cells[Math.floor(Math.random() * cells.length)]; t = { x: 64 + (i % GW) * 128 + 64, y: 420 + Math.floor(i / GW) * 128 + 98 }; }
      else t = free(100 + Math.random() * 820, 2000 + Math.random() * 400);
      const p = { x: b.tx, y: b.ty }; b.x = p.x; b.y = p.y; b.tx = t.x; b.ty = t.y;
      this.o.bus.emit('sse:mine', { c: this.o.enter.c || 'home', m: [[b.l, b.x, b.y, b.tx, b.ty, 0]], n: this.bots.length });
    }, 1500));
    // bots talk in the mine chat now and then (made-up lines)
    const LINES = ['кто копает у входа?', 'го на нижний ряд', 'ура, железо!', 'тут жила, помогите', 'скупщик сегодня щедрый', 'у кого каска лишняя?', 'ещё пару камней и спуск', 'мяу, кирка тупая'];
    let cn = 0;
    this.timers.push(setInterval(() => {
      const b = this.bots[Math.floor(Math.random() * this.bots.length)]; if (!b) return;
      this.o.bus.emit('sse:mine', { chatRoom: 'mine', chat: [{ id: 'fk' + Date.now() + (cn++), s: 90000 + cn, l: b.l, n: b.l, t: LINES[Math.floor(Math.random() * LINES.length)], at: Date.now(), c: 'archer', cn: 'Лучник' }] });
    }, 7000));
    void SPEED; void N_CELLS;
  }
}
