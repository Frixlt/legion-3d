// Live probe for the site adapter: injected into the real page by e2e/live-probe.mjs. Prints store summaries.
import { connectSite } from '../src/net/site';
(async () => {
  const s = await connectSite({ onStatus: (t) => console.log('[probe] status', t) });
  if ('error' in s) { console.log('[probe] error', s.error); return; }
  (window as any).__l3d = s;
  let last = performance.now();
  const loop = () => { const t = performance.now(); s.tick((t - last) / 1000); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  setInterval(() => {
    const st = s.store, ws = [...st.walkers.values()];
    console.log('[probe] ' + JSON.stringify({
      layout: st.layout && { id: st.layout.id, W: st.layout.W, b: st.layout.buildings.length, art: !!st.layout.art?.fairSvg, sky: st.layout.sky?.slice(0, 30) },
      hero: st.hero && { lv: st.hero.level, items: st.hero.items.length }, me: st.me && [Math.round(st.me.x), Math.round(st.me.y)],
      online: st.online, walkers: ws.length, moving: ws.filter((w) => w.speed > 0).length,
      sample: ws.slice(0, 2).map((w) => [Math.round(w.x), Math.round(w.y), +w.face.toFixed(2), Math.round(w.speed), w.app.look.shape, w.app.gear.w]),
      chat: st.chat.length, bubbles: ws.filter((w) => w.bubble).length, quest: st.quest && st.quest.on, overlay: s.overlay(),
      cls: document.documentElement.className,
    }));
  }, 2000);
})();
