/**
 * «Посиделки на скамейке» (IDEAS #2): E at a free bench seats YOUR cat (sitting pose on the avatar's bones); any
 * movement (keys, jump, «Идти сюда», a room) stands it up. LOCAL ONLY: nobody else sees the pose and nothing is sent —
 * the player controller is never moved, so no `go` leaves while seated (only the avatar is drawn on the seat; the
 * camera stays where you stood). Benches: the city layout's LOW.benches (src/social/bench.ts mirrors world/place.ts).
 * Setting: Настройки → Забавы → «Скамейки».
 */
import * as THREE from 'three';
import type { Interactable } from '../contracts/ext';
import type { AvatarSocial } from '../avatar/avatar';
import type { Avatar } from '../contracts/modules';
import { benchesOf, freeSeat, seatPos, BENCH_SCALE, type Bench } from '../social/bench';
import { toX, toZ } from '../world/coords';
import { funToggle, sfx } from '../social/toggle';
import { lsStr, lsSet } from '../core/settings';
import { isTyping } from '../engine/input';
import { coreFeature } from './types';

const KEY = 'l3d.fun.bench', HINT = 'l3d.fun.bench.hint';
const STAND_EPS = 0.03;   // m of feet movement that counts as «moved»
const BLEND = 0.25;       // s to glide between the feet and the seat

export default coreFeature({
  id: 'bench',
  order: 27,   // after combat (25), before labels (30): the own anchor is moved to the seat before labels read it
  setup(ctx) {
    const { interact, input } = ctx;
    const av = ctx.meAv as Avatar & Partial<AvatarSocial>;
    let seated: { b: Bench; seat: THREE.Vector3; face: number; feet: THREE.Vector3 } | null = null;
    /** Glide 0 (at the feet) … 1 (on the seat). */
    let k = 0;
    const seatTmp = { x: 0, y: 0, z: 0 };

    const stand = () => {
      if (!seated) return;
      seated = null;
      av.setSit?.(false);
    };
    const tg = funToggle(KEY, 'Скамейки', 'E у свободной скамьи — котик садится. Видно только тебе', 30, (on) => { if (!on) stand(); });

    const others = (fn: (x: number, z: number) => void) => {
      for (const w of ctx.store.walkers.values()) fn(toX(w.x), toZ(w.y));
    };
    const sit = (b: Bench) => {
      if (seated || !tg.on || ctx.state.inRoom) return;
      const f = ctx.feet;
      const s = freeSeat(b, f.x, f.z, others);
      if (s < 0) { ctx.ui.toast('Тут занято — поищи другую скамейку'); return; }
      const face = seatPos(b, s, seatTmp);
      seated = { b, seat: new THREE.Vector3(seatTmp.x, seatTmp.y, seatTmp.z), face, feet: f.clone() };
      av.setSit?.(true);
      sfx('social.sit', seated.seat);
      if (lsStr(HINT, '') !== '1') { lsSet(HINT, '1'); ctx.ui.toast('Котик сидит на скамейке — это видно только тебе. Любое движение — встать'); }
    };

    /* ---- one interactable per bench (rebuilt with the world) ---- */
    let offs: (() => void)[] = [];
    const build = () => {
      for (const o of offs) o(); offs = [];
      stand();
      const L = ctx.layout(), world = ctx.world();
      for (const b of benchesOf(L, (x, y) => world.groundAt(x, y))) {
        const hw = 0.8 * BENCH_SCALE, hd = 0.36 * BENCH_SCALE;
        const ex = Math.abs(Math.cos(b.rotY)) * hw + Math.abs(Math.sin(b.rotY)) * hd, ez = Math.abs(Math.sin(b.rotY)) * hw + Math.abs(Math.cos(b.rotY)) * hd;
        const hit = new THREE.Box3(new THREE.Vector3(b.x - ex, b.y, b.z - ez), new THREE.Vector3(b.x + ex, b.y + 1.05 * BENCH_SCALE, b.z + ez));
        const it: Interactable = {
          id: b.id,
          get label() { return seated?.b === b ? 'Встать' : 'Сесть на скамейку'; },
          icon: '🪑',
          hit, reach: 2.4,
          enabled: () => tg.on && !ctx.state.inRoom && (!seated || seated.b === b),
          use: () => { if (seated) stand(); else sit(b); },
        };
        offs.push(interact.add(it));
      }
    };
    // while seated, E means «встать» (not the door / stall that happens to be near the bench)
    const onKey = (e: KeyboardEvent) => {
      if (!seated || e.code !== 'KeyE' || e.repeat || isTyping() || !ctx.gameplay()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      stand();
    };
    window.addEventListener('keydown', onKey, true);
    const offW = ctx.onWorld(build);
    build();

    const offF = ctx.onFrame((dt) => {
      if (seated) {
        const f = ctx.feet, mv = input.move;
        if (ctx.state.inRoom || !tg.on || mv.x !== 0 || mv.y !== 0 || f.distanceToSquared(seated.feet) > STAND_EPS * STAND_EPS) { stand(); }
      }
      const target = seated ? 1 : 0;
      if (k === 0 && target === 0) return;
      k = target > k ? Math.min(1, k + dt / BLEND) : Math.max(0, k - dt / BLEND);
      if (!seated && k === 0) return;
      // ease between the feet (already set by core this frame) and the seat
      const e = k * k * (3 - 2 * k), r = av.root;
      const s = seated?.seat ?? lastSeat, face = seated?.face ?? lastFace;
      const drop = av.sitDrop ?? 0.09;
      r.position.x += (s.x - r.position.x) * e;
      r.position.z += (s.z - r.position.z) * e;
      r.position.y += (s.y - drop - r.position.y) * e;
      let d = face - r.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      r.rotation.y += d * e;
      ctx.anchors.get(ctx.me.login)?.set(r.position.x, r.position.y + av.headTop + 0.15, r.position.z);
      if (seated) { lastSeat.copy(seated.seat); lastFace = seated.face; }
    });
    const lastSeat = new THREE.Vector3(); let lastFace = 0;

    ctx.dev.bench = { sit: (i = 0) => { const L = ctx.layout(), w = ctx.world(); const b = benchesOf(L, (x, y) => w.groundAt(x, y))[i]; if (b) sit(b); return !!seated; }, stand, get seated() { return !!seated; } };
    return () => { window.removeEventListener('keydown', onKey, true); offF(); offW(); for (const o of offs) o(); offs = []; stand(); av.setSit?.(false); tg.dispose(); delete ctx.dev.bench; };
  },
});
