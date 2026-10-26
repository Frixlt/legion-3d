/**
 * Make the offline demo (dist-dev/game.html) camera-ready: friendly made-up names for the hero and the bots,
 * fixed quality 3 at full resolution, no dynamic-resolution governor drift, nameplates on.
 * Runs once per segment right after the game booted (before the segment's own setup).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import type { G } from './kit';

export const HERO_NAME = 'Пушок';
export const BOT_NAMES = ['Мурка', 'Барсик', 'Рыжик', 'Снежка', 'Тиша', 'Дымок', 'Маркиза', 'Персик', 'Уголёк', 'Луна',
  'Кекс', 'Пломбир', 'Мята', 'Тимофей', 'Ириска', 'Филя', 'Соня', 'Шнурок', 'Ватрушка', 'Бублик', 'Злата', 'Пряник', 'Муся', 'Граф'];

let done = false;
export function setupDemo(G: G): void {
  if (done) return; done = true;
  const { g, store, demo } = G;
  // quality: fixed 3, governor locked, scale 1 (virtual time reports a perfect 16.7 ms anyway)
  try { g.engine.setQuality(3); } catch { /* */ }
  // names
  if (demo?.hero) {
    demo.hero.name = HERO_NAME;
    try { store.setHero(structuredClone(demo.hero)); } catch { /* */ }
  }
  if (store.me) store.me.app = { ...store.me.app, name: HERO_NAME };
  const bots: any[] = demo?.bots || [];
  const L = store.layout;
  bots.forEach((b, i) => {
    b.app = { ...b.app, name: BOT_NAMES[i % BOT_NAMES.length] };
    // deterministic start (they wandered for a machine-dependent time during the boot)
    if (L?.nearest) { const [x, y] = L.nearest(L.QW + 200 + Math.random() * 2600, 850 + Math.random() * 600); b.x = x; b.y = y; }
    b.face = Math.random() * 6.28; b.path = null; b.wait = Math.random() * 3; b.speed = 0; b.bubble = undefined;
  });
  store.emit('walkers');
  // the chat log: drop what the bots said during the boot, start from a few friendly lines
  try { store.deleteChat(store.chat.map((m: any) => m.id)); } catch { /* */ }
  const SEED = [[3, 'всем привет! кто на ярмарку?'], [6, 'у кузнеца скидки на заточку'], [11, 'вечером поход, собираемся у ворот'], [14, 'мур 😺']] as const;
  store.pushChat(SEED.map(([i, text], k) => ({ id: 'seed' + k, login: bots[i]?.login || 'bot', name: bots[i]?.app.name || 'Котик', text, at: Date.now() - (SEED.length - k) * 40000, kind: 'g' })));
  patchActions(G);
  // record every interactable (rooms add theirs on creation) so shots can aim at goods / stones by id
  const I = g.interact, add0 = I.add.bind(I);
  I.add = (it: any) => { inters.set(it.id, it); const off = add0(it); return () => { inters.delete(it.id); off(); }; };
}

/** Interactables registered since setupDemo (id → Interactable). */
export const inters = new Map<string, any>();
/** World-space centre of an interactable's hit volume. */
export function hitCentre(it: any): [number, number, number] | null {
  const h = it?.hit; if (!h) return null;
  if (h.isBox3) { return [(h.min.x + h.max.x) / 2, (h.min.y + h.max.y) / 2, (h.min.z + h.max.z) / 2]; }
  if (h.isObject3D) { h.updateWorldMatrix(true, true); const b = new THREE.Box3().setFromObject(h); if (b.isEmpty()) { const e = h.matrixWorld.elements; return [e[12], e[13], e[14]]; } const c = b.getCenter(new THREE.Vector3()); return [c.x, c.y, c.z]; }
  return null;
}

/** Bot by index (stable: bots are created in order with a seeded Math.random). */
export const bot = (G: G, i: number): any => (G.demo?.bots || [])[i] || null;

/** Park a bot at a px point facing `face`, idle for `hold` seconds (it wanders again afterwards). */
export function park(G: G, i: number, x: number, y: number, face = 0, hold = 999): void {
  const b = bot(G, i); if (!b) return;
  b.x = x; b.y = y; b.face = face; b.path = null; b.wait = hold; b.speed = 0;
}
/** Send a bot walking to a px point (straight line; the demo's own tick moves it at walking speed). */
export function send(G: G, i: number, x: number, y: number, hold = 999): void {
  const b = bot(G, i); if (!b) return;
  b.path = [[x, y]]; b.wait = hold;
}
/** A chat line from a bot (chat panel + bubble over the head). */
let chatN = 0;
export function say(G: G, i: number, text: string, ms = 4200): void {
  const b = i < 0 ? G.store.me : bot(G, i); if (!b) return;
  const id = 'v' + ++chatN;
  G.store.pushChat([{ id, login: b.login, name: b.app.name, text, at: Date.now(), kind: 'g' }]);
  b.bubble = { text, until: Date.now() + ms, id };
}

/* ------------------------------------------------------------------ offline backends for the 3D rooms */
import stockJson from '../../../test/fixtures/stock.json';
import mineEnter from '../../../test/fixtures/mine-enter.json';
import { FakeMine, makeBus } from '../../../src/rooms/mine/fake';
import { setStockCache } from '../../../src/rooms/common/stock';

let fakeMine: FakeMine | null = null;
let patched = false;
/** Shop stock (fixture) for the shop3d rooms + route /api/mine/* to the offline FakeMine once enableMine() ran. */
export function patchActions(G: G): void {
  if (patched) return; patched = true;
  const A = G.ctx.actions, get0 = A.get.bind(A), post0 = A.post.bind(A);
  try { setStockCache(stockJson as any); } catch { /* */ }
  A.get = async (p: string) => {
    if (p.startsWith('/api/city/stock')) return structuredClone(stockJson);
    if (p === '/api/me') return { ok: true, ench: { coins: { star: 300, sphere: 900 } } };
    if (fakeMine && p.startsWith('/api/mine')) return fakeMine.api(p);
    return get0(p);
  };
  A.post = async (p: string, b: unknown) => {
    if (fakeMine && (p.startsWith('/api/mine') || p === '/api/equip')) return fakeMine.api(p, b);
    return post0(p, b);
  };
}
/** Start the offline mine (call before rooms.enter('mine')). digSec: seconds per stone. */
export function enableMine(G: G, digSec = 2.5): void {
  if (fakeMine) return;
  const bus = makeBus();
  (window as any).__L3D_BUS = bus;
  const hero = G.store.hero;
  fakeMine = new FakeMine({ login: String(hero.login), enter: structuredClone(mineEnter as any), hero, bus, digSec, bots: true });
  // fresh stones: nobody is digging yet, so ours breaks in digSec seconds on camera
  (fakeMine.st as any).bl = {}; (fakeMine.st as any).dg = {};
  bus.on('sse:me', (d: any) => { if (d && d.hero) G.store.setHero(d.hero); });
}
(window as any).__vInter = () => [...inters.values()].map((i) => ({ id: i.id, label: i.label, c: hitCentre(i)?.map((v) => +v.toFixed(2)) }));

/** Move every bot within r px-metres of (x, y) away (to the far side of the street), idle for `hold` s. */
export function clearAround(G: G, x: number, y: number, r = 4.5, hold = 999): void {
  const L = G.store.layout;
  (G.demo?.bots || []).forEach((b: any, i: number) => {
    if (Math.hypot((b.x - x) * 0.01, (b.y - y) * 0.02) > r) return;
    const nx = x + (i % 2 ? 1 : -1) * (700 + (i % 5) * 120), ny = y + ((i % 3) - 1) * 60;
    const p = L?.nearest ? L.nearest(nx, ny) : [nx, ny];
    b.x = p[0]; b.y = p[1]; b.path = null; b.wait = hold; b.speed = 0;
  });
}
