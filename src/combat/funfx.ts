/**
 * One shared particle system for the «Забавы» that are not fights (src/features/flight, emotes, boom): ONE Fx (one
 * points draw call + one instanced ring call while rings are on) for all of them, updated once per frame by itself —
 * independent of the combat feature (whose own Fx only updates while fights are on). Reference-counted per scene:
 * the last release() removes it.
 */
import type * as THREE from 'three';
import { Fx } from './fx';

export interface FunFxHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  onFrame(fn: (dt: number, t: number) => void): () => void;
  /** Drawing-buffer height (px), for the particle size. */
  viewHeight(): number;
}
interface Shared { fx: Fx; refs: number; off: () => void }
const BY_SCENE = new WeakMap<THREE.Scene, Shared>();

/** Get (or create) the shared Fx of this scene. Call release() when the feature goes. */
export function acquireFunFx(host: FunFxHost): { fx: Fx; release(): void } {
  let s = BY_SCENE.get(host.scene);
  if (!s) {
    const fx = new Fx();
    fx.root.name = 'fun-fx';
    fx.maxPointPx = 520;   // the boom's fireball and smoke are metres wide
    host.scene.add(fx.root);
    const off = host.onFrame((dt) => fx.update(Math.min(0.05, Math.max(0, dt)), host.camera, host.viewHeight()));
    s = { fx, refs: 0, off };
    BY_SCENE.set(host.scene, s);
  }
  s.refs++;
  let done = false;
  const sh = s;
  return {
    fx: sh.fx,
    release() {
      if (done) return; done = true;
      if (--sh.refs > 0) return;
      sh.off(); sh.fx.dispose(); BY_SCENE.delete(host.scene);
    },
  };
}
