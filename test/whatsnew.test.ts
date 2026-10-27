import { describe, expect, it } from 'vitest';
import manifest from '../public/manifest.json';
import { BULLETS, reportLink, shouldShow, VERSION } from '../src/features/whatsnew';

describe('update card', () => {
  it('bakes manifest version, only announces an unseen enabled version', () => {
    expect(VERSION).toBe(manifest.version);
    expect(shouldShow(null, '1')).toBe(true);
    expect(shouldShow(VERSION, '1')).toBe(false);
    expect(shouldShow('old', '0')).toBe(false);
    // The build injects version-scoped bullets; plain Vitest has no build-time define.
    expect(BULLETS).toEqual([]);
  });
  it('uses issue template and only hardware/performance metadata', () => {
    const u = new URL(reportLink('0.2.2', 'SwiftShader', 32.9, '2'));
    expect(u.searchParams.get('template')).toBe('bug.yml');
    expect(u.searchParams.get('renderer')).toBe('SwiftShader');
    expect(u.searchParams.get('fps')).toBe('33');
    expect([...u.searchParams.keys()].sort()).toEqual(['fps', 'quality', 'renderer', 'template', 'version']);
  });
});
