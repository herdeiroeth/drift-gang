// Texturas procedurais (Canvas 2D) específicas de pista — segue o padrão
// estabelecido em rendering/Environment.js#createAsphaltTexture.
//
// Todas retornam THREE.CanvasTexture com wrapping configurado (RepeatWrapping
// pra texturas tile-able; ClampToEdgeWrapping pra texturas que cobrem a pista
// uma única vez como o asfalto baked).

import * as THREE from 'three';

// Asfalto da pista com road markings bakedos: linhas brancas laterais
// + tracejado central. Cobre a pista TODA uma vez (não tile longitudinal).
//
// totalLength em metros, width em metros. Canvas é proporcional ao
// comprimento (cap em 8192px pra GPUs antigas).
//
// Usage: tex.repeat.set(1, 1 / totalLength) pra mapear UV-V em metros pra [0,1].
export function createTrackAsphaltTexture(totalLength, width) {
  const PX_PER_METER = 8;            // 8px/m → 1ª pista de 600m vira ~4800 tall
  const widthPx = 256;               // lateral fixo
  const heightPx = Math.min(8192, Math.max(512, Math.ceil(totalLength * PX_PER_METER)));

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');

  // ---- Asfalto base
  ctx.fillStyle = '#2a2a32';
  ctx.fillRect(0, 0, widthPx, heightPx);

  // Noise procedural — distribuído proporcionalmente ao tamanho do canvas.
  const noiseCount = Math.floor(widthPx * heightPx / 8);
  for (let i = 0; i < noiseCount; i++) {
    const x = Math.random() * widthPx;
    const y = Math.random() * heightPx;
    const v = 30 + Math.random() * 30;
    ctx.fillStyle = `rgba(${v},${v},${v + 5},${0.15 + Math.random() * 0.15})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // Tiras de desgaste vertical sutil (sujeira de pneus em retas)
  for (let i = 0; i < Math.floor(heightPx / 200); i++) {
    const x = Math.random() * widthPx;
    ctx.fillStyle = 'rgba(20,20,25,0.06)';
    ctx.fillRect(x, 0, 2 + Math.random() * 4, heightPx);
  }

  // ---- Road markings
  // Linhas brancas laterais (~4% de cada lado da largura)
  const sideLineW = Math.max(4, Math.floor(widthPx * 0.025));
  ctx.fillStyle = 'rgba(230, 230, 230, 0.92)';
  ctx.fillRect(0, 0, sideLineW, heightPx);
  ctx.fillRect(widthPx - sideLineW, 0, sideLineW, heightPx);

  // Tracejado central — dashes a cada 10m (5m white + 5m gap), 4-6px largura
  const dashLen = 5 * PX_PER_METER;        // 5m
  const gapLen = 5 * PX_PER_METER;
  const centerLineW = Math.max(3, Math.floor(widthPx * 0.018));
  const centerX = (widthPx - centerLineW) * 0.5;
  ctx.fillStyle = 'rgba(220, 220, 220, 0.85)';
  for (let y = 0; y < heightPx; y += dashLen + gapLen) {
    ctx.fillRect(centerX, y, centerLineW, dashLen);
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Não tile lateral nem longitudinal — textura cobre tudo uma vez.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
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
  tex.magFilter = THREE.NearestFilter;  // pixels nítidos no padrão xadrez
  return tex;
}

// Textura de grama: noise verde com 2 tons. Tileable em ambos os eixos.
export function createGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base verde escura
  ctx.fillStyle = '#1a3a1a';
  ctx.fillRect(0, 0, 512, 512);

  // Particles aleatórias claras e escuras pra dar textura
  for (let i = 0; i < 30000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const isLight = Math.random() > 0.5;
    if (isLight) {
      const v = 50 + Math.random() * 40;
      ctx.fillStyle = `rgba(${v * 0.6},${v},${v * 0.5},${0.2 + Math.random() * 0.2})`;
    } else {
      const v = 10 + Math.random() * 20;
      ctx.fillStyle = `rgba(${v * 0.5},${v},${v * 0.4},${0.15 + Math.random() * 0.15})`;
    }
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Textura de curb (zebra) — listras alternadas vermelho/branco perpendiculares
// ao comprimento da pista. UV-V do mesh deve ser arc-length em metros pra
// repeat de 1/curbPatternMeters render-ar 1 par a cada N metros (padrão F1: 2m).
//
// Canvas 32×64: 32 wide (lateral), 64 tall (longitudinal). Top half white,
// bottom half red. Tileable só em V (longitudinal).
export function createCurbTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Metade superior: branco quase puro
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, 32, 32);

  // Metade inferior: vermelho saturado
  ctx.fillStyle = '#cc1414';
  ctx.fillRect(0, 32, 32, 32);

  // Adiciona um pouco de noise pra não ficar plástico demais
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
  return tex;
}
