/**
 * Optional post-processing for quality ≥ 2: subtle bloom (emissive lamps, windows, glows), warm grade and a vignette.
 *
 * Chain (3 full-res + a few tiny passes):
 *   RenderPass → HDR half-float target (MSAA ×4 when the context has antialias at q3)
 *   UnrealBloomPass at QUARTER res (its mip chain starts at half of what it is given; we give it half)
 *   OutputPass (tone mapping + sRGB) with the grade and vignette folded into its shader — no extra full-screen pass.
 *   Target outline (outline.ts): OutlineMaskPass after the RenderPass (only while something is targeted; reads the
 *   scene depth texture of the HDR target) + edge/composite folded into the OutputPass shader as well.
 * The engine owns sizing: setSize(w, h, pixelRatio) follows dynamic resolution scaling.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OutlineMaskPass, OUTLINE_GLSL, OUTLINE_GLSL_HEAD, outlineUniforms } from './outline';

export interface PostOptions {
  /** Bloom strength (0 = off). */
  bloom?: number;
  /** Linear-HDR luminance threshold: only lamps/glows/windows (emissive well above 1) bloom. */
  threshold?: number;
  /** Soft knee width (luminance) around the threshold: no hard on/off edge. */
  knee?: number;
  /** Clamp of the luminance EXCESS (above threshold) fed into the bloom: a hot lamp core cannot flood the screen. */
  clamp?: number;
  radius?: number;
  /** 0..1 darkening at the corners. */
  vignette?: number;
  /** 0..1 warm tint (amber highlights, slightly cooler shadows) + a touch of saturation. */
  warm?: number;
}

/**
 * Tuned for soft lamp glow without glare (bug #9): only the excess above `threshold` blooms (soft knee), the excess is
 * clamped, and the strength is low. Tone mapping is AgX at exposure TONE_EXPOSURE (engine.ts).
 */
export const POST_DEFAULTS: Required<PostOptions> = { bloom: 0.2, threshold: 1.35, knee: 0.4, clamp: 2.0, radius: 0.22, vignette: 0.35, warm: 0.45 };
/** renderer.toneMappingExposure for AgX (used with and without post-processing). */
export const TONE_EXPOSURE = 0.92;

/**
 * Bloom bright-pass: "excess over threshold" with a quadratic soft knee (like Unity/Unreal), luminance-clamped.
 * Replaces three's LuminosityHighPassShader, which passes the WHOLE pixel once it is over the threshold (so lit paving
 * just above 1.0 bloomed at full brightness — the washed-out light pools of bug #9).
 */
const HIGH_PASS_GLSL = /* glsl */`
		uniform sampler2D tDiffuse;
		uniform float luminosityThreshold;
		uniform float smoothWidth;
		uniform float uClamp;
		varying vec2 vUv;
		void main() {
			vec4 texel = texture2D( tDiffuse, vUv );
			vec3 c = max( texel.rgb, vec3( 0.0 ) );
			float v = luminance( c );
			float k = max( smoothWidth, 1e-4 );
			float soft = clamp( v - luminosityThreshold + k, 0.0, 2.0 * k );
			soft = soft * soft / ( 4.0 * k );
			float excess = min( max( soft, v - luminosityThreshold ), uClamp );
			gl_FragColor = vec4( c * ( excess / max( v, 1e-4 ) ), 1.0 );
		}`;

/** Bloom at a fraction of the composer size (UnrealBloomPass already halves → ×0.5 here = quarter res). */
class CheapBloomPass extends UnrealBloomPass {
  scaleK = 0.5;
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width * this.scaleK)), Math.max(2, Math.round(height * this.scaleK)));
  }
}

const GRADE_GLSL = /* glsl */`
			// --- l3d grade + vignette (tone-mapped linear space, before the sRGB transfer)
			{
				vec3 c = gl_FragColor.rgb;
				float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
				c = mix( vec3( l ), c, 1.0 + 0.10 * uWarm );                                   // saturation
				c *= mix( vec3( 1.0 ), mix( vec3( 0.97, 0.99, 1.04 ), vec3( 1.06, 1.0, 0.90 ), smoothstep( 0.05, 0.6, l ) ), uWarm );
				vec2 q = vUv - 0.5;
				float v = 1.0 - uVignette * smoothstep( 0.18, 0.75, dot( q, q ) * 2.2 );
				gl_FragColor.rgb = c * v;
			}
			// color space`;

export class PostChain {
  readonly composer: EffectComposer;
  private readonly bloom: CheapBloomPass;
  private readonly output: OutputPass;
  private readonly renderPass: RenderPass;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly outline: OutlineMaskPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, msaa: number, o: PostOptions = {}) {
    const p = { ...POST_DEFAULTS, ...o };
    // depth as a texture (resolved from MSAA): the outline mask tests the target against it (x-ray of hidden parts)
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa, depthTexture: new THREE.DepthTexture(1, 1) });
    this.composer = new EffectComposer(renderer, this.target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new CheapBloomPass(new THREE.Vector2(256, 256), p.bloom, p.radius, p.threshold);
    const hp = this.bloom.highPassUniforms as Record<string, THREE.IUniform>;
    hp.smoothWidth.value = p.knee;
    hp.uClamp = { value: p.clamp };
    this.bloom.materialHighPassFilter.fragmentShader = HIGH_PASS_GLSL;
    this.bloom.materialHighPassFilter.needsUpdate = true;
    this.output = new OutputPass();
    const u = this.output.uniforms as Record<string, THREE.IUniform>;
    u.uVignette = { value: p.vignette };
    u.uWarm = { value: p.warm };
    Object.assign(u, outlineUniforms);
    const m = this.output.material as THREE.RawShaderMaterial;
    m.fragmentShader = m.fragmentShader
      .replace('varying vec2 vUv;', 'varying vec2 vUv;\nuniform float uVignette;\nuniform float uWarm;\n' + OUTLINE_GLSL_HEAD)
      .replace('// color space', GRADE_GLSL)
      .replace('// color space', OUTLINE_GLSL);
    m.needsUpdate = true;
    this.outline = new OutlineMaskPass(camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.outline);
    if (p.bloom > 0) this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  /** CSS size + effective pixel ratio (already including the dynamic resolution scale). */
  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  setOptions(o: PostOptions): void {
    if (o.bloom != null) { this.bloom.strength = o.bloom; this.bloom.enabled = o.bloom > 0; }
    if (o.threshold != null) this.bloom.threshold = o.threshold;
    if (o.radius != null) this.bloom.radius = o.radius;
    const hp = this.bloom.highPassUniforms as Record<string, THREE.IUniform>;
    if (o.knee != null) hp.smoothWidth.value = o.knee;
    if (o.clamp != null) hp.uClamp.value = o.clamp;
    const u = this.output.uniforms as Record<string, THREE.IUniform>;
    if (o.vignette != null) u.uVignette.value = o.vignette;
    if (o.warm != null) u.uWarm.value = o.warm;
  }

  render(dt: number): void { this.composer.render(dt); }

  dispose(): void {
    this.outline.dispose(); this.bloom.dispose(); this.output.dispose(); this.renderPass.dispose();
    this.composer.dispose(); this.target.dispose();
  }
}
