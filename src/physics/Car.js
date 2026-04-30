import * as THREE from 'three';
import { CarConfig } from './CarConfig.js';
import { Wheel } from './Wheel.js';
import { PowertrainSystem } from '../powertrain.js';
import { GAME_CFG, PHYSICS_CFG, SURFACE_MU } from '../core/constants.js';
import { CarVisuals } from '../rendering/car/CarVisuals.js';
import { pneumaticTrail, gripFactor, effectiveD } from './Tire.js';
import { VISUAL_CFG } from '../rendering/car/CarVisualConfig.js';
import { buildChassisFromGltf } from '../rendering/car/ChassisGltf.js';
import { measureWheelLayoutFromGltf } from '../rendering/car/loaders/extractWheels.js';

export class Car {
  constructor(scene, groundObjects, opts = {}) {
    this.scene = scene;
    this.opts = opts;
    this.groundObjects = groundObjects;
    this.mesh = new THREE.Group();
    scene.add(this.mesh);

    this.config = new CarConfig();
    this.cfg = this.config;
    this.gltfTargetLength = this.cfg.wheelBase * VISUAL_CFG.gltfBody.scaleFactor;
    this.gltfWheelLayout = this._measureGltfWheelLayout(this.opts.gltfScene);
    this._applyGltfWheelLayout(this.gltfWheelLayout);

    this.position = new THREE.Vector3(0, 1.0, 0);
    this.velocity = new THREE.Vector3();
    this.velocityLocal = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.accelLocal = new THREE.Vector3();
    this.heading = 0;
    this.yawRate = 0;
    this.absVel = 0;

    this.pitch = 0;
    this.roll = 0;
    this.pitchVel = 0;
    this.rollVel = 0;

    // heading=0 → forward aponta +Z (Three.js padrão)
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);

    this.steer = 0;
    this.steerAngle = 0;

    this.gear = 2;
    this.rpm = this.cfg.idleRPM;
    this.nitroT = 0;
    this.nitroCd = 0;

    // Clutch analógico (hold-time → pedal progressivo).
    // 1s segurando Ctrl → pedal 1.0; soltar recupera a 3x velocidade (~0.33s).
    this.clutchHold = 0;

    const c = this.cfg;
    this.powertrain = new PowertrainSystem({
      engine: {
        idleRPM: c.idleRPM,
        redlineRPM: c.maxRPM,
        maxRPM: c.maxRPM + 300,
        // Inércia 0.20 — virabrequim equilibrado (sobe rápido o suficiente pra
        // sentir o turbo, mas não decola sem load). Antes 0.22 era pesado.
        inertia: 0.20,
        // Fricção interna reduzida: motor turbo bem balanceado tem perdas
        // menores que o que tinhamos antes (22+0.014w+2e-5w² roubava ~50Nm
        // em alto RPM, comendo toda a potência de topo).
        frictionPassive: 14.0,
        frictionLinear: 0.010,
        frictionQuadratic: 1.4e-5,
        // Freio motor: 180 Nm @ redline. Aplicado só em throttle<5%.
        coastTorque: 180.0,
        revLimitMode: 'hard',
        canStall: false,
      },
      clutch: {
        // Clutch de drift bombadex (org.: organic + cerâmico): 1100 Nm de
        // capacidade. Antes 600 Nm capava o pico de boost (raw 540 × turbo
        // 1.8 = 972 Nm), abafando o motor em arrancada e burnout.
        maxTorqueTransfer: 1100,
      },
      gearbox: {
        gearRatios: c.gearRatios,
        shiftTime: 0.3,
        autoShift: true,
      },
      shifting: {
        cooldownH:           PHYSICS_CFG.shiftCooldownH,
        cooldownSeq:         PHYSICS_CFG.shiftCooldownSeq,
        overrevMarginRPM:    PHYSICS_CFG.shiftOverrevMarginRPM,
        minRPMAfterUpshift:  PHYSICS_CFG.shiftMinRPMAfterUpshift,
        minPostUpshiftRPM:   PHYSICS_CFG.shiftMinPostUpshiftRPM,
      },
      differential: {
        type: 'welded',           // default modo Forza arcade-friendly
        finalDrive: c.diffRatio,
        // Diff efficiency = 0.95 (rolamentos + diff oil). Use o default da
        // classe Differential — antes estava recebendo transEfficiency (0.82)
        // por engano, dobrando a perda mecânica entre engine e roda.
        // efficiency: 0.95  (default)
        preload: 80,
        powerLock: 0.5,
        coastLock: 0.3,
      },
      tractionControl: {
        mode: 'off',
        gain: 6.0,
      },
      launchControl: {
        enabled: true,
        launchRPM: 4500,
      },
      turbo: {
        // 0.8 bar peak (~+80% torque). Spool 3.5 (era 2.0) — turbo responde
        // mais rápido, drift power chega antes em saída de curva.
        maxBoost: 0.8,
        spoolRate: 3.5,
      },
      finalDrive: c.diffRatio,
      transEfficiency: c.transEfficiency,
    });

    const hw = c.halfWidth;
    const frontHw = hw + (this.opts.gltfScene ? (VISUAL_CFG.gltfBody.frontWheelOutboardOffset ?? 0) : 0);
    const rearHw = hw + (this.opts.gltfScene ? (VISUAL_CFG.gltfBody.rearWheelOutboardOffset ?? 0) : 0);
    const fAxle = c.cgToFrontAxle;
    const rAxle = -c.cgToRearAxle;
    const attachY = 0.12;
    this.suspAttachY = attachY;

    this.wheels = [
      new Wheel(scene, new THREE.Vector3(-frontHw, attachY, fAxle), true, c),
      new Wheel(scene, new THREE.Vector3( frontHw, attachY, fAxle), true, c),
      new Wheel(scene, new THREE.Vector3(-rearHw, attachY, rAxle), false, c),
      new Wheel(scene, new THREE.Vector3( rearHw, attachY, rAxle), false, c),
    ];

    this.initialY = this.computeStaticRideHeight();
    this.position.y = this.initialY;
    this._syncMeshPose();
    for (const w of this.wheels) {
      w.resetSuspension(this.position, this.heading, this.pitch, this.roll, this.groundObjects);
    }

    this.visuals = new CarVisuals(scene, this, {
      ...this.opts,
      gltfTargetLength: this.gltfTargetLength,
    });
  }

  wheelWorld(i) { return this.wheels[i].getWorldPosition(); }

  _syncMeshPose() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(this.pitch, this.heading, -this.roll, 'YXZ');
  }

  _syncWheelVisualPoses() {
    for (const w of this.wheels) {
      w.syncVisualPose(this.position, this.heading, this.pitch, this.roll);
    }
  }

  _measureGltfWheelLayout(gltfScene) {
    const cfg = VISUAL_CFG.gltfBody;
    if (!cfg.enabled || !cfg.useGltfWheels || !cfg.syncWheelGeometryFromGltf || !gltfScene) {
      return null;
    }

    const measureScene = gltfScene.clone(true);
    const measureRoot = new THREE.Group();
    buildChassisFromGltf(measureRoot, measureScene, {
      car: this,
      scaleFactor: cfg.scaleFactor,
      forwardSign: cfg.forwardSign,
      applyClearcoat: false,
      targetLength: this.gltfTargetLength,
      enhanceMaterials: false,
    });
    return measureWheelLayoutFromGltf(measureScene);
  }

  _applyGltfWheelLayout(layout) {
    if (!layout) return;

    const c = this.cfg;
    if (Number.isFinite(layout.halfWidth) && layout.halfWidth > 0.2) {
      c.halfWidth = layout.halfWidth;
    }
    if (Number.isFinite(layout.wheelRadius) && layout.wheelRadius > 0.15) {
      c.wheelRadius = layout.wheelRadius;
    }
    if (Number.isFinite(layout.wheelWidth) && layout.wheelWidth > 0.08) {
      c.wheelWidth = layout.wheelWidth;
    }
    c.syncDerivedGeometry();
  }

  computeStaticRideHeight() {
    const c = this.cfg;
    const frontK = c.springRateFront ?? c.springRate;
    const rearK = c.springRateRear ?? c.springRate;
    const frontComp = (c.sprungMass * c.gravity * c.axleWeightRatioFront * 0.5) / Math.max(1, frontK);
    const rearComp = (c.sprungMass * c.gravity * c.axleWeightRatioRear * 0.5) / Math.max(1, rearK);
    const staticCompression = (frontComp + rearComp) * 0.5;
    const tireDeflection = ((c.mass * c.gravity) / 4) / Math.max(1, c.tireVerticalRate);
    return c.suspRestLength - staticCompression + c.wheelRadius - tireDeflection - this.suspAttachY;
  }

  // spawn opcional: { x, z, heading } — usado pra spawnar em start/finish de
  // uma pista. Y vem sempre de this.initialY (calculado pela suspensão estática).
  // Sem spawn → comportamento legado (origem, heading=0).
  reset(spawn = null) {
    const x = spawn?.x ?? 0;
    const z = spawn?.z ?? 0;
    const heading = spawn?.heading ?? 0;
    this.initialY = this.computeStaticRideHeight();
    this.position.set(x, this.initialY, z);
    this.velocity.set(0, 0, 0);
    this.velocityLocal.set(0, 0, 0);
    this.accel.set(0, 0, 0);
    this.accelLocal.set(0, 0, 0);
    this.heading = heading;
    this.yawRate = 0;
    this.absVel = 0;
    this.steer = 0;
    this.steerAngle = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.nitroT = 0;
    this.rpm = this.cfg.idleRPM;
    this.gear = 2;
    this.clutchHold = 0;
    if (this.powertrain) this.powertrain.reset();
    for (const w of this.wheels) {
      w.angularVelocity = 0;
      w.driveTorque = 0;
      w.brakeTorque = 0;
      w.steerAngle = 0;
      w.tireTemp = 25;  // ambient
      w.resetSuspension(this.position, this.heading, this.pitch, this.roll, this.groundObjects);
    }
    this._syncMeshPose();
    this._syncWheelVisualPoses();
  }

  applySmoothSteer(steerInput, dt) {
    const STEER_SPEED = PHYSICS_CFG.steerInputAccel;
    const RETURN_SPEED = PHYSICS_CFG.steerCenterReturn;
    if (Math.abs(steerInput) > 0.001) {
      const t = 1.0 - Math.exp(-STEER_SPEED * dt);
      return Math.max(-1.0, Math.min(1.0, this.steer + (steerInput - this.steer) * t));
    }
    const t = 1.0 - Math.exp(-RETURN_SPEED * dt);
    return this.steer * (1.0 - t);
  }

  applySafeSteer(steerInput) {
    const c = this.cfg;
    const refSpeed = c.steerSpeedReductionRef ?? 55.0;
    const maxRed   = c.steerSpeedReduction    ?? 0.20;
    if (maxRed <= 0) return steerInput;
    const speedRatio = Math.min(1.0, this.absVel / refSpeed);
    const reduction = maxRed * speedRatio * speedRatio;
    return steerInput * (1.0 - reduction);
  }

  /**
   * SAT físico do kingpin (substitui o hack antigo `applySelfAligningTorque`).
   *
   *   M_kingpin = Fy_front · (mech_trail + pneum_trail(α))
   *
   * - mech_trail = R_wheel · sin(caster_angle)  — fixo, vem do cfg.
   * - pneum_trail(α) decai de t0 a zero entre 0 e α_peak (~6°).
   *   Pós-peak: zero — efeito visível como "volante fica leve" antes
   *   do front quebrar grip.
   *
   * Aplicado em duas vias (HÍBRIDO):
   *   (a) input-side: corrige `this.steer` (countersteer "vivo" em pad/teclado)
   *   (b) chassis-side: contribui ~5-10% ao yawTorque do passo
   *
   * Retorna a contribuição chassis-side (em N·m) para o caller acumular
   * no yawTorque total daquele sub-step.
   *
   * @param {number} sdt sub-step dt
   * @returns {number} M_kingpin · M_kingpinChassisGain — N·m a somar no yaw
   */
  applyKingpinSAT(sdt) {
    const c = this.cfg;
    const fl = this.wheels[0];
    const fr = this.wheels[1];
    if (!fl || !fr) return 0;
    if (!fl.isGrounded && !fr.isGrounded) return 0;

    const Fy_front = fl.lateralForce + fr.lateralForce;
    const alphaAvg = (fl.slipAngle + fr.slipAngle) * 0.5;
    const tPneum = pneumaticTrail(alphaAvg, { alphaPeak: c.alphaPeak, pneumTrail0: c.pneumTrail0 });
    const tMech = c.mechTrail;   // = R · sin(caster), pré-computado em CarConfig

    const M_kingpin = Fy_front * (tMech + tPneum);

    // (a) input-side correction
    const correction = M_kingpin * c.steerSatGain * sdt;
    this.steer = Math.max(-1.0, Math.min(1.0, this.steer + correction));

    // (b) chassis-side: retornado para o caller somar ao yawTorque
    return M_kingpin * c.M_kingpinChassisGain;
  }

  ackermann(steerInner) {
    const c = this.cfg;
    const L = c.wheelBase;
    const T = c.trackWidth;
    if (Math.abs(steerInner) < 0.001) return 0;
    const cotInner = 1.0 / Math.tan(Math.abs(steerInner));
    const cotOuter = cotInner + T / L;
    const outer = Math.atan(1.0 / cotOuter);
    return Math.sign(steerInner) * outer;
  }

  applySuspensionLoadTransfer() {
    const c = this.cfg;
    const fl = this.wheels[0], fr = this.wheels[1], rl = this.wheels[2], rr = this.wheels[3];

    const frontArb = c.antiRollFront * (fl.compression - fr.compression) * 0.5;
    const rearArb  = c.antiRollRear  * (rl.compression - rr.compression) * 0.5;

    const ax = this.accelLocal.x || 0;
    const ay = this.accelLocal.z || 0;
    const longTransferRaw = c.mass * ax * c.cgHeight / c.wheelBase * c.longitudinalLoadTransferScale;

    // Anti-dive (front, em freada ax<0) e anti-squat (rear, em aceleração ax>0)
    // são percentages [0..1] que reduzem a parcela do load transfer LONGITUDINAL
    // que vai pela mola — o resto é absorvido pela GEOMETRIA da suspensão
    // (instant centers, control arm angles). Quanto mais antiDive, menos o
    // nariz mergulha em freada brusca; quanto mais antiSquat, menos a traseira
    // afunda em aceleração WOT.
    //   ax < 0 (freando)     → front comprime, rear descomprime → antiDive_front afeta front
    //   ax > 0 (acelerando)  → rear comprime, front descomprime → antiSquat_rear afeta rear
    const antiDiveFront = c.antiDiveFront ?? 0.30;
    const antiSquatRear = c.antiSquatRear ?? 0.25;
    // Aplica conforme direção do load transfer:
    //   - braking (ax<0): a roda que recebe carga é a FRONT → antiDive
    //   - accel (ax>0):   a roda que recebe carga é a REAR → antiSquat
    let longTransferFront = -longTransferRaw * 0.5;  // negativo se ax>0 (alivia front)
    let longTransferRear  =  longTransferRaw * 0.5;  // positivo se ax>0 (carrega rear)
    if (ax < 0) {
      // Freada: front carrega, rear alivia
      longTransferFront *= (1 - antiDiveFront);   // dive reduzido
      // longTransferRear não muda (alívio do rear é "gratuito")
    } else if (ax > 0) {
      // Aceleração: rear carrega, front alivia
      longTransferRear  *= (1 - antiSquatRear);   // squat reduzido
    }

    const frontLat = c.mass * c.axleWeightRatioFront * ay * c.rollCenterHeightFront / c.trackWidth * c.geometricLoadTransferScale;
    const rearLat  = c.mass * c.axleWeightRatioRear  * ay * c.rollCenterHeightRear  / c.trackWidth * c.geometricLoadTransferScale;

    const apply = (w, arbForce, latTransfer) => {
      const side = Math.sign(w.offsetLocal.x) || 1;
      const latLoad = -side * latTransfer;
      const longLoad = w.isFront ? longTransferFront : longTransferRear;
      w.applySuspensionLoads(arbForce, latLoad + longLoad);
    };

    apply(fl,  frontArb, frontLat);
    apply(fr, -frontArb, frontLat);
    apply(rl,   rearArb, rearLat);
    apply(rr,  -rearArb, rearLat);
  }

  integrateSprungBody(sdt) {
    const c = this.cfg;
    let totalSuspensionForce = 0;
    let pitchTorque = -c.sprungMass * (this.accelLocal.x || 0) * c.cgHeight;
    let rollTorque  = c.sprungMass * (this.accelLocal.z || 0) * c.cgHeight;

    for (const w of this.wheels) {
      const F = w.suspensionForce;
      totalSuspensionForce += F;
      pitchTorque += -F * w.offsetLocal.z;
      rollTorque += F * w.offsetLocal.x;
    }

    const heaveAccel = (totalSuspensionForce - c.sprungMass * c.gravity) / c.sprungMass;
    this.velocity.y += heaveAccel * sdt;
    this.position.y += this.velocity.y * sdt;

    const pitchAccel = (pitchTorque / c.pitchInertia) - this.pitchVel * c.pitchDamp - this.pitch * c.pitchStiff;
    // `this.roll` is the inverse of the physical Z rotation used by Three.js
    // (`mesh.rotation.z = -roll`), so physical torque_z must be inverted here.
    const rollAccel  = (-rollTorque / c.rollInertia)  - this.rollVel  * c.rollDamp  - this.roll  * c.rollStiff;

    this.pitchVel += pitchAccel * sdt;
    this.rollVel  += rollAccel  * sdt;
    this.pitch += this.pitchVel * sdt;
    this.roll  += this.rollVel  * sdt;

    if (Math.abs(this.pitch) > c.maxBodyPitch) {
      this.pitch = Math.sign(this.pitch) * c.maxBodyPitch;
      if (Math.sign(this.pitchVel) === Math.sign(this.pitch)) this.pitchVel *= 0.25;
    }
    if (Math.abs(this.roll) > c.maxBodyRoll) {
      this.roll = Math.sign(this.roll) * c.maxBodyRoll;
      if (Math.sign(this.rollVel) === Math.sign(this.roll)) this.rollVel *= 0.25;
    }
  }

  doPhysics(dt, throttleInput, brakeInput, steerInput, ebrakeInput, clutchPedalInput = 0) {
    const steps = PHYSICS_CFG.subSteps;
    const sdt = dt / steps;
    const c = this.cfg;
    let wheelData = [];

    // SAT agora vive DENTRO do sub-step (j) — emerge do M_kingpin pós-tire-forces.

    let ptResult = null;
    for (let step = 0; step < steps; step++) {
      const sn = Math.sin(this.heading);
      const cs = Math.cos(this.heading);

      this.forward.set(sn, 0, cs);
      this.right.set(cs, 0, -sn);

      this.velocityLocal.x = this.forward.dot(this.velocity);
      this.velocityLocal.z = this.right.dot(this.velocity);
      this.velocityLocal.y = 0;

      for (const w of this.wheels) {
        w.updateSuspension(sdt, this.position, this.heading, this.pitch, this.roll, this.groundObjects);
      }

      const fl = this.wheels[0], fr = this.wheels[1], rl = this.wheels[2], rr = this.wheels[3];

      this.applySuspensionLoadTransfer();
      this.integrateSprungBody(sdt);

      // Ackermann: roda interna gira mais que a externa
      const rawSteer = this.steer * c.maxSteer;
      if (this.steer >= 0) {
        fr.steerAngle = rawSteer;
        fl.steerAngle = this.ackermann(rawSteer) * c.ackermannFactor;
      } else {
        fl.steerAngle = rawSteer;
        fr.steerAngle = this.ackermann(rawSteer) * c.ackermannFactor;
      }
      rl.steerAngle = 0;
      rr.steerAngle = 0;

      // Clutch agora vem do pedal analógico do jogador (Ctrl). O hack antigo
      // de `ebrakeInput * 0.3` foi removido — handbrake e clutch são canais
      // independentes.
      const ptInputs = {
        throttle: throttleInput,
        clutchPedal: clutchPedalInput,
        brakeInput: brakeInput,
        handbrake: ebrakeInput,
        shiftUp: false,
        shiftDown: false,
        speedMS: this.absVel,
      };
      // Powertrain a 240Hz (mesmo sub-step do chassis). Inner sub-step 4×
      // foi tentado mas causou problema de sub-amostragem: motor oscila
      // ±28 rad/s em 4 iters perto da fronteira slip↔stick, e a roda só
      // vê o ÚLTIMO transmittedTorque por chassis sub-step → drive torque
      // alternava sinal aleatoriamente, freando arrancada. Solução AAA real
      // (BeamNG/ACC) é integrar o motor implicitamente, não sub-amostrar.
      // Pra esse projeto, 240Hz é suficiente — motor-clutch tau~4ms, dt=4.2ms
      // está marginal mas estável.
      ptResult = this.powertrain.update(sdt, ptInputs, this.wheels);

      rl.driveTorque = ptResult.wheelTorques.rl;
      rr.driveTorque = ptResult.wheelTorques.rr;
      fl.driveTorque = 0;
      fr.driveTorque = 0;

      if (this.nitroT > 0) {
        rl.driveTorque *= GAME_CFG.nitroMult;
        rr.driveTorque *= GAME_CFG.nitroMult;
      }

      this.rpm = ptResult.rpm;
      this.gear = this.powertrain.gearbox.currentGear;

      const totalBrake = brakeInput * c.brakeTorqueMax;
      const frontBrake = totalBrake * c.brakeBiasFront;
      const rearBrake  = totalBrake * (1.0 - c.brakeBiasFront);
      const eBrakeRear = ebrakeInput * c.ebrakeTorque;

      fl.brakeTorque = frontBrake * 0.5;
      fr.brakeTorque = frontBrake * 0.5;
      rl.brakeTorque = rearBrake * 0.5 + eBrakeRear * 0.5;
      rr.brakeTorque = rearBrake * 0.5 + eBrakeRear * 0.5;

      const getContactVel = (w) => {
        const r = w.mesh.position.clone().sub(this.position);
        const omegaCrossR = new THREE.Vector3(this.yawRate * r.z, 0, -this.yawRate * r.x);
        const vWorld = this.velocity.clone().add(omegaCrossR);
        const vx = this.forward.dot(vWorld);
        const vy = this.right.dot(vWorld);
        return { vx, vy };
      };

      // Inércia equivalente vista pela roda traseira: I_eq = I_wheel + (I_engine·(gear·diff)²)/2
      // — divisão por 2 porque o torque é dividido entre as duas rodas traseiras.
      //
      // CRÍTICO: refletir a inércia do motor APENAS quando clutch acoplado
      // (stick). Em SLIPPING (wheelspin sustentado, arrancada com clutch
      // parcial), o motor está "solto" do drivetrain — a roda só carrega
      // sua própria I_wheel. Sem essa distinção, em wheelspin a roda fica
      // com I_eff ~1.7 kg·m² e desacelera 15× mais devagar que deveria;
      // o slipRatio satura permanentemente em 1.0 e o carro desacelera
      // (caso reportado: travado em 4ª/5ª/6ª com sr=1.00 sustentado).
      let effectiveRearInertia = c.wheelInertia;
      const ptGearRatio = this.powertrain.gearbox.getGearRatio();
      const clutchEngaged = !this.powertrain.clutch.isSlipping;
      if (!this.powertrain.gearbox.isShifting
          && this.powertrain.gearbox.currentGear !== 0
          && Math.abs(ptGearRatio) > 0.01
          && clutchEngaged) {
        effectiveRearInertia += (this.powertrain.engine.inertia * Math.pow(ptGearRatio * c.diffRatio, 2)) / 2;
      }

      let totalFx = 0, totalFz = 0, yawTorque = 0;
      wheelData = [];

      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i];
        const vel = getContactVel(w);
        const wInertia = (i >= 2) ? effectiveRearInertia : c.wheelInertia;
        w.updateTireForces(vel.vx, vel.vy, sdt, wInertia);

        const cosS = Math.cos(w.steerAngle);
        const sinS = Math.sin(w.steerAngle);
        let fx = w.longitudinalForce * cosS - w.lateralForce * sinS;
        let fz = w.longitudinalForce * sinS + w.lateralForce * cosS;

        if (Math.abs(vel.vx) > 0.1) {
          const Frr = -c.Crr * w.normalLoad * Math.sign(vel.vx);
          fx += Frr;
        }

        totalFx += fx;
        totalFz += fz;
        yawTorque += fz * w.offsetLocal.z - fx * w.offsetLocal.x;

        // Probes de grip (HUD/diagnóstico). muEffective = mu_base × gripFactor(T) × surface;
        // Fy_max é o D do Pacejka pós-load-sensitivity sublinear — força lateral máxima
        // disponível com a carga atual. Comparar com `lateralForce` mostra quanta margem o
        // pneu ainda tem (Fy/Fy_max → 1 = saturado; →0.5 = sobra grip).
        const muEff = c.mu * gripFactor(w.tireTemp) * (SURFACE_MU[w.currentSurface] ?? 1.0);
        const FyMax = effectiveD(muEff, w.normalLoad, {
          loadSensN: c.loadSensN,
          loadSensRefFz: c.loadSensRefFz,
        });

        wheelData.push({
          slipAngle: w.slipAngle,
          slipRatio: w.slipRatio,
          normalLoad: w.normalLoad,
          compression: w.compression,
          compressionSpeed: w.compressionSpeed,
          springForce: w.springForce,
          damperForce: w.damperForce,
          tireVerticalForce: w.tireVerticalForce,
          arbForce: w.arbForce,
          geoLoad: w.geoLoad,
          fx, fz,
          angularVel: w.angularVelocity,
          tireTemp: w.tireTemp,
          muEffective: muEff,
          FyMax,
          lateralForce: w.lateralForce,
          longitudinalForce: w.longitudinalForce,
          surface: w.currentSurface,
        });
      }

      const airDragX = -c.Cdrag * this.velocityLocal.x * Math.abs(this.velocityLocal.x);
      const airDragZ = -c.Cdrag * this.velocityLocal.z * Math.abs(this.velocityLocal.z);
      totalFx += airDragX;
      totalFz += airDragZ;

      // SAT físico via kingpin moment. Aplica correção input-side em
      // `this.steer` e retorna a contribuição chassis-side para o yaw.
      // Lateral forces das rodas dianteiras já estão atualizadas (loop acima).
      yawTorque += this.applyKingpinSAT(sdt);

      this.accelLocal.x = totalFx / c.mass;
      this.accelLocal.z = totalFz / c.mass;

      this.accel.copy(this.forward).multiplyScalar(this.accelLocal.x)
                .add(this.right.clone().multiplyScalar(this.accelLocal.z));

      // Semi-implicit Euler: velocidade atualiza ANTES da posição.
      // (posição XZ usa a velocidade nova nas linhas 358-359 abaixo.)
      this.velocity.x += this.accel.x * sdt;
      this.velocity.z += this.accel.z * sdt;
      this.absVel = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);

      if (this.absVel < PHYSICS_CFG.stopVelocityThreshold && throttleInput < 0.01 && brakeInput < 0.01) {
        this.velocity.x = 0;
        this.velocity.z = 0;
        this.absVel = 0;
        this.yawRate = 0;
        for (const w of this.wheels) w.angularVelocity *= 0.9;
      }

      const angularAccel = yawTorque / c.inertia;
      this.yawRate += angularAccel * sdt;
      this.yawRate *= PHYSICS_CFG.yawRateDamping;
      this.heading += this.yawRate * sdt;

      this.position.x += this.velocity.x * sdt;
      this.position.z += this.velocity.z * sdt;

      this._syncMeshPose();
    }

    this._syncWheelVisualPoses();

    return { wheelData, rpm: this.rpm, gear: this.gear, powertrain: ptResult };
  }

  /**
   * Aplica um vehicle data template (JSON em src/vehicles/*.json) — overwrite
   * dos defaults físicos (chassis, motor, turbo, drivetrain) com os valores
   * ground-truth de um veículo específico (ex.: BMW M4 F82 S55).
   *
   * Diferenças vs applyPreset:
   *   - vehicle data = template imutável do CARRO (massa, curva torque,
   *     boost map, ratios DCT). Aplicado UMA vez na inicialização.
   *   - preset       = tune deltas em cima do veículo (ECU map, lock %, etc).
   *     Aplicado por cima, múltiplas vezes via TuningUI.
   *
   * Ordem recomendada em Game.js: applyVehicleData → applyPreset → tunings.
   *
   * Shape: ver src/vehicles/bmw-m4-f82.json. Todos os campos opcionais.
   */
  applyVehicleData(v) {
    if (!v) return;
    const c = this.cfg;
    const pt = this.powertrain;

    // 1) Chassis — massa, geometria, raio do pneu, drag.
    if (v.chassis) {
      const ch = v.chassis;
      for (const k of ['mass', 'cgToFrontAxle', 'cgToRearAxle', 'cgHeight',
                       'halfWidth', 'wheelRadius', 'wheelMass', 'wheelWidth',
                       'Cdrag', 'Crr']) {
        if (typeof ch[k] === 'number') c[k] = ch[k];
      }
      // Recalcula wheelBase, axleWeightRatio, sprungMass, inércias derivadas,
      // mech trail e loadSensRefFz (todos dependem dos defaults acima).
      c.syncDerivedGeometry();
    }

    // 2) Engine — curva torque, RPMs, fricção, throttle lag.
    if (v.engine && pt?.engine) {
      const e = pt.engine;
      const ev = v.engine;
      if (Array.isArray(ev.torqueCurve)) {
        e.torqueCurve = ev.torqueCurve.map(p => ({ r: p.r, t: p.t }));
        e._maxTorque = Math.max(...e.torqueCurve.map(p => p.t));
      }
      for (const k of ['idleRPM', 'redlineRPM', 'revLimitRPM', 'maxRPM',
                       'stallRPM', 'inertia', 'frictionPassive',
                       'frictionLinear', 'frictionQuadratic', 'coastTorque']) {
        if (typeof ev[k] === 'number') e[k] = ev[k];
      }
      if (typeof ev.throttleLagMs === 'number') {
        e._throttleTau = ev.throttleLagMs / 1000;
      }
      // Re-sincroniza limites no Gearbox (gating de over-rev / bog).
      pt._syncEngineLimitsToGearbox?.();
    }

    // 3) Turbo — boost map 2D, wastegate, spool tau.
    if (v.turbo && pt?.turbo) {
      const t = pt.turbo;
      const tv = v.turbo;
      if (typeof tv.maxBoost === 'number')        t.maxBoost = tv.maxBoost;
      if (typeof tv.wastegateBoost === 'number')  t.wastegateBoost = tv.wastegateBoost;
      if (typeof tv.spoolTimeConstant === 'number') t.spoolTau = tv.spoolTimeConstant;
      if (typeof tv.blowOffEnabled === 'boolean') t.blowOffEnabled = tv.blowOffEnabled;
      if (typeof tv.blowOffMinBoost === 'number') t.blowOffMinBoost = tv.blowOffMinBoost;
      if (Array.isArray(tv.boostMapRPM))          t.boostMapRPM = [...tv.boostMapRPM];
      if (Array.isArray(tv.boostMapThrottle))     t.boostMapThrottle = [...tv.boostMapThrottle];
      if (Array.isArray(tv.boostMap))             t.boostMap = tv.boostMap.map(row => [...row]);
    }

    // 4.4) Tire — mu, load sensitivity, relaxation, drift bias.
    // Pneus M4 stock são performance (Michelin Pilot Super Sport / Cup 2):
    // mu ≈ 1.35 em asfalto seco. Default genérico era 1.20 (street tire).
    if (v.tire) {
      const tv = v.tire;
      if (typeof tv.mu === 'number')                c.mu = tv.mu;
      if (typeof tv.loadSensN === 'number')         c.loadSensN = tv.loadSensN;
      if (typeof tv.loadSensRefFz === 'number')     c.loadSensRefFz = tv.loadSensRefFz;
      if (typeof tv.relaxationLength === 'number')  c.relaxationLength = tv.relaxationLength;
      if (typeof tv.tireDriftBias === 'number')     c.tireDriftBias = tv.tireDriftBias;
    }

    // 4.5) Assists — TC mode, brake bias. Aplicado ANTES do drivetrain pq
    // alguns assists (ex: TC) interagem com o powertrain em runtime.
    if (v.assists) {
      const a = v.assists;
      if (typeof a.tcMode === 'string' && pt) {
        if (typeof pt.setTCMode === 'function') pt.setTCMode(a.tcMode);
        else if (pt.tc) pt.tc.mode = a.tcMode;
      }
      if (typeof a.brakeBiasFront === 'number') c.brakeBiasFront = a.brakeBiasFront;
    }

    // 4) Drivetrain — gear ratios, final drive, eficiência, modo, diff.
    if (v.drivetrain && pt) {
      const d = v.drivetrain;
      if (Array.isArray(d.gearRatios)) {
        if (pt.gearbox) pt.gearbox.gearRatios = [...d.gearRatios];
        c.gearRatios = [...d.gearRatios];
      }
      if (typeof d.finalDrive === 'number') {
        pt.finalDrive = d.finalDrive;
        if (pt.differential) pt.differential.finalDrive = d.finalDrive;
        c.diffRatio = d.finalDrive;
      }
      if (typeof d.transEfficiency === 'number') {
        pt.transEfficiency = d.transEfficiency;
        c.transEfficiency = d.transEfficiency;
      }
      if (typeof d.gearboxMode === 'string' && pt.gearbox?.setMode) {
        pt.gearbox.setMode(d.gearboxMode);
      }
      if (typeof d.shiftTimeMs === 'number' && pt.gearbox) {
        pt.gearbox.shiftTime = d.shiftTimeMs / 1000;
      }
      if (d.differential && pt.differential) {
        const dv = d.differential;
        if (typeof dv.type === 'string')       pt.differential.type = dv.type;
        if (typeof dv.preload === 'number')    pt.differential.preload = dv.preload;
        if (typeof dv.powerLock === 'number')  pt.differential.powerLock = dv.powerLock;
        if (typeof dv.coastLock === 'number')  pt.differential.coastLock = dv.coastLock;
        if (typeof dv.efficiency === 'number') pt.differential.efficiency = dv.efficiency;
      }
    }
  }

  /**
   * Aplica um preset de tuning carregado de JSON em src/tuning/presets/*.json.
   *
   * Shape esperado:
   *   { finalDrive, gearRatios[], differential: { type, preload, powerLock, coastLock },
   *     tcMode, brakeBiasFront, engineInertia, turboMaxBoost }
   *
   * Todos os campos são opcionais — só atualiza o que vier no preset.
   * Usa optional-chaining em todos os lados pra nunca crashar caso o
   * powertrain ainda não tenha sido construído com algum subsistema.
   */
  applyPreset(p) {
    if (!p) return;
    const cfg = this.cfg;
    const pt = this.powertrain;

    if (typeof p.finalDrive === 'number') {
      if (cfg) cfg.diffRatio = p.finalDrive;
      if (pt) pt.finalDrive = p.finalDrive;
      if (pt?.differential) pt.differential.finalDrive = p.finalDrive;
    }

    if (Array.isArray(p.gearRatios)) {
      if (pt?.gearbox) pt.gearbox.gearRatios = [...p.gearRatios];
      if (cfg) cfg.gearRatios = [...p.gearRatios];
    }

    if (p.differential && pt?.differential) {
      const diff = pt.differential;
      if (typeof p.differential.type === 'string') diff.type = p.differential.type;
      if (typeof p.differential.preload === 'number') diff.preload = p.differential.preload;
      if (typeof p.differential.powerLock === 'number') diff.powerLock = p.differential.powerLock;
      if (typeof p.differential.coastLock === 'number') diff.coastLock = p.differential.coastLock;
    }

    if (typeof p.tcMode === 'string' && pt) {
      if (typeof pt.setTCMode === 'function') pt.setTCMode(p.tcMode);
      else if (pt.tc) pt.tc.mode = p.tcMode;
    }

    if (typeof p.brakeBiasFront === 'number' && cfg) {
      cfg.brakeBiasFront = p.brakeBiasFront;
    }

    if (typeof p.engineInertia === 'number' && pt?.engine) {
      pt.engine.inertia = p.engineInertia;
    }

    if (typeof p.turboMaxBoost === 'number' && pt?.turbo) {
      pt.turbo.maxBoost = p.turboMaxBoost;
    }

    if (typeof p.gearboxMode === 'string' && pt?.gearbox?.setMode) {
      pt.gearbox.setMode(p.gearboxMode);
    }

    if (p.suspension && cfg) {
      const s = p.suspension;
      if (typeof s.suspRestLength === 'number') cfg.suspRestLength = s.suspRestLength;
      if (typeof s.springRateFront === 'number') cfg.springRateFront = s.springRateFront;
      if (typeof s.springRateRear === 'number') cfg.springRateRear = s.springRateRear;
      if (typeof s.damperBumpFront === 'number') cfg.damperBumpFront = s.damperBumpFront;
      if (typeof s.damperBumpRear === 'number') cfg.damperBumpRear = s.damperBumpRear;
      if (typeof s.damperReboundFront === 'number') cfg.damperReboundFront = s.damperReboundFront;
      if (typeof s.damperReboundRear === 'number') cfg.damperReboundRear = s.damperReboundRear;
      if (typeof s.antiRollFront === 'number') cfg.antiRollFront = s.antiRollFront;
      if (typeof s.antiRollRear === 'number') cfg.antiRollRear = s.antiRollRear;
      // Fase 4: anti-dive, anti-squat, camber dinâmico
      if (typeof s.antiDiveFront === 'number')      cfg.antiDiveFront = s.antiDiveFront;
      if (typeof s.antiSquatRear === 'number')      cfg.antiSquatRear = s.antiSquatRear;
      if (typeof s.camberStaticFront === 'number')  cfg.camberStaticFront = s.camberStaticFront;
      if (typeof s.camberStaticRear === 'number')   cfg.camberStaticRear = s.camberStaticRear;
      if (typeof s.camberGainPerMeter === 'number') cfg.camberGainPerMeter = s.camberGainPerMeter;
    }

    // Fase 4: tire props (mu, loadSensN, relaxationLength, driftBias)
    if (p.tire && cfg) {
      const t = p.tire;
      if (typeof t.mu === 'number')                cfg.mu = t.mu;
      if (typeof t.loadSensN === 'number')         cfg.loadSensN = t.loadSensN;
      if (typeof t.loadSensRefFz === 'number')     cfg.loadSensRefFz = t.loadSensRefFz;
      if (typeof t.relaxationLength === 'number')  cfg.relaxationLength = t.relaxationLength;
      if (typeof t.tireDriftBias === 'number')     cfg.tireDriftBias = t.tireDriftBias;
    }

    if (p.steering && cfg) {
      const s = p.steering;
      if (typeof s.maxAngleDeg === 'number') {
        cfg.maxSteer = s.maxAngleDeg * Math.PI / 180;
      }
      if (typeof s.speedReductionPct === 'number') {
        cfg.steerSpeedReduction = s.speedReductionPct / 100;
      }
    }
  }

  update(dt, input, smoke, skids) {
    const gas = (input.down('KeyW') || input.down('ArrowUp')) ? 1 : 0;
    const brk = (input.down('KeyS') || input.down('ArrowDown')) ? 1 : 0;
    let steerRaw = input.steeringAxis();
    const hb = (input.down('ShiftLeft') || input.down('ShiftRight')) ? 1 : 0;

    if (input.once('Space') && this.nitroCd <= 0) {
      this.nitroT = GAME_CFG.nitroDuration;
      this.nitroCd = GAME_CFG.nitroCooldown + GAME_CFG.nitroDuration;
    }
    if (this.nitroT > 0) this.nitroT -= dt;
    if (this.nitroCd > 0) this.nitroCd -= dt;
    const nitroMult = this.nitroT > 0 ? GAME_CFG.nitroMult : 1;

    this.steer = this.applySmoothSteer(steerRaw, dt);
    this.steer = this.applySafeSteer(this.steer);

    let throttleInput = gas * nitroMult;
    let brakeInput = brk;

    // Engatar ré: freio segurado e carro quase parado / indo pra trás.
    // (setReverse não tem gating de RPM — wheelOmega ≈ 0 nesse cenário.)
    const gb = this.powertrain.gearbox;
    if (brk > 0 && this.velocityLocal.x < 1.0) {
      gb.setReverse();
      throttleInput = brk;
      brakeInput = 0;
    } else if (gas > 0 && this.velocityLocal.x > -1.0 && gb.currentGear < 2) {
      // Saindo de N(0) ou R(1) para 1ª(2). Pula direto pra 1ª (não sobe gear-by-gear,
      // senão N → R por shiftUp, que é absurdo).
      if (!gb.isShifting && gb.shiftCooldown <= 0) {
        gb.targetGear = 2;
        gb._startShift();
      }
    } else if (gb.currentGear === 1 && gas > 0) {
      // Em ré com gas → trata como freio para parar a ré.
      brakeInput = gas;
      throttleInput = 0;
    }

    // Expor inputs efetivos para CarVisuals (brake lights, etc).
    this.brake = brakeInput;
    this.throttle = throttleInput;
    this.handbrake = hb;

    // Manual: Q downshift, E upshift. Ambos respeitam gating (overrev/bog/cooldown).
    // Se bloqueado, gearbox.lastBlockedReason fica setado e o HUD pisca o motivo.
    if (input.once('KeyQ')) this.powertrain.gearbox.shiftDown();
    if (input.once('KeyE')) this.powertrain.gearbox.shiftUp();

    if (input.once('KeyT')) {
      const modes = ['off', 'low', 'high'];
      const curr = this.powertrain.tc.mode;
      const next = modes[(modes.indexOf(curr) + 1) % modes.length];
      this.powertrain.setTCMode(next);
    }

    if (input.once('KeyY')) {
      const diffs = ['open', 'lsd_clutch', 'torsen', 'welded'];
      const curr = this.powertrain.differential.type;
      let idx = diffs.indexOf(curr);
      if (idx < 0) idx = 0;  // tipo legado/desconhecido cai pra open
      const next = diffs[(idx + 1) % diffs.length];
      this.powertrain.setDifferentialType(next);
    }

    // KeyU — cicla gearbox mode (h_pattern ↔ sequential)
    if (input.once('KeyU')) {
      const curr = this.powertrain.gearbox.mode;
      const next = (curr === 'h_pattern') ? 'sequential' : 'h_pattern';
      this.powertrain.gearbox.setMode(next);
    }

    // KeyL — toggla launch control armed
    if (input.once('KeyL')) {
      this.powertrain.launch.armed = !this.powertrain.launch.armed;
    }

    // Clutch analógico: hold time → pedal progressivo.
    const ctrlDown = input.down('ControlLeft') || input.down('ControlRight');
    if (ctrlDown) {
      this.clutchHold += dt;       // 1.0/seg ⇒ 1s de hold = pedal full
    } else {
      this.clutchHold -= dt * 3;   // release ~3x mais rápido (0.33s)
    }
    if (this.clutchHold < 0) this.clutchHold = 0;
    if (this.clutchHold > 1) this.clutchHold = 1;

    const phys = this.doPhysics(dt, throttleInput, brakeInput, steerRaw, hb, this.clutchHold);

    this.visuals.update(dt);

    const rearSlip = (Math.abs(phys.wheelData[2].slipAngle) + Math.abs(phys.wheelData[3].slipAngle)) * 0.5;
    const isDrifting = rearSlip > PHYSICS_CFG.driftSlipThreshold && Math.abs(this.velocityLocal.x) > PHYSICS_CFG.driftMinSpeed;
    const slipIntensity = Math.max(rearSlip, (Math.abs(phys.wheelData[0].slipAngle) + Math.abs(phys.wheelData[1].slipAngle)) * 0.5);

    if (slipIntensity > PHYSICS_CFG.driftSmokeThreshold) {
      [2, 3].forEach(i => {
        const p = this.wheelWorld(i);
        p.y = 0.08;
        smoke.emit(p, slipIntensity * PHYSICS_CFG.driftSmokeIntensityMult);
      });
    }

    if (isDrifting || (hb > 0.5 && Math.abs(this.velocityLocal.x) > 2)) {
      [0, 1, 2, 3].forEach(i => {
        const p = this.wheelWorld(i);
        p.y = 0.04;
        skids.emit(i, p, this.forward, 0.18);
      });
    } else {
      [0, 1, 2, 3].forEach(i => skids.clear(i));
    }

    return {
      speed: this.absVel,
      forwardSpeed: this.velocityLocal.x,
      lateralSpeed: this.velocityLocal.z,
      isDrifting,
      driftAngle: rearSlip,
      slipIntensity,
      yawRate: this.yawRate,
      rpm: phys.rpm,
      gear: phys.gear,
      wheelData: phys.wheelData,
      powertrain: phys.powertrain,
    };
  }
}
