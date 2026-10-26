/**
 * Director runtime (page side). The orchestrator (scripts/video/render.mjs):
 *   1. steps virtual time until window.__l3dGame exists, then calls __director.init(segmentId);
 *   2. keeps stepping until __director.status is 'ready' (or 'skip:…' / 'error:…');
 *   3. steps `preroll` frames (segment pose held at t = 0), calls __director.go(), then steps + captures every frame.
 * Each step the director hook (vt.hooks, before the game's rAF frame) calls segment.frame(G, t) with the
 * segment-local time t = frames since go() / FPS — so motion depends only on the frame number.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { G } from './kit';
import { SEGMENTS, type Segment, FPS } from '../shots';
import { setupDemo } from './demo';

type Status = 'idle' | 'setup' | 'ready' | string;

interface Director {
  status: Status;
  segments: { id: string; dur: number; xfade: number; title: string; test: boolean; page: string }[];
  /** the page of the segment has booted */
  booted(page: string): boolean;
  init(id: string): void;
  go(): void;
  /** frames since go() */
  readonly frame: number;
  /** skip rendering (resume fast-forward) */
  fast(on: boolean): void;
  info(): any;
}

declare global { interface Window { __director: Director; __l3dGame?: any; __demo?: any } }

(() => {
  let seg: Segment | null = null;
  let G: G | null = null;
  let started = -1;      // vt frame at go()
  let status: Status = 'idle';
  let fastOn = false, wrapped = false;
  // Rendering may use Math.random (post noise, particles…). Give it its own stream, seeded per frame, so the
  // simulation's random sequence is the same whether frames are rendered or fast-forwarded (resume / --chunk).
  const wrapRender = () => {
    const r = (window.__l3dGame || (window as any).__showcase)?.engine?.renderer; if (!r || wrapped) return;
    wrapped = true;
    const real = r.render.bind(r);
    let rs = 1, rf = -1;
    const rrnd = () => { rs = (rs + 0x6d2b79f5) >>> 0; let x = rs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    r.render = (scene: unknown, camera: unknown) => {
      if (fastOn) return;
      if (rf !== vt.frame) { rf = vt.frame; rs = (vt.frame * 2654435761) >>> 0; }
      const sim = Math.random; Math.random = rrnd;
      try { real(scene, camera); } finally { Math.random = sim; }
    };
  };
  const vt = window.__vt;

  const d: Director = {
    get status() { return status; },
    set status(s) { status = s; },
    segments: SEGMENTS.map((s) => ({ id: s.id, dur: s.dur, xfade: s.xfade ?? 0, title: s.title, test: !!s.test, page: s.page || 'game' })),
    get frame() { return started < 0 ? -1 : vt.frame - started; },
    init(id) {
      seg = SEGMENTS.find((s) => s.id === id) || null;
      if (!seg) { status = 'error:no segment ' + id; return; }
      const g = window.__l3dGame;
      G = g ? { g, ctx: g.ctx, rig: g.rig, ctl: g.player, input: g.ctx.input, store: g.store, ui: g.ui, demo: window.__demo, sc: null }
        : { g: null, ctx: null, rig: null, ctl: null, input: null, store: null, ui: null, demo: null, sc: (window as any).__showcase };
      status = 'setup';
      // the boot took a machine-dependent number of frames: restart randomness and interval phases from here
      vt.seed(0x5eed + id.length); vt.realign();
      (async () => {
        try {
          if (g) setupDemo(G!);
          const why = seg!.requires ? seg!.requires(G!) : null;
          if (why) { status = 'skip:' + why; return; }
          await seg!.setup(G!);
          wrapRender();
          vt.seed(0xc0ffee + id.length); vt.realign();   // setup took a machine-dependent number of frames too
          status = 'ready';
        } catch (e: any) { status = 'error:' + (e?.stack || e); }
      })();
    },
    go() { started = vt.frame; },
    booted(page) {
      if (page === 'showcase') return !!(window as any).__showcase?.ready && document.fonts.status === 'loaded';
      return !!(window.__l3dGame && window.__demo && document.fonts.status === 'loaded');
    },
    fast(on) { wrapRender(); fastOn = on; },
    info() {
      const g = window.__l3dGame; if (!g) return { st: status, f: d.frame };
      return { st: status, f: d.frame, me: [Math.round(g.player.x), Math.round(g.player.y)], units: g.player.units, mode: g.rig.mode,
        yaw: +g.rig.yaw.toFixed(3), q: g.engine.quality, stats: g.engine.stats(), room: g.rooms?.current ?? null, menu: g.ctx.state.menu };
    },
  };
  window.__director = d;

  vt.hooks.push(() => {
    if (!seg || !G || (status !== 'ready')) return;
    const f = started < 0 ? 0 : vt.frame - started - 1;   // first captured frame = t 0
    try { seg.frame(G, f / FPS); } catch (e) { console.error('[director]', e); }
  });
})();
