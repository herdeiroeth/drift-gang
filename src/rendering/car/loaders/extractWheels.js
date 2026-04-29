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
  gltfRoot.updateMatrixWorld(true);

  // Bbox global do carro pra estabelecer centro e referenciar quadrantes
  const carBbox  = new THREE.Box3().setFromObject(gltfRoot);
  const carCenter = new THREE.Vector3(); carBbox.getCenter(carCenter);
  const carSize   = new THREE.Vector3(); carBbox.getSize(carSize);

  // Coletar candidates: nodes (top-level e netos) com bbox compatível com
  // componente de roda e centro em quadrante "de canto" do carro.
  const candidates = collectWheelComponents(gltfRoot, carCenter, carSize);

  if (candidates.length < 4) {
    console.warn('[extractWheels] Found only', candidates.length, 'wheel components. Falling back to procedural.');
    return { ok: false };
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
    console.warn('[extractWheels] Empty quadrants:', empty.join(', '), 'Found:',
      candidates.map(c => c.node.name));
    return { ok: false };
  }

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

// Cria um hub group em wheel.mesh e reparenta TODOS os componentes do cluster
// preservando scale herdada do gltfRoot. Componentes ficam centrados no hub.
function buildWheelHub(candList, physWheel) {
  // 1) Bbox combinado de todos os componentes do cluster
  const combined = new THREE.Box3();
  let any = false;
  for (const c of candList) {
    const b = new THREE.Box3().setFromObject(c.node);
    if (isFinite(b.min.x)) {
      combined.union(b);
      any = true;
    }
  }
  if (!any) return null;
  const center = new THREE.Vector3(); combined.getCenter(center);
  const size   = new THREE.Vector3(); combined.getSize(size);

  // 2) Hub vai pra wheel.mesh
  const hub = new THREE.Group();

  // 3) Reparent cada componente preservando matrix world
  // Importante: a ordem importa porque alguns componentes são filhos de outros
  // que estão sendo movidos. Vamos copiar a referência da lista pra evitar
  // mutação durante o loop.
  for (const cand of candList) {
    const node = cand.node;
    node.updateMatrixWorld(true);
    const wm = node.matrixWorld.clone();
    node.parent?.remove(node);
    // Bake matrix world como local (preserva scale ~0.012 herdada do gltfRoot)
    node.matrix.copy(wm);
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    // Centralizar cluster no hub: subtrair center comum a todos os nodes
    node.position.sub(center);
    hub.add(node);
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
  return hub;
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
