import * as THREE from 'three';
import { VISUAL_CFG } from './CarVisualConfig.js';

// Constrói os meshes do chassis (body + cabin + spoiler + faróis/lanternas)
// e adiciona como filhos do `parent` (geralmente Car.mesh).
//
// Igual ao buildVisuals() original — só extraído pra módulo separado pra
// permitir crescimento sem inflar Car.js.
export function buildChassis(parent) {
  const v = VISUAL_CFG;

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: v.body.color,
    roughness: v.body.roughness,
    metalness: v.body.metalness,
    clearcoat: v.body.clearcoat,
    clearcoatRoughness: v.body.clearcoatRoughness,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.48, 3.3), bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  body.receiveShadow = true;
  parent.add(body);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: v.glass.color,
    roughness: v.glass.roughness,
    metalness: v.glass.metalness,
    transmission: v.glass.transmission,
    transparent: true,
    thickness: v.glass.thickness,
  });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.36, 1.5), glassMat);
  cabin.position.set(0, 0.82, -0.2);
  cabin.castShadow = true;
  parent.add(cabin);

  const spoiler = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.07, 0.5),
    new THREE.MeshStandardMaterial({
      color: v.spoiler.color,
      roughness: v.spoiler.roughness,
      metalness: v.spoiler.metalness,
    }),
  );
  spoiler.position.set(0, 0.76, -1.45);
  spoiler.castShadow = true;
  parent.add(spoiler);

  const lightMat = new THREE.MeshStandardMaterial({
    color: v.headlight.color,
    emissive: v.headlight.emissive,
    emissiveIntensity: v.headlight.intensity,
  });
  const flLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.08), lightMat);
  flLight.position.set(-0.55, 0.42, 1.62);
  parent.add(flLight);
  const frLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.08), lightMat);
  frLight.position.set(0.55, 0.42, 1.62);
  parent.add(frLight);

  const tailMat = new THREE.MeshStandardMaterial({
    color: v.taillight.color,
    emissive: v.taillight.emissive,
    emissiveIntensity: v.taillight.intensity,
  });
  const tlLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.06), tailMat);
  tlLight.position.set(-0.55, 0.48, -1.62);
  parent.add(tlLight);
  const trLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.06), tailMat);
  trLight.position.set(0.55, 0.48, -1.62);
  parent.add(trLight);
}
