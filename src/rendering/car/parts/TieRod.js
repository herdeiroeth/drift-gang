import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';
import { cylinderBetween } from './cylinderBetween.js';

// Tie rod: cilindro fino conectando steering rack (chassis) ao steering arm
// (knuckle). Quando a roda esterça, o ponto local na wheel.mesh rotaciona
// junto, fazendo o tie rod naturalmente "puxar" o knuckle. Esse é o
// componente que torna o steering visualmente realista.

const _kWorld = new THREE.Vector3();
const _kLocal = new THREE.Vector3();

export class TieRod {
  constructor(parent, rackPickup, getKnuckleWorld, car) {
    this.car = car;
    this.rackPickup = rackPickup.clone();
    this.getKnuckleWorld = getKnuckleWorld;

    const v = VISUAL_CFG.control;
    const mat = new THREE.MeshStandardMaterial({
      color:     v.color,
      roughness: v.roughness,
      metalness: v.metalness,
    });

    this.group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.015, 0.015, 1.0, 8, 1);
    this.group.add(new THREE.Mesh(geo, mat));
    parent.add(this.group);
  }

  update() {
    this.getKnuckleWorld(_kWorld);
    _kLocal.copy(_kWorld);
    this.car.mesh.worldToLocal(_kLocal);
    cylinderBetween(this.group, this.rackPickup, _kLocal);
  }
}
