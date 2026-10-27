import * as THREE from 'three';

/** Snapshot and restore camera projection/pose, scene visibility and renderer resolution. */
export function photoSnapshot(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, hidden: THREE.Object3D[]) {
  const pos = camera.position.clone(), quat = camera.quaternion.clone();
  const fov = camera.fov, filmOffset = camera.filmOffset, ratio = renderer.getPixelRatio();
  const visibility = hidden.map(o => o.visible);
  return () => {
    camera.position.copy(pos); camera.quaternion.copy(quat);
    camera.fov = fov; camera.filmOffset = filmOffset; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    renderer.setPixelRatio(ratio);
    hidden.forEach((o, i) => { o.visible = visibility[i]; });
  };
}

export function photoFilename(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `legion3d-${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.png`;
}

export function clampPhotoPosition(position: THREE.Vector3, hero: THREE.Vector3, floor: number, radius = 12): void {
  position.y = Math.max(floor + 0.35, position.y);
  const offset = position.clone().sub(hero);
  if (offset.lengthSq() > radius * radius) position.copy(hero).add(offset.normalize().multiplyScalar(radius));
  position.y = Math.max(floor + 0.35, position.y);
}
