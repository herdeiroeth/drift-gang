// Funções puras de geração de geometria de pista.
// Recebem dados (control points, samples, larguras), retornam BufferGeometry/arrays.
// Não tocam em scene/materiais — quem orquestra é TrackBuilder.

import * as THREE from 'three';
import { TRACK_CFG } from '../core/constants.js';

// Cria a CatmullRomCurve3 fechada/aberta a partir dos control points 2D.
// Y=0 (pista plana V1). Banking entra em V2.
export function buildCurve(controlPoints, closed = true, tension = 0.5) {
  const pts3 = controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(pts3, closed, 'catmullrom', tension);
  return curve;
}

// Amostra a spline em N pontos uniformemente espaçados em arc-length,
// retornando posição, tangente unitária e binormal lateral (perpendicular no XZ).
// Pista plana V1 — binormal = (0,1,0) × tangent projetada em XZ. Evita Frenet flip.
export function sampleSpline(curve, samplesPerMeter = TRACK_CFG.samplesPerMeter) {
  const totalLength = curve.getLength();
  const N = Math.max(8, Math.ceil(totalLength * samplesPerMeter));
  const samples = new Array(N);
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < N; i++) {
    const t = i / N;
    const pos = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    // binormal = up × tangent (lateral pra esquerda quando tangent aponta +Z)
    const binormal = new THREE.Vector3().crossVectors(up, tangent).normalize();
    samples[i] = { pos, tangent, binormal, t, arcLength: t * totalLength };
  }

  return { samples, totalLength, N };
}

// Constrói a malha indexada de uma faixa lateral à pista: par de vértices
// (left, right) por sample com offsets ao longo da binormal.
//
// leftOffset / rightOffset (m): distância do centro da spline ao longo da
// binormal. Convenção: binormal = up × tangent → aponta pro lado "esquerdo"
// quando tangent vai +Z. Offsets positivos = lado esquerdo, negativos = direito.
//
// Exemplos:
//   asfalto:    buildSurfaceGeometry(samples, +halfWidth, -halfWidth)
//   curb left:  buildSurfaceGeometry(samples, +halfWidth + curbW, +halfWidth)
//   curb right: buildSurfaceGeometry(samples, -halfWidth, -halfWidth - curbW)
//
// y=0 sempre. UVs: u = [0..1] lateral, v = arcLength em metros.
// Mesh deve setar tex.repeat baseado em quão denso quer o tile longitudinal.
//
// `yOffset` (default 0) levanta a malha em Y pra evitar z-fight com vizinhos.
export function buildSurfaceGeometry(samples, leftOffset, rightOffset, closed = true, yOffset = 0) {
  const N = samples.length;
  const totalVerts = N * 2;
  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const lx = s.pos.x + s.binormal.x * leftOffset;
    const lz = s.pos.z + s.binormal.z * leftOffset;
    const rx = s.pos.x + s.binormal.x * rightOffset;
    const rz = s.pos.z + s.binormal.z * rightOffset;

    // left vertex (índice 2i)
    positions[i * 6 + 0] = lx;
    positions[i * 6 + 1] = yOffset;
    positions[i * 6 + 2] = lz;
    // right vertex (índice 2i+1)
    positions[i * 6 + 3] = rx;
    positions[i * 6 + 4] = yOffset;
    positions[i * 6 + 5] = rz;

    uvs[i * 4 + 0] = 0;             // left u
    uvs[i * 4 + 1] = s.arcLength;   // left v (em metros — repeat lida com tile)
    uvs[i * 4 + 2] = 1;             // right u
    uvs[i * 4 + 3] = s.arcLength;   // right v
  }

  // Indices: 2 triângulos por par de cross-sections consecutivas.
  // Winding CCW visto de cima → normal aponta +Y → front face fica em cima
  // (que é o que a câmera/sombra esperam).
  // Quad: (left_i, right_i, left_{i+1}, right_{i+1}).
  // Tris: (li, ri, lj) e (ri, rj, lj).
  const numQuads = closed ? N : N - 1;
  const indices = new Uint32Array(numQuads * 6);
  for (let i = 0; i < numQuads; i++) {
    const j = (i + 1) % N;
    const li = i * 2;
    const ri = i * 2 + 1;
    const lj = j * 2;
    const rj = j * 2 + 1;

    indices[i * 6 + 0] = li;
    indices[i * 6 + 1] = ri;
    indices[i * 6 + 2] = lj;

    indices[i * 6 + 3] = ri;
    indices[i * 6 + 4] = rj;
    indices[i * 6 + 5] = lj;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

// Constrói curb com perfil 3D real: rampa de entrada → plateau → rampa de saída.
// Cross-section em formato trapezoidal:
//
//             plateau (height)
//          b ────────── c
//         /              \
//        / ramp     ramp  \
//       /                  \
//      a ──── (Y=0) ──── d
//     inner              outer
//
// Cada sample gera 4 vértices (a, b, c, d). 3 strips de quads conectam
// samples consecutivos: inner-ramp + plateau + outer-ramp.
//
// `innerOffset` = distância na binormal do limite com asfalto (Y=0)
// `outerOffset` = distância do limite com grama (Y=0)
// `height`      = altura do plateau (m). 0.04-0.08 é o range realista F1.
// `rampFrac`    = fração da largura total dedicada a cada rampa (0.3 = 30% de cada lado, 40% plateau)
// `yBase`       = pequeno offset em Y pra evitar z-fight com asfalto/grama vizinhos
//
// Material do mesh deve usar `side: DoubleSide` (evita preocupação com winding
// quando dir negativo — curb right tem outerOffset < innerOffset).
export function buildCurbProfileGeometry(
  samples, innerOffset, outerOffset, height, rampFrac = 0.3, closed = true, yBase = 0.001,
) {
  const N = samples.length;
  const totalVerts = N * 4;
  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  const totalWidth = outerOffset - innerOffset;
  const dir = Math.sign(totalWidth) || 1;
  const rampW = Math.abs(totalWidth) * rampFrac;

  // Cross-section: 4 offsets laterais e 4 alturas
  const offs = [
    innerOffset,                            // a — inner edge (Y=base)
    innerOffset + dir * rampW,              // b — top inner (Y=base+height)
    outerOffset - dir * rampW,              // c — top outer (Y=base+height)
    outerOffset,                            // d — outer edge (Y=base)
  ];
  const ys = [yBase, yBase + height, yBase + height, yBase];
  // UVs laterais: u=0 inner, u=1 outer (textura cobre largura uma vez).
  // Plateau ocupa u=[rampFrac, 1-rampFrac]; rampas ocupam o resto.
  const us = [0, rampFrac, 1 - rampFrac, 1];

  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const base = i * 4;
    for (let k = 0; k < 4; k++) {
      positions[(base + k) * 3 + 0] = s.pos.x + s.binormal.x * offs[k];
      positions[(base + k) * 3 + 1] = ys[k];
      positions[(base + k) * 3 + 2] = s.pos.z + s.binormal.z * offs[k];
      uvs[(base + k) * 2 + 0] = us[k];
      uvs[(base + k) * 2 + 1] = s.arcLength;
    }
  }

  // 3 strips × 2 triângulos = 6 tris por sample-pair, 18 índices.
  const numQuads = closed ? N : N - 1;
  const indices = new Uint32Array(numQuads * 18);
  for (let i = 0; i < numQuads; i++) {
    const j = (i + 1) % N;
    const ai = i * 4 + 0, bi = i * 4 + 1, ci = i * 4 + 2, di = i * 4 + 3;
    const aj = j * 4 + 0, bj = j * 4 + 1, cj = j * 4 + 2, dj = j * 4 + 3;
    const off = i * 18;

    // Inner ramp (a–b strip)
    indices[off + 0]  = ai; indices[off + 1]  = bi; indices[off + 2]  = aj;
    indices[off + 3]  = bi; indices[off + 4]  = bj; indices[off + 5]  = aj;
    // Plateau (b–c strip)
    indices[off + 6]  = bi; indices[off + 7]  = ci; indices[off + 8]  = bj;
    indices[off + 9]  = ci; indices[off + 10] = cj; indices[off + 11] = bj;
    // Outer ramp (c–d strip)
    indices[off + 12] = ci; indices[off + 13] = di; indices[off + 14] = cj;
    indices[off + 15] = di; indices[off + 16] = dj; indices[off + 17] = cj;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

// Bbox 2D dos samples (XZ). Útil pra dimensionar terreno ao redor.
export function computeSamplesBbox(samples) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of samples) {
    if (s.pos.x < minX) minX = s.pos.x;
    if (s.pos.x > maxX) maxX = s.pos.x;
    if (s.pos.z < minZ) minZ = s.pos.z;
    if (s.pos.z > maxZ) maxZ = s.pos.z;
  }
  return {
    minX, maxX, minZ, maxZ,
    sizeX: maxX - minX,
    sizeZ: maxZ - minZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}
