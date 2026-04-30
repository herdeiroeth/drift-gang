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

      // Captura refs às peças mecânicas que JÁ EXISTEM no GLB do BMW M4 do
      // Sketchfab e cacheia transforms iniciais p/ animações absolute-set
      // (volante, ponteiros). Drivetrain visíveis: engine, transmission, diff,
      // driveshaft, halfshaft_R + interior: steer wheel, ponteiros tacho/speedo
      // + lights: head/tail (com sub-meshes lowbeam/highbeam/taillight_alt).
      this._setupGlbRigging(chassis.gltfRoot);
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
      const TAU = Math.PI * 2;
      for (let i = 0; i < this.gltfWheelHubs.length; i++) {
        const hub = this.gltfWheelHubs[i];
        const av = car.wheels[i].angularVelocity;
        // Spina cada child em X local, COM WRAP modulo 2π. Sem wrap, em
        // alta velocidade sustentada (rear ω ~200 rad/s), rotation acumula
        // milhares de radianos em segundos — precision drift do Euler→Matrix
        // do three.js produz jitter visível: rodas "saem" da carroceria
        // ou entram. Wrap mantém rotation em [-2π, 2π].
        for (const child of hub.children) {
          let r = child.rotation.x + av * dt;
          if (r > TAU || r < -TAU) r = r % TAU;
          child.rotation.x = r;
        }
      }
    }

    for (const hs of this.halfShafts) hs.update(dt);
    for (const lk of this.linkages) lk.update();

    this._updateGlbRigging();
  }

  // ---------------------------------------------------------------
  // GLB rigging — cockpit/lights ativos; drivetrain real fica congelado.
  // ---------------------------------------------------------------

  _setupGlbRigging(gltfRoot) {
    const find = (name) => gltfRoot.getObjectByName(name) ?? null;

    // Helper: snapshot da rotation inicial pra preservar tilts originais
    // (volante tem rotation.x = -1.13 do tilt do motorista; sem cache, set
    // rotation.z absoluto destruiria o tilt). E ajuda a evitar drift.
    const snapRot = (obj) => obj
      ? { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z }
      : null;
    const snapTransform = (obj) => obj
      ? {
          obj,
          position: obj.position.clone(),
          quaternion: obj.quaternion.clone(),
          scale: obj.scale.clone(),
        }
      : null;

    this.glb = {
      // Mechanical GLB parts are visible, but intentionally frozen. Several
      // of these parents have pivots at/near the car origin while their mesh
      // data sits near the rear axle, so rotating the parent makes the part
      // orbit the body instead of spinning in place.
      frozenMechanicals: [
        snapTransform(find('ARm4_driveshaft')),
        snapTransform(find('ARm4_diff')),
        snapTransform(find('ARm4_halfshaft_R')),
      ].filter(Boolean),
      // Interior
      steerWheel:    find('ARm4_steer_carbon'),
      needleTacho:   find('ARm4_needle_tacho'),
      needleSpeedo:  find('ARm4_needle_speedo'),
      // Bases salvas (preservam tilts/rotations originais do GLB)
      _baseRotSteerWheel: null,
      _baseRotTacho:      null,
      _baseRotSpeedo:     null,
    };

    // NOTA: o `ARm4_engine` empty tem scale 100×100×100 — qualquer pos delta
    // vira ×100 em world; e o pivot do empty está fora do bloco do motor.
    // Animar idle vibration / rocking nele faz o motor ORBITAR ao redor da
    // origem do parent (visual: "motor anda em volta do carro"). Removido.
    // (Motor é visível só com cofre aberto, então sem perda real.)

    this.glb._baseRotSteerWheel = snapRot(this.glb.steerWheel);
    this.glb._baseRotTacho      = snapRot(this.glb.needleTacho);
    this.glb._baseRotSpeedo     = snapRot(this.glb.needleSpeedo);
    this._restoreFrozenGlbMechanicals();

    // Brake/headlight materials — cache valores ORIGINAIS de emissive e
    // intensity. O setup anterior sobrescrevia, apagando a luz constante
    // (DRL/lente vermelha de brake estável) — em update vamos só MODULAR
    // sobre o original, nunca sobrescrever.
    this.glb.brakeLightMats = [];
    this.glb.headlightMats = [];
    gltfRoot.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const n = m.name ?? '';
        if (n.includes('taillight_alt') || n.includes('chmsl')) {
          // Pula materiais já cadastrados (mesh pode estar duplicada na cena)
          if (m.userData.__brakeBase != null) {
            this.glb.brakeLightMats.push(m);
            continue;
          }
          m.userData.__brakeBase = m.emissiveIntensity ?? 0;
          m.userData.__brakeColor = m.emissive ? m.emissive.clone() : null;
          this.glb.brakeLightMats.push(m);
        }
        if (n.includes('lowbeam') || n.includes('highbeam') || n.includes('runninglight')) {
          if (m.userData.__hlBase != null) {
            this.glb.headlightMats.push(m);
            continue;
          }
          m.userData.__hlBase = m.emissiveIntensity ?? 0;
          m.userData.__hlColor = m.emissive ? m.emissive.clone() : null;
          this.glb.headlightMats.push(m);
        }
      }
    });

    if (isDebugEnabled('parts')) {
      console.log('[CarVisuals] GLB rigging refs:', Object.fromEntries(
        Object.entries(this.glb).filter(([k, v]) => v && typeof v === 'object' && v.isObject3D)
              .map(([k, v]) => [k, v.name]),
      ));
      console.log(`[CarVisuals] brake mats: ${this.glb.brakeLightMats.length}, headlight mats: ${this.glb.headlightMats.length}`);
    }
  }

  _updateGlbRigging() {
    if (!this.glb) return;
    const car = this.car;
    const pt = car.powertrain;
    if (!pt) return;
    const eng = pt.engine;
    const G = this.glb;

    // Real GLB drivetrain parts stay visible but frozen. Their exported pivots
    // do not match their visual centers, so parent rotation creates the
    // reported orbiting/flying parts on acceleration.
    this._restoreFrozenGlbMechanicals();

    // Steering wheel: preserva tilt original (rotation.x=-1.13). Aplica
    // rotação ao redor de Z LOCAL (eixo do volante).
    if (G.steerWheel && G._baseRotSteerWheel) {
      const lockToLockRad = 2.5 * Math.PI;
      G.steerWheel.rotation.x = G._baseRotSteerWheel.x;
      G.steerWheel.rotation.y = G._baseRotSteerWheel.y;
      G.steerWheel.rotation.z = G._baseRotSteerWheel.z + (-car.steer * lockToLockRad);
    }

    // Tachometer needle: 0..maxRPM → 0..-252°. Preserva rot.x/y/z base.
    if (G.needleTacho && G._baseRotTacho) {
      const rpmNorm = Math.max(0, Math.min(1.0, eng.rpm / (eng.maxRPM || 7500)));
      G.needleTacho.rotation.x = G._baseRotTacho.x;
      G.needleTacho.rotation.y = G._baseRotTacho.y;
      G.needleTacho.rotation.z = G._baseRotTacho.z + (-rpmNorm * 4.4);
    }

    if (G.needleSpeedo && G._baseRotSpeedo) {
      const kmh = Math.abs(car.absVel) * 3.6;
      const norm = Math.min(1.0, kmh / 280);
      G.needleSpeedo.rotation.x = G._baseRotSpeedo.x;
      G.needleSpeedo.rotation.y = G._baseRotSpeedo.y;
      G.needleSpeedo.rotation.z = G._baseRotSpeedo.z + (-norm * 4.4);
    }

    // Brake lights: modula sobre o emissive ORIGINAL. brake=on → +1.5 sobre
    // a base; brake=off → mantém base (preservando DRL constante).
    const brake = (car.brake ?? 0);
    const brakeBoost = brake > 0.05 ? 1.5 : 0.0;
    for (const m of G.brakeLightMats) {
      if (m.emissiveIntensity == null) continue;
      const base = m.userData.__brakeBase ?? 0;
      m.emissiveIntensity = base + brakeBoost;
    }
  }

  _restoreFrozenGlbMechanicals() {
    if (!this.glb?.frozenMechanicals) return;
    for (const base of this.glb.frozenMechanicals) {
      base.obj.position.copy(base.position);
      base.obj.quaternion.copy(base.quaternion);
      base.obj.scale.copy(base.scale);
    }
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
