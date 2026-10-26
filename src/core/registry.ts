/**
 * Generic registry (contract: Registry<T> in src/contracts/ext.ts). One per content kind: buildings, rooms, item
 * models, menu tabs, key bindings. `resolve(id)` falls back to the '*' entry (or the `fallback` given here) and
 * reports an unknown id once as drift (`<name>` kind).
 */
import type { Registry } from '../contracts/ext';
import type { Unsub } from '../contracts';
import { reportDrift } from './drift';

export const FALLBACK_ID = '*';

export function createRegistry<T>(name: string, fallback?: T): Registry<T> {
  const map = new Map<string, T>();
  const subs = new Set<() => void>();
  const changed = () => { for (const f of [...subs]) { try { f(); } catch (e) { console.error(`[l3d] registry ${name} listener`, e); } } };
  if (fallback !== undefined) map.set(FALLBACK_ID, fallback);

  const reg: Registry<T> = {
    name,
    register(id, def) {
      map.set(id, def);
      changed();
      return () => { if (map.get(id) === def) { map.delete(id); changed(); } };
    },
    get: (id) => map.get(id),
    resolve(id) {
      const v = map.get(id);
      if (v !== undefined) return v;
      reportDrift(name, id);
      const fb = map.get(FALLBACK_ID);
      if (fb === undefined) throw new Error(`[l3d] registry ${name}: unknown id "${id}" and no fallback`);
      return fb;
    },
    has: (id) => map.has(id),
    ids: () => [...map.keys()].filter((k) => k !== FALLBACK_ID),
    onChange(fn): Unsub { subs.add(fn); return () => { subs.delete(fn); }; },
  };
  return reg;
}
