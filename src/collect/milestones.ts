export interface JournalFact { id: string; at: number; k: string; t: string; r?: string }
export interface Milestone { id: string; at: number; label: string }
/** Describe only confirmed entries; the journal may be a partial page. */
export function milestones(entries: readonly JournalFact[]): Milestone[] {
  const unique = new Map<string, JournalFact>();
  for (const e of entries) if (e?.id && !unique.has(e.id)) unique.set(e.id, e);
  const wins = new Set<string>(), out: Milestone[] = [];
  for (const e of [...unique.values()].sort((a, b) => a.at - b.at)) {
    let label = '';
    if (e.k === 'hero' && /уров|level/i.test(e.t)) label = 'Новый уровень';
    else if ((e.k === 'loot' || e.k === 'find') && /редк|эпическ|легендарн/i.test(e.t)) label = 'Редкая находка';
    else if ((e.k === 'fight' || e.k === 'boss') && e.r === 'win') {
      const day = new Date(e.at).toDateString(); if (!wins.has(day)) { wins.add(day); label = 'Первая победа дня среди загруженных записей'; }
    }
    if (label) out.push({ id: e.id, at: e.at, label });
  }
  return out.reverse();
}
