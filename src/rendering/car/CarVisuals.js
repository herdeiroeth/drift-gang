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
    this.mirrors = [];
    this.mirrorCamera = null;
    this.mirrorRenderTarget = null;
    this.mirrorMaterial = null;
    this._mirrorFrame = 0;
    this._mirrorEye = new THREE.Vector3();
    this._mirrorLook = new THREE.Vector3();
    this._mirrorUp = new THREE.Vector3();
    this._mirrorQuat = new THREE.Quaternion();

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

  renderMirrorReflections(renderer, scene) {
    const cfg = VISUAL_CFG.mirrors;
    if (!cfg?.enabled || !this.mirrorRenderTarget || !this.mirrorCamera || this.mirrors.length === 0) return;

    const updateEvery = Math.max(1, cfg.updateEvery ?? 1);
    this._mirrorFrame = (this._mirrorFrame + 1) % updateEvery;
    if (this._mirrorFrame !== 0) return;

    const carMesh = this.car.mesh;
    carMesh.updateMatrixWorld(true);

    const eye = cfg.cameraEye;
    const look = cfg.cameraLook;
    this._mirrorEye.set(eye.x, eye.y, eye.z).applyMatrix4(carMesh.matrixWorld);
    this._mirrorLook.set(look.x, look.y, look.z).applyMatrix4(carMesh.matrixWorld);
    this._mirrorUp.set(0, 1, 0);
    carMesh.getWorldQuaternion(this._mirrorQuat);
    this._mirrorUp.applyQuaternion(this._mirrorQuat);

    this.mirrorCamera.position.copy(this._mirrorEye);
    this.mirrorCamera.up.copy(this._mirrorUp);
    this.mirrorCamera.lookAt(this._mirrorLook);
    this.mirrorCamera.updateMatrixWorld();

    const currentTarget = renderer.getRenderTarget();
    const currentXrEnabled = renderer.xr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const selfObjects = [carMesh, ...this.car.wheels.map((w) => w.mesh).filter(Boolean)];
    const selfVisibility = selfObjects.map((obj) => obj.visible);
    const mirrorVisibility = this.mirrors.map((mesh) => mesh.visible);

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    if (cfg.hideCarInReflection) {
      for (const obj of selfObjects) obj.visible = false;
    } else {
      for (const mirror of this.mirrors) mirror.visible = false;
    }

    renderer.setRenderTarget(this.mirrorRenderTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, this.mirrorCamera);

    renderer.setRenderTarget(currentTarget);
    renderer.xr.enabled = currentXrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
    for (let i = 0; i < selfObjects.length; i++) selfObjects[i].visible = selfVisibility[i];
    for (let i = 0; i < this.mirrors.length; i++) this.mirrors[i].visible = mirrorVisibility[i];
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

    // Sistema de luzes funcional — categoriza materiais por nome e cria
    // 2 SpotLights nos faróis. Estado controlado por `this.glb.lightsMode`:
    //   0 = off, 1 = DRL + posição, 2 = baixo + posição, 3 = alto + posição.
    // Brake intensifica sobre `position` quando car.brake>0.05.
    this._setupLights(gltfRoot);
    this._setupMirrors(gltfRoot);

    if (isDebugEnabled('parts')) {
      console.log('[CarVisuals] GLB rigging refs:', Object.fromEntries(
        Object.entries(this.glb).filter(([k, v]) => v && typeof v === 'object' && v.isObject3D)
              .map(([k, v]) => [k, v.name]),
      ));
      const counts = Object.fromEntries(
        Object.entries(this.glb.lightMats).map(([k, arr]) => [k, arr.length]),
      );
      console.log('[CarVisuals] light material counts:', counts);
      console.log(`[CarVisuals] spotlights: ${this.glb.spotLights.length}`);
      console.log(`[CarVisuals] realtime mirrors: ${this.mirrors.length}`);
    }
  }

  _setupMirrors(gltfRoot) {
    const cfg = VISUAL_CFG.mirrors;
    if (!cfg?.enabled) return;

    const width = cfg.textureWidth ?? cfg.textureSize ?? 1024;
    const height = cfg.textureHeight ?? Math.max(256, Math.round(width * 0.5));
    this.mirrorRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      samples: cfg.multisample ?? 0,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.mirrorRenderTarget.texture.name = 'bmw_m4_realtime_mirror_reflection';
    this.mirrorRenderTarget.texture.magFilter = THREE.LinearFilter;
    this.mirrorRenderTarget.texture.minFilter = THREE.LinearFilter;
    this.mirrorRenderTarget.texture.generateMipmaps = false;
    this.mirrorRenderTarget.texture.anisotropy = cfg.anisotropy ?? 1;
    this.mirrorRenderTarget.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.mirrorRenderTarget.texture.wrapT = THREE.ClampToEdgeWrapping;
    if (cfg.flipX) {
      this.mirrorRenderTarget.texture.repeat.set(-1, 1);
      this.mirrorRenderTarget.texture.offset.set(1, 0);
    }
    this.mirrorRenderTarget.texture.needsUpdate = true;

    this.mirrorCamera = new THREE.PerspectiveCamera(cfg.fov ?? 54, width / height, cfg.near ?? 0.08, cfg.far ?? 360);
    this.mirrorMaterial = new THREE.MeshBasicMaterial({
      name: 'realtime_mirror_camera_material',
      map: this.mirrorRenderTarget.texture,
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const candidates = [];
    gltfRoot.traverse((o) => {
      if (!o.isMesh || !o.material || !o.geometry) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const hasMirrorMaterial = mats.some((m) => (m?.name ?? '').toLowerCase() === 'mirror');
      if (hasMirrorMaterial) candidates.push(o);
    });

    candidates.sort((a, b) => mirrorPriority(a) - mirrorPriority(b) || a.name.localeCompare(b.name));

    const maxActive = Math.max(0, cfg.maxActive ?? candidates.length);
    for (const source of candidates.slice(0, maxActive)) {
      source.geometry = buildMirrorProjectedGeometry(source.geometry);
      source.material = replaceMirrorMaterial(source.material, this.mirrorMaterial);
      source.castShadow = false;
      source.receiveShadow = false;
      source.renderOrder = (source.renderOrder ?? 0) + 1;
      source.userData.__realtimeMirror = true;
      this.mirrors.push(source);
    }
  }

  // Categoriza materiais de luz do GLB pelo NOME DO MATERIAL (não do mesh).
  // Mapeamento — confirmado por traversal no GLB BMW M4 F82:
  //   - taillight_alt / chmsl  → brake (CHMSL central + lanterna principal traseira)
  //   - lowbeam                → farol baixo
  //   - highbeam               → farol alto
  //   - headsignal_*_alt        → position (lanterna traseira de posição —
  //                              o "_alt" indica que é o complemento traseiro
  //                              do mesmo material name "headsignal")
  //   - headsignal / runninglight → drl (sinalizador frontal sempre on)
  //
  // `Light_D`, `glass_head_tinted`, `signal_L/R` (espelho), `tailsignal_L`,
  // `hedlight_o` ficam fora — são moldura/vidro/turn-signals/refletor sem
  // controle dinâmico nesta passada.
  _setupLights(gltfRoot) {
    const cfg = VISUAL_CFG.lights;
    this.glb.lightMats = { drl: [], lowbeam: [], highbeam: [], position: [], brake: [] };
    this.glb.spotLights = [];
    this.glb.spotTargets = [];
    this.glb.lightsMode = (cfg.defaultMode ?? 1) | 0;

    const colorByCategory = {
      drl:       new THREE.Color(cfg.drl.color),
      lowbeam:   new THREE.Color(cfg.low.color),
      highbeam:  new THREE.Color(cfg.high.color),
      position:  new THREE.Color(cfg.position.color),
      brake:     new THREE.Color(cfg.position.color),
    };

    gltfRoot.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const n = (m.name ?? '').toLowerCase();
        let cat = null;
        // ORDEM IMPORTA — `taillight_alt` antes de `tail*`, e `_alt` antes
        // de `headsignal` puro.
        if (n.includes('chmsl') || n.includes('taillight_alt')) {
          cat = 'brake';
        } else if (n.includes('lowbeam')) {
          cat = 'lowbeam';
        } else if (n.includes('highbeam')) {
          cat = 'highbeam';
        } else if (n.includes('headsignal_l_alt') || n.includes('headsignal_r_alt')) {
          cat = 'position';
        } else if (n.includes('headsignal') || n.includes('runninglight')) {
          cat = 'drl';
        }
        if (!cat) continue;

        // Material já cadastrado em outro mesh (compartilhado) — pula recadastro
        // mas garante presença no array (defensivo).
        if (m.userData.__lightCategory === cat) {
          if (!this.glb.lightMats[cat].includes(m)) this.glb.lightMats[cat].push(m);
          continue;
        }

        m.userData.__lightCategory = cat;
        m.userData.__lightBase = 0;
        if (!m.emissive) m.emissive = new THREE.Color(0x000000);
        m.emissive.copy(colorByCategory[cat]);
        m.emissiveIntensity = 0;
        this.glb.lightMats[cat].push(m);
      }
    });

    // SpotLights presos ao car.mesh — cone real projetado no asfalto.
    // Posição vem dos MESHES com material `lowbeam` filtrados por Z>0
    // (descarta o lowbeam interno do trunk em Z negativo). Os nomes-pivot
    // (ARm4_headlight_L_black) ficam na origem do GLB em alguns exports —
    // o mesh real do lowbeam é a referência geométrica certa.
    const spotCfg = cfg.spot;
    const carMesh = this.car.mesh;
    carMesh.updateMatrixWorld(true);

    const headlightSources = [];
    gltfRoot.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mn = (Array.isArray(o.material) ? o.material[0]?.name : o.material.name) ?? '';
      if (!mn.toLowerCase().includes('lowbeam')) return;
      const wp = new THREE.Vector3();
      o.getWorldPosition(wp);
      const lp = wp.clone();
      carMesh.worldToLocal(lp);
      // Filtro: Z > 0.5 garante que é farol dianteiro (frente do carro),
      // não a luz do trunk (Z ≈ -2.2).
      if (lp.z > 0.5) headlightSources.push(lp);
    });
    // Sort por X pra L/R consistente (irrelevante visualmente, só garante 2).
    headlightSources.sort((a, b) => a.x - b.x);

    for (const localPos of headlightSources) {
      const spot = new THREE.SpotLight(
        cfg.low.color,
        0,                      // intensity = off por padrão
        spotCfg.distance,
        spotCfg.angle,
        spotCfg.penumbra,
        1.5,                    // decay (physically correct)
      );
      spot.position.copy(localPos);
      spot.castShadow = !!spotCfg.castShadow;
      if (spot.castShadow) {
        spot.shadow.mapSize.set(spotCfg.shadowMapSize, spotCfg.shadowMapSize);
        spot.shadow.bias = spotCfg.shadowBias;
        spot.shadow.camera.near = 0.5;
        spot.shadow.camera.far = spotCfg.distance;
      }

      // Target à frente do carro (Z+) e levemente abaixo (asfalto).
      const target = new THREE.Object3D();
      target.position.set(
        localPos.x,
        localPos.y + spotCfg.targetLowY,
        localPos.z + spotCfg.targetForwardZ,
      );
      carMesh.add(target);
      spot.target = target;

      carMesh.add(spot);
      this.glb.spotLights.push(spot);
      this.glb.spotTargets.push(target);
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

    // Sistema de luzes — atualiza emissive intensity por categoria + spotlights
    // baseado em `G.lightsMode` (0..3) e `car.brake`.
    this._updateLights(car);
  }

  // Aplica intensidade emissive por categoria de material e ajusta SpotLights.
  // Mapping mode → categorias ativas:
  //   0 (off):  só brake quando car.brake>0.05
  //   1 (DRL):  drl + position + brake (quando freando)
  //   2 (low):  drl + lowbeam + position + brake + spotlight low
  //   3 (high): drl + lowbeam + highbeam + position + brake + spotlight high
  _updateLights(car) {
    if (!this.glb?.lightMats) return;
    const cfg = VISUAL_CFG.lights;
    const mode = this.glb.lightsMode | 0;
    const brakeOn = (car.brake ?? 0) > 0.05;

    const apply = (cat, intensity) => {
      const mats = this.glb.lightMats[cat];
      for (let i = 0; i < mats.length; i++) mats[i].emissiveIntensity = intensity;
    };

    apply('drl',       mode >= 1 ? cfg.drl.intensity      : 0);
    apply('lowbeam',   mode >= 2 ? cfg.low.intensity      : 0);
    apply('highbeam',  mode === 3 ? cfg.high.intensity    : 0);
    apply('position',  mode >= 1 ? cfg.position.intensity : 0);
    // Brake = base de posição (se DRL/farol on) + boost quando freando.
    const brakeBase = mode >= 1 ? cfg.position.intensity : 0;
    apply('brake',     brakeBase + (brakeOn ? cfg.brakeBoost : 0));

    // SpotLights: intensity por modo + ajuste de target (low aponta pro chão,
    // high mais reto pra alcançar mais longe).
    const spotI = mode === 2 ? cfg.spot.intensityLow
                : mode === 3 ? cfg.spot.intensityHigh
                : 0;
    const spotColor = mode === 3 ? cfg.high.color : cfg.low.color;
    const targetY = mode === 3 ? cfg.spot.targetHighY : cfg.spot.targetLowY;
    for (let i = 0; i < this.glb.spotLights.length; i++) {
      const s = this.glb.spotLights[i];
      s.intensity = spotI;
      s.color.setHex(spotColor);
    }
    for (let i = 0; i < this.glb.spotTargets.length; i++) {
      // Y do target é relativo à posição do spot (que foi setada em setup) +
      // offset configurado. Reusa X/Z setados originalmente; só toca Y.
      const t = this.glb.spotTargets[i];
      const spot = this.glb.spotLights[i];
      t.position.y = spot.position.y + targetY;
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

function mirrorPriority(obj) {
  const name = (obj.name ?? '').toLowerCase();
  if (name.includes('arm4_mirror_l')) return 0;
  if (name.includes('arm4_mirror_r')) return 1;
  if (name.includes('arm4_interior_mirror_mirror_0')) return 2;
  if (name.includes('interior_mirror')) return 3;
  return 4;
}

function replaceMirrorMaterial(material, mirrorMaterial) {
  if (Array.isArray(material)) {
    return material.map((m) => ((m?.name ?? '').toLowerCase() === 'mirror' ? mirrorMaterial : m));
  }
  return mirrorMaterial;
}

function buildMirrorProjectedGeometry(geometry) {
  const projected = geometry.clone();
  projected.computeBoundingBox();
  const box = projected.boundingBox;
  if (!box) return projected;

  const axes = [
    { key: 'x', min: box.min.x, range: box.max.x - box.min.x },
    { key: 'y', min: box.min.y, range: box.max.y - box.min.y },
    { key: 'z', min: box.min.z, range: box.max.z - box.min.z },
  ].sort((a, b) => b.range - a.range);
  const uAxis = axes[0];
  const vAxis = axes[1];
  const uRange = Math.max(uAxis.range, 1e-6);
  const vRange = Math.max(vAxis.range, 1e-6);
  const pos = projected.attributes.position;
  const uv = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const u = (readAxis(pos, i, uAxis.key) - uAxis.min) / uRange;
    const v = (readAxis(pos, i, vAxis.key) - vAxis.min) / vRange;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  projected.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return projected;
}

function readAxis(attribute, index, key) {
  if (key === 'x') return attribute.getX(index);
  if (key === 'y') return attribute.getY(index);
  return attribute.getZ(index);
}
