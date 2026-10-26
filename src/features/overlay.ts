/**
 * Site overlay watcher. The site's own full-screen screens (building interiors .cy-room, the mine .mn, trade,
 * dialogs) sit above or below our canvas. While one is open the game hides and pauses itself and comes back after —
 * EXCEPT the building panel of a hybrid room, which is shown over our live 3D room (state.overlayOver3d): then the
 * canvas stays, and when that panel goes away (the site's «Выйти») the room is left too.
 * Esc closes the site's building interior (the site has no Esc handler there).
 */
import { coreFeature } from './types';

export default coreFeature({
  id: 'overlay',
  order: 60,
  setup(ctx) {
    const { site, input, state, hostEl, uiRoot, engine, rooms } = ctx;
    let shownOver = false;   // the hybrid panel was seen open (it takes a moment to appear)
    let blocking = false;
    const tick = () => {
      if (state.classic) return;
      const ov = site.overlay();
      if (rooms.panel) {
        if (ov === 'room') shownOver = true;
        else if (shownOver && !ov) { shownOver = false; rooms.panelClosedBySite(); }
      } else shownOver = false;
      state.overlay = ov;
      const nb = !!ov && !(state.overlayOver3d && ov === 'room');
      if (nb === blocking) return;
      blocking = nb;
      if (nb) {
        input.unlock(); input.setGameplay(false);
        hostEl.hidden = true; uiRoot.hidden = true;   // [hidden], not visibility: the UI's shadow :host{all:initial} would undo an inherited visibility
        engine.pause(true);
      } else {
        hostEl.hidden = false; uiRoot.hidden = false;
        engine.pause(false); input.setGameplay(!state.menu);
      }
    };
    const timer = window.setInterval(tick, 250);
    const offK = ctx.registries.keys.register('overlay.close', {
      code: 'Escape', label: 'Выйти из здания', when: 'always',
      run: () => {
        if (state.menu) return false;
        if (rooms.current) { rooms.exit(); return true; }
        if (state.overlay === 'room') { site.closeOverlay(); return true; }
        return false;
      },
    });
    return () => { window.clearInterval(timer); offK(); };
  },
});
