/**
 * SoundEngine: the WebAudio graph. Works on any BaseAudioContext (the live AudioContext, or an OfflineAudioContext
 * for the measured mix in dev/sound.html).
 *
 *   beds ─ crickets ┐
 *          wind ────┼─ outside ─ low-pass (walls) ─┐
 *          crowd ───┘                              │
 *          room tone (brown noise, low-passed) ────┼─ amb bus ──┐
 *          fire (positional at the hearth) ────────┤            │
 *          cave drips ─────────────────────────────┘            │
 *   one-shots ─ [low-pass] ─ gain ─ [panner] ─ sfx / ui / voice ┼─ master (volume × mute) ─ limiter ─ out
 *   sfx + voice ─ reverb send (per space) ─ convolver ──────────┘
 *
 * Every level change is a setTargetAtTime ramp (no zipper noise, no clicks). Positional one-shots use a PannerNode
 * ('HRTF' when opts.hrtf() — quality ≥ 2 — else 'equalpower'), inverse distance falloff, and are skipped beyond
 * their maxDist. Variation: a variant never repeats twice in a row, ±gain/±pitch jitter per hit, cooldowns.
 *
 * Video capture (src/audio/capture.ts): when the page sets window.__VT_AUDIO_LOG, the engine logs every voice it starts,
 * every named level ramp, bed offsets and the listener pose; replay(log) rebuilds the same graph offline.
 */
import { type Bus, type SfxDef, sfxDef, BED, BUS_TRIM, MAKEUP_DB } from './defs';
import { AMB, Cooldowns, Rng, VariantPicker, dbToGain, jitter, sliderGain, type Space } from './mix';
import { impulseResponse } from './dsp';
import type { Bank } from './bank';
import { captureSink, r4, type AudioLogEvent, type VoiceRec } from './capture';

export interface PlayOpts {
  /** Start time on the context clock (default now). */
  at?: number;
  /** Extra delay (s). */
  delay?: number;
  /** World position → positional (panned, distance falloff). Absent = centred (own sounds, UI). */
  x?: number; y?: number; z?: number;
  /** Gain / rate multipliers on top of the definition. */
  gain?: number; rate?: number;
  /** Cooldown key (default the id): per-source limits, e.g. 'step:<login>'. */
  key?: string;
  /** Own sound: allowed even when the voice limit is reached. */
  own?: boolean;
}
export interface EngineOpts { hrtf?: () => boolean; seed?: number; maxVoices?: number }
export interface Volumes { master: number; amb: number; sfx: number; ui: number }

const BUSES: Bus[] = ['amb', 'sfx', 'ui', 'voice'];

export class SoundEngine {
  readonly rng: Rng;
  private picker: VariantPicker;
  private cds = new Cooldowns();
  private master: GainNode;
  private limiter: DynamicsCompressorNode;
  private bus = {} as Record<Bus, GainNode>;
  private revSend: GainNode;
  private conv: ConvolverNode;
  private outSum: GainNode; private outLP: BiquadFilterNode; private outGain: GainNode;
  private gCrickets: GainNode; private gWind: GainNode; private gCrowd: GainNode;
  private rtGain: GainNode; private fireGain: GainNode; private firePan: PannerNode; private caveGain: GainNode; private ambDuck: GainNode;
  private beds: AudioBufferSourceNode[] = [];
  /** End times (context clock) of the playing one-shots: the voice limit works for sounds scheduled ahead too. */
  private ends: number[] = [];
  private vol: Volumes = { master: 0.4, amb: 1, sfx: 1, ui: 1 };
  private muted = false;
  private firePos: { x: number; y: number; z: number } | null = null;
  /** Listener position (for culling). */
  lx = 0; ly = 0; lz = 0;
  space: Space = 'street';
  private gustT = 0; private creakT = 30; private meowT = 120;
  private disposed = false;
  /** Video capture log (null in normal play) and the names of the logged params. */
  private cap: AudioLogEvent[] | null = captureSink();
  private pnames = new Map<AudioParam, string>();
  private pbyName = new Map<string, AudioParam>();

  constructor(readonly ac: BaseAudioContext, readonly bank: Bank, private opts: EngineOpts = {}) {
    this.rng = new Rng(opts.seed ?? 0x51ed);
    this.picker = new VariantPicker(this.rng);
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
    this.limiter = ac.createDynamicsCompressor();
    // a safety limiter: transparent at the default volume, catches stacked hits near full volume
    this.limiter.threshold.value = -4; this.limiter.knee.value = 3; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.2;
    this.master = g(0);
    this.master.connect(this.limiter); this.limiter.connect(ac.destination);
    for (const b of BUSES) { this.bus[b] = g(1); this.bus[b].connect(this.master); }
    this.ambDuck = g(1); this.ambDuck.connect(this.bus.amb);
    // reverb (room size depends on the space)
    this.conv = ac.createConvolver(); this.conv.normalize = false;
    const ir = impulseResponse(ac.sampleRate, 1.4);
    const irb = ac.createBuffer(2, ir[0].length, ac.sampleRate); ir.forEach((c, i) => irb.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    this.conv.buffer = irb;
    this.revSend = g(AMB.street.reverb);
    this.bus.sfx.connect(this.revSend); this.bus.voice.connect(this.revSend);
    this.revSend.connect(this.conv); this.conv.connect(this.master);
    // beds
    this.outSum = g(1);
    this.outLP = ac.createBiquadFilter(); this.outLP.type = 'lowpass'; this.outLP.frequency.value = AMB.street.outLP; this.outLP.Q.value = 0.5;
    this.outGain = g(AMB.street.outside);
    this.outSum.connect(this.outLP); this.outLP.connect(this.outGain); this.outGain.connect(this.ambDuck);
    this.gCrickets = g(BED.crickets); this.gWind = g(BED.wind); this.gCrowd = g(BED.crowd);
    for (const n of [this.gCrickets, this.gWind, this.gCrowd]) n.connect(this.outSum);
    this.rtGain = g(0);
    const rtLP = ac.createBiquadFilter(); rtLP.type = 'lowpass'; rtLP.frequency.value = 260; rtLP.Q.value = 0.4;
    rtLP.connect(this.rtGain); this.rtGain.connect(this.ambDuck);
    this.fireGain = g(0);
    this.firePan = this.panner(1.6, 25);
    this.fireGain.connect(this.firePan); this.firePan.connect(this.ambDuck);
    this.caveGain = g(0); this.caveGain.connect(this.ambDuck);
    this.bedIns = { bed_crickets: this.gCrickets, bed_wind: this.gWind, bed_crowd: this.gCrowd, '@roomtone': rtLP, bed_fire: this.fireGain, bed_cave: this.caveGain };
    const named: [string, AudioParam][] = [['master', this.master.gain], ['duck', this.ambDuck.gain], ['outside', this.outGain.gain], ['outLP', this.outLP.frequency],
      ['roomtone', this.rtGain.gain], ['fire', this.fireGain.gain], ['cave', this.caveGain.gain], ['reverb', this.revSend.gain],
      ['crickets', this.gCrickets.gain], ['wind', this.gWind.gain], ['crowd', this.gCrowd.gain], ...BUSES.map((b) => ['bus.' + b, this.bus[b].gain] as [string, AudioParam])];
    for (const [n, p] of named) { this.pnames.set(p, n); this.pbyName.set(n, p); }
    this.cap?.push({ k: 'init', t: r4(this.now()), sr: ac.sampleRate, hrtf: !!opts.hrtf?.() });
    this.applyVolumes(0);
  }
  private bedIns: Record<string, AudioNode>;

  private now(): number { return this.ac.currentTime; }
  private ramp(p: AudioParam, v: number, tc: number, at = this.now()): void {
    if (this.cap) { const n = this.pnames.get(p); if (n) this.cap.push({ k: 'ramp', t: r4(at), p: n, v: r4(v), tc }); }
    const pp = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
    if (typeof pp.cancelAndHoldAtTime === 'function') pp.cancelAndHoldAtTime(at); else { p.cancelScheduledValues(at); p.setValueAtTime(p.value, at); }
    if (tc <= 0) p.setValueAtTime(v, at); else p.setTargetAtTime(v, at, tc);
  }
  private panner(ref: number, max: number): PannerNode {
    const p = this.ac.createPanner();
    p.panningModel = this.opts.hrtf?.() ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.2;
    return p;
  }
  private setPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else (p as unknown as { setPosition(a: number, b: number, c: number): void }).setPosition(x, y, z);
  }

  /** Start the looping beds (once the bank has them). Each starts at a random offset. */
  startBeds(at = this.now()): void {
    if (this.beds.length || this.disposed) return;
    for (const [k, dst] of Object.entries(this.bedIns)) {
      const buf = this.bank.get(k); if (!buf) continue;
      const s = this.ac.createBufferSource(); s.buffer = buf; s.loop = true;
      const off = this.rng.next() * buf.duration;
      s.connect(dst); s.start(at, off);
      this.beds.push(s);
      this.cap?.push({ k: 'bed', t: r4(at), key: k, off });
    }
    this.setSpace(this.space, at, 0);
  }

  /** Cross-fade the ambience to a space (street ⇄ shop ⇄ mine…). tc = time constant (s). */
  setSpace(space: Space, at = this.now(), tc = 0.5): void {
    this.space = space;
    this.cap?.push({ k: 'space', t: r4(at), space });
    const a = AMB[space];
    this.ramp(this.outGain.gain, a.outside, tc, at);
    this.ramp(this.outLP.frequency, a.outLP, tc, at);
    this.ramp(this.rtGain.gain, a.roomtone * BED.roomtone, tc, at);
    this.ramp(this.fireGain.gain, a.fire * BED.fire, tc, at);
    this.ramp(this.caveGain.gain, a.cave * BED.cave, tc, at);
    this.ramp(this.revSend.gain, a.reverb, tc, at);
    if (space !== 'forge') this.firePos = null;
  }
  /** Fire (forge hearth) position; null = centred on the listener. */
  setFire(p: { x: number; y: number; z: number } | null): void {
    this.firePos = p ? { x: p.x, y: p.y, z: p.z } : null;
    this.cap?.push({ k: 'fire', t: r4(this.now()), p: p ? [r4(p.x), r4(p.y), r4(p.z)] : null });
  }

  /** Listener = camera: position and forward direction (up is +Y). Call once per frame. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    this.lx = x; this.ly = y; this.lz = z;
    this.cap?.push({ k: 'lis', t: r4(this.now()), p: [r4(x), r4(y), r4(z), r4(fx), r4(fy), r4(fz)] });
    const L = this.ac.listener;
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      const l = L as unknown as { setPosition(a: number, b: number, c: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
    const f = this.firePos;
    if (f) this.setPos(this.firePan, f.x, f.y, f.z); else this.setPos(this.firePan, x, y, z);
  }

  setVolumes(v: Partial<Volumes>, tc = 0.08): void { Object.assign(this.vol, v); this.applyVolumes(tc); }
  get volumes(): Volumes { return { ...this.vol }; }
  setMuted(m: boolean, tc = 0.12): void { if (m !== this.muted) { this.muted = m; this.applyVolumes(tc); } }
  get isMuted(): boolean { return this.muted; }
  /** Duck the ambience (a menu is open): 1 = none. */
  setDuck(d: number): void { this.ramp(this.ambDuck.gain, d, 0.25); }
  private applyVolumes(tc: number): void {
    this.ramp(this.master.gain, this.muted ? 0 : sliderGain(this.vol.master) * dbToGain(MAKEUP_DB), tc);
    this.ramp(this.bus.amb.gain, sliderGain(this.vol.amb) * BUS_TRIM.amb, tc);
    this.ramp(this.bus.sfx.gain, sliderGain(this.vol.sfx) * BUS_TRIM.sfx, tc);
    this.ramp(this.bus.voice.gain, sliderGain(this.vol.sfx) * BUS_TRIM.voice, tc);
    this.ramp(this.bus.ui.gain, sliderGain(this.vol.ui) * BUS_TRIM.ui, tc);
  }

  /** Play a one-shot. Returns false when skipped (unknown id, cooldown, too far, voice limit, not decoded). */
  play(id: string, o: PlayOpts = {}): boolean {
    if (this.disposed) return false;
    const def: SfxDef | undefined = sfxDef(id);
    if (!def) return false;
    const at = (o.at ?? this.now()) + (o.delay ?? 0);
    const pos = o.x !== undefined && o.y !== undefined && o.z !== undefined;
    if (pos) {
      const dx = o.x! - this.lx, dy = o.y! - this.ly, dz = o.z! - this.lz;
      if (dx * dx + dy * dy + dz * dz > (def.maxDist ?? 30) ** 2) return false;
    }
    if (this.ends.length > 64) this.ends = this.ends.filter((t) => t > at);
    let busy = 0; for (let i = 0; i < this.ends.length; i++) if (this.ends[i] > at) busy++;
    if (busy >= (this.opts.maxVoices ?? 24) && !o.own) return false;
    if (!this.cds.take(o.key ?? id, at, def.cooldown ?? 0)) return false;
    const file = def.files[this.picker.pick(id, def.files.length)];
    const buf = this.bank.get(file);
    if (!buf) return false;
    const v: VoiceRec = {
      id, file, bus: def.bus, lp: def.lp ?? 0, ref: def.ref ?? 2, max: def.maxDist ?? 30, hrtf: !!this.opts.hrtf?.(),
      rate: (def.rate ?? 1) * (o.rate ?? 1) * jitter(this.rng, def.rateVar ?? 0),
      gain: dbToGain(def.db) * (o.gain ?? 1) * jitter(this.rng, def.gainVar ?? 0),
      ...(pos ? { pos: [o.x!, o.y!, o.z!] as [number, number, number] } : {}),
    };
    this.ends.push(at + buf.duration / v.rate);
    this.cap?.push({ k: 'voice', t: r4(at), ...v, ...(v.pos ? { pos: v.pos.map(r4) as [number, number, number] } : {}) });
    this.voice(v, buf, at);
    this.played[id] = (this.played[id] || 0) + 1;
    return true;
  }
  /** Build and start one voice: source ─ [low-pass] ─ gain ─ [panner] ─ bus. */
  private voice(v: VoiceRec, buf: AudioBuffer, at: number): void {
    const ac = this.ac;
    const src = ac.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = v.rate;
    const gn = ac.createGain(); gn.gain.value = v.gain;
    let head: AudioNode = src;
    let lp: BiquadFilterNode | null = null, pan: PannerNode | null = null;
    if (v.lp) { lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = v.lp; lp.Q.value = 0.5; head.connect(lp); head = lp; }
    head.connect(gn); head = gn;
    if (v.pos) {
      pan = this.panner(v.ref, v.max); pan.panningModel = v.hrtf ? 'HRTF' : 'equalpower';
      this.setPos(pan, v.pos[0], v.pos[1], v.pos[2]); head.connect(pan); head = pan;
    }
    head.connect(this.bus[v.bus]);
    src.onended = () => { src.disconnect(); lp?.disconnect(); gn.disconnect(); pan?.disconnect(); };
    src.start(at);
  }

  /**
   * Rebuild a captured session (capture.ts) on this engine's context — normally an OfflineAudioContext — shifted by
   * `shift` seconds (log time t plays at t + shift; events before 0 are applied at 0). Makes no decisions of its own:
   * the RNG, cooldowns, culling and the voice limit are not consulted. Returns how many voices were scheduled.
   */
  replay(log: readonly AudioLogEvent[], shift = 0): number {
    let n = 0;
    const T = (t: number) => Math.max(0, t + shift);
    const L = this.ac.listener;
    const lp = L.positionX ? [L.positionX, L.positionY, L.positionZ, L.forwardX, L.forwardY, L.forwardZ] : null;
    if (lp) { L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    const fp = this.firePan.positionX ? [this.firePan.positionX, this.firePan.positionY, this.firePan.positionZ] : null;
    let fire: [number, number, number] | null = null;
    for (const e of log) {
      switch (e.k) {
        case 'ramp': { const p = this.pbyName.get(e.p); if (p) this.ramp(p, e.v, e.tc, T(e.t)); break; }
        case 'bed': {
          const buf = this.bank.get(e.key), dst = this.bedIns[e.key];
          if (!buf || !dst) break;
          const s = this.ac.createBufferSource(); s.buffer = buf; s.loop = true;
          // a bed that started before the render window: advance its offset by the time cut off
          const cut = Math.max(0, -(e.t + shift));
          s.connect(dst); s.start(T(e.t), (e.off + cut) % buf.duration);
          this.beds.push(s);
          break;
        }
        case 'space': this.space = e.space; if (e.space !== 'forge') fire = null; break;
        case 'fire': fire = e.p; break;
        case 'lis': {
          const t = T(e.t), p = e.p;
          if (lp) for (let i = 0; i < 6; i++) lp[i].setValueAtTime(p[i], t);
          if (fp) { const f = fire || [p[0], p[1], p[2]]; for (let i = 0; i < 3; i++) fp[i].setValueAtTime(f[i], t); }
          break;
        }
        case 'voice': {
          if (e.t + shift < 0) break;
          const buf = this.bank.get(e.file); if (!buf) break;
          this.voice(e, buf, T(e.t)); n++;
          break;
        }
        default: break;
      }
    }
    return n;
  }
  /** How many times each id actually played (dev / tests). */
  readonly played: Record<string, number> = {};
  get activeVoices(): number { const t = this.now(); let n = 0; for (const e of this.ends) if (e > t) n++; return n; }

  /** Ambience life: wind gusts and rare one-shots (a wooden creak, a far-away cat). Call with the frame dt. */
  tick(dt: number, at = this.now()): void {
    if (this.disposed || !this.beds.length) return;
    const r = this.rng;
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = r.range(3, 7); this.ramp(this.gWind.gain, BED.wind * r.range(0.55, 1.25), r.range(1.2, 2.4), at); }
    const s = this.space;
    if (s === 'mine' || s === 'tent') return;
    this.creakT -= dt; this.meowT -= dt;
    const around = (d0: number, d1: number) => { const a = r.next() * Math.PI * 2, d = r.range(d0, d1); return { x: this.lx + Math.cos(a) * d, y: this.ly + r.range(-0.5, 2), z: this.lz + Math.sin(a) * d }; };
    if (this.creakT <= 0) {
      this.creakT = s === 'street' ? r.range(25, 70) : r.range(35, 90);
      this.play('amb.creak', { at, ...(s === 'street' ? around(6, 14) : around(2.5, 5)) });
    }
    if (this.meowT <= 0) {
      this.meowT = r.range(90, 240);
      if (s === 'street') this.play('amb.meow', { at, ...around(14, 24) });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.beds) { try { s.stop(); } catch { /* */ } s.disconnect(); }
    this.beds.length = 0;
    try { this.master.disconnect(); this.limiter.disconnect(); } catch { /* */ }
  }
}
