import * as THREE from 'three';
import {
  ensureCarLightMaterial,
  resolveCarLightRole,
} from './loaders/lightMaterials.js';

// Substitui o `buildChassis()` procedural quando há um modelo glTF carregado.
// Recebe o `gltfScene` (já clonado pelo CarModelLoader), calcula scale +
// orientação + offset Y para que o carro caiba no CarConfig atual sem
// alterar nenhum parâmetro físico.
//
// Retorna metadata útil pro extractor de rodas (que precisa dos mesmos
// números de scale/orientação pra mapear FL/FR/RL/RR corretamente).
export function buildChassisFromGltf(parent, gltfScene, ctx) {
  const {
    car,
    scaleFactor = 1.55,
    forwardSign = +1,
    applyClearcoat = true,
    targetLength = null,
    enhanceMaterials = true,
  } = ctx;

  // 1) Bbox antes de qualquer transform — referencial do GLB original
  const bboxRaw = new THREE.Box3().setFromObject(gltfScene);
  const sizeRaw = new THREE.Vector3();
  bboxRaw.getSize(sizeRaw);

  // 2) Calcular scale para que o eixo mais longo (idealmente Z = comprimento)
  //    bata com wheelBase * scaleFactor (~ comprimento total típico carro).
  //    Usar o eixo mais longo é robusto a GLBs exportados em qualquer eixo.
  const longest = Math.max(sizeRaw.x, sizeRaw.y, sizeRaw.z);
  const resolvedTargetLength = targetLength ?? car.cfg.wheelBase * scaleFactor;
  const scale = resolvedTargetLength / longest;
  gltfScene.scale.setScalar(scale);

  // 3) Inverter forward se modelo veio com -Z forward (Blender padrão)
  if (forwardSign < 0) gltfScene.rotateY(Math.PI);

  // 4) Recomputar bbox após scale+rot e centralizar XZ + apoiar Y na origem
  //    (Y do car.mesh = altura do CG; queremos que rodas fiquem no chão
  //    quando suspensão está em rest, então o pivot do GLB precisa estar
  //    na altura do CG = cgHeight).
  gltfScene.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(gltfScene);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  // Translate: x e z pro centro; y para que bbox.min.y caia em -cgHeight
  // (origin do car.mesh é o CG, então pneus em y=-cgHeight = chão).
  const targetMinY = -car.cfg.cgHeight - car.cfg.wheelRadius * 0.05;
  gltfScene.position.x -= center.x;
  gltfScene.position.z -= center.z;
  gltfScene.position.y += (targetMinY - bbox.min.y);

  // 5) Sombras + materiais — modo qualidade máxima
  const materialCache = new WeakMap();
  gltfScene.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (enhanceMaterials && node.material) {
      node.material = enhanceMaterial(node.material, applyClearcoat, materialCache, node.name);
    }
  });

  parent.add(gltfScene);

  return {
    gltfRoot: gltfScene,
    scale,
    bbox: new THREE.Box3().setFromObject(gltfScene),
    center: center.clone(),
  };
}

// Refina materiais PBR herdados do GLB pra ficarem com cara de carro de showroom:
// - Carroceria (color saturado, metalness > 0): adiciona clearcoat (verniz).
// - Vidro (transparente OU nome com glass/window): aumenta transmission.
// - Faróis/lanternas (nome com light/lamp/headlight/tail): emissive sutil.
//
// Se o material já é MeshPhysicalMaterial, mexe direto. Se for MeshStandardMaterial,
// adiciona props compatíveis (ambos derivam do mesmo shader).
function enhanceMaterial(mat, applyClearcoat, cache, nodeName = '') {
  if (Array.isArray(mat)) return mat.map(m => enhanceSingleMaterial(m, applyClearcoat, cache, nodeName));
  return enhanceSingleMaterial(mat, applyClearcoat, cache, nodeName);
}

function enhanceSingleMaterial(mat, applyClearcoat, cache, nodeName = '') {
  if (!mat) return mat;
  if (cache.has(mat)) return cache.get(mat);

  let m = mat;
  const name = (m.name || '').toLowerCase();
  const label = `${name} ${nodeName.toLowerCase()}`;
  const isGlass = label.includes('glass') || label.includes('window') || label.includes('windshield')
    || label.includes('sideglass') || label.includes('backlight');
  const lightRole = resolveCarLightRole(name, nodeName);
  const isLight = lightRole != null || name.includes('headlight') || name.includes('headlamp')
    || name.includes('front_light') || name.includes('taillight') || name.includes('tail_light')
    || name.includes('light_d') || name.includes('hedlight');
  const isRubber = label.includes('tire') || label.includes('tyre') || label.includes('rubber');
  const isCarbon = label.includes('carbon');
  const isMainPaint = name === 'arm4_main';
  const isMetalTrim = label.includes('chrome') || label.includes('rim') || label.includes('wheel')
    || label.includes('brake') || label.includes('disc') || label.includes('caliper')
    || label.includes('exhaust') || label.includes('metal');
  const isPaint = isMainPaint || name.includes('paint') || name.includes('body')
    || name.includes('car_body') || name.includes('exterior') || name.includes('chassis');

  prepareMaterialTextures(m);

  if (isGlass) {
    m = toPhysicalMaterial(m);
    m.transparent = true;
    m.opacity = Math.min(m.opacity ?? 0.62, 0.62);
    m.roughness = Math.min(m.roughness ?? 0.04, 0.06);
    m.metalness = Math.min(m.metalness ?? 0.0, 0.05);
    // Transmission/refraction is expensive and can hit shader edge cases on WebGL.
    // Opacity + environment reflection gives the right read for car glass here.
    m.transmission = 0;
    m.thickness = 0;
    m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, 1.65);
  } else if (applyClearcoat && isPaint && (!isMetalTrim || isMainPaint) && !isLight) {
    m = toPhysicalMaterial(m);
    m.roughness = Math.max(0.14, Math.min(m.roughness ?? 0.28, 0.32));
    m.metalness = Math.max(m.metalness ?? 0, 0.12);
    m.clearcoat = Math.max(m.clearcoat ?? 0, 0.92);
    m.clearcoatRoughness = Math.min(m.clearcoatRoughness ?? 0.08, 0.12);
    m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, 1.75);
    if ('specularIntensity' in m) m.specularIntensity = Math.max(m.specularIntensity ?? 1, 1.1);
  } else if (isCarbon) {
    m.roughness = Math.max(0.24, Math.min(m.roughness ?? 0.36, 0.5));
    m.metalness = Math.min(m.metalness ?? 0.2, 0.35);
    if (m.envMapIntensity != null) m.envMapIntensity = Math.max(m.envMapIntensity, 1.25);
  } else if (isRubber) {
    m.roughness = Math.max(m.roughness ?? 0.85, 0.9);
    m.metalness = Math.min(m.metalness ?? 0.02, 0.02);
    if (m.envMapIntensity != null) m.envMapIntensity = Math.min(m.envMapIntensity, 0.65);
  } else if (isMetalTrim) {
    m.roughness = Math.min(m.roughness ?? 0.32, 0.42);
    m.metalness = Math.max(m.metalness ?? 0.65, 0.7);
    if (m.envMapIntensity != null) m.envMapIntensity = Math.max(m.envMapIntensity, 1.35);
  }

  ensureCarLightMaterial(m, lightRole);

  if (m.envMapIntensity != null) m.envMapIntensity = Math.max(m.envMapIntensity, 1.0);
  m.needsUpdate = true;
  cache.set(mat, m);
  return m;
}

function toPhysicalMaterial(mat) {
  if (mat.isMeshPhysicalMaterial) return mat;
  const physical = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(physical, mat);
  physical.name = mat.name;
  physical.userData = { ...mat.userData };
  return physical;
}

function prepareMaterialTextures(mat) {
  const colorMaps = ['map', 'emissiveMap'];
  const linearMaps = [
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'aoMap',
    'alphaMap',
    'clearcoatMap',
    'clearcoatRoughnessMap',
    'clearcoatNormalMap',
  ];
  for (const key of colorMaps) {
    const tex = mat[key];
    if (!tex) continue;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.max(tex.anisotropy ?? 1, 16);
    tex.needsUpdate = true;
  }
  for (const key of linearMaps) {
    const tex = mat[key];
    if (!tex) continue;
    tex.anisotropy = Math.max(tex.anisotropy ?? 1, 16);
    tex.needsUpdate = true;
  }
}
