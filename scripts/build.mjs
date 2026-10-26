// Build: content scripts → dist/ (unpacked extension); every dev/*.ts → dist-dev/ (standalone demo pages).
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);   // e.g. --only=dev
const common = {
  bundle: true, format: 'iife', target: 'chrome111', sourcemap: prod ? false : 'linked',
  minify: prod, legalComments: 'none', logLevel: 'warning',
  define: { __DEV__: String(!prod) },
  loader: { '.css': 'text', '.svg': 'text' },
};
const ctxs = [];
if (only !== 'dev') {
  rmSync('dist', { recursive: true, force: true });
  mkdirSync('dist', { recursive: true });
  cpSync('public', 'dist', { recursive: true });
  ctxs.push(await esbuild.context({ ...common, entryPoints: { bridge: 'src/bridge/bridge.ts', game: 'src/content/main.ts' }, outdir: 'dist' }));
}
if (only !== 'ext' && existsSync('dev')) {
  mkdirSync('dist-dev', { recursive: true });
  const entries = {};
  for (const f of readdirSync('dev')) {
    if (f.endsWith('.ts')) entries[f.slice(0, -3)] = 'dev/' + f;
    else if (f.endsWith('.html')) cpSync('dev/' + f, 'dist-dev/' + f);
  }
  if (Object.keys(entries).length) ctxs.push(await esbuild.context({ ...common, entryPoints: entries, outdir: 'dist-dev' }));
}
if (watch) { for (const c of ctxs) await c.watch(); console.log('watching…'); }
else { for (const c of ctxs) { await c.rebuild(); await c.dispose(); } console.log('built'); }
