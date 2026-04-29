import * as THREE from 'three';
import { PHYSICS_CFG, SURFACE_MU } from '../core/constants.js';
import {
  combinedSlipForces,
  gripFactor,
  TIRE_AMBIENT_C,
  TIRE_HEAT_GAIN,
  TIRE_COOL_RATE,
  TIRE_MAX_C,
} from './Tire.js';
import { SuspensionCorner } from './SuspensionCorner.js';

export class Wheel {
  constructor(scene, offsetLocal, isFront, cfg) {
    this.scene = scene;
    this.offsetLocal = offsetLocal.clone();
    this.isFront = isFront;
    this.isRear = !isFront;
    this.cfg = cfg;

    // Pacejka params overridáveis via cfg (fallbacks no Tire.js).
    // loadSensN/loadSensRefFz são mutados a cada chamada de updateTireForces
    // para refletir mudanças runtime via TuningUI (cfg.loadSensN slider).
    this.tireParams = {
      lateral: cfg.pacejkaLateral,        // {B,C,E} ou undefined
      longitudinal: cfg.pacejkaLongitudinal,
      isRear: !isFront,
      driftBias: cfg.tireDriftBias ?? 0.4,
      loadSensN: cfg.loadSensN ?? 0.85,
      loadSensRefFz: cfg.loadSensRefFz ?? 3200,
    };

    this.compression = 0;
    this.prevCompression = 0;
    this.compressionSpeed = 0;
    this.suspensionForce = 0;
    this.springForce = 0;
    this.damperForce = 0;
    this.bumpStopForce = 0;
    this.droopForce = 0;
    this.arbForce = 0;
    this.geoLoad = 0;
    this.tireVerticalForce = 0;
    this.tireDeflection = 0;
    this.isGrounded = false;
    this.hasGroundHit = false;
    this.hitDistance = 0;
    this.hitPoint = new THREE.Vector3();
    this.groundY = 0;
    this.anchorWorld = new THREE.Vector3();
    this.suspension = new SuspensionCorner(cfg, isFront);

    // Surface-aware physics (Fase 5). Lido do mesh.userData.surfaceType no raycast,
    // multiplica mu efetivo via SURFACE_MU em updateTireForces.
    this.currentSurface = 'asphalt';

    this.angularVelocity = 0;
    this.driveTorque = 0;
    this.brakeTorque = 0;

    this.slipAngle = 0;
    this.slipRatio = 0;
    this.normalLoad = 0;
    this.longitudinalForce = 0;
    this.lateralForce = 0;

    // Tire heat (°C) — começa em ambient. Aquece com slip power, esfria via convecção.
    this.tireTemp = TIRE_AMBIENT_C;

    this.steerAngle = 0;

    this.ray = new THREE.Raycaster();
    this.rayDown = new THREE.Vector3(0, -1, 0);
    this.rayLen = cfg.suspRestLength + cfg.suspMaxCompression + cfg.wheelRadius + cfg.suspRayExtra;

    this.mesh = new THREE.Group();
    this.mesh.position.copy(offsetLocal);
    this.mesh.position.y = offsetLocal.y - cfg.suspRestLength;
    scene.add(this.mesh);

    this.dbgLineGeo = new THREE.BufferGeometry();
    this.dbgLinePos = new Float32Array(6);
    this.dbgLineGeo.setAttribute('position', new THREE.BufferAttribute(this.dbgLinePos, 3));
    this.dbgLine = new THREE.Line(this.dbgLineGeo, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    this.dbgLine.frustumCulled = false;
    scene.add(this.dbgLine);
  }

  _updateAnchor(carPos, carHeading, carPitch, carRoll) {
    const cosH = Math.cos(carHeading);
    const sinH = Math.sin(carHeading);
    const cosP = Math.cos(carPitch);
    const sinP = Math.sin(carPitch);
    const cosR = Math.cos(carRoll);
    const sinR = Math.sin(carRoll);
    const lx = this.offsetLocal.x;
    const ly = this.offsetLocal.y;
    const lz = this.offsetLocal.z;

    const xRoll = lx * cosR + ly * sinR;
    const yRoll = -lx * sinR + ly * cosR;
    const yPitch = yRoll * cosP - lz * sinP;
    const zPitch = yRoll * sinP + lz * cosP;

    const wx = xRoll * cosH + zPitch * sinH;
    const wz = -xRoll * sinH + zPitch * cosH;
    this.anchorWorld.set(carPos.x + wx, carPos.y + yPitch, carPos.z + wz);
  }

  _sampleGround(groundObjects) {
    const c = this.cfg;
    this.rayLen = c.suspRestLength + c.suspMaxCompression + c.wheelRadius + c.suspRayExtra;
    this.ray.ray.origin.copy(this.anchorWorld);
    this.ray.ray.direction.copy(this.rayDown);

    const hits = this.ray.intersectObjects(groundObjects, false);
    if (hits.length > 0 && hits[0].distance <= this.rayLen) {
      this.hasGroundHit = true;
      this.hitDistance = hits[0].distance;
      this.hitPoint.copy(hits[0].point);
      this.groundY = hits[0].point.y;
      this.currentSurface = hits[0].object.userData?.surfaceType ?? 'asphalt';
    } else {
      this.hasGroundHit = false;
      this.hitDistance = this.rayLen;
      this.hitPoint.set(this.anchorWorld.x, this.anchorWorld.y - this.rayLen, this.anchorWorld.z);
      this.groundY = this.hitPoint.y;
      this.currentSurface = 'asphalt';  // fallback no ar
    }
  }

  _syncSuspensionState() {
    const s = this.suspension;
    this.prevCompression = s.prevCompression;
    this.compression = s.compression;
    this.compressionSpeed = s.compressionSpeed;
    this.suspensionForce = s.suspensionForce;
    this.springForce = s.springForce;
    this.damperForce = s.damperForce;
    this.bumpStopForce = s.bumpStopForce;
    this.droopForce = s.droopForce;
    this.arbForce = s.arbForce;
    this.geoLoad = s.geoLoad;
    this.tireVerticalForce = s.tireForce;
    this.tireDeflection = s.tireDeflection;
    this.normalLoad = s.normalLoad;
    this.isGrounded = this.hasGroundHit && this.normalLoad > 1.0;
  }

  resetSuspension(carPos, carHeading, carPitch, carRoll, groundObjects) {
    this._updateAnchor(carPos, carHeading, carPitch, carRoll);
    this._sampleGround(groundObjects);
    this.suspension.reset(this.anchorWorld.y, this.hasGroundHit ? this.groundY : 0);
    this._syncSuspensionState();
    this.mesh.position.set(this.anchorWorld.x, this.suspension.wheelY, this.anchorWorld.z);
    this._updateDebug();
  }

  updateSuspension(dt, carPos, carHeading, carPitch, carRoll, groundObjects) {
    this._updateAnchor(carPos, carHeading, carPitch, carRoll);
    this._sampleGround(groundObjects);
    this.suspension.update(dt, this.anchorWorld.y, this.groundY, this.hasGroundHit);
    this._syncSuspensionState();
    this.mesh.position.set(this.anchorWorld.x, this.suspension.wheelY, this.anchorWorld.z);

    this._updateDebug();
  }

  applySuspensionLoads(arbForce, geoLoad = 0) {
    this.suspension.applyLoads(arbForce, geoLoad, this.hasGroundHit);
    this._syncSuspensionState();
  }

  _updateDebug() {
    const o = this.ray.ray.origin;
    const d = this.hitPoint;
    const p = this.dbgLinePos;
    p[0] = o.x; p[1] = o.y; p[2] = o.z;
    p[3] = this.isGrounded ? d.x : o.x;
    p[4] = this.isGrounded ? d.y : o.y - this.rayLen;
    p[5] = this.isGrounded ? d.z : o.z;
    this.dbgLineGeo.attributes.position.needsUpdate = true;
    this.dbgLine.material.color.set(this.isGrounded ? 0x00ff00 : 0xff0000);
  }

  updateTireForces(vxLocal, vyLocal, dt, effectiveInertia = null) {
    if (!this.isGrounded || this.normalLoad <= 0.01) {
      this.slipAngle = 0;
      this.slipRatio = 0;
      this.longitudinalForce = 0;
      this.lateralForce = 0;
      // Pneu fora do solo: só esfria.
      this.tireTemp -= (this.tireTemp - TIRE_AMBIENT_C) * TIRE_COOL_RATE * dt;
      const inertia = effectiveInertia || this.cfg.wheelInertia;
      const netTorque = this.driveTorque - this.brakeTorque * Math.sign(this.angularVelocity || 1);
      this.angularVelocity += (netTorque / inertia) * dt;
      return;
    }
    const c = this.cfg;
    // mu efetivo = base do pneu × temperatura × tipo de superfície (asphalt/curb/grass).
    //   gripFactor() em Tire.js: 0.85 cold → 1.0 optimal → 0.55 overheat.
    //   SURFACE_MU em constants.js: asphalt 1.0, curb 0.92, grass 0.38.
    const surfaceMu = SURFACE_MU[this.currentSurface] ?? 1.0;
    const mu = c.mu * gripFactor(this.tireTemp) * surfaceMu;
    const N = this.normalLoad;

    // ---- slip angle (lateral)
    const vxAbs = Math.abs(vxLocal);
    const eps = 0.3;
    this.slipAngle = Math.atan2(vyLocal, Math.max(vxAbs, eps));
    if (this.isFront) {
      this.slipAngle -= Math.sign(vxLocal || 1) * this.steerAngle;
    }
    this.slipAngle = Math.max(-c.maxSlipAngle, Math.min(c.maxSlipAngle, this.slipAngle));

    // ---- slip ratio (longitudinal)
    const vWheel = this.angularVelocity * c.wheelRadius;
    if (vxAbs > eps) {
      this.slipRatio = (vWheel - vxLocal) / Math.max(Math.abs(vxLocal), eps);
    } else {
      // baixíssima velocidade: amplifica para que clutch-kick consiga gerar slip
      this.slipRatio = (vWheel - vxLocal) * 2.0;
    }
    this.slipRatio = Math.max(-1.0, Math.min(1.0, this.slipRatio));

    // ---- Pacejka Magic Formula + círculo de fricção (combined slip).
    // Sync params de load sensitivity vivos do cfg (TuningUI muta cfg.loadSensN runtime).
    this.tireParams.loadSensN = c.loadSensN ?? this.tireParams.loadSensN;
    this.tireParams.loadSensRefFz = c.loadSensRefFz ?? this.tireParams.loadSensRefFz;
    const { Fx: F_long_pacejka, Fy: F_lat } = combinedSlipForces(
      this.slipAngle,
      this.slipRatio,
      mu,
      N,
      this.tireParams,
    );

    // ---- Longitudinal: Pacejka dá a força MÁXIMA disponível para um dado slip ratio.
    // O torque de drive/brake impõe a aceleração angular da roda; o feedback do solo
    // surge naturalmente quando a roda desenvolve slip (via slipRatio acima).
    // Usamos diretamente F_long_pacejka — o equilíbrio é implícito no integrator.
    let F_long = F_long_pacejka;

    // Brake clipping: se a roda está parando e o brakeTorque excede o grip estático,
    // F_long acompanha o sinal de -vxLocal (oposição ao movimento).
    // (com Pacejka isso já emerge do slipRatio negativo gerado pelo brake.)

    this.lateralForce = F_lat;
    this.longitudinalForce = F_long;

    // ---- Tire heat: slipPower = F·v_slip (longitudinal + lateral). Heat in
    // proporcional ao trabalho de slip; cooling proporcional a (T - T_ambient).
    const vSlipLong = this.angularVelocity * c.wheelRadius - vxLocal;
    const vSlipLat  = vyLocal;
    const slipPower = Math.abs(F_long * vSlipLong) + Math.abs(F_lat * vSlipLat);
    const dTheat = slipPower * TIRE_HEAT_GAIN;
    const dTcool = (this.tireTemp - TIRE_AMBIENT_C) * TIRE_COOL_RATE;
    this.tireTemp += (dTheat - dTcool) * dt;
    if (this.tireTemp < TIRE_AMBIENT_C) this.tireTemp = TIRE_AMBIENT_C;
    if (this.tireTemp > TIRE_MAX_C)     this.tireTemp = TIRE_MAX_C;

    // ---- Integração da roda (semi-implicit Euler):
    // ω += (T_drive - T_brake·sign(ω) - F_long·R) / I_eff · dt
    const inertia = effectiveInertia || c.wheelInertia;
    const reactionTorque = this.longitudinalForce * c.wheelRadius;
    const netTorque = this.driveTorque
                    - this.brakeTorque * Math.sign(this.angularVelocity || 1)
                    - reactionTorque;
    const angularAccel = netTorque / inertia;
    this.angularVelocity += angularAccel * dt;
    this.angularVelocity *= PHYSICS_CFG.wheelAirDamping;
  }

  setVisible(v) {
    this.mesh.visible = v;
    this.dbgLine.visible = v;
  }

  getWorldPosition() {
    return this.mesh.position.clone();
  }
}
