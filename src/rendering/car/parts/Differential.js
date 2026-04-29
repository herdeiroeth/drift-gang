import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';

// "Pumpkin" do diferencial traseiro (RWD). Estático no Car.mesh, posicionado
// entre as rodas traseiras na altura do eixo.
//
// Visual: SphereGeometry achatada (diff housing) + flange cilíndrico atrás
// (cobertura traseira). Cores fundido escuro metálico.
export function buildDifferential(parent, opts) {
  const { rearAxleZ, attachY } = opts;
  const v = VISUAL_CFG.diff;

  const mat = new THREE.MeshStandardMaterial({
    color:     v.color,
    roughness: v.roughness,
    metalness: v.metalness,
  });

  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), mat);
  housing.scale.set(1.0, 0.85, 1.1);
  housing.castShadow = true;

  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.06, 16), mat);
  flange.rotation.x = Math.PI / 2;
  flange.position.z = -0.18;
  flange.castShadow = true;

  const group = new THREE.Group();
  group.add(housing, flange);
  group.position.set(0, attachY + 0.05, rearAxleZ);
  parent.add(group);

  return group;
}
