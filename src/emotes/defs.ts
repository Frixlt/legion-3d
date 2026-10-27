/**
 * The emote wheel's emotes and its selection math (pure, unit-tested). Order = clockwise from the top of the wheel.
 * `anim` is a built-in avatar emote (Avatar.play) or one of ours (src/emotes/anims.ts); `mood` is a face of
 * src/avatar/face.ts (MOOD_FACE); `sfx` an id of src/audio/defs.ts.
 */
import type { Mood } from '../avatar/face';

export type EmoteId = 'wave' | 'dance' | 'laugh' | 'purr' | 'sit' | 'cry' | 'huff' | 'bow';

export interface EmoteDef {
  id: EmoteId;
  label: string;
  emoji: string;
  /** Seconds the emote lasts (sit: until the hero moves, at most this long). */
  len: number;
  mood: Mood;
  /** Built-in avatar animation to start with it (Avatar.play), if any. */
  play?: string;
  sfx?: string;
  /** Ends when the hero walks off (sit, bow…); others keep playing while walking. */
  still?: boolean;
}

export const EMOTES: readonly EmoteDef[] = [
  { id: 'wave', label: 'Помахать', emoji: '👋', len: 1.6, mood: 'happy', play: 'wave', sfx: 'emote.pop' },
  { id: 'dance', label: 'Танец', emoji: '💃', len: 3.4, mood: 'happy', sfx: 'emote.dance' },
  { id: 'laugh', label: 'Смех', emoji: '😹', len: 1.5, mood: 'laugh', play: 'laugh', sfx: 'emote.laugh' },
  { id: 'purr', label: 'Мур', emoji: '💕', len: 2.6, mood: 'love', sfx: 'emote.purr' },
  { id: 'sit', label: 'Сесть', emoji: '🧘', len: 8, mood: 'happy', sfx: 'social.sit', still: true },
  { id: 'cry', label: 'Плакать', emoji: '😿', len: 2.6, mood: 'sad', sfx: 'emote.sad', still: true },
  { id: 'huff', label: 'Фыр!', emoji: '😾', len: 2.0, mood: 'angry', sfx: 'emote.huff' },
  { id: 'bow', label: 'Поклон', emoji: '🙇', len: 1.9, mood: 'happy', sfx: 'emote.pop', still: true },
];

/** Wheel geometry (CSS px): the pointer must leave the dead zone to pick; it is clamped to the rim. */
export const WHEEL = { dead: 26, rim: 120 };

/**
 * Sector under a pointer offset from the wheel centre (screen px, +x right, +y DOWN), or -1 inside the dead zone.
 * Sector 0 is centred on the top, the rest follow clockwise, each 360°/n wide.
 */
export function wheelIndex(dx: number, dy: number, n = EMOTES.length, dead = WHEEL.dead): number {
  if (!(dx * dx + dy * dy > dead * dead)) return -1;
  // angle clockwise from the top, 0..2π
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += Math.PI * 2;
  const w = (Math.PI * 2) / n;
  return Math.floor((a + w / 2) / w) % n;
}

/** Keep a virtual pointer (pointer-lock deltas) inside the rim. Mutates and returns p. */
export function clampToRim(p: { x: number; y: number }, rim = WHEEL.rim): { x: number; y: number } {
  const d = Math.hypot(p.x, p.y);
  if (d > rim) { p.x *= rim / d; p.y *= rim / d; }
  return p;
}
