import * as THREE from 'three';
import { createOpenArenaAsphaltMaterial } from './Environment.js';

// Modo arena livre — plano infinito com grid sutil.
// Usado em Game quando não há pista carregada (modo "test/tuning").
// Game.js cuida do "infinite snap" (chunks de 360) só quando esse modo está ativo.
export function buildOpenArena(scene) {
  const floorMat = createOpenArenaAsphaltMaterial();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.surfaceType = 'asphalt';
  scene.add(floor);

  const grid = new THREE.GridHelper(360, 180, 0x8aa2af, 0x4a5156);
  grid.position.y = 0.03;
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  scene.add(grid);

  return { groundObjects: [floor], floor, grid };
}

// Alias retrocompatível — código legado pode continuar chamando buildArena.
export const buildArena = buildOpenArena;
