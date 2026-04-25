import * as THREE from 'three';
import { CarConfig } from './CarConfig.js';
import { Wheel } from './Wheel.js';
import { PowertrainSystem } from '../powertrain.js';
import { GAME_CFG, PHYSICS_CFG } from '../core/constants.js';

export class Car {
  constructor(scene, groundObjects) {
    this.scene = scene;
    this.groundObjects = groundObjects;
    this.mesh = new THREE.Group();
    this.buildVisuals();
    scene.add(this.mesh);

    this.config = new CarConfig();
    this.cfg = this.config;

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
    this.resetPos = new THREE.Vector3(0, 1.0, 0);

    // Clutch analógico (hold-time → pedal progressivo).
    // 1s segurando Ctrl → pedal 1.0; soltar recupera a 3x velocidade (~0.33s).
    this.clutchHold = 0;

    const c = this.cfg;
    this.powertrain = new PowertrainSystem({
      engine: {
        idleRPM: c.idleRPM,
        redlineRPM: c.maxRPM,
        maxRPM: c.maxRPM + 300,
        inertia: 0.18,
        frictionPassive: 18.0,
        revLimitMode: 'hard',
        canStall: false,
      },
      clutch: {
        maxTorqueTransfer: 600,
      },
      gearbox: {
        gearRatios: c.gearRatios,
        shiftTime: 0.3,
        autoShift: true,
      },
      differential: {
        type: 'welded',           // default modo Forza arcade-friendly
        finalDrive: c.diffRatio,
        efficiency: c.transEfficiency,
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
        maxBoost: 0.8,
        spoolRate: 2.0,
      },
      finalDrive: c.diffRatio,
      transEfficiency: c.transEfficiency,
    });

    const hw = c.halfWidth;
    const fAxle = c.cgToFrontAxle;
    const rAxle = -c.cgToRearAxle;
    const attachY = 0.12;

    this.wheels = [
      new Wheel(scene, new THREE.Vector3(-hw, attachY, fAxle), true, c),
      new Wheel(scene, new THREE.Vector3( hw, attachY, fAxle), true, c),
      new Wheel(scene, new THREE.Vector3(-hw, attachY, rAxle), false, c),
      new Wheel(scene, new THREE.Vector3( hw, attachY, rAxle), false, c),
    ];

    const staticCompression = (c.mass * c.gravity / 4) / c.springRate;
    this.initialY = c.suspRestLength - staticCompression + c.wheelRadius - attachY;
    this.position.y = this.initialY;
    this.resetPos.y = this.initialY;
  }

  buildVisuals() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xff2a6d, roughness: 0.25, metalness: 0.3,
      clearcoat: 1.0, clearcoatRoughness: 0.15
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.48, 3.3), bodyMat);
    body.position.y = 0.42; body.castShadow = true; this.mesh.add(body);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x111111, roughness: 0.05, metalness: 0.4,
      transmission: 0.4, transparent: true, thickness: 0.05
    });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.36, 1.5), glassMat);
    cabin.position.set(0, 0.82, -0.2); cabin.castShadow = true; this.mesh.add(cabin);

    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.07, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4, metalness: 0.6 })
    );
    spoiler.position.set(0, 0.76, -1.45); spoiler.castShadow = true; this.mesh.add(spoiler);

    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 2.5 });
    const flLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.08), lightMat);
    flLight.position.set(-0.55, 0.42, 1.62); this.mesh.add(flLight);
    const frLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.08), lightMat);
    frLight.position.set(0.55, 0.42, 1.62); this.mesh.add(frLight);

    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff1111, emissive: 0xff0000, emissiveIntensity: 1.5 });
    const tlLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.06), tailMat);
    tlLight.position.set(-0.55, 0.48, -1.62); this.mesh.add(tlLight);
    const trLight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.06), tailMat);
    trLight.position.set(0.55, 0.48, -1.62); this.mesh.add(trLight);
  }

  wheelWorld(i) { return this.wheels[i].getWorldPosition(); }

  reset() {
    this.position.set(0, this.initialY, 0);
    this.velocity.set(0, 0, 0);
    this.velocityLocal.set(0, 0, 0);
    this.accel.set(0, 0, 0);
    this.accelLocal.set(0, 0, 0);
    this.heading = 0;
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
    }
    this.mesh.position.set(0, this.initialY, 0);
    this.mesh.rotation.set(0, 0, 0);
  }

  applySmoothSteer(steerInput, dt) {
    if (Math.abs(steerInput) > 0.001) {
      const s = this.steer + steerInput * dt * PHYSICS_CFG.steerInputAccel;
      return Math.max(-1.0, Math.min(1.0, s));
    } else {
      if (this.steer > 0) return Math.max(this.steer - dt * PHYSICS_CFG.steerCenterReturn, 0);
      if (this.steer < 0) return Math.min(this.steer + dt * PHYSICS_CFG.steerCenterReturn, 0);
      return 0;
    }
  }

  applySafeSteer(steerInput) {
    const avel = Math.min(this.absVel, PHYSICS_CFG.safeSteerCap);
    return steerInput * (1.0 - (avel / PHYSICS_CFG.safeSteerMaxSpeed));
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

  doPhysics(dt, throttleInput, brakeInput, steerInput, ebrakeInput, clutchPedalInput = 0) {
    const steps = PHYSICS_CFG.subSteps;
    const sdt = dt / steps;
    const c = this.cfg;
    let wheelData = [];

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

      const totalSusp = fl.suspensionForce + fr.suspensionForce + rl.suspensionForce + rr.suspensionForce;
      const vAccel = (totalSusp - c.mass * c.gravity) / c.mass;
      this.velocity.y += vAccel * sdt;
      this.position.y += this.velocity.y * sdt;

      // ARB: transfere carga para a roda mais comprimida (externa em curvas)
      const frontRoll = c.antiRollFront * (fl.compression - fr.compression);
      const rearRoll  = c.antiRollRear  * (rl.compression - rr.compression);
      fl.normalLoad = Math.max(0, fl.suspensionForce + frontRoll * 0.5);
      fr.normalLoad = Math.max(0, fr.suspensionForce - frontRoll * 0.5);
      rl.normalLoad = Math.max(0, rl.suspensionForce + rearRoll * 0.5);
      rr.normalLoad = Math.max(0, rr.suspensionForce - rearRoll * 0.5);

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
      let effectiveRearInertia = c.wheelInertia;
      const ptGearRatio = this.powertrain.gearbox.getGearRatio();
      if (!this.powertrain.gearbox.isShifting && this.powertrain.gearbox.currentGear !== 0 && Math.abs(ptGearRatio) > 0.01) {
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

        wheelData.push({
          slipAngle: w.slipAngle,
          slipRatio: w.slipRatio,
          normalLoad: w.normalLoad,
          fx, fz,
          angularVel: w.angularVelocity,
          tireTemp: w.tireTemp,
        });
      }

      const airDragX = -c.Cdrag * this.velocityLocal.x * Math.abs(this.velocityLocal.x);
      const airDragZ = -c.Cdrag * this.velocityLocal.z * Math.abs(this.velocityLocal.z);
      totalFx += airDragX;
      totalFz += airDragZ;

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
        this.velocity.set(0, 0, 0);
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

      const targetPitch = -this.accelLocal.x * PHYSICS_CFG.pitchAccelGain;
      const targetRoll  = -this.accelLocal.z * PHYSICS_CFG.rollAccelGain;
      this.pitchVel += ((targetPitch - this.pitch) * c.pitchStiff - this.pitchVel * c.pitchDamp) * sdt;
      this.rollVel  += ((targetRoll  - this.roll)  * c.rollStiff  - this.rollVel  * c.rollDamp)  * sdt;
      this.pitch += this.pitchVel * sdt;
      this.roll  += this.rollVel * sdt;

      this.mesh.position.copy(this.position);
      this.mesh.rotation.set(this.pitch, this.heading, -this.roll);
    }

    return { wheelData, rpm: this.rpm, gear: this.gear, powertrain: ptResult };
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
  }

  update(dt, input, smoke, skids) {
    const gas = (input.down('KeyW') || input.down('ArrowUp')) ? 1 : 0;
    const brk = (input.down('KeyS') || input.down('ArrowDown')) ? 1 : 0;
    let steerRaw = 0;
    if (input.down('KeyA') || input.down('ArrowLeft')) steerRaw += 1;
    if (input.down('KeyD') || input.down('ArrowRight')) steerRaw -= 1;
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

    if (brk > 0 && this.velocityLocal.x < 1.0) {
      this.powertrain.gearbox.setReverse();
      throttleInput = brk;
      brakeInput = 0;
    } else if (gas > 0 && this.velocityLocal.x > -1.0 && this.powertrain.gearbox.currentGear < 2) {
      this.powertrain.gearbox.shiftUp();
    } else if (this.powertrain.gearbox.currentGear === 1 && gas > 0) {
      brakeInput = gas;
      throttleInput = 0;
    }

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

    for (const w of this.wheels) {
      w.mesh.rotation.set(this.pitch, this.heading + w.steerAngle, -this.roll, 'YXZ');
      w.tireMesh.rotation.x += w.angularVelocity * dt;
    }

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
