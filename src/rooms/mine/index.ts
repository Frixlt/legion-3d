/**
 * Mine room (kind 'mine3d'): a real 3D mine driven by our own mine client (net.ts, mirrors the site's mine.js).
 *
 *   import { registerMine } from './rooms/mine';
 *   registerMine(registries.rooms);              // registers 'mine3d'; buildings registry: mine → { room: 'mine3d' }
 *
 * create(ctx): closes the site's own mine if open (one presence per tab), POST /api/mine/enter, builds the cave,
 * registers interactables (front stones, lift, buyer, supplier, board, way down), mounts the HUD and returns the
 * RoomScene (free/groundAt over the cleared cells + entrance area). Keys: E dig / use, L journal,
 * Esc closes a card / the journal. Mine chat lines become bubbles over the miners and lines in the «⛏ Шахта» tab of the
 * bottom-left chat dock (src/ui/chat.ts attachMineChat; posts /api/mine/chat/say — only when the player types and sends). Throws (→ room manager falls back to the site's
 * 2D mine) when the hero has no access to this mine or the game refuses the entry. See docs/MINE.md.
 */
import { setModal } from '../../core/modal';
import * as THREE from 'three';
import type { Unsub } from '../../contracts';
import type { Registry, RoomDef, RoomContext, RoomScene, Interactable } from '../../contracts/ext';
import { MineClient, type MineApi, type MineBus } from './net';
import { MineScene, footM } from './scene';
import { MineHud } from './hud';
import { N_CELLS, REACH, mx, mz, px, py, spawnPt, frontOfObj, cellXY, type Pt } from './geo';
import { TX, blockTitle, gotText } from './state';
import { pickaxeGeo } from './art';
import { attachMineChat } from '../../ui/chat';

export { MineClient } from './net';
export { MineModel } from './state';
export { MineScene } from './scene';

/** Mine id of the current city: district towns have their own mine, the fair (home city) — 'home'. */
export function mineIdOf(layoutId: string | undefined): string { return !layoutId || layoutId === 'fair' ? 'home' : layoutId; }

export interface MineRoomOpts {
  /** Inject a client (dev page / tests with a fake API). */
  client?: MineClient;
  /** Mine id; default from the city layout. */
  c?: string;
  /** Where the HUD goes (default ctx.engine.host). */
  hudHost?: HTMLElement;
}

/** Register the mine room kind. Returns the unregister function. */
export function registerMine(rooms: Registry<RoomDef>): Unsub {
  return rooms.register('mine3d', { title: 'Шахта', create: (ctx) => createMineRoom(ctx) });
}

const NPC_FAR = 2.5 * 128;   // px: the buyer / supplier card closes when you walk this far away (site NPC_FAR)

export async function createMineRoom(ctx: RoomContext, o: MineRoomOpts = {}): Promise<RoomScene> {
  const W = window as any;
  const store = ctx.store, hero = store.hero as any;
  const login = String((store.me && store.me.login) || (hero && hero.login) || '').toLowerCase();
  let c = o.c;
  if (!c) { try { c = mineIdOf(ctx.layout().id); } catch { c = 'home'; } }
  if (!o.client && hero && hero.mn && !hero.mn[c]) throw new Error('Эта шахта закрыта');
  // one presence per tab: the site's own mine must not run at the same time
  try { if (W.LGMine && W.LGMine.on) W.LGMine.close(); } catch { /* */ }
  const api: MineApi = (p, b) => (b === undefined ? ctx.actions.get(p) : ctx.actions.post(p, b));
  const client = o.client || new MineClient({
    api, login, c, bus: (W.__L3D_BUS as MineBus) || null,
    hero: () => store.hero as any, equip: (uid) => ctx.actions.equip(uid), hidden: () => document.hidden,
  });
  const M = client.model;
  const spawn = spawnPt(login);
  let entryErr = '';
  const offErr = client.on((e) => { if (e.type === 'error') entryErr = e.text; });
  const ok = await client.enter(spawn);
  offErr();
  if (!ok || !M.st) { client.close(); throw new Error(entryErr || 'Шахта не открылась'); }

  const style = (ctx.player.app && ctx.player.app.styleId) || 'cats';
  const scene = new MineScene({ quality: ctx.quality(), style, login });
  scene.setView(M);

  // scene fog / background: applied on the first frame (after the room host saved the city's), restored on dispose
  let prevFog: THREE.Scene['fog'] = null, prevBg: THREE.Scene['background'] = null, fogSet = false;
  const applyFog = () => {
    const P = (scene as any).pal; const col = new THREE.Color(P ? P.fog : '#1a1424');
    if (!fogSet) { prevFog = ctx.scene.fog; prevBg = ctx.scene.background; fogSet = true; }
    ctx.scene.fog = new THREE.Fog(col, M.dark ? 3 : 22, M.dark ? 12 : 64); ctx.scene.background = col;
  };
  let fogDark: boolean | null = null;

  /* ---------------------------------------------------------------- HUD */
  const host = o.hudHost || ctx.engine.host;
  let modalOn = false;
  const hud = new MineHud(host, client, {
    stop: () => { void client.stop().then(() => hud.render()); },
    toBuyer: () => hud.open('buy'),
    exit: () => ctx.exit(),
    // every card / the journal / the chat field is a modal on the input's stack: gameplay off, no pointer grab,
    // no «click to return» hint, Esc closes it (src/core/modal.ts)
    modal: (on) => { modalOn = on; setModal(ctx.input, 'mine:card', on, () => hud.close()); },
    journal: (on) => setModal(ctx.input, 'mine:journal', on, () => hud.journal(null)),
    typing: (on) => setModal(ctx.input, 'mine:chat', on),
  });
  // Esc closes an open card / the journal (before the core's «Esc = leave the building» binding sees it);
  // L opens / closes the journal (hero stats, mine log, mine chat)
  const onEsc = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.code === 'Escape' && (hud.card || hud.jr)) { if (hud.card) hud.close(); else hud.journal(null); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'KeyL' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !hud.card && (ctx.input.gameplay || hud.jr)) { hud.journal('toggle'); e.preventDefault(); e.stopImmediatePropagation(); }
  };
  document.addEventListener('keydown', onEsc, true);
  const offKey = () => document.removeEventListener('keydown', onEsc, true);
  hud.render();

  /* ---------------------------------------------------------------- client events */
  // the mine chat is the «⛏ Шахта» tab of the bottom-left chat dock (removed again on dispose); it posts only when the player sends
  const offChatTab = client.chat.on ? attachMineChat({
    lines: () => client.chat.lines,
    on: (fn) => client.on((e) => { if (e.type === 'chat') fn(e.lines); }),
    say: (t) => client.say(t),
    me: () => login,
  }) : () => { /* no mine chat */ };
  const offEv = client.on((e) => {
    if (e.type === 'state') { scene.setView(M); if (e.newFloor) { fogDark = null; refreshBoxes(); } hud.render(); }
    else if (e.type === 'presence' || e.type === 'here' || e.type === 'busy' || e.type === 'other') hud.render();
    else if (e.type === 'tip') hud.tip(e.text, e.bad);
    else if (e.type === 'chat') { for (const l of e.lines) { scene.say(String(l.l).toLowerCase(), l.t); } hud.chatIn(e.lines); }
    else if (e.type === 'error') hud.tip(e.text, true);
    else if (e.type === 'burst') {
      for (const b of e.bursts) {
        scene.burst(b.i, M);
        { const c = cellXY(b.i); window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'mine.break', x: mx(c.cx), y: 0.6, z: mz(c.cy) } })); }
        if (!b.mine) continue;
        const p = cellXY(b.i), cell = M.F && M.F.cells[b.i], g = b.got;
        const text = g && g.loot ? 'Сундук: ' + Object.entries(g.loot).filter(([, v]) => v > 0).map(([k, v]) => gotText(v, k)).join(', ')
          : cell && cell.r && g && g.q > 0 ? gotText(g.q, cell.r) : TX.broke;
        hud.popup(text, mx(p.cx), scene.stoneHeight(b.i) + 0.4, mz(p.cy));
        if (cell && cell.r && g && !(g.q > 0) && g.any) hud.tip(`${TX.done}. ${cell.r ? 'Руда' : ''} досталась другим копавшим (по вкладу) — тебе монеты за работу.`);
        else hud.tip(TX.done);
      }
    }
  });

  /* ---------------------------------------------------------------- interactables */
  const unsubs: Unsub[] = [];
  const boxes: THREE.Box3[] = [];
  const feetPx = (): Pt => ({ x: px(ctx.player.x), y: py(ctx.player.z) });
  const refreshBoxes = () => { for (let i = 0; i < N_CELLS; i++) scene.stoneBox(i, boxes[i]); };
  for (let i = 0; i < N_CELLS; i++) {
    boxes.push(scene.stoneBox(i));
    const it: Interactable = {
      id: 'mine:stone:' + i,
      icon: '⛏',
      get label() {
        const cell = M.F && M.F.cells[i]; if (!cell) return 'Камень';
        if (M.myI === i) return `${TX.doing}: ${blockTitle(cell)}`;
        return `Копать: ${blockTitle(cell)}`;
      },
      hit: boxes[i], reach: 3.4,
      enabled: () => !M.dug[i] && M.isFront(i) && !M.dark && !modalOn,
      use: () => { void digAt(i); },
      // the scene outlines the aimed stone's own shape (scene.update → outlineStone), not the hit box
      highlight: () => { /* drawn by the scene */ },
    } as Interactable;
    unsubs.push(ctx.interact.add(it));
  }
  const digAt = async (i: number) => {
    const f = feetPx(), cc = cellXY(i);
    if (MineClient.distTo(i, f) > REACH) { hud.tip('Подойди к камню вплотную — встань на расчищенную клетку рядом', true); return; }
    await client.dig(i, f, { x: cc.cx, y: cc.cy });
    hud.render();
  };
  const obj = (id: string, box: THREE.Box3 | undefined, label: () => string, use: () => void, reach = 3.2, proximity = true) => {
    if (!box) return;
    unsubs.push(ctx.interact.add({ id: 'mine:' + id, get label() { return label(); }, hit: box, reach, proximity, enabled: () => !modalOn, use }));
  };
  const openNpc = (kind: 'buy' | 'lamp') => {
    if (M.myI >= 0) client.leaveRock();
    client.flushGo();
    npcAt = frontOfObj(kind === 'buy' ? 'buyer' : 'lamp', login); npcOn = false;
    hud.open(kind);
  };
  let npcAt: Pt | null = null, npcOn = false;
  // the lift and the board stand right next to the spawn: aim only (E at the spawn must not leave the mine)
  obj('lift', scene.objBoxes.lift, () => 'В город — подъёмник', () => ctx.exit(), 3.2, false);
  obj('buyer', scene.objBoxes.buyer, () => `${TX.seller} — сдать руду`, () => openNpc('buy'));
  obj('npcBuy', scene.objBoxes.npcBuy, () => `${TX.seller} — сдать руду`, () => openNpc('buy'));
  const supLabel = () => (M.pickOn ? `${TX.sup} — кирки, рудная сумка, каска` : `${TX.lampNpc} — каска шахтёра`);
  obj('lamp', scene.objBoxes.lamp, supLabel, () => openNpc('lamp'));
  obj('npcLamp', scene.objBoxes.npcLamp, supLabel, () => openNpc('lamp'));
  obj('board', scene.objBoxes.board, () => 'Поручения скупщика', () => hud.open('quests'), 3.2, false);
  obj('up', scene.objBoxes.up, () => M.upText() || 'Спуск', () => hud.tip(M.upText()), 4);

  /* ---------------------------------------------------------------- own pickaxe: FP view-model + TP in the paw */
  const pg = pickaxeGeo();
  const fpPick = new THREE.Group(); fpPick.name = 'mine:fpPick';
  const pickMats = [new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: '#b0b6c4', roughness: 0.3, metalness: 0.6, flatShading: true })];
  const fpInner = new THREE.Group(); fpInner.add(new THREE.Mesh(pg.wood, pickMats[0]), new THREE.Mesh(pg.iron, pickMats[1]));
  const paw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: (ctx.player.app && (ctx.player.app.look as any).color) || '#f2e6d8', roughness: 0.9 }));
  paw.position.set(0, 0.02, 0); fpInner.add(paw);
  fpInner.scale.setScalar(0.9);
  fpPick.add(fpInner); fpPick.position.set(0.26, -0.36, -0.5);
  // the swing plane (pick Y-Z) turned towards the crosshair: the striking point (−Z) leads into the target
  fpPick.rotation.y = 0.32; fpPick.visible = false;
  for (const m of fpInner.children) { (m as THREE.Mesh).renderOrder = 10; ((m as THREE.Mesh).material as THREE.Material).depthTest = true; }
  ctx.camera.add(fpPick);
  const tpPick = scene.makePick(); tpPick.visible = false;
  let swingT = 0, digNow = false, vmHidden = false, struck = false;
  const core = ctx as any;

  /* ---------------------------------------------------------------- per frame */
  let lastP: Pt | null = null, stillT = 0, sentStill = false;
  const _proj = new THREE.Vector3();
  const project = (x: number, y: number, z: number): [number, number] | null => {
    _proj.set(x, y, z).project(ctx.camera); if (_proj.z > 1) return null;
    const r = (ctx.engine.renderer.domElement as HTMLCanvasElement).getBoundingClientRect();
    return [(_proj.x * 0.5 + 0.5) * r.width, (-_proj.y * 0.5 + 0.5) * r.height];
  };
  let hudT = 0;
  const feet3 = new THREE.Vector3();
  const offFrame = ctx.onFrame((dt) => {
    const f = feetPx();
    feet3.set(ctx.player.x, ctx.player.y, ctx.player.z);
    // position → game (throttled; final point once standing still)
    const moved = !lastP || Math.hypot(f.x - lastP.x, f.y - lastP.y) > 0.5;
    if (moved) { stillT = 0; sentStill = false; client.moveTo(f.x, f.y); } else { stillT += dt; if (stillT > 0.25 && !sentStill) { sentStill = true; client.moveTo(f.x, f.y, true); } }
    lastP = f;
    // walked away from the own stone → the hero puts the pickaxe down (site leaveRock; the game also stops by go)
    if (M.myI >= 0 && !M.dug[M.myI] && MineClient.distTo(M.myI, f) > REACH + 30) client.leaveRock();
    // NPC card closes when walking away (site npcFar)
    if ((hud.card === 'buy' || hud.card === 'lamp') && npcAt) {
      const d = Math.hypot(f.x - npcAt.x, f.y - npcAt.y);
      if (d <= NPC_FAR) npcOn = true; else if (npcOn) { hud.close(); npcAt = null; }
    }
    // own digging animation
    digNow = M.myI >= 0 && !M.dug[M.myI] && MineClient.distTo(M.myI, f) <= REACH + 30 && !moved;
    const fp = ctx.rig.mode === 'fp';
    fpPick.visible = digNow && fp;
    if (core.vm && typeof core.vm.setVisible === 'function') { const hide = digNow && fp; if (hide !== vmHidden) { vmHidden = hide; core.vm.setVisible(!hide); } }
    if (digNow) {
      // face the stone while digging (TP shows the hero; FP looks where the camera looks)
      if (!fp && core.controller) { const c = cellXY(M.myI), ctl = core.controller(); if (ctl && ctl.setFace) ctl.setFace(Math.atan2(-(mx(c.cx) - ctx.player.x), -(mz(c.cy) - ctx.player.z))); }
      swingT += dt;
      const T = 1.1, k = (swingT % T) / T;
      // the pick meets the stone at the end of the fast strike (k ≈ 0.66): one hit sound per swing
      if (k < 0.5) struck = false;
      else if (!struck && k >= 0.66) { struck = true; const c = cellXY(M.myI); window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'mine.hit', x: mx(c.cx), y: 0.7, z: mz(c.cy) } })); }
      // wind up (0…0.55) then a fast strike (0.55…0.7) and recover
      // raise (head up and back), then a fast strike forward-down, then recover
      const a = k < 0.55 ? 0.15 + k / 0.55 * 0.55 : k < 0.68 ? 0.7 - (k - 0.55) / 0.13 * 1.9 : -1.2 + (k - 0.68) / 0.32 * 1.35;
      fpInner.rotation.set(a, 0, 0.12);
      if (!fp && core.meAv) {
        const bone = MineScene.attachPick(core.meAv.root, tpPick); tpPick.visible = !!bone;
        if (swingT >= T) { swingT -= T; core.meAv.play('swing'); }
      }
      if (fp && swingT >= T) swingT -= T;
    } else { tpPick.visible = false; swingT = 0.4; }
    // HUD: the progress bar and «ещё N мин» move by themselves, re-render twice a second
    hudT += dt; if (hudT > 0.5) { hudT = 0; hud.render(); }
    hud.update(dt, project);
  });

  const roomScene: RoomScene = {
    root: scene.root,
    free: (x, z) => scene.free(M.dug, x, z),
    groundAt: () => 0,
    // look towards the hall portal (the cart would fill the first view straight ahead)
    spawn: { x: mx(spawn.x), z: mz(spawn.y), face: (() => { const e = M.F && M.F.entry >= 0 ? M.F.entry : 80, ex = mx(cellXY(e).cx), ez = mz(cellXY(e).cy); return Math.atan2(-(ex - mx(spawn.x)), -(ez - mz(spawn.y))); })() },
    colliders: scene.colliders,
    update(dt, t, camera) {
      if (fogDark !== M.dark) { fogDark = M.dark; applyFog(); }
      const tg = ctx.interact.target; let aim = -1;
      if (tg && tg.id.startsWith('mine:stone:')) aim = +tg.id.slice(11);
      scene.update(dt, t, camera, M, Date.now(), aim, feet3);
    },
    dispose() {
      offFrame(); offEv(); offChatTab(); offKey(); for (const u of unsubs) u();
      client.close(); hud.dispose();
      if (vmHidden && core.vm) core.vm.setVisible(true);
      fpPick.removeFromParent(); tpPick.removeFromParent();
      for (const m of pickMats) m.dispose(); (paw.material as THREE.Material).dispose(); paw.geometry.dispose();
      scene.dispose();
      if (fogSet) { ctx.scene.fog = prevFog; ctx.scene.background = prevBg; }
    },
  };
  void footM;
  return roomScene;
}
