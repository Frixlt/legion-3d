// Bundle the page-side director (virtual time + director + shots) into video/bundle/director.js and the audio
// renderer (the game's SoundEngine replaying a capture log) into video/bundle/audio.js.
// usage: node scripts/video/build.mjs   (render.mjs runs it automatically when esbuild is available)
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../video/bundle/director.js');
mkdirSync(dirname(out), { recursive: true });
const common = { bundle: true, format: 'iife', target: 'chrome111', logLevel: 'warning', legalComments: 'none' };
await esbuild.build({ ...common, entryPoints: [resolve(here, 'page/entry.ts')], outfile: out });
const audio = resolve(here, '../../video/bundle/audio.js');
await esbuild.build({ ...common, entryPoints: [resolve(here, 'page/audio-entry.ts')], outfile: audio });
console.log('director bundle →', out, '· audio bundle →', audio);
