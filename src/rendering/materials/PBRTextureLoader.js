import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAnisotropy = 16;

export function setRendererCapabilities(renderer) {
  if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
    maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  }
}

export function getMaxAnisotropy() {
  return maxAnisotropy;
}

function loadOnce(url, opts) {
  if (cache.has(url)) return cache.get(url);
  const promise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => resolve(tex),
      undefined,
      (err) => reject(err),
    );
  });
  cache.set(url, promise);
  return promise;
}

function configureTexture(tex, { isColor, repeatX, repeatY, anisotropy }) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.min(anisotropy, maxAnisotropy);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Carrega um set PBR (map, normalMap, roughnessMap, aoMap) do diretório basePath.
// Retorna { promise, applyTo(material) } — o material é mutado in-place quando os JPGs chegam.
// Se algum arquivo falhar, o material fica como estava (procedural fallback).
export function loadPBRSet({
  basePath,
  files = {
    map: 'albedo.jpg',
    normalMap: 'normal.jpg',
    roughnessMap: 'roughness.jpg',
    aoMap: 'ao.jpg',
  },
  repeatX = 1,
  repeatY = 1,
  anisotropy = 16,
}) {
  const tasks = Object.entries(files).map(([slot, file]) => {
    const url = `${basePath}/${file}`;
    return loadOnce(url).then((tex) => {
      const isColor = slot === 'map';
      const cloned = tex.clone();
      configureTexture(cloned, { isColor, repeatX, repeatY, anisotropy });
      return [slot, cloned];
    }).catch((err) => {
      console.warn(`[PBRTextureLoader] falha em ${url}:`, err.message || err);
      return [slot, null];
    });
  });

  const promise = Promise.all(tasks).then((entries) => {
    const maps = {};
    for (const [slot, tex] of entries) {
      if (tex) maps[slot] = tex;
    }
    return maps;
  });

  return {
    promise,
    applyTo(material) {
      promise.then((maps) => {
        if (!maps) return;
        const dispose = (key) => {
          const old = material[key];
          if (old && old !== maps[key] && old.dispose) old.dispose();
        };
        if (maps.map) { dispose('map'); material.map = maps.map; }
        if (maps.normalMap) { dispose('normalMap'); material.normalMap = maps.normalMap; }
        if (maps.roughnessMap) { dispose('roughnessMap'); material.roughnessMap = maps.roughnessMap; }
        if (maps.aoMap) { dispose('aoMap'); material.aoMap = maps.aoMap; }
        material.needsUpdate = true;
      });
    },
  };
}

// Cria uma textura de variação low-frequency (fBm) procedurally — sem asset externo.
// Use com repeat MUITO baixo (0.03-0.08) pra modular albedo em tiles grandes.
export function createVariationTexture({ size = 256, seed = 1234 } = {}) {
  let s = seed >>> 0;
  const rand = () => {
    s += 0x6D2B79F5;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  // fBm 4 oitavas, com seed-shift por oitava pra evitar artifacts.
  const grid = [];
  for (let o = 0; o < 4; o++) {
    const cells = 4 << o;
    const cell = new Float32Array(cells * cells);
    for (let i = 0; i < cell.length; i++) cell[i] = rand();
    grid.push({ cells, cell });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (g, x, y) => {
    const fx = x * g.cells;
    const fy = y * g.cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = (x0 + 1) % g.cells, y1 = (y0 + 1) % g.cells;
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = g.cell[(y0 % g.cells) * g.cells + (x0 % g.cells)];
    const b = g.cell[(y0 % g.cells) * g.cells + x1];
    const c = g.cell[y1 * g.cells + (x0 % g.cells)];
    const d = g.cell[y1 * g.cells + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let n = 0, amp = 1, sum = 0;
      for (let o = 0; o < 4; o++) {
        n += sample(grid[o], u, v) * amp;
        sum += amp;
        amp *= 0.5;
      }
      const val = Math.max(0, Math.min(1, n / sum));
      const p = (y * size + x) * 4;
      const g = Math.round(val * 255);
      img.data[p] = img.data[p + 1] = img.data[p + 2] = g;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Patch de shader pra MeshStandardMaterial: detail mapping (high-freq normal)
// + variation map (low-freq albedo modulation). Anti-tile combo.
export function patchAntiTile(material, {
  detailNormalMap,
  detailScale = 4.0,
  detailStrength = 0.4,
  variationMap,
  variationScale = 0.05,
  variationLow = 0.78,
  variationHigh = 1.18,
} = {}) {
  if (!detailNormalMap && !variationMap) return material;
  material.userData = material.userData || {};
  material.userData.antiTileUniforms = {
    uDetailNormal: { value: detailNormalMap || null },
    uDetailScale: { value: detailScale },
    uDetailStrength: { value: detailStrength },
    uVariation: { value: variationMap || null },
    uVariationScale: { value: variationScale },
    uVariationLow: { value: variationLow },
    uVariationHigh: { value: variationHigh },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.userData.antiTileUniforms);

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform sampler2D uDetailNormal;
      uniform float uDetailScale;
      uniform float uDetailStrength;
      uniform sampler2D uVariation;
      uniform float uVariationScale;
      uniform float uVariationLow;
      uniform float uVariationHigh;
      `,
    );

    if (variationMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float v = texture2D(uVariation, vMapUv * uVariationScale).r;
          float k = mix(uVariationLow, uVariationHigh, v);
          diffuseColor.rgb *= k;
        }
        `,
      );
    }

    if (detailNormalMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 detailN = texture2D(uDetailNormal, vMapUv * uDetailScale).rgb * 2.0 - 1.0;
          normal = normalize(normal + detailN * uDetailStrength);
        }
        `,
      );
    }
  };
  material.needsUpdate = true;
  return material;
}
