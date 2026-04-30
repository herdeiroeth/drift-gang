import * as THREE from 'three';
import {
  createAsphaltMaps,
  createAsphaltMaterial,
} from './materials/Asphalt.js';
import { RENDER_CFG } from '../core/constants.js';

export function createAsphaltTexture() {
  return createAsphaltMaps({ repeatX: 40, repeatY: 40 }).map;
}

export function createOpenArenaAsphaltMaterial() {
  return createAsphaltMaterial({ repeatX: 46, repeatY: 46, seed: 2619, normalStrength: 0.64 });
}

function createDaySkyTexture() {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const top = new THREE.Color(0x4f91d5);
  const zenith = new THREE.Color(0x86c2ef);
  const horizon = new THREE.Color(0xeaf7fb);
  const warmHorizon = new THREE.Color(0xffe3bd);
  const ground = new THREE.Color(0x7b8d70);
  const col = new THREE.Color();

  const row = ctx.createImageData(width, 1);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    if (v < 0.48) {
      const t = v / 0.48;
      col.copy(top).lerp(zenith, t);
    } else if (v < 0.61) {
      const t = (v - 0.48) / 0.13;
      col.copy(zenith).lerp(warmHorizon, t);
    } else if (v < 0.68) {
      const t = (v - 0.61) / 0.07;
      col.copy(warmHorizon).lerp(horizon, t);
    } else {
      const t = (v - 0.68) / 0.32;
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

  ctx.globalCompositeOperation = 'screen';

  const sunX = width * 0.77;
  const sunY = height * 0.36;
  const sun = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, width * 0.18);
  sun.addColorStop(0, 'rgba(255,246,214,0.95)');
  sun.addColorStop(0.12, 'rgba(255,239,196,0.55)');
  sun.addColorStop(1, 'rgba(255,239,196,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);

  const streak = ctx.createLinearGradient(width * 0.42, sunY, width, sunY);
  streak.addColorStop(0, 'rgba(255,255,255,0)');
  streak.addColorStop(0.55, 'rgba(255,246,221,0.16)');
  streak.addColorStop(0.78, 'rgba(255,244,210,0.34)');
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(0, height * 0.29, width, height * 0.18);

  const horizonGlow = ctx.createLinearGradient(0, height * 0.46, 0, height * 0.72);
  horizonGlow.addColorStop(0, 'rgba(255,255,255,0)');
  horizonGlow.addColorStop(0.45, 'rgba(255,248,229,0.28)');
  horizonGlow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = horizonGlow;
  ctx.fillRect(0, height * 0.45, width, height * 0.28);

  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = RENDER_CFG.textureAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

// renderer é REQUIRED quando se quer IBL prefiltrado (PMREMGenerator).
// Mantém compat: se renderer for null/undefined, cai no fallback de equirect cru
// (atrai bem menos detalhe nos reflexos, mas funciona).
export function setupEnv(scene, renderer = null) {
  const skyTexture = createDaySkyTexture();
  scene.background = skyTexture;

  if (renderer) {
    // PMREMGenerator pré-filtra o equirect em mip levels por roughness.
    // Sem isso, MeshPhysicalMaterial faz amostragem ingênua do skyTexture e o
    // reflexo "cintila" / fica errado em roughness alto. Custo: ~5-15ms 1×.
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(skyTexture);
    scene.environment = envRT.texture;
    pmrem.dispose();
  } else {
    scene.environment = skyTexture;
  }

  scene.fog = new THREE.Fog(0xd9edf8, 95, 420);
  return { skyTexture };
}

export function setupLights(scene) {
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6f675a, 0.72);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff1d0, 2.15);
  dir.position.set(-55, 105, 45);
  dir.castShadow = true;
  const sz = RENDER_CFG.shadowMapSize;
  dir.shadow.mapSize.set(sz, sz);
  dir.shadow.bias = RENDER_CFG.shadowBias;
  dir.shadow.normalBias = RENDER_CFG.shadowNormalBias;
  // Mantém o shadow map principal denso; no Three atual PCFSoft cai em PCF
  // com warning, então evitamos o tipo deprecado no renderer.
  dir.shadow.blurSamples = 16;
  dir.shadow.radius = 4;
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
