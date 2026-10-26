/**
 * ArtProvider backed by the site's own SVG strings (layout.art). Generic: no fixture data here.
 * Each layer is rasterised once (Blob URL → Image → canvas) at a fixed resolution; region() crops from it.
 * Layers (city px): quarter 0..QW+40 × 0..1080; fair at x = fairX (QW+8) with viewBox "8 0 width-8 1080";
 * lower street at y = LOW.top, full width W.
 */
import type { CityLayout } from '../contracts';
import type { ArtProvider } from '../contracts/modules';

interface Layer { x: number; y: number; w: number; h: number; svg: string; img?: Promise<HTMLCanvasElement | null> }

const RES = 0.5;   // raster px per city px for the cached layer (caps memory: 5500×1080×0.5 ≈ 2750×540)

function rasterize(svg: string, w: number, h: number, scale: number): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    try {
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
        const g = c.getContext('2d');
        if (g) g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(g ? c : null);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch { resolve(null); }
  });
}

const wrap = (inner: string, w: number, h: number, vb: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${vb}">${inner}</svg>`;

export function createSvgArt(layout: CityLayout): ArtProvider | null {
  const art = layout.art;
  if (!art || !(art.quarterSvg || art.fairSvg || art.lowerSvg)) return null;
  const QW = layout.QW, W = layout.W, H = layout.H;
  const top = layout.low?.top ?? 1040;
  const layers: Layer[] = [];
  if (art.quarterSvg) layers.push({ x: 0, y: 0, w: QW + 40, h: 1080, svg: wrap(art.quarterSvg, QW + 40, 1080, `0 0 ${QW + 40} 1080`) });
  if (art.fairSvg) {
    const fx = art.fairX ?? QW + 8;
    const fw = W - fx;   // fair scene width − 8 (3700 − 8 when W = QW + 3700)
    layers.push({ x: fx, y: 0, w: fw, h: 1080, svg: wrap(art.fairSvg, fw, 1080, `8 0 ${fw} 1080`) });
  }
  if (art.lowerSvg) layers.push({ x: 0, y: top, w: W, h: H - top, svg: wrap(art.lowerSvg, W, H - top, `0 ${top} ${W} ${H - top}`) });

  return {
    async region(x0, y0, x1, y1, pxPerUnit) {
      const w = Math.max(1, Math.round((x1 - x0) * pxPerUnit)), h = Math.max(1, Math.round((y1 - y0) * pxPerUnit));
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      const g = out.getContext('2d'); if (!g) return null;
      let drawn = false;
      for (const L of layers) {
        const ix0 = Math.max(x0, L.x), iy0 = Math.max(y0, L.y), ix1 = Math.min(x1, L.x + L.w), iy1 = Math.min(y1, L.y + L.h);
        if (ix1 <= ix0 || iy1 <= iy0) continue;
        if (!L.img) L.img = rasterize(L.svg, L.w, L.h, RES);
        const c = await L.img; if (!c) continue;
        g.drawImage(c, (ix0 - L.x) * RES, (iy0 - L.y) * RES, (ix1 - ix0) * RES, (iy1 - iy0) * RES,
          (ix0 - x0) * pxPerUnit, (iy0 - y0) * pxPerUnit, (ix1 - ix0) * pxPerUnit, (iy1 - iy0) * pxPerUnit);
        drawn = true;
      }
      return drawn ? out : null;
    },
  };
}
