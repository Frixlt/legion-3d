/**
 * A zombie's one-off speech bubble (same look as the chat bubbles of src/avatar/labels.ts): «Мозги-и-и…» — then the
 * word is crossed out and corrected to «Рыыыбки!» (they are cats, after all). One sprite, one draw call while shown,
 * the canvas is drawn twice per show. No DOM in tests: without `document` it silently does nothing.
 */
import * as THREE from 'three';

const FONT = `"Rubik", "Segoe UI", "Arial", sans-serif`;
const W = 512, H = 256, PX_PER_M = 300;
export const BUBBLE_TIME = 2.6, BUBBLE_FIX = 0.75;

export class ZombieBubble {
  readonly sprite: THREE.Sprite | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private mat: THREE.SpriteMaterial | null = null;
  private t = -1;
  private stage = -1;

  constructor() {
    if (typeof document === 'undefined') return;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(this.mat);
    s.center.set(0.5, 0); s.renderOrder = 11; s.visible = false; s.name = 'combat-bubble';
    s.scale.set(W / PX_PER_M, H / PX_PER_M, 1);
    (this as { sprite: THREE.Sprite | null }).sprite = s;
  }

  get showing(): boolean { return this.t >= 0; }

  show() { if (this.sprite) { this.t = 0; this.stage = -1; } }

  /** Follow the head (world point above it) and advance. */
  update(dt: number, x: number, y: number, z: number) {
    const s = this.sprite;
    if (!s || this.t < 0) return;
    this.t += dt;
    const stage = this.t < BUBBLE_FIX ? 0 : 1;
    if (stage !== this.stage) { this.stage = stage; this.draw(stage); }
    if (this.t > BUBBLE_TIME) { this.t = -1; s.visible = false; return; }
    // pop in with a little overshoot, fade out at the end; bob gently
    const a = Math.min(1, this.t / 0.12), out = Math.min(1, (BUBBLE_TIME - this.t) / 0.3);
    const pop = this.t < 0.25 ? 1 + 0.25 * Math.sin((this.t / 0.25) * Math.PI) : 1;
    const fixPop = this.t > BUBBLE_FIX && this.t < BUBBLE_FIX + 0.2 ? 1 + 0.15 * Math.sin(((this.t - BUBBLE_FIX) / 0.2) * Math.PI) : 1;
    const k = Math.min(a, out) * pop * fixPop;
    s.scale.set((W / PX_PER_M) * k, (H / PX_PER_M) * k, 1);
    s.position.set(x, y + Math.sin(this.t * 5) * 0.02, z);
    this.mat!.opacity = Math.min(a, out);
    s.visible = true;
  }

  hide() { this.t = -1; if (this.sprite) this.sprite.visible = false; }

  private draw(stage: number) {
    const g = this.canvas!.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const tail = 26, bw = 400, bh = stage ? 150 : 104, x0 = (W - bw) / 2, y0 = H - tail - bh - 6, r = 30;
    g.beginPath();
    g.moveTo(x0 + r, y0); g.arcTo(x0 + bw, y0, x0 + bw, y0 + bh, r); g.arcTo(x0 + bw, y0 + bh, x0, y0 + bh, r);
    g.lineTo(W / 2 + 18, y0 + bh); g.lineTo(W / 2 - 6, y0 + bh + tail); g.lineTo(W / 2 - 8, y0 + bh);
    g.arcTo(x0, y0 + bh, x0, y0, r); g.arcTo(x0, y0, x0 + bw, y0, r); g.closePath();
    g.fillStyle = '#f2ffe8'; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#2b1d18'; g.lineJoin = 'round'; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const first = 'Мозги-и-и…';
    if (!stage) {
      g.font = `700 50px ${FONT}`; g.fillStyle = '#3d6b2e'; g.fillText(first, W / 2, y0 + bh / 2 + 2);
    } else {
      g.font = `600 34px ${FONT}`; g.fillStyle = '#8a9a86'; g.fillText(first, W / 2, y0 + 40);
      const tw = g.measureText(first).width;
      g.strokeStyle = '#e8455c'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(W / 2 - tw / 2 - 6, y0 + 42); g.lineTo(W / 2 + tw / 2 + 6, y0 + 36); g.stroke();
      g.font = `800 54px ${FONT}`; g.fillStyle = '#ff7a3d'; g.fillText('Рыыыбки!', W / 2, y0 + 104);
      // a tiny fish doodle
      const fx = x0 + bw - 46, fy = y0 + 104;
      g.fillStyle = '#7fc8ff'; g.strokeStyle = '#2b1d18'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(fx, fy, 18, 10, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(fx + 16, fy); g.lineTo(fx + 28, fy - 9); g.lineTo(fx + 28, fy + 9); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#2b1d18'; g.beginPath(); g.arc(fx - 9, fy - 2, 2.5, 0, Math.PI * 2); g.fill();
    }
    this.tex!.needsUpdate = true;
  }

  dispose() { this.tex?.dispose(); this.mat?.dispose(); this.sprite?.removeFromParent(); }
}
