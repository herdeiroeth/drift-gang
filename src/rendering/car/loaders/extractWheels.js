import * as THREE from 'three';

// Detecta os clusters de roda dentro do gltfScene (pneu + aro + hub + disco
// de freio + caliper) e reparenta cada cluster no `wheel.mesh` físico
// correspondente. Rodas detectadas herdam pose da física (suspensão + steer
// + spin) sem código extra: wheel.mesh é setado a cada frame por Wheel.js
// + CarVisuals.js.
//
// Chave do design: o GLB típico (BMW M4 F82) tem 2-3 nós top-level POR roda
// (ex.: ARm4_vt_wheel00X + Object_400X + amdb11_brakedisc_FR00X). Se
// extrairmos só 1 deles, os outros ficam parados no gltfRoot, na posição
// original do GLB — aparecem como "rodas voadoras" ao lado do carro. A
// solução é extrair POR QUADRANTE: agrupar todos os nodes que ficam no
// mesmo canto (FL/FR/RL/RR) e mover o cluster inteiro pra wheel.mesh.
//
// Retorna { ok: bool, wheelGroups?: [hub × 4] }.
export function extractAndReparentWheels(gltfRoot, wheels) {
  const wheelSet = collectWheelBuckets(gltfRoot);
  if (!wheelSet.ok) {
    if (wheelSet.reason === 'few-candidates') {
      console.warn('[extractWheels] Found only', wheelSet.candidates.length, 'wheel components. Falling back to procedural.');
    } else {
      console.warn('[extractWheels] Empty quadrants:', wheelSet.empty.join(', '), 'Found:',
        wheelSet.candidates.map(c => c.node.name));
    }
    return { ok: false };
  }
  const { buckets } = wheelSet;

  // Mapping físico: wheels[0]=FL, [1]=FR, [2]=RL, [3]=RR (ver Car.js:120-125)
  const physMap = [
    [wheels[0], buckets.fl],
    [wheels[1], buckets.fr],
    [wheels[2], buckets.rl],
    [wheels[3], buckets.rr],
  ];

  const wheelGroups = [];
  for (const [physWheel, candList] of physMap) {
    const hub = buildWheelHub(candList, physWheel);
    wheelGroups.push(hub);
  }

  console.log('[extractWheels] OK — extracted',
    Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.map(c => c.node.name)])));
  return { ok: true, wheelGroups };
}

export function measureWheelLayoutFromGltf(gltfRoot) {
  const wheelSet = collectWheelBuckets(gltfRoot);
  if (!wheelSet.ok) return null;

  const centers = {
    fl: combinedBounds(wheelSet.buckets.fl).center,
    fr: combinedBounds(wheelSet.buckets.fr).center,
    rl: combinedBounds(wheelSet.buckets.rl).center,
    rr: combinedBounds(wheelSet.buckets.rr).center,
  };
  const sizes = {
    fl: combinedBounds(wheelSet.buckets.fl).size,
    fr: combinedBounds(wheelSet.buckets.fr).size,
    rl: combinedBounds(wheelSet.buckets.rl).size,
    rr: combinedBounds(wheelSet.buckets.rr).size,
  };

  const halfWidth = (
    Math.abs(centers.fl.x) +
    Math.abs(centers.fr.x) +
    Math.abs(centers.rl.x) +
    Math.abs(centers.rr.x)
  ) * 0.25;
  const frontAxleZ = (centers.fl.z + centers.fr.z) * 0.5;
  const rearAxleZ  = (centers.rl.z + centers.rr.z) * 0.5;

  const wheelDims = Object.values(sizes).map(wheelDimensionsFromSize);
  const avg = (key) => wheelDims.reduce((sum, dim) => sum + dim[key], 0) / wheelDims.length;

  return {
    centers,
    sizes,
    halfWidth,
    frontAxleZ,
    rearAxleZ,
    axleMidZ: (frontAxleZ + rearAxleZ) * 0.5,
    wheelBase: frontAxleZ - rearAxleZ,
    wheelRadius: avg('radius'),
    wheelWidth: avg('width'),
  };
}

// Coleta nodes que compõem o conjunto da roda (pneu, aro, hub, disco, caliper).
// Filtros em ordem:
//   1. EXCLUDE_NAME: rejeita nomes claramente NÃO-roda (faróis, fenders, mudflaps,
//      etc.) — necessário porque esses componentes podem cair em quadrantes de
//      canto e passar nos filtros geométricos.
//   2. INCLUDE_NAME: aceita nomes claros de componente de roda (wheel, tire, rim,
//      brakedisc, caliper, rotor, hub).
//   3. Nome ambíguo (ex.: "Object_400X"): só aceita se bbox é cilíndrico
//      (eixo "fino" ≪ outros 2) e tamanho razoável de roda.
const INCLUDE_NAME = /(wheel|tire|tyre|rim|brakedisc|brake_disc|caliper|rotor|hub_assembly|hubcap|whl)/i;
const EXCLUDE_NAME = /(headlight|head_light|taillight|tail_light|fender|mudflap|spoiler|trim|grill|interior|seat|window|glass|mirror|plate|exhaust|antenna|body|chassis|door|hood|bumper|skirt|sticker|decal|emblem|logo_body|engine|trunk|sunroof)/i;
const NEUTRAL_NAME = /^(object_|mesh_|node_|untitled)/i;

function collectWheelBuckets(gltfRoot) {
  gltfRoot.updateMatrixWorld(true);

  // Bbox global do carro pra estabelecer centro e referenciar quadrantes
  const carBbox  = new THREE.Box3().setFromObject(gltfRoot);
  const carCenter = new THREE.Vector3(); carBbox.getCenter(carCenter);
  const carSize   = new THREE.Vector3(); carBbox.getSize(carSize);

  // Coletar candidates: nodes (top-level e netos) com bbox compatível com
  // componente de roda e centro em quadrante "de canto" do carro.
  const candidates = collectWheelComponents(gltfRoot, carCenter, carSize);

  if (candidates.length < 4) {
    return { ok: false, reason: 'few-candidates', candidates };
  }

  // Mapear cada candidato pra quadrante FL/FR/RL/RR pelo sinal de centro
  const buckets = { fl: [], fr: [], rl: [], rr: [] };
  for (const cand of candidates) {
    const dx = cand.center.x - carCenter.x;
    const dz = cand.center.z - carCenter.z;
    const key = (dz > 0 ? 'f' : 'r') + (dx < 0 ? 'l' : 'r');
    buckets[key].push(cand);
  }

  const empty = ['fl', 'fr', 'rl', 'rr'].filter(k => buckets[k].length === 0);
  if (empty.length > 0) {
    return { ok: false, reason: 'empty-buckets', empty, candidates };
  }

  return { ok: true, buckets, candidates, carCenter, carSize };
}

function collectWheelComponents(root, carCenter, carSize) {
  const out = [];
  const seen = new Set();

  // Quadrantes de roda ficam em ±20..55% da largura/comprimento do carro
  const minDx = carSize.x * 0.20;
  const maxDx = carSize.x * 0.55;
  const minDz = carSize.z * 0.20;
  const maxDz = carSize.z * 0.55;
  const minComp = 0.04;
  const maxComp = 1.0;

  function isWheelComponent(node) {
    if (!node || seen.has(node)) return null;
    const name = node.name || '';

    // Rejeitar imediatamente se nome bate com exclusão
    if (EXCLUDE_NAME.test(name)) return null;

    let hasMesh = false;
    node.traverse(n => { if (n.isMesh) hasMesh = true; });
    if (!hasMesh) return null;

    const bbox = new THREE.Box3().setFromObject(node);
    if (!isFinite(bbox.min.x)) return null;
    const size = new THREE.Vector3(); bbox.getSize(size);
    const center = new THREE.Vector3(); bbox.getCenter(center);

    const longest = Math.max(size.x, size.y, size.z);
    if (longest < minComp || longest > maxComp) return null;

    const dx = Math.abs(center.x - carCenter.x);
    const dz = Math.abs(center.z - carCenter.z);
    if (dx < minDx || dx > maxDx) return null;
    if (dz < minDz || dz > maxDz) return null;

    // Aceita se nome é claramente de roda
    if (INCLUDE_NAME.test(name)) return { node, center, size };

    // Nome neutro/genérico: exigir bbox cilíndrico (eixo fino << demais)
    // pra evitar fender/mudflap/light que tem bbox achatado em direção diferente.
    if (NEUTRAL_NAME.test(name) || name === '') {
      const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
      const cylindricality = dims[0] / Math.max(dims[1], 1e-6);
      // Cilíndrico: 2 dims maiores ≈ iguais, 1 dim ≪ (cylindricality < 0.7)
      const isAxisRatio = dims[2] / Math.max(dims[1], 1e-6) < 1.4;
      if (cylindricality < 0.7 && isAxisRatio) return { node, center, size };
    }

    return null;
  }

  // Walk recursivo. Quando achar um candidato, marca todo o subtree como
  // visto pra evitar pegar sub-meshes individuais (ex.: o pneu separado do
  // aro). Sem isso, o traverse padrão do Three.js pegaria cada Mesh interno.
  function walk(node) {
    if (seen.has(node)) return;
    const cand = isWheelComponent(node);
    if (cand) {
      out.push(cand);
      node.traverse(n => seen.add(n));
      return;
    }
    for (const child of node.children) walk(child);
  }
  walk(root);

  return out;
}

// Regex de sub-meshes que ficam ESTÁTICOS (não giram com a roda). Caliper e
// brake pads são presos ao knuckle no mundo real — só o disco + cubo + aro
// + pneu giram. No BMW M4 GLB, o cluster `amdb11_brakedisc_FR.XXX` agrupa
// disco + caliper + pads como sub-meshes irmãos (mesmo node parent), então
// um único `child.rotation.x += av*dt` no parent gira tudo junto. Identifica-
// mos os sub-meshes pelo nome e separamos antes do spin.
const STATIC_SUBMESH_NAME = /(caliper|brakepad|brake_pad|brake_caliper)/i;

// Cria um hub group em wheel.mesh e reparenta os componentes do cluster
// separando-os entre `spinHub` (gira com a roda) e `staticHub` (fixo no
// knuckle). O hub central recebe a correção de spin axis e o spin runtime
// é aplicado SOMENTE no spinHub — caliper/pad permanecem visíveis e parados.
function buildWheelHub(candList, physWheel) {
  // 1) Bbox combinado de todos os componentes do cluster
  const { center, size, ok } = combinedBounds(candList);
  if (!ok) return null;

  // 2) Hub vai pra wheel.mesh; sub-grupos isolam parte rotativa da estática
  const hub = new THREE.Group();
  hub.name = 'wheelHub';
  const spinHub = new THREE.Group();
  spinHub.name = 'wheelSpinning';
  const staticHub = new THREE.Group();
  staticHub.name = 'wheelStatic';
  hub.add(spinHub);
  hub.add(staticHub);

  // 3) Reparent cada componente preservando matrix world. Para clusters
  // mistos (disco+caliper no mesmo parent), descemos um nível e separamos
  // sub-meshes pelo nome — assim o caliper sai do parent que vai pro spin.
  for (const cand of candList) {
    splitClusterIntoSpinAndStatic(cand.node, spinHub, staticHub, center);
  }

  // 4) Detectar eixo de spin pelo bbox combinado (largura do pneu < raio)
  const spinAxis = detectSpinAxis(size);
  if (spinAxis === 'y') hub.rotation.z = Math.PI / 2;
  else if (spinAxis === 'z') hub.rotation.y = Math.PI / 2;
  // 'x' = já alinhado (caso típico de carros importados em GLB), no-op

  // 5) Anexar ao wheel.mesh físico
  physWheel.mesh.add(hub);

  hub.userData.isGltfWheelHub = true;
  hub.userData.physWheel = physWheel;
  hub.userData.spinHub = spinHub;
  hub.userData.staticHub = staticHub;
  return hub;
}

// Decide se reparenta o cluster inteiro pro spinHub OU desce um nível e
// reparenta cada sub-mesh individualmente (caliper/pad → staticHub, resto →
// spinHub). Decisão: cluster inteiro vai pro spin se NENHUM child tem nome
// estático. Caso contrário, o parent é desmontado.
function splitClusterIntoSpinAndStatic(node, spinHub, staticHub, center) {
  const children = [...node.children];
  const hasStaticChild = children.some(
    (c) => STATIC_SUBMESH_NAME.test(c.name || ''),
  );

  if (!hasStaticChild) {
    bakeAndAppend(node, spinHub, center);
    return;
  }

  for (const child of children) {
    const dest = STATIC_SUBMESH_NAME.test(child.name || '') ? staticHub : spinHub;
    bakeAndAppend(child, dest, center);
  }
  node.parent?.remove(node);
}

function bakeAndAppend(node, target, center) {
  node.updateMatrixWorld(true);
  const wm = node.matrixWorld.clone();
  node.parent?.remove(node);
  // Bake matrix world como local (preserva scale ~0.012 herdada do gltfRoot)
  node.matrix.copy(wm);
  node.matrix.decompose(node.position, node.quaternion, node.scale);
  // Centralizar cluster no eixo de spin: subtrai o center comum a todos
  node.position.sub(center);
  target.add(node);
}

// Eixo "fino" do bbox = eixo de spin (largura do pneu < raio externo).
function detectSpinAxis(size) {
  const arr = [
    { axis: 'x', val: size.x },
    { axis: 'y', val: size.y },
    { axis: 'z', val: size.z },
  ].sort((a, b) => a.val - b.val);
  return arr[0].axis;
}

function combinedBounds(candList) {
  const combined = new THREE.Box3();
  let any = false;
  for (const c of candList) {
    const b = new THREE.Box3().setFromObject(c.node);
    if (isFinite(b.min.x)) {
      combined.union(b);
      any = true;
    }
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  if (any) {
    combined.getCenter(center);
    combined.getSize(size);
  }
  return { ok: any, center, size };
}

function wheelDimensionsFromSize(size) {
  const spinAxis = detectSpinAxis(size);
  const dims = { x: size.x, y: size.y, z: size.z };
  const width = dims[spinAxis];
  const radialAxes = ['x', 'y', 'z'].filter(axis => axis !== spinAxis);
  const diameter = Math.max(dims[radialAxes[0]], dims[radialAxes[1]]);
  return { width, radius: diameter * 0.5 };
}
