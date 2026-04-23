import * as THREE from 'three';

// ============================================================
// CONFIG ARCADE (valores de gameplay)
// ============================================================
const CFG = {
  nitroMult: 1.7,
  nitroDuration: 2,
  nitroCooldown: 5,
  comboTime: 2,
  maxSkids: 600,
  arenaSize: 60,
};

// ============================================================
// CONFIG FISICA (modelo Marco Monster adaptado)
// ============================================================
class CarConfig {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 9.81;
    this.mass = opts.mass ?? 1200.0;
    this.inertiaScale = opts.inertiaScale ?? 1.5;
    this.halfWidth = opts.halfWidth ?? 0.8;
    this.cgToFront = opts.cgToFront ?? 2.0;
    this.cgToRear = opts.cgToRear ?? 2.0;
    this.cgToFrontAxle = opts.cgToFrontAxle ?? 1.25;
    this.cgToRearAxle = opts.cgToRearAxle ?? 1.25;
    this.cgHeight = opts.cgHeight ?? 0.55;
    this.wheelRadius = opts.wheelRadius ?? 0.3;
    this.tireGrip = opts.tireGrip ?? 2.0;
    this.lockGrip = opts.lockGrip ?? 0.82;
    this.engineForce = opts.engineForce ?? 8000.0;
    this.frictionCoeff = opts.frictionCoeff ?? 2.5;        // μ do pneu (drift/agressivo)
    this.weightTransfer = opts.weightTransfer ?? 0.2;
    this.maxSteer = opts.maxSteer ?? 0.45;
    this.cornerStiffnessFront = opts.cornerStiffnessFront ?? 5.5;
    this.cornerStiffnessRear = opts.cornerStiffnessRear ?? 3.0;
    this.airResist = opts.airResist ?? 2.5;
    this.rollingResistanceCoeff = opts.rollingResistanceCoeff ?? 0.012; // Crr adimensional

    // Suspensao
    this.springRate = opts.springRate ?? 35000.0;
    this.damperRate = opts.damperRate ?? 2500.0;
    this.suspRestLength = opts.suspRestLength ?? 0.35;
    this.antiRollFront = opts.antiRollFront ?? 8000.0;
    this.antiRollRear = opts.antiRollRear ?? 6000.0;

    // Pitch/roll damping visual
    this.pitchDamp = opts.pitchDamp ?? 4.0;
    this.rollDamp = opts.rollDamp ?? 4.0;
    this.pitchStiff = opts.pitchStiff ?? 120.0;
    this.rollStiff = opts.rollStiff ?? 80.0;

    // Derivados
    this.inertia = this.mass * this.inertiaScale;
    this.wheelBase = this.cgToFrontAxle + this.cgToRearAxle;
    this.axleWeightRatioFront = this.cgToRearAxle / this.wheelBase;
    this.axleWeightRatioRear = this.cgToFrontAxle / this.wheelBase;
    this.trackWidth = this.halfWidth * 2;
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
  constructor(scene, max = 800) {
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
      color: 0xbbbbbb, size: 0.55, transparent: true, opacity: 0.35,
      depthWrite: false, sizeAttenuation: true,
    });
    this.mesh = new THREE.Points(this.geometry, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  emit(p, intensity = 1) {
    const i = this.count % this.max;
    this.pos[i*3]   = p.x + (Math.random()-.5)*.25;
    this.pos[i*3+1] = p.y + (Math.random()-.5)*.1;
    this.pos[i*3+2] = p.z + (Math.random()-.5)*.25;
    this.vel[i*3]   = (Math.random()-.5)*1.2;
    this.vel[i*3+1] = Math.random()*1.2 + .4;
    this.vel[i*3+2] = (Math.random()-.5)*1.2;
    this.life[i] = 1.0;
    this.maxLife[i] = 0.4 + Math.random()*0.5;
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
    const mat = new THREE.MeshBasicMaterial({ color:0x151515, transparent:true, opacity:0.5, depthWrite:false });
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
  emit(idx, pos, fwd, w=0.2) {
    const r = new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).normalize().multiplyScalar(w*0.5);
    const a=pos.clone().add(r), b=pos.clone().sub(r);
    if(this.last[idx]){ const lp=this.last[idx]; this.add(this.cnt%this.max,lp.a,lp.b,a,b); }
    this.last[idx]={a,b};
  }
  clear(i){ this.last[i]=null; }
  update(){ this.geo.attributes.position.needsUpdate=true; this.geo.attributes.uv.needsUpdate=true; }
}

// ============================================================
// WHEEL — SUSPENSAO INDEPENDENTE POR RODA
// ============================================================
class Wheel {
  constructor(scene, offsetLocal, isFront, cfg) {
    this.scene = scene;
    this.offsetLocal = offsetLocal.clone(); // posicao relativa ao CG do carro
    this.isFront = isFront;
    this.cfg = cfg;

    // Estado de suspensao
    this.compression = 0;
    this.prevCompression = 0;
    this.compressionSpeed = 0;
    this.suspensionForce = 0;
    this.isGrounded = false;
    this.hitDistance = 0;
    this.hitPoint = new THREE.Vector3();
    this.worldPos = new THREE.Vector3();

    // Raycast
    this.ray = new THREE.Raycaster();
    this.rayDown = new THREE.Vector3(0, -1, 0);
    this.rayLen = cfg.suspRestLength + cfg.wheelRadius + 0.5;

    // Visual da roda
    const wg = new THREE.BoxGeometry(0.32, 0.58, 0.58);
    const wm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    this.mesh = new THREE.Mesh(wg, wm);
    this.mesh.castShadow = true;
    this.mesh.position.copy(offsetLocal);
    // Ajustar altura visual para base da roda tocar no chao quando suspensao livre
    this.mesh.position.y = offsetLocal.y - cfg.suspRestLength;
    scene.add(this.mesh);

    // Debug: linha do raycast
    this.dbgLineGeo = new THREE.BufferGeometry();
    this.dbgLinePos = new Float32Array(6);
    this.dbgLineGeo.setAttribute('position', new THREE.BufferAttribute(this.dbgLinePos, 3));
    this.dbgLine = new THREE.Line(this.dbgLineGeo, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    this.dbgLine.frustumCulled = false;
    scene.add(this.dbgLine);

    // Debug: barra de compressao
    this.dbgBarGeo = new THREE.BoxGeometry(0.06, 1, 0.06);
    this.dbgBar = new THREE.Mesh(this.dbgBarGeo, new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 }));
    this.dbgBar.frustumCulled = false;
    scene.add(this.dbgBar);
  }

  update(dt, carPos, carHeading, carPitch, carRoll, groundObjects) {
    const c = this.cfg;

    // 1. Calcular posicao do raycast no mundo
    const cos = Math.cos(carHeading);
    const sin = Math.sin(carHeading);
    // Rotacao local Y (heading) + pitch/roll simplificado
    const lx = this.offsetLocal.x;
    const ly = this.offsetLocal.y;
    const lz = this.offsetLocal.z;

    // Rotacao heading
    let wx = lx * cos + lz * sin;
    let wz = -lx * sin + lz * cos;
    let wy = ly;

    // Aplicar pitch/roll leve para posicao do ray
    wx += wy * Math.sin(carRoll);
    wy *= Math.cos(carRoll) * Math.cos(carPitch);
    wz += wy * Math.sin(carPitch);

    this.ray.ray.origin.set(carPos.x + wx, carPos.y + wy, carPos.z + wz);
    this.ray.ray.direction.copy(this.rayDown);

    // 2. Raycast
    const hits = this.ray.intersectObjects(groundObjects, false);
    let compression = 0;
    if (hits.length > 0 && hits[0].distance <= this.rayLen) {
      this.isGrounded = true;
      this.hitDistance = hits[0].distance;
      this.hitPoint.copy(hits[0].point);
      // compression = quanto a mola esta comprimida
      // Quando hitDistance = restLength + wheelRadius (roda tocando chao, mola livre): compression = 0
      // Quando hitDistance < restLength + wheelRadius (chao mais proximo): compression > 0
      compression = c.suspRestLength - (this.hitDistance - c.wheelRadius);
      if (compression < 0) compression = 0;
      // Clamp para nao passar do maximo
      const maxComp = c.suspRestLength + 0.1;
      if (compression > maxComp) compression = maxComp;
    } else {
      this.isGrounded = false;
      this.hitDistance = this.rayLen;
      compression = 0;
    }

    // 3. Velocidade de compressao
    this.compressionSpeed = (compression - this.prevCompression) / dt;
    this.prevCompression = compression;
    this.compression = compression;

    // 4. Forca de suspensao = mola + amortecedor
    let force = c.springRate * compression + c.damperRate * this.compressionSpeed;
    // Clamp: mola so empurra (nao puxa para baixo)
    if (force < 0) force = 0;
    this.suspensionForce = force;

    // 5. Carga no pneu = forca de suspensao (Newton)
    // Para grip usamos em Newton diretamente (antes usavamos kg * g)
    this.tireLoad = this.isGrounded ? force : 0;

    // 6. Atualizar posicao visual da roda
    // A roda visual fica no hitPoint (tocando o chao) ou pendurada no ar
    if (this.isGrounded) {
      this.mesh.position.set(
        this.ray.ray.origin.x,
        this.hitPoint.y + c.wheelRadius,
        this.ray.ray.origin.z
      );
    } else {
      // No ar: posicao de suspensao totalmente estendida
      this.mesh.position.set(
        this.ray.ray.origin.x,
        this.ray.ray.origin.y - c.suspRestLength,
        this.ray.ray.origin.z
      );
    }

    // 7. Debug visual
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

    // Barra de compressao
    this.dbgBar.position.set(o.x + 0.3, o.y - this.compression * 0.5, o.z);
    this.dbgBar.scale.y = this.compression;
    this.dbgBar.visible = this.compression > 0.01;
  }

  setVisible(v) {
    this.mesh.visible = v;
    this.dbgLine.visible = v;
    this.dbgBar.visible = v;
  }
}

// ============================================================
// CAR — FISICA MARCO MONSTER + SUSPENSAO INDEPENDENTE
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

    // Estado fisico
    this.position = new THREE.Vector3(0, this.initialY, 0);
    this.velocity = new THREE.Vector3();
    this.velocityLocal = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.accelLocal = new THREE.Vector3();
    this.heading = 0;
    this.yawRate = 0;
    this.absVel = 0;

    // Pitch e roll (rad) — inclinacao do chassis
    this.pitch = 0;
    this.roll = 0;
    this.pitchVel = 0;
    this.rollVel = 0;

    // Vetores de direcao
    this.forward = new THREE.Vector3(0,0,1);
    this.right = new THREE.Vector3(1,0,0);

    // Steering
    this.steer = 0;
    this.steerAngle = 0;

    // Gameplay
    this.nitroT = 0;
    this.nitroCd = 0;
    this.resetPos = new THREE.Vector3(0, this.initialY, 0);

    // Rodas fisicas (independentes)
    const c = this.cfg;
    const hw = c.halfWidth;
    const fAxle = c.cgToFrontAxle;
    const rAxle = -c.cgToRearAxle;
    const attachY = 0.05; // attachment point ligeiramente acima do CG

    this.wheels = [
      new Wheel(scene, new THREE.Vector3(-hw, attachY, fAxle), true, c),   // FL
      new Wheel(scene, new THREE.Vector3( hw, attachY, fAxle), true, c),   // FR
      new Wheel(scene, new THREE.Vector3(-hw, attachY, rAxle), false, c),  // RL
      new Wheel(scene, new THREE.Vector3( hw, attachY, rAxle), false, c),  // RR
    ];

    // Calcular altura inicial do CG para que as rodas toquem o chao com compressao estatica
    const staticCompression = (c.mass * c.gravity / 4) / c.springRate;
    this.initialY = c.suspRestLength - staticCompression + c.wheelRadius - attachY;
    this.position.y = this.initialY;
    this.resetPos.y = this.initialY;
  }

  buildVisuals() {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.6,0.5,3.2),
      new THREE.MeshStandardMaterial({ color:0xff2a6d, roughness:0.3, metalness:0.2 })
    );
    body.position.y=0.45; body.castShadow=true; this.mesh.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.2,0.38,1.4),
      new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.2, metalness:0.5 })
    );
    cabin.position.set(0,0.88,-0.2); cabin.castShadow=true; this.mesh.add(cabin);

    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(1.5,0.08,0.5),
      new THREE.MeshStandardMaterial({ color:0x111111 })
    );
    spoiler.position.set(0,0.78,-1.4); spoiler.castShadow=true; this.mesh.add(spoiler);
  }

  wheelWorld(i){
    return this.wheels[i].mesh.position.clone();
  }

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
    this.mesh.position.set(0, this.initialY, 0);
    this.mesh.rotation.set(0,0,0);
  }

  applySmoothSteer(steerInput, dt) {
    if (Math.abs(steerInput) > 0.001) {
      const s = this.steer + steerInput * dt * 2.5;
      return Math.max(-1.0, Math.min(1.0, s));
    } else {
      if (this.steer > 0) return Math.max(this.steer - dt * 1.5, 0);
      if (this.steer < 0) return Math.min(this.steer + dt * 1.5, 0);
      return 0;
    }
  }

  applySafeSteer(steerInput) {
    const avel = Math.min(this.absVel, 250.0);
    return steerInput * (1.0 - (avel / 280.0));
  }

  // ----------------------------------------------------------
  // LOOP FISICO PRINCIPAL
  // ----------------------------------------------------------
  doPhysics(dt, throttleInput, brakeInput, steerInput, ebrakeInput) {
    const c = this.cfg;
    const sn = Math.sin(this.heading);
    const cs = Math.cos(this.heading);

    // 1. Vetores de direcao (INVERTIDO: carro aponta para -Z quando heading=0)
    this.forward.set(-sn, 0, -cs);
    this.right.set(cs, 0, -sn);

    // 2. Decompor velocidade mundial em local
    this.velocityLocal.x = this.forward.dot(this.velocity);
    this.velocityLocal.z = this.right.dot(this.velocity);
    this.velocityLocal.y = 0;

    // 3. Atualizar cada roda (raycast + suspensao)
    for (const w of this.wheels) {
      w.update(dt, this.position, this.heading, this.pitch, this.roll, this.groundObjects);
    }

    const fl = this.wheels[0];
    const fr = this.wheels[1];
    const rl = this.wheels[2];
    const rr = this.wheels[3];

    // 4. Forca total de suspensao (vertical)
    const totalSuspensionForce = fl.suspensionForce + fr.suspensionForce + rl.suspensionForce + rr.suspensionForce;
    const gravityForce = -c.mass * c.gravity;

    // 5. Aceleracao vertical e integracao
    const verticalAccel = (totalSuspensionForce + gravityForce) / c.mass;
    this.velocity.y += verticalAccel * dt;
    this.position.y += this.velocity.y * dt;

    // 6. Anti-roll bars (transferencia lateral de carga via rigidez da barra)
    // Quando uma roda comprime mais que a outra do mesmo eixo,
    // a barra transfere carga da mais comprimida para a menos comprimida
    const frontRollForce = c.antiRollFront * (fl.compression - fr.compression);
    const rearRollForce = c.antiRollRear * (rl.compression - rr.compression);
    // Aplicamos como ajuste de carga (simplificado: ja esta implicito na forca de suspensao)
    // Para um modelo mais avancado, subtrair a forca anti-roll da roda mais comprimida
    // e adicionar na menos comprimida. V1: deixamos como esta.

    // 7. Cargas nos eixos (media das rodas) — usado para grip
    // A carga no pneu agora vem da forca de suspensao real de cada roda
    const axleWeightFront = (fl.tireLoad + fr.tireLoad) * 0.5;
    const axleWeightRear  = (rl.tireLoad + rr.tireLoad) * 0.5;

    // Se no ar, usar cargas estaticas estimadas
    const staticFront = c.mass * c.axleWeightRatioFront * c.gravity;
    const staticRear  = c.mass * c.axleWeightRatioRear * c.gravity;
    const effectiveFront = axleWeightFront > 0.1 ? axleWeightFront : staticFront;
    const effectiveRear  = axleWeightRear  > 0.1 ? axleWeightRear  : staticRear;

    // 8. Slip angles (alpha) front e rear
    const yawSpeedFront = c.cgToFrontAxle * this.yawRate;
    const yawSpeedRear  = -c.cgToRearAxle * this.yawRate;

    const vxAbs = Math.abs(this.velocityLocal.x);
    const signVx = Math.sign(this.velocityLocal.x) || 1;

    const slipAngleFront = Math.atan2(this.velocityLocal.z + yawSpeedFront, vxAbs)
                           - signVx * this.steerAngle;
    const slipAngleRear  = Math.atan2(this.velocityLocal.z + yawSpeedRear, vxAbs);

    // 9. Grip / tire forces (saturados) — proporcionais a carga real
    // RWD: reduzir grip traseiro sob aceleracao (perda de grip por potencia)
    const rearPowerLoss = Math.max(0, throttleInput) * 0.45;
    const tireGripFront = c.tireGrip;
    const tireGripRear  = c.tireGrip * (1.0 - ebrakeInput * (1.0 - c.lockGrip)) * (1.0 - rearPowerLoss);

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const frictionForceFrontZ = clamp(-c.cornerStiffnessFront * slipAngleFront,
                                      -tireGripFront, tireGripFront) * effectiveFront;
    const frictionForceRearZ  = clamp(-c.cornerStiffnessRear * slipAngleRear,
                                      -tireGripRear, tireGripRear) * effectiveRear;

    // 10. Cargas nos eixos (vindas da suspensao independente)
    const frontAxleLoad = fl.tireLoad + fr.tireLoad;
    const rearAxleLoad = rl.tireLoad + rr.tireLoad;

    // Capacidade maxima de freio por eixo: F = μ * N
    const frontBrakeMax = c.frictionCoeff * frontAxleLoad;
    const rearBrakeMax = c.frictionCoeff * rearAxleLoad;

    // Distribuicao de freio RWD drift: 80% frente / 20% tras
    // E-brake adiciona forca extra na traseira (60% da capacidade traseira)
    const brakeForceFront = brakeInput * frontBrakeMax * 0.80 + ebrakeInput * frontBrakeMax * 0.05;
    const brakeForceRear = brakeInput * rearBrakeMax * 0.20 + ebrakeInput * rearBrakeMax * 0.60;

    // Forcas longitudinais (throttle + brake + marcha re) — RWD
    const throttle = throttleInput * c.engineForce;

    let tractionForceFront = 0;
    let tractionForceRear  = 0;
    const almostStopped = Math.abs(this.velocityLocal.x) <= 1.0;
    const velSign = Math.sign(this.velocityLocal.x) || 1;

    if (brakeInput > 0.01 && (almostStopped || this.velocityLocal.x < -0.2)) {
      // Marcha re: apenas eixo traseiro empurra para tras
      tractionForceRear = -brakeInput * c.engineForce * 0.55;
    } else if ((brakeInput > 0.01 || ebrakeInput > 0.01) && throttle >= 0) {
      // Freio normal + aceleracao possivel: distribuicao por eixo real
      tractionForceFront = -brakeForceFront * velSign;
      tractionForceRear = throttle + (-brakeForceRear * velSign);
    } else {
      // So aceleracao (ou neutro) — 100% traseiro
      tractionForceRear = throttle;
    }
    const tractionForceZ = 0;

    // Drag quadratico + rolling resistance (proporcional ao peso)
    const rollingResistanceX = -c.rollingResistanceCoeff * c.mass * c.gravity * Math.sign(this.velocityLocal.x || 1);
    const rollingResistanceZ = -c.rollingResistanceCoeff * c.mass * c.gravity * Math.sign(this.velocityLocal.z || 1);
    const dragForceX = rollingResistanceX - c.airResist * this.velocityLocal.x * Math.abs(this.velocityLocal.x);
    const dragForceZ = rollingResistanceZ - c.airResist * this.velocityLocal.z * Math.abs(this.velocityLocal.z);

    // 11. Total force em coords locais
    const totalForceLocalX = dragForceX + tractionForceFront + tractionForceRear;
    const totalForceLocalZ = dragForceZ + tractionForceZ
                             + Math.cos(this.steerAngle) * frictionForceFrontZ
                             + frictionForceRearZ;

    // 12. Aceleracao local (F = ma)
    this.accelLocal.x = totalForceLocalX / c.mass;
    this.accelLocal.z = totalForceLocalZ / c.mass;

    // 13. Converter aceleracao para mundo
    this.accel.copy(this.forward).multiplyScalar(this.accelLocal.x)
              .add(this.right.clone().multiplyScalar(this.accelLocal.z));

    // 14. Integrar velocidade (X/Z)
    this.velocity.x += this.accel.x * dt;
    this.velocity.z += this.accel.z * dt;

    this.absVel = Math.sqrt(this.velocity.x*this.velocity.x + this.velocity.z*this.velocity.z);

    // 15. Torque de guinada (yaw torque)
    const angularTorque = (frictionForceFrontZ + tractionForceZ) * c.cgToFrontAxle
                          - frictionForceRearZ * c.cgToRearAxle;

    // Estabilidade: parar se muito lento e sem throttle/marcha
    if (this.absVel < 0.5 && throttleInput < 0.01 && brakeInput < 0.01) {
      this.velocity.set(0,0,0);
      this.absVel = 0;
      this.yawRate = 0;
    }

    // 16. Integrar rotacao (yaw)
    const angularAccel = angularTorque / c.inertia;
    this.yawRate += angularAccel * dt;
    this.heading += this.yawRate * dt;

    // 17. Integrar posicao (X/Z)
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // 18. Pitch e roll dinamicos do chassis (efeito visual + fisico leve)
    // Pitch: frente sobe quando acelera (squat tras), afunda quando freia (dive)
    // Roll: lado de fora sobe quando curva
    // Usamos aceleracao longitudinal/lateral para prever o pitch/roll alvo
    const accelLong = this.accelLocal.x;
    const accelLat = this.accelLocal.z;

    const targetPitch = accelLong * 0.025; // acelerar = nariz sobe (pitch positivo)
    const targetRoll  = -accelLat * 0.020;  // negativo porque curva para direita = inclina esquerda

    // Spring-damper para pitch/roll (suaviza a inclinacao)
    const pitchAccel = (targetPitch - this.pitch) * c.pitchStiff - this.pitchVel * c.pitchDamp;
    const rollAccel  = (targetRoll  - this.roll)  * c.rollStiff  - this.rollVel  * c.rollDamp;
    this.pitchVel += pitchAccel * dt;
    this.rollVel  += rollAccel * dt;
    this.pitch += this.pitchVel * dt;
    this.roll  += this.rollVel * dt;

    // 19. Sincronizar mesh do chassis
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(this.pitch, this.heading, -this.roll);

    return {
      slipAngleFront,
      slipAngleRear,
      axleWeightFront: effectiveFront,
      axleWeightRear: effectiveRear,
      yawSpeedFront,
      yawSpeedRear,
    };
  }

  // ----------------------------------------------------------
  // UPDATE POR FRAME
  // ----------------------------------------------------------
  update(dt, input, smoke, skids) {
    // Inputs brutos
    const gas = (input.down('KeyW') || input.down('ArrowUp')) ? 1 : 0;
    const brk = (input.down('KeyS') || input.down('ArrowDown')) ? 1 : 0;
    let steerRaw = 0;
    if (input.down('KeyA') || input.down('ArrowLeft')) steerRaw += 1;
    if (input.down('KeyD') || input.down('ArrowRight')) steerRaw -= 1;
    const hb = input.down('ShiftLeft') || input.down('ShiftRight') ? 1 : 0;

    // Nitro
    if (input.once('Space') && this.nitroCd <= 0) {
      this.nitroT = CFG.nitroDuration;
      this.nitroCd = CFG.nitroCooldown + CFG.nitroDuration;
    }
    if (this.nitroT > 0) this.nitroT -= dt;
    if (this.nitroCd > 0) this.nitroCd -= dt;
    const nitroMult = this.nitroT > 0 ? CFG.nitroMult : 1;

    // Steering suavizado
    this.steer = this.applySmoothSteer(steerRaw, dt);
    this.steer = this.applySafeSteer(this.steer);
    this.steerAngle = this.steer * this.cfg.maxSteer;

    // Aplicar nitro no throttle
    const throttleInput = gas * nitroMult;

    // Rodar fisica
    const phys = this.doPhysics(dt, throttleInput, brk, steerRaw, hb);

    // Visual das rodas (rotacao steer + spin)
    const vSteer = this.steer * 0.45;
    this.wheels[0].mesh.rotation.y = vSteer;
    this.wheels[1].mesh.rotation.y = vSteer;
    const spin = this.velocityLocal.x * dt * 2.2;
    for (const w of this.wheels) {
      w.mesh.rotation.x += spin;
    }

    // Deteccao de drift por slip angle
    const slipThreshold = 0.25;
    const isDrifting = (Math.abs(phys.slipAngleRear) > slipThreshold && Math.abs(this.velocityLocal.x) > 3.5)
                    || (hb > 0.5 && Math.abs(this.velocityLocal.x) > 3);

    const slipIntensity = Math.max(Math.abs(phys.slipAngleFront), Math.abs(phys.slipAngleRear));

    // Particulas de fumaca
    if (slipIntensity > 0.15) {
      [2,3].forEach(i => {
        const p = this.wheelWorld(i);
        p.y = 0.08;
        smoke.emit(p, slipIntensity * 2);
      });
    }

    // Skid marks
    if (isDrifting || (hb > 0.5 && Math.abs(this.velocityLocal.x) > 2)) {
      [0,1,2,3].forEach(i => {
        const p = this.wheelWorld(i);
        p.y = 0.04;
        skids.emit(i, p, this.forward, 0.16);
      });
    } else {
      [0,1,2,3].forEach(i => skids.clear(i));
    }

    // Colisao simples com bordas da arena
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
      driftAngle: Math.abs(phys.slipAngleRear),
      slipAngleFront: phys.slipAngleFront,
      slipAngleRear: phys.slipAngleRear,
      yawRate: this.yawRate,
    };
  }
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
      const off=new THREE.Vector3(0,3.5,7); off.applyAxisAngle(new THREE.Vector3(0,1,0),heading);
      this.cam.position.lerp(pos.clone().add(off), Math.min(1,5*dt));
      this.cam.lookAt(pos.clone().add(new THREE.Vector3(0,1.2,0)));
    }else if(this.mode==='hood'){
      const off=new THREE.Vector3(0,1.3,-0.6); off.applyAxisAngle(new THREE.Vector3(0,1,0),heading);
      this.cam.position.copy(pos).add(off);
      const t=pos.clone().add(new THREE.Vector3(-Math.sin(heading),0,-Math.cos(heading)).multiplyScalar(20));
      this.cam.lookAt(t);
    }else{
      this.orb+=dt*0.25;
      const r=14;
      this.cam.position.set(pos.x+Math.cos(this.orb)*r, pos.y+7, pos.z+Math.sin(this.orb)*r);
      this.cam.lookAt(pos);
    }
    if(spd>26){
      const sh=(spd-26)*0.0012;
      this.cam.position.x+=(Math.random()-.5)*sh; this.cam.position.y+=(Math.random()-.5)*sh;
    }
  }
}

// ============================================================
// ARENA
// ============================================================
function buildArena(scene){
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(140,140), new THREE.MeshStandardMaterial({color:0x2a2a35,roughness:0.9}));
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);

  const grid=new THREE.GridHelper(140,70,0xff2a6d,0x444455);
  grid.position.y=0.02; scene.add(grid);

  const bmat=new THREE.MeshStandardMaterial({color:0xff3333,roughness:0.5});
  const b1=new THREE.Mesh(new THREE.BoxGeometry(140,1.4,1.2),bmat); b1.position.set(0,0.7,70); scene.add(b1);
  const b2=new THREE.Mesh(new THREE.BoxGeometry(140,1.4,1.2),bmat); b2.position.set(0,0.7,-70); scene.add(b2);
  const b3=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.4,140),bmat); b3.position.set(70,0.7,0); scene.add(b3);
  const b4=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.4,140),bmat); b4.position.set(-70,0.7,0); scene.add(b4);

  const coneGeo=new THREE.ConeGeometry(0.38,0.9,8);
  const coneMat=new THREE.MeshStandardMaterial({color:0xffaa00});
  for(let i=0;i<40;i++){
    const c=new THREE.Mesh(coneGeo,coneMat);
    c.position.set((Math.random()-.5)*120,0.45,(Math.random()-.5)*120);
    c.castShadow=true; scene.add(c);
  }

  const boxMat=new THREE.MeshStandardMaterial({color:0x00d4aa});
  for(let i=0;i<10;i++){
    const b=new THREE.Mesh(new THREE.BoxGeometry(1.5+Math.random()*2,1.5+Math.random()*2,1.5+Math.random()*2), boxMat);
    b.position.set((Math.random()-.5)*90, 1, (Math.random()-.5)*90);
    b.castShadow=true; scene.add(b);
  }

  // Ramps
  const rampMat = new THREE.MeshStandardMaterial({ color:0x8844ff });
  const ramps = [];
  for(let i=0;i<3;i++){
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(3,0.3,6), rampMat);
    ramp.position.set((Math.random()-.5)*60, 0.3, (Math.random()-.5)*60);
    ramp.rotation.z = (Math.random()-.5)*0.3;
    ramp.rotation.x = -0.15;
    ramp.receiveShadow = true;
    scene.add(ramp);
    ramps.push(ramp);
  }

  // Retorna objetos que servem de chao para raycast
  return [floor, ...ramps];
}

// ============================================================
// ENVIRONMENT
// ============================================================
function setupEnv(scene){
  scene.fog=new THREE.Fog(0x1a0b2e, 30, 120);
  const vs=`varying vec3 vWorldPosition; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorldPosition=w.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const fs=`varying vec3 vWorldPosition; void main(){ vec3 top=vec3(0.06,0.02,0.15); vec3 bottom=vec3(0.95,0.35,0.45); float h=normalize(vWorldPosition).y; vec3 col=mix(bottom,top,max(0.0,h*0.5+0.5)); gl_FragColor=vec4(col,1.0); }`;
  const sky=new THREE.Mesh(new THREE.SphereGeometry(200,32,32), new THREE.ShaderMaterial({vertexShader:vs,fragmentShader:fs,side:THREE.BackSide}));
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
    this.camera=new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 500);

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
    this.scene.add(new THREE.HemisphereLight(0xffaaee,0x222233,0.55));
    const dir=new THREE.DirectionalLight(0xffffff,1.1);
    dir.position.set(30,60,20);
    dir.castShadow=true;
    dir.shadow.mapSize.set(2048,2048);
    dir.shadow.camera.near=0.5; dir.shadow.camera.far=160;
    dir.shadow.camera.left=-80; dir.shadow.camera.right=80;
    dir.shadow.camera.top=80; dir.shadow.camera.bottom=-80;
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
