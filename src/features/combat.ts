/**
 * «Драки с котиками» (src/combat): LMB attacks by class — swings knock cats over (ragdolls), the bow is held to
 * draw and released to shoot, mages throw orbs, necromancers raise zombie cats, priests let out a light wave.
 * CLIENT-SIDE ONLY: nothing is sent to the site, other players never see it, and their real positions are untouched
 * (a knocked-over cat gets up and glides back to where the site has it).
 *
 * LMB is an attack only when: the setting is on, the pointer is locked in gameplay (no menu, modal, photo mode or
 * text field), not in a scene-mode / loading room, on the street or in the mine (never in shops), and the crosshair
 * is NOT on an interactable (doors, goods and stones keep LMB). The swing animation itself stays with the controls
 * feature (vm.swing + meAv.play('swing')); this feature adds the hit, the bow draw and the effects.
 */
import { CombatSystem, gate, type CombatHost } from '../combat';
import type { RagdollEnv } from '../combat/physics';
import type { CombatAvatar } from '../combat/ragdoll';
import { isTyping, type InputEx } from '../engine/input';
import { fromX, fromZ } from '../world/coords';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { lsStr, lsSet } from '../core/settings';
import type { World3DExt } from '../contracts/ext';
import { coreFeature } from './types';

const KEY = 'l3d.combat', HINT = 'l3d.combat.hint';

export default coreFeature({
  id: 'combat',
  order: 25,   // after the crowd animated the avatars (20), before the labels read their anchors (30)
  setup(ctx) {
    const { input, interact, rooms, engine } = ctx;
    const el = engine.renderer.domElement;
    const offRow = registerSettingRow({
      key: KEY, label: 'Драки с котиками (только у тебя)', group: 'Забавы', order: 10,
      sub: 'ЛКМ — удар своим оружием: котики забавно падают. Видишь только ты, сайту ничего не отправляется',
      kind: 'seg', options: [['on', 'Вкл'], ['off', 'Выкл']], def: 'on',
    });
    let enabled = settingValue(KEY, 'on') === 'on';
    let photo = false;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const avatars = () => ctx.dev.avatars as Map<string, { av: CombatAvatar }> | undefined;

    /* ---- the walkable space (world metres) ---- */
    const street: RagdollEnv = {
      groundAt: (x, z) => ctx.world().groundAt(fromX(x), fromZ(z)),
      blocked: (x, z) => {
        const px = fromX(x), py = fromZ(z), w = ctx.world() as unknown as Partial<World3DExt>;
        return !ctx.layout().free(px, py) || (typeof w.solidTop === 'function' && w.solidTop(px, py) === Infinity);
      },
    };
    const streetShots: RagdollEnv = {
      groundAt: street.groundAt,
      blocked: (x, z, y) => {
        const px = fromX(x), py = fromZ(z), w = ctx.world() as unknown as Partial<World3DExt>;
        return typeof w.solidTop === 'function' && w.solidTop(px, py) === Infinity && y < ctx.world().groundAt(px, py) + 5;
      },
    };
    const room: RagdollEnv = {
      groundAt: (x, z) => rooms.scene?.groundAt(x, z) ?? 0,
      blocked: (x, z) => { const sc = rooms.scene; return !sc || !sc.free(x, z) || (sc.solidTop?.(x, z) ?? -Infinity) === Infinity; },
    };

    const host: CombatHost = {
      scene: ctx.scene, camera: ctx.camera,
      forEachTarget(fn) { if (ctx.state.inRoom) return; const m = avatars(); if (m) for (const [id, a] of m) fn(id, a.av); },
      env: () => (ctx.state.inRoom ? room : street),
      shotEnv: () => (ctx.state.inRoom ? room : streetShots),
      me: {
        av: ctx.meAv as CombatAvatar, feet: ctx.feet, vm: ctx.vm,
        fp: () => ctx.rig.distance < 0.9 && !rooms.stage,
        app: () => ctx.store.me?.app ?? null,
      },
      createAvatar: (app) => ctx.kit.create(app),
      viewHeight: () => el.height || 720,
      quality: () => engine.quality,
      anchor(id, x, y, z) { const a = ctx.anchors.get(id); if (a && a.y > -900) a.set(x, y, z); },
      reducedMotion: reduced,
    };
    const sys = new CombatSystem(host);
    ctx.dev.combat = sys;

    const why = (ignoreAim = false) => gate({
      enabled, locked: input.locked, gameplay: ctx.gameplay() && input.gameplay,
      menu: !!ctx.state.menu, modals: (input as InputEx).modals?.length ?? 0, photo, typing: isTyping(),
      stage: !!rooms.stage, busy: rooms.busy, room: ctx.state.inRoom ? rooms.kind : null,
      aimed: !ignoreAim && !!interact.aimed,
    });

    // capture phase on window: runs BEFORE the controls' canvas listener, so the bow draw is set up before
    // controls calls vm.swing() (which a drawing view-model ignores)
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      if (why() !== null) return;
      if (sys.press() && lsStr(HINT, '') !== '1') {
        lsSet(HINT, '1');
        ctx.ui.toast('Драки с котиками видишь только ты — сайту ничего не отправляется. Выключить: Настройки → Забавы');
      }
    };
    const up = (e: MouseEvent) => { if (e.button === 0) sys.release(); };
    const onSettings = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.key !== KEY) return;
      enabled = d.value === 'on';
      if (!enabled) sys.reset();
    };
    const onPhoto = (e: Event) => { photo = !!(e as CustomEvent).detail?.on; if (photo) sys.cancel(); };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('mouseup', up);
    window.addEventListener('l3d:settings', onSettings);
    window.addEventListener('l3d:photo', onPhoto);
    // a room change swaps the space (and hides the crowd): everyone stands up, minions vanish
    const offRooms = rooms.onChange(() => sys.reset());

    const offFrame = ctx.onFrame((dt, t) => {
      if (sys.drawing && why(true) !== null) sys.cancel();
      if (!enabled && sys.ragdolls.size === 0) return;
      sys.update(dt, t);
    });
    return () => {
      offFrame(); offRooms(); offRow();
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('l3d:settings', onSettings);
      window.removeEventListener('l3d:photo', onPhoto);
      sys.dispose();
      delete ctx.dev.combat;
    };
  },
});
