import { describe,it,expect } from 'vitest';
import { cleanFavorites,toggleFavorite,favoriteKey } from '../src/collect/favorites';
import { linkState } from '../src/features/netstatus';
describe('quality of life',()=>{
  it('limits favourites to valid distinct buildings',()=>{expect(cleanFavorites(['a','a','x','b','c','d','e','f'],['a','b','c','d','e','f'])).toEqual(['a','b','c','d','e']);expect(toggleFavorite(['a','b','c','d','e'],'f')).toHaveLength(5);expect(toggleFavorite(['a'],'a')).toEqual([]);expect(favoriteKey('a')).not.toEqual(favoriteKey('b'));});
  it('distinguishes live events, recent fallback and stale connectivity',()=>{expect(linkState(true,10,20)).toBe('healthy');expect(linkState(false,10,20)).toBe('fallback');expect(linkState(false,10,40000)).toBe('offline');});
});
import { qualityDescription } from '../src/features/quality-info';
it('describes actual quality and auto level without remote telemetry',()=>{expect(qualityDescription(1,true)).toContain('Низкое (q1) · Авто');expect(qualityDescription(3,false)).toContain('q3: тени');});
