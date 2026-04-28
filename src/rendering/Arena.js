import * as THREE from 'three';
import { createAsphaltTexture } from './Environment.js';

// Modo arena livre — plano infinito com grid magenta.
// Usado em Game quando não há pista carregada (modo "test/tuning").
// Game.js cuida do "infinite snap" (chunks de 360) só quando esse modo está ativo.
export function buildOpenArena(scene) {
  const asphaltTex = createAsphaltTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    map: asphaltTex, roughness: 0.92, metalness: 0.05, color: 0x888888
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.surfaceType = 'asphalt';
  scene.add(floor);

  const grid = new THREE.GridHelper(360, 180, 0xff2a6d, 0x555566);
  grid.position.y = 0.03;
  scene.add(grid);

  return { groundObjects: [floor], floor, grid };
}

// Alias retrocompatível — código legado pode continuar chamando buildArena.
export const buildArena = buildOpenArena;
