import * as THREE from 'three';
import { PHYSICS_CFG } from '../core/constants.js';
import {
  combinedSlipForces,
  gripFactor,
  TIRE_AMBIENT_C,
  TIRE_HEAT_GAIN,
  TIRE_COOL_RATE,
  TIRE_MAX_C,
} from './Tire.js';

export class Wheel {
  constructor(scene, offsetLocal, isFront, cfg) {
    this.scene = scene;
    this.offsetLocal = offsetLocal.clone();
    this.isFront = isFront;
    this.isRear = !isFront;
    this.cfg = cfg;

    // Pacejka params overridáveis via cfg (fallbacks no Tire.js)
    this.tireParams = {
      lateral: cfg.pacejkaLateral,        // {B,C,E} ou undefined
      longitudinal: cfg.pacejkaLongitudinal,
      isRear: !isFront,
      driftBias: cfg.tireDriftBias ?? 0.4,
    };

    this.compression = 0;
    this.prevCompression = 0;
    this.compressionSpeed = 0;
    this.suspensionForce = 0;
    this.isGrounded = false;
    this.hitDistance = 0;
    this.hitPoint = new THREE.Vector3();

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
    this.rayLen = cfg.suspRestLength + cfg.wheelRadius + 0.6;

    this.mesh = new THREE.Group();
    this.mesh.position.copy(offsetLocal);
    this.mesh.position.y = offsetLocal.y - cfg.suspRestLength;
    scene.add(this.mesh);

    const wr = cfg.wheelRadius;
    const ww = cfg.wheelWidth;
    const tireGeo = new THREE.CylinderGeometry(wr, wr, ww, 24, 1);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, metalness: 0.05 });
    this.tireMesh = new THREE.Mesh(tireGeo, tireMat);
    this.tireMesh.castShadow = true;
    this.mesh.add(this.tireMesh);

    const rimGeo = new THREE.CylinderGeometry(wr * 0.72, wr * 0.72, ww * 1.02, 16, 1);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.25, metalness: 0.85 });
    this.rimMesh = new THREE.Mesh(rimGeo, rimMat);
    this.tireMesh.add(this.rimMesh);

    this.dbgLineGeo = new THREE.BufferGeometry();
    this.dbgLinePos = new Float32Array(6);
    this.dbgLineGeo.setAttribute('position', new THREE.BufferAttribute(this.dbgLinePos, 3));
    this.dbgLine = new THREE.Line(this.dbgLineGeo, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    this.dbgLine.frustumCulled = false;
    scene.add(this.dbgLine);
  }

  updateSuspension(dt, carPos, carHeading, carPitch, carRoll, groundObjects) {
    const c = this.cfg;
    const cos = Math.cos(carHeading);
    const sin = Math.sin(carHeading);
    const lx = this.offsetLocal.x;
    const ly = this.offsetLocal.y;
    const lz = this.offsetLocal.z;

    let wx = lx * cos + lz * sin;
    let wz = -lx * sin + lz * cos;
    let wy = ly;

    wx += wy * Math.sin(carRoll);
    wy *= Math.cos(carRoll) * Math.cos(carPitch);
    wz += wy * Math.sin(carPitch);

    this.ray.ray.origin.set(carPos.x + wx, carPos.y + wy, carPos.z + wz);
    this.ray.ray.direction.copy(this.rayDown);

    const hits = this.ray.intersectObjects(groundObjects, false);
    let compression = 0;
    if (hits.length > 0 && hits[0].distance <= this.rayLen) {
      this.isGrounded = true;
      this.hitDistance = hits[0].distance;
      this.hitPoint.copy(hits[0].point);
      compression = c.suspRestLength - (this.hitDistance - c.wheelRadius);
      if (compression < 0) compression = 0;
      const maxComp = c.suspRestLength + 0.12;
      if (compression > maxComp) compression = maxComp;
    } else {
      this.isGrounded = false;
      this.hitDistance = this.rayLen;
      compression = 0;
    }

    this.compressionSpeed = (compression - this.prevCompression) / dt;
    this.prevCompression = compression;
    this.compression = compression;

    let force = c.springRate * compression + c.damperRate * this.compressionSpeed;
    if (force < 0) force = 0;
    this.suspensionForce = force;
    this.normalLoad = this.isGrounded ? force : 0;

    if (this.isGrounded) {
      this.mesh.position.set(this.ray.ray.origin.x, this.hitPoint.y + c.wheelRadius, this.ray.ray.origin.z);
    } else {
      this.mesh.position.set(this.ray.ray.origin.x, this.ray.ray.origin.y - c.suspRestLength, this.ray.ray.origin.z);
    }

    this._updateDebug();
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
    // mu efetivo: grip degradation por temperatura (cold→0.85, optimal→1.0,
    // overheat→0.55). gripFactor() está em Tire.js para manter o modelo lá.
    const mu = c.mu * gripFactor(this.tireTemp);
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

    // ---- Pacejka Magic Formula + círculo de fricção (combined slip)
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
