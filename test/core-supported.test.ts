import { describe, it, expect } from 'vitest';
import supported from '../src/data/supported.json';
import snapshot from '../src/data/site-snapshot.json';
import { DEFAULT_BUILDINGS } from '../src/core/registries';
import { CATALOG } from '../src/avatar';
import { HAT_IDS } from '../src/avatar/hats';

// scripts/drift.mjs is plain Node ESM (no types): import it untyped
const drift: any = await import('../scripts/drift.mjs' as string);

describe('src/data/supported.json matches the code', () => {
  it('building → room mapping = DEFAULT_BUILDINGS', () => {
    const fromCode = Object.fromEntries(Object.entries(DEFAULT_BUILDINGS).map(([id, d]) => [id, d.room]));
    expect(supported.buildings.rooms).toEqual(fromCode);
  });
  it('looks the avatar module builds', () => {
    expect(supported.looks.hats).toEqual(HAT_IDS);
    expect(supported.looks.weapons).toEqual([...CATALOG.weapons]);
    expect(supported.looks.shields).toEqual([...CATALOG.shields]);
    expect(supported.looks.armors).toEqual([...CATALOG.armors]);
    for (const k of ['shapes', 'mouths', 'acc'] as const) for (const id of CATALOG[k]) expect(supported.looks[k]).toContain(id);
  });
  it('the snapshot has every section drift compares', () => {
    for (const k of ['buildings', 'rooms', 'catalog', 'gameData', 'api', 'questKinds']) expect(snapshot).toHaveProperty(k);
    expect(snapshot.buildings.length).toBeGreaterThan(5);
  });
});

describe('drift script helpers', () => {
  it('braceBlock / topKeys read object literals with strings and comments', () => {
    const src = `const X = 1; const ROOM = { // where things are\n  forge: { hero: [1, 2], ui: 'l' }, 'magic': { s: "}{" }, /* c: 1 */ tent: {},\n  shop: { a: { b: 1 } } };`;
    const b = drift.braceBlock(src, src.indexOf('const ROOM'));
    expect(b.endsWith('} }')).toBe(true);
    expect(drift.topKeys(b)).toEqual(['forge', 'magic', 'tent', 'shop']);
  });
  it('extract + compare: new / removed / unsupported ids and broken api', () => {
    const files = {
      '/site/citymap.js': `(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); })(this, function () { return { BUILDINGS: [{ id: 'forge' }, { id: 'zoo', soon: true }] }; });`,
      '/site/city.js': `const ROOM = { forge: {}, zoo: {} }; api('/api/city/go'); api('/api/zooFeed')`,
      '/c/x/doodle.js': `const CATALOG = { hats: [['cap', 'Кепка'], ['newhat', 'Новая']], weapons: ['sword'] };`,
      '/lib/game-data.js': `self.LG_GAME_DATA = { v: 'x', classes: [{ id: 'mage' }, { id: 'bard' }], res: { stone: 'Камень', iron: 'Железо', gold: 'Золото' } };`,
      '/site/quest.js': `const KIND_RU = { battle: 'Бой', dance: 'Танец' };`,
    };
    const { data, errors } = drift.extract(files);
    expect(errors).toEqual([]);
    expect(data.buildings).toEqual(['forge', 'zoo']);
    expect(data.rooms).toEqual(['forge', 'zoo']);
    expect(data.catalog.hats).toEqual(['cap', 'newhat']);
    expect(data.gameData.classes).toEqual(['bard', 'mage']);
    expect(data.gameData.res).toEqual(['gold', 'iron', 'stone']);
    expect(data.questKinds).toEqual(['battle', 'dance']);
    expect(data.api).toEqual(['/api/city/go', '/api/zooFeed']);
    const snap = { buildings: ['forge', 'tent'], rooms: ['forge'], catalog: { hats: ['cap'] }, gameData: {}, api: ['/api/city/go'], questKinds: ['battle'] };
    const sup = { buildings: { models: ['forge'], rooms: { forge: 'shop3d' } }, roomKinds: [], looks: { hats: ['cap'] }, questKinds: ['battle'], classes: ['mage'] };
    const R = drift.compare(data, snap, sup, ['/api/city/go', '/api/oldThing']);
    expect(R.changes.buildings).toEqual({ added: ['zoo'], removed: ['tent'] });
    expect(R.changes['catalog.hats'].added).toEqual(['newhat']);
    expect(R.unsupported['buildings (3D model)']).toEqual(['zoo']);
    expect(R.unsupported['buildings (room kind not implemented → site screen)']).toEqual(['forge']);
    expect(R.unsupported['looks.hats']).toEqual(['newhat']);
    expect(R.unsupported.questKinds).toEqual(['dance']);
    expect(R.unsupported.classes).toEqual(['bard']);
    expect(R.broken).toEqual(['/api/oldThing']);
  });
});
