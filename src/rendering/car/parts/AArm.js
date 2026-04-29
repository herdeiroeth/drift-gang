import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';
import { cylinderBetween } from './cylinderBetween.js';

// A-arm (control arm) com 2 cilindros dinâmicos formando um V entre 2
// pickups no chassis e 1 pickup no knuckle. Reorienta por frame conforme
// a roda sobe/desce/esterça.
//
// Pickups do chassis (cpA, cpB): Vector3 fixos no frame de Car.mesh (parent).
// Knuckle pickup é lido por frame via getKnuckleWorld() — função que retorna
// um Vector3 em coordenadas de mundo. Convertido pra local de Car.mesh em update().
const _kWorld = new THREE.Vector3();
const _kLocal = new THREE.Vector3();

export class AArm {
  constructor(parent, chassisPickupA, chassisPickupB, getKnuckleWorld, car, opts = {}) {
    this.car = car;
    this.cpA = chassisPickupA.clone();
    this.cpB = chassisPickupB.clone();
    this.getKnuckleWorld = getKnuckleWorld;

    const v = VISUAL_CFG.control;
    const mat = new THREE.MeshStandardMaterial({
      color:     v.color,
      roughness: v.roughness,
      metalness: v.metalness,
    });

    const geo = new THREE.CylinderGeometry(v.radius, v.radius, 1.0, 8, 1);

    this.armA = new THREE.Group();
    this.armA.add(new THREE.Mesh(geo, mat));
    parent.add(this.armA);

    this.armB = new THREE.Group();
    this.armB.add(new THREE.Mesh(geo, mat));
    parent.add(this.armB);

    if (opts.castShadow) {
      this.armA.children[0].castShadow = true;
      this.armB.children[0].castShadow = true;
    }
  }

  update() {
    this.getKnuckleWorld(_kWorld);
    _kLocal.copy(_kWorld);
    this.car.mesh.worldToLocal(_kLocal);
    cylinderBetween(this.armA, this.cpA, _kLocal);
    cylinderBetween(this.armB, this.cpB, _kLocal);
  }
}
