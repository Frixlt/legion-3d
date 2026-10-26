/**
 * Price tags: one canvas atlas for all goods of a room + one merged quad mesh → a single draw call.
 * A tag shows the good's name (rarity colour), and the price: coins as the site's coin discs (money rule of
 * src/ui/money.ts: only non-zero gold/silver/bronze parts), points as «1 500 б.», a lock, or «на стриме».
 * Redraw a tag with `draw(i, spec)` (hero money changed → red price when not enough).
 */
import * as THREE from 'three';
import { moneyCompact } from '../../ui/money';
import { RARITY_HEX } from './items';

export interface TagSpec {
  name: string; rarity: string;
  /** Coins (bronze) — drawn as coin discs. */
  coins?: number;
  /** Text price instead of coins (points, «на стриме», «🔒», «есть»). */
  text?: string;
  /** Price in red (not enough money). */
  poor?: boolean;
  /** Small second line (stand / class). */
  sub?: string;
  /** Highlighted (the aimed good): gold frame, warm paper. */
  hot?: boolean;
}

const TW = 256, TH = 112, COLS = 4;
const COIN: Record<string, [string, string, string]> = { g: ['#fff1b0', '#f2c14e', '#b8862a'], s: ['#ffffff', '#c8ccd8', '#8a90a4'], b: ['#ffd2a8', '#c07a44', '#7a4424'] };
const FONT = "'Nunito','Comfortaa','Trebuchet MS',sans-serif";
const NUM = "'Russo One','Dela Gothic One','Arial Black',sans-serif";

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export class TagAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  readonly rows: number;
  private quads: { x: number; y: number; z: number; ry: number; w: number; rx: number }[] = [];
  readonly material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh | null = null;

  constructor(readonly n: number) {
    this.rows = Math.max(1, Math.ceil(n / COLS));
    let H = 1; while (H < this.rows * TH) H *= 2;
    this.canvas = document.createElement('canvas');
    this.canvas.width = TW * COLS; this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true; this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
    this.material.color.setScalar(0.92);
    this.material.name = 'room:tags';
  }

  /** Draw tag i. */
  draw(i: number, t: TagSpec): void {
    const g = this.g, x = (i % COLS) * TW, y = Math.floor(i / COLS) * TH;
    const rc = RARITY_HEX[t.rarity] || RARITY_HEX.common;
    g.save(); g.translate(x, y);
    g.clearRect(0, 0, TW, TH);
    // card: ink border, cream paper, rarity band on the left, string hole
    g.fillStyle = t.hot ? '#ffcf4a' : '#2b1d18'; rr(g, 1, 1, TW - 2, TH - 2, 18); g.fill();
    if (t.hot) { g.fillStyle = '#2b1d18'; rr(g, 6, 6, TW - 12, TH - 12, 14); g.fill(); }
    g.fillStyle = t.hot ? '#fff3c4' : '#fbf0dc'; rr(g, t.hot ? 10 : 8, t.hot ? 10 : 8, TW - (t.hot ? 20 : 16), TH - (t.hot ? 20 : 16), 12); g.fill();
    g.fillStyle = rc; rr(g, 8, 8, 16, TH - 16, 8); g.fill(); g.fillRect(16, 8, 8, TH - 16);
    // name
    g.fillStyle = '#2b1d18'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    let fs = 25; g.font = `800 ${fs}px ${FONT}`;
    const maxW = TW - 46;
    const name = t.name;
    const words = name.split(/\s+/);
    let l1 = '', l2 = '';
    for (const w of words) { const tryL = l1 ? l1 + ' ' + w : w; if (!l2 && g.measureText(tryL).width <= maxW) l1 = tryL; else l2 = l2 ? l2 + ' ' + w : w; }
    if (l2) { fs = 21; g.font = `800 ${fs}px ${FONT}`; l1 = ''; l2 = ''; for (const w of words) { const tryL = l1 ? l1 + ' ' + w : w; if (!l2 && g.measureText(tryL).width <= maxW) l1 = tryL; else l2 = l2 ? l2 + ' ' + w : w; } }
    while (l2 && g.measureText(l2).width > maxW && l2.length > 2) l2 = l2.slice(0, -2).trimEnd() + '…';
    if (g.measureText(l1).width > maxW) { while (g.measureText(l1 + '…').width > maxW && l1.length > 2) l1 = l1.slice(0, -1); l1 += '…'; }
    const ny = l2 ? 34 : 42;
    g.fillText(l1, 32, ny);
    if (l2) g.fillText(l2, 32, ny + 22);
    // price
    const py = TH - 20;
    g.textBaseline = 'middle';
    if (t.text != null) {
      g.font = `400 24px ${NUM}`; g.fillStyle = t.poor ? '#c0303a' : '#6a2a5a';
      g.fillText(t.text, 32, py);
    } else {
      const parts = moneyCompact(t.coins || 0);
      let cx = 32;
      for (const [k, v] of parts) {
        const [a, b, c] = COIN[k];
        const gr = g.createRadialGradient(cx + 8, py - 4, 1, cx + 11, py, 13);
        gr.addColorStop(0, a); gr.addColorStop(0.6, b); gr.addColorStop(1, c);
        g.fillStyle = gr; g.beginPath(); g.arc(cx + 11, py, 11, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#2b1d18'; g.lineWidth = 2.5; g.stroke();
        g.font = `400 25px ${NUM}`; g.fillStyle = t.poor ? '#c0303a' : '#2b1d18';
        g.fillText(String(v), cx + 27, py + 1);
        cx += 27 + g.measureText(String(v)).width + 12;
      }
    }
    // hole + string
    g.fillStyle = '#2b1d18'; g.beginPath(); g.arc(TW - 22, 22, 6, 0, Math.PI * 2); g.fill();
    g.restore();
    this.texture.needsUpdate = true;
  }

  /** Add a quad for tag i at (x,y,z) (centre), facing yaw ry (0 = +Z), width w (m), tilt rx. Returns the index. */
  place(x: number, y: number, z: number, ry = 0, w = 0.26, rx = 0): number {
    this.quads.push({ x, y, z, ry, w, rx });
    return this.quads.length - 1;
  }

  /** Build the single mesh of all placed quads (quad k uses tag k). */
  build(): THREE.Mesh {
    const n = this.quads.length, pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx: number[] = [];
    const CW = this.canvas.width, CH = this.canvas.height;
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
    this.quads.forEach((Q, k) => {
      const h = Q.w * TH / TW;
      e.set(Q.rx, Q.ry, 0, 'YXZ'); q.setFromEuler(e);
      const corners = [[-Q.w / 2, -h / 2], [Q.w / 2, -h / 2], [Q.w / 2, h / 2], [-Q.w / 2, h / 2]];
      corners.forEach(([cx, cy], j) => { v.set(cx, cy, 0).applyQuaternion(q); pos.set([Q.x + v.x, Q.y + v.y, Q.z + v.z], k * 12 + j * 3); });
      const tx = (k % COLS) * TW, ty = Math.floor(k / COLS) * TH;
      const u0 = tx / CW, u1 = (tx + TW) / CW, v1 = 1 - ty / CH, v0 = 1 - (ty + TH) / CH;
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], k * 8);
      const o = k * 4; idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals(); g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.name = 'room:tags';
    return this.mesh;
  }

  dispose(): void { this.texture.dispose(); this.material.dispose(); if (this.mesh) this.mesh.geometry.dispose(); }
}
