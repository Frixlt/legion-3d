/**
 * hybrid rooms — a 3D interior with an NPC, and the site's own functional panel docked over it
 * (ctx.showSitePanel({ side })): trainer (skills), board (news), hall (town storage), auction, storage, gate, anvil
 * (enchanting at the open forge shed).
 *
 *   registerHybridRooms(registries.rooms)     // registers room kind 'hybrid'
 *   BuildingDef { room: 'hybrid', scene?: 'trainer' | 'board' | 'hall' | 'auction' | 'storage' | 'gate' | 'anvil' | 'plain' }
 *
 * The panel opens on entering (side per the site's ROOM table: 'left' for most, 'right' for trainer/board, which the
 * site shows as an overlay) and again when the player uses the NPC / the desk («Открыть: …»).
 */
import type { Unsub } from '../../contracts';
import type { Registry, RoomDef, RoomContext, RoomScene } from '../../contracts/ext';
import { RoomBase, envFromCtx, type RoomEnv } from '../common/base';
import { hitBox } from '../common/kit';
import { HYBRID_SCENES, type HybridSpec } from './scenes';

export { HYBRID_SCENES };
export type { HybridSpec };

/** Build a hybrid room for a RoomEnv (registered RoomDef and dev/rooms.ts). */
export async function createHybridRoom(env: RoomEnv): Promise<RoomScene> {
  const id = env.variant || env.building.id;
  const spec = HYBRID_SCENES[id] || HYBRID_SCENES.plain;
  const R = new RoomBase(env, 'hybrid:' + id);
  try {
    const desk = spec.build(R, env);
    const side = spec.side || 'left';
    const open = () => env.showSitePanel?.({ side });
    if (desk) {
      R.interact({ id: 'room:panel:' + id, label: spec.verb ? `${spec.verb}` : `Открыть: ${env.building.title || id}`, icon: env.building.icon || '📋',
        hit: hitBox(desk.x, desk.y, desk.z, desk.w, desk.h, desk.d, 'room:hit:panel'), reach: 4, use: open });
    }
    const scene = R.finish();
    // open the site's panel once the room is shown
    let opened = false;
    const up = scene.update.bind(scene);
    scene.update = (dt, t, cam) => { if (!opened) { opened = true; if (spec.autoOpen !== false) open(); } up(dt, t, cam); };
    const dis = scene.dispose.bind(scene);
    scene.dispose = () => { try { env.hideSitePanel?.(); } catch { /* ignore */ } dis(); };
    return scene;
  } catch (e) { R.dispose(); throw e; }
}

export const hybridRoom: RoomDef = {
  title: 'Здание',
  create: (ctx: RoomContext) => createHybridRoom(envFromCtx(ctx)),
};

/** Register room kind 'hybrid' (scene by BuildingDef.scene or the building id; unknown → 'plain' hall). */
export function registerHybridRooms(rooms: Registry<RoomDef>): Unsub {
  return rooms.register('hybrid', hybridRoom);
}
