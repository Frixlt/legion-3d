/**
 * Audio renderer page bundle (video/bundle/audio.js, used by scripts/video/audio.mjs in headless Chrome):
 * rebuilds a captured game-sound log (src/audio/capture.ts) with the game's own SoundEngine on an
 * OfflineAudioContext at 48 kHz stereo — the same samples, node chain, panners, reverb and limiter as in play.
 */
import { SoundEngine, loadBank } from '../../../src/audio';
import type { AudioLogEvent } from '../../../src/audio/capture';

declare global { interface Window { __audio: { render(log: AudioLogEvent[], from: number, dur: number): Promise<{ frames: number; voices: number; peak: number }>; chunk(ch: number, i: number, n: number): string } } }

let out: AudioBuffer | null = null;
window.__audio = {
  /** Render log time [from, from + dur) (seconds on the capture clock). */
  async render(log, from, dur) {
    const SR = 48000;
    const ac = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
    const bank = await loadBank(ac);
    const init = log.find((e) => e.k === 'init') as { hrtf?: boolean } | undefined;
    const eng = new SoundEngine(ac, bank, { hrtf: () => !!init?.hrtf });
    const voices = eng.replay(log, -from);
    out = await ac.startRendering();
    let peak = 0;
    for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
    return { frames: out.length, voices, peak };
  },
  /** Samples [i, i + n) of channel ch as base64 little-endian float32. */
  chunk(ch, i, n) {
    if (!out) return '';
    const d = out.getChannelData(ch).subarray(i, i + n);
    const u = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    let s = '';
    for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000) as unknown as number[]);
    return btoa(s);
  },
};
