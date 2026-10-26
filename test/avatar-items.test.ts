import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRegistry } from '../src/core/registry';
import type { ItemModelFactory } from '../src/contracts/ext';
import { registerItemModels, itemModelKey, itemModelKeys, buildItemModel, foodKind, potionColor, materialKind, SUPPORTED_ITEM_MODEL_KEYS } from '../src/avatar/items';
import { ITEM_HATS } from '../src/avatar/supported';
import { HAT_IDS, conform, surfZ, eyeLayout, type AccCtx } from '../src/avatar/hats';
import { addShield } from '../src/avatar/gear';
import { Parts, T, bodyDims, torus, prep } from '../src/avatar/geom';
import { getModel } from '../src/avatar/model';
import { appearanceFrom, CATALOG } from '../src/avatar/appearance';

const newReg = () => { const r = createRegistry<ItemModelFactory>('itemModels'); registerItemModels(r); return r; };
const tris = (o: THREE.Object3D) => { const m = o.getObjectByName('item-model') as THREE.Mesh; return (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; };

describe('item models registry', () => {
  it('registers exactly the supported keys', () => {
    const r = newReg();
    expect(new Set([...r.ids(), '*'])).toEqual(new Set(SUPPORTED_ITEM_MODEL_KEYS));
    expect(r.has('*')).toBe(true);
    expect(ITEM_HATS).toEqual(HAT_IDS.filter((h) => h !== 'none'));
  });
  it('every model: fresh group, shared cached geometry, bottom at y = 0, ≤ 1.5k triangles', () => {
    const r = newReg();
    for (const key of SUPPORTED_ITEM_MODEL_KEYS) {
      const [kind, id] = key.split(':');
      const opts = { rarity: 'epic', slot: kind === 'slot' ? id : kind, id };
      const a = r.get(key)!({}, opts), b = r.get(key)!({}, opts);
      expect(a).not.toBe(b);
      const ma = a.getObjectByName('item-model') as THREE.Mesh, mb = b.getObjectByName('item-model') as THREE.Mesh;
      expect(ma.geometry, key).toBe(mb.geometry);
      expect(a.getObjectByName('item-outline'), key).toBeTruthy();
      const bb = ma.geometry.boundingBox!;
      expect(Math.abs(bb.min.y), key).toBeLessThan(1e-4);
      expect(bb.max.y, key).toBeGreaterThan(0.03);
      expect(tris(a), key).toBeLessThanOrEqual(1500);
      expect(a.getObjectByName('rarity-ring')).toBeUndefined();   // ring only on request
    }
  });
});

describe('itemModelKey / keys / buildItemModel', () => {
  it('picks the key from look, then slot', () => {
    expect(itemModelKey({ slot: 'weapon', look: { weapon: 'bow' } })).toBe('weapon:bow');
    expect(itemModelKey({ slot: 'shield', look: { shield: 'scutum' } })).toBe('shield:scutum');
    expect(itemModelKey({ slot: 'armor', look: { armor: 'plate' } })).toBe('armor:plate');
    expect(itemModelKey({ slot: 'armor', id: 'robe', look: null })).toBe('armor:robe');
    expect(itemModelKey({ slot: 'armor', name: 'Мантия мага' })).toBe('armor:robe');
    expect(itemModelKey({ slot: 'armor' })).toBe('armor:lorica');
    expect(itemModelKey({ slot: 'helmet', look: { hat: 'miner' } })).toBe('hat:miner');
    expect(itemModelKey({ slot: 'helmet' })).toBe('hat:legion');
    expect(itemModelKey({ slot: 'trinket', look: { charm: 'vial' } })).toBe('charm:vial');
    expect(itemModelKey({ slot: 'trinket', look: { aura: 'frost' } } as any)).toBe('charm:frost');
    expect(itemModelKey({ slot: 'potion', id: 'hp_small' })).toBe('slot:potion');
    expect(itemModelKeys({ slot: 'food', id: 'apple' })).toEqual(['food:apple', 'slot:food', '*']);
    expect(itemModelKeys({ slot: 'weapon', look: { weapon: 'laser' } })).toEqual(['weapon:laser', 'slot:weapon', '*']);
  });
  it('falls back: unknown weapon kind → slot model, unknown slot → gift box', () => {
    const r = newReg();
    expect(buildItemModel(r, { slot: 'weapon', look: { weapon: 'laser' }, rarity: 'rare' }).userData.itemKey).toBe('weapon:sword');
    expect(buildItemModel(r, { slot: 'pet', id: 'dragon' }).userData.itemKey).toBe('*');
    expect(buildItemModel(r, { slot: 'food', id: 'apple' }).userData.itemKey).toBe('food:apple');
  });
  it('generic models read id hints / effect', () => {
    expect(foodKind('sprat', 'Килька')).toBe('fish');
    expect(foodKind('', 'Яблоко')).toBe('apple');
    expect(foodKind('roast')).toBe('meat');
    expect(foodKind('zzz')).toBe('bread');
    expect(potionColor({ heal: 30 }).big).toBe(true);
    expect(potionColor({ mag: 2 }).liquid).toBe('#4a8cff');
    expect(materialKind({ mat: 'ore', res: 'ruby' })).toBe('gem:ruby');
    expect(materialKind({}, 'ore_iron')).toBe('ore:iron');
    expect(materialKind({ mat: 'star' })).toBe('star');
  });
});

describe('accessories sit on the face (bug #6)', () => {
  it('conformed parts stay in front of the surface on every body shape', () => {
    for (const shape of CATALOG.shapes) for (const eyes of ['dots', 'big', 'cyclops']) {
      const d = bodyDims(shape, 0.5), k: AccCtx = { d, accColor: '#f00', cyc: eyes === 'cyclops', eyes };
      const E = eyeLayout(d, eyes), R = Math.max(E.r, E.ry) + 0.014;
      const g = conform(prep(torus(Math.min(R, 0.11), 0.009, 6, 28), '#000'), k, 0.016, T(E.one ? 0 : E.x, E.y, 0));
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) expect(p.getZ(i), `${shape}/${eyes}`).toBeLessThan(surfZ(k, p.getX(i), p.getY(i)) - 0.004);
    }
  });
  it('characters with glasses/shades/monocle/mustache/bowtie/tie/scarf build for every shape', () => {
    for (const shape of CATALOG.shapes) for (const acc of [['glasses'], ['shades'], ['monocle', 'mustache'], ['bowtie', 'scarf'], ['tie', 'cape']]) {
      const m = getModel(appearanceFrom('acc_' + shape, { lk: { shape, acc } }, 'cats', null));
      expect(m.geo.attributes.position.count).toBeGreaterThan(1000);
      expect(Number.isFinite(m.geo.boundingSphere!.radius)).toBe(true);
    }
  });
});

describe('cape / shield regressions (bug #8)', () => {
  it('the scutum is a thin curved board, no sheet far behind it', () => {
    const p = new Parts(); addShield(p, 'scutum', 'common', T(0, 0, 0));
    const g = p.build(); g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.z - bb.min.z).toBeLessThan(0.12);   // was ≈ 0.7 m: the back layer was rotated π behind the shield
  });
  it('a cat with cape + armour builds with both cape and tail', () => {
    const app = appearanceFrom('cape_cat', { lk: { shape: 'bean', acc: ['cape'] }, g: { a: 'lorica', ar: 'rare' } }, 'cats', null);
    const m = getModel(app);
    expect(m.hasCape && m.hasTail).toBe(true);
  });
});
