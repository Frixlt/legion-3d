// Store screenshots from the offline demo only. No live-site account or real player data.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto('file://' + resolve('dist-dev/game.html') + '?bots=14');
await page.waitForFunction(() => !!window.__l3dGame, { timeout: 60000 });
await page.waitForTimeout(5000);
await page.evaluate(() => document.querySelectorAll('aside[aria-label^="Что нового"]').forEach(e => e.remove()));
async function shot(name) {
  await page.evaluate(() => window.__l3dGame.engine.pause(true));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `store/screenshots/${name}.png`, timeout: 120000 });
  await page.evaluate(() => window.__l3dGame.engine.pause(false));
  console.log(name);
}
await shot('01-fp-night-fair');
await page.evaluate(() => { const g = window.__l3dGame; g.ctx.state.mode = 'tp'; g.ctx.applyCamera(true); for (let i = 0; i < 4; i++) { const b = window.__demo.bots[i]; b.x = window.__demo.store.me.x + (i - 1) * 70; b.y = window.__demo.store.me.y - 150; b.bubble = { text: ['Мяу!','Го в шахту?','Привет, Котик!','Красивый город'][i], until: Date.now() + 100000, id: 'store' + i }; } });
await page.waitForTimeout(1500); await shot('02-tp-chat');
await page.evaluate(() => window.__l3dGame.ui.open('gear'));
await page.waitForTimeout(1300); await shot('03-gear-orbit');
await page.evaluate(() => window.__l3dGame.ui.open(null));
await page.evaluate(() => window.__l3dGame.rooms.enter('shop'));
await page.waitForTimeout(2500);
await page.evaluate(() => { const g = window.__l3dGame; const room = g.rooms.scene.root.userData.l3dRoom; if (!room?.goods?.length) throw new Error('Shop has no rendered goods'); room.openGood(room.goods[0], false); });
await page.waitForTimeout(500); await shot('04-shop');
await page.evaluate(() => window.__l3dGame.rooms.exit());
await page.evaluate(() => window.__l3dGame.rooms.enter('mine'));
await page.waitForTimeout(3000); await shot('05-mine');
await browser.close();
