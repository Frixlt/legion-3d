/** Classic toggle: back to the original site (F8 / menu) and resume the 3D game from where the 2D hero walked. */
import { coreFeature } from './types';

export default coreFeature({
  id: 'classic',
  order: 70,
  setup(ctx) {
    const { engine, input, site, hostEl, uiRoot, state } = ctx;
    const G = ctx.game;
    G.toClassic = () => {
      if (G.classic) return;
      if (ctx.rooms.current) ctx.rooms.exit();
      G.classic = true; state.classic = true;
      engine.pause(true); input.unlock(); input.setGameplay(false);
      hostEl.style.display = 'none'; uiRoot.style.display = 'none';
      site.setClassic(true);
      document.getElementById('l3d-launch')?.classList.remove('hide');
    };
    G.resume = () => {
      if (!G.classic) return;
      G.classic = false; state.classic = false;
      site.setClassic(false);
      // the hero may have walked in the 2D city: continue from the site's position (site.setClassic synced store.me)
      const sp = site.selfPos();
      const ctl = ctx.controller();
      if (sp && Math.hypot(sp[0] - ctl.x, sp[1] - ctl.y) > 40) { ctl.teleport(sp[0], sp[1]); ctx.me.x = sp[0]; ctx.me.y = sp[1]; }
      hostEl.style.display = ''; uiRoot.style.display = '';
      const blocking = !!state.overlay && !state.overlayOver3d;
      engine.pause(blocking); input.setGameplay(!state.menu && !blocking);
      document.getElementById('l3d-launch')?.classList.add('hide');
    };
    G.classicPanel = () => G.toClassic();
  },
});
