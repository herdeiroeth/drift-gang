import * as THREE from 'three';
import { createAsphaltTexture } from './Environment.js';

export function buildArena(scene) {
  const asphaltTex = createAsphaltTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    map: asphaltTex, roughness: 0.92, metalness: 0.05, color: 0x888888
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(360, 180, 0xff2a6d, 0x555566);
  grid.position.y = 0.03;
  scene.add(grid);

  return { groundObjects: [floor], floor, grid };
}
