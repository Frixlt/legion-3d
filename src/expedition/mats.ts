/**
 * Expedition materials. Owned by one ExpeditionScene (created in its constructor, disposed with it), except the shared
 * avatar outline material (src/avatar/materials outlineMat — cached for all avatars, never disposed here).
 */
import * as THREE from 'three';
import { toonMat, outlineMat } from '../avatar/materials';

/** Cel material with vertex colours; on instanced meshes the instance colour tints only the vertices with aTint = 1. */
function makeTint(): THREE.MeshToonMaterial {
  const base = toonMat('n');
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: base.gradientMap });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace('#include <color_vertex>', `
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          vColor = vec4( 1.0 );
        #endif
        #ifdef USE_COLOR
          vColor.rgb *= color.rgb;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );
        #endif`);
  };
  m.customProgramCacheKey = () => 'exp-tint';
  m.name = 'exp-tint';
  return m;
}

const DECAL_VERT = /* glsl */`
attribute vec4 iCol;   // rgb, alpha
attribute vec2 iP;     // soft (0 = ring … 1 = filled disc), pulse speed
uniform float uTime;
varying vec2 vUv; varying vec4 vCol; varying vec2 vP;
void main() {
  vUv = uv; vCol = iCol; vP = iP;
  float pulse = iP.y > 0.0 ? 0.75 + 0.25 * sin(uTime * iP.y) : 1.0;
  vCol.a *= pulse;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const DECAL_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vCol; varying vec2 vP;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float ring = smoothstep(1.0, 0.86, r) * smoothstep(0.55, 0.82, r);
  float fill = smoothstep(1.0, 0.0, r) * 0.65;
  float a = mix(ring, max(ring * 0.9, fill), vP.x) * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * a, a * 0.6);
}`;

const BAR_VERT = /* glsl */`
attribute vec4 iBar;   // hp 0..1, width (m), height (m), kind (0 foe red, 1 boss, 2 ally green)
varying vec2 vUv; varying vec4 vBar;
void main() {
  vUv = uv; vBar = iBar;
  vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  c.xy += vec2((uv.x - 0.5) * iBar.y, (uv.y - 0.5) * iBar.z);
  gl_Position = projectionMatrix * c;
}`;
const BAR_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vBar;
void main() {
  vec2 px = vec2(vBar.y, vBar.z) * 120.0;
  float bx = 2.0 / px.x, by = 2.0 / px.y;
  bool border = vUv.x < bx || vUv.x > 1.0 - bx || vUv.y < by || vUv.y > 1.0 - by;
  vec3 col;
  if (border) col = vec3(0.09, 0.06, 0.13);
  else if (vUv.x < vBar.x) {
    col = vBar.w > 1.5 ? vec3(0.36, 0.86, 0.42) : vBar.w > 0.5 ? vec3(0.78, 0.22, 0.86) : vec3(0.93, 0.28, 0.33);
    col = mix(col, vec3(1.0), smoothstep(0.55, 1.0, vUv.y) * 0.35);
  } else col = vec3(0.16, 0.12, 0.22);
  gl_FragColor = vec4(col, 0.95);
}`;

const SKY_VERT = /* glsl */`
varying vec3 vW;
void main() { vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */`
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform float uStars; uniform float uTime;
varying vec3 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float y = vW.y;
  vec3 c = y > 0.12 ? mix(uMid, uTop, smoothstep(0.12, 0.7, y)) : mix(uLow, uMid, smoothstep(-0.1, 0.12, y));
  if (uStars > 0.0 && y > 0.08) {
    vec2 g = vec2(atan(vW.z, vW.x) * 60.0, y * 60.0);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float s = h(id);
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 20.0);
    c += vec3(1.0, 0.95, 0.85) * step(0.955, s) * smoothstep(0.32, 0.0, length(f)) * uStars * tw * 2.2;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export class ExpMats {
  readonly tint = makeTint();
  readonly outline = outlineMat('n', 8, 0.014);
  readonly outlineBig = outlineMat('n', 8, 0.03);
  readonly glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
  readonly flat = new THREE.MeshBasicMaterial({ vertexColors: true });
  readonly water = new THREE.MeshToonMaterial({ color: '#4fa8d8', transparent: true, opacity: 0.82, gradientMap: toonMat('n').gradientMap });
  readonly lava = new THREE.MeshBasicMaterial({ color: '#2a1f3a' });
  readonly time = { value: 0 };
  readonly decal = new THREE.ShaderMaterial({ vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, uniforms: { uTime: this.time }, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  readonly bar = new THREE.ShaderMaterial({ vertexShader: BAR_VERT, fragmentShader: BAR_FRAG, transparent: true, depthTest: false, depthWrite: false });
  readonly sky = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uLow: { value: new THREE.Color() }, uStars: { value: 0 }, uTime: this.time } });
  dispose(): void {
    for (const m of [this.tint, this.glow, this.flat, this.water, this.lava, this.decal, this.bar, this.sky]) m.dispose();
  }
}
