/**
 * Atlas of constellations (idea #5): four cat-shaped constellations (head, paw, tail, fish) in the night sky, placed from a
 * stable seed (city layout id + style). Their lines are faint; look up at one for a moment and it brightens and a small
 * caption («Созвездие Мурлыки») fades in. One draw call (src/world/sky.ts constellationMesh), off at quality 0.
 */
import * as THREE from 'three';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { placeConstellations, buildSkyBuffers, skySeed, angleBetween, gazeStep, FIGURES, type Placed } from '../explore/constellations';
import { constellationMesh, type ConstellationMesh } from '../world/sky';
import { coreFeature } from './types';

export const STARS_KEY = 'l3d.world.stars';

export default coreFeature({
  id: 'stars',
  order: 88,
  setup(ctx) {
    const offRow = registerSettingRow({ key: STARS_KEY, label: 'Созвездия', sub: 'Кошачьи созвездия в небе: посмотрите вверх — линии загорятся (от среднего качества)', group: 'Мир', order: 10, kind: 'seg', options: [['1', 'Вкл'], ['0', 'Выкл']], def: '1' });
    const cap = document.createElement('div');
    cap.style.cssText = 'position:fixed;left:50%;top:11%;transform:translateX(-50%);z-index:60;pointer-events:none;opacity:0;transition:opacity .9s ease;'
      + 'padding:6px 16px;border-radius:999px;background:rgba(13,11,34,.5);color:#fbe9b8;font:600 15px/1.3 system-ui,sans-serif;letter-spacing:.04em;text-shadow:0 0 12px rgba(255,214,140,.6)';
    cap.setAttribute('aria-live', 'polite');
    ctx.uiRoot.appendChild(cap);

    let mesh: ConstellationMesh | null = null, placed: Placed[] = [], root: THREE.Object3D | null = null, centers: Float32Array | null = null;
    const dwell = [0, 0, 0, 0], reveal = [0, 0, 0, 0];
    const enabled = () => settingValue<string>(STARS_KEY, '1') !== '0' && ctx.quality() >= 1;
    const drop = () => {
      if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh = null; }
      cap.style.opacity = '0'; dwell.fill(0); reveal.fill(0);
    };
    const sync = () => {
      const w = ctx.world();
      if (!enabled()) { drop(); return; }
      if (mesh && root === w.root) return;
      drop();
      const L = ctx.layout();
      placed = placeConstellations(skySeed(L.id, L.styleId), FIGURES);
      const b = buildSkyBuffers(placed);
      centers = b.centers;
      mesh = constellationMesh(b); root = w.root;
      w.root.add(mesh);
    };
    sync();
    const offW = ctx.onWorld(() => { root = null; sync(); });
    const offQ = ctx.engine.onQuality(() => sync());
    const onSet = (e: Event) => { const k = (e as CustomEvent).detail?.key; if (!k || k === STARS_KEY) sync(); };
    window.addEventListener('l3d:settings', onSet);

    const _d = new THREE.Vector3(), _p = new THREE.Vector3();
    let shown = -1;
    const offF = ctx.onFrame((dt, t) => {
      if (!mesh || !centers) return;
      ctx.camera.getWorldPosition(_p); mesh.position.copy(_p);
      mesh.userData.time.value = t;
      if (ctx.state.inRoom || !ctx.gameplay()) { if (shown >= 0) { shown = -1; cap.style.opacity = '0'; } return; }
      ctx.camera.getWorldDirection(_d);
      let best = -1, bestR = 0;
      for (let i = 0; i < placed.length; i++) {
        const ang = angleBetween(_d.x, _d.y, _d.z, centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
        const [dw, rv] = gazeStep(dwell[i], ang, dt);
        dwell[i] = dw; reveal[i] = rv;
        if (rv > bestR) { bestR = rv; best = i; }
      }
      mesh.userData.reveal.set(reveal[0], reveal[1], reveal[2], reveal[3]);
      const want = bestR > 0.55 ? best : -1;
      if (want !== shown) {
        shown = want;
        if (want >= 0) cap.textContent = placed[want].figure.name;
        cap.style.opacity = want >= 0 ? '1' : '0';
      }
    });
    ctx.dev.stars = { placed: () => placed, reveal, dwell, mesh: () => mesh, lookAt: (i: number) => { const c = centers; if (!c) return; const v = new THREE.Vector3(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]); ctx.rig.yaw = Math.atan2(-v.x, -v.z); ctx.rig.pitch = Math.asin(v.y); } };
    return () => { offF(); offW(); offQ(); window.removeEventListener('l3d:settings', onSet); drop(); cap.remove(); offRow(); };
  },
});
