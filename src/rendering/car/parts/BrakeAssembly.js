import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';

// Disco de freio + caliper para uma roda.
//
// Disco: parented a `tireMesh` — gira automaticamente com a roda (a tireMesh
//   recebe rotation.x += angularVelocity * dt em WheelAssembly.update).
// Caliper: parented a `wheel.mesh` diretamente — segue suspensão+steer mas
//   NÃO gira com a roda (na vida real o caliper é preso ao knuckle).
//
// `side` é +1 ou -1 e indica em qual lado X local da roda fica o caliper
// (face externa do veículo). Mantém o caliper sempre voltado pra fora.
export function buildBrake(wheel, tireMesh, side) {
  const wr = wheel.cfg.wheelRadius;
  const ww = wheel.cfg.wheelWidth;
  const v  = VISUAL_CFG.brake;

  const discMat = new THREE.MeshStandardMaterial({
    color:     v.discColor,
    roughness: v.discRough,
    metalness: v.discMetal,
  });
  const discGeo = new THREE.CylinderGeometry(wr * 0.55, wr * 0.55, 0.020, 28, 1);
  discGeo.rotateZ(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.x = side * ww * 0.10;
  disc.castShadow = true;
  tireMesh.add(disc);

  const caliperMat = new THREE.MeshStandardMaterial({
    color:     v.caliperColor,
    roughness: v.caliperRough,
    metalness: v.caliperMetal,
  });
  // Caliper c-shape: corpo + 2 pads dos dois lados do disco.
  const caliperGroup = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.10, 0.12),
    caliperMat,
  );
  caliperGroup.add(body);
  const padOffset = 0.018;
  const padInner = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.06, 0.08),
    caliperMat,
  );
  padInner.position.x = -padOffset;
  caliperGroup.add(padInner);
  const padOuter = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.06, 0.08),
    caliperMat,
  );
  padOuter.position.x = +padOffset;
  caliperGroup.add(padOuter);
  // Posicionar na parte superior-traseira (≈60° da vertical, na "1-2h"),
  // raio cobre o disco. X positivo na face externa.
  const angle = Math.PI / 3;
  caliperGroup.position.set(
    side * ww * 0.10,
    wr * 0.62 * Math.sin(angle),
    -wr * 0.62 * Math.cos(angle),
  );
  body.castShadow = true;
  // Parent: wheel.mesh (não gira com a roda, mas herda steer + suspension).
  wheel.mesh.add(caliperGroup);

  return { disc, caliper: caliperGroup };
}
