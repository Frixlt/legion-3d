/**
 * Seasonal events (src/events): decides which holiday decoration runs — by date window (local time), the
 * «События → Праздничное оформление» setting (Авто / Всегда / Выкл) and, on dev pages only, `?event=<id>` (or
 * `?event=off`) — and sets it up in the city / disposes it again. Re-evaluated when the setting changes, when the
 * city world is rebuilt and once a minute (midnight rolls the window). Decorations live in one group, a sibling of the
 * world root, hidden while the player is inside a room.
 */
import * as THREE from 'three';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { fromX, fromZ } from '../world/coords';
import { EVENTS, EVENT_SETTING, pickEvent, parseMode, type SeasonalEvent, type EventContext } from '../events';
import { coreFeature } from './types';

declare const __DEV__: boolean;

/** Dev override from the URL (`?event=halloween`, `?event=off`); ignored in the shipped extension. */
export function forcedEvent(search: string = typeof location !== 'undefined' ? location.search : ''): string | null {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  const v = new URLSearchParams(search).get('event');
  return v ? v.toLowerCase() : null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export default coreFeature({
  id: 'seasonal',
  order: 85,
  setup(ctx) {
    const offRow = registerSettingRow({
      key: EVENT_SETTING, label: 'Праздничное оформление', sub: 'Хэллоуин: 24 октября – 3 ноября. «Авто» — только в дни праздника',
      kind: 'seg', options: [['auto', 'Авто'], ['on', 'Всегда'], ['off', 'Выкл']], def: 'auto', group: 'События', order: 10,
    });
    const group = new THREE.Group(); group.name = 'events'; ctx.scene.add(group);
    let cur: { ev: SeasonalEvent; world: unknown; stop: () => void } | null = null;

    const choose = (): SeasonalEvent | null => {
      const forced = forcedEvent();
      if (forced === 'off') return null;
      return pickEvent(EVENTS, new Date(), parseMode(settingValue(EVENT_SETTING, 'auto')), forced);
    };
    const stop = () => { if (!cur) return; const c = cur; cur = null; try { c.stop(); } catch (e) { console.warn('[l3d] event dispose', e); } };
    const refresh = () => {
      const world = ctx.world(), ev = choose();
      if (cur && cur.ev === ev && cur.world === world) return;
      stop();
      if (!ev) return;
      const sub = new Set<() => void>();
      const ec: EventContext = {
        group, scene: ctx.scene, world: world as EventContext['world'], layout: ctx.layout(),
        groundAt: (X, Z) => world.groundAt(fromX(X), fromZ(Z)),
        onFrame: (fn) => { const u = ctx.onFrame(fn); sub.add(u); return () => { sub.delete(u); u(); }; },
        quality: () => ctx.quality(),
        onQuality: (fn) => { const u = ctx.engine.onQuality(fn); sub.add(u); return () => { sub.delete(u); u(); }; },
        renderer: ctx.engine.renderer, camera: ctx.camera, toast: (t) => ctx.ui.toast(t),
      };
      try {
        const dispose = ev.setup(ec);
        cur = { ev, world, stop: () => { try { dispose(); } finally { for (const u of sub) u(); sub.clear(); } } };
        const k = 'l3d.event.seen.' + ev.id, today = dayKey(new Date());
        let seen: string | null = null; try { seen = localStorage.getItem(k); } catch { /* private mode */ }
        if (seen !== today && !forcedEvent() && parseMode(settingValue(EVENT_SETTING, 'auto')) === 'auto') {
          try { localStorage.setItem(k, today); } catch { /* */ }
          ctx.ui.toast('🎃 С Хэллоуином! Город украшен — отключить можно в настройках («События»).');
        }
      } catch (e) {
        console.error(`[l3d] event "${ev.id}" failed`, e);
        for (const u of sub) u(); sub.clear();
      }
    };

    refresh();
    const onSet = (e: Event) => { const k = (e as CustomEvent).detail?.key; if (!k || k === EVENT_SETTING) refresh(); };
    window.addEventListener('l3d:settings', onSet);
    const offW = ctx.onWorld(() => refresh());
    let acc = 0;
    const offF = ctx.onFrame((dt) => {
      group.visible = !ctx.state.inRoom;
      acc += dt; if (acc > 60) { acc = 0; refresh(); }
    });
    ctx.dev.seasonal = { refresh, active: () => cur?.ev.id ?? null, group };
    return () => { offF(); offW(); window.removeEventListener('l3d:settings', onSet); stop(); group.removeFromParent(); offRow(); };
  },
});
