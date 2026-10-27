/** City-scoped map favourites, never a navigation action. */
export const favoriteKey = (town: string) => 'l3d.map.favorites.' + encodeURIComponent(town);
export function cleanFavorites(ids: unknown, valid: readonly string[]): string[] {
  if (!Array.isArray(ids)) return [];
  const allowed = new Set(valid), seen = new Set<string>();
  return ids.filter((x): x is string => typeof x === 'string' && allowed.has(x) && !seen.has(x) && !!seen.add(x)).slice(0, 5);
}
export function toggleFavorite(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 5 ? [...ids, id] : [...ids];
}
export function readFavorites(town: string, valid: readonly string[]): string[] {
  try { return cleanFavorites(JSON.parse(localStorage.getItem(favoriteKey(town)) || '[]'), valid); } catch { return []; }
}
export function writeFavorites(town: string, ids: readonly string[]): void {
  try { localStorage.setItem(favoriteKey(town), JSON.stringify(ids)); } catch { /* storage unavailable */ }
}
