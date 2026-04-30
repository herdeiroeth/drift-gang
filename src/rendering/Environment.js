import * as THREE from 'three';
import {
  createAsphaltMaps,
  createAsphaltMaterial,
} from './materials/Asphalt.js';

export function createAsphaltTexture() {
  return createAsphaltMaps({ repeatX: 40, repeatY: 40 }).map;
}

export function createOpenArenaAsphaltMaterial() {
  return createAsphaltMaterial({ repeatX: 46, repeatY: 46, seed: 2619, normalStrength: 0.64 });
}

function createDaySkyTexture() {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const top = new THREE.Color(0x6aa7de);
  const zenith = new THREE.Color(0x8fc4ef);
  const horizon = new THREE.Color(0xd9edf8);
  const ground = new THREE.Color(0x86936f);
  const col = new THREE.Color();

  const row = ctx.createImageData(width, 1);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    if (v < 0.52) {
      const t = v / 0.52;
      col.copy(top).lerp(zenith, t);
    } else if (v < 0.64) {
      const t = (v - 0.52) / 0.12;
      col.copy(zenith).lerp(horizon, t);
    } else {
      const t = (v - 0.64) / 0.36;
      col.copy(horizon).lerp(ground, t);
    }
    for (let x = 0; x < width; x++) {
      const p = x * 4;
      row.data[p + 0] = Math.round(col.r * 255);
      row.data[p + 1] = Math.round(col.g * 255);
      row.data[p + 2] = Math.round(col.b * 255);
      row.data[p + 3] = 255;
    }
    ctx.putImageData(row, 0, y);
  }

  const sun = ctx.createRadialGradient(width * 0.78, height * 0.38, 2, width * 0.78, height * 0.38, 54);
  sun.addColorStop(0, 'rgba(255,246,214,0.95)');
  sun.addColorStop(0.18, 'rgba(255,239,196,0.38)');
  sun.addColorStop(1, 'rgba(255,239,196,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function setupEnv(scene) {
  const skyTexture = createDaySkyTexture();
  scene.background = skyTexture;
  scene.environment = skyTexture;
  scene.fog = new THREE.Fog(0xd9edf8, 95, 420);
  return { skyTexture };
}

export function setupLights(scene) {
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6f675a, 0.72);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff1d0, 2.15);
  dir.position.set(-55, 105, 45);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.bias = -0.00008;
  dir.shadow.normalBias = 0.025;
  dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 400;
  dir.shadow.camera.left = -200; dir.shadow.camera.right = 200;
  dir.shadow.camera.top = 200; dir.shadow.camera.bottom = -200;
  scene.add(dir);

  const fill = new THREE.DirectionalLight(0xa8cfff, 0.28);
  fill.position.set(50, 38, -70);
  scene.add(fill);

  // Retorna refs pra Game.js poder ajustar shadow camera baseado em bbox da pista.
  return { hemi, dir, fill };
}
