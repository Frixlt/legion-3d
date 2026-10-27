/**
 * «Тихое „ура“» (IDEAS #4): an own achievement or level-up — a journal entry from the live channel (SSE `j`, teed by
 * src/bridge into window.__L3D_BUS as 'sse:j') or a higher hero level in the store — throws a short confetti burst
 * around YOUR cat (one THREE.Points, src/social/confetti.ts) with a soft chime. Nothing is sent or posted anywhere.
 * Deduped by entry id (and one burst per 4 s: a level-up arrives both as a journal line and as a hero update);
 * entries older than two minutes (reconnect replays) are ignored. Particles by quality (q0 fewest) and fewer with
 * prefers-reduced-motion. Setting: Настройки → Забавы → «Конфетти за достижения».
 */
import { Confetti, milestoneOf, journalEntries } from '../social/confetti';
import { SeenIds } from '../social/mood';
import { funToggle, reducedMotion, sfx } from '../social/toggle';
import { coreFeature } from './types';

const KEY = 'l3d.fun.confetti';
const MERGE = 4;   // s

type BusLike = { on(type: string, fn: (d: unknown) => void): () => void; last?: Record<string, unknown> };

export default coreFeature({
  id: 'cheers-fx',
  order: 86,
  setup(ctx) {
    let fx: Confetti | null = null;
    const tg = funToggle(KEY, 'Конфетти за достижения', 'Новый уровень или достижение — конфетти вокруг твоего котика. Только у тебя', 50, (on) => { if (!on) fx?.clear(); });
    const reduced = reducedMotion();
    const seen = new SeenIds(300);
    let now = 0, lastBurst = -Infinity;

    const burst = (id: string): boolean => {
      if (!seen.add(id) || !tg.on) return false;
      if (now - lastBurst < MERGE) return false;
      lastBurst = now;
      if (!fx) { fx = new Confetti(); ctx.scene.add(fx.points); }
      const q = ctx.engine.quality;
      const n = reduced ? 30 : q <= 0 ? 40 : q === 1 ? 70 : 110;
      const r = ctx.meAv.root.position;
      fx.burst(r.x, r.y + Math.min(1.1, ctx.meAv.headTop * 0.8), r.z, n, 0.4);
      sfx('social.chime');
      return true;
    };

    /* ---- journal (SSE j) ---- */
    let offBus: (() => void) | null = null;
    const onJ = (d: unknown) => {
      for (const e of journalEntries(d)) {
        const id = milestoneOf(e);
        if (!id) continue;
        const at = Number((e as { at?: unknown }).at);
        if (Number.isFinite(at) && at > 1e12 && Date.now() - at > 120000) { seen.add(id); continue; }
        burst(id);
      }
    };
    const attach = () => {
      const bus = (window as unknown as { __L3D_BUS?: BusLike }).__L3D_BUS;
      if (!bus || typeof bus.on !== 'function') return false;
      // what the bus already holds was before we started: never celebrate it
      const last = bus.last?.['sse:j'];
      if (last) for (const e of journalEntries(last)) { const id = milestoneOf(e); if (id) seen.add(id); }
      offBus = bus.on('sse:j', onJ);
      return true;
    };
    let tryAt = 0;
    attach();

    /* ---- hero level ---- */
    let level = ctx.store.hero?.level ?? 0;
    const offHero = ctx.store.on('hero', () => {
      const lv = ctx.store.hero?.level ?? 0;
      if (level > 0 && lv > level) burst('lvl:' + lv);
      if (lv > 0) level = lv;
    });

    const offF = ctx.onFrame((dt) => {
      now += dt;
      if (!offBus && now > tryAt) { tryAt = now + 2; attach(); }
      if (fx?.active) fx.update(dt);
    });
    ctx.dev.confetti = { burst: (id = 'dev:' + Math.random()) => burst(id), journal: onJ, get fx() { return fx; }, get level() { return level; } };
    return () => { offF(); offHero(); offBus?.(); fx?.dispose(); fx = null; tg.dispose(); delete ctx.dev.confetti; };
  },
});
