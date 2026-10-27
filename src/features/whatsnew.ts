import type { Feature } from '../contracts/ext';
import manifest from '../../public/manifest.json';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { mountWhatsNew } from '../ui/whatsnew';

export const VERSION = manifest.version;
export const BULLETS: readonly string[] = typeof __L3D_CHANGELOG__ !== 'undefined' ? __L3D_CHANGELOG__ : [];
export const SEEN_KEY = 'l3d.whatsnew.seen';
export const ENABLED_KEY = 'l3d.whatsnew.enabled';
export function shouldShow(seen: string | null, enabled: string, version = VERSION): boolean {
  return enabled !== '0' && seen !== version;
}
export function reportLink(version: string, renderer: string, fps: number, quality: string): string {
  const url = new URL('https://github.com/ascorblack/legion-3d/issues/new');
  url.searchParams.set('template', 'bug.yml');
  url.searchParams.set('version', version);
  url.searchParams.set('renderer', renderer.slice(0, 120));
  url.searchParams.set('fps', Number.isFinite(fps) ? String(Math.round(fps)) : '—');
  url.searchParams.set('quality', quality);
  return url.href;
}
function gpuRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string {
  if (!gl) return 'недоступен';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'не раскрывается браузером';
}
const whatsnew: Feature = {
  id: 'whatsnew', order: 105,
  setup(ctx) {
    const unregister = registerSettingRow({ key: ENABLED_KEY, label: 'Карточки обновлений', sub: 'Показывать изменения после обновления', group: 'Прочее', order: 10, kind: 'seg', options: [['1', 'Вкл'], ['0', 'Выкл']], def: '1' });
    let unmount: (() => void) | undefined;
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (shouldShow(seen, settingValue(ENABLED_KEY, '1'))) {
        const canvas = ctx.engine.renderer.domElement;
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const renderer = gpuRenderer(gl);
        const url = () => reportLink(VERSION, renderer, ctx.engine.stats()?.fps ?? 0, String(ctx.quality()));
        const root = canvas.getRootNode() instanceof ShadowRoot ? canvas.getRootNode() as ShadowRoot : document.body;
        unmount = mountWhatsNew(root as unknown as HTMLElement, VERSION, BULLETS, url);
        localStorage.setItem(SEEN_KEY, VERSION);
      }
    } catch { /* localStorage or WebGL unavailable: gameplay must continue */ }
    return () => { unmount?.(); unregister(); };
  },
};
export default whatsnew;
