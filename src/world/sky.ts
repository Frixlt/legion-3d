/** Sky dome (gradient from layout.sky), stars, moon, and the shader for additive glow points / garland bulbs. */
import * as THREE from 'three';
import { parseGradient } from './palette';
import { rng } from './textures';

export function skyDome(css: string | undefined): THREE.Mesh {
  const stops = parseGradient(css).slice(0, 4);
  while (stops.length < 4) stops.push({ ...stops[stops.length - 1], p: 1 });
  const cols = stops.map((s) => new THREE.Color(s.c));
  const ps = stops.map((s) => s.p);
  // a lighter, slightly warm glow band at the horizon (distant roofs silhouette against it; fog uses the same colour)
  const hz = cols[3].clone().lerp(new THREE.Color('#d08cb0'), 0.3).multiplyScalar(1.25);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      c0: { value: cols[0] }, c1: { value: cols[1] }, c2: { value: cols[2] }, c3: { value: cols[3] },
      p: { value: new THREE.Vector4(ps[0], ps[1], ps[2], ps[3]) }, hz: { value: hz },
    },
    vertexShader: /* glsl */`varying vec3 vP; void main(){ vP = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec3 hz; uniform vec4 p; varying vec3 vP;
      void main(){
        // t = 0 at the zenith … 1 at the horizon (CSS gradient goes top → bottom)
        float t = 1.0 - clamp(vP.y * 1.6, 0.0, 1.0);
        vec3 c = c0;
        c = mix(c, c1, smoothstep(p.x, p.y, t));
        c = mix(c, c2, smoothstep(p.y, p.z, t));
        c = mix(c, c3, smoothstep(p.z, max(p.w, p.z + 0.001), t));
        c = mix(c, hz, exp(-max(vP.y, 0.0) * 9.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  m.name = 'sky:dome'; m.renderOrder = -10; m.frustumCulled = false;
  m.userData.horizon = hz;
  return m;
}

export function stars(n: number, dot: THREE.Texture): THREE.Points {
  const r = rng(99);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, y = 0.12 + Math.pow(r(), 0.7) * 0.88, h = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * h * 280; pos[i * 3 + 1] = y * 280; pos[i * 3 + 2] = Math.sin(a) * h * 280;
    const w = r(); col[i * 3] = 1; col[i * 3 + 1] = 0.92 + w * 0.08; col[i * 3 + 2] = 0.75 + w * 0.25;
    size[i] = (r() < 0.06 ? 3.2 : 1.2 + r() * 1.3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: dot }, uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */`attribute float size; attribute vec3 color; uniform float uTime; uniform float uPx; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); float tw = 0.7 + 0.3 * sin(uTime * 1.7 + position.x * 0.37 + position.z * 0.11);
        vC = color * tw; gl_PointSize = size * uPx; gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.9999; }`,
    fragmentShader: /* glsl */`uniform sampler2D map; varying vec3 vC; void main(){ float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vC * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const p = new THREE.Points(g, mat); p.name = 'sky:stars'; p.frustumCulled = false; p.renderOrder = -9;
  return p;
}

/** Additive glow points with per-point size (m) and colour; flicker by time. */
export function glowPoints(data: number[], stride: 7 | 6, tex: THREE.Texture, opts: { size?: number; flicker?: number; intensity?: number } = {}): THREE.Points {
  const n = Math.floor(data.length / stride);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    pos[i * 3] = data[o]; pos[i * 3 + 1] = data[o + 1]; pos[i * 3 + 2] = data[o + 2];
    if (stride === 7) { size[i] = data[o + 3]; col[i * 3] = data[o + 4]; col[i * 3 + 1] = data[o + 5]; col[i * 3 + 2] = data[o + 6]; }
    else { size[i] = opts.size ?? 0.3; col[i * 3] = data[o + 3]; col[i * 3 + 1] = data[o + 4]; col[i * 3 + 2] = data[o + 5]; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uTime: { value: 0 }, uScale: { value: 600 }, uInt: { value: opts.intensity ?? 1 }, uFlick: { value: opts.flicker ?? 0.12 } },
    vertexShader: /* glsl */`attribute float size; attribute vec3 color; uniform float uTime; uniform float uScale; uniform float uFlick; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); float d = -mv.z;
        float ph = position.x * 3.1 + position.z * 1.7;
        float f = 1.0 - uFlick + uFlick * (0.6 + 0.4 * sin(uTime * 9.0 + ph) * sin(uTime * 2.3 + ph * 1.7));
        float fade = clamp(1.4 - d / 70.0, 0.0, 1.0);
        vC = color * f * fade; gl_PointSize = clamp(size * uScale / max(d, 0.1), 0.0, 512.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform sampler2D map; uniform float uInt; varying vec3 vC; void main(){ float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vC * a * uInt, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const p = new THREE.Points(g, mat); p.name = 'fx:glow';
  return p;
}
