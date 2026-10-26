/** Live gameplay settings read by core and features (the UI writes localStorage and fires 'l3d:settings'). */
export const lsNum = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v == null ? d : (+v || d); } catch { return d; } };
export const lsStr = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const SET = { sens: 1, inv: false, names: 'all', bubbles: true, fov: 75 };
export function readSettings(): void {
  SET.sens = lsNum('l3d.sens', 1);
  SET.inv = lsStr('l3d.invertY', '0') === '1';
  SET.names = lsStr('l3d.names', 'all');
  SET.bubbles = lsStr('l3d.bubbles', '1') !== '0';
  SET.fov = lsNum('l3d.fov', 75);
}
readSettings();
