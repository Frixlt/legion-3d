import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRegistry } from '../src/core/registry';
import { createRegistries, DEFAULT_BUILDINGS } from '../src/core/registries';
import { driftList, reportDrift, _resetDrift } from '../src/core/drift';
import { runFeatures } from '../src/features';

describe('registry', () => {
  beforeEach(() => _resetDrift());

  it('registers, replaces, unregisters and notifies', () => {
    const r = createRegistry<number>('nums');
    const fn = vi.fn();
    r.onChange(fn);
    const off1 = r.register('a', 1);
    expect(r.get('a')).toBe(1);
    expect(r.has('a')).toBe(true);
    const off2 = r.register('a', 2);           // replace
    expect(r.get('a')).toBe(2);
    off1();                                    // stale unregister must not remove the replacement
    expect(r.get('a')).toBe(2);
    off2();
    expect(r.has('a')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('resolve falls back to "*" and reports drift once', () => {
    const r = createRegistry<string>('kinds', 'generic');
    r.register('known', 'K');
    expect(r.resolve('known')).toBe('K');
    expect(r.resolve('brandnew')).toBe('generic');
    expect(r.resolve('brandnew')).toBe('generic');
    expect(driftList().filter((d) => d.id === 'brandnew')).toHaveLength(1);
    expect(driftList()[0].kind).toBe('kinds');
    expect(r.ids()).toEqual(['known']);       // the fallback is not listed
  });

  it('resolve without a fallback throws for unknown ids', () => {
    const r = createRegistry<number>('strict');
    expect(() => r.resolve('x')).toThrow(/unknown id/);
  });

  it('drift is deduplicated by kind+id and exposed on globalThis.__l3dDrift', () => {
    reportDrift('item', 'sword:new');
    reportDrift('item', 'sword:new');
    reportDrift('room', 'sword:new');
    expect(driftList()).toHaveLength(2);
    expect((globalThis as any).__l3dDrift).toHaveLength(2);
  });
});

describe('content registries', () => {
  beforeEach(() => _resetDrift());

  it('maps site buildings to room kinds; unknown → site + drift', () => {
    const R = createRegistries();
    expect(R.buildings.resolve('forge').room).toBe('shop3d');
    expect(R.buildings.resolve('tent').room).toBe('shop3d');
    expect(R.buildings.resolve('trainer').room).toBe('hybrid');
    expect(R.buildings.resolve('gate').room).toBe('hybrid');
    expect(R.buildings.resolve('mine').room).toBe('mine3d');
    expect(R.buildings.resolve('observatory').room).toBe('site');
    expect(driftList().map((d) => d.kind + ':' + d.id)).toEqual(['buildings:observatory']);
    for (const id of Object.keys(DEFAULT_BUILDINGS)) expect(R.buildings.has(id)).toBe(true);
  });
});

describe('feature runner', () => {
  it('runs features by order, survives a failing one, and returns a disposer in reverse order', async () => {
    const log: string[] = [];
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const off = await runFeatures({} as any, [
      { id: 'b', order: 20, setup: () => { log.push('b'); return () => log.push('-b'); } },
      { id: 'boom', order: 15, setup: () => { throw new Error('x'); } },
      { id: 'a', order: 10, setup: async () => { log.push('a'); return () => log.push('-a'); } },
      { id: 'c', setup: () => { log.push('c'); } },
    ]);
    expect(log).toEqual(['a', 'b', 'c']);
    expect(err).toHaveBeenCalledOnce();
    off();
    expect(log).toEqual(['a', 'b', 'c', '-b', '-a']);
    err.mockRestore();
  });
});
