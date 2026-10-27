/**
 * Gentle falling snow: one Points object whose flakes live in a box that wraps around the camera (all motion in the
 * vertex shader: fall, sway, wrap — zero CPU per flake). Flakes fade near the eye and towards the box edge.
 */
import * as THREE from 'three';

export const SNOW_BOX = new THREE.Vector3(34, 14, 34);

export function snowfall(max: number): THREE.Points {
  const pos = new Float32Array(max * 3), seed = new Float32Array(max);
  let s = 99; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < max; i++) { pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r(); seed[i] = r(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: SNOW_BOX.clone() }, uScale: { value: 400 }, uSize: { value: 0.07 }, uOpacity: { value: 0.9 } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uScale; uniform float uSize;
      varying float vA;
      void main() {
        vec3 p = position * uBox;
        float sp = 0.45 + aSeed * 0.5;
        p.y -= uTime * sp;
        p.x += sin(uTime * (0.4 + aSeed * 0.5) + aSeed * 40.0) * 0.45 + uTime * 0.12;
        p.z += cos(uTime * (0.3 + aSeed * 0.4) + aSeed * 23.0) * 0.35;
        vec3 o = uCam - uBox * vec3(0.5, 0.45, 0.5);
        p = o + mod(p - o, uBox);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = max(1.5, uSize * (0.6 + aSeed * 0.9) * uScale / max(d, 0.1));
        vA = smoothstep(0.4, 1.6, d) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(p.xz - uCam.xz)));
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity; varying float vA;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q);
        if (r > 1.0) discard;
        gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), vA * uOpacity * (1.0 - r) * (1.0 - r));
      }`,
  });
  const p = new THREE.Points(g, m);
  p.name = 'newyear:snowfall'; p.frustumCulled = false; p.renderOrder = 6;
  return p;
}
