export interface Medal { icon: string; name: string }
/** Only already-present awards; no guesses about locked achievements. */
export function earnedMedals(hero: Record<string, unknown> | null): Medal[] {
  if (!hero) return [];
  const raw = hero.aw;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
    .filter((v) => v.earned !== false && v.on !== false)
    .map((v) => ({ icon: String(v.icon || v.i || '🏅').slice(0, 8), name: String(v.name || v.n || v.title || 'Награда').slice(0, 80) }));
}
