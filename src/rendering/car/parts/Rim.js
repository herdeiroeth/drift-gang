import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';

// Rim com spokes (estética JDM tipo TE37/RPF1).
//
// Estrutura:
//   - hub central (cilindro pequeno)
//   - barrel externo (cilindro grosso colado ao pneu interior)
//   - N spokes (cilindros radiais conectando hub ao barrel)
//
// Os vãos entre os spokes deixam o brake disc + caliper visíveis (Commit 3).
//
// Eixo da roda alinhado com X local (mesma convenção do tireMesh, que sofreu
// rotateZ(π/2) na geometry). Por isso barrel e hub também são rotateZ(π/2);
// e os spokes ficam no plano YZ, com posições/orientações em torno de X.
export function buildRim(wheel) {
  const wr = wheel.cfg.wheelRadius;
  const ww = wheel.cfg.wheelWidth;
  const v  = VISUAL_CFG.rim;

  const mat = new THREE.MeshStandardMaterial({
    color:     v.color,
    roughness: v.roughness,
    metalness: v.metalness,
  });

  const group = new THREE.Group();

  // Barrel externo: encosta no pneu interior, deixa centro vazado.
  const barrelInner = wr * 0.62;
  const barrelOuter = wr * 0.66;
  const barrelGeo = new THREE.CylinderGeometry(barrelOuter, barrelOuter, ww * 0.94, v.latheSegs, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, mat);
  barrel.castShadow = true;
  group.add(barrel);

  // Hub central: cilindro pequeno no centro.
  const hubRadius = wr * 0.18;
  const hubGeo = new THREE.CylinderGeometry(hubRadius, hubRadius, ww * 0.50, 16, 1);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, mat);
  hub.castShadow = true;
  group.add(hub);

  // Spokes radiais: do hub ao barrel, distribuídos uniformemente em torno
  // do eixo X local (12h, 12h+72°, +144°, ...).
  const spokeLen = barrelInner - hubRadius;
  const spokeMid = (hubRadius + barrelInner) * 0.5;
  const spokeGeo = new THREE.CylinderGeometry(0.022, 0.026, spokeLen, 8, 1);
  for (let i = 0; i < v.spokes; i++) {
    const angle = (i / v.spokes) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, mat);
    spoke.position.set(0, spokeMid * Math.cos(angle), spokeMid * Math.sin(angle));
    spoke.rotation.x = angle;
    spoke.castShadow = true;
    group.add(spoke);
  }

  return group;
}
