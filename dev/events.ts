/**
 * Dev page for the seasonal events (src/events): the 3D city on the fixture layout with one event running, an orbit /
 * free-fly camera and buttons to switch the event on/off and change the quality while it runs.
 * URL options:
 *   ?event=halloween   event id (default halloween; `off` = none)        &q=0..3   quality (default 2)
 *   &cam=x,y&yaw=deg&pitch=deg   first-person camera at a px point (like dev/world.html)     &tp=1   third-person-ish
 * Keys: WASD/arrows fly (Shift = fast), Q/E down/up; mouse = orbit.   Window: __events = { start, stop, active, setQuality }
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fixtureLayout } from './fixtures';
import { buildCity } from '../src/world';
import { toX, toZ, fromX, fromZ, EYE } from '../src/world/coords';
import { EVENTS } from '../src/events';
import type { EventContext, SeasonalEvent } from '../src/events';
import type { QualityLevel } from '../src/contracts';

const qs = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
const app = document.getElementById('app')!;

(async () => {
  let q = Math.max(0, Math.min(3, +(qs.get('q') ?? 2))) as QualityLevel;
  const renderer = new THREE.WebGLRenderer({ antialias: q >= 3 });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  app.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 400);
  camera.rotation.order = 'YXZ';
  const layout = fixtureLayout();
  const world = await buildCity(layout, { quality: q, renderer });
  scene.add(world.root);
  const group = new THREE.Group(); scene.add(group);

  let controls: OrbitControls | null = null;
  const cam = qs.get('cam');
  if (cam) {
    const [x, y] = cam.split(',').map(Number);
    const yaw = (+(qs.get('yaw') ?? 0)) * Math.PI / 180, pitch = (+(qs.get('pitch') ?? 4)) * Math.PI / 180;
    camera.position.set(toX(x), world.groundAt(x, y) + EYE, toZ(y));
    camera.rotation.set(pitch, yaw, 0);
    if (qs.get('tp')) camera.position.add(new THREE.Vector3(Math.sin(yaw) * 3.2 + 0.6 * Math.cos(yaw), 0.9, Math.cos(yaw) * 3.2 - 0.6 * Math.sin(yaw))), camera.rotation.set(pitch - 0.12, yaw, 0);
  } else {
    const [sx, sy] = world.spawn;
    camera.position.set(toX(sx), 6, toZ(sy) + 12);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(toX(sx), 1.5, toZ(sy) - 2); controls.update();
  }

  /* ---- the event host (what src/features/seasonal.ts does in the game) */
  const frames = new Set<(dt: number, t: number) => void>(), qfns = new Set<(q: QualityLevel) => void>();
  let running: { ev: SeasonalEvent; stop: () => void } | null = null;
  const ctx: EventContext = {
    group, scene, world, layout, groundAt: (X, Z) => world.groundAt(fromX(X), fromZ(Z)),
    onFrame: (fn) => { frames.add(fn); return () => frames.delete(fn); },
    quality: () => q, onQuality: (fn) => { qfns.add(fn); return () => qfns.delete(fn); },
    renderer, camera, toast: (t) => console.log('[toast]', t),
  };
  const start = (id: string) => { stop(); const ev = EVENTS.find((e) => e.id === id); if (ev) running = { ev, stop: ev.setup(ctx) }; render(); };
  const stop = () => { running?.stop(); running = null; render(); };
  const setQuality = (nq: QualityLevel) => { q = nq; world.setQuality(nq); for (const f of [...qfns]) f(nq); };
  (window as any).__events = { start, stop, setQuality, active: () => running?.ev.id ?? null, group, scene, camera };
  const ev0 = qs.get('event') ?? 'halloween';
  const controlsEl = document.createElement('div');
  const render = () => {
    controlsEl.innerHTML = '';
    for (const e of EVENTS) { const b = document.createElement('button'); b.textContent = (running?.ev === e ? '■ ' : '▶ ') + e.title; b.onclick = () => (running?.ev === e ? stop() : start(e.id)); controlsEl.appendChild(b); }
    const s = document.createElement('select'); for (const l of [0, 1, 2, 3]) s.add(new Option('q' + l, String(l), false, l === q)); s.onchange = () => setQuality(+s.value as QualityLevel); controlsEl.appendChild(s);
  };
  hud.textContent = ''; const info = document.createElement('div'); hud.append(controlsEl, info);
  if (ev0 !== 'off') start(ev0); else render();

  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code)); addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3();
  let last = performance.now(), t = 0, fps = 60, n = 0;
  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt; fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    const sp = (keys.has('ShiftLeft') ? 18 : 6) * dt;
    camera.getWorldDirection(fwd); right.crossVectors(fwd, camera.up).normalize(); mv.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) mv.add(fwd); if (keys.has('KeyS') || keys.has('ArrowDown')) mv.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) mv.add(right); if (keys.has('KeyA') || keys.has('ArrowLeft')) mv.sub(right);
    if (keys.has('KeyE')) mv.y += 1; if (keys.has('KeyQ')) mv.y -= 1;
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); camera.position.add(mv); controls?.target.add(mv); }
    controls?.update();
    for (const f of [...frames]) f(dt, t);
    world.update(dt, t, camera);
    renderer.render(scene, camera);
    if (++n % 15 === 1) { const i = renderer.info.render; info.textContent = `events dev · ${running?.ev.id ?? 'none'} · q${q}\nfps ${fps.toFixed(0)} · calls ${i.calls} · tris ${(i.triangles / 1000).toFixed(0)}k`; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  (window as any).__ready = true;
})().catch((e) => { hud.textContent = 'error: ' + (e?.stack || e); console.error(e); });
