/**
 * Virtual time for deterministic frame capture (injected with page.addInitScript before any page script runs).
 *
 * Replaces requestAnimationFrame / cancelAnimationFrame, performance.now, Date.now / new Date(), setTimeout /
 * setInterval and Math.random (seeded). Nothing advances by itself: window.__vt.step(ms) moves the clock by `ms`,
 * fires the timers that became due (in order), advances every CSS animation / transition (Web Animations API, also
 * inside shadow roots) by the same amount and runs the queued rAF callbacks once — exactly one game frame.
 *
 * While booting, the orchestrator keeps calling step() (the game's boot awaits timers and rAF too).
 */
export interface VTime {
  /** virtual ms since page start (performance.now()) */
  readonly now: number;
  /** frames stepped so far */
  readonly frame: number;
  /** Advance by ms: timers → hooks (director) → rAF callbacks → CSS animations. */
  step(ms: number): void;
  /** Called at the start of every step with the new virtual time (ms), before rAF callbacks. */
  hooks: ((nowMs: number, dtMs: number) => void)[];
  /** Hooks run after the rAF callbacks (the frame has rendered). */
  after: ((nowMs: number, dtMs: number) => void)[];
  /** Number of pending timers / rAF callbacks (diagnostics). */
  stats(): { timers: number; raf: number };
  /** Reseed Math.random. */
  seed(n: number): void;
  /** Re-phase every interval to fire `every` ms from now (in creation order) — boot length no longer matters. */
  realign(): void;
}

declare global { interface Window { __vt: VTime; __VT_CFG?: { seed?: number; date0?: number } } }

(() => {
  const W = window as Window & typeof globalThis;
  if (W.__vt) return;
  const cfg = W.__VT_CFG || {};
  const realPerfNow = performance.now.bind(performance);
  void realPerfNow;
  const RealDate = Date;
  const DATE0 = cfg.date0 ?? RealDate.UTC(2026, 9, 26, 18, 30, 0);   // a fixed evening
  let now = 0;          // virtual ms
  let frame = 0;

  /* ---- Math.random: mulberry32 */
  let s = (cfg.seed ?? 1337) >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Math.random = rnd;

  /* ---- clocks */
  performance.now = () => now;
  const VDate = function (this: unknown, ...a: unknown[]) {
    if (!(this instanceof VDate)) return new RealDate(DATE0 + now).toString();
    return a.length ? new (RealDate as any)(...a) : new RealDate(DATE0 + now);
  } as unknown as DateConstructor;
  (VDate as any).prototype = RealDate.prototype;
  (VDate as any).now = () => DATE0 + Math.floor(now);
  (VDate as any).parse = RealDate.parse; (VDate as any).UTC = RealDate.UTC;
  W.Date = VDate;

  /* ---- timers */
  interface T { id: number; at: number; fn: unknown; args: unknown[]; every: number; seq: number }
  const timers = new Map<number, T>();
  let nextId = 1, seq = 0;
  const add = (fn: unknown, ms: unknown, args: unknown[], every: boolean) => {
    const d = Math.max(0, +(ms as number) || 0);
    const id = nextId++;
    timers.set(id, { id, at: now + (every ? Math.max(1, d) : d), fn, args, every: every ? Math.max(1, d) : 0, seq: seq++ });
    return id;
  };
  W.setTimeout = ((fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, false)) as any;
  W.setInterval = ((fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, true)) as any;
  W.clearTimeout = ((id?: number) => { if (id != null) timers.delete(id); }) as any;
  W.clearInterval = W.clearTimeout as any;
  const call = (t: T) => {
    try { if (typeof t.fn === 'function') (t.fn as (...a: unknown[]) => void)(...t.args); else (0, eval)(String(t.fn)); }
    catch (e) { console.error('[vt] timer', e); }
  };
  function runTimers(until: number): void {
    // fire due timers in time order (a timer scheduled by a timer runs in the same step if due)
    for (let guard = 0; guard < 10000; guard++) {
      let best: T | null = null;
      for (const t of timers.values()) if (t.at <= until && (!best || t.at < best.at || (t.at === best.at && t.seq < best.seq))) best = t;
      if (!best) break;
      if (best.every) { best.at += best.every; best.seq = seq++; if (best.at <= until - 5000) best.at = until; }
      else timers.delete(best.id);
      const saved = now; now = Math.max(now, Math.min(until, best.at));
      call(best);
      now = Math.max(saved, now);
    }
  }

  /* ---- rAF */
  let rafQ = new Map<number, FrameRequestCallback>();
  let rafId = 1;
  W.requestAnimationFrame = (cb: FrameRequestCallback) => { const id = rafId++; rafQ.set(id, cb); return id; };
  W.cancelAnimationFrame = (id: number) => { rafQ.delete(id); };

  /* ---- CSS animations / transitions (incl. shadow roots) */
  const roots = new Set<DocumentOrShadowRoot>();
  const origAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) { const r = origAttach.call(this, init); roots.add(r); return r; };
  const seen = new WeakSet<Animation>();
  function stepAnims(dt: number): void {
    const list: Animation[] = [];
    try { for (const a of document.getAnimations()) list.push(a); } catch { /* */ }
    for (const r of roots) { try { for (const a of r.getAnimations()) list.push(a); } catch { /* */ } }
    const done = new Set<Animation>();
    for (const a of list) {
      if (done.has(a)) continue; done.add(a);
      try {
        if (a.playState === 'finished' || a.playState === 'idle') continue;
        if (!seen.has(a)) { seen.add(a); a.pause(); a.currentTime = 0; }
        else if (a.playState !== 'paused') a.pause();
        const ct = (+(a.currentTime ?? 0) || 0) + dt;
        const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
        const endN = typeof end === 'number' ? end : +(end as any) || Infinity;
        if (Number.isFinite(endN) && ct >= endN) { a.currentTime = endN; a.finish(); }
        else a.currentTime = ct;
      } catch { /* */ }
    }
  }

  const vt: VTime = {
    get now() { return now; },
    get frame() { return frame; },
    hooks: [], after: [],
    step(ms) {
      const target = now + ms;
      runTimers(target);
      now = target; frame++;
      for (const h of vt.hooks) { try { h(now, ms); } catch (e) { console.error('[vt] hook', e); } }
      const q = rafQ; rafQ = new Map();
      for (const cb of q.values()) { try { cb(now); } catch (e) { console.error('[vt] raf', e); } }
      stepAnims(ms);
      for (const h of vt.after) { try { h(now, ms); } catch (e) { console.error('[vt] after', e); } }
    },
    stats() { return { timers: timers.size, raf: rafQ.size }; },
    seed(n) { s = n >>> 0; },
    realign() { for (const t of [...timers.values()].sort((a, b) => a.id - b.id)) if (t.every) { t.at = now + t.every; t.seq = seq++; } },
  };
  W.__vt = vt;
})();
export {};
