import * as THREE from 'three';

// Helper: orienta um Object3D (Group ou Mesh com cilindro Y-up de altura 1)
// entre 2 pontos, no mesmo frame de referência do parent do object.
//
// Convenção da geometry: CylinderGeometry default vai de Y=-0.5 a Y=+0.5
// (eixo de altura = Y local). Após esta função, o eixo +Y local aponta de
// pointA para pointB.
//
// Reusa Vector3 modular-level para zero alocação por frame.
const _tmpDir = new THREE.Vector3();
const _tmpMid = new THREE.Vector3();
const _yAxis  = new THREE.Vector3(0, 1, 0);

export function cylinderBetween(object3d, pointA, pointB) {
  _tmpDir.subVectors(pointB, pointA);
  const dist = _tmpDir.length();
  if (dist < 1e-4) return; // pontos coincidentes — pular update
  _tmpDir.divideScalar(dist);
  object3d.quaternion.setFromUnitVectors(_yAxis, _tmpDir);
  _tmpMid.addVectors(pointA, pointB).multiplyScalar(0.5);
  object3d.position.copy(_tmpMid);
  object3d.scale.set(1, dist, 1);
}
