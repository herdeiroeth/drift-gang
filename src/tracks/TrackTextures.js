// Texturas procedurais (Canvas 2D) específicas de pista — segue o padrão
// estabelecido em rendering/Environment.js#createAsphaltTexture.
//
// Após a migração pra PBR externo, o asfalto BASE da pista usa Asphalt material
// (textures/asphalt/*). Aqui só geramos a layer de MARKINGS (decals overlay com
// transparência), curbs e checker — esses ficam procedurais por terem padrões
// específicos de pista (linhas brancas, zebra F1, xadrez).

import * as THREE from 'three';

// Markings da pista (linhas brancas laterais + tracejado central) renderizadas
// num canvas TRANSPARENTE — pra empilhar como overlay decal sobre o asfalto PBR.
// Cobre a pista TODA uma vez (clamp wrap, repeat = 1×1/length).
export function createTrackMarkingsTexture(totalLength, width) {
  const PX_PER_METER = 8;
  const widthPx = 256;
  const heightPx = Math.min(8192, Math.max(512, Math.ceil(totalLength * PX_PER_METER)));

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, widthPx, heightPx);

  // Linhas brancas laterais (~2.5% de cada lado)
  const sideLineW = Math.max(4, Math.floor(widthPx * 0.025));
  ctx.fillStyle = 'rgba(232, 232, 232, 0.95)';
  ctx.fillRect(0, 0, sideLineW, heightPx);
  ctx.fillRect(widthPx - sideLineW, 0, sideLineW, heightPx);

  // Tracejado central — 5m branco + 5m gap (10m de período)
  const dashLen = 5 * PX_PER_METER;
  const gapLen = 5 * PX_PER_METER;
  const centerLineW = Math.max(3, Math.floor(widthPx * 0.018));
  const centerX = (widthPx - centerLineW) * 0.5;
  ctx.fillStyle = 'rgba(220, 220, 220, 0.88)';
  for (let y = 0; y < heightPx; y += dashLen + gapLen) {
    ctx.fillRect(centerX, y, centerLineW, dashLen);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.premultiplyAlpha = false;
  return tex;
}

// Padrão xadrez preto/branco — pra linha de chegada visual. 64×64, tileable.
export function createCheckerTexture(squares = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const sq = 64 / squares;
  for (let x = 0; x < squares; x++) {
    for (let y = 0; y < squares; y++) {
      ctx.fillStyle = ((x + y) % 2 === 0) ? '#fafafa' : '#0c0c0c';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// Textura de curb (zebra) — listras alternadas vermelho/branco perpendiculares
// ao comprimento da pista.
export function createCurbTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#cc1414';
  ctx.fillRect(0, 32, 32, 32);

  for (let i = 0; i < 400; i++) {
    const x = Math.random() * 32;
    const y = Math.random() * 64;
    const v = Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// LEGADO: Mantido pra compatibilidade caso algum import ainda exista.
// Internamente delega pro novo workflow PBR + markings overlay (no TrackBuilder).
export function createTrackAsphaltTexture(totalLength, width) {
  return createTrackMarkingsTexture(totalLength, width);
}

export function createTrackAsphaltDetailMaps() {
  return { normalMap: null, roughnessMap: null };
}

export function createGrassTexture() {
  console.warn('[TrackTextures] createGrassTexture é legado — use createGrassMaterial de Grass.js');
  return null;
}
