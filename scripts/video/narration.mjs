// Optional narrator over the gameplay video's game sound (the game mix stays a separate file; this makes a new one).
//
//   node scripts/video/narration.mjs --voice=<dir with slot-1.wav … slot-N.wav> [--name=legion-3d-gameplay] [--duck=5]
//
// Slots come from video/<name>.markers.json (narration.slots, in order: slot-1 = the first). Each clip starts at its
// slot time (move it with --shift-<k>=±s); it is never stretched. The game mix (video/<name>.raw.wav, the joined
// game sound before mastering) is ducked by --duck dB (default 5, owner: 4–6) under every clip with 0.3 s ramps that
// start 0.35 s before the voice; then the sum gets one static gain to −16 LUFS + limiter, true peak ≤ −1 dBTP measured
// on the encoded file, and is muxed with the picture by copying the video stream → video/<name>.voice.mp4.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { measure } from './audio.mjs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const OUT = opt.out || 'video', NAME = opt.name || 'legion-3d-gameplay', DUCK = +(opt.duck || 5);
const meta = JSON.parse(readFileSync(join(OUT, NAME + '.markers.json'), 'utf8'));
const raw = join(OUT, NAME + '.raw.wav'), video = join(OUT, NAME + '.video.mp4');
if (!existsSync(raw) || !existsSync(video)) throw new Error('render the gameplay cut first (needs ' + raw + ' and ' + video + ')');
const dur = (f) => +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim();
const ff = (args) => { const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed'); };

const clips = meta.narration.slots.map((s, i) => {
  const f = join(opt.voice, `slot-${i + 1}.wav`);
  if (!existsSync(f)) return null;
  const start = s.start + +(opt[`shift-${i + 1}`] || 0), d = dur(f);
  if (d > s.dur + 0.5) console.warn(`slot ${i + 1}: clip ${d.toFixed(2)} s is longer than the slot (${s.dur} s) — move the picture or shorten the line, never stretch`);
  return { f, start, d, text: s.text };
}).filter(Boolean);
if (!clips.length) throw new Error('no slot-N.wav in ' + opt.voice);

// duck envelope: 1 → g over 0.3 s starting 0.35 s before each clip, back over 0.45 s after it
const g = Math.pow(10, -DUCK / 20);
const env = clips.map((c) => { const a = c.start - 0.35, b = c.start + c.d + 0.1; return `clip((t-${a.toFixed(3)})/0.3,0,1)*clip((${(b + 0.45).toFixed(3)}-t)/0.45,0,1)`; });
const duck = `1-${(1 - g).toFixed(4)}*max(${env.reduce((p, q) => `max(${p},${q})`)},0)`;
// voice level: each clip at (game mix loudness + VOICE_ABOVE) LU so speech sits clearly over the game sound
const VOICE_ABOVE = +(opt['voice-above'] ?? 9);
const gameI = measure(raw).I;
for (const c of clips) { c.gain = gameI + VOICE_ABOVE - measure(c.f).I; }
console.log(`game mix ${gameI.toFixed(1)} LUFS → voice target ${(gameI + VOICE_ABOVE).toFixed(1)} LUFS (gains ${clips.map((c) => c.gain.toFixed(1)).join(', ')} dB)`);
const args = ['-i', raw];
for (const c of clips) args.push('-i', c.f);
let fc = `[0:a]volume='${duck}':eval=frame[g];`;
clips.forEach((c, i) => { const ms = Math.round(c.start * 1000); fc += `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${c.gain.toFixed(2)}dB,adelay=${ms}|${ms}[v${i}];`; });
fc += `[g]${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:duration=first[m]`;
const mixed = join(OUT, NAME + '.voice.raw.wav'), mastered = join(OUT, NAME + '.voice.wav'), out = join(OUT, NAME + '.voice.mp4');
ff([...args, '-filter_complex', fc, '-map', '[m]', '-c:a', 'pcm_f32le', mixed]);
const m0 = measure(mixed);
let gain = -16 - m0.I, lim = -1.6, res = null;
for (let it = 0; it < 6; it++) {
  ff(['-i', mixed, '-af', `volume=${gain.toFixed(3)}dB,alimiter=limit=${Math.pow(10, lim / 20).toFixed(5)}:attack=4:release=60:level=disabled:asc=1`, '-c:a', 'pcm_f32le', mastered]);
  ff(['-i', video, '-i', mastered, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
  res = measure(out);
  console.log(`try ${it + 1}: gain ${gain.toFixed(2)} dB, limiter ${lim.toFixed(2)} → I ${res.I} LUFS, TP ${res.TP} dBTP`);
  if (res.TP <= -1 && Math.abs(res.I + 16) <= 0.5) break;
  if (res.TP > -1) lim -= res.TP + 1 + 0.15;
  if (Math.abs(res.I + 16) > 0.5) gain += -16 - res.I;
}
writeFileSync(join(OUT, NAME + '.voice.json'), JSON.stringify({ duckDb: DUCK, clips, result: res }, null, 1));
console.log('→', out);
