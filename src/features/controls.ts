/**
 * Controls: E = use the target (aimed or nearby), LMB = use only what the crosshair is on (else swing),
 * F = the target's secondary action (alt), RMB = block (never opens anything). Space (jump) is read by the player
 * controller from input.consumeJump(). First click on the canvas grabs the pointer — on the street and in rooms
 * without a stage.
 *
 * Scene mode (rooms.stage, hybrid rooms): the pointer is NEVER grabbed. LMB picks the room interactable under the
 * cursor (NPC, desk, station, exit) and uses it; hovering one shows a pointer cursor; RMB drag orbits the shot
 * (src/features/camera.ts). Clicks while a room is loading are ignored.
 */
import * as THREE from 'three';
import { coreFeature } from './types';

export default coreFeature({
  id: 'controls',
  order: 45,
  setup(ctx) {
    const { input, interact, vm, meAv, rooms } = ctx;
    const el = ctx.engine.renderer.domElement;
    const offE = ctx.registries.keys.register('interact.use', {
      code: 'KeyE', label: 'Действие / войти',
      run: () => interact.use('key'),
    });
    const offF = ctx.registries.keys.register('interact.alt', {
      code: 'KeyF', label: 'Второе действие (осмотреть)',
      run: () => { const t = interact.target; if (!t?.alt) return false; try { t.alt.use(); } catch (e) { console.error('[l3d] alt', t.id, e); } return true; },
    });
    const rc = new THREE.Raycaster(), ndc = new THREE.Vector2();
    /** The stage interactable under the cursor (scene mode), or null. */
    const pickAt = (cx: number, cy: number) => {
      const st = rooms.stage;
      if (!st || !st.pick) return null;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return null;
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ctx.camera.updateMatrixWorld();
      rc.setFromCamera(ndc, ctx.camera);
      return st.pick(rc.ray);
    };
    const down = (e: MouseEvent) => {
      if (ctx.state.menu) return;
      if (rooms.busy) return;   // loading a room: never grab the pointer for a scene that may be a hybrid one
      if (rooms.stage) {
        // scene mode: the cursor stays free; LMB uses what is under it
        if (e.button !== 0 || !ctx.gameplay()) return;
        const t = pickAt(e.clientX, e.clientY);
        if (t) { try { t.use('click'); } catch (err) { console.error('[l3d] use', t.id, err); } }
        return;
      }
      if (!input.locked) {
        input.lock();
        return;
      }
      if (!ctx.gameplay()) return;
      if (e.button === 0) { if (!interact.use('click')) { vm.swing(); meAv.play('swing'); } }
      if (e.button === 2) vm.block(true);
    };
    const up = (e: MouseEvent) => { if (e.button === 2) vm.block(false); };
    const menu = (e: Event) => e.preventDefault();
    // hover: pointer cursor over usable things (scene mode), at most every 80 ms
    let hoverAt = 0, hovering = false;
    const hover = (e: MouseEvent) => {
      if (!rooms.stage) { if (hovering) { hovering = false; el.style.cursor = ''; } return; }
      const now = performance.now(); if (now - hoverAt < 80) return; hoverAt = now;
      const h = !!pickAt(e.clientX, e.clientY);
      if (h !== hovering) { hovering = h; el.style.cursor = h ? 'pointer' : ''; }
    };
    const offRooms = rooms.onChange(() => { if (hovering) { hovering = false; el.style.cursor = ''; } });
    el.addEventListener('mousedown', down);
    el.addEventListener('mousemove', hover);
    window.addEventListener('mouseup', up);
    el.addEventListener('contextmenu', menu);
    return () => {
      offE(); offF(); offRooms();
      el.removeEventListener('mousedown', down); el.removeEventListener('mousemove', hover);
      window.removeEventListener('mouseup', up); el.removeEventListener('contextmenu', menu);
    };
  },
});
