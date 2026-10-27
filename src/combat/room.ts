/**
 * Combat inside rooms (3D shops, the mine): what a room scene exposes to src/combat and the room's walkable space as
 * a RagdollEnv. No three.js scene work here; pure enough to unit-test with a fake scene.
 *
 * A room scene that supports fights carries a duck-typed `combat: RoomCombat` field (like `stage`):
 *   - fighters(fn)     the figures that can be knocked over: room NPCs (shopkeeper, smith…), tent mannequins, mine
 *                      miners and the mine's NPCs. `home` = where a figure stands at rest (the room itself does not
 *                      re-place it every frame, so combat puts it back there before the ragdoll reads it); null =
 *                      somebody already places it every frame (mine miners, like the street crowd).
 *   - afterUpdate(fn)  run fn at the END of the room's own update. Rooms animate their figures in rooms.update, which
 *                      runs AFTER the features (game.ts frame step 7), so combat must pose its ragdolls after that.
 *   - ceiling          room height (m): arrows / orbs stick in the ceiling instead of flying out of the room.
 *   - space            the room's floor and solids as fights see them (default: the scene's own free / groundAt /
 *                      solidTop). Rooms leave out the solids the fighters themselves stand in (an NPC's own block, a
 *                      mannequin's booth): a body that starts inside a solid would otherwise slide through it — and
 *                      through the wall behind it — unhindered.
 */
import type { RagdollEnv } from './physics';
import type { CombatAvatar } from './ragdoll';

export type FighterKind = 'npc' | 'mannequin' | 'miner';

export interface RoomFighter {
  id: string;
  av: CombatAvatar;
  kind: FighterKind;
  /** Rest spot (room metres, feet) — null when the room places the figure every frame itself. */
  home: { x: number; y: number; z: number } | null;
  /** Say a short line in the figure's own bubble (room NPCs only — never for real players). */
  say?(text: string, t: number): void;
  /** Move the figure's bubble with the body while it is down (head point, world metres). */
  follow?(x: number, y: number, z: number): void;
}

export interface RoomCombat {
  fighters(fn: (f: RoomFighter) => void): void;
  afterUpdate(fn: (dt: number, t: number) => void): () => void;
  ceiling?: number;
  space?: RoomSpace;
}

/** What combat needs from a RoomScene (a subset of contracts/ext RoomScene). */
export interface RoomSpace {
  free(x: number, z: number): boolean;
  groundAt(x: number, z: number): number;
  solidTop?(x: number, z: number): number;
}

/** The `combat` field of a room scene, or null (hybrid rooms, rooms without fights). */
export function roomCombatOf(sc: unknown): RoomCombat | null {
  const c = sc ? (sc as { combat?: RoomCombat }).combat : undefined;
  return c && typeof c.fighters === 'function' && typeof c.afterUpdate === 'function' ? c : null;
}

/** Indignant lines of a shopkeeper who was just knocked over (shown at most every NPC_LINE_GAP seconds). */
export const NPC_LINES = ['Эй! Тут магазин!', 'Ай! Я же продавец!', 'Ну и манеры, котик!', 'Сначала купи — потом дерись!', 'Мяу! Осторожно с товаром!', 'Охрана! А, у нас нет охраны…'];
export const NPC_LINE_GAP = 9;

/** Pad (m) around walls for bodies: a lying cat does not sink half into a wall. */
const PAD = 0.22;

/**
 * The room's space for bodies and minions (`body`) and for projectiles (`shots`), room metres.
 *   ground   the floor (raised floors / daises) or the top of a low solid (counter, crate, stool) under the point
 *   blocked  outside the room / a wall (solidTop = Infinity), or a solid whose top is above the point; bodies also
 *            keep PAD off walls; projectiles above `ceiling` are blocked (they stick in the ceiling)
 * Rooms without solidTop (the mine): blocked = not walkable.
 */
export function roomEnv(sc: RoomSpace, ceiling = Infinity): { body: RagdollEnv; shots: RagdollEnv } {
  const top = (x: number, z: number): number => (sc.solidTop ? sc.solidTop(x, z) : sc.free(x, z) ? -Infinity : Infinity);
  const groundAt = (x: number, z: number): number => {
    const g = sc.groundAt(x, z), t = top(x, z);
    return t > g && t !== Infinity ? t : g;
  };
  const wall = (x: number, z: number) => top(x, z) === Infinity;
  const body: RagdollEnv = {
    groundAt,
    blocked: (x, z, y) => {
      const t = top(x, z);
      if (t === Infinity || t > y) return true;
      if (!sc.solidTop) return false;
      return wall(x + PAD, z) || wall(x - PAD, z) || wall(x, z + PAD) || wall(x, z - PAD);
    },
  };
  const shots: RagdollEnv = {
    groundAt,
    blocked: (x, z, y) => y > ceiling || top(x, z) > y,
  };
  return { body, shots };
}
