import * as THREE from 'three';
import { buildChassis } from './Chassis.js';
import { buildChassisFromGltf } from './ChassisGltf.js';
import { WheelAssembly } from './WheelAssembly.js';
import { buildDifferential } from './parts/Differential.js';
import { buildSwayBar, HalfShaft } from './parts/Axle.js';
import { SuspensionLinkage } from './parts/SuspensionLinkage.js';
import { extractAndReparentWheels, measureWheelLayoutFromGltf } from './loaders/extractWheels.js';
import { inspectGltf, isDebugEnabled } from './loaders/inspectGltf.js';
import {
  ensureCarLightMaterial,
  getCarLightBaseIntensity,
  resolveCarLightRole,
} from './loaders/lightMaterials.js';
import { VISUAL_CFG } from './CarVisualConfig.js';

const LIGHT_MODE_ORDER = ['drl', 'low', 'high', 'off'];
const LIGHT_MODE_LABELS = {
  drl:  'DRL',
  low:  'LOW',
  high: 'HIGH',
  off:  'OFF',
};

const LIGHT_MODE_MULTIPLIERS = {
  off: {
    runningLight: 0,
    lowBeam: 0,
    highBeam: 0,
    frontSignal: 0,
    sideSignal: 0,
    tailLight: 0,
    rearSignal: 0,
    reverseLight: 0,
    brakeLight: 0,
  },
  drl: {
    runningLight: 1.0,
    lowBeam: 0,
    highBeam: 0,
    frontSignal: 0,
    sideSignal: 0,
    tailLight: 0,
    rearSignal: 0,
    reverseLight: 0,
    brakeLight: 0,
  },
  low: {
    runningLight: 0.82,
    lowBeam: 1.0,
    highBeam: 0,
    frontSignal: 0,
    sideSignal: 0,
    tailLight: 0.72,
    rearSignal: 0,
    reverseLight: 0,
    brakeLight: 0,
  },
  high: {
    runningLight: 0.72,
    lowBeam: 0.75,
    highBeam: 1.35,
    frontSignal: 0,
    sideSignal: 0,
    tailLight: 0.78,
    rearSignal: 0,
    reverseLight: 0,
    brakeLight: 0,
  },
};

const LIGHT_SHOW_STEP_SECONDS = 0.155;
const LIGHT_SHOW_PATTERN = [
  { runningLight: { left: 1.8 } },
  { runningLight: { right: 1.8 } },
  { lowBeam: { left: 1.45 } },
  { lowBeam: { right: 1.45 } },
  { highBeam: { left: 1.25 } },
  { highBeam: { right: 1.25 } },
  { frontSignal: { left: 2.6 }, rearSignal: { left: 2.8 } },
  { frontSignal: { right: 2.6 }, rearSignal: { right: 2.8 } },
  { tailLight: { center: 1.75 } },
  { tailLight: { left: 2.1 } },
  { tailLight: { right: 2.1 } },
  { rearSignal: { center: 2.3 }, reverseLight: { center: 1.55 } },
  { brakeLight: { center: 1.9 }, tailLight: { center: 1.0, left: 0.8, right: 0.8 } },
  { reverseLight: { center: 1.7 }, highBeam: { left: 0.75, right: 0.75 } },
  {
    runningLight: { left: 1.25, right: 1.25 },
    lowBeam:      { left: 0.75, right: 0.75 },
    tailLight:    { center: 1.2, left: 1.2, right: 1.2 },
  },
  { frontSignal: { left: 3.0, right: 3.0 }, rearSignal: { left: 3.2, right: 3.2, center: 2.5 } },
  {},
];

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
    this.lightMode = 'drl';
    this.lightShowActive = false;
    this.lightShowTime = 0;
    this.lightShowStepIndex = -1;

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
    if (this.lightShowActive) this.lightShowTime += dt;

    // Pose das rodas: posição já é setada por Wheel.js (hit-point);
    // aqui setamos rotação composta com pitch + heading + steer + roll.
    for (const w of car.wheels) {
      w.mesh.rotation.set(car.pitch, car.heading + w.steerAngle, -car.roll, 'YXZ');
    }

    // Spin: WheelAssembly faz `tireMesh.rotation.x += av*dt` no modo procedural.
    // No modo GLB hub, spinamos APENAS o sub-grupo `spinHub` — o `staticHub`
    // contém calipers/pads que devem ficar presos ao knuckle (não giram).
    if (this.wheelAssemblies) {
      for (const wa of this.wheelAssemblies) wa.update(dt);
    }
    if (this.gltfWheelHubs) {
      const TAU = Math.PI * 2;
      for (let i = 0; i < this.gltfWheelHubs.length; i++) {
        const hub = this.gltfWheelHubs[i];
        const spinHub = hub.userData.spinHub;
        if (!spinHub) continue;
        const av = car.wheels[i].angularVelocity;
        // Spina o sub-grupo spinHub em X local, COM WRAP modulo 2π. Sem wrap,
        // em alta velocidade sustentada (rear ω ~200 rad/s), rotation acumula
        // milhares de radianos em segundos — precision drift do Euler→Matrix
        // do three.js produz jitter visível.
        let r = spinHub.rotation.x + av * dt;
        if (r > TAU || r < -TAU) r = r % TAU;
        spinHub.rotation.x = r;
      }
    }

    for (const hs of this.halfShafts) hs.update(dt);
    for (const lk of this.linkages) lk.update();

    this._updateGlbRigging();
  }

  cycleLightMode() {
    if (this.lightShowActive) this.setLightShow(false, { apply: false, silent: true });
    const idx = LIGHT_MODE_ORDER.indexOf(this.lightMode);
    const next = LIGHT_MODE_ORDER[(idx + 1 + LIGHT_MODE_ORDER.length) % LIGHT_MODE_ORDER.length];
    this.setLightMode(next);
    return this.lightMode;
  }

  setLightMode(mode) {
    if (!LIGHT_MODE_MULTIPLIERS[mode]) return this.lightMode;
    if (this.lightShowActive) this.setLightShow(false, { apply: false, silent: true });
    this.lightMode = mode;
    this.car.lightMode = mode;
    this._applyGlbLightMode();
    if (isDebugEnabled('parts')) {
      console.log(`[CarVisuals] light mode -> ${this.getLightModeLabel()}`);
    }
    return this.lightMode;
  }

  toggleLightShow() {
    return this.setLightShow(!this.lightShowActive);
  }

  setLightShow(active, opts = {}) {
    const enabled = !!active;
    const changed = this.lightShowActive !== enabled;
    this.lightShowActive = enabled;
    this.car.lightShowActive = enabled;
    if (enabled && changed) {
      this.lightShowTime = 0;
      this.lightShowStepIndex = -1;
    }
    if (opts.apply !== false) this._applyGlbLightMode();
    if (!opts.silent && isDebugEnabled('parts')) {
      console.log(`[CarVisuals] light show -> ${enabled ? 'ON' : 'OFF'}`);
    }
    return this.lightShowActive;
  }

  getLightModeLabel() {
    if (this.lightShowActive) return 'LIGHT SHOW';
    return LIGHT_MODE_LABELS[this.lightMode] ?? this.lightMode.toUpperCase();
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

    // Brake/headlight materials — o GLB tem materiais dedicados (lowbeam,
    // runninglight, taillight_alt, chmsl etc). Primeiro garantimos emissive
    // visivel nesses nomes e depois cacheamos a intensidade base para modular
    // freio sem apagar DRL/lanternas constantes.
    this.glb.brakeLightMats = [];
    this.glb.headlightMats = [];
    this.glb.lightMats = [];
    this.glb.runtimeLights = null;
    this.car.mesh.updateMatrixWorld(true);
    gltfRoot.updateMatrixWorld(true);
    gltfRoot.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let clonedAny = false;
      const nextMats = mats.map((m) => {
        const role = resolveCarLightRole(m.name, o.name);
        if (!role) return m;

        const lightMaterial = m.clone();
        lightMaterial.name = m.name;
        lightMaterial.userData = { ...(m.userData ?? {}) };
        ensureCarLightMaterial(lightMaterial, role);

        const localCenter = getObjectCenterInParent(o, this.car.mesh);
        const side = getLightSide(o.name, localCenter?.x ?? 0);
        const baseIntensity = Math.max(lightMaterial.emissiveIntensity ?? 0, getCarLightBaseIntensity(role));
        lightMaterial.userData.__lightRole = role;
        lightMaterial.userData.__lightBaseIntensity = baseIntensity;
        lightMaterial.userData.__lightSide = side;
        lightMaterial.userData.__lightColor = lightMaterial.emissive ? lightMaterial.emissive.clone() : null;
        this.glb.lightMats.push({ material: lightMaterial, role, baseIntensity, side, meshName: o.name });
        if (role === 'tailLight' || role === 'brakeLight') this.glb.brakeLightMats.push(lightMaterial);
        if (role === 'lowBeam' || role === 'highBeam' || role === 'runningLight' || role === 'frontSignal') {
          this.glb.headlightMats.push(lightMaterial);
        }
        clonedAny = true;
        return lightMaterial;
      });
      if (clonedAny) o.material = Array.isArray(o.material) ? nextMats : nextMats[0];
    });
    this._setupRuntimeLightEmitters(gltfRoot);
    this._applyGlbLightMode();

    if (isDebugEnabled('parts')) {
      console.log('[CarVisuals] GLB rigging refs:', Object.fromEntries(
        Object.entries(this.glb).filter(([k, v]) => v && typeof v === 'object' && v.isObject3D)
              .map(([k, v]) => [k, v.name]),
      ));
      console.log(`[CarVisuals] brake mats: ${this.glb.brakeLightMats.length}, headlight mats: ${this.glb.headlightMats.length}`);
      console.log(`[CarVisuals] light mode: ${this.getLightModeLabel()}, light mats: ${this.glb.lightMats.length}`);
      console.log(`[CarVisuals] light roles: ${summarizeLightRoles(this.glb.lightMats)}`);
    }
  }

  _setupRuntimeLightEmitters(gltfRoot) {
    const carRoot = this.car.mesh;
    carRoot.updateMatrixWorld(true);
    gltfRoot.updateMatrixWorld(true);

    const fallbackFront = [
      new THREE.Vector3(-0.56, 0.38, this.car.cfg.cgToFrontAxle + 0.72),
      new THREE.Vector3( 0.56, 0.38, this.car.cfg.cgToFrontAxle + 0.72),
    ];
    const fallbackRear = [
      new THREE.Vector3(-0.62, 0.42, -this.car.cfg.cgToRearAxle - 0.62),
      new THREE.Vector3( 0.62, 0.42, -this.car.cfg.cgToRearAxle - 0.62),
    ];

    const frontNodes = [
      gltfRoot.getObjectByName('ARm4_headlight_L_black'),
      gltfRoot.getObjectByName('ARm4_headlight_R_black'),
    ];
    const rearNodes = [
      gltfRoot.getObjectByName('ARm4_taillight_L_snake.001'),
      gltfRoot.getObjectByName('ARm4_taillight_R_snake.001'),
    ];

    const frontCenters = frontNodes.map((node, i) => getObjectCenterInParent(node, carRoot) ?? fallbackFront[i]);
    const rearCenters = rearNodes.map((node, i) => getObjectCenterInParent(node, carRoot) ?? fallbackRear[i]);

    const lowSpots = [];
    const highSpots = [];
    const frontSignalPoints = [];
    for (let i = 0; i < frontCenters.length; i++) {
      const center = frontCenters[i];
      const side = getLightSide(frontNodes[i]?.name, center.x);
      const low = new THREE.SpotLight(0xfff1d2, 0, 32, 0.33, 0.62, 1.2);
      const high = new THREE.SpotLight(0xfff7e8, 0, 54, 0.23, 0.48, 1.0);
      const signal = new THREE.PointLight(0xffa23a, 0, 3.2, 1.8);
      const lowTarget = new THREE.Object3D();
      const highTarget = new THREE.Object3D();

      low.position.copy(center);
      high.position.copy(center).add(new THREE.Vector3(0, 0.02, 0.03));
      signal.position.copy(center).add(new THREE.Vector3(0, 0.02, 0));
      lowTarget.position.copy(center).add(new THREE.Vector3(0, -0.28, 10));
      highTarget.position.copy(center).add(new THREE.Vector3(0, -0.08, 18));
      low.target = lowTarget;
      high.target = highTarget;
      low.userData.lightSide = side;
      high.userData.lightSide = side;
      signal.userData.lightSide = side;

      low.castShadow = false;
      high.castShadow = false;
      carRoot.add(low, lowTarget, high, highTarget, signal);
      lowSpots.push(low);
      highSpots.push(high);
      frontSignalPoints.push(signal);
    }

    const tailPoints = [];
    const brakePoints = [];
    const rearSignalPoints = [];
    for (let i = 0; i < rearCenters.length; i++) {
      const center = rearCenters[i];
      const side = getLightSide(rearNodes[i]?.name, center.x);
      const tail = new THREE.PointLight(0xff1818, 0, 5.5, 1.9);
      const brake = new THREE.PointLight(0xff1414, 0, 7.0, 1.7);
      const signal = new THREE.PointLight(0xff4a24, 0, 4.4, 1.8);
      tail.position.copy(center).add(new THREE.Vector3(0, 0, -0.08));
      brake.position.copy(center).add(new THREE.Vector3(0, 0.02, -0.12));
      signal.position.copy(center).add(new THREE.Vector3(0, 0.01, -0.1));
      tail.userData.lightSide = side;
      brake.userData.lightSide = side;
      signal.userData.lightSide = side;
      carRoot.add(tail, brake, signal);
      tailPoints.push(tail);
      brakePoints.push(brake);
      rearSignalPoints.push(signal);
    }

    this.glb.runtimeLights = { lowSpots, highSpots, frontSignalPoints, tailPoints, brakePoints, rearSignalPoints };
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

    // Steering wheel: preserva tilt original (rotation.x ≈ -1.13 do GLB BMW
    // M4 — coluna inclinada para o motorista). O modelo neutro é um disco
    // horizontal (normal +Y), então o EIXO DA COLUNA, após o tilt em X, é
    // o Y LOCAL do volante. Em Euler XYZ, set rotation.y mantendo X = base
    // produz a matriz R_x · R_y, equivalente a rotacionar ao redor do Y já
    // tilted no mundo (= eixo da coluna). Usar rotation.z aqui (como antes)
    // pitchava o volante pra frente em vez de girar como direção.
    //
    // Sinal: nessa convenção, `car.steer > 0` faz as rodas dianteiras virar
    // para +X (direita do carro). Para o volante seguir junto (topo do
    // volante indo para o mesmo lado da frente das rodas), aplicamos
    // `+car.steer * lockToLockRad` — sem o sinal de menos.
    if (G.steerWheel && G._baseRotSteerWheel) {
      const lockToLockRad = 2.5 * Math.PI;
      G.steerWheel.rotation.x = G._baseRotSteerWheel.x;
      G.steerWheel.rotation.z = G._baseRotSteerWheel.z;
      G.steerWheel.rotation.y = G._baseRotSteerWheel.y + (car.steer * lockToLockRad);
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

    this._applyGlbLightMode();
  }

  _applyGlbLightMode() {
    if (!this.glb?.lightMats) return;

    const car = this.car;
    const showActive = this.lightShowActive;
    const showStep = showActive ? this._getLightShowStep() : null;
    const mode = LIGHT_MODE_MULTIPLIERS[this.lightMode] ? this.lightMode : 'drl';
    const levels = LIGHT_MODE_MULTIPLIERS[mode];
    const brake = (car.brake ?? 0) > 0.05;
    const reverse = car.powertrain?.gearbox?.currentGear === 1;

    for (const entry of this.glb.lightMats) {
      const { material: m, role, baseIntensity, side } = entry;
      if (!m) continue;

      const level = showActive ? getLightShowLevel(showStep, role, side) : (levels[role] ?? 0);
      const effectiveBase = role === 'brakeLight' ? Math.max(baseIntensity, 2.2) : baseIntensity;
      let intensity = effectiveBase * level;
      if (!showActive) {
        if (role === 'tailLight' && brake) intensity += Math.max(1.45, baseIntensity * 1.55);
        if (role === 'brakeLight' && brake) intensity += Math.max(2.2, baseIntensity * 2.5);
        if (role === 'reverseLight' && reverse) intensity = Math.max(intensity, baseIntensity);
      }

      m.emissiveIntensity = intensity;
      m.needsUpdate = true;
    }

    const emitters = this.glb.runtimeLights;
    if (!emitters) return;

    const levelFor = (role, side = 'center') => (
      showActive ? getLightShowLevel(showStep, role, side) : (levels[role] ?? 0)
    );
    for (const light of emitters.lowSpots) {
      light.intensity = levelFor('lowBeam', light.userData.lightSide) * 10.0;
    }
    for (const light of emitters.highSpots) {
      light.intensity = levelFor('highBeam', light.userData.lightSide) * 16.0;
    }
    for (const light of emitters.frontSignalPoints) {
      light.intensity = levelFor('frontSignal', light.userData.lightSide) * 3.6;
    }
    for (const light of emitters.tailPoints) {
      light.intensity = levelFor('tailLight', light.userData.lightSide) * 4.0 + (!showActive && brake ? 4.5 : 0);
    }
    for (const light of emitters.brakePoints) {
      light.intensity = showActive
        ? levelFor('brakeLight', light.userData.lightSide) * 8.5
        : (brake ? 8.5 : 0);
    }
    for (const light of emitters.rearSignalPoints) {
      light.intensity = levelFor('rearSignal', light.userData.lightSide) * 5.2;
    }
  }

  _getLightShowStep() {
    const index = Math.floor(this.lightShowTime / LIGHT_SHOW_STEP_SECONDS) % LIGHT_SHOW_PATTERN.length;
    if (index !== this.lightShowStepIndex) this.lightShowStepIndex = index;
    return LIGHT_SHOW_PATTERN[index];
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

function getObjectCenterInParent(obj, parent) {
  if (!obj) return null;
  const box = new THREE.Box3().setFromObject(obj);
  if (!Number.isFinite(box.min.x) || box.isEmpty()) return null;
  const center = new THREE.Vector3();
  box.getCenter(center);
  return parent.worldToLocal(center);
}

function getLightSide(name = '', fallbackX = 0) {
  const text = name.toLowerCase();
  const anchored = text.match(/(?:headlight|taillight|mirror|trunklight|door|fender|mudflaps)[_.-]([lr])(?:[_.-]|$)/);
  if (anchored?.[1] === 'l') return 'left';
  if (anchored?.[1] === 'r') return 'right';
  if (text.includes('trunklight_')) return 'center';
  if (fallbackX < -0.01) return 'left';
  if (fallbackX > 0.01) return 'right';
  if (/(^|[_ .-])l([_ .-]|$)/.test(text) || text.includes('left')) return 'left';
  if (/(^|[_ .-])r([_ .-]|$)/.test(text) || text.includes('right')) return 'right';
  return 'center';
}

function getLightShowLevel(step, role, side = 'center') {
  const roleLevels = step?.[role];
  if (!roleLevels) return 0;
  if (typeof roleLevels === 'number') return roleLevels;
  return roleLevels[side] ?? roleLevels.all ?? 0;
}

function summarizeLightRoles(lightMats) {
  const counts = new Map();
  for (const { role, side } of lightMats) {
    const key = `${role}:${side}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
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
