import * as THREE from 'three';
import { loadPBRSet, createVariationTexture, patchAntiTile, getMaxAnisotropy } from './PBRTextureLoader.js';

const GRASS_BASE_PATH = 'textures/grass';

// Fallback canvas — noise verde simples caso assets externos faltem.
function createFallbackGrassMap() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a5a26';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 30000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const isLight = Math.random() > 0.5;
    const v = isLight ? 60 + Math.random() * 50 : 20 + Math.random() * 30;
    const r = isLight ? Math.floor(v * 0.65) : Math.floor(v * 0.5);
    const g = Math.floor(v);
    const b = isLight ? Math.floor(v * 0.5) : Math.floor(v * 0.4);
    const a = 0.18 + Math.random() * 0.18;
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cria material PBR de grama. Tenta carregar assets externos
// `public/textures/grass/`. Anti-tile via detail normal (mesma normal em tile 6×)
// + variation map fBm pra modular albedo (cria patches mais claros/secos).
export function createGrassMaterial({
  repeatX = 24,
  repeatY = 24,
  anisotropy = 16,
  normalStrength = 0.85,
  useExternal = true,
  variationSeed = 4827,
  tint = 0xa6b890,
} = {}) {
  const aniso = Math.min(anisotropy, getMaxAnisotropy());
  const fallbackMap = createFallbackGrassMap();
  fallbackMap.repeat.set(repeatX, repeatY);
  fallbackMap.anisotropy = aniso;

  const material = new THREE.MeshStandardMaterial({
    map: fallbackMap,
    color: tint,
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(normalStrength, normalStrength),
  });

  if (useExternal) {
    const set = loadPBRSet({
      basePath: GRASS_BASE_PATH,
      repeatX,
      repeatY,
      anisotropy: aniso,
    });
    set.applyTo(material);
    set.promise.then(() => {
      const variation = createVariationTexture({ size: 256, seed: variationSeed });
      patchAntiTile(material, {
        detailNormalMap: material.normalMap,
        detailScale: 6.0,
        detailStrength: 0.45,
        variationMap: variation,
        variationScale: 1.0 / Math.max(repeatX, repeatY),
        variationLow: 0.72,
        variationHigh: 1.22,
      });
    });
  }

  return material;
}
