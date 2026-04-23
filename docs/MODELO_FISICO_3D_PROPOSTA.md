MODELO FISICO 3D PROPOSTO — ADAPTACAO DO SPACEJACK/CARPHYSICS2D PARA THREE.JS
================================================================================
Baseado no artigo de Marco Monster + implementacao JS de spacejack/carphysics2d
Adaptado para Three.js 3D por: [AI Assistant] para projeto Drift Game

================================================================================
1. CONFIGURACAO DO CARRO (nova classe CarConfig)
================================================================================

class CarConfig {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 9.81;
    this.mass = opts.mass ?? 1200.0;
    this.inertiaScale = opts.inertiaScale ?? 1.0;
    this.halfWidth = opts.halfWidth ?? 0.8;
    this.cgToFront = opts.cgToFront ?? 2.0;
    this.cgToRear = opts.cgToRear ?? 2.0;
    this.cgToFrontAxle = opts.cgToFrontAxle ?? 1.25;
    this.cgToRearAxle = opts.cgToRearAxle ?? 1.25;
    this.cgHeight = opts.cgHeight ?? 0.55;
    this.wheelRadius = opts.wheelRadius ?? 0.3;
    this.tireGrip = opts.tireGrip ?? 2.0;
    this.lockGrip = opts.lockGrip ?? 0.7;
    this.engineForce = opts.engineForce ?? 8000.0;
    this.brakeForce = opts.brakeForce ?? 12000.0;
    this.eBrakeForce = opts.eBrakeForce ?? (this.brakeForce / 2.5);
    this.weightTransfer = opts.weightTransfer ?? 0.2;
    this.maxSteer = opts.maxSteer ?? 0.6;
    this.cornerStiffnessFront = opts.cornerStiffnessFront ?? 5.0;
    this.cornerStiffnessRear = opts.cornerStiffnessRear ?? 5.2;
    this.airResist = opts.airResist ?? 2.5;
    this.rollResist = opts.rollResist ?? 8.0;
  }
}

Valores derivados (calculados no setup):
  inertia = mass * inertiaScale
  wheelBase = cgToFrontAxle + cgToRearAxle
  axleWeightRatioFront = cgToRearAxle / wheelBase
  axleWeightRatioRear  = cgToFrontAxle / wheelBase

================================================================================
2. ESTADO DO CARRO (atributos a adicionar na classe Car)
================================================================================

this.heading = 0;        // radianos (eixo Y, Three.js)
this.position = new THREE.Vector3(x, y, z);
this.velocity = new THREE.Vector3();     // m/s mundo
this.velocityLocal = new THREE.Vector3(); // m/s coords LOCAIS do carro
this.accel = new THREE.Vector3();
this.accelLocal = new THREE.Vector3();
this.absVel = 0;
this.yawRate = 0;        // velocidade angular rad/s
this.steer = 0;          // input suavizado (-1..1)
this.steerAngle = 0;     // angulo real das rodas dianteiras

// VETORES LOCAIS (atualizados todo frame)
this.forward = new THREE.Vector3(0,0,1);  // direcao do carro
this.right   = new THREE.Vector3(1,0,0);  // lateral direita

================================================================================
3. LOOP FISICO POR FRAME (metodo doPhysics(dt))
================================================================================

--- PASSO 1: Vetores de direcao do carro ---
const sn = Math.sin(this.heading);
const cs = Math.cos(this.heading);

this.forward.set(sn, 0, cs);   // frente do carro
this.right.set(cs, 0, -sn);    // direita do carro

--- PASSO 2: Converter velocidade mundial para local ---
// v_local.x = dot(v_world, forward)  (velocidade longitudinal)
// v_local.z = dot(v_world, right)    (velocidade lateral) 
// Nota: em 3D usamos Z como lateral, Y como vertical

this.velocityLocal.x = this.forward.dot(this.velocity);
this.velocityLocal.z = this.right.dot(this.velocity);
this.velocityLocal.y = 0;  // ignora vertical por enquanto

--- PASSO 3: Transferencia de peso nos eixos ---
// accelLocal.x = aceleracao longitudinal (guardada do frame anterior!)
const axleWeightFront = mass * (axleWeightRatioFront * gravity 
                          - weightTransfer * accelLocal.x * cgHeight / wheelBase);
const axleWeightRear  = mass * (axleWeightRatioRear * gravity 
                          + weightTransfer * accelLocal.x * cgHeight / wheelBase);

--- PASSO 4: Slip angles (alpha) front e rear ---
// yawSpeed = yawRate * distancia_do_eixo_ao_CG
const yawSpeedFront = cgToFrontAxle * this.yawRate;
const yawSpeedRear  = -cgToRearAxle * this.yawRate;

// atan2(vy + yawSpeed, |vx|)
const vxAbs = Math.abs(this.velocityLocal.x);
const signVx = Math.sign(this.velocityLocal.x) || 1;

const slipAngleFront = Math.atan2(this.velocityLocal.z + yawSpeedFront, vxAbs) 
                       - signVx * this.steerAngle;
const slipAngleRear  = Math.atan2(this.velocityLocal.z + yawSpeedRear, vxAbs);

--- PASSO 5: Grip / tire forces (saturados!) ---
const tireGripFront = tireGrip;
const tireGripRear  = tireGrip * (1.0 - ebrakeInput * (1.0 - lockGrip));

// Forca lateral = clamp(-stiffness * alpha, -grip, grip) * peso_no_eixo
const frictionForceFrontZ = clamp(-cornerStiffnessFront * slipAngleFront, 
                                  -tireGripFront, tireGripFront) * axleWeightFront;
const frictionForceRearZ  = clamp(-cornerStiffnessRear * slipAngleRear, 
                                  -tireGripRear, tireGripRear) * axleWeightRear;

--- PASSO 6: Forcas longitudinais ---
const brake = Math.min(brakeInput * brakeForce + ebrakeInput * eBrakeForce, brakeForce);
const throttle = throttleInput * engineForce;

const tractionForceX = throttle - brake * sign(this.velocityLocal.x);
const tractionForceZ = 0;

// Drag quadratico + rolling resistance (aplicado em ambos os eixos)
const dragForceX = -rollResist * this.velocityLocal.x 
                   - airResist * this.velocityLocal.x * Math.abs(this.velocityLocal.x);
const dragForceZ = -rollResist * this.velocityLocal.z 
                   - airResist * this.velocityLocal.z * Math.abs(this.velocityLocal.z);

--- PASSO 7: Total force em coords locais ---
const totalForceLocalX = dragForceX + tractionForceX;
const totalForceLocalZ = dragForceZ + tractionForceZ 
                         + Math.cos(this.steerAngle) * frictionForceFrontZ 
                         + frictionForceRearZ;

--- PASSO 8: Aceleracao local ---
this.accelLocal.x = totalForceLocalX / mass;
this.accelLocal.z = totalForceLocalZ / mass;

--- PASSO 9: Converter aceleracao para mundo ---
this.accel.x = cs * this.accelLocal.x - sn * this.accelLocal.z;
this.accel.z = sn * this.accelLocal.x + cs * this.accelLocal.z;

--- PASSO 10: Integrar velocidade ---
this.velocity.x += this.accel.x * dt;
this.velocity.z += this.accel.z * dt;

this.absVel = Math.sqrt(velocity.x**2 + velocity.z**2);

--- PASSO 11: Torque de guinada (yaw torque) ---
const angularTorque = (frictionForceFrontZ + tractionForceZ) * cgToFrontAxle 
                      - frictionForceRearZ * cgToRearAxle;

// Estabilidade: parar o carro se muito lento e sem throttle
if (Math.abs(this.absVel) < 0.5 && !throttle) {
  this.velocity.set(0,0,0);
  this.absVel = 0;
  this.yawRate = 0;
}

--- PASSO 12: Integrar rotacao ---
const angularAccel = angularTorque / inertia;
this.yawRate += angularAccel * dt;
this.heading += this.yawRate * dt;

--- PASSO 13: Integrar posicao ---
this.position.x += this.velocity.x * dt;
this.position.z += this.velocity.z * dt;

================================================================================
4. STEERING SUAVIZADO E SEGURO
================================================================================

applySmoothSteer(steerInput, dt) {
  if (Math.abs(steerInput) > 0.001) {
    // Move em direcao ao input
    return clamp(this.steer + steerInput * dt * 2.0, -1.0, 1.0);
  } else {
    // Volta ao centro
    if (this.steer > 0) return Math.max(this.steer - dt * 1.0, 0);
    if (this.steer < 0) return Math.min(this.steer + dt * 1.0, 0);
    return 0;
  }
}

applySafeSteer(steerInput) {
  const avel = Math.min(this.absVel, 250.0);
  return steerInput * (1.0 - (avel / 280.0));
}

// No update():
this.steer = applySmoothSteer(leftInput - rightInput, dt);
this.steer = applySafeSteer(this.steer);
this.steerAngle = this.steer * maxSteer;

================================================================================
5. GROUNDING / RAYCAST SIMPLES (para nao flutuar)
================================================================================

A cada frame, depois de integrar posicao:

1. Raycast para baixo desde position + (0, 1.0, 0)
2. Se hit com chao em distancia < 1.5:
   this.position.y = groundY + wheelRadius;
3. Se nao houver hit (caiu da arena):
   aplicar reset ou gravidade simples:
   this.velocity.y -= gravity * dt;
   this.position.y += this.velocity.y * dt;

Isso garante que o carro sempre esta no chao e nao flutua.

================================================================================
6. DETECCAO DE DRIFT E SCORING
================================================================================

// Drift = slip angle alto E velocidade alta
const isDrifting = Math.abs(slipAngleRear) > 0.3 
                && Math.abs(this.velocityLocal.x) > 5.0;

// OU: quando o e-brake esta ativo e ha velocidade lateral significativa

// Scoring:
if (isDrifting) {
  const driftAngle = Math.abs(slipAngleRear);
  const speedFactor = Math.abs(this.velocityLocal.x);
  this.driftScore += driftAngle * speedFactor * dt * comboMultiplier;
  this.driftTimer += dt;
  
  // Combo sobe a cada 2s de drift continuo
  const newCombo = 1 + Math.floor(this.driftTimer / 2.0);
  this.comboMultiplier = Math.min(newCombo, 4);
} else {
  // Adiciona drift score ao total, reseta temporarios
  if (this.driftTimer > 0.5) {
    this.totalScore += this.driftScore;
  }
  this.driftScore = 0;
  this.driftTimer = 0;
  this.comboMultiplier = 1;
}

================================================================================
7. PARTICULAS E SKID MARKS (ligados a slip angle real)
================================================================================

// Emitir fumaca quando slip angle > 0.15 radianos (~8.5 graus)
const slipThreshold = 0.15;
const slipIntensity = Math.max(Math.abs(slipAngleFront), Math.abs(slipAngleRear));

if (slipIntensity > slipThreshold) {
  smokeSystem.emitAt(wheelWorldPos, slipIntensity);
}

// Skid marks: comecar quando slipIntensity > 0.2
// Parar quando cai abaixo
// Isso e mais preciso que o threshold fixo do codigo atual

================================================================================
8. DIFERENCAS DO CODIGO ATUAL
================================================================================

ANTES (atual, flutuante):
- heading += steer * steerStr * dt          // rotacao instantanea
- grip = lerp(gripNormal, gripHandbrake, ebrake)
- latCancel = lSpd * (1 - grip)
- velocity.sub(right * latCancel)           // forca lateral = mola direta
- velocity.add(forward * accel * dt)        // aceleracao linear pura
- velocity.multiplyScalar(drag)             // drag linear multiplicativo

DEPOIS (proposto, pesado/realista):
- yawRate += angularAccel * dt              // rotacao com inercia
- heading += yawRate * dt
- Forca lateral por slip angle, saturada (clamp)
- Aceleracao = forca / massa                // F = ma
- Drag quadratico: -C * v * |v|             // arrasto de ar real
- Rolling resistance: -Crr * v              // atrito de rolamento
- Transferencia de peso dinamica
- Steering limitado por velocidade

================================================================================
9. VALORES SUGERIDOS PARA ARCADE DRIFT
================================================================================

Parametro              | Valor    | Observacao
-----------------------|----------|----------------------------------
mass                   | 1200     | kg
inertiaScale           | 1.0      | inertia = mass * 1.0
cgToFrontAxle          | 1.25     | m
cgToRearAxle           | 1.25     | m (wheelbase = 2.5m)
cgHeight               | 0.55     | m (baixo = estavel, alto = mais WT)
tireGrip               | 2.0      | adimensional
cornerStiffnessFront   | 5.0      | N/rad (dianteiro cola mais)
cornerStiffnessRear    | 5.2      | N/rad (traseiro um pouco mais rigido)
engineForce            | 8000     | N (acelera 1200kg a 6.6 m/s^2)
brakeForce             | 12000    | N (freia mais forte que acelera)
eBrakeForce            | 4800     | N (traseiro apenas)
lockGrip               | 0.7      | 30% menos grip traseiro com e-brake
airResist              | 2.5      | coef drag
rollResist             | 8.0      | coef rolling resistance
maxSteer               | 0.6      | rad (~34 graus)
weightTransfer         | 0.2      | quao forte e o WT

================================================================================
10. CHECKLIST DE IMPLEMENTACAO
================================================================================

[ ] Criar classe CarConfig com parametros acima
[ ] Adicionar mass, inertia, yawRate, velocityLocal, accelLocal ao Car
[ ] Implementar decomposicao local (world -> local via dot products)
[ ] Implementar transferencia de peso
[ ] Implementar slipAngle front/rear
[ ] Implementar tire forces com clamp/saturacao
[ ] Implementar forcas longitudinais (engine, brake, drag, rolling)
[ ] Integrar velocidade via accel = F/m
[ ] Implementar yawTorque e integrar yawRate
[ ] Implementar smoothSteer e safeSteer
[ ] Adicionar raycast grounding simples
[ ] Adaptar deteccao de drift para usar slipAngle
[ ] Ajustar valores ate o feel ficar bom
