/**
 * Game sound (src/features/sound.ts wires it to the game). Soft, quiet by default: a night-fair bed (crickets, wind,
 * a far murmur), footsteps by surface synced to the walk cycle, doors, coins, the pickaxe, paper/cloth menus and tiny
 * chat-bubble pops. All recordings are CC0 (docs/ASSETS.md) and ship inside the bundle — nothing is downloaded.
 *
 * Other modules trigger a sound without importing anything — one window event:
 *
 *   window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'shop.buy' } }));
 *   window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'mine.hit', x, y, z } }));   // world metres
 *
 * ids: src/audio/defs.ts (SFX). Or import { sfx } from '../audio' (same event).
 */
export { SoundEngine, type PlayOpts, type Volumes } from './engine';
export { loadBank, BANK_KEYS, type Bank } from './bank';
export { SFX, BED, type SfxId } from './defs';
export * from './mix';
export { loudness } from './dsp';

export interface SfxEventDetail { id: string; x?: number; y?: number; z?: number; gain?: number; rate?: number; follow?: () => [number, number, number] | null }

/** Fire-and-forget: ask the sound feature to play `id` (optionally at a world position, metres). */
export function sfx(id: string, pos?: { x: number; y: number; z: number }, gain?: number): void {
  try { window.dispatchEvent(new CustomEvent<SfxEventDetail>('l3d:sfx', { detail: { id, ...(pos ? { x: pos.x, y: pos.y, z: pos.z } : {}), ...(gain != null ? { gain } : {}) } })); } catch { /* no DOM */ }
}
