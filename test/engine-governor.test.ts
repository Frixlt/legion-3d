import { describe, it, expect } from 'vitest';
import { AutoGovernor, levelCapForGpu } from '../src/engine/quality';

describe('auto quality on a weak GPU', () => {
  it('drops levels when frames take 200 ms (5 fps) — slow frames must not be ignored', () => {
    const g = new AutoGovernor(3, 3);
    g.reset(0);
    let t = 0;
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) { t += 0.2; const r = g.sample(200, t); if (r === 'level') seen.push(g.level); }
    expect(g.level).toBe(0);
    expect(seen[0]).toBe(2);
  });
  it('ignores single multi-second stalls', () => {
    const g = new AutoGovernor(2, 3);
    g.reset(0);
    let t = 0;
    for (let i = 0; i < 60; i++) { t += 1 / 60; g.sample(i === 30 ? 3000 : 16, t); }
    expect(g.level).toBe(2);
  });
  it('caps old/weak GPUs and software rasterisers', () => {
    expect(levelCapForGpu('ANGLE (NVIDIA, Vulkan 1.2.318 (NVIDIA NVK GK208B (0x0000128B)), NVK)')).toBe(1);
    expect(levelCapForGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe(0);
    expect(levelCapForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(3);
    expect(levelCapForGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(2);
  });
});
