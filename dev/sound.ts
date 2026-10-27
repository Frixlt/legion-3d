/**
 * Sound audition page (dist-dev/sound.html): play every sound, switch the ambience spaces, try volumes, run the
 * 30-second walk live, and render it offline with a loudness report (also used by src/audio/tools/mix-report.mjs
 * through window.__sound).
 */
import { SoundEngine, loadBank, SFX, BED, loudness, type Bank, type Space } from '../src/audio';
import { runScenario } from '../src/audio/scenario';

const $ = (h: string) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild as HTMLElement; };
const app = document.getElementById('app')!;
let ac: AudioContext | null = null, eng: SoundEngine | null = null;
const bank: Bank = new Map();

async function live(): Promise<SoundEngine> {
  if (eng) return eng;
  ac = new AudioContext({ latencyHint: 'interactive' });
  await loadBank(ac, bank);
  eng = new SoundEngine(ac, bank, { hrtf: () => (document.getElementById('hrtf') as HTMLInputElement).checked });
  eng.setVolumes(vols(), 0); eng.setMuted(false, 0.5);
  eng.setListener(0, 1.15, 0, 0, 0, -1);
  eng.startBeds();
  setInterval(() => eng!.tick(0.25), 250);
  return eng;
}
const vols = () => {
  const v = (id: string) => +(document.getElementById(id) as HTMLInputElement).value / 100;
  return { master: v('v-master'), amb: v('v-amb'), sfx: v('v-sfx'), ui: v('v-ui') };
};

function wav(chs: Float32Array[], sr: number): Uint8Array {
  const n = chs[0].length, c = chs.length, b = new ArrayBuffer(44 + n * c * 2), d = new DataView(b);
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); d.setUint32(4, 36 + n * c * 2, true); s(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
  d.setUint16(22, c, true); d.setUint32(24, sr, true); d.setUint32(28, sr * c * 2, true); d.setUint16(32, c * 2, true); d.setUint16(34, 16, true);
  s(36, 'data'); d.setUint32(40, n * c * 2, true);
  let o = 44; for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) { const v = Math.max(-1, Math.min(1, chs[k][i])); d.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Uint8Array(b);
}
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

/** Render a scenario offline. stem: 'mix' | 'amb' (beds only) | 'fx' (everything but the beds). */
async function render(name: 'walk' | 'mine', stem: 'mix' | 'amb' | 'fx' = 'mix', v = { master: 0.1, amb: 1, sfx: 1, ui: 1 }) {
  const sr = 48000, secs = name === 'walk' ? 30 : 12;
  const oac = new OfflineAudioContext(2, sr * secs, sr);
  const b = await loadBank(oac, new Map());
  const e = new SoundEngine(oac, b, { seed: 7 });
  e.setVolumes({ ...v, ...(stem === 'amb' ? { sfx: 0, ui: 0 } : stem === 'fx' ? { amb: 0 } : {}) }, 0);
  e.setMuted(false, 0);
  e.startBeds(0);
  runScenario(name, e, 0);
  const buf = await oac.startRendering();
  const chs = [buf.getChannelData(0), buf.getChannelData(1)];
  return { L: loudness(chs, sr), chs, sr };
}
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '−∞');

async function report(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const name of ['walk', 'mine'] as const) {
    const mix = await render(name), amb = await render(name, 'amb'), fx = await render(name, 'fx'), full = await render(name, 'mix', { master: 1, amb: 1, sfx: 1, ui: 1 });
    out[name] = {
      default40: { integratedLUFS: +fmt(mix.L.integrated), shortTermMaxLUFS: +fmt(mix.L.shortTermMax), momentaryMaxLUFS: +fmt(mix.L.momentaryMax), samplePeakDb: +fmt(mix.L.samplePeakDb) },
      stems40: { ambIntegrated: +fmt(amb.L.integrated), ambPeakDb: +fmt(amb.L.samplePeakDb), fxIntegrated: +fmt(fx.L.integrated), fxMomentaryMax: +fmt(fx.L.momentaryMax), fxPeakDb: +fmt(fx.L.samplePeakDb) },
      full100: { integratedLUFS: +fmt(full.L.integrated), samplePeakDb: +fmt(full.L.samplePeakDb) },
    };
    (window as unknown as Record<string, unknown>)['__wav_' + name] = b64(wav(mix.chs, mix.sr));
  }
  return out;
}

/* ---------------------------------------------------------------- UI */
app.append($(`<h1>Legion 3D · звук</h1>`));
app.append($(`<p class="sub">Нажмите любую кнопку — звук включится (политика автозапуска). Позиционные звуки играются слева / справа в 4 м.</p>`));
const sliders = $(`<div class="row"></div>`);
for (const [id, label, def] of [['v-master', 'Общая', 40], ['v-amb', 'Окружение', 100], ['v-sfx', 'Эффекты', 100], ['v-ui', 'Интерфейс', 100]] as const) {
  const l = $(`<label>${label} <input type="range" id="${id}" min="0" max="100" step="5" value="${def}"><span>${def}%</span></label>`);
  const inp = l.querySelector('input')!, sp = l.querySelector('span')!;
  inp.oninput = () => { sp.textContent = inp.value + '%'; eng?.setVolumes(vols()); };
  sliders.append(l);
}
sliders.append($(`<label><input type="checkbox" id="hrtf" checked> HRTF</label>`));
app.append(sliders);

app.append($(`<h2>Пространство</h2>`));
const spaces = $(`<div class="row"></div>`);
for (const [s, t] of [['street', 'Улица'], ['shop', 'Лавка'], ['forge', 'Кузня (огонь слева)'], ['tent', 'Шатёр'], ['mine', 'Шахта']] as [Space, string][]) {
  const b = $(`<button>${t}</button>`) as HTMLButtonElement;
  b.onclick = async () => { const e = await live(); e.setSpace(s); e.setFire(s === 'forge' ? { x: -2, y: 1, z: -2 } : null); };
  spaces.append(b);
}
const mute = $(`<button>Тишина / звук</button>`) as HTMLButtonElement;
mute.onclick = async () => { const e = await live(); e.setMuted(!e.isMuted, 0.3); };
spaces.append(mute);
app.append(spaces);

app.append($(`<h2>Звуки</h2>`));
const grid = $(`<div class="grid"></div>`);
for (const id of Object.keys(SFX)) {
  const row = $(`<div class="cell"><b>${id}</b></div>`);
  for (const [t, pos] of [['▶', null], ['◀ 4 м', { x: -4, y: 1, z: -1 }], ['4 м ▶', { x: 4, y: 1, z: -1 }]] as const) {
    const b = $(`<button>${t}</button>`) as HTMLButtonElement;
    b.onclick = async () => { const e = await live(); e.play(id, pos ? { ...pos } : {}); };
    row.append(b);
  }
  grid.append(row);
}
app.append(grid);

app.append($(`<h2>Сценарии</h2>`));
const sc = $(`<div class="row"></div>`);
const pre = $(`<pre id="report">—</pre>`);
for (const name of ['walk', 'mine'] as const) {
  const b = $(`<button>${name === 'walk' ? 'Прогулка 30 с' : 'Шахта 12 с'} (вживую)</button>`) as HTMLButtonElement;
  b.onclick = async () => { const e = await live(); runScenario(name, e, e.ac.currentTime + 0.1); };
  sc.append(b);
}
const rb = $(`<button>Офлайн-рендер + громкость</button>`) as HTMLButtonElement;
rb.onclick = async () => { pre.textContent = 'рендер…'; const r = await report(); pre.textContent = JSON.stringify(r, null, 2); };
sc.append(rb);
app.append(sc, pre);

(window as unknown as { __sound: unknown }).__sound = { report, render, live, BED, SFX, SoundEngine, loadBank };
