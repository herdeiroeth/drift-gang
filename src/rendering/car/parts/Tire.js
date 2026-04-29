import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';

// Pneu com tread visível.
//
// Estrutura:
//   - Cilindro principal open-ended (já criado em WheelAssembly).
//   - N tread blocks: pequenas saliências radiais distribuídas em volta da
//     circunferência. Cada uma é um BoxGeometry posicionado na face externa
//     do tire e orientado pra ficar tangente.
//
// Esta função NÃO cria o cilindro do tire em si — só os tread blocks. Recebe
// o tireMesh já existente (do WheelAssembly) e adiciona os blocks como
// filhos (pra acompanharem o spin).
export function buildTreadBlocks(tireMesh, wheel) {
  const wr = wheel.cfg.wheelRadius;
  const ww = wheel.cfg.wheelWidth;
  const v  = VISUAL_CFG.tire;

  const mat = new THREE.MeshStandardMaterial({
    color:     v.color,
    roughness: v.roughness,
    metalness: v.metalness,
  });

  const blockGeo = new THREE.BoxGeometry(ww * 0.85, 0.020, 0.060);
  const surfaceR = wr * 1.005; // 0.5% além da superfície pra evitar z-fight

  for (let i = 0; i < v.treadGrooves; i++) {
    const angle = (i / v.treadGrooves) * Math.PI * 2;
    const block = new THREE.Mesh(blockGeo, mat);
    block.position.set(0, surfaceR * Math.cos(angle), surfaceR * Math.sin(angle));
    block.rotation.x = angle;
    // castShadow off: 12 blocks × 4 rodas = 48 shadow casts extras de
    // ganho visual marginal (já há sombra do cilindro do tire).
    tireMesh.add(block);
  }
}
