/** 2D city px ⇄ 3D metres. The site's city is a side-scroller: x horizontal, y = depth. */
export const SX = 0.01;        // metres per px along x  (5500 px city → 55 m wide)
export const SZ = 0.02;        // metres per px along depth (y 800..1900 → 22 m deep)
export const Y0 = 800;         // depth px where the walkable area starts (the back street in front of the facades)
export const EYE = 1.15;       // first-person eye height (m) — characters are ~1.35 m tall chibis
export const toX = (x: number) => x * SX;
export const toZ = (y: number) => (y - Y0) * SZ;
export const fromX = (X: number) => X / SX;
export const fromZ = (Z: number) => Z / SZ + Y0;
/** Heights of art in the 2D scene (px above the depth line y=Y0) → metres. */
export const artH = (px: number) => px * SX;
