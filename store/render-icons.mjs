import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const source = readFileSync('store/icons/legion-mark.svg', 'utf8');
for (const size of [300, 128, 48, 16]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>*{margin:0}svg{width:${size}px;height:${size}px}</style>${source}`);
  const path = size === 300 ? 'store/icons/300.png' : `public/icons/${size}.png`;
  await page.screenshot({ path, omitBackground: true });
  console.log(path);
  await page.close();
}
await browser.close();
