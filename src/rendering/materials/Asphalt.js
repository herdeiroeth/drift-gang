import * as THREE from 'three';
import { loadPBRSet, createVariationTexture, patchAntiTile, getMaxAnisotropy } from './PBRTextureLoader.js';

const DEFAULT_SIZE = 512;
const DEFAULT_SEED = 1847;
const ASPHALT_BASE_PATH = 'textures/asphalt';

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function setWrappedHeight(height, size, x, y, delta) {
  const xi = ((x % size) + size) % size;
  const yi = ((y % size) + size) % size;
  height[yi * size + xi] += delta;
}

function addPebble(height, size, cx, cy, radius, amount) {
  const r = Math.ceil(radius);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y) / radius;
      if (d > 1) continue;
      const falloff = Math.cos(d * Math.PI * 0.5);
      setWrappedHeight(height, size, Math.round(cx + x), Math.round(cy + y), amount * falloff);
    }
  }
}

function addCrack(height, size, rng) {
  let x = rng() * size;
  let y = rng() * size;
  let angle = rng() * Math.PI * 2;
  const steps = 24 + Math.floor(rng() * 58);
  for (let i = 0; i < steps; i++) {
    angle += (rng() - 0.5) * 0.45;
    x += Math.cos(angle) * (1.2 + rng() * 2.4);
    y += Math.sin(angle) * (1.2 + rng() * 2.4);
    addPebble(height, size, x, y, 0.9 + rng() * 0.7, -0.26);
    if (rng() > 0.82) {
      addPebble(height, size, x + (rng() - 0.5) * 8, y + (rng() - 0.5) * 8, 0.45, -0.18);
    }
  }
}

function createCanvases({ size = DEFAULT_SIZE, seed = DEFAULT_SEED } = {}) {
  const rng = mulberry32(seed);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const low = Math.sin(x * 0.035 + seed * 0.001) * Math.cos(y * 0.027 + seed * 0.002);
      height[i] = low * 0.08 + (rng() - 0.5) * 0.08;
    }
  }

  for (let i = 0; i < 950; i++) {
    const radius = 0.7 + rng() * rng() * 3.4;
    const amount = (rng() > 0.42 ? 1 : -1) * (0.08 + rng() * 0.24);
    addPebble(height, size, rng() * size, rng() * size, radius, amount);
  }

  for (let i = 0; i < 18; i++) addCrack(height, size, rng);

  const colorCanvas = makeCanvas(size);
  const normalCanvas = makeCanvas(size);
  const roughnessCanvas = makeCanvas(size);
  const colorCtx = colorCanvas.getContext('2d');
  const normalCtx = normalCanvas.getContext('2d');
  const roughnessCtx = roughnessCanvas.getContext('2d');
  const color = colorCtx.createImageData(size, size);
  const normal = normalCtx.createImageData(size, size);
  const roughness = roughnessCtx.createImageData(size, size);

  const sample = (x, y) => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    return height[yi * size + xi];
  };

  const colorRng = mulberry32(seed + 991);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const p = i * 4;
      const h = height[i];
      const grain = (colorRng() - 0.5) * 18;
      const laneWear = Math.pow(Math.sin((x / size) * Math.PI), 1.7) * 9;
      const base = Math.max(22, Math.min(86, 47 + h * 58 + grain + laneWear));

      color.data[p + 0] = base;
      color.data[p + 1] = base;
      color.data[p + 2] = Math.min(94, base + 3);
      color.data[p + 3] = 255;

      const dx = (sample(x - 1, y) - sample(x + 1, y)) * 4.9;
      const dy = (sample(x, y - 1) - sample(x, y + 1)) * 4.9;
      const nz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + nz * nz) || 1;
      normal.data[p + 0] = Math.round((dx / len * 0.5 + 0.5) * 255);
      normal.data[p + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
      normal.data[p + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      normal.data[p + 3] = 255;

      const rough = Math.max(170, Math.min(252, 224 - h * 22 + colorRng() * 20));
      roughness.data[p + 0] = rough;
      roughness.data[p + 1] = rough;
      roughness.data[p + 2] = rough;
      roughness.data[p + 3] = 255;
    }
  }

  colorCtx.putImageData(color, 0, 0);
  normalCtx.putImageData(normal, 0, 0);
  roughnessCtx.putImageData(roughness, 0, 0);

  return { colorCanvas, normalCanvas, roughnessCanvas };
}

function textureFromCanvas(canvas, {
  color = false,
  repeatX = 1,
  repeatY = 1,
  anisotropy = 8,
} = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createAsphaltMaps({
  size = DEFAULT_SIZE,
  seed = DEFAULT_SEED,
  repeatX = 1,
  repeatY = 1,
  anisotropy = 8,
} = {}) {
  const canvases = createCanvases({ size, seed });
  return {
    map: textureFromCanvas(canvases.colorCanvas, { color: true, repeatX, repeatY, anisotropy }),
    normalMap: textureFromCanvas(canvases.normalCanvas, { repeatX, repeatY, anisotropy }),
    roughnessMap: textureFromCanvas(canvases.roughnessCanvas, { repeatX, repeatY, anisotropy }),
  };
}

export function createAsphaltDetailMaps({
  size = DEFAULT_SIZE,
  seed = DEFAULT_SEED,
  repeatX = 1,
  repeatY = 1,
  anisotropy = 8,
} = {}) {
  const canvases = createCanvases({ size, seed });
  return {
    normalMap: textureFromCanvas(canvases.normalCanvas, { repeatX, repeatY, anisotropy }),
    roughnessMap: textureFromCanvas(canvases.roughnessCanvas, { repeatX, repeatY, anisotropy }),
  };
}

// Cria material PBR de asfalto. Tenta carregar texturas externas em
// `public/textures/asphalt/` (CC0 polyhaven). Se falhar, mantém o fallback
// procedural Canvas. Aplica anti-tile via detail mapping (mesmo normalMap em
// tile 4×) + variation map (fBm low-freq modulando albedo).
export function createAsphaltMaterial({
  repeatX = 40,
  repeatY = 40,
  seed = DEFAULT_SEED,
  normalStrength = 0.58,
  anisotropy = 16,
  useExternal = true,
  variationSeed = 7321,
} = {}) {
  const aniso = Math.min(anisotropy, getMaxAnisotropy());
  const maps = createAsphaltMaps({ repeatX, repeatY, seed, anisotropy: aniso });
  const material = new THREE.MeshStandardMaterial({
    ...maps,
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0.0,
    normalScale: new THREE.Vector2(normalStrength, normalStrength),
  });

  if (useExternal) {
    const set = loadPBRSet({
      basePath: ASPHALT_BASE_PATH,
      repeatX,
      repeatY,
      anisotropy: aniso,
    });
    set.applyTo(material);
    set.promise.then(() => {
      // Detail mapping reusa a própria normalMap PBR — a UV scale é controlada
      // no shader (uDetailScale), não no .repeat da textura.
      const variation = createVariationTexture({ size: 256, seed: variationSeed });
      patchAntiTile(material, {
        detailNormalMap: material.normalMap,
        detailScale: 4.0,
        detailStrength: 0.35,
        variationMap: variation,
        variationScale: 1.0 / Math.max(repeatX, repeatY),
        variationLow: 0.82,
        variationHigh: 1.16,
      });
    });
  }

  return material;
}
