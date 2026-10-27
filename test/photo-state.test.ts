import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clampPhotoPosition, photoFilename, photoSnapshot } from '../src/photo/state';

describe('photo mode restoration', () => {
  it('restores camera pose and projection, renderer pixel ratio, and label visibility', () => {
    const camera=new THREE.PerspectiveCamera(74,1.6,.1,100);
    camera.position.set(1,2,3);camera.rotation.set(.2,.4,0);camera.filmOffset=2;camera.updateProjectionMatrix();
    const initialPosition=camera.position.clone(), initialQuaternion=camera.quaternion.clone();
    const labels=new THREE.Group();labels.visible=false;
    let ratio=1.25;
    const renderer={getPixelRatio:()=>ratio,setPixelRatio:(v:number)=>{ratio=v}} as THREE.WebGLRenderer;
    const restore=photoSnapshot(camera,renderer,[labels]);
    camera.position.set(8,9,10);camera.rotation.set(1,1,1);camera.fov=34;camera.filmOffset=0;ratio=2;labels.visible=true;
    restore();
    expect(camera.position.equals(initialPosition)).toBe(true);
    expect(camera.quaternion.equals(initialQuaternion)).toBe(true);
    expect(camera.fov).toBe(74);expect(camera.filmOffset).toBe(2);
    expect(ratio).toBe(1.25);expect(labels.visible).toBe(false);
  });
  it('bounds the free camera around the hero and above terrain', () => {
    const p=new THREE.Vector3(50,-8,1);clampPhotoPosition(p,new THREE.Vector3(0,0,0),0);
    expect(p.length()).toBeLessThanOrEqual(12.01);
    expect(p.y).toBeGreaterThanOrEqual(.35);
  });
  it('uses timestamped local PNG names',()=>{
    expect(photoFilename(new Date(2026,0,2,3,4,5))).toBe('legion3d-20260102-030405.png');
  });
});
