import * as THREE from 'three';
import { buildChassis } from './Chassis.js';
import { buildChassisFromGltf } from './ChassisGltf.js';
import { WheelAssembly } from './WheelAssembly.js';
import { buildDifferential } from './parts/Differential.js';
import { buildSwayBar, HalfShaft } from './parts/Axle.js';
import { SuspensionLinkage } from './parts/SuspensionLinkage.js';
import { extractAndReparentWheels, measureWheelLayoutFromGltf } from './loaders/extractWheels.js';
import { inspectGltf, isDebugEnabled } from './loaders/inspectGltf.js';
import { VISUAL_CFG } from './CarVisualConfig.js';

// Orquestrador visual do carro.
//
// Modos:
//   - GLB body (default quando opts.gltfScene fornecido E VISUAL_CFG.gltfBody.enabled)
//       buildChassisFromGltf + extractAndReparentWheels (rodas do GLB nos wheel.mesh).
//       Mantém o restante do asset GLB visível; suspensão/drivetrain procedural
//       só entram se VISUAL_CFG.gltfBody.showProceduralUndercarriage=true.
//   - Procedural fallback (sem GLB)
//       buildChassis (BoxGeometry) + WheelAssembly procedural — visual original.
//
// Hierarquia em ambos os modos:
//   car.mesh
//     ├── chassis (procedural OU GLB)
//     ├── drivetrain (procedural apenas em fallback/debug)
//   wheel.mesh × 4
//     └── wheelHub (GLB) OU WheelAssembly (procedural)
export class CarVisuals {
  constructor(scene, car, opts = {}) {
    this.scene = scene;
    this.car   = car;

    const cfg = VISUAL_CFG.gltfBody;
    const useGltf = !!(cfg.enabled && opts.gltfScene);
    this.mode = useGltf ? 'gltf' : 'procedural';
    this.gltfWheelHubs = null;
    this.wheelAssemblies = null;
    this.halfShafts = [];
    this.linkages = [];

    if (useGltf) {
      const gltfScene = opts.gltfScene;

      if (isDebugEnabled('gltf')) inspectGltf(gltfScene, 'BMW M4 F82');

      const chassis = buildChassisFromGltf(car.mesh, gltfScene, {
        car,
        scaleFactor:    cfg.scaleFactor,
        forwardSign:    cfg.forwardSign,
        applyClearcoat: cfg.applyClearcoat,
        targetLength:   opts.gltfTargetLength,
      });

      if (cfg.alignWheelWellsToPhysics) {
        alignWheelWellsToPhysics(chassis.gltfRoot, car);
      }

      let extraction = { ok: false };
      if (cfg.useGltfWheels) {
        extraction = extractAndReparentWheels(chassis.gltfRoot, car.wheels);
      }

      if (extraction.ok) {
        this.gltfWheelHubs = extraction.wheelGroups;
        this.wheelAssemblies = null;
      } else {
        // Fallback: rodas procedurais. Mantém WheelAssembly como antes.
        console.info('[CarVisuals] Using procedural wheels (GLB extraction failed or disabled).');
        this.wheelAssemblies = car.wheels.map((w) => new WheelAssembly(w));
      }
    } else {
      // Procedural body
      buildChassis(car.mesh);
      this.wheelAssemblies = car.wheels.map((w) => new WheelAssembly(w));
    }

    const useProceduralUndercarriage = !useGltf || cfg.showProceduralUndercarriage;
    if (!useProceduralUndercarriage) return;

    // Drivetrain/suspensão procedural — fallback ou debug visual.
    const c = car.cfg;
    const rearAxleZ  = -c.cgToRearAxle;
    const frontAxleZ =  c.cgToFrontAxle;
    const attachY    =  0.12;

    buildDifferential(car.mesh, { rearAxleZ, attachY });
    buildSwayBar(car.mesh, { axleZ: frontAxleZ, halfWidth: c.halfWidth, attachY });
    buildSwayBar(car.mesh, { axleZ: rearAxleZ,  halfWidth: c.halfWidth, attachY });

    const diffOut = new THREE.Vector3(0, attachY + 0.05, rearAxleZ);
    this.halfShafts = [
      new HalfShaft(car.mesh, car.wheels[2], diffOut, car), // RL
      new HalfShaft(car.mesh, car.wheels[3], diffOut, car), // RR
    ];

    this.linkages = [
      new SuspensionLinkage(car.mesh, car.wheels[0], -1, frontAxleZ, true,  c.halfWidth, attachY, car), // FL
      new SuspensionLinkage(car.mesh, car.wheels[1], +1, frontAxleZ, true,  c.halfWidth, attachY, car), // FR
      new SuspensionLinkage(car.mesh, car.wheels[2], -1, rearAxleZ,  false, c.halfWidth, attachY, car), // RL
      new SuspensionLinkage(car.mesh, car.wheels[3], +1, rearAxleZ,  false, c.halfWidth, attachY, car), // RR
    ];
  }

  update(dt) {
    const car = this.car;

    // Pose das rodas: posição já é setada por Wheel.js (hit-point);
    // aqui setamos rotação composta com pitch + heading + steer + roll.
    for (const w of car.wheels) {
      w.mesh.rotation.set(car.pitch, car.heading + w.steerAngle, -car.roll, 'YXZ');
    }

    // Spin: WheelAssembly faz `tireMesh.rotation.x += av*dt` no modo procedural.
    // No modo GLB hub, fazemos a mesma rotação no nó da roda original (children[0]
    // do hub) — o hub pode ter rotação Z/Y de correção de eixo, então spina
    // dentro do hub.
    if (this.wheelAssemblies) {
      for (const wa of this.wheelAssemblies) wa.update(dt);
    }
    if (this.gltfWheelHubs) {
      for (let i = 0; i < this.gltfWheelHubs.length; i++) {
        const hub = this.gltfWheelHubs[i];
        const av = car.wheels[i].angularVelocity;
        // Hub agrupa múltiplos componentes (pneu+aro, hub interno, disco+caliper).
        // Spinar todos via rotação X local de cada child — o spin axis local
        // já foi alinhado a X pela correção do hub em extractWheels.
        // Trade-off: caliper também spina junto (visualmente errado em close-up,
        // mas imperceptível em câmeras chase/orbital).
        for (const child of hub.children) child.rotation.x += av * dt;
      }
    }

    for (const hs of this.halfShafts) hs.update(dt);
    for (const lk of this.linkages) lk.update();
  }
}

function alignWheelWellsToPhysics(gltfRoot, car) {
  const layout = measureWheelLayoutFromGltf(gltfRoot);
  if (!layout) return;

  const physicalMidZ = (car.cfg.cgToFrontAxle - car.cfg.cgToRearAxle) * 0.5;
  const dz = physicalMidZ - layout.axleMidZ;
  if (Math.abs(dz) < 1e-4) return;

  gltfRoot.position.z += dz;
  gltfRoot.updateMatrixWorld(true);
}
