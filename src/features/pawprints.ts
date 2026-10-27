/**
 * Paw prints (idea #8): after you walk or run on the cobbles, up to 8 fading paw prints stay behind you (ring buffer,
 * instanced decal quads 12 mm above the ground height, fade ≈ 5 s). Not in rooms, not on the canal / bridges / stairs,
 * not while jumping, off at quality 0. One InstancedMesh = one draw call.
 */
import * as THREE from 'three';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { fromX, fromZ } from '../world/coords';
import { groundSpec, inRanges } from '../world/ground';
import { PAW_COUNT, alpha, clearTrail, newTrail, step } from '../explore/paws';
import { coreFeature } from './types';

export const PAWS_KEY = 'l3d.world.paws';

function pawTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#fff';
    const blob = (x: number, y: number, rx: number, ry: number, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
    blob(32, 42, 13, 11);                              // pad
    blob(14, 28, 5.5, 7.5, -0.35); blob(25, 15, 5.5, 8); blob(39, 15, 5.5, 8); blob(50, 28, 5.5, 7.5, 0.35);   // toes (up = forward)
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.anisotropy = 4;
  return t;
}

export default coreFeature({
  id: 'pawprints',
  order: 91,
  setup(ctx) {
    const offRow = registerSettingRow({ key: PAWS_KEY, label: 'Следы лап', sub: 'Недолговечные следы на брусчатке за вами (от среднего качества)', group: 'Мир', order: 40, kind: 'seg', options: [['1', 'Вкл'], ['0', 'Выкл']], def: '1' });
    const trail = newTrail();
    const tex = pawTexture();
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(PAW_COUNT), 1);
    fade.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.PlaneGeometry(0.2, 0.22).rotateX(-Math.PI / 2);
    geo.setAttribute('aFade', fade);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: /* glsl */`attribute float aFade; varying vec2 vUv; varying float vA;
        void main(){ vUv = uv; vA = aFade; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform sampler2D map; varying vec2 vUv; varying float vA;
        void main(){ float a = texture2D(map, vUv).a * vA * 0.62; if (a < 0.01) discard; gl_FragColor = vec4(0.07, 0.04, 0.13, a); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, PAW_COUNT);
    mesh.name = 'fx:paws'; mesh.frustumCulled = false; mesh.renderOrder = 2;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    mesh.count = PAW_COUNT;
    for (let i = 0; i < PAW_COUNT; i++) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); }
    let spec = groundSpec({ low: undefined });
    let root: THREE.Object3D | null = null;
    const enabled = () => settingValue<string>(PAWS_KEY, '1') !== '0' && ctx.quality() >= 1;
    const attach = () => {
      const w = ctx.world();
      if (root === w.root) return;
      root = w.root; w.root.add(mesh); spec = groundSpec(ctx.layout()); clearTrail(trail);
    };
    attach();
    const offW = ctx.onWorld(() => { attach(); });
    let on = true, lastT = 0;
    const offF = ctx.onFrame((dt, t) => {
      lastT = t;
      const was = on; on = enabled() && !ctx.state.inRoom;
      mesh.visible = on;
      if (!on) { if (was) clearTrail(trail); return; }
      const f = ctx.feet, w = ctx.world();
      const px = fromX(f.x), py = fromZ(f.z);
      const gy = w.groundAt(px, py);
      // cobbles only: grounded, inside the walkable area, not over the canal (bridge planks), not on the stair ramp
      let ok = Math.abs(f.y - gy) < 0.12 && ctx.layout().free(px, py);
      if (ok && spec.canal && py >= spec.canal[0] - 40 && py <= spec.canal[1] + 40) ok = false;
      if (ok && spec.hasLow && py >= spec.rampY0 && py <= spec.rampY1 && inRanges(px, spec.stairs)) ok = false;
      step(trail, f.x, f.z, ok, gy, t, dt);
      {
        for (let i = 0; i < PAW_COUNT; i++) {
          const a = alpha(trail.born[i], t);
          fade.setX(i, a);
          if (a <= 0) { m4.makeScale(0, 0, 0); }
          else { q.setFromAxisAngle(up, trail.data[i * 4 + 3]); p.set(trail.data[i * 4], trail.data[i * 4 + 1], trail.data[i * 4 + 2]); m4.compose(p, q, one); }
          mesh.setMatrixAt(i, m4);
        }
        fade.needsUpdate = true; mesh.instanceMatrix.needsUpdate = true;
      }
    });
    // dev/test helper: lay n prints along the player's heading-behind line, as if just walked
    const lay = (n = 7, yaw = 0) => {
      const f = ctx.feet;
      for (let i = 0; i < n; i++) {
        const o = trail.head * 4, back = (n - i) * 0.55;
        trail.data[o] = f.x + Math.sin(yaw) * back + (i % 2 ? 0.1 : -0.1); trail.data[o + 1] = f.y + 0.012; trail.data[o + 2] = f.z + Math.cos(yaw) * back; trail.data[o + 3] = yaw;
        trail.born[trail.head] = lastT + 0.2 * (i - n); trail.head = (trail.head + 1) % PAW_COUNT;
      }
    };
    ctx.dev.paws = { trail, mesh, lay };
    return () => { offF(); offW(); mesh.removeFromParent(); geo.dispose(); mat.dispose(); tex.dispose(); mesh.dispose(); offRow(); };
  },
});
