// Game soundtrack for the frame-captured video (see README «Sound»).
//
//   1. capture (render.mjs, audio pass): each segment runs once more with rendering off; the game's SoundEngine logs
//      every voice / ramp / bed / listener pose on the virtual clock (src/audio/capture.ts) → frames-*/<id>/audio.json
//   2. renderSegment(): headless Chrome replays the log with the game's own SoundEngine on an OfflineAudioContext
//      (48 kHz stereo, video/bundle/audio.js) → frames-*/<id>/audio.wav, exactly the segment's length
//   3. joinAndMaster(): the segment WAVs are joined with the same crossfades as the picture, the whole mix gets ONE
//      static gain to −16 LUFS (integrated) and a limiter; the true peak is measured on the ENCODED file (AAC) and the
//      limiter ceiling lowered until it is ≤ −1 dBTP; the video stream is copied (never re-encoded) when muxing.
//
//   node scripts/video/audio.mjs --cut=gameplay [--name=…]      (re-master only: segment WAVs + video already there)
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export const SR = 48000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[audio]', ...a);

/** Write a stereo float32 WAV header + data (data streamed by the caller). */
function wavHeader(frames, ch = 2, sr = SR) {
  const bytes = frames * ch * 4, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * ch * 4, 28); h.writeUInt16LE(ch * 4, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(bytes, 40);
  return h;
}

/**
 * Render one segment's capture to a WAV of exactly `dur` seconds starting at the segment's first frame (cap.t0).
 * The render starts at the engine's creation so the beds, reverb tails and level ramps are already settled at t0.
 */
export async function renderSegment(browser, bundle, cap, outWav) {
  const init = cap.log.find((e) => e.k === 'init');
  if (!init) throw new Error('no sound engine in the capture (sound did not start)');
  const from = Math.min(init.t, cap.t0), lead = cap.t0 - from, total = lead + cap.dur;
  const page = await browser.newPage();
  try {
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: bundle });
    const r = await page.evaluate(([l, f, d]) => window.__audio.render(l, f, d), [cap.log, from, total]);
    const skip = Math.round(lead * SR), frames = Math.round(cap.dur * SR);
    const fd = openSync(outWav, 'w');
    writeSync(fd, wavHeader(frames));
    const N = 1 << 18;
    for (let i = 0; i < frames; i += N) {
      const n = Math.min(N, frames - i);
      const [a, b] = await page.evaluate(([i, n]) => [window.__audio.chunk(0, i, n), window.__audio.chunk(1, i, n)], [skip + i, n]);
      const L = new Float32Array(Buffer.from(a, 'base64').buffer.slice(0)), R = new Float32Array(Buffer.from(b, 'base64').buffer.slice(0));
      const inter = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { inter[2 * k] = L[k] || 0; inter[2 * k + 1] = R[k] || 0; }
      writeSync(fd, Buffer.from(inter.buffer));
    }
    closeSync(fd);
    return { voices: r.voices, peakDb: 20 * Math.log10(Math.max(1e-9, r.peak)), lead, frames };
  } finally { await page.close(); }
}

/** EBU R128 of a file (any stream ffmpeg can decode): integrated LUFS, true peak dBTP, LRA. */
export function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr || '';
  const tail = s.slice(s.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(tail); return m ? +m[1] : NaN; };
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), TP: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/) };
}

const ff = (args) => { const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' ')); };

/**
 * Join segment WAVs with crossfades (parts: [{wav, dur, xfade}] in order; the fade of a part is into the NEXT one,
 * computed exactly like the video's xfade chain), master to −16 LUFS / ≤ −1 dBTP, mux with the picture (copied).
 */
export function joinAndMaster({ parts, video, outMp4, rawWav, masterWav, target = -16, ceiling = -1, bitrate = '256k' }) {
  // 1. join
  const args = [];
  for (const p of parts) args.push('-i', p.wav);
  let f = '', last = '[0:a]';
  for (let i = 1; i < parts.length; i++) {
    const d = parts[i - 1].fade;
    f += `${last}[${i}:a]acrossfade=d=${d.toFixed(4)}:c1=tri:c2=tri[a${i}];`;
    last = `[a${i}]`;
  }
  f += `${last}anull[out]`;
  ff([...args, '-filter_complex', f, '-map', '[out]', '-c:a', 'pcm_f32le', rawWav]);
  const raw = measure(rawWav);
  log(`joined mix: I ${raw.I} LUFS, TP ${raw.TP} dBTP, LRA ${raw.LRA}`);
  // 2. one static gain + limiter; check the true peak of the ENCODED file, lower the ceiling if needed
  let gain = target - raw.I, lim = ceiling - 0.6, res = null;
  for (let it = 0; it < 6; it++) {
    const limLin = Math.min(1, Math.max(0.0626, Math.pow(10, lim / 20)));
    ff(['-i', rawWav, '-af', `volume=${gain.toFixed(3)}dB,alimiter=limit=${limLin.toFixed(5)}:attack=4:release=60:level=disabled:asc=1`, '-c:a', 'pcm_f32le', masterWav]);
    ff(['-i', video, '-i', masterWav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', bitrate, '-ar', String(SR), '-shortest', '-movflags', '+faststart', outMp4]);
    res = measure(outMp4);
    log(`master try ${it + 1}: gain ${gain.toFixed(2)} dB, limiter ${lim.toFixed(2)} dBFS → encoded I ${res.I} LUFS, TP ${res.TP} dBTP`);
    const okTP = res.TP <= ceiling, okI = Math.abs(res.I - target) <= 0.5;
    if (okTP && okI) break;
    if (!okTP) lim -= (res.TP - ceiling) + 0.15;
    if (!okI) gain += target - res.I;
  }
  return { raw, final: res, gain, limiter: lim };
}

/* ---- CLI: re-master from existing segment WAVs */
if (import.meta.url === `file://${process.argv[1]}`) {
  const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
  const OUT = opt.out || 'video', CUT = opt.cut || 'gameplay', NAME = opt.name || `legion-3d-${CUT}`;
  const meta = JSON.parse(readFileSync(join(OUT, NAME + '.markers.json'), 'utf8'));
  const parts = meta.scenes.map((s) => ({ wav: join(OUT, `frames-${CUT}`, s.id, 'audio.wav'), fade: s.fadeOut }));
  for (const p of parts) if (!existsSync(p.wav)) throw new Error('missing ' + p.wav);
  const r = joinAndMaster({ parts, video: join(OUT, NAME + '.video.mp4'), outMp4: join(OUT, NAME + '.mp4'), rawWav: join(OUT, NAME + '.raw.wav'), masterWav: join(OUT, NAME + '.wav') });
  writeFileSync(join(OUT, NAME + '.audio.json'), JSON.stringify(r, null, 1));
  void chromium;
}
