/**
 * Deterministic audio capture for the video renderer (scripts/video, see its README «Sound»).
 *
 * The video is captured frame by frame in virtual time, so nothing can be recorded from the speakers. Instead, when
 * the page defines `window.__VT_AUDIO_LOG = []` before the game starts, every SoundEngine appends what it does to
 * that array, on its own clock (the context's currentTime — virtual seconds under the video's clock patch):
 *
 *   init   the engine was created (sample rate, HRTF on/off for the fire panner)
 *   bed    a looping bed started at a buffer offset (the offsets come from the engine's RNG)
 *   ramp   a level / filter change of a named node (master, buses, ambience duck, beds, space mix…)
 *   voice  a one-shot that really started (after cooldowns, culling, the voice limit, the variant pick and jitter):
 *          bank key, playback rate, gain, low-pass, bus, world position, panner falloff, HRTF
 *   lis    the listener pose (camera position + forward), once per frame
 *   fire   the forge hearth position (positional fire bed) changed
 *   space  the acoustic space changed (street / shop / forge / tent / mine)
 *
 * SoundEngine.replay(log) rebuilds exactly that graph on an OfflineAudioContext — same node chain, same DSP,
 * same limiter — without making a single decision of its own, so the rendered soundtrack is what the game would have
 * played at those moments. Nothing here runs in the shipped game unless the page sets the global.
 */
import type { Bus } from './defs';
import type { Space } from './mix';

export interface VoiceRec {
  /** sfx id (for reports) */
  id: string;
  /** bank key actually played (variant) */
  file: string;
  /** final playback rate and gain (definition × caller × jitter) */
  rate: number; gain: number;
  /** low-pass cutoff (Hz), 0 = none */
  lp: number;
  bus: Bus;
  /** world position (metres) of a positional sound, absent = centred */
  pos?: [number, number, number];
  /** panner falloff: ref distance, max distance; panning model */
  ref: number; max: number; hrtf: boolean;
}

export type AudioLogEvent =
  | { k: 'init'; t: number; sr: number; hrtf: boolean }
  | { k: 'bed'; t: number; key: string; off: number }
  | { k: 'ramp'; t: number; p: string; v: number; tc: number }
  | ({ k: 'voice'; t: number } & VoiceRec)
  | { k: 'lis'; t: number; p: [number, number, number, number, number, number] }
  | { k: 'fire'; t: number; p: [number, number, number] | null }
  | { k: 'space'; t: number; space: Space }
  /** a named moment written by the capturing page itself (scene starts, «door opened»…) — ignored by replay */
  | { k: 'mark'; t: number; name: string };

/** The capture sink of this page (window.__VT_AUDIO_LOG), or null in normal play. */
export function captureSink(): AudioLogEvent[] | null {
  const g = globalThis as { __VT_AUDIO_LOG?: unknown };
  return Array.isArray(g.__VT_AUDIO_LOG) ? (g.__VT_AUDIO_LOG as AudioLogEvent[]) : null;
}

/** Round for the log (keeps it small; 0.1 ms / 1e-4 precision is far below anything audible). */
export const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
