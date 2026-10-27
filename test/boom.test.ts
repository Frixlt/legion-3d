import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import { BOOM, BoomCooldown, BoomShow, blastImpulse } from '../src/combat/boom';
import { Fx } from '../src/combat/fx';
import { CombatSystem, MAX_RAGDOLLS, type CombatHost } from '../src/combat';
import type { CombatAvatar } from '../src/combat/ragdoll';
import type { CombatRig } from '../src/avatar/avatar';
import type { MineChatSource } from '../src/ui/chat';

let ui: typeof import('../src/ui/chat');
let BOOM_CMD: RegExp;
beforeAll(async () => {
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent ??= () => true;
  ui = await import('../src/ui/chat');
  BOOM_CMD = /^!\s*идея\s+бум!*$/iu;
  // keep the test in step with the feature's own pattern
  const src = (await import('node:fs')).readFileSync(new URL('../src/features/boom.ts', import.meta.url), 'utf8');
  expect(src).toContain(String(BOOM_CMD));
});

describe('«!идея бум»: the command is swallowed, never sent', () => {
  it('matches only the exact command (case, spaces, trailing «!» forgiven)', () => {
    for (const t of ['!идея бум', '!ИДЕЯ БУМ', '  !идея   бум  ', '!идея бум!!', '! идея бум']) expect(BOOM_CMD.test(t.trim())).toBe(true);
    for (const t of ['!идея бумага', 'идея бум', '!идея', '!идея добавить бум', 'бум', '!идеябум', 'привет !идея бум']) expect(BOOM_CMD.test(t.trim())).toBe(false);
  });

  it('a registered command runs locally; the mine chat never calls say() for it, and does for normal lines', async () => {
    const run = vi.fn();
    const off = ui.registerChatCommand(BOOM_CMD, run);
    const say = vi.fn(async (_t: string) => ({ ok: true }));
    const src: MineChatSource = { lines: () => [], on: () => () => {}, say, me: () => 'player1' };
    const m = new ui.MineChatTab(src);
    expect(await m.send('!идея бум')).toEqual({ ok: true });
    expect(await m.send('  !Идея  Бум ')).toEqual({ ok: true });
    expect(say).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
    await m.send('!идея добавить котиков');   // a real suggestion still goes to the site
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith('!идея добавить котиков');
    off();
    // without the feature the line is a normal message again
    expect(ui.runChatCommand('!идея бум')).toBe(false);
  });

  it('runChatCommand: true only for a registered command, and a throwing handler still swallows', () => {
    const off = ui.registerChatCommand(BOOM_CMD, () => { throw new Error('x'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(ui.runChatCommand('!идея бум')).toBe(true);
    expect(ui.runChatCommand('привет')).toBe(false);
    expect(ui.chatCommand('')).toBeNull();
    err.mockRestore(); off();
  });
});

describe('boom: cooldown, impulse, show', () => {
  it('cooldown of 20 s', () => {
    const c = new BoomCooldown();
    expect(BOOM.cooldown).toBe(20);
    expect(c.use(100)).toBe(true);
    expect(c.use(101)).toBe(false);
    expect(c.left(105)).toBe(15);
    expect(c.use(119.9)).toBe(false);
    expect(c.use(120)).toBe(true);
    expect(c.left(120)).toBe(20);
  });

  it('impulse: stronger near the centre, always outward and up', () => {
    const a = blastImpulse(0, 15), b = blastImpulse(7, 15), c = blastImpulse(15, 15);
    expect(a.push).toBeGreaterThan(b.push); expect(b.push).toBeGreaterThan(c.push);
    expect(a.up).toBeGreaterThan(c.up);
    expect(c.push).toBeGreaterThan(0); expect(c.up).toBeGreaterThan(0);
  });

  it('the show bangs exactly once, after the fuse, then ends; particles stay within the pool', () => {
    const fx = new Fx(), s = new BoomShow(), cam = new THREE.PerspectiveCamera();
    s.start(0, 0, 0, 0, 30, 2, false);
    let bangs = 0, bangAt = -1, t = 0;
    while (s.active && t < 10) { if (s.update(fx, 1 / 60)) { bangs++; bangAt = t; } fx.update(1 / 60, cam, 720); t += 1 / 60; }
    expect(bangs).toBe(1);
    expect(bangAt).toBeGreaterThan(BOOM.fuse - 0.05);
    expect(bangAt).toBeLessThan(BOOM.fuse + 0.05);
    expect(t).toBeLessThan(BOOM.len + 0.1);
    expect(fx.count).toBeLessThanOrEqual(700);
    fx.dispose();
  });
});

/** Minimal avatar with the real bone layout (as in test/combat-system.test.ts). */
function fakeAvatar(): CombatAvatar {
  const root = new THREE.Group();
  const rest = [[0, 0, 0], [0, 0.07, 0], [-0.27, 0.62, 0], [0.27, 0.62, 0], [-0.12, 0.11, 0], [0.12, 0.11, 0], [0, 0.2, 0.25], [0, 0.43, 0.42], [0, 0.95, 0.2], [0, 0.5, 0.3], [0.355, 0.445, -0.03]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const parent = [-1, 0, 1, 1, 0, 0, 1, 6, 1, 8, 3];
  const bones = rest.map(() => new THREE.Bone());
  bones.forEach((b, i) => { b.position.copy(rest[i]); if (parent[i] >= 0) { b.position.sub(rest[parent[i]]); bones[parent[i]].add(b); } });
  root.add(bones[0]);
  const rig: CombatRig = { bones, rest, handL: new THREE.Vector3(-0.085, -0.175, -0.03), handR: new THREE.Vector3(0.085, -0.175, -0.03), y0: 0.07, top: 1.2, w: 0.3, depth: 0.9, eyeY: 0.85, ex: 0.11, armY: 0.62, headTop: 1.3, hasTail: true, hasLegs: true };
  return { root, headTop: 1.3, combatRig: () => rig, setFlash() {}, setDizzy() {}, setDraw() {}, hitStop() {}, play() {}, update() {}, setLod() {}, setAlpha() {}, setFirstPerson() {}, setAppearance() {}, dispose() {} } as unknown as CombatAvatar;
}

describe('CombatSystem.blast', () => {
  it('tosses everyone in the radius (more than the usual ragdoll cap), nobody outside it, front-delayed', () => {
    const scene = new THREE.Scene();
    const cats = Array.from({ length: 12 }, (_, i) => { const a = fakeAvatar(); const ang = (i / 12) * Math.PI * 2, d = 1 + (i % 6) * 2.4; a.root.position.set(Math.cos(ang) * d, 0, Math.sin(ang) * d); scene.add(a.root); return a; });
    const far = fakeAvatar(); far.root.position.set(30, 0, 0); scene.add(far.root);
    const me = fakeAvatar(); scene.add(me.root);
    const site = [...cats, far].map((c) => c.root.position.clone());
    const host: CombatHost = {
      scene, camera: new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 100),
      forEachTarget: (fn) => { cats.forEach((c, i) => fn('cat' + i, c)); fn('far', far); },
      env: () => ({ groundAt: () => 0, blocked: () => false }),
      me: { av: me, feet: new THREE.Vector3(), fp: () => false, app: () => ({ login: 'me', name: 'me', styleId: 'cats', look: {}, gear: {} } as never) },
      createAvatar: () => fakeAvatar(), viewHeight: () => 720, quality: () => 2,
    };
    const sys = new CombatSystem(host);
    let t = 0;
    const frame = () => { [...cats, far].forEach((c, i) => { c.root.position.copy(site[i]); c.root.rotation.set(0, 0, 0); }); sys.update(1 / 60, (t += 1 / 60)); };
    frame();
    const n = sys.blast(0, 0, 0, BOOM.radius, BOOM.front);
    expect(n).toBe(12);
    expect(sys.ragdolls.size).toBe(1);          // the nearest at once, the rest when the front reaches them
    expect(sys.blastPending).toBe(11);
    for (let i = 0; i < 40; i++) frame();
    expect(sys.blastPending).toBe(0);
    expect(sys.ragdolls.size).toBeGreaterThan(MAX_RAGDOLLS);
    expect(sys.ragdolls.has('far')).toBe(false);
    for (let i = 0; i < 60 * 12; i++) frame();
    expect(sys.ragdolls.size).toBe(0);
    sys.dispose();
  });
});
