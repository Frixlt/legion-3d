/**
 * Drift log: things the site has that we do not support yet (a new building id, an item look without a model,
 * an unknown room kind…). Every (kind, id) pair is reported ONCE per page: console.info + window event 'l3d:drift'
 * ({ kind, id, detail, at }), and kept in a list readable as `window.__l3dDrift` (and shown by the F3 overlay).
 * Offline counterpart: `npm run drift` (scripts/drift.mjs) compares the site's scripts with src/data/*.json.
 */
export interface DriftEntry { kind: string; id: string; detail?: unknown; at: number }

const seen = new Set<string>();
const list: DriftEntry[] = [];
const MAX = 200;

/** Report an unsupported id. Deduplicated by kind + id. Safe outside a browser (tests). */
export function reportDrift(kind: string, id: string, detail?: unknown): void {
  const key = kind + '\u0000' + id;
  if (seen.has(key)) return;
  seen.add(key);
  const e: DriftEntry = { kind, id, detail, at: Date.now() };
  if (list.length < MAX) list.push(e);
  try { console.info(`[l3d] drift: ${kind} "${id}" is not supported yet — using a fallback`, detail ?? ''); } catch { /* no console */ }
  const w = globalThis as { dispatchEvent?: (e: Event) => boolean; CustomEvent?: typeof CustomEvent };
  try { if (w.dispatchEvent && w.CustomEvent) w.dispatchEvent(new w.CustomEvent('l3d:drift', { detail: e })); } catch { /* no DOM */ }
}

/** All drift reported so far (oldest first). */
export function driftList(): readonly DriftEntry[] { return list; }

/** Tests only. */
export function _resetDrift(): void { seen.clear(); list.length = 0; }

try { Object.defineProperty(globalThis, '__l3dDrift', { get: () => list.slice(), configurable: true }); } catch { /* frozen global */ }
