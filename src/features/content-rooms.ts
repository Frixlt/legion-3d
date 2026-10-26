/**
 * Room modules: one line per module. Each registers its room kind(s) in ctx.registries.rooms; buildings map to kinds
 * in src/core/registries.ts (DEFAULT_BUILDINGS). A kind that is not registered opens the site's own screen.
 */
import { registerShopRooms } from '../rooms/shop';
import { registerHybridRooms } from '../rooms/hybrid';
import { registerMine } from '../rooms/mine';
import { coreFeature } from './types';

export default coreFeature({
  id: 'content-rooms',
  order: 51,
  setup(ctx) {
    const offs = [
      registerShopRooms(ctx.registries.rooms),     // 'shop3d': forge, magic, shop, tent
      registerHybridRooms(ctx.registries.rooms),   // 'hybrid': trainer, board, hall, auction, storage, gate, anvil
      registerMine(ctx.registries.rooms),          // 'mine3d': the mine
    ];
    return () => { for (const u of offs) u(); };
  },
});
