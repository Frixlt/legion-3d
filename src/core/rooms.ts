/**
 * RoomManager: entering a building.
 *
 *   enter(id) → registries.buildings.resolve(id).room = kind ('shop3d' | 'hybrid' | 'mine3d' | 'site' | 'none')
 *             → registries.rooms.get(kind).create(roomCtx) → RoomScene
 *             → host.setSpace(scene): city world, other avatars and labels hidden, room.root added, the player
 *               controller walks the room's floor, TP camera collides with room.colliders.
 *   exit()    → scene.dispose(), interactables/frame hooks the room registered are removed, the player is back on
 *               the street at the building door facing the street; the site panel (hybrid) is closed.
 *
 * Fallback chain: kind 'site', a missing room kind, or a factory that throws → the site's own 2D screen
 * (actions.openBuilding(id) = LGCity.panel(id)), i.e. the v0.1 behaviour.
 * 'hybrid': after the 3D scene is up, the site's panel for the building opens over it (html.l3d-room3d makes the
 * site's room transparent except the header and the panel). Leaving through the site's «Выйти» exits the room too
 * (the overlay watcher calls exit() when the panel disappears).
 */
import type { Building, Unsub } from '../contracts';
import type { GameContext, Interactable, RoomContext, RoomManager, RoomScene } from '../contracts/ext';
import type { Registries } from './registries';

export interface RoomHost {
  ctx: GameContext;
  registries: Registries;
  building(id: string): Building | undefined;
  /** Swap the walkable space (scene) or return to the street at the door px facing `face`. */
  setSpace(scene: RoomScene | null, back?: { x: number; y: number; face: number }): void;
  /** The site's own building screen (v0.1 path). */
  openSite(id: string): void;
  /** Open / close the site panel docked over our 3D room (hidePanel must be a no-op for an already closed panel). */
  showPanel(id: string, side?: 'left' | 'right' | 'full'): void;
  hidePanel(): void;
  veil(title: string | null): void;
  toast(text: string, bad?: boolean): void;
}

export interface RoomManagerEx extends RoomManager {
  /** Kind of the active room ('shop3d' | 'hybrid' | 'mine3d' | …) or null. */
  readonly kind: string | null;
  readonly scene: RoomScene | null;
  /** The site panel is shown over the active 3D room. */
  readonly panel: boolean;
  /** An enter() is in progress (scene loading). */
  readonly busy: boolean;
  /** Per-frame room update (core calls it instead of world.update while a room is active). */
  update(dt: number, t: number, camera: import('three').Camera): void;
  onChange(fn: (current: string | null) => void): Unsub;
  /** The site panel of the hybrid room went away by itself (site «Выйти»): leave the room. */
  panelClosedBySite(): void;
}

const SOON = 'Здание ещё строится — скоро откроется';

export function createRoomManager(host: RoomHost): RoomManagerEx {
  let current: string | null = null, kind: string | null = null, scene: RoomScene | null = null;
  let panel = false, busy = false, seq = 0;
  let owned: Unsub[] = [];
  const subs = new Set<(c: string | null) => void>();
  const frameFns: ((dt: number, t: number) => void)[] = [];
  const emit = () => { for (const f of [...subs]) { try { f(current); } catch (e) { console.error('[l3d] rooms listener', e); } } };

  const fallbackSite = (id: string, why?: unknown) => {
    if (why) console.warn(`[l3d] room for "${id}" failed, opening the site's screen`, why);
    host.openSite(id);
  };

  const makeCtx = (b: Building): RoomContext => {
    const base = host.ctx;
    const interact = {
      add(i: Interactable): Unsub { const u = base.interact.add(i); owned.push(u); return u; },
      get target() { return base.interact.target; },
    };
    const extra = {
      building: b,
      interact,
      onFrame(fn: (dt: number, t: number) => void): Unsub {
        frameFns.push(fn);
        const u = () => { const k = frameFns.indexOf(fn); if (k >= 0) frameFns.splice(k, 1); };
        owned.push(u); return u;
      },
      exit: () => mgr.exit(),
      // idempotent: the manager opens the panel of a hybrid room on entering, the room may ask again (NPC «Открыть»)
      showSitePanel: (opts?: { side?: 'left' | 'right' | 'full' }) => { if (panel && current === b.id) return; panel = true; host.showPanel(b.id, opts?.side); },
      hideSitePanel: () => { if (panel) { panel = false; host.hidePanel(); } },
    };
    // prototype chain keeps the base context's getters (player, quality…) live
    return Object.assign(Object.create(base) as GameContext, extra) as RoomContext;
  };

  const mgr: RoomManagerEx = {
    get current() { return current; },
    get kind() { return kind; },
    get scene() { return scene; },
    get panel() { return panel; },
    get busy() { return busy; },

    async enter(id) {
      if (busy || current === id) return;
      const b = host.building(id);
      if (b?.soon) { host.toast(SOON); return; }
      const def = host.registries.buildings.resolve(id);
      if (def.room === 'none') return;
      if (current) mgr.exit();
      const roomDef = def.room === 'site' ? undefined : host.registries.rooms.get(def.room);
      if (!roomDef || !b) { fallbackSite(id); return; }
      const my = ++seq;
      busy = true;
      host.veil(roomDef.title ?? b.title);
      const ctx = makeCtx(b);
      let sc: RoomScene;
      try {
        sc = await roomDef.create(ctx);
      } catch (e) {
        busy = false; host.veil(null);
        for (const u of owned) u(); owned = [];
        fallbackSite(id, e);
        return;
      }
      busy = false;
      if (my !== seq) {   // cancelled meanwhile (exit() or another enter())
        for (const u of owned) u(); owned = []; frameFns.length = 0;
        try { sc.dispose(); } catch { /* */ }
        return;
      }
      try {
        host.setSpace(sc);
      } catch (e) {
        try { sc.dispose(); } catch { /* */ }
        for (const u of owned) u(); owned = [];
        host.veil(null);
        fallbackSite(id, e);
        return;
      }
      scene = sc; current = id; kind = def.room;
      host.veil(null);
      if (def.room === 'hybrid') ctx.showSitePanel();
      emit();
    },

    exit() {
      seq++;   // cancels a pending enter
      if (busy) { busy = false; host.veil(null); }
      if (!current) return;
      const b = host.building(current);
      const sc = scene;
      if (panel) { panel = false; host.hidePanel(); }
      for (const u of owned) { try { u(); } catch { /* */ } }
      owned = []; frameFns.length = 0;
      scene = null; current = null; kind = null;
      host.setSpace(null, b ? { x: b.door.x, y: b.door.y, face: Math.PI } : undefined);
      try { sc?.dispose(); } catch (e) { console.error('[l3d] room dispose', e); }
      emit();
    },

    panelClosedBySite() {
      if (!panel) return;
      panel = false;
      host.hidePanel();   // the site already closed it: this only drops our transparent-room mode
      mgr.exit();
    },

    update(dt, t, camera) {
      if (!scene) return;
      scene.update(dt, t, camera);
      for (let i = 0; i < frameFns.length; i++) frameFns[i](dt, t);
    },

    onChange(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
  return mgr;
}
