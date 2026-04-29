import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';
import { cylinderBetween } from './cylinderBetween.js';

// Estruturas axiais do carro:
//   - SwayBar (estática): barra horizontal entre as rodas, presa ao chassis.
//     Front + rear, ambas estáticas. Filhas de Car.mesh.
//   - HalfShaft (dinâmica): cilindro fino entre o diff (centro do eixo
//     traseiro) e o hub da roda traseira. Reorienta por frame conforme a
//     suspensão comprime. Gira com angularVelocity da roda em torno do
//     próprio eixo longitudinal.

const _diffWorld = new THREE.Vector3();
const _hubWorld  = new THREE.Vector3();
const _diffLocal = new THREE.Vector3();
const _hubLocal  = new THREE.Vector3();

export function buildSwayBar(parent, opts) {
  const { axleZ, halfWidth, attachY } = opts;
  const v = VISUAL_CFG.control;

  const mat = new THREE.MeshStandardMaterial({
    color:     v.color,
    roughness: v.roughness,
    metalness: v.metalness,
  });

  const length = halfWidth * 1.6;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, length, 10, 1), mat);
  // Cilindro default em +Y → rotacionar pra ficar lateral (+X)
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, attachY + 0.10, axleZ);
  bar.castShadow = true;
  parent.add(bar);
  return bar;
}

export class HalfShaft {
  // wheel: o objeto Wheel.js físico (lê angularVelocity, mesh.position)
  // diffLocalPos: Vector3 no frame do car.mesh, onde o shaft sai do diff
  // car: ref ao Car (precisa de car.mesh pra worldToLocal)
  constructor(parent, wheel, diffLocalPos, car) {
    this.wheel = wheel;
    this.car = car;
    this.diffLocalPos = diffLocalPos.clone();

    const v = VISUAL_CFG.axle;
    const mat = new THREE.MeshStandardMaterial({
      color:     v.color,
      roughness: v.roughness,
      metalness: v.metalness,
    });

    // Group orientado por cylinderBetween. Mesh interno gira em rotation.y
    // (eixo Y local = direção do shaft após cylinderBetween).
    this.group = new THREE.Group();
    parent.add(this.group);

    // Cilindro Y-up, altura 1.0 (escalado por cylinderBetween).
    this.spinMesh = new THREE.Mesh(new THREE.CylinderGeometry(v.radius, v.radius, 1.0, 10, 1), mat);
    this.group.add(this.spinMesh);

    // "Costela" cosmética no meio do shaft pra ver a rotação claramente.
    const ribGeo = new THREE.BoxGeometry(v.radius * 2.5, 0.02, v.radius * 2.5);
    const rib = new THREE.Mesh(ribGeo, mat);
    rib.position.y = 0;
    this.spinMesh.add(rib);
  }

  update(dt) {
    // Posição do hub em mundo (wheel.mesh é world-space):
    _hubWorld.copy(this.wheel.mesh.position);
    // Diff em mundo:
    _diffWorld.copy(this.diffLocalPos);
    this.car.mesh.localToWorld(_diffWorld);
    // Converte ambos pro frame local do parent (que é Car.mesh):
    _diffLocal.copy(_diffWorld);
    this.car.mesh.worldToLocal(_diffLocal);
    _hubLocal.copy(_hubWorld);
    this.car.mesh.worldToLocal(_hubLocal);

    cylinderBetween(this.group, _diffLocal, _hubLocal);
    // Spin em torno do próprio eixo longitudinal (Y local do group orientado).
    this.spinMesh.rotation.y += this.wheel.angularVelocity * dt;
  }
}
