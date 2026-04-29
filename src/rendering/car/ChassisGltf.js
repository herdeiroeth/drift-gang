import * as THREE from 'three';

// Substitui o `buildChassis()` procedural quando há um modelo glTF carregado.
// Recebe o `gltfScene` (já clonado pelo CarModelLoader), calcula scale +
// orientação + offset Y para que o carro caiba no CarConfig atual sem
// alterar nenhum parâmetro físico.
//
// Retorna metadata útil pro extractor de rodas (que precisa dos mesmos
// números de scale/orientação pra mapear FL/FR/RL/RR corretamente).
export function buildChassisFromGltf(parent, gltfScene, ctx) {
  const { car, scaleFactor = 1.55, forwardSign = +1, applyClearcoat = true } = ctx;

  // 1) Bbox antes de qualquer transform — referencial do GLB original
  const bboxRaw = new THREE.Box3().setFromObject(gltfScene);
  const sizeRaw = new THREE.Vector3();
  bboxRaw.getSize(sizeRaw);

  // 2) Calcular scale para que o eixo mais longo (idealmente Z = comprimento)
  //    bata com wheelBase * scaleFactor (~ comprimento total típico carro).
  //    Usar o eixo mais longo é robusto a GLBs exportados em qualquer eixo.
  const longest = Math.max(sizeRaw.x, sizeRaw.y, sizeRaw.z);
  const targetLength = car.cfg.wheelBase * scaleFactor;
  const scale = targetLength / longest;
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
  gltfScene.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (node.material) enhanceMaterial(node.material, applyClearcoat);
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
function enhanceMaterial(mat, applyClearcoat) {
  // Materiais podem ser arrays
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    const name = (m.name || '').toLowerCase();

    // Vidro
    if (name.includes('glass') || name.includes('window') || name.includes('windshield')) {
      m.transparent = true;
      m.opacity = m.opacity ?? 0.5;
      if ('transmission' in m) m.transmission = 0.6;
      if ('thickness'    in m) m.thickness    = 0.05;
      m.roughness = Math.min(m.roughness ?? 0.1, 0.1);
      continue;
    }

    // Faróis / lanternas
    if (name.includes('headlight') || name.includes('headlamp') || name.includes('front_light')) {
      m.emissive = new THREE.Color(0xfff4d6);
      m.emissiveIntensity = 0.6;
      continue;
    }
    if (name.includes('tail') && (name.includes('light') || name.includes('lamp'))) {
      m.emissive = new THREE.Color(0xff1818);
      m.emissiveIntensity = 0.5;
      continue;
    }

    // Pintura da carroceria — heurística: metalness > 0.3 e não é vidro/luz
    if (applyClearcoat && (m.metalness ?? 0) > 0.3 && 'clearcoat' in m) {
      m.clearcoat = Math.max(m.clearcoat ?? 0, 1.0);
      m.clearcoatRoughness = m.clearcoatRoughness ?? 0.15;
    }

    // Aprimoramento geral: garantir que envMaps reflitam (Three.js puxa do
    // scene.environment automaticamente quando MeshStandardMaterial)
    if (m.envMapIntensity != null) m.envMapIntensity = Math.max(m.envMapIntensity, 1.0);
  }
}
