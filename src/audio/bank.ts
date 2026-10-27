/**
 * Sample bank: decodes the embedded Opus files (bank.gen.ts) into AudioBuffers, turns the bed_* recordings into
 * seamless loops and adds the procedural buffers ('@pop', '@roomtone'). Nothing is fetched: everything is in the bundle.
 */
import { BANK, LOOP_LEN } from './bank.gen';
import { brownNoise, crossfadeLoop, popSynth } from './dsp';

export type Bank = Map<string, AudioBuffer>;

function b64(s: string): ArrayBuffer {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function fromChannels(ac: BaseAudioContext, chans: Float32Array[]): AudioBuffer {
  const b = ac.createBuffer(chans.length, chans[0].length, ac.sampleRate);
  chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

/** Decode the bank. `only` limits it to some keys (the beds first, then the rest). Failures are logged and skipped. */
export async function loadBank(ac: BaseAudioContext, bank: Bank = new Map(), only?: (k: string) => boolean): Promise<Bank> {
  if (!bank.has('@pop')) {
    bank.set('@pop', fromChannels(ac, [popSynth(ac.sampleRate)]));
    bank.set('@roomtone', fromChannels(ac, [brownNoise(ac.sampleRate * 6, ac.sampleRate, 7), brownNoise(ac.sampleRate * 6, ac.sampleRate, 8)]));
  }
  for (const [k, data] of Object.entries(BANK)) {
    if (bank.has(k) || (only && !only(k))) continue;
    try {
      let buf = await ac.decodeAudioData(b64(data));
      const loop = LOOP_LEN[k];
      if (loop) {
        const len = Math.min(buf.length, Math.round(loop * buf.sampleRate));
        const ch: Float32Array[] = [];
        for (let c = 0; c < buf.numberOfChannels; c++) ch.push(crossfadeLoop(buf.getChannelData(c), len));
        buf = fromChannels(ac, ch);
      }
      bank.set(k, buf);
    } catch (e) {
      console.warn('[l3d] sound decode failed', k, e);
    }
  }
  return bank;
}
export const BANK_KEYS = Object.keys(BANK);
