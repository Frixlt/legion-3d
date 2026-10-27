/**
 * Dev page for src/combat: the hero and a ring of cats on a plane with a wall (arrows stick into it).
 * URL: ?w=sword|bow|staff|skullstaff|grimoire|censer|hammer|spear|holymace|none  ?role=necromancer|mage|priest…
 *      ?view=tp|fp|side|top  ?manual=1 (no animation loop: drive it with __combat.step / sheet for screenshots)
 * Keys: LMB attack (hold for the bow) · 1–9 weapons · V view · R reset.
 * window.__combat: { sys, press, release, step(n, dt), sheet(cols, rows, every, dt, w), perf(frames), weapon(w) }.
 */
import * as THREE from 'three';
import { createAvatarKit, appearanceFrom, RECOMMENDED_NEAR, type ViewModelEx } from '../src/avatar';
import type { Avatar } from '../src/contracts/modules';
import { CombatSystem, type CombatHost } from '../src/combat';
import { setBowCant } from '../src/avatar/avatar';
import type { CombatAvatar } from '../src/combat/ragdoll';
import type { RagdollEnv } from '../src/combat/physics';

const q = new URLSearchParams(location.search);
const W = (l: string, n: string, lk: any, g: any) => ({ l, n, lv: 5, lk, g });
const CATS = [
  W('c_knight', 'Мурзик', { shape: 'bean', eyes: 'big', mouth: 'open', blush: true }, { w: 'sword', s: 'round', a: 'lorica', ar: 'rare', am: 'heavy' }),
  W('c_box', 'Коробкин', { shape: 'box', hat: 'crown', color: '#ffb27a', eyes: 'happy', mouth: 'grin' }, { w: 'hammer', a: 'plate', ar: 'epic' }),
  W('c_ball', 'Пушистик', { shape: 'ball', hat: 'wizard', acc: ['cape'], eyes: 'stars', mouth: 'tongue' }, { w: 'staff', a: 'robe', ar: 'legendary' }),
  W('c_tall', 'Длинный', { shape: 'tall', eyes: 'big', acc: ['glasses', 'scarf'], color: '#7fd6e6' }, { w: 'grimoire' }),
  W('c_egg', 'Батон', { shape: 'egg', hat: 'bow', color: '#ff9fb2', blush: true }, { w: 'bow' }),
  W('c_cone', 'Груша', { shape: 'cone', color: '#9fe39a', hat: 'party' }, { w: 'mace', s: 'buckler' }),
  W('c_frost', 'Снежок', { shape: 'ball', color: '#8fb6ff', acc: ['bowtie'] }, {}),
  W('c_lav', 'Лаванда', { shape: 'bean', color: '#b9a2ff', hat: 'bunny' }, { w: 'crook' }),
];
// positions (x, z): a few close in front for melee, the rest further out
const SPOTS: [number, number][] = [[0.15, -1.35], [-1.1, -1.25], [1.25, -1.15], [-0.4, -3.4], [1.6, -4.2], [-2.4, -2.6], [2.8, -2.2], [0.6, -6.2]];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app')!.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2e2a5e');
scene.fog = new THREE.Fog('#2e2a5e', 16, 34);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, RECOMMENDED_NEAR, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
scene.add(new THREE.HemisphereLight('#d8d0ff', '#4a3a5a', 1.7));
const sun = new THREE.DirectionalLight('#fff1dc', 2.3); sun.position.set(-5, 9, 7); scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: '#6c5a86' }));
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x8a7ab0, 0x7a6aa0); (grid.material as THREE.Material).opacity = 0.22; (grid.material as THREE.Material).transparent = true; grid.position.y = 0.003; scene.add(grid);
// a wooden wall (arrows stick in it) and a low step (uneven ground for the ragdolls)
const WALL_Z = -8.5;
const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 0.4), new THREE.MeshToonMaterial({ color: '#8a6040' }));
wall.position.set(0, 1.5, WALL_Z - 0.2); scene.add(wall);
const step = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3), new THREE.MeshToonMaterial({ color: '#7a6a9a' }));
step.position.set(-4.5, 0.1, -3); scene.add(step);
const env: RagdollEnv = {
  groundAt: (x, z) => (Math.abs(x + 4.5) < 1.5 && Math.abs(z + 3) < 1.5 ? 0.2 : 0),
  blocked: (x, z, y) => z < WALL_Z && y < 3 && Math.abs(x) < 7,
};

const kit = createAvatarKit();
interface Guy { id: string; av: Avatar; home: THREE.Vector3; face: number; walk: number }
const guys: Guy[] = [];
CATS.slice(0, +(q.get('targets') ?? CATS.length)).forEach((raw, i) => {
  const app = appearanceFrom(raw.l, raw, 'cats', null);
  const av = kit.create(app);
  const far = q.get('spots') === 'far' ? 2.6 : 0;
  const [x, z0] = SPOTS[i], z = z0 - far;
  const g: Guy = { id: raw.l, av, home: new THREE.Vector3(x, 0, z), face: Math.atan2(x, z) + (i % 3 - 1) * 0.3, walk: i === 3 ? 1 : 0 };
  scene.add(av.root);
  guys.push(g);
});

let weapon = q.get('w') ?? 'sword';
const role = q.get('role') || undefined;
const heroRaw = () => ({ ...W('hero', 'Я', { shape: 'bean', color: '#ffc94d', eyes: 'big', mouth: 'grin', acc: ['cape'] }, weapon === 'none' ? {} : { w: weapon, a: 'leather', ar: 'rare' }), role });
let heroApp = appearanceFrom('hero', heroRaw(), 'cats', null);
heroApp.role = role;
const hero = kit.create(heroApp) as CombatAvatar;
scene.add(hero.root);
let vm = kit.viewModel(heroApp) as ViewModelEx;
camera.add(vm.root);
const feet = new THREE.Vector3(0, 0, 0);
let view = q.get('view') || 'tp';
let yaw = 0, pitch = -0.06;

const host: CombatHost = {
  scene, camera,
  forEachTarget(fn) { for (const g of guys) fn(g.id, g.av as CombatAvatar); },
  env: () => env,
  me: { av: hero, feet, fp: () => view === 'fp', get vm() { return vm; }, app: () => heroApp },
  createAvatar: (app) => kit.create(app),
  viewHeight: () => renderer.domElement.height,
  quality: () => +(q.get('q') ?? 3),
  // aim like the TP crosshair would: from behind the hero, level, along its facing (independent of the dev camera)
  aim(o, d) { if (view === 'fp') { camera.getWorldPosition(o); camera.getWorldDirection(d); d.y += aimPitch; d.normalize(); return; } o.set(feet.x + Math.sin(yaw) * 2.5, 1.5, feet.z + Math.cos(yaw) * 2.5); d.set(-Math.sin(yaw), aimPitch, -Math.cos(yaw)).normalize(); },
};
let aimPitch = +(q.get('aim') ?? 0.02);
const sys = new CombatSystem(host);

function setWeapon(w: string) {
  weapon = w;
  heroApp = appearanceFrom('hero', heroRaw(), 'cats', null); heroApp.role = role;
  hero.setAppearance(heroApp);
  vm.root.removeFromParent(); vm.dispose(); vm = kit.viewModel(heroApp) as ViewModelEx; camera.add(vm.root);
  sys.cancel();
}

function placeCamera() {
  vm.setVisible(view === 'fp');
  hero.setFirstPerson(view === 'fp');
  if (view === 'fp') { camera.position.set(feet.x, 1.15, feet.z); camera.rotation.set(pitch, yaw, 0); return; }
  if (view === 'side') { camera.position.set(4.2, 1.6, -1.2); camera.rotation.set(-0.12, Math.PI / 2 - 0.05, 0); return; }
  if (view === 'top') { camera.position.set(3.4, 4.2, 1.6); camera.lookAt(0, 0.4, -2.2); return; }
  if (view === 'heroside') { camera.position.set(2.3, 1.0, -0.2); camera.lookAt(0, 0.75, -0.2); return; }
  if (view === 'hero') { camera.position.set(1.5, 1.15, -2.1); camera.lookAt(0, 0.65, 0); return; }
  if (view === 'close') { camera.position.set(1.1, 1.05, -1.0); camera.lookAt(0.1, 0.78, -0.15); return; }
  if (view === 'closeback') { camera.position.set(0.9, 1.3, 1.3); camera.lookAt(0.1, 0.8, -0.3); return; }
  if (view === 'rag') { camera.position.set(3.4, 1.5, -2.3); camera.lookAt(-0.6, 0.45, -2.3); return; }
  if (view === 'above') { camera.position.set(0.3, 3.6, 1.2); camera.lookAt(0, 0.5, -0.7); return; }
  if (view === 'judge') { camera.position.set(3.2, 1.4, -0.5); camera.lookAt(-0.3, 0.6, -1.1); return; }
  if (view === 'judge2') { camera.position.set(-2.4, 1.5, 0.9); camera.lookAt(0.3, 0.6, -1.1); return; }
  if (view === 'front') { camera.position.set(3.1, 1.25, -3.3); camera.lookAt(-0.3, 0.55, -0.9); return; }
  // over the right shoulder
  // the game's TP framing (src/engine/camera.ts TP: pivot 1.42 m, 3.2 m back, 0.72 m to the right)
  camera.position.set(feet.x + Math.cos(yaw) * 0.72 + Math.sin(yaw) * 3.2, 1.62, feet.z - Math.sin(yaw) * 0.72 + Math.cos(yaw) * 3.2); camera.rotation.set(pitch - 0.06, yaw, 0);
}

let t = 0;
function tick(dt: number) {
  t += dt;
  // "crowd": put everyone where the "site" says, animate, THEN combat overrides ragdolls
  for (const g of guys) {
    const p = g.av.root.position;
    if (g.walk) { g.face += dt * 0.5; p.set(g.home.x + Math.sin(t * 0.5) * 1.2, 0, g.home.z); } else p.copy(g.home);
    g.av.root.rotation.set(0, g.face, 0);
    g.av.update(dt, t, g.walk ? 0.7 : 0);
  }
  hero.root.position.copy(feet); hero.root.rotation.y = yaw;
  hero.update(dt, t, 0);
  placeCamera();
  vm.update(dt, t, 0, { dx: 0, dy: 0 });
  sys.update(dt, t);
  renderer.render(scene, camera);
  hud();
}
const hudEl = document.getElementById('hud')!;
function hud() {
  const s = sys.stats;
  hudEl.textContent = `оружие: ${weapon}${role ? ' / ' + role : ''} → атака: ${sys.kind()}   вид: ${view}\n` +
    `рэгдоллы ${s.ragdolls}  зомби ${s.zombies}  частицы ${s.particles}  стрелы ${s.arrows}  combat ${sys.lastMs.toFixed(2)} ms  draw calls ${renderer.info.render.calls}`;
}

/* ---- input (the game's controls do the same: swing anim + combat.press) ---- */
let pressT = 0;
const press = () => {
  pressT = t;
  const started = sys.press();
  if (sys.kind() !== 'bow') { vm.swing(); hero.play('swing'); }
  return started;
};
const release = () => sys.release();
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 0) press(); });
addEventListener('mouseup', (e) => { if (e.button === 0) release(); });
const WEAPONS = ['sword', 'hammer', 'spear', 'bow', 'staff', 'skullstaff', 'censer', 'none', 'holymace'];
addEventListener('keydown', (e) => {
  if (/^Digit[1-9]$/.test(e.code)) setWeapon(WEAPONS[+e.code.slice(5) - 1]);
  if (e.code === 'KeyV') view = view === 'tp' ? 'fp' : view === 'fp' ? 'side' : 'tp';
  if (e.code === 'KeyR') sys.reset();
  if (e.code === 'ArrowLeft') yaw += 0.1;
  if (e.code === 'ArrowRight') yaw -= 0.1;
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const manual = q.get('manual') === '1';
let last = performance.now();
const loop = () => { const now = performance.now(); tick(Math.min(0.05, (now - last) / 1000)); last = now; requestAnimationFrame(loop); };
if (!manual) requestAnimationFrame(loop); else tick(1 / 60);

/** Frame sheet: cols × rows frames, `every` steps of dt between them, each scaled to width w. Returns a PNG data URL. */
function sheet(cols: number, rows: number, every: number, dt = 1 / 60, w = 420, onFrame?: (i: number) => void, crop?: [number, number, number, number]) {
  const c = renderer.domElement;
  const [cx, cy, cw, ch] = crop ?? [0, 0, 1, 1];
  const sx = cx * c.width, sy = cy * c.height, sw = cw * c.width, sh = ch * c.height;
  const h = Math.round((w * sh) / sw);
  const out = document.createElement('canvas'); out.width = cols * w; out.height = rows * h;
  const g = out.getContext('2d')!;
  g.font = 'bold 15px system-ui'; g.fillStyle = '#fff';
  for (let i = 0; i < cols * rows; i++) {
    onFrame?.(i);
    for (let k = 0; k < every; k++) tick(dt);
    g.drawImage(c, sx, sy, sw, sh, (i % cols) * w, Math.floor(i / cols) * h, w, h);
    g.fillText(`+${Math.round((t - pressT) * 1000)} ms`, (i % cols) * w + 6, Math.floor(i / cols) * h + 18);
  }
  return out.toDataURL('image/png');
}

/** Frames at given ms after the last press (ascending), cols per row, each w px wide, optional crop (fractions). */
function at(ms: number[], cols = 3, w = 640, crop?: [number, number, number, number]) {
  const c = renderer.domElement;
  const [cx, cy, cw, ch] = crop ?? [0, 0, 1, 1];
  const sx = cx * c.width, sy = cy * c.height, sw = cw * c.width, sh = ch * c.height;
  const h = Math.round((w * sh) / sw), rows = Math.ceil(ms.filter((m) => m >= 0).length / cols);
  const out = document.createElement('canvas'); out.width = cols * w; out.height = rows * h;
  const g = out.getContext('2d')!;
  g.font = 'bold 18px system-ui';
  let i = 0;
  ms.forEach((m) => {
    if (m === -1) { release(); return; }          // -1 = let go of the bow here
    while ((t - pressT) * 1000 < m - 1) tick(1 / 60);
    g.drawImage(c, sx, sy, sw, sh, (i % cols) * w, Math.floor(i / cols) * h, w, h);
    g.fillStyle = '#000'; g.fillText(`+${Math.round((t - pressT) * 1000)} ms`, (i % cols) * w + 9, Math.floor(i / cols) * h + 25);
    g.fillStyle = '#fff'; g.fillText(`+${Math.round((t - pressT) * 1000)} ms`, (i % cols) * w + 8, Math.floor(i / cols) * h + 24);
    i++;
  });
  return out.toDataURL('image/png');
}

/** Perf: knock over 6 cats and time the combat update (physics + pose + particles) over n frames. */
function perf(n = 240) {
  sys.reset();
  for (let i = 0; i < 6; i++) { const g = guys[i]; sys.hit(g.id, g.av as CombatAvatar, 3 + i * 0.4, 3, -2, g.home.x, 0.9, g.home.z, 0.03); }
  let total = 0, worst = 0, rag = 0;
  for (let i = 0; i < n; i++) {
    for (const g of guys) { g.av.root.position.copy(g.home); g.av.root.rotation.set(0, g.face, 0); g.av.update(1 / 60, t, 0); }
    t += 1 / 60;
    const t0 = performance.now(); sys.update(1 / 60, t); const ms = performance.now() - t0;
    total += ms; worst = Math.max(worst, ms); rag = Math.max(rag, sys.ragdolls.size);
  }
  return { avgMs: +(total / n).toFixed(4), worstMs: +worst.toFixed(3), maxRagdolls: rag };
}

/** Draw calls of the combat feature alone (its root + hit flashes + the TP bow overlay), rendered off-screen. */
function combatCalls() {
  const keep = new Set<THREE.Object3D>();
  sys.root.traverse((o) => keep.add(o));
  scene.traverse((o) => { if (o.name === 'avatar-flash' || o.name === 'avatar-bowdraw') keep.add(o); });
  const saved: [THREE.Object3D, boolean][] = [];
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine) { if (!keep.has(o)) { saved.push([o, o.visible]); o.visible = false; } } });
  const bg = scene.background; scene.background = null;
  renderer.info.autoReset = false; renderer.info.reset();
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls;
  renderer.info.autoReset = true;
  scene.background = bg;
  for (const [o, v] of saved) o.visible = v;
  return calls;
}

/** Worst case for the budget: 6 ragdolls (3 flashing), 3 zombies, arrows, an orb, rings, the trail, the bubble. */
function worst(n = 240, bow = false) {
  sys.reset();
  if (bow) press();
  for (let i = 0; i < 3; i++) sys.zombies.summon(-1.5 + i * 0.6, 0, 1.5, 0, sys.fx, 3, i === 0);
  for (let i = 0; i < 6; i++) { const g = guys[i]; sys.hit(g.id, g.av as CombatAvatar, 3 + i * 0.4, 3, -2, g.home.x, 0.9, g.home.z, 0.03); }
  for (let i = 0; i < 4; i++) sys.shots.fire('arrow', 0, 1, 0, (i - 1.5) * 2, 3, -20);
  sys.shots.fire('orb', 0, 1, 0, 0, 0, -8, '#8fd4ff');
  sys.fx.ring(0, 0, -2, 0.2, 2, 2, '#fff');
  sys.trail.begin('#fff'); for (let i = 0; i < 6; i++) sys.trail.push(0, 1, -i * 0.1, 0.4, 1, -i * 0.1, t + i / 60);
  let total = 0, worstMs = 0, maxCalls = 0, k = 0;
  const all: number[] = [];
  for (let i = 0; i < n; i++) {
    for (const g of guys) { g.av.root.position.copy(g.home); g.av.root.rotation.set(0, g.face, 0); g.av.update(1 / 60, t, 0); }
    t += 1 / 60;
    if (i % 30 === 0) for (let j = 0; j < 3; j++) { const g = guys[j]; sys.hit(g.id, g.av as CombatAvatar, 2, 2, -1, g.home.x, 0.9, g.home.z, 0.02); }
    const t0 = performance.now(); sys.update(1 / 60, t); const ms = performance.now() - t0;
    if (i >= 10) { total += ms; worstMs = Math.max(worstMs, ms); k++; all.push(ms); }
    if (i % 20 === 5) maxCalls = Math.max(maxCalls, combatCalls());
  }
  all.sort((a, b) => a - b);
  return { avgMs: +(total / k).toFixed(4), p95Ms: +all[Math.floor(all.length * 0.95)].toFixed(3), worstMs: +worstMs.toFixed(3), maxCombatDrawCalls: maxCalls, stats: { ...sys.stats } };
}

(window as any).__combat = { worst, combatCalls, markPress: () => { pressT = t; }, sys, press, release, at, setBowCant, step: (n: number, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); }, sheet, perf, weapon: setWeapon, guys, hero, renderer, setView: (v: string) => { view = v; }, setYaw: (y: number) => { yaw = y; } };
