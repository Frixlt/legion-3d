import type { Item } from '../contracts';
export function selectionKey(login: string): string { return 'l3d.showcase.' + encodeURIComponent(login); }
export function presentSelection(ids: unknown, items: readonly Item[]): string[] {
  if (!Array.isArray(ids)) return [];
  const present = new Set(items.filter((i) => !i.on).map((i) => i.uid));
  const seen = new Set<string>();
  return ids.filter((x): x is string => typeof x === 'string' && present.has(x) && !seen.has(x) && !!seen.add(x)).slice(0, 3);
}
export function readSelection(login: string, items: readonly Item[]): string[] {
  try { return presentSelection(JSON.parse(localStorage.getItem(selectionKey(login)) || '[]'), items); } catch { return []; }
}
export function writeSelection(login: string, ids: readonly string[]): void {
  try { localStorage.setItem(selectionKey(login), JSON.stringify(ids)); } catch { /* */ }
}
