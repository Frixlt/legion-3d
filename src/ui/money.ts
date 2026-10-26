/**
 * Money formatting — exact re-implementation of the site rule (LGSiteUi.moneyParts, site-ui.js).
 * money is an integer in the smallest unit (bronze). 1 gold = 100 silver = 10 000 bronze.
 * Pure module: no DOM, safe for tests.
 */
export type CoinKey = 'g' | 's' | 'b';
/** Style coins as the site's MDDoodle.part('coins') returns them: { g|s|b: { forms: [one, few, many], color?, emoji? }, svg?(k, size) }. */
export interface CoinStyle {
  g?: { forms?: [string, string, string] | string[]; color?: string; emoji?: string };
  s?: { forms?: [string, string, string] | string[]; color?: string; emoji?: string };
  b?: { forms?: [string, string, string] | string[]; color?: string; emoji?: string };
  svg?: (k: CoinKey, size?: number) => string;
}

/** Russian plural: 1 рыбка / 2 рыбки / 5 рыбок (word only). Same as site ui-kit plural(). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(Number(n) || 0)), m10 = a % 10, m100 = a % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

/** Unit used to print a zero amount compared against `ref`. */
export const MUNIT = (n: number): CoinKey => (n >= 10000 ? 'g' : n >= 100 ? 's' : 'b');
const FB: Record<CoinKey, string> = { g: 'зол.', s: 'сер.', b: 'мед.' };

/** Cats style coins — fallback forms when the site's style part is unavailable (dev/tests). */
export const CATS_COINS: CoinStyle = {
  b: { forms: ['чешуйка', 'чешуйки', 'чешуек'], color: '#c07a44', emoji: '🟤' },
  s: { forms: ['серебряная рыбка', 'серебряные рыбки', 'серебряных рыбок'], color: '#c8ccd8', emoji: '⚪' },
  g: { forms: ['золотая рыбка', 'золотые рыбки', 'золотых рыбок'], color: '#f2c14e', emoji: '🟡' },
};

/** [[unit, value, word]] — non-zero parts, largest first; zero → one part in the unit of `ref`. */
export function moneyParts(n: number, ref?: number, coins?: CoinStyle | null): [CoinKey, number, string][] {
  n = Math.max(0, Math.floor(+n || 0));
  const g = Math.floor(n / 10000), s = Math.floor(n / 100) % 100, b = n % 100;
  const C = coins || {};
  const w = (k: CoinKey, v: number) => {
    const f = C[k] && C[k]!.forms;
    return f && f.length >= 3 ? plural(v, f[0], f[1], f[2]) : FB[k];
  };
  const out: [CoinKey, number][] = ([['g', g], ['s', s], ['b', b]] as [CoinKey, number][]).filter(([, v]) => v > 0);
  if (!out.length) out.push([MUNIT(Math.max(0, Math.floor(+(ref || 0) || 0))), 0]);
  return out.map(([k, v]) => [k, v, w(k, v)]);
}

/** «17 серебряных рыбок 8 чешуек». */
export function moneyText(n: number, ref?: number, coins?: CoinStyle | null): string {
  return moneyParts(n, ref, coins).map(([, v, t]) => `${v} ${t}`).join(' ');
}

/** Compact HUD form: only non-zero parts, numbers only: [['s',17],['b',8]]; zero → [['b',0]]. */
export function moneyCompact(n: number): [CoinKey, number][] {
  return moneyParts(n, 0, null).map(([k, v]) => [k, v]);
}

/** Signed delta text for floating "+12" (in the largest unit that makes sense). */
export function moneyDeltaText(d: number, coins?: CoinStyle | null): string {
  const sign = d < 0 ? '−' : '+';
  return sign + moneyText(Math.abs(d), Math.abs(d), coins);
}
