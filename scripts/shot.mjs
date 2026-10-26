// Screenshot a dev page in headless Chromium (software WebGL).
// usage: node scripts/shot.mjs dist-dev/world.html out.png [--wait=4000] [--w=1280] [--h=720] [--eval="js expr"] [--keys="KeyW:1500,KeyD:500"]
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const [, , page0, out = 'shot.png', ...rest] = process.argv;
const opt = Object.fromEntries(rest.map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const exe = process.env.CHROMIUM || undefined;
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +(opt.w || 1280), height: +(opt.h || 720) } });
const logs = [];
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
const url = /^https?:/.test(page0) ? page0 : 'file://' + resolve(page0) + (opt.query ? '?' + opt.query : '');
await p.goto(url);
await p.waitForTimeout(+(opt.wait || 4000));
if (opt.keys) for (const kv of opt.keys.split(',')) { const [k, ms] = kv.split(':'); await p.keyboard.down(k); await p.waitForTimeout(+ms || 300); await p.keyboard.up(k); }
if (opt.eval) { try { console.log('eval →', JSON.stringify(await p.evaluate(opt.eval)).slice(0, 2000)); } catch (e) { console.log('eval error', e.message); } await p.waitForTimeout(+(opt.after || 800)); }
await p.screenshot({ path: out });
console.log(logs.slice(-40).join('\n'));
console.log('saved', out);
await b.close();
