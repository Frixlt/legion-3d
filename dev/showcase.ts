/**
 * Showcase gallery for the review video (and a handy visual check of every model): a night fair plaza with
 * tiered display stands under warm spotlights — every item model (src/avatar/items.ts registry), a line-up of
 * character variants (body shapes, hats, armour kinds, rarities, auras, a ghost) and a diorama of the street prop kit.
 *
 * Runs on the real engine (tone mapping, bloom, shadows at quality 3). The camera is posed by window.__showcase.pose(t)
 * (the video director calls it every frame) — or, standalone, by a looping fly-through (?auto=1, default when not
 * driven) / a fixed time (?t=4.5). Missing modules degrade: no item registry → the stands show gift boxes.
 */
import * as THREE from 'three';
import { createEngine } from '../src/engine';
import { createAvatarKit, appearanceFrom, CATALOG, RARITY_COLOR } from '../src/avatar';
import type { Avatar } from '../src/contracts/modules';
import type { ItemModelFactory } from '../src/contracts/ext';
import * as Items from '../src/avatar/items';
import { PropKit, lanternGlowSprite, PROP_KINDS, type PropKind } from '../src/world/props';
import { getTexture } from '../src/world/tex';
import { skyDome, stars } from '../src/world/sky';
import { dotTexture } from '../src/world/textures';

const q = new URLSearchParams(location.search);
const host = document.getElementById('app')!;
try { localStorage.setItem('l3d.quality', '3'); } catch { /* */ }
const engine = createEngine({ host, quality: 3 });
const { scene, camera } = engine;
camera.fov = 46; camera.near = 0.05; camera.far = 400; camera.updateProjectionMatrix();

/* ------------------------------------------------------------------ environment */
const SKY = 'linear-gradient(#0f0d2a 0%, #1d1a4a 40%, #3a2f6e 75%, #5a3a7a 100%)';
const dome = skyDome(SKY); scene.add(dome);
const starPts = stars(900, dotTexture()); scene.add(starPts);
scene.fog = new THREE.Fog((dome.userData.horizon as THREE.Color).clone(), 30, 120);
scene.add(new THREE.HemisphereLight('#9a8fe0', '#3a2a4a', 1.3));
const fill = new THREE.DirectionalLight('#ffe6c8', 0.85); fill.position.set(30, 7, 24); fill.target.position.set(30, 0.5, -2); scene.add(fill, fill.target);
const moon = new THREE.DirectionalLight('#b8b4ff', 0.55);
moon.position.set(-14, 22, 18); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -40, right: 40, top: 20, bottom: -20, near: 1, far: 80 });
moon.shadow.bias = -0.0005;
moon.target.position.set(24, 0, -3); scene.add(moon, moon.target);

const cob = getTexture('cobble');
for (const t of [cob.map, cob.normalMap]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(110, 60); }
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 220).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: cob.map, normalMap: cob.normalMap ?? null, color: '#8a6a80', roughness: 0.9 }));
floor.position.set(30, 0, -40); floor.receiveShadow = true; scene.add(floor);

const woodT = getTexture('wood');
for (const t of [woodT.map, woodT.normalMap]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 0.5); }
const standMat = new THREE.MeshStandardMaterial({ map: woodT.map, normalMap: woodT.normalMap ?? null, color: '#a0644a', roughness: 0.75 });
const trimMat = new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.35, metalness: 0.6, emissive: '#3a2400', emissiveIntensity: 0.4 });
const clothMat = new THREE.MeshStandardMaterial({ color: '#5a1f3e', roughness: 0.95 });
const plinthGeo = new THREE.CylinderGeometry(0.15, 0.17, 0.06, 24);
const plinthMat = new THREE.MeshStandardMaterial({ color: '#2d2240', roughness: 0.6 });

/* ------------------------------------------------------------------ item registry (graceful) */
const factories: Map<string, ItemModelFactory> = typeof (Items as any).itemModelFactories === 'function' ? (Items as any).itemModelFactories() : new Map();
const keyList: string[] = (Items as any).SUPPORTED_ITEM_MODEL_KEYS ? [...(Items as any).SUPPORTED_ITEM_MODEL_KEYS] : [];
const addRing: (o: THREE.Object3D, r: string) => unknown = (Items as any).addRarityRing || (() => null);
const RAR = CATALOG.rarities;
function itemModel(key: string, rarity: string): THREE.Object3D {
  const f = factories.get(key) || factories.get('*');
  const [fam, id] = key.split(':');
  if (f) {
    try {
      const slot = fam === 'hat' ? 'helmet' : fam === 'charm' ? 'trinket' : fam === 'slot' ? id : fam;
      const o = f(fam === 'slot' ? {} : { [fam]: id }, { rarity, slot, id: fam === 'food' ? id : undefined });
      addRing(o, rarity);
      return o;
    } catch (e) { console.warn('[showcase] model', key, e); }
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: '#e8455c' }));
  m.position.y = 0.1; const g = new THREE.Group(); g.add(m); return g;
}
const fit = (o: THREE.Object3D, size: number) => {
  const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3());
  const k = size / Math.max(1e-3, s.x, s.y, s.z); o.scale.setScalar(k);
};

/* ------------------------------------------------------------------ stands */
interface Section { title: string; x0: number; x1: number; focusY: number }
const sections: Section[] = [];
const spinners: { o: THREE.Object3D; a: number; w: number }[] = [];
const spots: THREE.SpotLight[] = [];

function spot(x: number, z: number, w: number, color = '#ffd9a0', intensity = 120): void {
  const s = new THREE.SpotLight(color, intensity, 14, 0.62, 0.65, 1.6);
  s.position.set(x, 5.2, z + 2.6); s.target.position.set(x, 0.6, z - 0.3);
  s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.bias = -0.0008;
  if (w > 5) s.angle = 0.75;
  scene.add(s, s.target); spots.push(s);
}

/** A 3-tier stand along X starting at x0; returns its width. Items: keys with display size. */
function stand(title: string, x0: number, rows: string[][], size: number, pitch: number): number {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = cols * pitch + 0.5;
  const g = new THREE.Group(); g.position.set(x0 + width / 2, 0, 0); scene.add(g);
  const TIER_D = 0.62;
  rows.forEach((row, k) => {
    const h = 0.42 + k * 0.34, z = -k * TIER_D;
    const b = new THREE.Mesh(new THREE.BoxGeometry(width, h, TIER_D), standMat);
    b.position.set(0, h / 2, z); b.castShadow = b.receiveShadow = true; g.add(b);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, 0.012, TIER_D + 0.02), clothMat);
    cloth.position.set(0, h + 0.006, z); cloth.receiveShadow = true; g.add(cloth);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.035, 0.035), trimMat);
    trim.position.set(0, h - 0.01, z + TIER_D / 2 + 0.01); g.add(trim);
    row.forEach((key, i) => {
      const x = (i - (row.length - 1) / 2) * pitch;
      const p = new THREE.Mesh(plinthGeo, plinthMat); p.position.set(x, h + 0.03, z + 0.02); p.receiveShadow = true; g.add(p);
      const rarity = RAR[1 + ((i + k * 2) % (RAR.length - 1))];   // uncommon … legendary: every item glows
      const m = itemModel(key, rarity); fit(m, size);
      const holder = new THREE.Group(); holder.position.set(x, h + 0.06, z + 0.02); holder.add(m);
      m.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name !== 'rarity-ring' && o.parent?.name !== 'rarity-ring') o.castShadow = true; });
      g.add(holder);
      spinners.push({ o: holder, a: (i * 0.7 + k) % (Math.PI * 2), w: 0.45 + ((i * 7 + k * 3) % 5) * 0.04 });
    });
  });
  // back board with a title sign
  const board = new THREE.Mesh(new THREE.BoxGeometry(width, 2.2, 0.08), standMat);
  board.position.set(0, 1.1, -rows.length * TIER_D - 0.1); board.receiveShadow = true; g.add(board);
  spot(x0 + width / 2, -0.6, width);
  sections.push({ title, x0, x1: x0 + width, focusY: 0.6 + rows.length * 0.2 });
  return width;
}

const ids = (prefix: string) => keyList.filter((k) => k.startsWith(prefix));
const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; const per = Math.ceil(a.length / n); for (let i = 0; i < a.length; i += per) out.push(a.slice(i, i + per)); return out; };
let X = 0;
const GAP = 1.4;
const weapons = ids('weapon:');
X += stand('Оружие', X, chunk(weapons.length ? weapons : ['*', '*', '*'], 3), 0.5, 0.68) + GAP;
const shields = ids('shield:'), armors = ids('armor:');
X += stand('Щиты и доспехи', X, [armors.length ? armors : ['*'], shields.length ? shields : ['*']], 0.5, 0.8) + GAP;
const hats = ids('hat:');
X += stand('Шапки и шлемы', X, chunk(hats.length ? hats : ['*'], 3), 0.3, 0.42) + GAP;
const misc = [...ids('charm:'), ...['slot:potion', 'slot:scroll', 'slot:material', 'slot:relic'].filter((k) => keyList.includes(k)), ...ids('food:'), ...(keyList.includes('*') ? ['*'] : [])];
X += stand('Амулеты, еда и зелья', X, chunk(misc.length ? misc : ['*'], 3), 0.26, 0.4) + GAP;

/* ------------------------------------------------------------------ character line-up */
const kit = createAvatarKit();
const avatars: { av: Avatar; emote: number; kind: string }[] = [];
const LINE: [string, any, any, number?][] = [
  ['sc_bean', { shape: 'bean', eyes: 'big', mouth: 'open', blush: true }, { w: 'sword', wr: 'rare', s: 'round', sr: 'uncommon', a: 'lorica', ar: 'rare', am: 'heavy' }],
  ['sc_box', { shape: 'box', hat: 'crown', color: '#ffb27a', eyes: 'happy', mouth: 'grin' }, { w: 'hammer', wr: 'epic', a: 'plate', ar: 'epic' }],
  ['sc_ball', { shape: 'ball', hat: 'wizard', acc: ['cape'], aura: 'halo', eyes: 'stars', mouth: 'tongue' }, { w: 'staff', wr: 'legendary', a: 'robe', ar: 'legendary', am: 'cloth' }],
  ['sc_tall', { shape: 'tall', eyes: 'big', acc: ['glasses', 'scarf'], color: '#7fd6e6' }, { w: 'grimoire', wr: 'rare', a: 'robe', ar: 'rare' }],
  ['sc_ghost', { shape: 'ghost', hat: 'tophat', color: '#e6e6ee', acc: ['monocle'] }, { w: 'censer', wr: 'uncommon' }],
  ['sc_cone', { shape: 'cone', eyes: 'cyclops', mouth: 'grin' }, { w: 'pitchfork', a: 'leather', ar: 'uncommon', am: 'light', h: 'miner', hr: 'common' }],
  ['sc_egg', { shape: 'egg', hat: 'bow', color: '#ff9fb2', blush: true }, { w: 'bow', wr: 'uncommon', a: 'lorica', ar: 'common', am: 'light' }],
  ['sc_rogue', { shape: 'bean', color: '#4a4350', eyes: 'happy', acc: ['shades'] }, { w: 'kris', wr: 'epic', a: 'leather', ar: 'epic', h: 'rhood', hr: 'epic' }],
  ['sc_necro', { shape: 'tall', color: '#9aa3ad', aura: 'shadow' }, { w: 'skullstaff', wr: 'epic', a: 'shroud', ar: 'epic', h: 'nhood', hr: 'rare' }],
  ['sc_paladin', { shape: 'box', color: '#f4f1ec', aura: 'gold', acc: ['pioneer'] }, { w: 'holymace', wr: 'legendary', s: 'scutum', sr: 'legendary', a: 'plate', ar: 'legendary', h: 'phelm', hr: 'legendary' }],
  ['sc_frost', { shape: 'ball', color: '#8fb6ff', hat: 'party', aura: 'frost', acc: ['bowtie'] }, { w: 'mace', wr: 'rare', s: 'buckler', sr: 'rare' }],
  ['sc_cowboy', { shape: 'egg', hat: 'cowboy', acc: ['mustache', 'tie'], color: '#ffe27a' }, { w: 'axe', wr: 'uncommon', s: 'barrel', sr: 'common' }],
  ['sc_spark', { shape: 'cone', hat: 'antenna2', aura: 'sparks', color: '#9fe39a' }, { w: 'spear', wr: 'rare', a: 'lorica', ar: 'uncommon', am: 'heavy' }],
  ['sc_legion', { shape: 'tall', hat: 'legion', color: '#ffc94d' }, { w: 'gladius', wr: 'legendary', s: 'scutum', sr: 'rare', a: 'lorica', ar: 'legendary', am: 'heavy' }],
  ['sc_spirit', { shape: 'bean', hat: 'halo' }, { w: 'club', a: 'leather' }, 1],
];
{
  const x0 = X, pitch = 1.3, perRow = Math.ceil(LINE.length / 2);
  const width = perRow * pitch + 0.6;
  // a low stage with two levels
  const st = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, 1.0), standMat); st.position.set(x0 + width / 2, 0.09, -0.1); st.receiveShadow = st.castShadow = true; scene.add(st);
  const st2 = new THREE.Mesh(new THREE.BoxGeometry(width, 0.55, 0.9), standMat); st2.position.set(x0 + width / 2, 0.275, -1.45); st2.receiveShadow = st2.castShadow = true; scene.add(st2);
  LINE.forEach(([login, lk, g, gh], i) => {
    const back = i >= perRow, j = back ? i - perRow : i;
    const app = appearanceFrom(login, { l: login, n: login, lv: 5, lk, g, gh: gh || 0 }, 'cats');
    const av = kit.create(app);
    const x = x0 + 0.3 + pitch / 2 + j * pitch + (back ? pitch / 2 : 0);
    av.root.position.set(x, back ? 0.55 : 0.18, back ? -1.45 : -0.05);
    av.root.rotation.y = Math.PI + ((j % 3) - 1) * 0.18;   // face +Z (avatars face −Z by default)
    av.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    scene.add(av.root);
    avatars.push({ av, emote: 1.2 + ((i * 37) % 23) / 4, kind: i % 3 === 0 ? 'wave' : i % 3 === 1 ? 'cheer' : 'equip' });
  });
  spot(x0 + width * 0.3, -0.4, width / 2, '#ffe2b8', 120); spot(x0 + width * 0.75, -0.4, width / 2, '#ffe2b8', 120);
  sections.push({ title: 'Облик котиков', x0, x1: x0 + width, focusY: 0.75 });
  X += width + GAP;
}

/* ------------------------------------------------------------------ street props diorama */
{
  const x0 = X, W = 13, cx = x0 + W / 2, cz = -4.5;
  const put = (kind: PropKind, list: { x: number; y?: number; z: number; rotY?: number; scale?: number }[], opts: any = {}) => {
    if (!(PROP_KINDS as readonly string[]).includes(kind)) return;
    try { scene.add(PropKit.instanced(kind, list.map((p) => ({ y: 0, ...p })), opts)); } catch (e) { console.warn('[showcase] prop', kind, e); }
  };
  put('fountain', [{ x: cx, z: cz }]);
  put('stall', [{ x: cx - 4.6, z: cz - 2.2, rotY: 0.35 }], { variant: 0 });
  put('stall', [{ x: cx + 4.6, z: cz - 2.2, rotY: -0.35 }], { variant: 2 });
  put('stall', [{ x: cx, z: cz - 4.6 }], { variant: 4 });
  const lamps = [{ x: cx - 2.6, z: cz + 2.2 }, { x: cx + 2.6, z: cz + 2.2 }, { x: cx - 2.8, z: cz - 3.2 }, { x: cx + 2.8, z: cz - 3.2 }];
  put('lamp', lamps);
  for (const l of lamps) {
    const s = lanternGlowSprite('#ffcf6a', 1.6, 0.8); s.position.set(l.x, 2.94, l.z); scene.add(s);
    const pl = new THREE.PointLight('#ffc27a', 7, 7, 1.8); pl.position.set(l.x, 2.8, l.z); scene.add(pl);
  }
  put('tree', [{ x: cx - 6, z: cz - 4.5 }], { variant: 0 }); put('tree', [{ x: cx + 6.2, z: cz - 4.2 }], { variant: 2 }); put('tree', [{ x: cx - 1.8, z: cz - 6.8 }], { variant: 1 });
  put('bench', [{ x: cx - 2.2, z: cz + 0.2, rotY: Math.PI / 2 }, { x: cx + 2.2, z: cz + 0.2, rotY: -Math.PI / 2 }]);
  put('barrel', [{ x: cx - 5.6, z: cz - 0.8 }, { x: cx - 5.1, z: cz - 0.4, scale: 0.9 }]);
  put('crate', [{ x: cx + 5.4, z: cz - 0.6, rotY: 0.3 }, { x: cx + 5.9, z: cz - 0.9, rotY: -0.2 }]);
  put('chest', [{ x: cx + 3.6, z: cz + 2.6, rotY: -0.4 }]);
  put('planter', [{ x: cx - 1.2, z: cz + 2.8 }, { x: cx + 1.2, z: cz + 2.8 }]);
  put('cart', [{ x: cx - 4.0, z: cz + 2.2, rotY: 0.6 }]);
  put('well', [{ x: cx + 6.4, z: cz + 1.4 }]);
  put('statue', [{ x: cx + 1.8, z: cz - 6.4 }]);
  put('anvil', [{ x: cx + 4.4, z: cz + 1.0, rotY: 0.5 }]);
  put('dummy', [{ x: cx + 5.2, z: cz + 2.8, rotY: -0.6 }]);
  put('noticeBoard', [{ x: cx - 6.4, z: cz + 1.2, rotY: 0.7 }]);
  put('banner', [{ x: cx - 3.6, z: cz - 6.2 }, { x: cx + 3.8, z: cz - 6.0 }]);
  put('bush', [{ x: cx - 6.8, z: cz - 1.8 }, { x: cx + 7, z: cz - 2.4 }, { x: cx - 0.2, z: cz - 6.9 }]);
  put('fence', [{ x: cx - 5, z: cz - 7.6 }, { x: cx - 3, z: cz - 7.6 }, { x: cx + 3, z: cz - 7.6 }, { x: cx + 5, z: cz - 7.6 }]);
  put('fenceWood', [{ x: cx - 7.6, z: cz - 3, rotY: Math.PI / 2 }, { x: cx + 7.8, z: cz - 3, rotY: Math.PI / 2 }]);
  put('signpost', [{ x: cx - 1.9, z: cz + 3.6, rotY: 0.4 }]);
  try {
    const V = (x: number, z: number) => new THREE.Vector3(x, 3.05, z);
    scene.add(PropKit.garland([[V(lamps[0].x, lamps[0].z), V(lamps[1].x, lamps[1].z)], [V(lamps[2].x, lamps[2].z), V(lamps[3].x, lamps[3].z)],
      [V(lamps[0].x, lamps[0].z), V(lamps[2].x, lamps[2].z)], [V(lamps[1].x, lamps[1].z), V(lamps[3].x, lamps[3].z)]], { sag: 0.14 }));
  } catch { /* */ }
  const sp = new THREE.SpotLight('#ffd9a0', 40, 22, 0.9, 0.7, 1.4); sp.position.set(cx, 9, cz + 6); sp.target.position.set(cx, 0, cz - 1); sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024);
  scene.add(sp, sp.target);
  sections.push({ title: 'Улица', x0, x1: x0 + W, focusY: 1.2 });
  X += W;
}

/* ------------------------------------------------------------------ ambient: lamps + garland along the stands */
{
  const end = sections[sections.length - 2].x1;
  const L: { x: number; y: number; z: number }[] = [];
  for (let x = -0.8; x <= end + 0.8; x += 5.2) L.push({ x, y: 0, z: -3.4 });
  scene.add(PropKit.instanced('lamp', L));
  for (const l of L) { const s = lanternGlowSprite('#ffcf6a', 1.4, 0.75); s.position.set(l.x, 2.94, l.z); scene.add(s); }
  const spans: THREE.Vector3[][] = [];
  for (let i = 0; i + 1 < L.length; i++) spans.push([new THREE.Vector3(L[i].x, 3.05, L[i].z), new THREE.Vector3(L[i + 1].x, 3.05, L[i + 1].z)]);
  try { scene.add(PropKit.garland(spans, { sag: 0.1 })); } catch { /* */ }
}

/* ------------------------------------------------------------------ skyline: far house silhouettes with lit windows */
{
  const houseMat = new THREE.MeshStandardMaterial({ color: '#3a2c5a', roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#2a2048', roughness: 1 });
  const winMat = new THREE.MeshBasicMaterial({ color: '#ffc46a' });
  const winGeo = new THREE.PlaneGeometry(0.5, 0.7);
  let r = 7;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  for (let x = -12; x < X + 14; x += 3.4 + rnd() * 2.2) {
    const w = 3 + rnd() * 2.4, h = 4 + rnd() * 4.5, z = -16 - rnd() * 5;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), houseMat); b.position.set(x, h / 2, z); scene.add(b);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.78, 1.6 + rnd() * 1.4, 4, 1).rotateY(Math.PI / 4), roofMat);
    roof.scale.z = 0.7; roof.position.set(x, h + 0.9, z); scene.add(roof);
    for (let wy = 1.4; wy < h - 0.6; wy += 1.5) for (let wx = -w / 2 + 0.7; wx < w / 2 - 0.4; wx += 1.1) {
      if (rnd() < 0.45) continue;
      const m = new THREE.Mesh(winGeo, winMat); m.position.set(x + wx, wy, z + 1.51); scene.add(m);
    }
  }
}

/* ------------------------------------------------------------------ camera path */
// dolly along the stands (x), then crane up and back over the street diorama
const S = sections, last = S[S.length - 1], lineEnd = S[S.length - 2].x1;
const DUR = +(q.get('dur') || 13);
const tDolly = DUR * 0.72;
const keys = {
  x: [[0, S[0].x0 + 0.6], [tDolly, lineEnd - 1.2], [DUR, (last.x0 + last.x1) / 2]] as [number, number][],
  y: [[0, 1.35], [tDolly * 0.5, 1.25], [tDolly, 1.5], [DUR, 4.4]] as [number, number][],
  z: [[0, 2.6], [tDolly * 0.62, 2.7], [tDolly, 3.6], [DUR, 4.6]] as [number, number][],
  tx: [[0, S[0].x0 + 2.0], [tDolly, lineEnd + 0.4], [DUR, (last.x0 + last.x1) / 2]] as [number, number][],
  ty: [[0, 0.75], [tDolly, 0.85], [DUR, 1.3]] as [number, number][],
  tz: [[0, -0.6], [tDolly, -0.6], [DUR, -5.2]] as [number, number][],
};
// x(t) at constant-ish speed while dollying: linear with smooth ends (Hermite on 3 keys gives a slight ease)
function keyed(ks: [number, number][], t: number): number {
  if (t <= ks[0][0]) return ks[0][1];
  const n = ks.length; if (t >= ks[n - 1][0]) return ks[n - 1][1];
  let i = 0; while (i < n - 2 && t > ks[i + 1][0]) i++;
  const [t0, v0] = ks[i], [t1, v1] = ks[i + 1], h = t1 - t0, u = (t - t0) / h;
  const tan = (j: number) => (j <= 0 || j >= n - 1 ? 0 : (ks[j + 1][1] - ks[j - 1][1]) / (ks[j + 1][0] - ks[j - 1][0]));
  const m0 = tan(i) * h, m1 = tan(i + 1) * h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1;
}
const look = new THREE.Vector3();
let simT = 0;
function pose(t: number): void {
  simT = t;
  camera.position.set(keyed(keys.x, t), keyed(keys.y, t), keyed(keys.z, t));
  look.set(keyed(keys.tx, t), keyed(keys.ty, t), keyed(keys.tz, t));
  camera.lookAt(look);
}
/** When the camera looks at each section (for captions): first/last t whose look-at x is inside the section. */
function sectionTimes(): { title: string; t0: number; t1: number }[] {
  return S.map((s, i) => {
    let t0 = -1, t1 = -1;
    for (let t = 0; t <= DUR; t += 1 / 60) {
      const x = keyed(keys.tx, t);
      const inside = i === S.length - 1 ? t > tDolly + 0.6 : x >= s.x0 + 0.3 && x <= s.x1 - 0.3;
      if (inside) { if (t0 < 0) t0 = t; t1 = t; }
    }
    return { title: s.title, t0, t1 };
  });
}

/* ------------------------------------------------------------------ frame */
const driven = { on: false };
engine.onFrame((dt, t) => {
  if (!driven.on) pose(q.get('t') ? +q.get('t')! : (t * 1) % DUR);
  const tt = simT;
  for (const s of spinners) s.o.rotation.y = s.a + tt * s.w;
  for (const a of avatars) {
    a.av.update(dt, tt, 0);
    if (tt >= a.emote && tt - dt < a.emote) a.av.play(a.kind);
  }
  (starPts.material as THREE.ShaderMaterial).uniforms.uTime.value = tt;
});

(window as any).__showcase = {
  ready: true, dur: DUR, sections: sectionTimes(),
  counts: { items: keyList.length, avatars: avatars.length, props: PROP_KINDS.length },
  /** Director: pose the camera at time t (seconds) for the next rendered frame. */
  pose(t: number) { driven.on = true; pose(t); },
  engine,
};
console.log('[showcase] items', keyList.length, 'avatars', avatars.length, 'width', X.toFixed(1), 'm', JSON.stringify(sectionTimes()));
void RARITY_COLOR;
