/**
 * Engine dev page: test scene built from the fair-city walk-grid fixture (boxes = obstacles / buildings),
 * a capsule stand-in for the avatar, FP/TP (V), orbit/equipment (Tab), quality (Q), stats overlay.
 * Jumping (Space): a course of crates / bench / fence / wall of varied heights next to the spawn, the real ledge
 * (upper → lower street, 1.4 m, stairs) from the analytic ground, a dev solidTop() that mirrors World3DExt.solidTop.
 * Exposes window.__eng for scripted screenshots (scripts/shot.mjs --eval).
 */
import * as THREE from 'three';
import type { CameraMode, QualityLevel } from '../src/contracts';
import { createEngine, createInput, createCameraRig, createPlayerController, layoutColliderBoxes } from '../src/engine';
import type { QualitySetting } from '../src/engine';
import { fixtureLayout } from './fixtures';
import { SX, SZ, Y0, EYE, toX, toZ } from '../src/world/coords';
import { groundSpec, makeGroundAt, inRanges } from '../src/world/ground';

const L = fixtureLayout();
const host = document.getElementById('app') as HTMLElement;
const engine = createEngine({ host, quality: 'auto' });
const { scene, camera, renderer } = engine;
const input = createInput(renderer.domElement);
const rig = createCameraRig(camera);
// Ground: the real analytic ground (upper street 0, lower street −1.4 m, stairs as ramps, canal)
const GS = groundSpec(L);
const groundAt = makeGroundAt(GS);
const LEDGE = GS.edge;

/* ------------------------------------------------------------------ jump course + dev solidTop */
// [x0, y0, x1, y1] px and top height (m) — all on the upper street east of the spawn
const COURSE: { b: [number, number, number, number]; top: number; kind: 'crate' | 'bench' | 'fence' | 'wall' }[] = [
  { b: [2640, 1005, 2680, 1035], top: 0.3, kind: 'crate' },
  { b: [2700, 1005, 2740, 1035], top: 0.6, kind: 'crate' },
  { b: [2760, 1005, 2800, 1035], top: 0.9, kind: 'crate' },
  { b: [2450, 1010, 2560, 1024], top: 0.5, kind: 'bench' },
  { b: [2940, 995, 2948, 1045], top: 0.75, kind: 'fence' },
  { b: [3060, 990, 3080, 1040], top: Infinity, kind: 'wall' },
];
function obstacleTop(x: number, y: number): number {
  for (const o of L.obstacles) {
    if ('e' in o) { const [cx, cy, rx, ry] = o.e; const dx = (x - cx) / (rx + 8), dy = (y - cy) / (ry + 8); if (dx * dx + dy * dy <= 1) return o.water ? Infinity : groundAt(cx, cy) + 0.7; }
    else if ('b' in o) { const [x0, y0, x1, y1] = o.b; if (x >= x0 - 8 && x <= x1 + 8 && y >= y0 - 8 && y <= y1 + 8) return o.water ? Infinity : Math.min(groundAt(x0, y0), groundAt(x0, y1)) + 0.5; }
    else if ('r' in o) { const [x0, x1, y1] = o.r; if (x >= x0 && x <= x1 && y <= y1 + 8) return 1.1; }
  }
  return -Infinity;
}
/** Mirrors World3DExt.solidTop for this dev scene: course tops, obstacle tops, the ledge band = drop, rest = wall. */
function solidTop(x: number, y: number): number {
  if (x < L.area.x0 || x > L.area.x1 || y < L.area.y0 || y > L.area.y1) return Infinity;
  for (const c of COURSE) if (x >= c.b[0] && x <= c.b[2] && y >= c.b[1] && y <= c.b[3]) return c.top;
  if (L.free(x, y)) return -Infinity;
  const t = obstacleTop(x, y);
  if (t > -Infinity) return t;
  if (y >= LEDGE[0] - 16 && y <= LEDGE[1] + 16 && !inRanges(x, GS.stairs)) return -Infinity;   // drop off the ledge
  return Infinity;
}
const player = createPlayerController(L, groundAt, { solidTop });

/* ------------------------------------------------------------------ scene */
scene.background = new THREE.Color('#2a2550');
scene.fog = new THREE.Fog('#2a2550', 18, 70);
scene.add(new THREE.HemisphereLight('#bfc8ff', '#3a2f4a', 1.4));
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(-8, 14, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
scene.add(sun, sun.target);

const W = toX(L.area.x1), D0 = toZ(L.area.y0), D1 = toZ(L.area.y1);
// upper street, retaining wall, lower street, stair ramps
const groundMat = new THREE.MeshStandardMaterial({ color: '#6b5a7e', roughness: 0.95 });
const lowerMat = new THREE.MeshStandardMaterial({ color: '#5a6b7e', roughness: 0.95 });
const wallMat = new THREE.MeshStandardMaterial({ color: '#7a4a4a', roughness: 0.9 });
const wallZ = toZ(GS.wallY), lowH = GS.lowH;
// upper street + wall face are cut at the stair wells (the ramps go down through them)
const gaps = GS.stairs.map(([a, b]) => [toX(a), toX(b)] as [number, number]).sort((p, q) => p[0] - q[0]);
const spans: [number, number][] = [];
{ let c = -2; for (const [a, b] of gaps) { if (a > c) spans.push([c, a]); c = Math.max(c, b); } spans.push([c, W + 2]); }
const upAll = new THREE.Mesh(new THREE.PlaneGeometry(W + 4, toZ(GS.rampY0) - D0 + 4).rotateX(-Math.PI / 2), groundMat);
upAll.position.set(W / 2, 0, (toZ(GS.rampY0) + D0 - 4) / 2); upAll.receiveShadow = true; scene.add(upAll);
for (const [a, b] of spans) {
  const up = new THREE.Mesh(new THREE.PlaneGeometry(b - a, wallZ - toZ(GS.rampY0)).rotateX(-Math.PI / 2), groundMat);
  up.position.set((a + b) / 2, 0, (wallZ + toZ(GS.rampY0)) / 2); up.receiveShadow = true; scene.add(up);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(b - a, -lowH), wallMat);
  face.position.set((a + b) / 2, lowH / 2, wallZ + 0.002); scene.add(face);
}
const lo = new THREE.Mesh(new THREE.PlaneGeometry(W + 4, D1 - wallZ + 4).rotateX(-Math.PI / 2), lowerMat);
lo.position.set(W / 2, lowH, (wallZ + D1 + 4) / 2); lo.receiveShadow = true; scene.add(lo);
for (const [a, b] of GS.stairs) {
  // ramp quad from the top edge (rampY0, 0 m) down to the bottom edge (rampY1, lowH)
  const x0 = toX(a), x1 = toX(b), z0 = toZ(GS.rampY0), z1 = toZ(GS.rampY1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x0, lowH, z1, x1, lowH, z1, x1, 0, z0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  const ramp = new THREE.Mesh(g, lowerMat); ramp.position.y = 0.01; ramp.receiveShadow = true; scene.add(ramp);
  // cut the wall face: a dark backing behind the ramp is enough for a dev scene
}
const grid = new THREE.GridHelper(Math.ceil(W + 10), Math.ceil(W + 10), 0x8877aa, 0x55497a);
grid.position.set(W / 2, 0.005, 10); (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.35;
scene.add(grid);

const obstMat = new THREE.MeshStandardMaterial({ color: '#b08c6a', roughness: 0.8 });
const waterMat = new THREE.MeshStandardMaterial({ color: '#3a7bd5', roughness: 0.2, metalness: 0.1 });
const bldMat = new THREE.MeshStandardMaterial({ color: '#c9a27c', roughness: 0.85 });
const roofMat = new THREE.MeshStandardMaterial({ color: '#8a3b4e', roughness: 0.7 });
const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 20).translate(0, 0.5, 0);
const colliders: THREE.Object3D[] = [];
function block(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, collide = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  if (collide) colliders.push(m);
  return m;
}
for (const o of L.obstacles) {
  if ('e' in o) {
    const [cx, cy, rx, ry] = o.e;
    const g = groundAt(cx, cy);
    if (o.water) block(unitCyl, waterMat, toX(cx), g - 0.05, toZ(cy), rx * SX, 0.06, ry * SZ, false);
    else block(unitCyl, obstMat, toX(cx), g, toZ(cy), rx * SX, 0.7, ry * SZ);
  } else if ('b' in o) {
    const [x0, y0, x1, y1] = o.b;
    const g = Math.min(groundAt(x0, y0), groundAt(x0, y1));
    if (o.water) block(unitBox, waterMat, toX((x0 + x1) / 2), g - 0.05, toZ((y0 + y1) / 2), (x1 - x0) * SX, 0.06, (y1 - y0) * SZ, false);
    else block(unitBox, obstMat, toX((x0 + x1) / 2), g, toZ((y0 + y1) / 2), (x1 - x0) * SX, 0.5, (y1 - y0) * SZ);
  } else if ('r' in o) {
    const [x0, x1, y1] = o.r;
    block(unitBox, obstMat, toX((x0 + x1) / 2), 0, toZ((Y0 + y1) / 2), (x1 - x0) * SX, 1.1, (y1 - Y0) * SZ);
  }
}
for (const b of L.buildings) {
  const [x0, x1, y0, y1] = b.hit;
  const back = y0 < Y0;
  const h = back ? (Y0 - y0) * SX : (y1 - y0) * SX;
  const zf = back ? toZ(Y0) - 0.3 : toZ(y1);
  const depth = back ? 4 : 1.4;
  const g = back ? 0 : groundAt(x0, y1);
  block(unitBox, bldMat, toX((x0 + x1) / 2), g, zf - depth / 2, (x1 - x0) * SX - 0.2, h, depth);
  block(unitBox, roofMat, toX((x0 + x1) / 2), g + h, zf - depth / 2, (x1 - x0) * SX, 0.25, depth + 0.4, false);
}

const courseMats = { crate: new THREE.MeshStandardMaterial({ color: '#c08a4a', roughness: 0.8 }), bench: new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.7 }), fence: new THREE.MeshStandardMaterial({ color: '#d8d0e8', roughness: 0.6 }), wall: new THREE.MeshStandardMaterial({ color: '#a05050', roughness: 0.9 }) };
for (const c of COURSE) {
  const [x0, y0, x1, y1] = c.b;
  const h = Number.isFinite(c.top) ? c.top : 2.6;
  block(unitBox, courseMats[c.kind], toX((x0 + x1) / 2), 0, toZ((y0 + y1) / 2), (x1 - x0) * SX, h, (y1 - y0) * SZ);
}

/* ------------------------------------------------------------------ stand-in avatar */
const me = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffb36b', roughness: 0.6 });
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 6, 16).translate(0, 0.62, 0), bodyMat);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14).translate(0, 1.2, 0), bodyMat);
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 10).rotateX(-Math.PI / 2).translate(0, 1.2, -0.36), new THREE.MeshStandardMaterial({ color: '#40306a' }));
const earL = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 8).translate(-0.17, 1.52, 0), bodyMat);
const earR = earL.clone(); earR.position.x = 0.34;
const sword = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(0.38, 0.75, -0.15), new THREE.MeshStandardMaterial({ color: '#d8dde8', metalness: 0.8, roughness: 0.3 }));
for (const m of [body, head, nose, earL, earR, sword]) { m.castShadow = true; me.add(m); }
scene.add(me);
const headParts = [head, nose, earL, earR];

/* ------------------------------------------------------------------ wiring */
rig.setColliders(colliders);
rig.setColliderBoxes(layoutColliderBoxes(L, groundAt));
rig.setGround(groundAt);
rig.setDragElement(renderer.domElement);
const [sx, sy] = L.nearest(2600, 1020);
player.teleport(sx, sy);
rig.yaw = 0; rig.pitch = -0.08;
let mode: CameraMode = 'tp';
let menu = false;
rig.setMode(mode, { instant: true });

const panel = document.getElementById('panel') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;
function applyCam(): void {
  if (menu) { rig.setOrbitFraming({ side: 'left', distance: 2.4 }); rig.setMode('orbit'); input.unlock(); }
  else rig.setMode(mode);
  input.setGameplay(!menu);
  panel.style.opacity = menu ? '1' : '0';
  panel.style.transform = menu ? 'none' : 'translateY(12px) scale(.98)';
}
input.onKey((code) => {
  if (code === 'KeyV' && !menu) { mode = mode === 'fp' ? 'tp' : 'fp'; applyCam(); return true; }
  if (code === 'Tab') { menu = !menu; applyCam(); return true; }
  if (code === 'KeyQ') { cycleQuality(); return true; }
  if (code === 'KeyG') { player.walkTo(4000, 1400); return true; }
  if (code === 'KeyR') { player.teleport(sx, sy); return true; }
  return false;
});
// Esc/Tab inside menu (gameplay off → only Escape/Enter reach onKey)
input.onKey((code) => { if (menu && code === 'Escape') { menu = false; applyCam(); return true; } return false; });
window.addEventListener('keydown', (e) => { if (menu && e.code === 'Tab') { e.preventDefault(); menu = false; applyCam(); } });
renderer.domElement.addEventListener('mousedown', () => { if (!menu && !input.locked) input.lock(); });

const QUAL: QualitySetting[] = ['auto', 0, 1, 2, 3];
let qi = 0;
function cycleQuality(): void { qi = (qi + 1) % QUAL.length; engine.setQuality(QUAL[qi]); qualSetting = QUAL[qi]; }
let qualSetting: QualitySetting = (() => { try { const v = localStorage.getItem('l3d.quality'); return v === null ? 'auto' : v === 'auto' ? 'auto' : (+v as QualityLevel); } catch { return 'auto'; } })();
qi = Math.max(0, QUAL.indexOf(qualSetting));
const applyShadows = (q: QualityLevel) => { sun.castShadow = q >= 3; };
engine.onQuality(applyShadows); applyShadows(engine.quality);

let squash = 0, lastEvent = '';
player.onJump(() => { lastEvent = 'прыжок'; });
player.onLand((impact, fall) => { rig.landed(impact); squash = Math.min(0.25, impact * 0.03); lastEvent = `приземление ${impact.toFixed(1)} м/с, ${fall.toFixed(2)} м`; });

const feet = new THREE.Vector3();
let hudT = 0;
const SENS = 0.0022;
const tick = (dt: number, t: number): void => {
  // 1. input
  const l = input.consumeLook();
  if (!menu) {
    rig.yaw -= l.dx * SENS;
    rig.pitch -= l.dy * SENS;
    rig.zoom(input.consumeWheel());
  } else input.consumeWheel();
  // 2. controller
  player.update(dt, menu ? NO_INPUT : scripted ?? input, rig.yaw);
  // 3. avatar
  player.feet(feet);
  me.position.copy(feet);
  me.rotation.y = mode === 'fp' && !menu ? rig.yaw : player.face;
  // gentle walk bounce on the stand-in
  const s01 = player.speed / 230;
  body.position.y = player.airborne ? 0 : Math.abs(Math.sin(t * 9 * Math.min(1.6, s01 + 0.001))) * 0.05 * Math.min(1, s01);
  squash = Math.max(0, squash - dt * 1.5);
  me.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
  // 4. camera
  rig.face = me.rotation.y;
  rig.follow(feet, EYE, player.airborne);
  rig.update(dt);
  const showHead = rig.distance > 0.6;   // hide own head until the camera has backed out of it
  for (const h of headParts) h.visible = showHead;
  sun.position.set(feet.x - 8, 14, feet.z + 10); sun.target.position.copy(feet);
  // 5. HUD
  hudT += dt;
  if (hudT > 0.25) {
    hudT = 0;
    const s = engine.stats();
    const dbg = (engine as any).debug?.() ?? {};
    hud.textContent = `${s.fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms · calls ${s.calls} · tris ${s.tris} · scale ${s.scale}\n` +
      `quality ${qualSetting} → L${engine.quality} · px ratio ${(dbg.pixelRatio ?? 0).toFixed(2)} · cam ${rig.mode}${rig.transitioning ? '…' : ''} · arm ${rig.distance.toFixed(2)} m\n` +
      `pos ${player.x.toFixed(0)},${player.y.toFixed(0)} px · ${(player.speed * SX).toFixed(2)} m/s · face ${(player.face * 180 / Math.PI).toFixed(0)}°\n` +
      `ноги ${player.feetY.toFixed(2)} м · опора ${player.ground.toFixed(2)} м · ${player.airborne ? 'в воздухе vy ' + player.vy.toFixed(1) : 'на земле'} · ${lastEvent}\n` +
      `[клик] мышь · WASD · Shift бег · Space прыжок · V 1-е/3-е лицо · Tab снаряжение · Q качество · G авто-путь · R на старт · колесо зум`;
  }
};
engine.onFrame(tick);
const frameFns = [tick];
let stepT = 0;
const NO_INPUT = { move: { x: 0, y: 0 }, run: false } as never;
/** Scripted input for deterministic screenshots (__eng.drive); null = keyboard. */
let scripted: { move: { x: number; y: number }; run: boolean; jump: boolean } | null = null;
void SZ;

(window as any).__eng = {
  engine, rig, player, input, me,
  setMode(m: CameraMode) { mode = m; menu = false; applyCam(); },
  menu(on: boolean) { menu = on; applyCam(); },
  look(yaw: number, pitch: number) { rig.yaw = yaw; rig.pitch = pitch; },
  /** Scripted movement: drive(x, y, jump?, run?) until drive(null). */
  drive(x: number | null, y = 0, jump = false, run = false) { scripted = x === null ? null : { move: { x, y }, run, jump }; },
  teleport(x: number, y: number) { player.teleport(x, y); },
  state: () => ({ x: +player.x.toFixed(1), y: +player.y.toFixed(1), feetY: +player.feetY.toFixed(3), ground: +player.ground.toFixed(3), airborne: player.airborne, vy: +player.vy.toFixed(2) }),
  /** Deterministic stepping for screenshots: pause the loop, advance the frame callbacks n × dt, render once. */
  step(n: number, dt = 1 / 60) {
    engine.pause(true);
    for (let i = 0; i < n; i++) { stepT += dt; for (const f of frameFns) f(dt, stepT); }
    renderer.render(scene, camera);
    return { mode: rig.mode, arm: +rig.distance.toFixed(3), pos: camera.position.toArray().map((v) => +v.toFixed(2)) };
  },
  stats: () => ({ ...engine.stats(), ...((engine as any).debug?.() ?? {}) }),
};
