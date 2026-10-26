import { describe, it, expect } from 'vitest';
import { moneyParts, moneyText, moneyCompact, plural, MUNIT, CATS_COINS } from '../src/ui/money';

describe('ui money formatter (site LGSiteUi.moneyParts rule)', () => {
  it('splits bronze into gold/silver/bronze, largest first, non-zero only', () => {
    expect(moneyParts(1708, 0, null)).toEqual([['s', 17, 'сер.'], ['b', 8, 'мед.']]);
    expect(moneyParts(10000, 0, null)).toEqual([['g', 1, 'зол.']]);
    expect(moneyParts(1234567, 0, null).map(([k, v]) => [k, v])).toEqual([['g', 123], ['s', 45], ['b', 67]]);
    expect(moneyParts(10005, 0, null).map(([k, v]) => [k, v])).toEqual([['g', 1], ['b', 5]]);
  });
  it('fixture money 1708 → «17 серебряных рыбок 8 чешуек» in the cats style', () => {
    expect(moneyText(1708, 0, CATS_COINS)).toBe('17 серебряных рыбок 8 чешуек');
  });
  it('uses Russian plural forms', () => {
    expect(moneyText(101, 0, CATS_COINS)).toBe('1 серебряная рыбка 1 чешуйка');
    expect(moneyText(20304, 0, CATS_COINS)).toBe('2 золотые рыбки 3 серебряные рыбки 4 чешуйки');
    expect(moneyText(1100 + 11, 0, CATS_COINS)).toBe('11 серебряных рыбок 11 чешуек');
    expect(plural(21, 'a', 'b', 'c')).toBe('a');
    expect(plural(112, 'a', 'b', 'c')).toBe('c');
    expect(plural(5, 'a', 'b', 'c')).toBe('c');
  });
  it('zero is printed in the unit of the reference price', () => {
    expect(moneyText(0, 0, CATS_COINS)).toBe('0 чешуек');
    expect(moneyText(0, 500, CATS_COINS)).toBe('0 серебряных рыбок');
    expect(moneyText(0, 25000, CATS_COINS)).toBe('0 золотых рыбок');
    expect(MUNIT(99)).toBe('b'); expect(MUNIT(100)).toBe('s'); expect(MUNIT(10000)).toBe('g');
  });
  it('clamps negatives and fractions; compact form has numbers only', () => {
    expect(moneyText(-5, 0, null)).toBe('0 мед.');
    expect(moneyText(150.9, 0, null)).toBe('1 сер. 50 мед.');
    expect(moneyCompact(1708)).toEqual([['s', 17], ['b', 8]]);
    expect(moneyCompact(0)).toEqual([['b', 0]]);
  });
});
