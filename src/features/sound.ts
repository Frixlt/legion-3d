/**
 * Sound: wires the game to the audio engine (src/audio). One AudioContext, created on the first user gesture
 * (autoplay policy) and closed on dispose. Silent while the classic site is shown (F8) and while the tab is hidden
 * (unless «Звук в фоне» is on); the context is suspended when muted for a while (no CPU).
 *
 * Hooks: own footsteps from the player controller speed through the avatar's gait phase (StepTracker), jump / land
 * (controller.onJump / onLand), others' footsteps and chat-bubble pops from store walkers (street only), doors from
 * the room manager (onChange → door open + close, ambience space), menus (ctx.onMenu), the crosshair target tick
 * (ctx.interact.target) and the 'l3d:sfx' window event for everything else (shop purchase, mine hits — see
 * src/audio/index.ts). Settings (group «Звук»): Общая громкость, Окружение, Эффекты, Интерфейс, Звук в фоне.
 */
import * as THREE from 'three';
import type { Unsub } from '../contracts';
import { registerSettingRow, settingValue, type RangeRow } from '../ui/settings-ext';
import { toX, toZ } from '../world/coords';
import { SoundEngine, loadBank, StepTracker, BubbleLimiter, spaceFor, surfaceFor, landGain, shouldMute, type Bank, type Space, type SfxEventDetail } from '../audio';
import { coreFeature } from './types';

const K = { master: 'l3d.vol.master', amb: 'l3d.vol.amb', sfx: 'l3d.vol.sfx', ui: 'l3d.vol.ui', bg: 'l3d.snd.bg' } as const;
const pct = (v: number) => Math.round(v * 100) + '%';
const range = (key: string, label: string, def: number, order: number, sub?: string): RangeRow =>
  ({ key, label, kind: 'range', min: 0, max: 1, step: 0.05, def, fmt: pct, group: 'Звук', order, ...(sub ? { sub } : {}) });

export default coreFeature({
  id: 'sound',
  order: 96,
  setup(ctx) {
    const offs: Unsub[] = [];
    offs.push(registerSettingRow(range(K.master, 'Общая громкость', 0.1, 10)));
    offs.push(registerSettingRow(range(K.amb, 'Окружение', 1, 20, 'сверчки, ветер, ярмарка вдали')));
    offs.push(registerSettingRow(range(K.sfx, 'Эффекты', 1, 30, 'шаги, двери, кирка')));
    offs.push(registerSettingRow(range(K.ui, 'Интерфейс', 1, 40, 'меню, покупки')));
    offs.push(registerSettingRow({ key: K.bg, label: 'Звук в фоне', sub: 'играть, когда вкладка скрыта', kind: 'seg', options: [['off', 'Выкл'], ['on', 'Вкл']], def: 'off', group: 'Звук', order: 50 }));
    const volumes = () => ({ master: settingValue(K.master, 0.1), amb: settingValue(K.amb, 1), sfx: settingValue(K.sfx, 1), ui: settingValue(K.ui, 1) });

    let ac: AudioContext | null = null, eng: SoundEngine | null = null, disposed = false;
    let space: Space = 'street';
    const bank: Bank = new Map();

    /* ---- mute state: classic site, hidden tab (unless «Звук в фоне») ---- */
    let suspendT = 0;
    const applyMute = () => {
      if (!eng || !ac) return;
      const m = shouldMute({ classic: ctx.state.classic, hidden: document.hidden, background: settingValue<string>(K.bg, 'off') === 'on' });
      eng.setMuted(m);
      if (m) { if (!suspendT && ac.state === 'running') suspendT = window.setTimeout(() => { suspendT = 0; if (eng?.isMuted && ac?.state === 'running') void ac.suspend(); }, 1500); }
      else { if (suspendT) { clearTimeout(suspendT); suspendT = 0; } if (ac.state === 'suspended') void ac.resume(); }
    };

    /* ---- start on a user gesture (autoplay policy) ---- */
    const start = async () => {
      if (ac || disposed) return;
      try { ac = new AudioContext({ latencyHint: 'interactive' }); } catch (e) { console.warn('[l3d] no WebAudio', e); return; }
      const e = new SoundEngine(ac, bank, { hrtf: () => ctx.quality() >= 2 });
      e.setVolumes(volumes(), 0);
      if (ac.state === 'suspended') void ac.resume();
      await loadBank(ac, bank, (k) => k.startsWith('bed_') || k.startsWith('step_'));
      if (disposed) return;
      eng = e; ctx.dev.sound = e;
      eng.space = space;
      eng.startBeds();
      // the master starts at 0: fade in gently (1–2 s)
      eng.setMuted(true, 0); eng.setMuted(false, 0.6); applyMute();
      await loadBank(ac, bank);
    };
    const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;
    const onGesture = () => { for (const g of GESTURES) window.removeEventListener(g, onGesture, true); void start(); };
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua?.hasBeenActive) void start(); else for (const g of GESTURES) window.addEventListener(g, onGesture, true);
    offs.push(() => { for (const g of GESTURES) window.removeEventListener(g, onGesture, true); });

    const onSettings = (e: Event) => {
      const k = (e as CustomEvent).detail?.key as string | undefined;
      if (!eng || !k) return;
      if (k.startsWith('l3d.vol.')) eng.setVolumes(volumes());
      if (k === K.bg) applyMute();
    };
    window.addEventListener('l3d:settings', onSettings);
    document.addEventListener('visibilitychange', applyMute);
    // the classic site pauses the engine (no frames): poll the flag
    const poll = window.setInterval(applyMute, 300);
    offs.push(() => { window.removeEventListener('l3d:settings', onSettings); document.removeEventListener('visibilitychange', applyMute); clearInterval(poll); });

    /* ---- generic trigger ---- */
    const onSfx = (e: Event) => {
      const d = (e as CustomEvent<SfxEventDetail>).detail;
      if (!eng || !d || typeof d.id !== 'string') return;
      const id = d.id === 'door.open' && space === 'tent' ? 'tent.flap' : d.id;   // the tent's exit is a cloth flap
      eng.play(id, { ...(typeof d.x === 'number' ? { x: d.x, y: d.y, z: d.z } : {}), gain: typeof d.gain === 'number' ? d.gain : 1, ...(typeof d.rate === 'number' ? { rate: d.rate } : {}), ...(typeof d.follow === 'function' ? { follow: d.follow } : {}) });
    };
    window.addEventListener('l3d:sfx', onSfx);
    offs.push(() => window.removeEventListener('l3d:sfx', onSfx));

    /* ---- spaces, doors ---- */
    const sceneOf = (id: string | null) => (id ? ctx.registries.buildings.get(id)?.scene ?? id : null);
    const hearth = new THREE.Vector3();
    const findHearth = (): boolean => {
      const root = ctx.rooms.scene?.root; if (!root) return false;
      let best: THREE.PointLight | null = null;
      root.traverse((o) => {
        const l = o as THREE.PointLight;
        if (!l.isPointLight) return;
        const c = l.color;
        if (c.r > 0.9 && c.g < 0.7 && c.b < 0.4 && (!best || l.intensity > best.intensity)) best = l;
      });
      if (!best) return false;
      (best as THREE.PointLight).getWorldPosition(hearth); return true;
    };
    offs.push(ctx.rooms.onChange((cur) => {
      const prev = space;
      space = spaceFor(cur ? ctx.rooms.kind : null, sceneOf(cur));
      if (!eng) return;
      eng.setSpace(space);
      eng.setFire(space === 'forge' && findHearth() ? hearth : null);
      // a door opens and shuts behind us (a tent flap / the mine's creaky timber instead of a door)
      const via = cur ? space : prev;
      if (via === 'tent') eng.play('tent.flap', { own: true });
      else if (via === 'mine') eng.play('amb.creak', { own: true, key: 'mine-door' });
      else if (!cur && performance.now() - ((window as unknown as { __l3dDoorOpened?: number }).__l3dDoorOpened || -1e9) < 1500) eng.play('door.close', { own: true, delay: 0.1 });   // opened already as the door swung
      else { eng.play('door.open', { own: true }); eng.play('door.close', { own: true, delay: 0.5 }); }
    }));

    /* ---- menus ---- */
    offs.push(ctx.onMenu((id) => { eng?.play(id ? 'ui.open' : 'ui.close'); eng?.setDuck(id ? 0.7 : 1); }));

    /* ---- jump / land ---- */
    const ctl = ctx.controller();
    offs.push(ctl.onJump(() => eng?.play('jump', { own: true })));
    offs.push(ctl.onLand((impact) => {
      if (!eng) return;
      const g = landGain(impact);
      eng.play('step.' + surfaceFor(space), { own: true, gain: 0.8 + g * 0.6, rate: 0.92, key: 'land-step' });
      if (impact > 2.5) eng.play('land', { own: true, gain: g });
    }));

    /* ---- per frame ---- */
    const me = new StepTracker();
    const others = new Map<string, StepTracker>();
    const bubbleIds = new Map<string, string>();
    const bubbles = new BubbleLimiter();
    const camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
    let lastTarget: string | null = null, primed = false;
    offs.push(ctx.onFrame((dt) => {
      const e = eng; if (!e) return;
      const cam = ctx.camera;
      cam.getWorldPosition(camPos); cam.getWorldDirection(camDir);
      e.setListener(camPos.x, camPos.y, camPos.z, camDir.x, camDir.y, camDir.z);
      e.tick(dt);
      const now = e.ac.currentTime;
      // own footsteps (the walk cycle of the own avatar)
      const c = ctx.controller();
      if (me.update(dt, c.speed / 230) && !c.airborne) e.play('step.' + surfaceFor(space), { own: true, gain: 0.85 + Math.min(0.6, me.amount) * 0.25, key: 'step-me' });
      // crosshair target tick
      const tg = ctx.gameplay() ? ctx.interact.target : null, tid = tg ? tg.id : null;
      if (tid !== lastTarget) { if (tid) e.play('ui.tick'); lastTarget = tid; }
      // own chat bubble
      const mb = ctx.store.me?.bubble;
      if (mb && bubbleIds.get('') !== mb.id) { bubbleIds.set('', mb.id); if (primed) e.play('bubble', { gain: 0.8 }); }
      if (ctx.state.inRoom) { primed = true; return; }
      // others: footsteps (quieter, positional) and bubble pops
      const world = ctx.world();
      for (const w of ctx.store.walkers.values()) {
        let st = others.get(w.login);
        if (!st) { st = new StepTracker(); others.set(w.login, st); }
        const x = toX(w.x), z = toZ(w.y);
        const dx = x - camPos.x, dz = z - camPos.z, d2 = dx * dx + dz * dz;
        if (d2 > 400) { st.reset(); continue; }
        const y = world.groundAt(w.x, w.y);
        if (st.update(dt, w.speed / 230) && d2 < 196) e.play('step.cobble', { x, y, z, gain: 0.5, key: 'st:' + w.login });
        const b = w.bubble;
        if (b && bubbleIds.get(w.login) !== b.id) {
          bubbleIds.set(w.login, b.id);
          if (primed && bubbles.allow(w.login, Math.sqrt(d2), now)) e.play('bubble', { x, y: y + 1.6, z, key: 'bb:' + w.login });
        }
      }
      primed = true;
    }));
    offs.push(ctx.store.on('walkers', () => {
      for (const l of others.keys()) if (!ctx.store.walkers.has(l)) others.delete(l);
      for (const l of bubbleIds.keys()) if (l && !ctx.store.walkers.has(l)) bubbleIds.delete(l);
    }));

    return () => {
      disposed = true;
      for (const u of offs.reverse()) { try { u(); } catch { /* */ } }
      if (suspendT) clearTimeout(suspendT);
      eng?.dispose(); eng = null;
      if (ac) { void ac.close().catch(() => { /* */ }); ac = null; }
      bank.clear();
      delete ctx.dev.sound;
    };
  },
});
