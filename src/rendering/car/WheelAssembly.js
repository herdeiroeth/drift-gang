import * as THREE from 'three';
import { VISUAL_CFG } from './CarVisualConfig.js';
import { buildBrake } from './parts/BrakeAssembly.js';
import { buildRim } from './parts/Rim.js';
import { buildTreadBlocks } from './parts/Tire.js';
import { wrapAngle } from './WheelMotionBlur.js';

// Container visual de uma roda. Adicionado como filho de wheel.mesh — herda
// pose de suspensão+steer de graça (a física já set rotation com pitch+heading
// +steer e position com hit-point Y).
//
// Composição:
//   - tireMesh (gira com angularVelocity)
//     - rimMesh (filho, herda rotação)
//     - brake disc (filho, herda rotação)
//   - brake caliper (filho de wheel.mesh, esterça mas não gira)
//
// `side`: +1 / -1, X local em que ficam peças assimétricas (caliper).
export class WheelAssembly {
  constructor(wheel) {
    this.wheel = wheel;
    this.side  = Math.sign(wheel.offsetLocal.x) || 1;

    const wr = wheel.cfg.wheelRadius;
    const ww = wheel.cfg.wheelWidth;
    const v  = VISUAL_CFG;

    // openEnded: true — sem caps. Caps fechariam a face externa do pneu
    // e esconderiam rim + brake disc. side: THREE.DoubleSide pra visualizar
    // de fora E de dentro (do contrário o interior some quando câmera
    // entra dentro da silhueta).
    const tireGeo = new THREE.CylinderGeometry(wr, wr, ww, 24, 1, true);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({
      color:     v.tire.color,
      roughness: v.tire.roughness,
      metalness: v.tire.metalness,
      side:      THREE.DoubleSide,
    });
    this.tireMesh = new THREE.Mesh(tireGeo, tireMat);
    this.tireMesh.castShadow = true;
    wheel.mesh.add(this.tireMesh);

    buildTreadBlocks(this.tireMesh, wheel);

    this.rimMesh = buildRim(wheel);
    this.tireMesh.add(this.rimMesh);

    const brake = buildBrake(wheel, this.tireMesh, this.side);
    this.brakeDisc    = brake.disc;
    this.brakeCaliper = brake.caliper;
  }

  // Chamado por CarVisuals.update(dt). Apenas atualiza a rotação local de spin
  // do tire (que arrasta junto rim, brake disc no commit 3). A pose global da
  // roda (suspensão + steer + roll) é setada por CarVisuals via wheel.mesh.
  update(dt) {
    this.tireMesh.rotation.x = wrapAngle(this.tireMesh.rotation.x + this.wheel.angularVelocity * dt);
  }
}
