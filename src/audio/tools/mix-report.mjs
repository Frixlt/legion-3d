// Offline mix report: opens dist-dev/sound.html in Chrome, renders the scenarios with OfflineAudioContext, prints the
// loudness numbers (BS.1770 meter in src/audio/dsp.ts) and saves the default-volume mixes as WAV for a cross-check
// (e.g. ffmpeg -i walk.wav -af ebur128=peak=true -f null -).
//
//   npm run build && CHROMIUM=/usr/bin/google-chrome node src/audio/tools/mix-report.mjs [outDir]
import { chromium } from 'playwright';
import { resolve, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = resolve(process.argv[2] || '.local/sound/out');
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
const logs = []; p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`)); p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await p.goto('file://' + resolve('dist-dev/sound.html'));
await p.waitForFunction(() => !!window.__sound, null, { timeout: 30000 });
const t0 = Date.now();
const r = await p.evaluate(() => window.__sound.report());
console.log(JSON.stringify(r, null, 2));
console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const n of ['walk', 'mine']) {
  const s = await p.evaluate((k) => window['__wav_' + k], n);
  writeFileSync(join(out, n + '.wav'), Buffer.from(s, 'base64'));
  console.log('wrote', join(out, n + '.wav'));
}
const bad = logs.filter((l) => /error|warn/i.test(l));
if (bad.length) console.log(bad.join('\n'));
await b.close();
