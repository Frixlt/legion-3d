import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createViewModel, VM_TUNE } from '../src/avatar/viewmodel';
import { addWeapon, weaponHold } from '../src/avatar/gear';
import { Parts } from '../src/avatar/geom';
import type { Appearance } from '../src/contracts';

const WEAPONS = ['sword', 'gladius', 'dagger', 'kris', 'axe', 'club', 'mace', 'hammer', 'holymace', 'spear', 'pitchfork',
  'staff', 'crook', 'skullstaff', 'bow', 'grimoire', 'censer'];
const SHIELDS = ['scutum', 'round', 'buckler', 'barrel'];

const app = (gear: Record<string, string>): Appearance => ({
  login: 'test', name: 'Тест', level: 1, styleId: 'cats',
  look: { shape: 'bean', color: '#ffc6a0', eyes: 'big', mouth: 'smile', hat: 'none' },
  gear: { ...gear },
} as unknown as Appearance);

function rig(gear: Record<string, string>, block = false) {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.03, 100);
  const vm = createViewModel(app(gear));
  cam.add(vm.root);
  if (block) vm.block(true);
  for (let i = 0; i < 90; i++) vm.update(1 / 30, i / 30, 0, { dx: 0, dy: 0 });   // settle raise + block
  cam.updateMatrixWorld(true);
  return { cam, vm };
}

/** Screen-space (0..1, y down) bbox of the on-screen vertices of the meshes named `name`, plus the nearest depth. */
function extent(cam: THREE.PerspectiveCamera, root: THREE.Object3D, name?: string) {
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0, near = Infinity;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.renderOrder !== 1001 || (name && m.name !== name)) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      c.copy(v).applyMatrix4(cam.matrixWorldInverse);
      v.project(cam);
      if (v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1 || c.z > 0) continue;
      near = Math.min(near, -c.z);
      const sx = (v.x + 1) / 2, sy = (1 - v.y) / 2;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
  });
  return { left: x0, right: x1, top: y0, bottom: y1, w: x1 - x0, h: y1 - y0, near };
}

describe('view-model', () => {
  it('builds every weapon × shield, swings and blocks without throwing', () => {
    for (const w of [...WEAPONS, '']) {
      for (const s of ['', 'round']) {
        const g: Record<string, string> = { a: 'lorica', ar: 'rare' };
        if (w) { g.w = w; g.wr = 'epic'; }
        if (s) { g.s = s; g.sr = 'rare'; }
        const { vm } = rig(g);
        vm.swing(); vm.block(true);
        for (let i = 0; i < 40; i++) vm.update(1 / 30, i / 30, i < 20 ? 1 : 1.6, { dx: 3, dy: -2 });
        vm.dispose();
      }
    }
  });

  it('nothing visible comes closer than 1.2× the near plane (no camera clipping), idle and mid-swing', () => {
    for (const w of WEAPONS) {
      const { cam, vm } = rig({ w, s: 'scutum' });
      expect(extent(cam, vm.root).near, w).toBeGreaterThan(0.036);
      vm.swing();
      for (let i = 0; i < 8; i++) vm.update(1 / 30, 3 + i / 30, 0, { dx: 0, dy: 0 });
      cam.updateMatrixWorld(true);
      expect(extent(cam, vm.root).near, w + ' swing').toBeGreaterThan(0.036);
      vm.dispose();
    }
  });

  it('idle shield is a low strip at the bottom-left; blocking covers about the lower-left quarter', () => {
    for (const s of SHIELDS) {
      const idle = rig({ w: 'bow', s });
      const e = extent(idle.cam, idle.vm.root, 'vm-shield');
      expect(e.bottom, s).toBeGreaterThan(0.93);   // runs off the bottom edge (on-screen vertices only)
      expect(e.h, s + ' idle height').toBeGreaterThan(0.07);
      expect(e.h, s + ' idle height').toBeLessThan(0.16);
      expect(e.w, s + ' idle width').toBeGreaterThan(0.17);   // on-screen vertices only: under-reports a strip whose edges run off-screen (pixel mask: ≈ 0.25)
      expect(e.w, s + ' idle width').toBeLessThan(0.36);
      expect(e.right, s).toBeLessThan(0.42);
      const blk = rig({ w: 'bow', s }, true);
      const b = extent(blk.cam, blk.vm.root, 'vm-shield');
      expect(b.top, s + ' block top').toBeGreaterThan(0.4);
      expect(b.right, s + ' block right').toBeLessThan(0.5);
      expect(b.h, s + ' block height').toBeGreaterThan(0.38);
    }
  });

  it('the bow stands in the aim plane with the string towards the camera', () => {
    expect(Math.abs(VM_TUNE.bow.yaw)).toBeLessThan(0.3);
    const { cam, vm } = rig({ w: 'bow' });
    const e = extent(cam, vm.root, 'vm-weapon');
    expect(e.h).toBeGreaterThan(0.3);       // limbs well above (and below) the paw
    expect(e.left).toBeGreaterThan(0.5);    // right half of the screen
  });
});

describe('weaponHold (shared FP/TP orientation)', () => {
  const box = (kind: string) => { const p = new Parts(); addWeapon(p, kind, 'common', weaponHold(kind)); const g = p.build(); g.computeBoundingBox(); return g.boundingBox!; };
  it('blades and axe heads point forward (−Z), flats sideways', () => {
    for (const k of ['sword', 'gladius', 'dagger', 'kris']) {
      const b = box(k);
      expect(b.max.z - b.min.z, k).toBeGreaterThan(b.max.x - b.min.x);
    }
    const axe = box('axe');
    expect(-axe.min.z).toBeGreaterThan(0.1);      // the blade reaches forward
    expect(axe.max.z).toBeLessThan(0.05);
  });
  it('bow: grip at the origin, limbs up/down, string towards the holder (+Z)', () => {
    const b = box('bow');
    expect(b.max.y).toBeGreaterThan(0.25); expect(b.min.y).toBeLessThan(-0.25);
    expect(b.max.x - b.min.x).toBeLessThan(0.06);
    expect(b.max.z).toBeGreaterThan(0.05);         // string side
    expect(b.min.z).toBeGreaterThan(-0.04);        // the grip (belly) sits at the origin
  });
  it('grimoire: cover towards the holder, spine in the paw', () => {
    const b = box('grimoire');
    expect(b.max.x).toBeLessThan(0.03);            // pages extend inwards from the spine
    expect(b.min.x).toBeLessThan(-0.15);
  });
});
