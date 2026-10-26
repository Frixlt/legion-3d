/**
 * Camera modes: FP/TP chosen by the player (V, settings; persisted in localStorage 'l3d.cam'), orbit while a
 * menu asks for it (UI 'l3d:menu' detail.orbit; the body turns to where we looked so the orbit starts in front of the face).
 *
 * Scene mode (a room with a stage is active — hybrid rooms, see src/core/rooms.ts SceneStage): the cursor stays free
 * for the site panel and the camera is a cinematic third-person shot written over the rig's pose each frame (this
 * feature's onFrame runs after rig.update): the hero seen over the shoulder on the side away from the site panel,
 * looking at the stage focus (NPC / station), the composition shifted into the free half of the screen (film offset,
 * measured from the site panel's rect), a slow subtle drift (off with prefers-reduced-motion). Right-drag on the 3D
 * view orbits a little, the wheel zooms within limits; WASD still walks relative to the shot (the camera follows).
 * The rig itself stays in FP meanwhile (no aim reach from the far camera: E uses what is near the hero, clicks pick
 * what is under the cursor — src/features/controls.ts); leaving the room restores the chosen mode.
 */
import * as THREE from 'three';
import type { CameraMode } from '../contracts';
import { lsSet, lsStr } from '../core/settings';
import { clamp, damp, wrapAngle } from '../engine/math';
import { coreFeature } from './types';

/** Scene-mode shot tuning (radians / metres). */
export const SCENE = {
  /** Azimuth of the camera off the hero→focus line, towards the side away from the panel. */
  phi: 0.52,
  elev: 0.3, elevMin: 0.06, elevMax: 0.75,
  dist: 4.2, distMin: 2.6, distMax: 6.5,
  /** Look point: from the hero towards the focus by this share of their distance (clamped 0.5–1.3 m), at this height. */
  lead: 0.45, lookH: 1.0,
  fov: 52,
  /** Free-screen centre (NDC x) when the panel cannot be measured: panel left → +0.38. */
  frame: 0.38,
  /** Blend from the rig's pose into the shot (s). */
  blend: 0.8,
  userPhiMax: 0.9,
};

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

/**
 * Pure shot geometry (tests): camera position for a hero at (hx, hz) looking at focus (fx, fz) along yaw0, azimuth
 * offset `phi`, elevation `elev`, distance `dist`. Writes the look point into `look` and the camera into `out`.
 */
export function sceneShot(hx: number, hy: number, hz: number, fx: number, fz: number, yaw0: number, phi: number, elev: number, dist: number,
  look: THREE.Vector3, out: THREE.Vector3): number {
  const d0x = -Math.sin(yaw0), d0z = -Math.cos(yaw0);
  const k = clamp(Math.hypot(fx - hx, fz - hz) * SCENE.lead, 0.5, 1.3);
  look.set(hx + d0x * k, hy + SCENE.lookH, hz + d0z * k);
  const cy = yaw0 - phi, ce = Math.cos(elev);
  out.set(look.x + Math.sin(cy) * ce * dist, look.y + Math.sin(elev) * dist, look.z + Math.cos(cy) * ce * dist);
  return cy;
}

export default coreFeature({
  id: 'camera',
  order: 10,
  setup(ctx) {
    const { rig, state, rooms, camera, engine, input } = ctx;
    const m0 = lsStr('l3d.cam', 'fp');
    state.mode = m0 === 'tp' ? 'tp' : 'fp';
    const apply = (instant = false) => {
      const m: CameraMode = state.menu && state.menuOrbit ? 'orbit' : rooms.stage ? 'fp' : state.mode;
      rig.setMode(m, { instant });
      if (m === 'orbit') rig.setOrbitFraming({ side: 'left' });
    };
    ctx.applyCamera = apply;
    const set = (m: CameraMode) => { if (m === 'orbit') return; state.mode = m; lsSet('l3d.cam', m); apply(); };
    ctx.uiHost.setCameraMode = set;
    let prev: string | null = null;
    const offMenu = ctx.onMenu((id) => {
      // keep the body facing where we looked in FP, so the orbit starts in front of the face
      if (id && !prev && state.mode === 'fp' && !rooms.stage) {
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

    /* ---------------------------------------------------------------- scene mode */
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = engine.renderer.domElement;
    let on = false, sideSign = 1, yaw0 = 0, userPhi = 0, userElev = 0, dist = SCENE.dist, blendT = 0, tt = 0;
    let arm = SCENE.dist, frameX = SCENE.frame, frameWant = SCENE.frame, frameY = 0, frameYWant = 0, measureT = 0, lookInit = false;
    let panelRect: number[] | null = null;
    const aim = new THREE.Vector3(), look = new THREE.Vector3(), lookS = new THREE.Vector3(), want = new THREE.Vector3(), dir = new THREE.Vector3();
    const rigPos = new THREE.Vector3(), rigQ = new THREE.Quaternion(), myQ = new THREE.Quaternion();
    const m4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
    const rc = new THREE.Raycaster(); const hits: THREE.Intersection[] = [];

    /**
     * Where the composition goes: the centre (NDC) of the biggest screen strip the site panel leaves free — right or
     * left of a docked panel, or below a wide bar (then the look point is raised so the hero sits low in the frame).
     */
    const measure = () => {
      const st = rooms.stage; if (!st) return;
      frameWant = st.side === 'right' ? -SCENE.frame : st.side === 'full' ? 0 : SCENE.frame; frameYWant = 0;
      const W = window.innerWidth || 1, H = window.innerHeight || 1;
      const p = document.querySelector('.cy-room .cy-rui') as HTMLElement | null;
      if (!p) { panelRect = null; return; }
      const r = p.getBoundingClientRect();
      if (!(r.width > 40 && r.height > 40)) { panelRect = null; return; }
      panelRect = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
      const left = r.left * H, right = (W - r.right) * H, below = W * (H - r.bottom);
      if (below > left && below > right && H - r.bottom > H * 0.15) {
        frameWant = 0; frameYWant = clamp(1 - ((r.bottom + H) / 2 / H) * 2, -0.75, 0);
      } else if (right >= left) frameWant = clamp(((r.right + W) / 2 / W) * 2 - 1, -0.6, 0.6);
      else frameWant = clamp((r.left / 2 / W) * 2 - 1, -0.6, 0.6);
    };
    const onStage = () => {
      const st = rooms.stage;
      if (!st) {
        if (on) { on = false; dragging = false; el.style.cursor = ''; rig.yaw = wrapAngle(rig.yaw); apply(true); }
        return;
      }
      on = true; tt = 0; blendT = 0; userPhi = 0; userElev = 0; dist = SCENE.dist; arm = dist; lookInit = false;
      sideSign = st.side === 'right' ? -1 : st.side === 'full' ? 0.6 : 1;
      yaw0 = Math.atan2(-(st.focus.x - st.stand.x), -(st.focus.z - st.stand.z));
      rig.yaw = yaw0; rig.pitch = -0.05;
      input.unlock();   // never hold the pointer in scene mode
      measureT = 0; measure(); frameX = frameWant;
      apply(true);
    };
    const offRooms = rooms.onChange(onStage);

    // right-drag orbits a little, the wheel zooms (only over the 3D view, only in scene mode)
    let dragging = false, lastX = 0, lastY = 0;
    const down = (e: PointerEvent) => { if (!on || e.button !== 2) return; dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      userPhi = clamp(userPhi + (e.clientX - lastX) * 0.006, -SCENE.userPhiMax, SCENE.userPhiMax);
      userElev = clamp(userElev + (e.clientY - lastY) * 0.004, SCENE.elevMin - SCENE.elev, SCENE.elevMax - SCENE.elev);
      lastX = e.clientX; lastY = e.clientY;
    };
    const up = (e: PointerEvent) => { if (e.button === 2 || e.buttons === 0) dragging = false; };
    const wheel = (e: WheelEvent) => {
      if (!on || state.menu) return;
      const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
      dist = clamp(dist * Math.exp((e.deltaY * k) / 100 * 0.12), SCENE.distMin, SCENE.distMax);
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: true });

    const offFrame = ctx.onFrame((dt) => {
      if (!on) return;
      const st = rooms.stage;
      if (!st || (state.menu && state.menuOrbit)) return;   // a menu's orbit camera takes over meanwhile
      tt += dt;
      measureT -= dt; if (measureT <= 0) { measureT = 0.5; measure(); }
      frameX = damp(frameX, frameWant, 4, dt); frameY = damp(frameY, frameYWant, 4, dt);
      const drift = reduced ? 0 : Math.sin(tt * 0.13) * 0.06 + Math.sin(tt * 0.047 + 1.3) * 0.04;
      const elev = clamp(SCENE.elev + userElev + (reduced ? 0 : Math.sin(tt * 0.09) * 0.02), SCENE.elevMin, SCENE.elevMax);
      const f = ctx.feet;
      const cy = sceneShot(f.x, f.y, f.z, st.focus.x, st.focus.z, yaw0, sideSign * SCENE.phi + userPhi + drift, elev, dist, look, want);
      // smooth the look point (walking, stairs), then the arm against the room's camera colliders
      if (!lookInit) { lookS.copy(look); lookInit = true; }
      else { lookS.x = damp(lookS.x, look.x, 6, dt); lookS.y = damp(lookS.y, look.y, 6, dt); lookS.z = damp(lookS.z, look.z, 6, dt); }
      dir.subVectors(want, look); const len = dir.length(); dir.multiplyScalar(1 / len);
      let free = len;
      const cols = rooms.scene?.colliders;
      if (cols && cols.length) {
        rc.set(lookS, dir); rc.near = 0; rc.far = len + 0.25;
        hits.length = 0;
        for (let i = 0; i < cols.length; i++) cols[i].raycast(rc, hits);
        for (let i = 0; i < hits.length; i++) if (hits[i].distance - 0.25 < free) free = Math.max(0.8, hits[i].distance - 0.25);
        hits.length = 0;
      }
      arm = free < arm ? free : damp(arm, free, 2.5, dt);
      want.copy(lookS).addScaledVector(dir, arm);
      // vertical framing (a wide panel on top): aim above the look point so it appears at NDC frameY
      aim.copy(lookS); aim.y -= frameY * arm * Math.tan((SCENE.fov * Math.PI / 180) / 2);
      myQ.setFromRotationMatrix(m4.lookAt(want, aim, UP));
      // blend in from the rig's pose (written by rig.update this frame)
      blendT += dt;
      const k = ease(blendT / SCENE.blend);
      rigPos.copy(camera.position); rigQ.copy(camera.quaternion);
      camera.position.lerpVectors(rigPos, want, k);
      camera.quaternion.slerpQuaternions(rigQ, myQ, k);
      const fov = camera.fov + (SCENE.fov - camera.fov) * k;
      const skew = -frameX * camera.aspect * Math.tan((fov * Math.PI / 180) / 2) * camera.getFilmWidth() * k;
      camera.fov = fov; camera.filmOffset = skew; camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      // WASD walks relative to the shot
      rig.yaw = cy;
    });

    ctx.dev.sceneCam = () => ({ on, arm: +arm.toFixed(2), dist, frameX: +frameX.toFixed(2), frameY: +frameY.toFixed(2), panel: panelRect, yaw0: +yaw0.toFixed(2), look: lookS.toArray().map((v) => +v.toFixed(2)), cam: camera.position.toArray().map((v) => +v.toFixed(2)), stage: rooms.stage && { focus: rooms.stage.focus, stand: rooms.stage.stand, side: rooms.stage.side } });
    apply(true);
    return () => {
      offMenu(); offKey(); offRooms(); offFrame();
      el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel);
    };
  },
});
