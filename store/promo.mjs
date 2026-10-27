// Two original layouts using the offline game's own screenshot and the source mark.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const art = readFileSync('store/screenshots/02-halloween-street.png').toString('base64');
const mark = readFileSync('store/icons/legion-mark.svg', 'utf8');
for (const [w,h,file] of [[440,280,'store/promo-440x280.png'],[1400,560,'store/marquee-1400x560.png']]) {
 const p = await chrome.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
 await p.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#111727;font-family:Georgia,serif;color:#fff0d2} .art{position:absolute;inset:0;background:url(data:image/png;base64,${art}) center / cover;filter:saturate(1.1)}.shade{position:absolute;inset:0;background:linear-gradient(90deg,#101526 0%,#101526e9 31%,#10152691 60%,#1015262b 100%),linear-gradient(0deg,#0e1424c7,transparent 42%)}.edge{position:absolute;inset:${w<500?12:23}px;border:1px solid #dbaf7569;border-radius:12px}.content{position:absolute;top:50%;left:${w<500?30:80}px;transform:translateY(-50%)}svg{width:${w<500?52:104}px;height:${w<500?52:104}px;display:block;margin-bottom:${w<500?10:24}px}.title{font-size:${w<500?51:117}px;font-weight:800;letter-spacing:-.055em;line-height:1;text-shadow:0 4px 20px #050912}.sub{color:#f0ca93;font:700 ${w<500?14:27}px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;margin-top:${w<500?10:18}px}.line{width:${w<500?92:166}px;height:3px;background:#e3a95b;margin-top:${w<500?13:26}px}</style><div class="art"></div><div class="shade"></div><div class="edge"></div><div class="content">${mark}<div class="title">Legion 3D</div><div class="sub">Ночной город оживает</div><div class="line"></div></div>`);
 await p.screenshot({path:file}); await p.close(); console.log(file);
}
await chrome.close();
