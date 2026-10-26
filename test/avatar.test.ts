import { describe, it, expect } from 'vitest';
import { appearanceFrom, nickDefaults, normColor, CATALOG } from '../src/avatar/appearance';
import me from './fixtures/me.json';
import session from './fixtures/city-session.json';

describe('normColor', () => {
  it('handles hex, short hex, hsl with spaces and commas, rgb', () => {
    expect(normColor('#FFB27A')).toBe('#ffb27a');
    expect(normColor('#abc')).toBe('#aabbcc');
    expect(normColor('hsl(0 100% 50%)')).toBe('#ff0000');
    expect(normColor('hsl(120, 100%, 25%)')).toBe('#008000');
    expect(normColor('rgb(1, 2, 3)')).toBe('#010203');
    expect(normColor('nope')).toBeNull();
    expect(normColor(undefined)).toBeNull();
  });
});

describe('nickDefaults', () => {
  it('is stable per login and case-insensitive', () => {
    expect(nickDefaults('SomeCat', 'cats')).toEqual(nickDefaults('somecat', 'cats'));
    expect(nickDefaults('@somecat', 'cats')).toEqual(nickDefaults('somecat', 'cats'));
  });
  it('picks values from the catalog', () => {
    for (const login of ['a', 'b', 'player1', 'кот', 'zzz']) {
      for (const st of ['cats', 'legion', 'monkeys']) {
        const d = nickDefaults(login, st);
        expect(CATALOG.shapes).toContain(d.shape);
        expect(CATALOG.mouths).toContain(d.mouth);
        expect(d.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(d.color2).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
  it('varies across logins', () => {
    const shapes = new Set(Array.from({ length: 60 }, (_, i) => nickDefaults('user' + i, 'cats').shape));
    expect(shapes.size).toBeGreaterThan(3);
  });
});

describe('appearanceFrom', () => {
  it('resolves a walker with a partial look', () => {
    const w = (session as any).enter.a[0];
    const app = appearanceFrom(w.l, w, 'cats');
    expect(app.login).toBe(w.l);
    expect(app.name).toBe(w.n);
    expect(app.level).toBe(w.lv);
    expect(app.look.mouth).toBe('grin');            // from lk
    expect(CATALOG.shapes).toContain(app.look.shape); // derived
    expect(app.look.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(app.gear.w).toBe('kris');
    expect(app.gear.h).toBe('miner');
    expect(app.ghost).toBe(false);
    expect(app.styleId).toBe('cats');
  });

  it('resolves every walker of the session fixture', () => {
    for (const w of (session as any).enter.a) {
      const app = appearanceFrom(w.l, w, 'cats');
      for (const k of ['shape', 'color', 'color2', 'eyes', 'mouth', 'hat', 'accColor', 'capeColor'] as const) expect(app.look[k]).toBeTruthy();
      expect(typeof app.look.blush).toBe('boolean');
      expect(Array.isArray(app.look.acc)).toBe(true);
      if (w.lk && w.lk.shape) expect(app.look.shape).toBe(w.lk.shape);
      if (w.lk && w.lk.color) expect(app.look.color).toBe(w.lk.color);
    }
  });

  it('resolves a hero (wardrobe.cur wins over look)', () => {
    const h = JSON.parse(JSON.stringify((me as any).hero));
    h.look = { shape: 'box' };
    const app = appearanceFrom(h.login, h, 'cats');
    expect(app.login).toBe('player1');
    expect(app.name).toBe('Player1');
    expect(app.level).toBe(6);
    expect(app.look.shape).toBe('bean');
    expect(app.look.acc).toEqual(['glasses', 'cape']);
    expect(app.gear).toMatchObject({ w: 'bow', wr: 'uncommon', s: 'scutum', a: 'lorica', am: 'light', h: 'miner' });
    expect(app.role).toBe('archer');
  });

  it('a hero-shaped object with walker fields (lk/g/n/lv/gh) works', () => {
    const app = appearanceFrom('x', { login: 'x', name: 'Long', n: 'Short', lv: 3, level: 9, lk: { hat: 'crown' }, look: { hat: 'cap' }, g: { w: 'axe' }, gh: 1 }, 'cats');
    expect(app.name).toBe('Short');
    expect(app.level).toBe(3);
    expect(app.look.hat).toBe('crown');
    expect(app.gear.w).toBe('axe');
    expect(app.gear.wr).toBe('common');
    expect(app.ghost).toBe(true);
  });

  it('uses the defaults() callback for missing fields only', () => {
    const calls: string[] = [];
    const defaults = (login: string) => { calls.push(login); return { shape: 'egg', color: 'hsl(200 80% 60%)', color2: '#123456', eyes: 'stars', mouth: 'tongue', blush: true, hat: 'party', aura: null, acc: null, accColor: '#654321', capeColor: '#00ff00' }; };
    const app = appearanceFrom('Abc', { l: 'abc', n: 'Abc', lk: { eyes: 'big' } }, 'cats', defaults);
    expect(calls).toEqual(['abc']);
    expect(app.look).toMatchObject({ shape: 'egg', eyes: 'big', mouth: 'tongue', blush: true, hat: 'party', color2: '#123456', accColor: '#654321', capeColor: '#00ff00' });
    expect(app.look.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(app.look.aura).toBeUndefined();
    expect(app.look.acc).toEqual([]);
  });

  it('survives a throwing or null defaults callback and junk input', () => {
    const a = appearanceFrom('q', null, 'legion', () => { throw new Error('x'); });
    expect(a.login).toBe('q');
    expect(CATALOG.shapes).toContain(a.look.shape);
    const b = appearanceFrom('q', { lk: { shape: 5, acc: 'cape', blush: 'yes' }, g: { w: '', wr: 'mythic' } }, 'monkeys', () => null);
    expect(b.look.acc).toEqual([]);
    expect(b.gear.w).toBeUndefined();
    expect(b.look.blush).toBe(nickDefaults('q', 'monkeys').blush);   // non-boolean → by-nick default
  });

  it('is deterministic', () => {
    const w = (session as any).enter.a[3];
    expect(appearanceFrom(w.l, w, 'cats')).toEqual(appearanceFrom(w.l, w, 'cats'));
  });

  it('maps award badges (aw)', () => {
    const app = appearanceFrom('z', { l: 'z', n: 'Z', aw: [{ i: '🏆', n: 'Чемпион' }, { t: 'x' }] }, 'cats');
    expect(app.badges).toEqual([{ icon: '🏆', name: 'Чемпион' }, { icon: '✦', name: 'x' }]);
  });
});
