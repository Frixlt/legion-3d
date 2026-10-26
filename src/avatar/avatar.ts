/**
 * Avatar: a skinned instance of a shared model + per-avatar bones, face decal, outline, aura; procedural animation.
 * update() never allocates.
 */
import * as THREE from 'three';
import type { Appearance } from '../contracts';
import type { Avatar } from '../contracts/modules';
import { getModel, releaseModel, B, BONE_COUNT, BONE_PARENT, type ModelData } from './model';
import { faceTexture, facePatch } from './face';
import { toonMat, outlineMat, faceMat, alphaLevel, ALPHA_LEVELS, uTime, auraPointsMat, glowMat, glowSolidMat, type Variant } from './materials';
import { nickExtras, jhash } from './appearance';

/* ------------------------------------------------------------------ aura */
interface AuraDef { color: string; size: number; rise: number; n: number; glow?: string; glowOp?: number; additive?: boolean }
const AURAS: Record<string, AuraDef> = {
  gold: { color: '#ffe9a0', size: 0.05, rise: 1.1, n: 14, glow: '#ffd76a', glowOp: 0.55 },
  sparks: { color: '#fff6c8', size: 0.07, rise: 1.0, n: 16, glow: '#fff0a8', glowOp: 0.25 },
  shadow: { color: '#c48bff', size: 0.05, rise: 0.9, n: 14, glow: '#2a0f44', glowOp: 0.7, additive: false },
  frost: { color: '#e6f7ff', size: 0.06, rise: 0.9, n: 14, glow: '#8fd4ff', glowOp: 0.5 },
  halo: { color: '#fff3b0', size: 0.04, rise: 0.6, n: 6, glow: '#fff3b0', glowOp: 0.25 },
  wisps: { color: '#9fffd0', size: 0.08, rise: 0.8, n: 8 },
  leaves: { color: '#ffb04a', size: 0.06, rise: -0.9, n: 10 },
  haunt: { color: '#b8c4d8', size: 0.1, rise: 0.4, n: 10, glow: '#5a6a88', glowOp: 0.4, additive: false },
};
const auraGeoCache = new Map<string, THREE.BufferGeometry>();
function auraGeo(n: number, r: number, h: number, key: string): THREE.BufferGeometry {
  let g = auraGeoCache.get(key);
  if (g) return g;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  let s = jhash(key) || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5, rr = r * (0.8 + rnd() * 0.5);
    pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = rnd() * h * 0.4; pos[i * 3 + 2] = Math.sin(a) * rr;
    seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd() * 1.2;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, h / 2, 0), h + r);
  auraGeoCache.set(key, g);
  return g;
}
const discGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
const haloGeo = new THREE.TorusGeometry(0.13, 0.016, 6, 28).rotateX(Math.PI / 2);

/* ------------------------------------------------------------------ shared shadow-only material (first person body) */
let hiddenMat: THREE.MeshBasicMaterial | null = null;
const hidden = () => (hiddenMat ||= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));

/* ------------------------------------------------------------------ emotes */
const EMOTE_LEN: Record<string, number> = { wave: 1.6, cheer: 1.4, equip: 0.8, swing: 0.45, hit: 0.35 };
/** 'jump' holds the in-air pose until 'land' (or this many seconds, if no landing is reported). */
const JUMP_MAX = 2.5, LAND_LEN = 0.32;

class AvatarImpl implements Avatar {
  readonly root = new THREE.Group();
  headTop = 1.35;
  private model: ModelData | null = null;
  private bones: THREE.Bone[] = [];
  private skel: THREE.Skeleton | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private outline: THREE.SkinnedMesh | null = null;
  private face: THREE.Mesh | null = null;
  private low: THREE.Mesh | null = null;
  private auraGroup = new THREE.Group();
  private auraHalo: THREE.Mesh | null = null;
  private app!: Appearance;
  private lod: 0 | 1 | 2 = 0;
  private alpha = 1; private lvl = ALPHA_LEVELS;
  private fp = false;
  private phase = 0; private walk = 0; private seedT = 0;
  private emote = ''; private emoteT = 0;
  /** Jump state: time since take-off (-1 = on the ground) and since landing (-1 = no landing squash). */
  private jumpT = -1; private landT = -1;
  private restY: number[] = [];

  constructor(app: Appearance) {
    this.root.name = 'avatar';
    this.auraGroup.name = 'aura';
    this.setAppearance(app);
  }

  setAppearance(app: Appearance): void {
    this.app = app;
    const prev = this.model;
    const m = getModel(app);
    if (prev) releaseModel(prev);
    this.model = m;
    this.seedT = (jhash(app.login) % 1000) / 1000 * 10;
    this.headTop = m.headTop;
    this.rebuild();
  }

  private variant(): Variant { return this.app.ghost ? 'g' : 'n'; }

  private rebuild() {
    const m = this.model!;
    // clear old scene objects (geometries/materials are shared → no dispose)
    if (this.mesh) { this.root.remove(this.mesh); this.mesh = null; }
    if (this.outline) { this.root.remove(this.outline); this.outline = null; }
    if (this.low) { this.root.remove(this.low); this.low = null; }
    this.skel?.dispose();
    this.auraGroup.clear(); this.root.remove(this.auraGroup); this.auraHalo = null;

    // bones
    const rest = m.rig.rest;
    this.bones = [];
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = new THREE.Bone(); b.name = 'b' + i;
      const par = BONE_PARENT[i];
      b.position.copy(rest[i]); if (par >= 0) b.position.sub(rest[par]);
      this.bones.push(b);
      if (par >= 0) this.bones[par].add(b);
    }
    this.restY = this.bones.map((b) => b.position.y);
    const inv = rest.map((r) => new THREE.Matrix4().makeTranslation(-r.x, -r.y, -r.z));
    this.skel = new THREE.Skeleton(this.bones, inv);

    const v = this.variant();
    const mesh = new THREE.SkinnedMesh(m.geo, toonMat(v, this.lvl));
    mesh.add(this.bones[0]);
    mesh.bind(this.skel, new THREE.Matrix4());
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), m.radius);
    mesh.castShadow = true;
    mesh.name = 'avatar-body';
    this.mesh = mesh;
    this.root.add(mesh);

    const ol = new THREE.SkinnedMesh(m.geo, outlineMat(v, this.lvl));
    ol.bind(this.skel, new THREE.Matrix4());
    ol.boundingSphere = mesh.boundingSphere;
    ol.name = 'avatar-outline';
    this.outline = ol;
    this.root.add(ol);

    // face decal follows the body bone
    const ex = nickExtras(this.app.login, this.app.styleId);
    void ex;
    const fk = m.faceKey.split('|');
    const tex = faceTexture({ eyes: fk[0], mouth: fk[1], blush: fk[2] === '1', iris: +fk[3], style: fk[4], narrow: fk[5] === '1', ghost: fk[6] === '1' });
    const face = new THREE.Mesh(facePatch(m.dims, m.key), faceMat(tex, m.faceKey, v, this.lvl));
    face.position.y = -rest[B.body].y;
    face.renderOrder = 1;
    face.name = 'avatar-face';
    this.face = face;
    this.bones[B.body].add(face);

    // LOD2 static mesh
    const low = new THREE.Mesh(m.low, toonMat(v, this.lvl));
    low.visible = false; low.name = 'avatar-low';
    this.low = low;
    this.root.add(low);

    // aura
    const kind = this.app.look.aura;
    const def = kind ? AURAS[kind] : undefined;
    if (def) {
      const r = m.dims.w + 0.12, h = m.headTop;
      const pts = new THREE.Points(auraGeo(def.n, r, h, `${kind}|${r.toFixed(2)}`), auraPointsMat(kind!, def.color, def.size, def.rise));
      pts.frustumCulled = true;
      this.auraGroup.add(pts);
      if (def.glow) {
        const disc = new THREE.Mesh(discGeo, glowMat(def.glow, def.glowOp ?? 0.4, def.additive !== false));
        disc.scale.setScalar(r * 1.7); disc.position.y = 0.02; disc.renderOrder = -1;
        this.auraGroup.add(disc);
      }
      if (kind === 'halo') {
        const halo = new THREE.Mesh(haloGeo, glowSolidMat('#ffe27a'));
        halo.position.y = m.headTop + 0.08;
        this.auraHalo = halo;
        this.auraGroup.add(halo);
      }
      this.root.add(this.auraGroup);
    }
    this.applyState();
  }

  private applyState() {
    const v = this.variant(), lod = this.lod, fp = this.fp;
    const vis = this.lvl > 0;
    if (this.mesh && this.model) {
      this.mesh.visible = vis && lod < 2; this.mesh.material = fp ? hidden() : toonMat(v, this.lvl);
      const g = lod === 1 && !fp ? this.model.mid : this.model.geo;
      if (this.mesh.geometry !== g) this.mesh.geometry = g;
    }
    if (this.outline) this.outline.visible = vis && lod === 0 && !fp;
    if (this.face && this.model) {
      this.face.visible = vis && lod < 2 && !fp;
      const fk = this.model.faceKey.split('|');
      this.face.material = faceMat(faceTexture({ eyes: fk[0], mouth: fk[1], blush: fk[2] === '1', iris: +fk[3], style: fk[4], narrow: fk[5] === '1', ghost: fk[6] === '1' }), this.model.faceKey, v, this.lvl);
    }
    if (this.low) { this.low.visible = vis && lod === 2 && !fp; this.low.material = toonMat(v, this.lvl); }
    this.auraGroup.visible = vis && lod === 0 && !fp;
  }

  update(dt: number, t: number, speed01: number): void {
    uTime.value = t;
    const bones = this.bones;
    if (!bones.length) return;
    // smooth the walk amount; advance the gait phase with speed
    const target = Math.min(1.6, Math.max(0, speed01));
    this.walk += (target - this.walk) * Math.min(1, dt * 8);
    const w = Math.min(1, this.walk), run = Math.max(0, this.walk - 1);
    this.phase += dt * (6.5 + run * 4) * Math.min(1, this.walk * 2.5);
    const ph = this.phase, tt = t + this.seedT;
    const ghost = !!this.app.ghost || !this.model!.hasLegs;

    if (this.lod === 2) {   // impostor-like low mesh: a cheap bob only
      if (this.low) this.low.position.y = Math.abs(Math.sin(ph)) * 0.04 * w + (ghost ? 0.05 + Math.sin(tt * 2) * 0.03 : 0);
      return;
    }
    const body = bones[B.body], armL = bones[B.armL], armR = bones[B.armR], legL = bones[B.legL], legR = bones[B.legR];
    const s = Math.sin(ph), c = Math.cos(ph);
    // body: bob (two bumps per stride), sway, breathing
    const breathe = Math.sin(tt * 2.2) * 0.012 * (1 - w);
    // waddle: hop on every step, roll towards the planted foot, squash a little on contact
    const hop = Math.abs(s), contact = 1 - hop;
    body.position.y = this.restY[B.body] + hop * (0.055 + run * 0.035) * w + (ghost ? 0.06 + Math.sin(tt * 2) * 0.035 : 0);
    body.rotation.z = s * 0.1 * w + Math.sin(tt * 0.9) * 0.015 * (1 - w);
    body.rotation.x = -0.07 * w - run * 0.12;
    body.rotation.y = s * 0.07 * w;
    const sq = contact * contact * 0.045 * w;
    body.scale.set(1 - breathe * 0.5 + sq * 0.5, 1 + breathe - sq, 1 - breathe * 0.5 + sq * 0.5);
    // legs
    legL.rotation.x = s * (0.95 + run * 0.2) * w; legR.rotation.x = -s * (0.95 + run * 0.2) * w;
    legL.position.y = this.restY[B.legL] + Math.max(0, -c) * 0.075 * w;
    legR.position.y = this.restY[B.legR] + Math.max(0, c) * 0.075 * w;
    // arms: swing opposite to legs, idle sway outward
    const idle = Math.sin(tt * 1.6) * 0.06 * (1 - w);
    // the shield arm swings less (the shield stays in front, clear of a cape)
    armL.rotation.set(-s * (this.app.gear.s ? 0.45 : 0.85) * w, 0, -0.22 - idle - hop * 0.12 * w);
    armR.rotation.set(s * 0.85 * w, 0, 0.22 + idle + hop * 0.12 * w);
    if (this.app.gear.w) armR.rotation.x += 0.25;   // holding a weapon a bit forward
    if (this.app.gear.s) armL.rotation.x += 0.35;
    // tail
    if (this.model!.hasTail) {
      // stiff, perky tail: a slow sway when idle, a small counter-swing with the waddle
      bones[B.tail1].rotation.z = Math.sin(tt * 1.6) * 0.1 * (1 - w) - s * 0.12 * w;
      bones[B.tail1].rotation.x = -0.08 * w + Math.sin(tt * 1.1) * 0.03;
      bones[B.tail2].rotation.z = Math.sin(tt * 1.6 - 0.7) * 0.12 * (1 - w) - s * 0.08 * w;
    }
    // cape: drag back with speed, flutter
    if (this.model!.hasCape) {
      // negative x rotation swings the hem backwards (+Z), away from the body; a cat's tail rises right behind
      // a (shorter) cape, so the drag is smaller there and the cloth never cuts through the tail
      const k = this.model!.hasTail ? 0.45 : 1;
      bones[B.cape1].rotation.x = -k * (0.1 * w + run * 0.22) - Math.abs(Math.sin(tt * 3.1)) * 0.02;
      bones[B.cape2].rotation.x = -k * (0.26 * w + run * 0.32) - Math.abs(Math.sin(tt * 5.3 + 0.6)) * (0.04 + 0.07 * w) * k;
      bones[B.cape2].rotation.z = Math.sin(tt * 2.3) * 0.05;
    }
    // emotes override arms
    if (this.emote) {
      this.emoteT += dt;
      const len = EMOTE_LEN[this.emote] || 1, k = this.emoteT / len;
      if (k >= 1) this.emote = '';
      else {
        const env = Math.min(1, k * 6, (1 - k) * 6);
        switch (this.emote) {
          case 'wave':
            armR.rotation.set(0.1, 0, 0.18 + env * (2.5 + Math.sin(this.emoteT * 14) * 0.35));
            break;
          case 'cheer': {
            const hop = Math.abs(Math.sin(k * Math.PI * 3));
            armL.rotation.set(0, 0, -0.18 - env * 2.6); armR.rotation.set(0, 0, 0.18 + env * 2.6);
            body.position.y += hop * 0.1 * env;
            break;
          }
          case 'equip':
            armR.rotation.set(env * 1.6, 0, 0.18 - env * 0.6);
            armL.rotation.set(env * 1.2, 0, -0.18 + env * 0.4);
            break;
          case 'swing': case 'hit': {
            // wind up then strike down-forward
            const a = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
            const strike = k < 0.35 ? -a * 1.0 : 2.0 * Math.sin(Math.min(1, (k - 0.35) / 0.3) * Math.PI / 2) * (1 - Math.max(0, (k - 0.65) / 0.35));
            armR.rotation.set(0.25 + (k < 0.35 ? 2.4 * a : 2.4 - strike * 0.2 - (k - 0.35) * 3.2), 0, 0.18 + 0.3 * env);
            body.rotation.y += (k < 0.35 ? 0.25 * a : -0.25 * (1 - k)) ;
            break;
          }
        }
      }
    }
    // jump: squash → stretch on take-off, legs tucked and arms up in the air; landing: squash and settle
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const jt = this.jumpT;
      if (jt > JUMP_MAX) this.jumpT = -1;
      else {
        let sy: number;
        if (jt < 0.08) sy = 1 - 0.16 * Math.sin((jt / 0.08) * Math.PI / 2);                     // crouch
        else if (jt < 0.22) sy = 0.84 + 0.32 * Math.sin(((jt - 0.08) / 0.14) * Math.PI / 2);   // spring up
        else sy = 1.16 - 0.12 * Math.min(1, (jt - 0.22) / 0.25);                                 // relax to 1.04
        const sxz = 1 / Math.sqrt(sy);
        body.scale.set(body.scale.x * sxz, body.scale.y * sy, body.scale.z * sxz);
        const tuck = Math.min(1, Math.max(0, (jt - 0.08) / 0.12));
        legL.rotation.x = -0.75 * tuck; legR.rotation.x = -0.55 * tuck;
        legL.position.y = this.restY[B.legL] + 0.07 * tuck; legR.position.y = this.restY[B.legR] + 0.06 * tuck;
        if (!this.emote) {
          armL.rotation.set(-0.3 * tuck + (this.app.gear.s ? 0.35 : 0), 0, -0.22 - 0.9 * tuck);
          armR.rotation.set(-0.3 * tuck + (this.app.gear.w ? 0.25 : 0), 0, 0.22 + 0.9 * tuck);
        }
        if (this.model!.hasTail) bones[B.tail1].rotation.x += 0.25 * tuck;
        if (this.model!.hasCape) { bones[B.cape1].rotation.x -= 0.15 * tuck; bones[B.cape2].rotation.x -= 0.3 * tuck; }
      }
    }
    if (this.landT >= 0) {
      this.landT += dt;
      const lt = this.landT / LAND_LEN;
      if (lt >= 1) this.landT = -1;
      else {
        const sq = Math.sin(Math.min(1, lt * 2.5) * Math.PI / 2) * (1 - lt) * (1 - lt);   // fast in, eased out
        const sy = 1 - 0.2 * sq + 0.05 * Math.sin(lt * Math.PI * 2) * (1 - lt), sxz = 1 / Math.sqrt(sy);
        body.scale.set(body.scale.x * sxz, body.scale.y * sy, body.scale.z * sxz);
        body.position.y -= 0.03 * sq;
        if (!this.emote) { armL.rotation.z -= 0.35 * sq; armR.rotation.z += 0.35 * sq; }
      }
    }
    if (this.auraHalo) this.auraHalo.position.y = this.model!.headTop + 0.08 + Math.sin(tt * 2.8) * 0.02 + Math.abs(s) * 0.04 * w;
  }

  setAlpha(a: number): void {
    this.alpha = a;
    const lvl = alphaLevel(a);
    if (lvl === this.lvl) return;
    this.lvl = lvl;
    this.applyState();
  }

  setLod(l: 0 | 1 | 2): void {
    if (l === this.lod) return;
    this.lod = l;
    this.applyState();
  }

  setFirstPerson(on: boolean): void {
    if (on === this.fp) return;
    this.fp = on;
    this.applyState();
  }

  play(anim: string): void {
    // jump / land are body states, not arm emotes: they combine with a wave or a swing
    if (anim === 'jump') { this.jumpT = 0; this.landT = -1; return; }
    if (anim === 'land') { this.jumpT = -1; this.landT = 0; return; }
    this.emote = anim in EMOTE_LEN ? anim : 'wave';
    this.emoteT = 0;
  }

  dispose(): void {
    if (this.model) releaseModel(this.model);
    this.model = null;
    this.skel?.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}

export function createAvatar(app: Appearance): Avatar { return new AvatarImpl(app); }
