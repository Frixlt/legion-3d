/**
 * Controls: E = use the target (aimed or nearby), LMB = use only what the crosshair is on (else swing),
 * F = the target's secondary action (alt), RMB = block (never opens anything). Space (jump) is read by the player
 * controller from input.consumeJump(). First click on the canvas grabs the pointer.
 */
import { coreFeature } from './types';

export default coreFeature({
  id: 'controls',
  order: 45,
  setup(ctx) {
    const { input, interact, vm, meAv } = ctx;
    const el = ctx.engine.renderer.domElement;
    const offE = ctx.registries.keys.register('interact.use', {
      code: 'KeyE', label: 'Действие / войти',
      run: () => interact.use('key'),
    });
    const offF = ctx.registries.keys.register('interact.alt', {
      code: 'KeyF', label: 'Второе действие (осмотреть)',
      run: () => { const t = interact.target; if (!t?.alt) return false; try { t.alt.use(); } catch (e) { console.error('[l3d] alt', t.id, e); } return true; },
    });
    const down = (e: MouseEvent) => {
      if (ctx.state.menu) return;
      if (!input.locked) {
        // hybrid room: the cursor is free for the site panel; a click on the 3D view grabs it back
        input.lock();
        return;
      }
      if (!ctx.gameplay()) return;
      if (e.button === 0) { if (!interact.use('click')) { vm.swing(); meAv.play('swing'); } }
      if (e.button === 2) vm.block(true);
    };
    const up = (e: MouseEvent) => { if (e.button === 2) vm.block(false); };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    el.addEventListener('contextmenu', menu);
    return () => { offE(); offF(); el.removeEventListener('mousedown', down); window.removeEventListener('mouseup', up); el.removeEventListener('contextmenu', menu); };
  },
});
