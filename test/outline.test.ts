import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';
import {
  OUTLINE_MAX, OUTLINE_GLSL, collectOutlineMeshes, ensureSmoothNormals, fitOutlineProxy, hideOutline, outlineCalls,
  outlineFrame, outlineHullGroup, outlineOwner, outlineSources, outlineUniforms, showOutline,
} from '../src/engine/outline';

const mesh = (g: THREE.BufferGeometry, mat: THREE.Material = new THREE.MeshBasicMaterial()) => { const m = new THREE.Mesh(g, mat); m.updateMatrixWorld(true); return m; };
/** Enough of a WebGLRenderer for outlineFrame (sizes only). */
const fakeRenderer = () => ({
  getSize: (v: THREE.Vector2) => v.set(1280, 720),
  getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280, 720),
  getPixelRatio: () => 1,
}) as unknown as THREE.WebGLRenderer;
const camAt = (z: number) => { const c = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100); c.position.set(0, 1, z); c.updateMatrixWorld(true); c.matrixWorldInverse.copy(c.matrixWorld).invert(); return c; };

describe('outline slot', () => {
  it('holds exactly one target; only its owner (or a new show) clears it', () => {
    const a = {}, b = {};
    const m1 = mesh(new THREE.BoxGeometry()), m2 = mesh(new THREE.BoxGeometry());
    showOutline(a, m1);
    expect(outlineOwner()).toBe(a); expect(outlineSources()).toEqual([m1]);
    showOutline(b, m2);                 // replaces: never two targets
    expect(outlineOwner()).toBe(b); expect(outlineSources()).toEqual([m2]);
    hideOutline(a);                     // stale owner: ignored
    expect(outlineSources()).toEqual([m2]);
    hideOutline(b);
    expect(outlineOwner()).toBeNull(); expect(outlineSources().length).toBe(0);
    showOutline(a, null);
    expect(outlineOwner()).toBeNull();
  });

  it('takes the largest visible meshes of an object (cap = OUTLINE_MAX), skipping glows, back-face shells and hidden parts', () => {
    const g = new THREE.Group();
    const sizes = [0.2, 1.5, 0.6, 1.0, 0.1];
    const ms = sizes.map((s) => { const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial()); g.add(m); return m; });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); g.add(glow);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial({ side: THREE.BackSide })); g.add(shell);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial()); hidden.visible = false; g.add(hidden);
    const inv = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial({ visible: false })); g.add(inv);
    const got = collectOutlineMeshes(g);
    expect(got.length).toBe(OUTLINE_MAX);
    expect(got).toEqual([ms[1], ms[3], ms[2]]);
  });

  it('smoothed normals weld flat faces: a box corner extrudes along the diagonal (closed hull, no cracks)', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    ensureSmoothNormals(g);
    const on = g.getAttribute('l3dON') as THREE.BufferAttribute, pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const n = new THREE.Vector3().fromBufferAttribute(on, i), p = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
      expect(n.dot(p)).toBeGreaterThan(0.999);   // corners of a unit cube: normal = direction of the corner
    }
    // a draw range only computes that range (merged shop goods)
    const big = mergeGeometries([new THREE.BoxGeometry().toNonIndexed(), new THREE.BoxGeometry().translate(3, 0, 0).toNonIndexed()]);
    big.setDrawRange(36, 36);
    ensureSmoothNormals(big);
    const on2 = big.getAttribute('l3dON') as THREE.BufferAttribute;
    expect(Math.hypot(on2.getX(0), on2.getY(0), on2.getZ(0))).toBe(0);
    expect(Math.hypot(on2.getX(40), on2.getY(40), on2.getZ(40))).toBeCloseTo(1);
  });
});

describe('fitted proxy (Box3 / invisible hit volumes)', () => {
  it('takes the static triangles inside the volume: door leaf and arch, not the wall, not the ground, not the hero', () => {
    const scene = new THREE.Scene();
    const leaf = new THREE.BoxGeometry(0.8, 1.6, 0.06).translate(0, 0.9, 0);
    const arch = new THREE.CylinderGeometry(0.4, 0.4, 0.06, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.7, 0);
    const wall = new THREE.BoxGeometry(8, 5, 0.3).translate(0, 2.5, -0.3);
    const ground = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2).translate(0, 0.0, 0.1);
    const city = new THREE.Mesh(mergeGeometries([leaf.toNonIndexed(), arch.toNonIndexed(), wall.toNonIndexed(), ground.toNonIndexed()]), new THREE.MeshBasicMaterial());
    scene.add(city);
    // the hero's avatar (directly under the scene) standing in the doorway is never taken
    const hero = new THREE.Group(); hero.name = 'avatar';
    const body = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.4, 1.2, 0.3), new THREE.MeshBasicMaterial()); body.name = 'avatar-body';
    hero.add(body); hero.position.set(0, 0, 0.1); scene.add(hero);
    // a room NPC (avatar under a room root) in the volume is taken
    const room = new THREE.Group(); scene.add(room);
    const npc = new THREE.Group(); npc.name = 'avatar';
    const nb = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.4, 1.2, 0.3), new THREE.MeshBasicMaterial()); nb.name = 'avatar-body';
    npc.add(nb); npc.position.set(0.3, 0, 0.15); room.add(npc);
    const t0 = performance.now();
    const r = fitOutlineProxy(scene, new THREE.Box3(new THREE.Vector3(-0.7, 0, -0.1), new THREE.Vector3(0.7, 2.3, 0.3)));
    const ms = performance.now() - t0;
    expect(r.proxy).not.toBeNull();
    const bb = new THREE.Box3().setFromBufferAttribute(r.proxy!.geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(bb.min.x).toBeCloseTo(-0.4); expect(bb.max.x).toBeCloseTo(0.4);
    expect(bb.min.y).toBeCloseTo(0.1); expect(bb.max.y).toBeCloseTo(2.1, 1);
    expect(bb.max.z).toBeLessThan(0.05);          // no ground tile (z up to 0.35)
    expect(r.avatars).toEqual([nb]);
    expect(ms).toBeLessThan(50);
    // outline is never raycast-hittable and its material never draws
    expect((r.proxy!.material as THREE.Material).visible).toBe(false);
  });
});

describe('outlineFrame', () => {
  it('nothing targeted → no draw calls; a target → one hull per source (q0–1), mask composite on (q2–3), pulse 0.85…1', () => {
    const scene = new THREE.Scene(), r = fakeRenderer(), cam = camAt(4);
    hideOutline(outlineOwner());
    outlineFrame(r, scene, cam, 0, false);
    expect(outlineCalls()).toBe(0);
    expect(outlineUniforms.uOOn.value).toBe(0);
    const box = mesh(new THREE.BoxGeometry(1, 2, 1).translate(0, 1, 0));
    const me = {};
    showOutline(me, box);
    let lo = 2, hi = 0;
    for (let t = 0; t < 3; t += 0.05) {
      outlineFrame(r, scene, cam, t, false);
      const p = (outlineHullGroup()!.children.find((c) => c.visible) as THREE.Mesh).material as THREE.ShaderMaterial;
      lo = Math.min(lo, p.uniforms.uPulse.value); hi = Math.max(hi, p.uniforms.uPulse.value);
    }
    expect(lo).toBeGreaterThanOrEqual(0.85); expect(hi).toBeLessThanOrEqual(1.0001);
    expect(outlineCalls()).toBe(1);
    const hg = outlineHullGroup()!;
    expect(hg.parent).toBe(scene); expect(hg.visible).toBe(true);
    const hull = hg.children.filter((c) => c.visible) as THREE.Mesh[];
    expect(hull.length).toBe(1);
    expect(hull[0].geometry).toBe(box.geometry);                       // shares the source geometry
    expect((hull[0].material as THREE.ShaderMaterial).side).toBe(THREE.BackSide);
    expect(box.geometry.getAttribute('l3dON')).toBeTruthy();
    // post mode: hulls off, composite on with the target's screen rect inside the viewport
    outlineFrame(r, scene, cam, 1, true);
    expect(hg.visible).toBe(false);
    expect(outlineUniforms.uOOn.value).toBeGreaterThan(0.8);
    const R = outlineUniforms.uORect.value;
    expect(R.x).toBeGreaterThan(0.3); expect(R.z).toBeLessThan(0.7); expect(R.x).toBeLessThan(R.z);
    // off screen (camera looking away) → nothing drawn
    const away = camAt(4); away.rotation.y = Math.PI; away.updateMatrixWorld(true); away.matrixWorldInverse.copy(away.matrixWorld).invert();
    outlineFrame(r, scene, away, 1, true);
    expect(outlineCalls()).toBe(0); expect(outlineUniforms.uOOn.value).toBe(0);
    hideOutline(me);
    outlineFrame(r, scene, cam, 2, false);
    expect(hg.visible).toBe(false); expect(outlineCalls()).toBe(0);
  });

  it('the composite hooks into three\'s OutputShader at its colour-space step', () => {
    expect(OutputShader.fragmentShader).toContain('// color space');
    expect(OUTLINE_GLSL.trim().endsWith('// color space')).toBe(true);
  });
});
