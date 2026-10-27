/**
 * «Летать за мага» (owner request 2026-10-27): heroes of the magic classes (mage / necromancer / priest, or a staff,
 * crook or tome in the paw) levitate. Space twice (the second press in the air) or Space held through a jump takes
 * off; in the air Space = up, X = down, WASD = fly, Shift = faster; X down to the ground or Space twice = soft landing.
 * Max 8 m on the street, a 1 m hover in the 3D shops and the mine (ceilings); hybrid rooms, menus, DOM cards, photo
 * mode and the classic site end the flight with a gentle landing. Others get a hint «летают маги».
 *
 * CLIENT-ONLY and purely visual: the height is never sent; the controller keeps x/y on the walk grid while flying
 * (PlayerControllerEx.setFlight, src/engine/player.ts), so the go() points the city sends (throttled as always by
 * the core) stay valid. Setting: Настройки → Забавы → «Полёт магов».
 * Cost: one shared particle draw call (src/combat/funfx.ts) + a one-frame ground ring; bone tweaks on the own avatar.
 */
import { canFly, FlightLogic, FLY } from '../flight/rules';
import { FlightLook } from '../flight/visual';
import { acquireFunFx } from '../combat/funfx';
import type { CombatAvatar } from '../combat/ragdoll';
import { isTyping, type InputEx } from '../engine/input';
import { funToggle, reducedMotion, sfx } from '../social/toggle';
import { lsStr, lsSet } from '../core/settings';
import { coreFeature } from './types';

const KEY = 'l3d.fun.flight', HINT = 'l3d.fun.flight.hint';
const FLY_ROOMS = new Set(['shop3d', 'mine3d']);

export default coreFeature({
  id: 'flight',
  order: 24,   // after the crowd (20); the own avatar was animated by the core before every feature
  setup(ctx) {
    const { input, rooms, engine } = ctx;
    const inp = input as InputEx;
    const logic = new FlightLogic(), look = new FlightLook();
    const tg = funToggle(KEY, 'Полёт магов', 'Маги, некроманты и жрецы летают: Space дважды — взлететь, Space — выше, X — ниже. Только у тебя, сайт видит обычную ходьбу', 50);
    const reduced = reducedMotion();
    const fun = acquireFunFx({ scene: ctx.scene, camera: ctx.camera, onFrame: ctx.onFrame, viewHeight: () => engine.renderer.domElement.height || 720 });
    const dev = { logic, look, force: false, allowed: () => allowed(), mage: () => mage(), fx: fun.fx };
    ctx.dev.flight = dev;
    let photo = false, down = false, denyAt = -Infinity, now = 0, wasFlying = false;
    let prevPhase: FlightLogic['phase'] = 'off';

    const mage = () => dev.force || canFly(ctx.store.me?.app);
    const allowed = () => {
      if (!tg.on || photo || !mage()) return false;
      if (!ctx.gameplay() || ctx.state.classic || (inp.modals?.length ?? 0) > 0) return false;
      if (rooms.busy || rooms.stage) return false;
      return !ctx.state.inRoom || FLY_ROOMS.has(rooms.kind || '');
    };
    const maxH = () => (ctx.state.inRoom ? FLY.maxRoom : FLY.maxStreet);
    const keyOk = () => input.gameplay && !isTyping();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyX') { if (keyOk() && !e.ctrlKey && !e.metaKey && !e.altKey) down = true; return; }
      if (e.code !== 'Space' || e.repeat || !keyOk()) return;
      const ctl = ctx.controller();
      const r = logic.tap(ctl.airborne, allowed(), Math.max(0, ctl.feetY - ctl.ground), maxH());
      if (r === 'deny' && tg.on && now - denyAt > 20 && !ctx.state.inRoom) {
        denyAt = now;
        ctx.ui.toast('Летают маги: маг, некромант или жрец (посох, гримуар…). Ты пока просто прыгаешь 🙂');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'KeyX') down = false; };
    const onBlur = () => { down = false; };
    const onPhoto = (e: Event) => { photo = !!(e as CustomEvent).detail?.on; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('l3d:photo', onPhoto);
    // the help screen lists the key; X only does something while flying
    const offKey = ctx.registries.keys.register('flight.down', {
      code: 'KeyX', label: 'Полёт мага: ниже (Space дважды — взлететь)',
      run: () => logic.phase !== 'off',
    });

    function takeOff() {
      const f = ctx.feet;
      sfx('fly.up', { x: f.x, y: f.y, z: f.z });
      if (lsStr(HINT, '') !== '1') {
        lsSet(HINT, '1');
        ctx.ui.toast('Полёт! Space — выше, X — ниже, Space дважды — приземлиться. Сайт видит обычную ходьбу');
      }
      const fx = fun.fx, R = () => fx.rnd();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        fx.emit(4 /* SH_SPARK */, f.x, f.y + 0.1, f.z, Math.cos(a) * 2.2, 0.6 + R(), Math.sin(a) * 2.2, 0.35, 0.12, 0.03, 0.75, 0.9, 1, 1, -2, 3, true, a);
      }
      fx.ring(f.x, ctx.controller().ground, f.z, 0.2, 1.4, 0.5, '#bfe8ff', 0.9, 0.3);
    }

    const offFrame = ctx.onFrame((dt, t) => {
      now += dt;
      const ctl = ctx.controller();
      // a room change / teleport ends the flight inside the controller
      if (logic.phase !== 'off' && wasFlying && !ctl.flying) logic.reset();
      const above = Math.max(0, ctl.feetY - ctl.ground);
      const h = logic.update(dt, { up: keyOk() && inp.jump, down: down && keyOk(), airborne: ctl.airborne, above, allowed: allowed(), max: maxH() });
      if (logic.phase === 'fly' && prevPhase === 'off') takeOff();
      prevPhase = logic.phase;
      if (h !== null) ctl.setFlight(h);
      else if (ctl.flying) ctl.setFlight(null);
      wasFlying = ctl.flying || h !== null;
      // the look: pose, bob, ground glow, sparkles (also while the pose eases out after landing)
      const av = ctx.meAv as CombatAvatar;
      const on = logic.phase !== 'off';
      if (on || look.k > 0) {
        const bob = look.pose(av.combatRig?.() ?? null, dt, t, on, above, ctl.speed / 230, reduced);
        if (bob) av.root.position.y += bob;
        const app = ctx.store.me?.app;
        look.effects(fun.fx, dt, t, ctx.feet.x, ctx.feet.y + bob, ctx.feet.z, ctl.ground, av.root.rotation.y, String(app?.role || 'mage'), engine.quality, reduced);
      }
    });

    return () => {
      offFrame(); offKey(); tg.dispose(); fun.release();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('l3d:photo', onPhoto);
      const ctl = ctx.controller(); if (ctl.flying) ctl.setFlight(null);
      delete ctx.dev.flight;
    };
  },
});
