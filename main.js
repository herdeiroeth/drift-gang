import * as THREE from 'three';

// ============================================================
// CONFIG ARCADE
// ============================================================
const CFG = {
  nitroMult: 1.5,
  nitroDuration: 2.5,
  nitroCooldown: 5,
  comboTime: 2,
  maxSkids: 800,
  arenaSize: 80,
};

// ============================================================
// CONFIG FISICA
// ============================================================
class CarConfig {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 9.81;
    this.mass = opts.mass ?? 1300.0;
    this.inertiaScale = opts.inertiaScale ?? 1.4;
    this.halfWidth = opts.halfWidth ?? 0.82;
    this.cgToFrontAxle = opts.cgToFrontAxle ?? 1.35;
    this.cgToRearAxle = opts.cgToRearAxle ?? 1.35;
    this.cgHeight = opts.cgHeight ?? 0.50;
    this.wheelRadius = opts.wheelRadius ?? 0.34;
    this.wheelWidth = opts.wheelWidth ?? 0.26;
    this.wheelMass = opts.wheelMass ?? 18.0;
    this.wheelInertia = 0.5 * this.wheelMass * this.wheelRadius * this.wheelRadius;

    this.mu = opts.mu ?? 1.05;
    this.cornerStiffnessFront = opts.cornerStiffnessFront ?? 5.8;
    this.cornerStiffnessRear = opts.cornerStiffnessRear ?? 5.2;
    this.maxSlipAngle = opts.maxSlipAngle ?? 0.55;

    this.idleRPM = opts.idleRPM ?? 900;
    this.maxRPM = opts.maxRPM ?? 7200;
    this.gearRatios = opts.gearRatios ?? [0, -2.9, 3.6, 2.2, 1.5, 1.1, 0.85, 0.65];
    this.diffRatio = opts.diffRatio ?? 3.8;
    this.transEfficiency = opts.transEfficiency ?? 0.82;

    this.brakeTorqueMax = opts.brakeTorqueMax ?? 3200.0;
    this.brakeBiasFront = opts.brakeBiasFront ?? 0.62;
    this.ebrakeTorque = opts.ebrakeTorque ?? 900.0;

    this.maxSteer = opts.maxSteer ?? 0.48;
    this.ackermannFactor = opts.ackermannFactor ?? 0.85;

    this.Cdrag = opts.Cdrag ?? 0.40;
    this.Crr = opts.Crr ?? 12.0;

    this.springRate = opts.springRate ?? 38000.0;
    this.damperRate = opts.damperRate ?? 2800.0;
    this.suspRestLength = opts.suspRestLength ?? 0.32;
    this.antiRollFront = opts.antiRollFront ?? 9000.0;
    this.antiRollRear = opts.antiRollRear ?? 7000.0;

    this.pitchDamp = opts.pitchDamp ?? 5.0;
    this.rollDamp = opts.rollDamp ?? 5.0;
    this.pitchStiff = opts.pitchStiff ?? 140.0;
    this.rollStiff = opts.rollStiff ?? 100.0;

    this.inertia = this.mass * this.inertiaScale;
    this.wheelBase = this.cgToFrontAxle + this.cgToRearAxle;
    this.axleWeightRatioFront = this.cgToRearAxle / this.wheelBase;
    this.axleWeightRatioRear = this.cgToFrontAxle / this.wheelBase;
    this.trackWidth = this.halfWidth * 2;
  }

  engineTorque(rpm) {
    const curve = [
      { r: 900,  t: 220 },
      { r: 1500, t: 310 },
      { r: 2500, t: 420 },
      { r: 3500, t: 480 },
      { r: 4500, t: 460 },
      { r: 5500, t: 430 },
      { r: 6500, t: 380 },
      { r: 7200, t: 320 },
    ];
    if (rpm <= curve[0].r) return curve[0].t;
    if (rpm >= curve[curve.length-1].r) return curve[curve.length-1].t;
    for (let i = 0; i < curve.length-1; i++) {
      if (rpm >= curve[i].r && rpm <= curve[i+1].r) {
        const f = (rpm - curve[i].r) / (curve[i+1].r - curve[i].r);
        return curve[i].t + f * (curve[i+1].t - curve[i].t);
      }
    }
    return 0;
  }
}

// ============================================================
// INPUT
// ============================================================
class Input {
  constructor() {
    this.keys = {};
    this.pressed = {};
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (!e.repeat) this.pressed[e.code] = true;
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }
  down(k) { return !!this.keys[k]; }
  once(k) { const v = this.pressed[k]; this.pressed[k] = false; return v; }
  clear() { this.pressed = {}; }
}

// ============================================================
// SMOKE PARTICLES
// ============================================================
class SmokeSystem {
  constructor(scene, max = 1200) {
    this.scene = scene;
    this.max = max;
    this.count = 0;
    this.geometry = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xbbbbbb, size: 0.6, transparent: true, opacity: 0.35,
      depthWrite: false, sizeAttenuation: true,
    });
    this.mesh = new THREE.Points(this.geometry, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  emit(p, intensity = 1) {
    const i = this.count % this.max;
    this.pos[i*3]   = p.x + (Math.random()-.5)*.3;
    this.pos[i*3+1] = p.y + (Math.random()-.5)*.1;
    this.pos[i*3+2] = p.z + (Math.random()-.5)*.3;
    this.vel[i*3]   = (Math.random()-.5)*1.5;
    this.vel[i*3+1] = Math.random()*1.5 + .5;
    this.vel[i*3+2] = (Math.random()-.5)*1.5;
    this.life[i] = 1.0;
    this.maxLife[i] = 0.4 + Math.random()*0.6;
    this.count++;
  }
  update(dt) {
    for (let i=0;i<this.max;i++) {
      if (this.life[i] > 0) {
        this.life[i] -= dt/this.maxLife[i];
        this.pos[i*3]   += this.vel[i*3]*dt;
        this.pos[i*3+1] += this.vel[i*3+1]*dt;
        this.pos[i*3+2] += this.vel[i*3+2]*dt;
        if (this.life[i] <= 0) { this.pos[i*3+1] = -9999; }
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

// ============================================================
// SKID MARKS
// ============================================================
class SkidSystem {
  constructor(scene, maxSeg = CFG.maxSkids) {
    this.scene = scene;
    this.max = maxSeg;
    this.cnt = 0;
    this.last = [null,null,null,null];
    this.geo = new THREE.BufferGeometry();
    this.v = new Float32Array(maxSeg*18);
    this.uv = new Float32Array(maxSeg*12);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.v,3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv,2));
    const mat = new THREE.MeshBasicMaterial({ color:0x151515, transparent:true, opacity:0.45, depthWrite:false });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  _sv(o,p){ this.v[o]=p.x; this.v[o+1]=p.y; this.v[o+2]=p.z; }
  add(i,p1,p2,p3,p4){
    const o=i*18;
    this._sv(o,p1); this._sv(o+3,p2); this._sv(o+6,p3);
    this._sv(o+9,p2); this._sv(o+12,p4); this._sv(o+15,p3);
    const uo=i*12;
    this.uv[uo]=0;this.uv[uo+1]=0;this.uv[uo+2]=1;this.uv[uo+3]=0;this.uv[uo+4]=0;this.uv[uo+5]=1;
    this.uv[uo+6]=1;this.uv[uo+7]=0;this.uv[uo+8]=1;this.uv[uo+9]=1;this.uv[uo+10]=0;this.uv[uo+11]=1;
    this.cnt++;
  }
  emit(idx, pos, fwd, w=0.22) {
    const r = new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).normalize().multiplyScalar(w*0.5);
    const a=pos.clone().add(r), b=pos.clone().sub(r);
    if(this.last[idx]){ const lp=this.last[idx]; this.add(this.cnt%this.max,lp.a,lp.b,a,b); }
    this.last[idx]={a,b};
  }
  clear(i){ this.last[i]=null; }
  update(){ this.geo.attributes.position.needsUpdate=true; this.geo.attributes.uv.needsUpdate=true; }
}

// ============================================================
// WHEEL — FISICA INDEPENDENTE
// ============================================================
class Wheel {
  constructor(scene, offsetLocal, isFront, cfg) {
    this.scene = scene;
    this.offsetLocal = offsetLocal.clone();
    this.isFront = isFront;
    this.cfg = cfg;

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

    this.steerAngle = 0;

    this.ray = new THREE.Raycaster();
    this.rayDown = new THREE.Vector3(0, -1, 0);
    this.rayLen = cfg.suspRestLength + cfg.wheelRadius + 0.6;

    // Grupo da roda (posicionado na cena) — rotação Y = steer
    this.mesh = new THREE.Group();
    this.mesh.position.copy(offsetLocal);
    this.mesh.position.y = offsetLocal.y - cfg.suspRestLength;
    scene.add(this.mesh);

    // Pneu — rotação X = spin
    const wr = cfg.wheelRadius;
    const ww = cfg.wheelWidth;
    const tireGeo = new THREE.CylinderGeometry(wr, wr, ww, 24, 1);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, metalness: 0.05 });
    this.tireMesh = new THREE.Mesh(tireGeo, tireMat);
    this.tireMesh.castShadow = true;
    this.mesh.add(this.tireMesh);

    // Aro
    const rimGeo = new THREE.CylinderGeometry(wr * 0.72, wr * 0.72, ww * 1.02, 16, 1);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.25, metalness: 0.85 });
    this.rimMesh = new THREE.Mesh(rimGeo, rimMat);
    this.tireMesh.add(this.rimMesh);

    // Debug ray
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

  updateTireForces(vxLocal, vyLocal, dt) {
    if (!this.isGrounded || this.normalLoad <= 0.01) {
      this.slipAngle = 0;
      this.slipRatio = 0;
      this.longitudinalForce = 0;
      this.lateralForce = 0;
      // No ar: roda acelera apenas pelo torque do motor
      const netTorque = this.driveTorque - this.brakeTorque * Math.sign(this.angularVelocity || 1);
      this.angularVelocity += (netTorque / this.cfg.wheelInertia) * dt;
      return;
    }
    const c = this.cfg;
    const mu = c.mu;
    const N = this.normalLoad;

    // Slip angle
    const vxAbs = Math.abs(vxLocal);
    const eps = 0.3;
    this.slipAngle = Math.atan2(vyLocal, Math.max(vxAbs, eps));
    if (this.isFront) {
      this.slipAngle -= Math.sign(vxLocal || 1) * this.steerAngle;
    }
    this.slipAngle = Math.max(-c.maxSlipAngle, Math.min(c.maxSlipAngle, this.slipAngle));

    // Slip ratio (informacional — não usado diretamente para força)
    const vWheel = this.angularVelocity * c.wheelRadius;
    if (vxAbs > eps) {
      this.slipRatio = (vWheel - vxLocal) / Math.max(Math.abs(vxLocal), eps);
    } else {
      this.slipRatio = (vWheel - vxLocal) * 2.0;
    }
    this.slipRatio = Math.max(-1.0, Math.min(1.0, this.slipRatio));

    // === FORÇA LATERAL (slip angle) ===
    const stiffness = this.isFront ? c.cornerStiffnessFront : c.cornerStiffnessRear;
    let F_lat = -stiffness * this.slipAngle * N;
    const F_lat_max = mu * N;
    F_lat = Math.max(-F_lat_max, Math.min(F_lat_max, F_lat));

    // === FORÇA LONGITUDINAL (torque limitado por aderência) ===
    // Força desejada pelo torque aplicado na roda
    let F_long_desired = this.driveTorque / c.wheelRadius;
    // Freio adiciona força de oposição
    if (Math.abs(vxLocal) > 0.1 || Math.abs(this.angularVelocity) > 0.1) {
      const brakeForce = this.brakeTorque / c.wheelRadius;
      const dir = Math.sign(vxLocal || this.angularVelocity || 1);
      F_long_desired -= brakeForce * dir;
    } else if (this.brakeTorque > 0.01) {
      // Parado com freio: não move
      F_long_desired = 0;
    }

    const F_long_max = mu * N;
    let F_long = Math.max(-F_long_max, Math.min(F_long_max, F_long_desired));

    // === CÍRCULO DE FRICÇÃO COMBINADO ===
    const F_combined = Math.sqrt(F_long*F_long + F_lat*F_lat);
    const F_max = mu * N;
    if (F_combined > F_max && F_combined > 0.001) {
      const scale = F_max / F_combined;
      F_long *= scale;
      F_lat *= scale;
    }

    this.lateralForce = F_lat;
    this.longitudinalForce = F_long;

    // === DINÂMICA ROTACIONAL DA RODA ===
    // A força real no contato gera um torque de reação
    const reactionTorque = this.longitudinalForce * c.wheelRadius;
    const netTorque = this.driveTorque - this.brakeTorque * Math.sign(this.angularVelocity || 1) - reactionTorque;
    const angularAccel = netTorque / c.wheelInertia;
    this.angularVelocity += angularAccel * dt;
    this.angularVelocity *= 0.9995;
  }

  setVisible(v) {
    this.mesh.visible = v;
    this.dbgLine.visible = v;
  }

  getWorldPosition() {
    return this.mesh.position.clone();
  }
}

// ============================================================
// CAR
// ============================================================
class Car {
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

    // Vetores direcionais: heading=0 → frente aponta +Z (Three.js padrão)
    this.forward = new THREE.Vector3(0,0,1);
    this.right = new THREE.Vector3(1,0,0);

    this.steer = 0;
    this.steerAngle = 0;

    this.gear = 2; // 1ª marcha (índice 2 no array)
    this.rpm = this.cfg.idleRPM;

    this.nitroT = 0;
    this.nitroCd = 0;
    this.resetPos = new THREE.Vector3(0, 1.0, 0);

    const c = this.cfg;
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

  wheelWorld(i){ return this.wheels[i].getWorldPosition(); }

  reset(){
    this.position.set(0, this.initialY, 0);
    this.velocity.set(0,0,0);
    this.velocityLocal.set(0,0,0);
    this.accel.set(0,0,0);
    this.accelLocal.set(0,0,0);
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
    for (const w of this.wheels) {
      w.angularVelocity = 0;
      w.driveTorque = 0;
      w.brakeTorque = 0;
      w.steerAngle = 0;
    }
    this.mesh.position.set(0, this.initialY, 0);
    this.mesh.rotation.set(0,0,0);
  }

  applySmoothSteer(steerInput, dt) {
    if (Math.abs(steerInput) > 0.001) {
      const s = this.steer + steerInput * dt * 2.8;
      return Math.max(-1.0, Math.min(1.0, s));
    } else {
      if (this.steer > 0) return Math.max(this.steer - dt * 2.0, 0);
      if (this.steer < 0) return Math.min(this.steer + dt * 2.0, 0);
      return 0;
    }
  }

  applySafeSteer(steerInput) {
    const avel = Math.min(this.absVel, 250.0);
    return steerInput * (1.0 - (avel / 290.0));
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

  currentGearRatio() {
    return this.cfg.gearRatios[this.gear] ?? 0;
  }

  // Sub-stepping para estabilidade
  doPhysics(dt, throttleInput, brakeInput, steerInput, ebrakeInput) {
    const steps = 4;
    const sdt = dt / steps;
    const c = this.cfg;
    let wheelData = [];

    for (let step = 0; step < steps; step++) {
      const sn = Math.sin(this.heading);
      const cs = Math.cos(this.heading);

      // Vetores: heading=0 → forward=(0,0,1), right=(1,0,0)
      this.forward.set(sn, 0, cs);
      this.right.set(cs, 0, -sn);

      this.velocityLocal.x = this.forward.dot(this.velocity);
      this.velocityLocal.z = this.right.dot(this.velocity);
      this.velocityLocal.y = 0;

      // Suspensão
      for (const w of this.wheels) {
        w.updateSuspension(sdt, this.position, this.heading, this.pitch, this.roll, this.groundObjects);
      }

      const fl = this.wheels[0], fr = this.wheels[1], rl = this.wheels[2], rr = this.wheels[3];

      // Vertical
      const totalSusp = fl.suspensionForce + fr.suspensionForce + rl.suspensionForce + rr.suspensionForce;
      const vAccel = (totalSusp - c.mass * c.gravity) / c.mass;
      this.velocity.y += vAccel * sdt;
      this.position.y += this.velocity.y * sdt;

      // Anti-roll
      const frontRoll = c.antiRollFront * (fl.compression - fr.compression);
      const rearRoll  = c.antiRollRear  * (rl.compression - rr.compression);
      fl.normalLoad = Math.max(0, fl.suspensionForce - frontRoll * 0.5);
      fr.normalLoad = Math.max(0, fr.suspensionForce + frontRoll * 0.5);
      rl.normalLoad = Math.max(0, rl.suspensionForce - rearRoll * 0.5);
      rr.normalLoad = Math.max(0, rr.suspensionForce + rearRoll * 0.5);

      // Ackermann
      const rawSteer = this.steer * c.maxSteer;
      if (this.steer >= 0) {
        fl.steerAngle = rawSteer;
        fr.steerAngle = this.ackermann(rawSteer) * c.ackermannFactor;
      } else {
        fr.steerAngle = rawSteer;
        fl.steerAngle = this.ackermann(rawSteer) * c.ackermannFactor;
      }
      rl.steerAngle = 0;
      rr.steerAngle = 0;

      // RPM e drive torque
      const avgRearWheelSpeed = (Math.abs(rl.angularVelocity) + Math.abs(rr.angularVelocity)) * 0.5;
      const driveShaftRPM = avgRearWheelSpeed * Math.abs(this.currentGearRatio()) * c.diffRatio * (60 / (2 * Math.PI));
      let targetRPM = driveShaftRPM;
      if (targetRPM < c.idleRPM) targetRPM = c.idleRPM;
      if (targetRPM > c.maxRPM) targetRPM = c.maxRPM;
      this.rpm += (targetRPM - this.rpm) * Math.min(1.0, 10.0 * sdt);

      const engineTorque = throttleInput > 0.01 ? throttleInput * c.engineTorque(this.rpm) : 0;
      const gearRatio = this.currentGearRatio();
      let driveTorquePerWheel = 0;
      if (Math.abs(gearRatio) > 0.01 && this.gear !== 0) {
        const totalDriveTorque = engineTorque * gearRatio * c.diffRatio * c.transEfficiency;
        driveTorquePerWheel = totalDriveTorque * 0.5;
      }
      rl.driveTorque = driveTorquePerWheel;
      rr.driveTorque = driveTorquePerWheel;
      fl.driveTorque = 0;
      fr.driveTorque = 0;

      // Freios
      const totalBrake = brakeInput * c.brakeTorqueMax;
      const frontBrake = totalBrake * c.brakeBiasFront;
      const rearBrake  = totalBrake * (1.0 - c.brakeBiasFront);
      const eBrakeRear = ebrakeInput * c.ebrakeTorque;

      fl.brakeTorque = frontBrake * 0.5;
      fr.brakeTorque = frontBrake * 0.5;
      rl.brakeTorque = rearBrake * 0.5 + eBrakeRear * 0.5;
      rr.brakeTorque = rearBrake * 0.5 + eBrakeRear * 0.5;

      // Velocidade local do ponto de contato
      const getContactVel = (w) => {
        const r = w.mesh.position.clone().sub(this.position);
        const omegaCrossR = new THREE.Vector3(-this.yawRate * r.z, 0, this.yawRate * r.x);
        const vWorld = this.velocity.clone().add(omegaCrossR);
        const vx = this.forward.dot(vWorld);
        const vy = this.right.dot(vWorld);
        return { vx, vy };
      };

      // Forças de pneu
      let totalFx = 0, totalFz = 0, yawTorque = 0;
      wheelData = [];

      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i];
        const vel = getContactVel(w);
        w.updateTireForces(vel.vx, vel.vy, sdt);

        // Converter forças da roda (local à roda) para local ao carro
        const cosS = Math.cos(w.steerAngle);
        const sinS = Math.sin(w.steerAngle);
        let fx = w.longitudinalForce * cosS - w.lateralForce * sinS;
        let fz = w.longitudinalForce * sinS + w.lateralForce * cosS;

        // Rolling resistance (simples, proporcional à carga)
        const rrDir = Math.sign(vel.vx) || (Math.sign(w.angularVelocity) || 0);
        if (Math.abs(vel.vx) > 0.1) {
          const Frr = -c.Crr * 0.015 * w.normalLoad * Math.sign(vel.vx);
          fx += Frr;
        }

        totalFx += fx;
        totalFz += fz;

        const r = w.mesh.position.clone().sub(this.position);
        yawTorque += fz * r.z - fx * r.x;

        wheelData.push({
          slipAngle: w.slipAngle,
          slipRatio: w.slipRatio,
          normalLoad: w.normalLoad,
          fx, fz,
          angularVel: w.angularVelocity,
        });
      }

      // Arrasto de ar
      const airDragX = -c.Cdrag * this.velocityLocal.x * Math.abs(this.velocityLocal.x);
      const airDragZ = -c.Cdrag * this.velocityLocal.z * Math.abs(this.velocityLocal.z);
      totalFx += airDragX;
      totalFz += airDragZ;

      // Aceleração
      this.accelLocal.x = totalFx / c.mass;
      this.accelLocal.z = totalFz / c.mass;

      this.accel.copy(this.forward).multiplyScalar(this.accelLocal.x)
                .add(this.right.clone().multiplyScalar(this.accelLocal.z));

      this.velocity.x += this.accel.x * sdt;
      this.velocity.z += this.accel.z * sdt;
      this.absVel = Math.sqrt(this.velocity.x**2 + this.velocity.z**2);

      // Estabilidade em baixa velocidade
      if (this.absVel < 0.3 && throttleInput < 0.01 && brakeInput < 0.01) {
        this.velocity.set(0,0,0);
        this.absVel = 0;
        this.yawRate = 0;
        for (const w of this.wheels) w.angularVelocity *= 0.9;
      }

      // Yaw
      const angularAccel = yawTorque / c.inertia;
      this.yawRate += angularAccel * sdt;
      this.yawRate *= 0.998;
      this.heading += this.yawRate * sdt;

      // Posição
      this.position.x += this.velocity.x * sdt;
      this.position.z += this.velocity.z * sdt;

      // Pitch / roll
      const targetPitch = this.accelLocal.x * 0.022;
      const targetRoll  = -this.accelLocal.z * 0.018;
      this.pitchVel += ((targetPitch - this.pitch) * c.pitchStiff - this.pitchVel * c.pitchDamp) * sdt;
      this.rollVel  += ((targetRoll  - this.roll)  * c.rollStiff  - this.rollVel  * c.rollDamp)  * sdt;
      this.pitch += this.pitchVel * sdt;
      this.roll  += this.rollVel * sdt;

      this.mesh.position.copy(this.position);
      this.mesh.rotation.set(this.pitch, this.heading, -this.roll);
    }

    return { wheelData, rpm: this.rpm, gear: this.gear };
  }

  update(dt, input, smoke, skids) {
    const gas = (input.down('KeyW') || input.down('ArrowUp')) ? 1 : 0;
    const brk = (input.down('KeyS') || input.down('ArrowDown')) ? 1 : 0;
    let steerRaw = 0;
    if (input.down('KeyA') || input.down('ArrowLeft')) steerRaw += 1;
    if (input.down('KeyD') || input.down('ArrowRight')) steerRaw -= 1;
    const hb = input.down('ShiftLeft') || input.down('ShiftRight') ? 1 : 0;

    if (input.once('KeyQ')) this.shiftDown();
    if (input.once('KeyE')) this.shiftUp();

    if (input.once('Space') && this.nitroCd <= 0) {
      this.nitroT = CFG.nitroDuration;
      this.nitroCd = CFG.nitroCooldown + CFG.nitroDuration;
    }
    if (this.nitroT > 0) this.nitroT -= dt;
    if (this.nitroCd > 0) this.nitroCd -= dt;
    const nitroMult = this.nitroT > 0 ? CFG.nitroMult : 1;

    this.steer = this.applySmoothSteer(steerRaw, dt);
    this.steer = this.applySafeSteer(this.steer);

    const throttleInput = gas * nitroMult;
    const phys = this.doPhysics(dt, throttleInput, brk, steerRaw, hb);

    // Visual das rodas: steer angle somado ao heading do carro
    for (const w of this.wheels) {
      w.mesh.rotation.set(this.pitch, this.heading + w.steerAngle, -this.roll, 'YXZ');
      w.tireMesh.rotation.x += w.angularVelocity * dt;
    }

    const rearSlip = (Math.abs(phys.wheelData[2].slipAngle) + Math.abs(phys.wheelData[3].slipAngle)) * 0.5;
    const isDrifting = rearSlip > 0.28 && Math.abs(this.velocityLocal.x) > 3.5;
    const slipIntensity = Math.max(rearSlip, (Math.abs(phys.wheelData[0].slipAngle)+Math.abs(phys.wheelData[1].slipAngle))*0.5);

    if (slipIntensity > 0.12) {
      [2,3].forEach(i => {
        const p = this.wheelWorld(i);
        p.y = 0.08;
        smoke.emit(p, slipIntensity * 2.5);
      });
    }

    if (isDrifting || (hb > 0.5 && Math.abs(this.velocityLocal.x) > 2)) {
      [0,1,2,3].forEach(i => {
        const p = this.wheelWorld(i);
        p.y = 0.04;
        skids.emit(i, p, this.forward, 0.18);
      });
    } else {
      [0,1,2,3].forEach(i => skids.clear(i));
    }

    const limit = CFG.arenaSize + 2;
    if (Math.abs(this.position.x) > limit) {
      this.position.x = Math.sign(this.position.x) * limit;
      this.velocity.x *= -0.3;
    }
    if (Math.abs(this.position.z) > limit) {
      this.position.z = Math.sign(this.position.z) * limit;
      this.velocity.z *= -0.3;
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
    };
  }

  shiftUp() { if (this.gear < this.cfg.gearRatios.length - 1) this.gear++; }
  shiftDown() { if (this.gear > 1) this.gear--; }
}

// ============================================================
// CAMERA
// ============================================================
class CamCtrl {
  constructor(cam){
    this.cam=cam; this.mode='chase'; this.orb=0;
  }
  next(){ this.mode={chase:'hood',hood:'orbital',orbital:'chase'}[this.mode]; }
  update(dt,pos,heading,spd){
    if(this.mode==='chase'){
      const off=new THREE.Vector3(0,3.8,-8.5); off.applyAxisAngle(new THREE.Vector3(0,1,0),heading);
      this.cam.position.lerp(pos.clone().add(off), Math.min(1,4.5*dt));
      this.cam.lookAt(pos.clone().add(new THREE.Vector3(0,1.4,0)));
    }else if(this.mode==='hood'){
      const off=new THREE.Vector3(0,1.4,0.5); off.applyAxisAngle(new THREE.Vector3(0,1,0),heading);
      this.cam.position.copy(pos).add(off);
      const t=pos.clone().add(new THREE.Vector3(Math.sin(heading),0,Math.cos(heading)).multiplyScalar(25));
      this.cam.lookAt(t);
    }else{
      this.orb+=dt*0.25;
      const r=16;
      this.cam.position.set(pos.x+Math.cos(this.orb)*r, pos.y+8, pos.z+Math.sin(this.orb)*r);
      this.cam.lookAt(pos);
    }
    if(spd>26){
      const sh=(spd-26)*0.001;
      this.cam.position.x+=(Math.random()-.5)*sh; this.cam.position.y+=(Math.random()-.5)*sh;
    }
  }
}

// ============================================================
// ARENA COM TEXTURA
// ============================================================
function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2a32';
  ctx.fillRect(0,0,512,512);
  for (let i=0;i<40000;i++) {
    const x = Math.random()*512;
    const y = Math.random()*512;
    const v = 30 + Math.random()*30;
    ctx.fillStyle = `rgba(${v},${v},${v+5},${0.15+Math.random()*0.15})`;
    ctx.fillRect(x,y,1+Math.random()*2,1+Math.random()*2);
  }
  for (let i=0;i<20;i++) {
    const x = Math.random()*512;
    ctx.fillStyle = 'rgba(20,20,25,0.08)';
    ctx.fillRect(x,0,2+Math.random()*4,512);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20);
  return tex;
}

function buildArena(scene){
  const asphaltTex = createAsphaltTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    map: asphaltTex, roughness: 0.92, metalness: 0.05, color: 0x888888
  });
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(180,180), floorMat);
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);

  const grid=new THREE.GridHelper(180,90,0xff2a6d,0x555566);
  grid.position.y=0.03; scene.add(grid);

  const bmat=new THREE.MeshStandardMaterial({color:0xff3333,roughness:0.5});
  const b1=new THREE.Mesh(new THREE.BoxGeometry(180,1.6,1.4),bmat); b1.position.set(0,0.8,90); scene.add(b1);
  const b2=new THREE.Mesh(new THREE.BoxGeometry(180,1.6,1.4),bmat); b2.position.set(0,0.8,-90); scene.add(b2);
  const b3=new THREE.Mesh(new THREE.BoxGeometry(1.4,1.6,180),bmat); b3.position.set(90,0.8,0); scene.add(b3);
  const b4=new THREE.Mesh(new THREE.BoxGeometry(1.4,1.6,180),bmat); b4.position.set(-90,0.8,0); scene.add(b4);

  const coneGeo=new THREE.ConeGeometry(0.4,1.0,8);
  const coneMat=new THREE.MeshStandardMaterial({color:0xffaa00});
  for(let i=0;i<50;i++){
    const c=new THREE.Mesh(coneGeo,coneMat);
    c.position.set((Math.random()-.5)*160,0.5,(Math.random()-.5)*160);
    c.castShadow=true; scene.add(c);
  }

  const boxMat=new THREE.MeshStandardMaterial({color:0x00d4aa});
  for(let i=0;i<12;i++){
    const b=new THREE.Mesh(new THREE.BoxGeometry(1.5+Math.random()*2.5,1.5+Math.random()*2.5,1.5+Math.random()*2.5), boxMat);
    b.position.set((Math.random()-.5)*100, 1, (Math.random()-.5)*100);
    b.castShadow=true; scene.add(b);
  }

  const rampMat = new THREE.MeshStandardMaterial({ color:0x8844ff });
  const ramps = [];
  for(let i=0;i<4;i++){
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.5,0.3,7), rampMat);
    ramp.position.set((Math.random()-.5)*70, 0.3, (Math.random()-.5)*70);
    ramp.rotation.z = (Math.random()-.5)*0.3;
    ramp.rotation.x = -0.15;
    ramp.receiveShadow = true;
    scene.add(ramp);
    ramps.push(ramp);
  }

  return [floor, ...ramps];
}

// ============================================================
// ENVIRONMENT
// ============================================================
function setupEnv(scene){
  scene.fog=new THREE.Fog(0x1a0b2e, 40, 160);
  const vs=`varying vec3 vWorldPosition; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorldPosition=w.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const fs=`varying vec3 vWorldPosition; void main(){ vec3 top=vec3(0.06,0.02,0.15); vec3 bottom=vec3(0.95,0.35,0.45); float h=normalize(vWorldPosition).y; vec3 col=mix(bottom,top,max(0.0,h*0.5+0.5)); gl_FragColor=vec4(col,1.0); }`;
  const sky=new THREE.Mesh(new THREE.SphereGeometry(250,32,32), new THREE.ShaderMaterial({vertexShader:vs,fragmentShader:fs,side:THREE.BackSide}));
  scene.add(sky);
}

// ============================================================
// GAME
// ============================================================
class Game {
  constructor(){
    this.canvas=document.getElementById('game-canvas');
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true});
    this.renderer.setSize(window.innerWidth,window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;

    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 600);

    this.input=new Input();
    this.smoke=new SmokeSystem(this.scene);
    this.skids=new SkidSystem(this.scene);

    setupEnv(this.scene);
    this.groundObjects = buildArena(this.scene);
    this.car=new Car(this.scene, this.groundObjects);
    this.camCtrl=new CamCtrl(this.camera);

    this.setupLights();

    this.state='start';
    this.driftScore=0; this.totalScore=0; this.combo=1;
    this.driftTimer=0; this.inDrift=false;

    this.bindUI(); this.bindResize();
    this.lastTime=performance.now();
    window.__game = this;
    requestAnimationFrame(t=>this.loop(t));
  }
  setupLights(){
    this.scene.add(new THREE.HemisphereLight(0xffaaee,0x222233,0.5));
    const dir=new THREE.DirectionalLight(0xffffff,1.2);
    dir.position.set(40,80,30);
    dir.castShadow=true;
    dir.shadow.mapSize.set(2048,2048);
    dir.shadow.camera.near=0.5; dir.shadow.camera.far=200;
    dir.shadow.camera.left=-100; dir.shadow.camera.right=100;
    dir.shadow.camera.top=100; dir.shadow.camera.bottom=-100;
    this.scene.add(dir);
  }
  bindUI(){
    this.ui={
      start:document.getElementById('start-screen'),
      hud:document.getElementById('hud'),
      speed:document.getElementById('speed-val'),
      drift:document.getElementById('drift-score'),
      combo:document.getElementById('combo'),
      total:document.getElementById('total-score'),
    };
    if (!this.ui.rpm) {
      const rpmDiv = document.createElement('div');
      rpmDiv.id = 'rpm-val';
      rpmDiv.style.cssText = 'position:absolute;bottom:80px;left:20px;font-size:18px;color:#ff2a6d;font-weight:bold;';
      document.body.appendChild(rpmDiv);
      this.ui.rpm = rpmDiv;
    }
    if (!this.ui.gear) {
      const gearDiv = document.createElement('div');
      gearDiv.id = 'gear-val';
      gearDiv.style.cssText = 'position:absolute;bottom:110px;left:20px;font-size:28px;color:#fff;font-weight:bold;';
      document.body.appendChild(gearDiv);
      this.ui.gear = gearDiv;
    }
    if (!this.ui.telem) {
      const telemDiv = document.createElement('div');
      telemDiv.id = 'telem-text';
      telemDiv.style.cssText = 'position:absolute;top:80px;right:20px;font-size:11px;color:#aaa;font-family:monospace;text-align:right;white-space:pre;';
      document.body.appendChild(telemDiv);
      this.ui.telem = telemDiv;
    }
  }
  bindResize(){
    window.addEventListener('resize',()=>{
      this.camera.aspect=window.innerWidth/window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth,window.innerHeight);
    });
  }
  start(){
    this.state='playing';
    this.ui.start.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.car.reset();
  }
  updateHUD(telem,dt){
    const kmh=Math.abs(telem.forwardSpeed)*3.6;
    this.ui.speed.textContent=Math.round(kmh);
    if(this.ui.rpm) this.ui.rpm.textContent = Math.round(telem.rpm) + ' RPM';
    if(this.ui.gear) {
      const g = telem.gear;
      this.ui.gear.textContent = g === 1 ? 'R' : (g === 0 ? 'N' : (g-1) + '\u00aa');
    }
    if(this.ui.telem && this.state==='playing') {
      const wd = telem.wheelData;
      const slipStr = wd ?
        `FL sa:${(wd[0]?.slipAngle*57.3).toFixed(1)}\u00b0 sr:${(wd[0]?.slipRatio).toFixed(2)}\n` +
        `FR sa:${(wd[1]?.slipAngle*57.3).toFixed(1)}\u00b0 sr:${(wd[1]?.slipRatio).toFixed(2)}\n` +
        `RL sa:${(wd[2]?.slipAngle*57.3).toFixed(1)}\u00b0 sr:${(wd[2]?.slipRatio).toFixed(2)}\n` +
        `RR sa:${(wd[3]?.slipAngle*57.3).toFixed(1)}\u00b0 sr:${(wd[3]?.slipRatio).toFixed(2)}`
        : '';
      this.ui.telem.textContent = slipStr;
    }
    if(telem.isDrifting){
      if(!this.inDrift){ this.inDrift=true; this.driftTimer=0; }
      this.driftTimer+=dt;
      if(this.driftTimer>CFG.comboTime){
        this.combo=Math.min(4,this.combo+1);
        this.driftTimer=0;
      }
      const ad=(telem.driftAngle*180/Math.PI)*Math.abs(telem.forwardSpeed)*dt*this.combo;
      this.driftScore+=ad; this.totalScore+=ad;
      this.ui.drift.textContent=Math.floor(this.driftScore);
      this.ui.drift.classList.add('active');
      this.ui.combo.textContent=this.combo+'x';
      this.ui.combo.classList.add('active');
    }else{
      this.inDrift=false; this.driftTimer=0; this.combo=1; this.driftScore=0;
      this.ui.drift.classList.remove('active');
      this.ui.combo.classList.remove('active');
    }
    this.ui.total.textContent=Math.floor(this.totalScore);
  }
  loop(time){
    requestAnimationFrame(t=>this.loop(t));
    const dt=Math.min((time-this.lastTime)/1000,0.05);
    this.lastTime=time;

    if(this.state==='start'){
      this.camCtrl.update(dt, this.car.position, this.car.heading, 0);
      this.renderer.render(this.scene,this.camera);
      if(this.input.once('Space')) this.start();
      this.input.clear();
      return;
    }

    if(this.input.once('KeyC')) this.camCtrl.next();
    if(this.input.once('KeyR')){ this.car.reset(); this.totalScore=0; this.combo=1; }

    const telem=this.car.update(dt,this.input,this.smoke,this.skids);
    this.smoke.update(dt);
    this.skids.update();
    this.camCtrl.update(dt,this.car.position,this.car.heading,telem.speed);
    this.updateHUD(telem,dt);
    this.renderer.render(this.scene,this.camera);
    this.input.clear();
  }
}

new Game();
