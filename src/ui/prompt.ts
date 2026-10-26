/**
 * Crosshair prompt text → HTML. The interact system drives `ui.prompt(text)` with plain strings like
 * «[E] Войти: Кузня», «[ЛКМ] Купить: Коготок — 4 серебра · [ПКМ] Осмотреть». Every `[…]` becomes a keycap.
 * A leading `!` marks a disabled target («!Кузня — скоро откроется») → muted style. Pure, unit-tested.
 */
import { esc } from './data';

export interface PromptView { html: string; muted: boolean }

const MOUSE: Record<string, string> = { 'ЛКМ': 'l', 'ПКМ': 'r', LMB: 'l', RMB: 'r' };

export function promptView(text: string): PromptView {
  let t = text.trim();
  const muted = t.startsWith('!');
  if (muted) t = t.slice(1).trimStart();
  let html = '';
  const re = /\[([^\]]{1,8})\]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) html += seg(t.slice(last, m.index));
    const k = m[1].trim(), mb = MOUSE[k.toUpperCase()] || MOUSE[k];
    html += mb ? `<i class="kc mb ${mb}"><b></b>${mb === 'l' ? 'ЛКМ' : 'ПКМ'}</i>` : `<i class="kc">${esc(k)}</i>`;
    last = m.index + m[0].length;
  }
  if (last < t.length) html += seg(t.slice(last));
  return { html, muted };
}
/** Plain text piece; «·» separates actions. */
function seg(s: string): string {
  return s.split('·').map((p, i) => (i ? '<span class="psep"></span>' : '') + (p.trim() ? `<span>${esc(p.trim())}</span>` : '')).join('');
}
