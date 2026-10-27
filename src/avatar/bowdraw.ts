/**
 * Third-person bow draw overlay: the drawn string (two straight segments from the bow tips to the nock) and the
 * nocked arrow, one small dynamic mesh (one draw call, only while drawing). It lives in the BODY bone's space; the
 * avatar's own straight string (bone B.bowString) is collapsed meanwhile. update() never allocates.
 */
import * as THREE from 'three';

const STR = new THREE.Color('#ff5a7a'), SHAFT = new THREE.Color('#d9a96a'), HEAD = new THREE.Color('#e4ecf2'), FLETCH = new THREE.Color('#ff86a8');
const QUADS = 12;   // string 2 × 2, shaft 2, head 2, fletching 2 × 2

const _d = new THREE.Vector3(), _o1 = new THREE.Vector3(), _o2 = new THREE.Vector3();
const _ad = new THREE.Vector3(), _tip = new THREE.Vector3(), _hb = new THREE.Vector3(), _f0 = new THREE.Vector3(), _f1 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0);

export class BowDraw {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(QUADS * 4 * 3);
  private q = 0;
  /** The arrow head point (parent space) of the last set() with an arrow. */
  readonly tip = new THREE.Vector3();
  hasArrow = false;

  constructor() {
    const geo = new THREE.BufferGeometry();
    const col = new Float32Array(QUADS * 4 * 3), idx: number[] = [];
    const colors = [STR, STR, STR, STR, SHAFT, SHAFT, HEAD, HEAD, FLETCH, FLETCH, FLETCH, FLETCH];
    for (let i = 0; i < QUADS; i++) {
      for (let v = 0; v < 4; v++) colors[i].toArray(col, (i * 4 + v) * 3);
      const o = i * 4; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = 'avatar-bowdraw';
  }

  /** Two crossed quads along p→q (widths w0 at p, w1 at q). */
  private seg(p: THREE.Vector3, q: THREE.Vector3, w0: number, w1: number) {
    _d.subVectors(q, p).normalize();
    _o1.crossVectors(_d, Math.abs(_d.y) < 0.9 ? _up : _x).normalize();
    _o2.crossVectors(_d, _o1).normalize();
    this.quad(p, q, _o1, w0, w1);
    this.quad(p, q, _o2, w0, w1);
  }
  private quad(p: THREE.Vector3, q: THREE.Vector3, o: THREE.Vector3, w0: number, w1: number) {
    const b = this.q * 12, P = this.pos;
    P[b] = p.x - o.x * w0; P[b + 1] = p.y - o.y * w0; P[b + 2] = p.z - o.z * w0;
    P[b + 3] = p.x + o.x * w0; P[b + 4] = p.y + o.y * w0; P[b + 5] = p.z + o.z * w0;
    P[b + 6] = q.x - o.x * w1; P[b + 7] = q.y - o.y * w1; P[b + 8] = q.z - o.z * w1;
    P[b + 9] = q.x + o.x * w1; P[b + 10] = q.y + o.y * w1; P[b + 11] = q.z + o.z * w1;
    this.q++;
  }

  /**
   * String ends `top`/`bottom`, the nock and the grip (the arrow rests there), all in the mesh's parent space;
   * `s` = bow scale (sizes).
   */
  set(top: THREE.Vector3, bottom: THREE.Vector3, nock: THREE.Vector3, grip: THREE.Vector3, s: number, arrow = true) {
    this.q = 0;
    this.seg(top, nock, 0.006 * s, 0.006 * s);
    this.seg(nock, bottom, 0.006 * s, 0.006 * s);
    // arrow: from the nock through the grip and a little beyond
    this.hasArrow = arrow;
    if (!arrow) { this.pos.fill(0, this.q * 12); this.finish(); return; }
    _ad.subVectors(grip, nock); const L = _ad.length(); _ad.divideScalar(L || 1);
    _tip.copy(grip).addScaledVector(_ad, 0.1 * s);
    _hb.copy(_tip).addScaledVector(_ad, -0.07 * s);
    this.seg(nock, _hb, 0.009 * s, 0.009 * s);
    this.seg(_hb, _tip, 0.028 * s, 0.001);
    this.tip.copy(_tip);
    _f0.copy(nock).addScaledVector(_ad, 0.015 * s); _f1.copy(nock).addScaledVector(_ad, 0.11 * s);
    this.seg(_f0, _f1, 0.026 * s, 0.012 * s);
    this.finish();
  }
  private finish() {
    const pa = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    pa.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide() { this.mesh.visible = false; this.hasArrow = false; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.removeFromParent(); }
}
