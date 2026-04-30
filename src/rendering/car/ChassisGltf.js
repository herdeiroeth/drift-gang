import * as THREE from 'three';
import { RENDER_CFG } from '../../core/constants.js';

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
      node.material = enhanceMaterial(
        node.material,
        applyClearcoat,
        materialCache,
        getMaterialContextName(node),
      );
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
function getMaterialContextName(node) {
  return [
    node.name,
    node.geometry?.name,
    node.parent?.name,
  ].filter(Boolean).join(' ');
}

function enhanceMaterial(mat, applyClearcoat, cache, contextName = '') {
  if (Array.isArray(mat)) {
    return mat.map(m => enhanceSingleMaterial(m, applyClearcoat, cache, contextName));
  }
  return enhanceSingleMaterial(mat, applyClearcoat, cache, contextName);
}

function enhanceSingleMaterial(mat, applyClearcoat, cache, contextName = '') {
  if (!mat) return mat;

  let m = mat;
  const name = (m.name || '').toLowerCase();
  const context = contextName.toLowerCase();
  const isExteriorPaint = isAutomotivePaint(name, context);
  const cacheKey = isExteriorPaint ? 'paint' : 'default';
  let perMaterial = cache.get(mat);
  if (perMaterial?.has(cacheKey)) return perMaterial.get(cacheKey);
  if (!perMaterial) {
    perMaterial = new Map();
    cache.set(mat, perMaterial);
  }

  const isGlass = name.includes('glass') || name.includes('window') || name.includes('windshield');
  const isLight = name.includes('headlight') || name.includes('headlamp')
    || name.includes('front_light') || name.includes('taillight') || name.includes('tail_light')
    || name.includes('headsignal') || name.includes('lowbeam') || name.includes('highbeam')
    || name.includes('runninglight') || name.includes('chmsl');
  const isRubber = name.includes('tire') || name.includes('tyre') || name.includes('rubber');
  const isMetalTrim = name.includes('chrome') || name.includes('rim') || name.includes('wheel')
    || name.includes('brake') || name.includes('disc') || name.includes('caliper');
  const isPaint = name.includes('paint') || name.includes('body') || name.includes('car_body')
    || name.includes('exterior') || name.includes('chassis') || isExteriorPaint;

  prepareMaterialTextures(m);

  if (isGlass) {
    m = toPhysicalMaterial(m);
    m.transparent = true;
    m.opacity = Math.min(m.opacity ?? 0.62, 0.62);
    m.roughness = Math.min(m.roughness ?? 0.08, 0.08);
    m.metalness = Math.min(m.metalness ?? 0.0, 0.05);
    // Transmission/refraction is expensive and can hit shader edge cases on WebGL.
    // Opacity + environment reflection gives the right read for car glass here.
    m.transmission = 0;
    m.thickness = 0;
    m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, 1.25);
  } else if (applyClearcoat && isPaint && !isMetalTrim && !isLight) {
    // `ARm4_main` é compartilhado por carroceria, interior e enginebay. Clone
    // apenas a variante externa para o verniz não contaminar outras peças.
    m = toPhysicalMaterial(m, { clone: isExteriorPaint });
    m.roughness = 0.22;
    m.metalness = Math.max(m.metalness ?? 0, 0.28);
    m.clearcoat = 1.0;
    m.clearcoatRoughness = 0.035;
    m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, RENDER_CFG.envMapIntensityPaint);
  } else if (isRubber) {
    m.roughness = Math.max(m.roughness ?? 0.85, 0.9);
    m.metalness = Math.min(m.metalness ?? 0.02, 0.02);
    if (m.envMapIntensity != null) m.envMapIntensity = Math.min(m.envMapIntensity, 0.65);
  } else if (isMetalTrim) {
    m.roughness = Math.min(m.roughness ?? 0.28, 0.32);
    m.metalness = Math.max(m.metalness ?? 0.85, 0.85);
    if (m.envMapIntensity != null) m.envMapIntensity = Math.max(m.envMapIntensity, 1.4);
  }

  // Emissive de faróis/lanternas é controlado em runtime por CarVisuals
  // (`_setupLights` + `_updateLights`). Aqui só garantimos que materiais de
  // luz comecem zerados pra não residual brilhar quando o sistema setar mode=0.
  if (isLight) {
    m.emissiveIntensity = 0;
  }

  if (m.envMapIntensity != null) m.envMapIntensity = Math.max(m.envMapIntensity, 1.0);
  perMaterial.set(cacheKey, m);
  return m;
}

function isAutomotivePaint(materialName, contextName) {
  if (materialName !== 'arm4_main') return false;
  if (/(interior|enginebay|engine|underbody|headlight|taillight|trunklight|glass|wheel|brake|diffuser|grille|mirror|badge|logo)/.test(contextName)) {
    return false;
  }
  return /(body|door_[lr]|fender_[lr]|dender_trim|hood|bumper_[fr]|trunk|skirt)/.test(contextName);
}

function toPhysicalMaterial(mat, { clone = false } = {}) {
  if (mat.isMeshPhysicalMaterial) {
    if (!clone) return mat;
    const physical = mat.clone();
    physical.name = mat.name;
    physical.userData = { ...mat.userData };
    return physical;
  }
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
  // Cap 16 — três.js/GPU clampam silenciosamente ao maxAnisotropy suportado
  // (que na maioria das GPUs modernas é 16). Sem cap, texturas oblíquas
  // (capô em perspectiva, asfalto em distância) ficam moiré/borradas.
  const aniso = RENDER_CFG.textureAnisotropy;
  for (const key of colorMaps) {
    const tex = mat[key];
    if (!tex) continue;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.max(tex.anisotropy ?? 1, aniso);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
  }
  for (const key of linearMaps) {
    const tex = mat[key];
    if (!tex) continue;
    tex.anisotropy = Math.max(tex.anisotropy ?? 1, aniso);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
  }
}
