/**
 * «Лавка» / «Торговые ряды»: food on painted wall shelves under striped awnings, potions (and the enchant materials,
 * like the site's shop tiles) on the counter, the cook behind it; baskets and crates of colourful produce, hanging
 * herbs, garlic and peppers, a chalkboard menu, bunting and a festoon of bulbs — a bright market stall, not a cellar.
 */
import * as THREE from 'three';
import type { RoomBase, RoomEnv } from '../common/base';
import { msOn, type RowsStock, type StockItem } from '../common/stock';
import { Frame, counter, shelves, awning, COUNTER_TOP, DAIS } from './furniture';
import { bunting, stringLights, basket, sack, potPlant, hanging, cloth, wallLamp, candle, mug, roundRug, stool } from '../common/decor';

const W = 9.6, D = 8, H = 3.7;
/** Market palette: cream walls, teal wainscot, mint shelves with coral trim, berry and sunflower accents. */
const C = {
  wall: '#f3dfbd', wains: '#3f8f8a', wainsTop: '#f7ecd2', floor: '#d29a62', beam: '#e8d0aa', timber: '#9a6a48',
  shelf: '#7fcbb5', shelfBack: '#f7e7c8', lip: '#ff8f7a', counter: '#7fb0e8', counterTop: '#f7ecd2',
  awn1: '#e0504a', awn2: '#fff3dc', awn3: '#3f8f8a',
};
const FRUIT = ['#e0504a', '#ffd84a', '#9fe35a', '#ff9a3a', '#b05ac8', '#ff6a8a'];

export function buildRows(R: RoomBase, st: RowsStock | null, env: RoomEnv): void {
  const K = R.kit, P = R.pal, b = 'shop';
  R.bg = '#1c1420';
  K.shell({ w: W, d: D, h: H, wall: 'plaster', wallCol: C.wall, wainscot: C.wains, floor: 'wood', floorCol: C.floor, ceiling: 'beams', ceilCol: C.beam });
  // light timber framing on the back wall only (the sides carry shelves and awnings)
  for (const x of [-W / 2 + 0.1, -2.75, 2.75, W / 2 - 0.1]) K.box('wood', C.timber, x - 0.08, x + 0.08, 0, H, -D / 2, -D / 2 + 0.07);
  K.box('wood', C.timber, -W / 2, W / 2, 2.62, 2.72, -D / 2, -D / 2 + 0.085);
  // checked floor runner from the door to the counter + a round rug
  for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) K.floorBox('canvas', (i + j) % 2 ? '#fff3dc' : '#e0504a', -0.75 + j * 0.5, -0.25 + j * 0.5, -1.0 + i * 0.45, -0.55 + i * 0.45);
  roundRug(K, -2.6, 1.6, 0.8, '#ffcf4a', '#3f8f8a');

  const food = (st && st.food) || [], potions = (st && st.potions) || [];
  const h = env.store.hero;
  const mats: StockItem[] = h && h.ef && !msOn(h) ? [
    { id: 'enchant_star', mat: 'star', slot: 'material', rarity: 'uncommon', name: 'Счастливая звезда' },
    { id: 'enchant_sphere', mat: 'sphere', slot: 'material', rarity: 'rare', name: 'Сфера сохранения' },
  ] : [];
  // food: left wall shelves (and the right wall when there is a lot of it), painted, under a striped awning
  const left = food.slice(0, 10), right = food.slice(10, 20);
  const SH = { w: 3.8, depth: 0.5, fit: 0.32, col: C.shelfBack, side: C.shelf, lip: C.lip, mat: 'plaster' as const };
  const FL = new Frame(-W / 2, -0.6, Math.PI / 2), FR = new Frame(W / 2, -0.6, -Math.PI / 2);
  shelves(R, FL, left, b, { ...SH, levels: left.length > 5 ? [0.8, 1.5] : [1.1] });
  awning(R, FL, -2.0, 2.0, 2.45, 0.75, C.awn1, C.awn2);
  K.sign('Свежее!', FL.x(0, 0.12), 2.75, FL.z(0, 0.12), 1.3, FL.face, { bg: '#3f8f8a', fg: '#fff3dc' });
  if (right.length) {
    shelves(R, FR, right, b, { ...SH, levels: right.length > 5 ? [0.8, 1.5] : [1.1] });
    awning(R, FR, -2.0, 2.0, 2.45, 0.75, C.awn3, C.awn2);
  } else {
    // right wall: a produce stand — crates of fruit under an awning, sacks, barrels, a basket tower
    awning(R, FR, -2.2, 2.2, 2.45, 0.75, C.awn3, C.awn2);
    K.sign('Фрукты · Овощи', FR.x(0, 0.12), 2.75, FR.z(0, 0.12), 1.7, FR.face, { bg: '#e0504a', fg: '#fff3dc' });
    for (let i = 0; i < 4; i++) {
      const lx = -1.65 + i * 1.1, x = FR.x(lx, 0.4), z = FR.z(lx, 0.4);
      // tilted display crate on legs
      K.box('wood', '#b07a4a', x - 0.32, x + 0.32, 0, 0.5, z - 0.5, z + 0.5);
      K.box('wood', '#d9a066', x - 0.34, x + 0.34, 0.5, 0.62, z - 0.52, z + 0.52);
      const fc = FRUIT[i % FRUIT.length], fc2 = FRUIT[(i + 3) % FRUIT.length];
      for (let k = 0; k < 9; k++) K.ball('back', k % 4 === 3 ? fc2 : fc, x - 0.2 + (k % 3) * 0.2, 0.68 + Math.floor(k / 3) * 0.02, z - 0.3 + Math.floor(k / 3) * 0.3, 0.1, 0.9);
      K.sign(['Яблоки', 'Груши', 'Лимоны', 'Сливы'][i], FR.x(lx, 0.86), 0.36, FR.z(lx, 0.86), 0.55, FR.face, { bg: '#2a3a2e', fg: '#fff3dc' });
      K.solid(x - 0.35, x + 0.35, z - 0.53, z + 0.53, 0.7);
    }
    sack(K, W / 2 - 0.5, 2.0, '#d8c08a'); sack(K, W / 2 - 0.45, 2.55, '#c8b07a', 0.85); sack(K, W / 2 - 0.9, 2.3, '#e0c89a', 0.7);
    K.solid(W / 2 - 1.15, W / 2, 1.7, 2.85, 0.65);
  }
  // counter (painted blue, cloth, potions and materials on it)
  const CF = new Frame(0, -D / 2, 0);
  counter(R, CF, -1.9, 1.9, 1.9, 2.5, C.counter, C.counterTop);
  cloth(K, -1.9, 1.9, -D / 2 + 1.9, -D / 2 + 2.5, COUNTER_TOP + 0.001, '#e0504a', 0.16, '#fff3dc');
  const onCounter = [...potions, ...mats].slice(0, 6), n = onCounter.length;
  onCounter.forEach((it, i) => {
    const lx = n === 1 ? 0 : -1.5 + 3.0 * (i / (n - 1));
    R.good(it, b, { x: CF.x(lx, 2.2), y: COUNTER_TOP + 0.013, z: CF.z(lx, 2.2), fit: 0.3, fitH: it.slot === 'potion' }, [CF.x(lx, 2.57), COUNTER_TOP - 0.1, CF.z(lx, 2.57), 0, -0.3]);
  });
  // striped awning over the counter on two posts
  for (const x of [-2.15, 2.15]) K.cyl('wood', C.awn2, x, 0, -D / 2 + 2.6, 0.06, 2.55, 8);
  awning(R, new Frame(0, -D / 2 + 1.6, 0), -2.3, 2.3, 2.75, 1.1, C.awn1, C.awn2);
  K.solid(-2.22, -2.08, -D / 2 + 2.53, -D / 2 + 2.67, Infinity); K.solid(2.08, 2.22, -D / 2 + 2.53, -D / 2 + 2.67, Infinity);
  // back wall: shelves of jars, plates, bread, cheese behind the cook
  for (const y of [1.25, 1.85]) {
    K.box('wood', C.shelf, -2.6, 2.6, y - 0.05, y, -D / 2, -D / 2 + 0.35);
    K.box('wood', C.lip, -2.62, 2.62, y - 0.07, y + 0.01, -D / 2 + 0.33, -D / 2 + 0.36);
    for (let i = 0; i < 9; i++) {
      const x = -2.35 + i * 0.58, c = ['#ff9fb2', '#9fe39a', '#ffe27a', '#7fd6e6', '#ffb27a'][(i + (y > 1.5 ? 2 : 0)) % 5];
      if (i % 3 === 1) { if (y > 1.5) K.cyl('back', '#f2ead8', x, y, -D / 2 + 0.18, 0.13, 0.03, 12); else { K.cyl('back', '#ffd84a', x, y, -D / 2 + 0.18, 0.15, 0.1, 12); K.cyl('back', '#f2c43a', x, y + 0.1, -D / 2 + 0.18, 0.12, 0.012, 12); } }
      else { K.cyl('glass', '#e8f4ff', x, y, -D / 2 + 0.18, 0.08, 0.2, 12); K.cyl('back', c, x, y, -D / 2 + 0.18, 0.07, 0.13, 12); K.cyl('back', '#b08a5a', x, y + 0.2, -D / 2 + 0.18, 0.05, 0.04, 8); }
    }
  }
  // bread loaves in a basket on the top shelf ends, a chalkboard menu
  basket(K, -2.3, 1.86, -D / 2 + 0.18, 0.16, ['#d9a066', '#c08040']); basket(K, 2.3, 1.86, -D / 2 + 0.18, 0.16, ['#d9a066', '#e0b070']);
  K.sign('Меню дня', -3.9, 2.05, -D / 2 + 0.05, 1.0, 0, { bg: '#2a3a2e', fg: '#fff3dc', sub: 'уха · пирог · молоко' });
  K.sign('Меню дня', 3.9, 2.05, -D / 2 + 0.05, 1.0, 0, { bg: '#2a3a2e', fg: '#fff3dc', sub: 'сыр · колбаска · мята' });
  // fish garland / bunting over the counter
  for (let i = 0; i < 11; i++) {
    const x = -2.5 + i * 0.5, y = 3.15 - Math.sin((i / 10) * Math.PI) * 0.3, z = -D / 2 + 1.0;
    K.box('back', '#2b1d18', x - 0.25, x + 0.25, y + 0.107, y + 0.122, z - 0.006, z + 0.006);
    if (i % 2) { K.ball('back', ['#8fb6c8', '#ff9a6a', '#c9ccd6'][i % 3], x, y, z, 0.11, 0.42); K.cone('back', '#8fb6c8', x, y - 0.18, z, 0.06, 0.1, true); }
    else K.geo('flat', new THREE.ConeGeometry(0.12, 0.24, 3), new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.02, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), new THREE.Vector3(1, 1, 0.2)), ['#ff8fa3', '#ffcf4a', '#7fb0e8'][i % 3]);
  }
  // produce baskets and crates by the counter and the door
  for (const [x, z, c] of [[-2.75, -2.1, 0], [2.75, -2.1, 2], [-W / 2 + 0.6, 2.2, 4], [-W / 2 + 0.6, 3.0, 1]] as [number, number, number][]) {
    K.box('wood', '#d9a066', x - 0.35, x + 0.35, 0, 0.42, z - 0.3, z + 0.3); K.box('wood', '#b07a4a', x - 0.3, x + 0.3, 0.3, 0.4, z - 0.25, z + 0.25);
    for (let i = 0; i < 6; i++) K.ball('back', i === 4 ? FRUIT[(c + 2) % FRUIT.length] : FRUIT[c % FRUIT.length], x - 0.2 + (i % 3) * 0.2, 0.46, z - 0.1 + Math.floor(i / 3) * 0.2, 0.095, 0.85);
    K.solid(x - 0.35, x + 0.35, z - 0.3, z + 0.3, 0.42);
  }
  basket(K, -2.75, 0.42, -2.1, 0.14, ['#9fe35a']); basket(K, 2.75, 0.42, -2.1, 0.14, ['#ff6a8a']);
  // herbs, garlic, peppers and sausages from the beams
  const hz = [0.2, 1.4];
  for (let i = 0; i < 8; i++) { const x = -3.4 + i * 0.95, z = hz[i % 2]; hanging(K, x, 2.6 + (i % 3) * 0.1, z, H - 0.2, ['#7aaa4a', '#f2ead8', '#e0504a', '#b0443a'][i % 4], (['herb', 'garlic', 'pepper', 'sausage'] as const)[i % 4]); }
  // bunting and a festoon of bulbs under the beams
  bunting(K, -W / 2 + 0.1, H - 0.25, 2.6, W / 2 - 0.1, H - 0.25, 2.6, 16, ['#e0504a', '#ffcf4a', '#3f8f8a', '#ff8fa3', '#7fb0e8'], 0.4);
  stringLights(K, -W / 2 + 0.2, H - 0.3, -0.4, W / 2 - 0.2, H - 0.3, -0.4, 14, undefined, 0.4, 0.55);
  // a little table by the window: stools, mugs, a candle; plants by the door
  K.cyl('wood', '#b07a4a', 2.9, 0, 2.3, 0.08, 0.7, 8); K.cyl('wood', '#d9a066', 2.9, 0.7, 2.3, 0.45, 0.05, 16); K.solid(2.5, 3.3, 1.9, 2.7, 0.75);
  cloth(K, 2.55, 3.25, 1.95, 2.65, 0.751, '#fff3dc', 0.06);
  mug(K, 2.75, 0.763, 2.2); mug(K, 3.05, 0.763, 2.45, '#7fb0e8'); candle(K, 2.9, 0.763, 2.3);
  stool(K, 2.2, 2.4, '#e0504a'); stool(K, 3.5, 1.7, '#3f8f8a');
  potPlant(K, -W / 2 + 0.45, 0, D / 2 - 0.45, 1.1, '#ff8fa3'); potPlant(K, W / 2 - 0.45, 0, D / 2 - 0.45, 1.1, '#ffcf4a');
  K.solid(-W / 2, -W / 2 + 0.7, D / 2 - 0.7, D / 2, 0.6); K.solid(W / 2 - 0.7, W / 2, D / 2 - 0.7, D / 2, 0.6);
  // cook
  R.npc({ seed: 'Лавочница', name: 'Лавочница', x: 0.15, z: -D / 2 + 1.35, y: DAIS, scale: 1.1, face: Math.PI, look: { hat: 'chef', shape: 'bean', color: '#ffb27a', acc: ['scarf'] },
    hello: [`Заходи, {n}! Еда лечит раны, зелья — быстрее.`, 'Свежая килька! Только с лодки.', 'Проголодался? Выбирай с полок!'],
    lines: ['Молочко здоровья — лучшее в городе.', 'Пирог только из печи.', 'Колбаску не нюхать — покупать!'], emote: { anim: 'wave', every: 13 } });
  // window, lamps, door
  K.window('right', 2.3, 1.1, 1.0, 1.2);
  wallLamp(K, -1.5, 2.2, D / 2, Math.PI, { real: 1 }); wallLamp(K, 1.5, 2.2, D / 2, Math.PI);
  wallLamp(K, -W / 2, 2.0, 2.4, Math.PI / 2, { real: 2 });
  wallLamp(K, W / 2, 2.0, -2.9, -Math.PI / 2, { real: 2 });
  K.lantern(-2.4, 3.0, 0.3, H - 0.2); K.lantern(2.4, 3.0, 0.3, H - 0.2);
  K.light(0, 2.4, -D / 2 + 2.2, '#ffd9a0', 6, 7, 0, 3);
  K.splash(0, 1.6, -D / 2 + 0.38, 5.6, 2.4, '#ffcf6a', 0.3);
  K.sign(env.building.title || 'Лавка', 0, 3.25, -D / 2 + 0.08, 2.4, 0, { bg: '#e0504a', fg: '#fff3dc' });
  R.exitDoor();
  R.spawn = { x: 0, z: D / 2 - 0.9, face: 0 };
}
