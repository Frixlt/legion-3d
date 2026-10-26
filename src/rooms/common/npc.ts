/**
 * Room NPCs (shopkeeper, smith, guard…): an avatar from src/avatar with a site-like look, idle life (turns towards the
 * player when near, waves on greeting, occasional emote), and a speech bubble sprite (canvas, redrawn only on change).
 */
import * as THREE from 'three';
import type { Appearance, Look, Gear } from '../../contracts';
import type { Avatar, AvatarKit } from '../../contracts/modules';
import { createAvatarKit, appearanceFrom } from '../../avatar';

export interface NpcDef {
  seed: string; name: string;
  look?: Look; gear?: Gear;
  /** Position (room metres) and facing (Walker.face convention: 0 looks to −Z). */
  x: number; z: number; face: number; y?: number;
  /** Greeting lines ({n} = hero name) and idle lines. */
  hello?: string[]; lines?: string[];
  /** Periodic emote ('swing' for the smith's hammer). */
  emote?: { anim: string; every: number };
  scale?: number;
}

let KIT: AvatarKit | null = null;
const kit = () => (KIT || (KIT = createAvatarKit()));

const _p = new THREE.Vector3();

export class Bubble {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private until = 0;
  private alpha = 0;
  constructor() {
    this.canvas.width = 512; this.canvas.height = 192;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: true, opacity: 0, fog: false });
    this.sprite = new THREE.Sprite(m); this.sprite.name = 'room:bubble';
    this.sprite.scale.set(1.6, 0.6, 1); this.sprite.center.set(0.5, 0); this.sprite.visible = false; this.sprite.renderOrder = 5;
  }
  say(text: string, t: number, ms = 6000): void {
    const g = this.g, W = 512, H = 192;
    g.clearRect(0, 0, W, H);
    g.font = "700 30px 'Nunito','Comfortaa','Trebuchet MS',sans-serif";
    const words = text.split(/\s+/), lines: string[] = [];
    let cur = '';
    for (const w of words) { const tl = cur ? cur + ' ' + w : w; if (g.measureText(tl).width > W - 60 && cur) { lines.push(cur); cur = w; } else cur = tl; }
    if (cur) lines.push(cur);
    const L = lines.slice(0, 3);
    if (lines.length > 3) L[2] = L[2].replace(/.{0,2}$/, '…');
    const bw = Math.min(W - 8, Math.max(...L.map((l) => g.measureText(l).width)) + 48), bh = L.length * 36 + 28, x0 = (W - bw) / 2, y0 = H - bh - 26;
    g.fillStyle = '#2b1d18'; g.beginPath(); g.roundRect(x0 - 4, y0 - 4, bw + 8, bh + 8, 26); g.fill();
    g.beginPath(); g.moveTo(W / 2 - 18, y0 + bh); g.lineTo(W / 2, H - 2); g.lineTo(W / 2 + 18, y0 + bh); g.fill();
    g.fillStyle = '#fff8ec'; g.beginPath(); g.roundRect(x0, y0, bw, bh, 22); g.fill();
    g.beginPath(); g.moveTo(W / 2 - 12, y0 + bh - 2); g.lineTo(W / 2, H - 10); g.lineTo(W / 2 + 12, y0 + bh - 2); g.fill();
    g.fillStyle = '#2b1d18'; g.textAlign = 'center'; g.textBaseline = 'middle';
    L.forEach((l, i) => g.fillText(l, W / 2, y0 + 14 + 18 + i * 36));
    this.tex.needsUpdate = true;
    this.until = t + ms / 1000;
  }
  update(dt: number, t: number): void {
    const want = t < this.until ? 1 : 0;
    this.alpha += (want - this.alpha) * Math.min(1, dt * 6);
    const m = this.sprite.material as THREE.SpriteMaterial;
    m.opacity = this.alpha;
    this.sprite.visible = this.alpha > 0.02;
  }
  dispose(): void { this.tex.dispose(); (this.sprite.material as THREE.Material).dispose(); }
}

export class Npc {
  readonly av: Avatar;
  readonly root = new THREE.Group();
  readonly bubble = new Bubble();
  readonly app: Appearance;
  private face: number;
  private greeted = false;
  private nextEmote: number;
  private nextLine = 0;
  private speed = 0;
  /** Busy with a task (the smith at a real enchant run): keeps its own facing, no idle emotes or idle lines. */
  busy = false;
  constructor(readonly def: NpcDef, styleId: string, private heroName: () => string) {
    this.app = appearanceFrom('npc-' + def.seed, { name: def.name, look: def.look || {}, gear: def.gear || {} }, styleId);
    this.av = kit().create(this.app);
    this.face = def.face;
    this.root.name = 'room:npc:' + def.seed;
    this.root.position.set(def.x, def.y || 0, def.z);
    if (def.scale) this.av.root.scale.setScalar(def.scale);
    this.av.root.rotation.y = def.face;
    this.root.add(this.av.root);
    this.bubble.sprite.position.set(0, (this.av.headTop || 1.4) * (def.scale || 1) + 0.25, 0);
    this.root.add(this.bubble.sprite);
    this.nextEmote = def.emote ? 2 + Math.random() * def.emote.every : Infinity;
  }
  say(text: string, t: number, ms?: number): void { this.bubble.say(text.replace(/\{n\}/g, this.heroName()), t, ms); }
  /** Per frame: turn towards the player when near; greet once; idle lines; emotes. No allocations. */
  update(dt: number, t: number, px: number, pz: number): void {
    const dx = px - this.root.position.x, dz = pz - this.root.position.z, d2 = dx * dx + dz * dz;
    let target = this.def.face;
    if (d2 < 36 && !this.busy) target = Math.atan2(-dx, -dz);   // face convention: 0 looks to −Z
    let da = target - this.face; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    this.face += da * Math.min(1, dt * 3);
    this.av.root.rotation.y = this.face;
    if (!this.greeted && d2 < 49 && this.def.hello && this.def.hello.length) {
      this.greeted = true; this.say(this.def.hello[Math.floor(Math.random() * this.def.hello.length)], t); this.av.play('wave');
      this.nextLine = t + 14 + Math.random() * 8;
    } else if (this.greeted && !this.busy && t > this.nextLine && d2 < 25 && this.def.lines && this.def.lines.length) {
      this.say(this.def.lines[Math.floor(Math.random() * this.def.lines.length)], t, 5000);
      this.nextLine = t + 16 + Math.random() * 12;
    }
    if (t > this.nextEmote && this.def.emote && !this.busy) { this.av.play(this.def.emote.anim); this.nextEmote = t + this.def.emote.every * (0.7 + Math.random() * 0.6); }
    this.speed += (0 - this.speed) * Math.min(1, dt * 4);
    this.av.update(dt, t, this.speed);
    this.bubble.update(dt, t);
  }
  /** World position of the head (for hit boxes). */
  headPos(out = _p): THREE.Vector3 { return out.set(this.root.position.x, this.root.position.y + (this.av.headTop || 1.3) * 0.6, this.root.position.z); }
  dispose(): void { this.av.dispose(); this.bubble.dispose(); }
}
