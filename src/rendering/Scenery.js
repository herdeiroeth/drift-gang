// Scenery 3D — preenche o horizonte ao redor da pista com objetos reais
// em vez de depender de imagem HDRI baked. Tudo low-poly + InstancedMesh
// pra manter custo de render trivial.
//
// Estrutura:
//   - Plantação: 4-6 fileiras alinhadas (orchard look) num quadrante
//   - Floresta esparsa: árvores espalhadas em anel ao redor da pista
//   - Linha de transmissão: postes de madeira espaçados com cabos catenários
//   - Torre de transmissão: 1 estrutura de treliça metálica alta
//
// Tudo recebe shadow casting (sombras alongadas no asfalto = look golden hour).

import * as THREE from 'three';

const TRUNK_GEO = new THREE.CylinderGeometry(0.18, 0.32, 1.0, 6);
const CROWN_GEO = new THREE.IcosahedronGeometry(1.0, 0);

// PRNG seedable pra distribuição reprodutível
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Cria 2 InstancedMesh (trunk + crown) compartilhando a mesma transform por instância.
function createForestInstanced({ count, positions, scales, rotations }) {
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4a2f1c, roughness: 0.92, metalness: 0.0,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x3d6526, roughness: 0.95, metalness: 0.0,
  });
  const trunk = new THREE.InstancedMesh(TRUNK_GEO, trunkMat, count);
  const crown = new THREE.InstancedMesh(CROWN_GEO, crownMat, count);
  trunk.castShadow = true;
  crown.castShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const [x, z] = positions[i];
    const s = scales[i];
    const ry = rotations[i];

    // Trunk — altura ~ 2.5 * s, base no chão
    dummy.position.set(x, 1.25 * s, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.set(s * 1.0, s * 2.5, s * 1.0);
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);

    // Crown — esfera achatada acima do tronco
    dummy.position.set(x, s * 3.6, z);
    dummy.rotation.set(0, ry, 0);
    const cs = s * (1.6 + (i % 7) * 0.06);
    dummy.scale.set(cs, cs * 0.9, cs);
    dummy.updateMatrix();
    crown.setMatrixAt(i, dummy.matrix);

    // Pequena variação de cor por instância (matiz da copa)
    const tint = new THREE.Color().setHSL(0.27 + ((i * 13) % 23) * 0.001, 0.55, 0.28 + ((i * 7) % 11) * 0.005);
    crown.setColorAt(i, tint);
  }
  trunk.instanceMatrix.needsUpdate = true;
  crown.instanceMatrix.needsUpdate = true;
  if (crown.instanceColor) crown.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunk);
  group.add(crown);
  return group;
}

// Plantação: fileiras alinhadas num retângulo (orchard).
// origin = canto inferior esquerdo, dirX/dirZ = orientação das fileiras (unit vec).
function generatePlantationData({ originX, originZ, dirX, dirZ, rows, cols, spacingRow, spacingCol, jitter, seed }) {
  const rng = mulberry32(seed);
  const positions = [];
  const scales = [];
  const rotations = [];
  // perpendicular ao dir
  const perpX = -dirZ;
  const perpZ = dirX;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jr = (rng() - 0.5) * jitter;
      const jc = (rng() - 0.5) * jitter;
      const tr = r * spacingRow + jr;
      const tc = c * spacingCol + jc;
      const x = originX + dirX * tr + perpX * tc;
      const z = originZ + dirZ * tr + perpZ * tc;
      positions.push([x, z]);
      scales.push(0.85 + rng() * 0.45);
      rotations.push(rng() * Math.PI * 2);
    }
  }
  return { positions, scales, rotations, count: positions.length };
}

// Floresta esparsa em anel ao redor do bbox. Filtra qualquer ponto que cair
// dentro do bbox + buffer (não queremos árvore na pista).
function generateForestRingData({ cx, cz, innerRadius, outerRadius, count, seed, exclusionRect }) {
  const rng = mulberry32(seed);
  const positions = [];
  const scales = [];
  const rotations = [];
  let attempts = 0;
  while (positions.length < count && attempts < count * 6) {
    attempts++;
    const angle = rng() * Math.PI * 2;
    const radius = innerRadius + rng() * (outerRadius - innerRadius);
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    if (exclusionRect && pointInRect(x, z, exclusionRect)) continue;
    positions.push([x, z]);
    scales.push(0.6 + rng() * rng() * 1.4);
    rotations.push(rng() * Math.PI * 2);
  }
  return { positions, scales, rotations, count: positions.length };
}

function pointInRect(x, z, rect) {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

// ---- POSTES ELÉTRICOS COM CABOS CATENÁRIOS

function createWoodPole(height = 9) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2914, roughness: 0.95 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x2a1e10, roughness: 0.92 });

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, height, 8),
    trunkMat,
  );
  pole.position.y = height * 0.5;
  pole.castShadow = true;
  group.add(pole);

  // Travessa horizontal pra suportar 3 cabos
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.18, 0.18),
    armMat,
  );
  arm.position.y = height - 0.6;
  arm.castShadow = true;
  group.add(arm);

  // Travessa secundária menor
  const arm2 = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.14, 0.14),
    armMat,
  );
  arm2.position.y = height - 1.4;
  arm2.castShadow = true;
  group.add(arm2);

  return group;
}

// Cabo catenário entre 2 pontos (TubeGeometry com curve sag).
function createCable(from, to, sag = 0.8, color = 0x1a1a1a) {
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
  const geo = new THREE.TubeGeometry(curve, 12, 0.04, 4, false);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

// Linha de postes ao longo de segmento reto (x1,z1) → (x2,z2)
function buildPowerLine({ x1, z1, x2, z2, spacing = 38, height = 9 }) {
  const group = new THREE.Group();
  group.name = 'power-line';
  const dx = x2 - x1, dz = z2 - z1;
  const length = Math.sqrt(dx * dx + dz * dz);
  const count = Math.max(2, Math.floor(length / spacing));
  const ux = dx / length, uz = dz / length;
  // Perpendicular pra alinhar travessa
  const px = -uz, pz = ux;
  const orientationY = Math.atan2(ux, uz);

  const poles = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const px_ = x1 + dx * t;
    const pz_ = z1 + dz * t;
    const pole = createWoodPole(height);
    pole.position.set(px_, 0, pz_);
    pole.rotation.y = orientationY;
    group.add(pole);
    poles.push({ x: px_, z: pz_, orientY: orientationY });
  }

  // Cabos: 3 cables paralelos por vão entre postes consecutivos
  // Posições laterais dos 3 cables na travessa (y = height - 0.5):
  const cableYTop = height - 0.55;
  const cableYBot = height - 1.45;
  const lateralOffsets = [-0.95, 0.0, 0.95]; // 3 cables na travessa de cima
  const lateralBot = [-0.7, 0.7];            // 2 na travessa de baixo

  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i];
    const b = poles[i + 1];
    for (const off of lateralOffsets) {
      const fromV = new THREE.Vector3(a.x + px * off, cableYTop, a.z + pz * off);
      const toV = new THREE.Vector3(b.x + px * off, cableYTop, b.z + pz * off);
      group.add(createCable(fromV, toV, 0.65));
    }
    for (const off of lateralBot) {
      const fromV = new THREE.Vector3(a.x + px * off, cableYBot, a.z + pz * off);
      const toV = new THREE.Vector3(b.x + px * off, cableYBot, b.z + pz * off);
      group.add(createCable(fromV, toV, 0.55));
    }
  }
  return group;
}

// ---- TORRE DE TRANSMISSÃO (treliça simples)

function buildRadioTower({ x, z, height = 38 }) {
  const group = new THREE.Group();
  group.name = 'radio-tower';
  group.position.set(x, 0, z);

  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.45, metalness: 0.85 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xc81818, roughness: 0.5, metalness: 0.3, emissive: 0x440808, emissiveIntensity: 0.3 });

  // 4 pernas de tubo afinando pro topo
  const legGeoBottom = new THREE.CylinderGeometry(0.05, 0.12, height, 6);
  const legSpacing = 2.4;
  const legPositions = [
    [+legSpacing * 0.5, +legSpacing * 0.5],
    [-legSpacing * 0.5, +legSpacing * 0.5],
    [+legSpacing * 0.5, -legSpacing * 0.5],
    [-legSpacing * 0.5, -legSpacing * 0.5],
  ];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(legGeoBottom, metalMat);
    // Inclinar pra centro no topo
    const tilt = Math.atan2(legSpacing * 0.4, height);
    leg.position.set(lx * 0.7, height * 0.5, lz * 0.7);
    leg.rotation.set(-Math.atan2(lz, height) * 0.2, 0, Math.atan2(lx, height) * 0.2);
    leg.castShadow = true;
    group.add(leg);
  }

  // Travessas horizontais (anéis estruturais)
  const ringMat = metalMat;
  const ringSegments = 8;
  for (let i = 0; i < ringSegments; i++) {
    const ringY = (i + 1) * (height / (ringSegments + 1));
    const sizeFactor = 1 - (ringY / height) * 0.5;
    const s = legSpacing * sizeFactor * 0.7;
    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(s * 2, 0.06, 0.06),
      ringMat,
    );
    ring.position.y = ringY;
    group.add(ring);
    const ring2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, s * 2),
      ringMat,
    );
    ring2.position.y = ringY;
    group.add(ring2);
  }

  // Antena no topo
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 6, 6),
    metalMat,
  );
  top.position.y = height + 3;
  group.add(top);

  // Luzes vermelhas de aviação (3 níveis)
  for (const ly of [height * 0.5, height * 0.85, height + 4]) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 6, 4),
      redMat,
    );
    light.position.set(legSpacing * 0.5 * 0.6, ly, 0);
    group.add(light);
  }

  return group;
}

// ---- ENTRY POINT

export function buildScenery(scene, opts = {}) {
  const {
    bbox = { cx: 0, cz: 0, sizeX: 200, sizeZ: 200, minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    seed = 4242,
  } = opts;

  const root = new THREE.Group();
  root.name = 'scenery';

  const cx = bbox.cx;
  const cz = bbox.cz;
  // Anel onde árvores e estruturas podem aparecer
  const halfMax = Math.max(bbox.sizeX, bbox.sizeZ) * 0.5;
  const innerR = halfMax + 18;     // 18m de buffer da pista
  const outerR = halfMax + 280;    // 280m de profundidade de cenário
  // Exclusion rect: pista + buffer (não quero árvore caindo na pista mesmo se random der borderline)
  const excl = {
    minX: bbox.minX - 12,
    maxX: bbox.maxX + 12,
    minZ: bbox.minZ - 12,
    maxZ: bbox.maxZ + 12,
  };

  // ---- Plantação (orchard): 5 fileiras × 12 colunas a ~SO da pista
  const plantOriginX = cx - halfMax - 40;
  const plantOriginZ = cz + halfMax + 60;
  const plantation = generatePlantationData({
    originX: plantOriginX,
    originZ: plantOriginZ,
    dirX: 1, dirZ: 0,
    rows: 6,
    cols: 14,
    spacingRow: 6.5,
    spacingCol: 4.8,
    jitter: 1.4,
    seed: seed + 100,
  });
  const plantationMesh = createForestInstanced(plantation);
  plantationMesh.name = 'plantation';
  root.add(plantationMesh);

  // ---- Floresta esparsa em anel ao redor (todos os outros lados)
  const forestData = generateForestRingData({
    cx, cz,
    innerRadius: innerR,
    outerRadius: outerR,
    count: 380,
    seed: seed + 200,
    exclusionRect: {
      minX: plantOriginX - 8, maxX: plantOriginX + 14 * 4.8 + 8,
      minZ: plantOriginZ - 8, maxZ: plantOriginZ + 6 * 6.5 + 8,
    },
  });
  const forestMesh = createForestInstanced(forestData);
  forestMesh.name = 'forest';
  root.add(forestMesh);

  // ---- Linha de transmissão: paralela à pista, lado oposto à plantação (NE)
  const lineX1 = cx + halfMax + 35;
  const lineX2 = cx + halfMax + 35;
  const lineZ1 = cz - halfMax - 60;
  const lineZ2 = cz + halfMax + 60;
  const powerLine = buildPowerLine({
    x1: lineX1, z1: lineZ1,
    x2: lineX2, z2: lineZ2,
    spacing: 36,
    height: 8.8,
  });
  root.add(powerLine);

  // Segunda linha em direção transversal (mostra perspective/depth)
  const line2 = buildPowerLine({
    x1: cx - halfMax - 60,
    z1: cz - halfMax - 80,
    x2: cx + halfMax + 60,
    z2: cz - halfMax - 80,
    spacing: 40,
    height: 8.5,
  });
  root.add(line2);

  // ---- Torre de transmissão: ao fundo distante (atrás da plantação)
  const tower = buildRadioTower({
    x: cx - halfMax - 180,
    z: cz - halfMax - 90,
    height: 42,
  });
  root.add(tower);

  // Segunda torre menor mais distante
  const tower2 = buildRadioTower({
    x: cx + halfMax + 220,
    z: cz + halfMax + 140,
    height: 32,
  });
  root.add(tower2);

  scene.add(root);
  return root;
}
