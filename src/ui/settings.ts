/**
 * UI settings persisted in localStorage. Every key is stored individually (so other modules can read one key cheaply)
 * and the whole object is mirrored as JSON in 'l3d.settings' (GAME-DESIGN §4.9).
 * Changes are announced with window event 'l3d:settings' {detail: {key, value, settings}} and via onSettings(fn).
 */
export interface UiSettings {
  /** Mouse sensitivity multiplier 0.2..3 (default 1). key 'l3d.sens' */
  sens: number;
  /** Invert mouse Y. key 'l3d.invertY' */
  invertY: boolean;
  /** Field of view, degrees 60..90 (default 75). key 'l3d.fov' */
  fov: number;
  /** Default camera mode. key 'l3d.cam' */
  cam: 'fp' | 'tp';
  /** Render quality: 'auto' | 0..3. key 'l3d.quality' */
  quality: 'auto' | 0 | 1 | 2 | 3;
  /** Nameplates over heads: all / near / off. key 'l3d.names' */
  names: 'all' | 'near' | 'off';
  /** Chat bubbles over heads. key 'l3d.bubbles' */
  bubbles: boolean;
  /** UI scale 0.9..1.25. key 'l3d.uiScale' */
  uiScale: number;
  /** Round minimap in the HUD corner. key 'l3d.minimap' (off by default) */
  minimap: boolean;
}
export const SETTINGS_DEFAULTS: UiSettings = { sens: 1, invertY: false, fov: 75, cam: 'fp', quality: 'auto', names: 'all', bubbles: true, uiScale: 1, minimap: false };
export const SETTINGS_KEYS: Record<keyof UiSettings, string> = {
  sens: 'l3d.sens', invertY: 'l3d.invertY', fov: 'l3d.fov', cam: 'l3d.cam', quality: 'l3d.quality', names: 'l3d.names', bubbles: 'l3d.bubbles', uiScale: 'l3d.uiScale',
  minimap: 'l3d.minimap',
};

const ls = (): Storage | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

function parse<K extends keyof UiSettings>(k: K, raw: string | null): UiSettings[K] | undefined {
  if (raw == null) return undefined;
  const d = SETTINGS_DEFAULTS[k];
  try {
    if (typeof d === 'number') { const v = parseFloat(raw); return (Number.isFinite(v) ? v : undefined) as UiSettings[K] | undefined; }
    if (typeof d === 'boolean') return (raw === '1' || raw === 'true') as UiSettings[K];
    if (k === 'quality') return (raw === 'auto' ? 'auto' : Math.max(0, Math.min(3, parseInt(raw, 10) || 0))) as UiSettings[K];
    return raw as UiSettings[K];
  } catch { return undefined; }
}

export function loadSettings(): UiSettings {
  const s: UiSettings = { ...SETTINGS_DEFAULTS };
  const st = ls(); if (!st) return s;
  for (const k of Object.keys(SETTINGS_KEYS) as (keyof UiSettings)[]) {
    const v = parse(k, st.getItem(SETTINGS_KEYS[k]));
    if (v !== undefined) (s as any)[k] = v;
  }
  return s;
}

export function saveSetting<K extends keyof UiSettings>(s: UiSettings, k: K, v: UiSettings[K]): void {
  s[k] = v;
  const st = ls();
  if (st) {
    try {
      st.setItem(SETTINGS_KEYS[k], typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
      st.setItem('l3d.settings', JSON.stringify(s));
    } catch { /* quota / private mode */ }
  }
  try { window.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: k, value: v, settings: { ...s } } })); } catch { /* no window */ }
}
