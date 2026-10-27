/**
 * A «Забавы» on/off setting row (Настройки → Забавы) with a live value: registerSettingRow + the 'l3d:settings'
 * event. `onChange` runs when the user flips it.
 */
import { registerSettingRow, settingValue } from '../ui/settings-ext';

export interface Toggle { readonly on: boolean; dispose(): void }

export function funToggle(key: string, label: string, sub: string, order: number, onChange?: (on: boolean) => void): Toggle {
  const offRow = registerSettingRow({ key, label, sub, group: 'Забавы', order, kind: 'seg', options: [['on', 'Вкл'], ['off', 'Выкл']], def: 'on' });
  let on = settingValue(key, 'on') === 'on';
  const fn = (e: Event) => {
    const d = (e as CustomEvent).detail;
    if (d?.key !== key) return;
    const v = d.value === 'on';
    if (v === on) return;
    on = v; onChange?.(v);
  };
  window.addEventListener('l3d:settings', fn);
  return {
    get on() { return on; },
    dispose() { window.removeEventListener('l3d:settings', fn); offRow(); },
  };
}

export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Dispatch a sound (src/audio/defs.ts id) at an optional world position. */
export function sfx(id: string, p?: { x: number; y: number; z: number }): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: p ? { id, x: p.x, y: p.y, z: p.z } : { id } }));
}
