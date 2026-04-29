import * as THREE from 'three';
import { AArm } from './AArm.js';
import { Coilover } from './Coilover.js';
import { TieRod } from './TieRod.js';

// Composição da suspensão por roda. Front: upper A-arm + lower A-arm +
// coilover + tie rod. Rear: idem mas sem tie rod.
//
// Pickups chassis ficam fixos no Car.mesh (frame local). Pickups knuckle
// são lidos por frame em mundo (via wheel.mesh.position + offset, ou
// wheel.mesh.localToWorld pra pontos fixos no referencial da roda — esse
// último é como o tie rod consegue esterçar com a roda).

const _knuckleTmp = new THREE.Vector3();
const _localOffset = new THREE.Vector3();

export class SuspensionLinkage {
  constructor(parent, wheel, side, axleZ, isFront, halfWidth, attachY, car) {
    this.wheel = wheel;
    this.parts = [];

    const sx = side; // -1 ou +1; lado do veículo

    // ----- A-arm INFERIOR -----
    // Pickups chassis: 2 pontos próximos ao chassis perto do axle.
    const lowerA = new THREE.Vector3(sx * (halfWidth - 0.05), attachY + 0.05, axleZ - 0.20);
    const lowerB = new THREE.Vector3(sx * (halfWidth - 0.05), attachY + 0.05, axleZ + 0.20);
    const lowerKnuckle = (out) => {
      out.copy(wheel.mesh.position);
      out.y -= 0.05;
      return out;
    };
    this.parts.push(new AArm(parent, lowerA, lowerB, lowerKnuckle, car, { castShadow: true }));

    // ----- A-arm SUPERIOR -----
    const upperA = new THREE.Vector3(sx * (halfWidth - 0.10), attachY + 0.30, axleZ - 0.18);
    const upperB = new THREE.Vector3(sx * (halfWidth - 0.10), attachY + 0.30, axleZ + 0.18);
    const upperKnuckle = (out) => {
      out.copy(wheel.mesh.position);
      out.y += 0.10;
      return out;
    };
    this.parts.push(new AArm(parent, upperA, upperB, upperKnuckle, car, { castShadow: false }));

    // ----- COILOVER -----
    // Top mount: chassis em altura média, levemente recuado pro centro.
    const coiloverTop = new THREE.Vector3(sx * (halfWidth - 0.15), 0.50, axleZ);
    // Bottom mount: na própria knuckle (acima do hub).
    const coiloverBottom = (out) => {
      out.copy(wheel.mesh.position);
      out.y += 0.05;
      return out;
    };
    this.parts.push(new Coilover(parent, coiloverTop, coiloverBottom, car));

    // ----- TIE ROD (front only) -----
    if (isFront) {
      // Rack pickup: perto do centro, na mesma altura do A-arm inferior.
      const rack = new THREE.Vector3(sx * 0.18, attachY + 0.05, axleZ - 0.10);
      // Steering arm pickup: ponto FIXO no referencial da wheel.mesh
      // (atrás do hub, lado interno). Quando wheel.mesh.rotation muda
      // (steer), esse ponto rotaciona junto — naturalmente puxa o tie rod.
      _localOffset.set(-sx * wheel.cfg.wheelRadius * 0.5, 0, -wheel.cfg.wheelRadius * 0.4);
      const steeringArm = (out) => {
        out.copy(_localOffset);
        wheel.mesh.localToWorld(out);
        return out;
      };
      this.parts.push(new TieRod(parent, rack, steeringArm, car));
    }
  }

  update() {
    for (const p of this.parts) p.update();
  }
}
