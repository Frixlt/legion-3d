/**
 * Rooms: built-in room kinds and the page CSS for hybrid rooms.
 *  - 'debug': a minimal 3D hall (src/core/debugRoom.ts) — reachable in dev with `?room=<building>:debug`.
 *  - 'shop3d' / 'hybrid' / 'mine3d' are registered by the room modules (src/rooms/*, see src/features/index.ts);
 *    until a kind is registered the room manager opens the site's own screen for it.
 *  - html.l3d-room3d (set while a hybrid room shows the site's panel over our 3D scene): the site's room layer is
 *    transparent and click-through except its header («Выйти») and its panel.
 */
import { debugRoom } from '../core/debugRoom';
import { coreFeature } from './types';

export const ROOM3D_CSS = `
html.l3d-room3d .cy-room{background:transparent!important;pointer-events:none}
html.l3d-room3d .cy-room .cy-rs{display:none}
html.l3d-room3d .cy-room .cy-rh,html.l3d-room3d .cy-room .cy-rui{pointer-events:auto}
html.l3d-room3d .cy-room .cy-rsay2{pointer-events:auto}
`;

export default coreFeature({
  id: 'rooms',
  order: 50,
  setup(ctx) {
    const st = document.createElement('style'); st.id = 'l3d-room3d-css'; st.textContent = ROOM3D_CSS;
    document.head.appendChild(st);
    const offs = [ctx.registries.rooms.register('debug', debugRoom)];
    // dev: ?room=forge:debug,hall:debug → those buildings open the given room kind
    try {
      const q = new URLSearchParams(location.search).get('room');
      if (q) for (const pair of q.split(',')) {
        const [id, kind] = pair.split(':');
        if (id && kind) offs.push(ctx.registries.buildings.register(id, { ...(ctx.registries.buildings.get(id) ?? { room: 'site' }), room: kind as 'site' }));
      }
    } catch { /* no location */ }
    // the camera framing of the own avatar inside small rooms: TP arm is limited by room colliders (rig)
    return () => { for (const u of offs) u(); st.remove(); document.documentElement.classList.remove('l3d-room3d'); };
  },
});
