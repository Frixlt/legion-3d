/**
 * Chat mood (IDEAS #1): a short public chat line → a mood for the speaker's face and bubble for ~2 s.
 * Pure and conservative: only clear markers (emoji, «ура», «хаха», «?!», «!!!»…) count; anything else is neutral
 * (null) — irony and plain text are never guessed at. Private lines are filtered by the caller (moodFor).
 */
import type { ChatMsg } from '../contracts';
import type { Mood } from '../avatar/face';

export type { Mood };

/** Lines longer than this are «real talk»: no mood (the face would not match a paragraph). */
export const MOOD_MAX_LEN = 60;
/** How long a mood lasts (s). */
export const MOOD_SEC = 2.2;

// \b is ASCII-only even with /u, so whole words are delimited by «not a letter» around them
const w = (alts: string) => `(?<!\\p{L})(?:${alts})(?!\\p{L})`;
const rx = (...parts: string[]) => new RegExp(parts.join('|'), 'iu');
// order matters: the first rule that matches wins
const RULES: [Mood, RegExp][] = [
  ['love', rx('❤|♥|💕|💖|💗|😍|🥰|😻|😘|<3', w('люблю|обожаю|мимими+'), 'милот')],
  ['laugh', rx('😂|🤣|😹|😆|😅', w('(?:а?ха){2,}х*|хах[аx]*|хе-?хе|хи-?хи|лол|lol|xd|ору|ахах\\p{L}*|ржу|ржака'))],
  ['sad', rx('😢|😭|😿|😞|😔|☹|🥺|:\\(|\\(\\(', w('увы|эх+|грустно|грусть|печаль\\p{L}*'))],
  ['angry', rx('😠|😡|😾|💢|🤬', w('гр{2,}|р{3,}|бесит|злюсь'))],
  ['surprised', rx('😮|😲|🙀|😱|😯|🤯|\\?!|!\\?|!{3,}', w('ого+|вау|wow|о_о|o_o|ничего себе'))],
  ['happy', rx('😊|😄|😃|😁|😀|🙂|😸|😺|🎉|🥳|✨|:\\)|:D|\\){2,}', w('ура+|урра+|yay|класс|классно|супер|круто|победа|спасибо'))],
  ['puzzled', rx('🤔', '\\?\\s*$')],
];

/** Mood of a chat line, or null (neutral). */
export function classifyMood(text: string): Mood | null {
  const t = String(text || '').trim();
  if (!t || t.length > MOOD_MAX_LEN) return null;
  for (const [m, re] of RULES) if (re.test(t)) return m;
  return null;
}

/** Mood for a chat message, or null for private / system / event lines (never analysed). */
export function moodFor(m: Pick<ChatMsg, 'kind' | 'text' | 'to' | 'login'>): Mood | null {
  if (!m.login || m.to || (m.kind && m.kind !== 'g' && m.kind !== 'tr')) return null;
  return classifyMood(m.text);
}

/**
 * Rate limit: at most one mood per speaker every `perKey` s and at most `burst` moods in any `window` s overall.
 * Times in seconds (any monotonic clock). No allocations after the keys are known.
 */
export class RateGate {
  private last = new Map<string, number>();
  private ring: number[];
  private i = 0;
  constructor(private perKey = 4, burst = 6, private window = 10) { this.ring = new Array(burst).fill(-Infinity); }
  /** True (and recorded) when `key` may fire at time `now`. */
  take(key: string, now: number): boolean {
    const l = this.last.get(key);
    if (l !== undefined && now - l < this.perKey) return false;
    if (now - this.ring[this.i] < this.window) return false;   // the oldest of the last `burst` is still in the window
    this.ring[this.i] = now; this.i = (this.i + 1) % this.ring.length;
    this.last.set(key, now);
    if (this.last.size > 256) for (const [k, v] of this.last) if (now - v > this.perKey) this.last.delete(k);
    return true;
  }
}

/** A set of recently seen ids (dedupe), bounded: the oldest are forgotten first. */
export class SeenIds {
  private set = new Set<string>();
  constructor(private max = 500) {}
  /** True the first time an id is seen. */
  add(id: string): boolean {
    if (this.set.has(id)) return false;
    this.set.add(id);
    if (this.set.size > this.max) { const first = this.set.values().next().value; if (first !== undefined) this.set.delete(first); }
    return true;
  }
  has(id: string): boolean { return this.set.has(id); }
}
