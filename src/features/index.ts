/**
 * The feature list. A feature is one file exporting a Feature ({ id, order, setup(ctx) }); add a mechanic by adding
 * a file and ONE line here. Lower `order` runs first, and per-frame hooks (ctx.onFrame) run in the same order.
 * Content modules (rooms, item models, menus…) register their registry entries from a feature too.
 */
import type { Feature } from '../contracts/ext';
import type { Unsub } from '../contracts';
import type { CoreContext } from '../core/context';
import type { CoreFeature } from './types';
import settings from './settings';
import menus from './menus';
import camera from './camera';
import crowd from './crowd';
import labels from './labels';
import doors from './doors';
import controls from './controls';
import rooms from './rooms';
import contentRooms from './content-rooms';
import overlay from './overlay';
import classic from './classic';
import quest from './quest';
import debug from './debug';
import itemModels from './item-models';

export const FEATURES: (Feature | CoreFeature)[] = [
  settings, itemModels, menus, camera, crowd, labels, doors, controls, rooms, contentRooms, overlay, classic, quest, debug,
];

/** Run every feature's setup in order. A failing feature is logged and skipped (the game still starts). */
export async function runFeatures(ctx: CoreContext, list: (Feature | CoreFeature)[] = FEATURES): Promise<Unsub> {
  const offs: Unsub[] = [];
  const sorted = list.map((f, i) => ({ f, i })).sort((a, b) => (a.f.order ?? 100) - (b.f.order ?? 100) || a.i - b.i);
  for (const { f } of sorted) {
    try {
      const r = await (f as CoreFeature).setup(ctx);
      if (typeof r === 'function') offs.push(r);
    } catch (e) {
      console.error(`[l3d] feature "${f.id}" failed`, e);
    }
  }
  return () => { for (const u of offs.reverse()) { try { u(); } catch { /* */ } } };
}
