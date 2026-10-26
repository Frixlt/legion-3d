// Bundle the page-side director (virtual time + director + shots) into video/bundle/director.js.
// usage: node scripts/video/build.mjs   (render.mjs runs it automatically when esbuild is available)
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../video/bundle/director.js');
mkdirSync(dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: [resolve(here, 'page/entry.ts')], bundle: true, format: 'iife', target: 'chrome111',
  outfile: out, logLevel: 'warning', legalComments: 'none',
});
console.log('director bundle →', out);
