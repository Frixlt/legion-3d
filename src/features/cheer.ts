/**
 * «Публика на „бонк“» (IDEAS #3): when a local combat hit lands on a cat ('l3d:combat' kind 'hit'), 1–3 nearby
 * standing cats turn to it and cheer / clap / laugh for a moment, then go back to what the site has them do (their
 * positions are never touched; only the facing for ~1.5 s and an emote). Rarely one says a small «ха-ха» aside (a
 * dashed, italic bubble — not a chat line, and never over a real bubble). Cooldowns: CHEER_GAP for the crowd,
 * CHEER_CAT_GAP per cat. Off at q0; one cat with prefers-reduced-motion. Setting: Настройки → Забавы → «Публика».
 */
import type { Avatar } from '../contracts/modules';
import type { AvatarSocial } from '../avatar/avatar';
import { pickCheerers, cheerFor, cheerMax, CHEER_GAP, CHEER_CAT_GAP, ASIDE_CHANCE, ASIDES, type Bystander, type Cheer } from '../social/cheer';
import { funToggle, reducedMotion, sfx } from '../social/toggle';
import { coreFeature } from './types';

const KEY = 'l3d.fun.cheer';
const REACT = 1.5;   // s of turned facing

interface Reaction { id: string; at: number; kind: Cheer; yaw: number; aside: string | null; started: boolean }

export default coreFeature({
  id: 'cheer',
  order: 26,   // after the crowd (20) and combat (25) posed the avatars this frame
  setup(ctx) {
    const tg = funToggle(KEY, 'Публика на «бонк»', 'Соседние котики хлопают и смеются, когда ты кого-то стукнул. Только у тебя', 40, (on) => { if (!on) pending.length = 0; });
    const reduced = reducedMotion();
    type Entry = { av: Avatar & Partial<AvatarSocial>; lod: number };
    const avatars = () => ctx.dev.avatars as Map<string, Entry> | undefined;
    const ragdolls = () => (ctx.dev.combat as { ragdolls?: Map<string, unknown> } | undefined)?.ragdolls;
    const lastCat = new Map<string, number>();
    const pending: Reaction[] = [];
    let lastCrowd = -Infinity, now = 0;
    const cands: Bystander[] = [];

    const onHit = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind?: string; x?: number; z?: number; target?: string } | undefined;
      if (!d || d.kind !== 'hit' || !tg.on || ctx.state.inRoom || typeof d.x !== 'number' || typeof d.z !== 'number') return;
      const max = reduced ? Math.min(1, cheerMax(ctx.engine.quality)) : cheerMax(ctx.engine.quality);
      if (max <= 0 || now - lastCrowd < CHEER_GAP) return;
      const m = avatars(); if (!m) return;
      const rd = ragdolls();
      cands.length = 0;
      for (const [id, a] of m) {
        const w = ctx.store.walkers.get(id);
        if (!w || a.lod < 0 || a.lod > 1 || w.speed > 25) continue;   // visible, near-detail, standing
        cands.push({ id, x: a.av.root.position.x, z: a.av.root.position.z });
      }
      const ids = pickCheerers(cands, d.x, d.z, max, (id) => id === d.target || !!rd?.has(id) || now - (lastCat.get(id) ?? -Infinity) < CHEER_CAT_GAP || pending.some((p) => p.id === id));
      if (!ids.length) return;
      lastCrowd = now;
      const asideAt = Math.random() < ASIDE_CHANCE ? Math.floor(Math.random() * ids.length) : -1;
      ids.forEach((id, i) => {
        const p = m.get(id)!.av.root.position;
        // Walker.face: 0 looks to −Z; yaw towards the hit
        const yaw = Math.atan2(-(d.x! - p.x), -(d.z! - p.z));
        pending.push({ id, at: now + 0.15 + i * 0.22 + Math.random() * 0.1, kind: cheerFor(i), yaw, aside: i === asideAt ? ASIDES[(Math.random() * ASIDES.length) | 0] : null, started: false });
        lastCat.set(id, now);
      });
      const p0 = m.get(ids[0])!.av.root.position;
      sfx('social.cheer', { x: p0.x, y: p0.y + 1, z: p0.z });
    };
    window.addEventListener('l3d:combat', onHit);

    const offF = ctx.onFrame((dt) => {
      now += dt;
      if (!pending.length) return;
      const m = avatars(), rd = ragdolls();
      for (let i = pending.length - 1; i >= 0; i--) {
        const r = pending[i];
        const a = m?.get(r.id), w = ctx.store.walkers.get(r.id);
        if (!a || !w || rd?.has(r.id) || ctx.state.inRoom || now > r.at + REACT) { pending.splice(i, 1); continue; }
        if (now < r.at - 0.25) continue;
        // turn towards the hit (eased in, eased back out near the end); the crowd set rotation.y = w.face this frame
        const t = now - (r.at - 0.25), k = Math.min(1, t / 0.25) * Math.min(1, (r.at + REACT - now) / 0.3);
        let dy = r.yaw - w.face; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.av.root.rotation.y = w.face + dy * k;
        if (!r.started && now >= r.at) {
          r.started = true;
          a.av.play(r.kind);
          a.av.setMood?.(r.kind === 'laugh' ? 'laugh' : 'happy', 1.4);
          if (r.aside && !w.bubble) { ctx.labels.bubbleStyle(r.id, 'aside', 1700); ctx.labels.bubble(r.id, r.aside, 1600); }
        }
      }
    });
    ctx.dev.cheer = { hit: (x: number, z: number, target = '') => onHit(new CustomEvent('l3d:combat', { detail: { kind: 'hit', x, y: 0, z, target } })), pending };
    return () => { offF(); window.removeEventListener('l3d:combat', onHit); pending.length = 0; tg.dispose(); delete ctx.dev.cheer; };
  },
});
