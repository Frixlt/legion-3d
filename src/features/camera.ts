/**
 * Camera modes: FP/TP chosen by the player (V, settings; persisted in localStorage 'l3d.cam'), orbit while a
 * menu asks for it (UI 'l3d:menu' detail.orbit; the body turns to where we looked so the orbit starts in front of the face).
 */
import type { CameraMode } from '../contracts';
import { lsSet, lsStr } from '../core/settings';
import { coreFeature } from './types';

export default coreFeature({
  id: 'camera',
  order: 10,
  setup(ctx) {
    const { rig, state } = ctx;
    const m0 = lsStr('l3d.cam', 'fp');
    state.mode = m0 === 'tp' ? 'tp' : 'fp';
    const apply = (instant = false) => {
      const m: CameraMode = state.menu && state.menuOrbit ? 'orbit' : state.mode;
      rig.setMode(m, { instant });
      if (m === 'orbit') rig.setOrbitFraming({ side: 'left' });
    };
    ctx.applyCamera = apply;
    const set = (m: CameraMode) => { if (m === 'orbit') return; state.mode = m; lsSet('l3d.cam', m); apply(); };
    ctx.uiHost.setCameraMode = set;
    let prev: string | null = null;
    const offMenu = ctx.onMenu((id) => {
      // keep the body facing where we looked in FP, so the orbit starts in front of the face
      if (id && !prev && state.mode === 'fp') {
        const ctl = ctx.controller();
        ctl.setFace(rig.yaw); ctx.me.face = rig.yaw; ctx.meAv.root.rotation.y = rig.yaw; rig.face = rig.yaw;
      }
      prev = id;
      apply();
    });
    const offKey = ctx.registries.keys.register('camera.toggle', {
      code: 'KeyV', label: 'Вид от первого / третьего лица',
      run: () => { set(state.mode === 'fp' ? 'tp' : 'fp'); return true; },
    });
    apply(true);
    return () => { offMenu(); offKey(); };
  },
});
