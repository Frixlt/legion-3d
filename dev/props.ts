/**
 * Props showcase: every PropKit kind on a cobblestone square under night lighting, orbit camera.
 * ?tex=1 shows the texture swatches; ?focus=<kind> frames one prop. window.__props exposes stats.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PropKit, PROP_KINDS, lanternGlowSprite, propStats, type PropKind } from '../src/world/props';
import { getTexture, setTexAnisotropy, TEX_KINDS } from '../src/world/tex';

const q = new URLSearchParams(location.search);
const host = document.getElementById('app') as HTMLElement;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
host.appendChild(renderer.domElement);
setTexAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#0f0d2a'); gr.addColorStop(0.45, '#1d1a4a'); gr.addColorStop(0.8, '#3a2f6e'); gr.addColorStop(1, '#5a3a7a');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.fog = new THREE.Fog('#2a2458', 22, 60);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);

// lights: moon + hemisphere + a couple of warm point lights near lamps
const hemi = new THREE.HemisphereLight('#aab2ff', '#5a3a44', 1.6);
scene.add(hemi);
const moon = new THREE.DirectionalLight('#c8d0ff', 2.1);
moon.position.set(-10, 16, 12);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 60 });
moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.02;
scene.add(moon, moon.target);

const t0 = performance.now();
const timings: Record<string, number> = {};
// ground
{
  const t = performance.now();
  const c = getTexture('cobble');
  timings.cobble = performance.now() - t;
  for (const tt of [c.map, c.normalMap!, c.roughnessMap!]) tt.repeat.set(16, 8);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(36, 18).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, roughnessMap: c.roughnessMap, roughness: 1 }));
  g.receiveShadow = true; scene.add(g);
}

const layout: { kind: PropKind; x: number; z: number; ry?: number; opts?: any }[] = [];
const kinds = PROP_KINDS.filter((k) => k !== 'stairs' && k !== 'bridge');
const focus = q.get('focus') as PropKind | null;
const timed: Record<string, number> = {};
if (focus) layout.push({ kind: focus, x: 0, z: 0 });
else {
  // two rows
  const rowA = ['lamp', 'stall', 'fountain', 'well', 'statue', 'cart', 'tree', 'noticeBoard', 'banner', 'signpost'] as PropKind[];
  const rowB = kinds.filter((k) => !rowA.includes(k));
  let x = -14;
  for (const k of rowA) { const w = Math.max(1.2, PropKit.footprint(k).w); layout.push({ kind: k, x: x + w / 2, z: -3 }); x += w + 0.6; }
  x = -13;
  for (const k of rowB) { const w = Math.max(0.8, PropKit.footprint(k).w); layout.push({ kind: k, x: x + w / 2, z: 1.6, ry: 0 }); x += w + 0.7; }
}
for (const it of layout) {
  const t = performance.now();
  const g = PropKit.instanced(it.kind, [{ x: it.x, y: 0, z: it.z, rotY: it.ry ?? 0 }], it.opts);
  timed[it.kind] = performance.now() - t;
  scene.add(g);
}
if (!focus) {
  // stall variants + lamp row + bridge + stairs + garland
  scene.add(PropKit.instanced('stall', [{ x: 9, y: 0, z: 5.6, rotY: -0.3 }], { variant: 1 }));
  scene.add(PropKit.instanced('stall', [{ x: 12.2, y: 0, z: 5.2, rotY: -0.5 }], { variant: 2 }));
  scene.add(PropKit.instanced('tree', [{ x: 15, y: 0, z: -4, scale: 1.1 }], { variant: 2 }));
  const lamps = [{ x: -15, y: 0, z: 5 }, { x: -6, y: 0, z: 5 }, { x: 3, y: 0, z: 5 }];
  scene.add(PropKit.instanced('lamp', lamps));
  const heads = lamps.map((l) => new THREE.Vector3(l.x, l.y, l.z).add(PropKit.lampHeadOffset));
  heads.push(new THREE.Vector3(layout[0].x, 0, layout[0].z).add(PropKit.lampHeadOffset));
  scene.add(PropKit.glows(heads, { color: '#ffc860', size: 2.2 }));
  for (const h of heads.slice(0, 2)) { const pl = new THREE.PointLight('#ffb050', 6, 7, 1.6); pl.position.copy(h); scene.add(pl); }
  const span = [heads[0], heads[1], heads[2]];
  scene.add(PropKit.garland([span], { sag: 0.07 }));
  const br = PropKit.bridge(4, 1.8, 0.35); br.position.set(-10, 0, 7.5); br.rotation.y = Math.PI / 2; scene.add(br);
  const st = PropKit.stairs(1.6, 0.8, 1.6); st.position.set(-3, 0.8, 5.6); scene.add(st);
  const sp = lanternGlowSprite('#ffd070', 1.2); sp.position.set(0, 1.78, 0.75).add(new THREE.Vector3(layout[1].x, 0, layout[1].z)); scene.add(sp);
}
if (q.get('tex')) {
  // texture swatches on a wall of quads
  const n = TEX_KINDS.length;
  TEX_KINDS.forEach((k, i) => {
    const t = performance.now();
    const set = k === 'canvas' ? getTexture(k, { colors: ['#e0605a', '#f7e8d0'] }) : getTexture(k);
    timings[k] = performance.now() - t;
    const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap ?? null, roughnessMap: set.roughnessMap ?? null, roughness: k === 'water' ? 0.2 : 0.9, transparent: k === 'glow' });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), m);
    p.position.set(-((n - 1) * 2) / 2 + i * 2, 1.2, -6.5); scene.add(p);
  });
}
const buildMs = performance.now() - t0;

const controls = new OrbitControls(camera, renderer.domElement);
if (focus) {
  const f = PropKit.footprint(focus);
  const r = Math.max(f.w, f.h, f.d) * 1.3 + 0.6;
  camera.position.set(r * 0.9, f.h * 0.75 + r * 0.25, r * 1.3);
  controls.target.set(0, f.h * 0.45, 0);
} else if (q.get('cam') === 'b') {
  camera.position.set(-6, 3.2, 12); controls.target.set(-4, 1, 2);
} else {
  camera.position.set(0, 7.5, 17); controls.target.set(0, 1.2, 0);
}
controls.enableDamping = true;
let dirty = 3;
controls.addEventListener('change', () => { dirty = 2; });
controls.update();

let tris = 0, calls = 0;
// ?grid=1: every kind in its own viewport (close-up review sheet); props are placed far apart on a line
const page = q.get('page');
const grid = q.get('grid') ? PROP_KINDS.map((k, i) => ({ k, x: 100 + i * 12 })).filter((_, i) => page === null || Math.floor(i / 6) === +page) : null;
const gcam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
let gridFrames = 0;
if (grid) {
  const c = getTexture('cobble');
  for (const g of grid) {
    const opts = g.k === 'stall' ? { variant: 1 } : undefined;
    if (g.k === 'bridge' || g.k === 'stairs') {
      const o = g.k === 'bridge' ? PropKit.bridge(4, 1.8, 0.35) : PropKit.stairs(1.6, 0.8, 1.6);
      o.position.set(g.x, g.k === 'stairs' ? 0.8 : 0.9, 0); if (g.k === 'bridge') o.rotation.y = -1.1; scene.add(o);
    } else scene.add(PropKit.instanced(g.k, [{ x: g.x, y: 0, z: 0, rotY: -0.5 }], opts));
    if (g.k === 'lamp') scene.add(PropKit.glows([new THREE.Vector3(g.x, 0, 0).add(PropKit.lampHeadOffset)], { size: 2 }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, roughness: 1 }));
    m.position.set(g.x, g.k === 'bridge' ? -0.3 : 0, 0); m.receiveShadow = true; scene.add(m);
  }
  scene.fog = null;
  moon.shadow.camera.left = -400; moon.shadow.camera.right = 400; moon.castShadow = false;
}
function frame(): void {
  controls.update();
  if (grid) {
    const W = innerWidth, H = innerHeight, cols = page === null ? 6 : 3, rows = Math.ceil(grid.length / cols), cw = W / cols, ch = H / rows;
    renderer.setScissorTest(true);
    grid.forEach((g, i) => {
      const cx = (i % cols) * cw, cy = H - (Math.floor(i / cols) + 1) * ch;
      renderer.setViewport(cx, cy, cw, ch); renderer.setScissor(cx, cy, cw, ch);
      const f = g.k === 'bridge' ? { w: 2.5, h: 1.5, d: 4.6 } : PropKit.footprint(g.k);
      const r = Math.max(f.w, f.h, f.d) * 1.25 + 0.4;
      gcam.aspect = cw / ch; gcam.updateProjectionMatrix();
      gcam.position.set(g.x + r * 0.55, f.h * 0.6 + r * 0.35, r * 1.35);
      gcam.lookAt(g.x, f.h * 0.42 - (g.k === 'stairs' ? 0.4 : 0), 0);
      renderer.render(scene, gcam);
    });
    renderer.setScissorTest(false);
    // static review sheet: render a couple of frames only (keeps headless screenshots responsive)
    if (++gridFrames < 2) requestAnimationFrame(frame);
    return;
  }
  if (dirty > 0) {   // render on demand (orbit changes), keeps headless screenshots responsive
    dirty--;
    renderer.render(scene, camera);
    tris = renderer.info.render.triangles; calls = renderer.info.render.calls;
  }
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => { dirty = 2; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const hud = document.getElementById('hud');
const stats = propStats();
if (hud) hud.textContent = `props: ${PROP_KINDS.length} kinds · build ${buildMs.toFixed(0)} ms\n` + stats.map((s) => `${s.kind.padEnd(12)} ${String(Math.round(s.tris)).padStart(5)} tris ${s.parts} parts`).join('\n');
(window as any).__props = { stats, timings, timed, buildMs, get tris() { return tris; }, get calls() { return calls; } };
console.log('props build', buildMs.toFixed(0), 'ms', JSON.stringify(stats.map((s) => [s.kind, Math.round(s.tris)])));
