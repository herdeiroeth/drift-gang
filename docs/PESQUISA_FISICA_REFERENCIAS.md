PESQUISA COMPLETA: FISICA DE DRIFT 3D + REFERENCIAS DE CODIGO
===========================================================
Data: 2026-04-23
Stack alvo: Three.js + Vite vanilla JS (sem physics engine externa)

================================================================================
PARTE 1 — POR QUE O CARRO ESTA "FLUTUANDO" (DIAGNOSTICO DO CODIGO ATUAL)
================================================================================

O jogo atual implementa um modelo MUITO simplificado que ignora as leis de Newton
para rotacao e aderencia. Os problemas que causam sensacao de flutuacao:

1. ROTACAO SEM INERCIA ANGULAR
   Atual: this.heading += steer * steerStr * dt * sign(fSpd || 1)
   Problema: o carro vira instantaneamente. Nao ha "angular velocity" (yaw rate)
   que leva tempo para acelerar/desacelerar. Em fisica real, o carro resiste a
   mudancas de rotacao por causa do momento de inercia.

2. GRIP LATERAL E UMA "MOLA" DIRETA NA VELOCIDADE
   Atual: latCancel = lSpd * (1 - grip); velocity.sub(r * latCancel)
   Problema: isso e uma forca proporcional pura, sem massa, sem slip angle, sem
   saturacao. Pneus reais geram forca lateral baseada no slip angle ate um pico,
   depois SATURAM (diminuem). O modelo atual nao satura — ele so puxa a velocidade
   de volta linearmente, o que parece artificial.

3. ACELERACAO LINEAR SEM DRAG QUADRATICO
   Atual: velocity.add(f * accel * dt); depois multiplyScalar(drag^60dt)
   Problema: arrasto de ar e quadratico (v^2). Rolling resistance e linear (v).
   O jogo so tem um "drag" linear multiplicativo que nao cria sensacao de peso.
   O carro acelera de forma uniforme e nao ha top speed natural emergente.

4. SEM SEPARACAO DE EIXO DIANTEIRO/TRASEIRO
   Atual: calcula forwardSpeed e lateralSpeed do CENTRO DO CARRO.
   Problema: em fisica real, eixos dianteiro e traseiro tem slip angles DIFERENTES
   (por causa do steering angle e yaw rate). E a DIFERENCA entre forca lateral
   dianteira e traseira que cria o torque de guinada (yaw torque) — isso e o
   drift. O modelo atual nao tem isso.

5. NAO HA MASSA / CENTRO DE GRAVIDADE
   Atual: velocity e um vetor puro, sem massa.
   Problema: sem massa nao ha transferencia de peso. Freiar nao joga peso pra
   frente, acelerar nao joga pra tras. Sem transferencia de peso, nao ha como
   induzir sobresterço realista.

6. STEERING NAO DEPENDE DA VELOCIDADE
   Atual: steerStrength muda levemente durante drift, mas nao ha Ackermann,
   nao ha reducao natural de efetividade em alta velocidade.

================================================================================
PARTE 2 — REFERENCIAS TEORICAS (ARTIGOS E PAPERS)
================================================================================

--- 2.1 MARCO MONSTER — "Car Physics for Games" (FUNDAMENTAL) ---
Link: http://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/Car%20Physics%20for%20Games.html
Copia local: /tmp/marco_monster_car_physics.md

Esse e o artigo MAIS citado da area. Ele explica:
- Forcas longitudinais (tractive, drag, rolling resistance) separadas das laterais
- Slip ratio para forca longitudinal: Flong = Ct * slipRatio (clampado ao pico)
- Slip angle (alpha) para forca lateral: Flat = Ca * alpha (abaixo do pico)
- Sideslip angle (beta): angulo entre orientacao do carro e vetor velocidade
- Yaw rate (omega): velocidade angular do carro
- Slip angles por eixo:
  alpha_front = -atan(vy + omega*b / |vx|) + delta*sign(vx)
  alpha_rear  = -atan(vy - omega*c / |vx|)
- Forca lateral saturada (clampada) por pneu
- Torque de guinada = Flat_front * b - Flat_rear * c
- Angular acceleration = torque / inertia

Key insight: O drift emerge NATURALMENTE quando a forca lateral traseira satura
(ou e reduzida por e-brake) enquanto a dianteira continua alta. O desbalanceamento
cria torque de guinada e o carro gira.

--- 2.2 EDY SEGURA — "Pacejka '94 Parameters Explained" ---
Link: https://www.edy.es/dev/docs/pacejka-94-parameters-explained-a-comprehensive-guide/

Formula simplificada para jogos (Pacejka Magic Formula):
  F = D * sin(C * arctan(B*x - E*(B*x - arctan(B*x))))

Para arcade, podemos usar uma aproximacao linear com clamp (saturacao):
  Flat = clamp(-cornerStiffness * alpha, -tireGrip, tireGrip) * normalLoad

--- 2.3 WIKIPEDIA — Slip Angle & Friction Circle ---
Links:
  https://en.wikipedia.org/wiki/Slip_angle
  https://en.wikipedia.org/wiki/Friction_circle

Friction Circle: soma vetorial de Fx e Fy nao pode ultrapassar mu * Fz.
Se acelera forte, sobra menos grip pra curvar. Isso explica porque drift
precisa de acelerador para manter o slide.

================================================================================
PARTE 3 — PROJETOS OPEN-SOURCE COM CODIGO REUTILIZAVEL
================================================================================

--- 3.1 spacejack/carphysics2d (RECOMENDADO — JS puro) ---
Repo: https://github.com/spacejack/carphysics2d
Demo: http://www.spacejack.ca/projects/carphysics2d/

Implementacao direta do artigo do Marco Monster em JavaScript/HTML5.
Arquivo principal: public/js/Car.js

Modelo fisico:
- Decompoe velocidade em coordenadas locais do carro (vx, vy)
- Calcula yawSpeedFront = yawRate * cfg.cgToFrontAxle
- Calcula yawSpeedRear  = yawRate * cfg.cgToRearAxle
- Slip angles:
  slipAngleFront = atan2(vy + yawSpeedFront, abs(vx)) - sign(vx)*steerAngle
  slipAngleRear  = atan2(vy - yawSpeedRear,  abs(vx))
- Forca lateral (clampada):
  frictionForceFront = clamp(-cornerStiffnessFront * slipAngleFront, -tireGripFront, tireGripFront) * axleWeightFront
  frictionForceRear  = clamp(-cornerStiffnessRear  * slipAngleRear,  -tireGripRear,  tireGripRear)  * axleWeightRear
- E-brake reduz grip traseiro:
  tireGripRear = cfg.tireGrip * (1 - ebrakeInput * (1 - cfg.lockGrip))
- Transferencia de peso dinamica por aceleracao longitudinal

POR QUE USAR: e JavaScript puro, direto, e implementa exatamente o modelo que
precisamos. Pode ser portado para 3D (adicionar eixo Y/gravidade).

--- 3.2 Foolosophe/Yo-kart-racing-3d (Three.js puro, fisica propria) ---
Repo: https://github.com/Foolosophe/Yo-kart-racing-3d

Fisica 100% custom sem engine externa. Sistema de drift completo:
- driftIntensity sobe progressivamente 0->1 em ~30 frames
- angle += cfg.driftAngleAdd * driftDir * driftIntensity * dt
- turn *= cfg.driftTurnMultiplier durante drift
- Inercia angular mais suave: inertiaFactor = 0.08 (drift) vs 0.15 (normal)
- Friction menor: speed *= driftFriction
- Hop inicial: jumpVelocity = 0.25 (estilo Mario Kart)
- Drift boost ao soltar, com niveis por tempo de drift

Arquivos: public/js/player.js, public/js/config.js

POR QUE USAR: melhor exemplo de drift arcade PURO. Mostra como fazer drift
sem physics engine, apenas vetores e trigonometria. E a abordagem que voce
disse que quer (sem Cannon/Rapier).

--- 3.3 Aebel-Shajan/Driftin-Deliveries (Three.js + CANNON-ES custom) ---
Repo: https://github.com/Aebel-Shajan/Driftin-Deliveries

NAO usa RaycastVehicle — fisica TOTALMENTE custom em cima de CANNON.Body:
- angularDamping cai de 0.8 -> 0.6 ao pressionar Shift (drift)
- Grip lateral manual via dot product:
  perpendicularVel = velocity.dot(sideward)
  centripetalForce = sideward * (-redirectAmount * perpendicularVel)
  - normal: redirectAmount = 4.0 (muito grip)
  - drift: redirectAmount = 0.6 (pouco grip)
- Drag: applyForce(velocity * -0.1)
- Torque no eixo Y para steering

Arquivo: src/js/PlayerObject.js

POR QUE USAR: mostra como implementar grip manual mesmo usando CANNON.
Mas voce pode adaptar a logica para fisica propria (sem CANNON).

--- 3.4 NullCipherr/Cannon-Car-Simulator (CANNON-ES RaycastVehicle) ---
Repo: https://github.com/NullCipherr/Cannon-Car-Simulator

Melhor exemplo de CANNON.RaycastVehicle funcional:
- suspensionStiffness: 22, suspensionRestLength: 0.3
- frictionSlip: 3.8, rollInfluence: 0.08
- TRACAO TRASEIRA: applyEngineForce(force, 2) e (3)
- Freio de mao: setBrake(brakeForce, todas as rodas)
- Boost: Shift + W aumenta engineForce em 1.2x

Arquivo: js/vehicle.js

POR QUE USAR: se em algum momento voce reconsiderar usar physics engine,
RaycastVehicle e o padrao da industria para arcade. Mas o usuario disse que
NAO quer engine externa.

--- 3.5 cconsta1/threejs_car_demo (Three.js + Cannon-es + Vite) ---
Repo: https://github.com/cconsta1/threejs_car_demo

CANNON-ES RigidVehicle com esferas como rodas:
- Massa chassis: 16, linearDamping: 0.25, angularDamping: 0.7
- Centro de massa baixo: shapeOffsets[0] = (0, -0.2, 0)
- ContactMaterial wheel-ground: friction 1.0, restitution 0.01
- Turbo: applyImpulse no forward direction
- Jump: applyImpulse vertical

Arquivo: src/Experience/World/SimpleCarPhysics.js

--- 3.6 needle-engine/car-physics (Rapier + TypeScript) ---
Repo: https://github.com/needle-engine/car-physics

Usa DynamicRayCastVehicleController do Rapier (mais moderno que Cannon):
- maxSteer: 40 graus, steerSmoothingFactor: 0.1
- accelerationForce: 12N, breakForce: 12N, topSpeed: 25 m/s
- Suporta tracao all/front/rear
- Deteccao automatica de rodas pelo nome do mesh

--- 3.7 HexGL (bkcore) — Three.js puro, 1709 stars ---
Repo: https://github.com/bkcore/hexgl
Arquivo: bkcore/hexgl/ShipControls.js

Fisica arcade custom (nao usa physics engine):
- airResist = 0.02, thrust = 0.02, maxSpeed = 7.0
- angularSpeed = 0.005, airAngularSpeed = 0.0065
- drift ativado por triggers (Q/E): airDrift = 0.1, driftLerp = 0.35
- airBrake = 0.02 (freia ao driftar)
- Repulsao em colisoes: repulsionRatio = 0.5, repulsionCap = 2.5
- Altura controlada por heightmap: heightLerp = 0.4
- Roll visual: rollAngle = 0.6, rollLerp = 0.08 (nao afeta fisica)
- Varios lerps pra suavizar sem perder controle

Key insight do HexGL: o carro NAO flutua porque airResist e aplicado TODO
FRAME proporcional a velocidade, e ha ground detection constante.

--- 3.8 Retro Racers (martenatef/Retro-racers) ---
Repo: https://github.com/martenatef/Retro-racers

Fisica 2D top-down customizada:
- friction base = 0.96 (aplicado todo frame)
- Decomposicao vetorial: vForward e vRight
- Grip ao driftar: grip = 0.97 (drift) vs 0.8 (normal)
- Off-road: drag = 0.90, maxSpeed cai de 30 pra 5

================================================================================
PARTE 4 — O QUE FAZ UM CARRO NAO FLUTUAR (CHECKLIST DE FIX)
================================================================================

Baseado em todas as referencias, aqui o que precisa mudar NO CODIGO ATUAL:

[ ] 1. ADICIONAR MASSA E INERCIA
    O carro precisa de `mass` (ex: 1200 kg) e `inertia` (ex: 1500 kg*m^2).
    Forca / mass = aceleracao linear. Torque / inertia = aceleracao angular.
    Isso sozinho ja tira o feel de "papel".

[ ] 2. TROCAR ROTACAO PURA POR YAW RATE (ANGULAR VELOCITY)
    Em vez de:
      this.heading += steer * steerStr * dt
    Usar:
      yawTorque = (lateralForceFront * distFrontAxle) - (lateralForceRear * distRearAxle)
      angularAcceleration = yawTorque / inertia
      yawRate += angularAcceleration * dt
      yawRate *= angularDamping  // resistencia a rotacao
      this.heading += yawRate * dt

[ ] 3. CALCULAR SLIP ANGLE POR EIXO (NAO DO CARRO TODO)
    Transformar velocidade do mundo pra coordenadas locais do carro:
      vx = velocity.dot(forward)
      vy = velocity.dot(right)
    Slip angles:
      alphaF = atan2(vy + yawRate * b, abs(vx)) - sign(vx) * steerAngle
      alphaR = atan2(vy - yawRate * c, abs(vx))
    Onde b = distancia CG -> eixo dianteiro, c = CG -> eixo traseiro.

[ ] 4. FORCA LATERAL COM SATURACAO (CLAMP)
    Em vez de cancelar velocidade lateral proporcionalmente:
      flatF = clamp(-cornerStiffnessFront * alphaF, -tireGripFront, tireGripFront) * axleWeightFront
      flatR = clamp(-cornerStiffnessRear  * alphaR, -tireGripRear,  tireGripRear)  * axleWeightRear
    Aplicar como forca no centro de massa (flatF + flatR) e gerar yaw torque.

[ ] 5. E-BRAKE REDUZ GRIP TRASEIRO
      tireGripRear = baseGrip * (1 - ebrake * (1 - lockGrip))
    Ex: baseGrip = 1.0, lockGrip = 0.7. Com e-brake ativo, traseiro fica com 70%.
    Isso faz o eixo traseiro deslizar mais, criando sobresterço.

[ ] 6. ADICIONAR DRAG QUADRATICO + ROLLING RESISTANCE
      fDrag = -Cdrag * velocity * speed
      fRR   = -Crr   * velocity
    Isso cria top speed natural sem hard cap. A 100 km/h drag e RR se igualam.

[ ] 7. TRANSFERENCIA DE PESO (SIMPLIFICADA)
      weightFront = mass * 0.5 * g - (accelLong * mass * cgHeight / wheelbase)
      weightRear  = mass * 0.5 * g + (accelLong * mass * cgHeight / wheelbase)
    Freiar joga peso pra frente (mais grip dianteiro, menos traseiro -> traseira
    desliza mais). Acelerar joga pra tras (mais grip traseiro, bom pra tracao).

[ ] 8. STEERING LIMITADO POR VELOCIDADE
    O angulo maximo de direcao deve cair com a velocidade:
      maxSteer = lerp(maxSteerLowSpeed, maxSteerHighSpeed, speed / maxSpeed)
    Isso evita que o carro gire igual uma beyblade em alta velocidade.

[ ] 9. GROUNDING / GRAVIDADE
    O carro precisa de um raycast simples pra baixo ou pelo menos garantir que
    y = groundHeight e aplicar uma forca de contato normal quando estiver no chao.
    Sem isso, o carro flutua porque nao ha reacao do chao.

================================================================================
PARTE 5 — MODELO ARCADE MINIMO RECOMENDADO (para implementar)
================================================================================

Se voce quer a fisica MAIS REAL possivel SEM usar engine externa, recomendo
fortemente seguir o modelo do spacejack/carphysics2d (portado para 3D).

Resumo do loop fisico por frame:

1. Inputs -> throttle, brake, steer, ebrake
2. Decompor velocidade mundial em coordenadas locais do carro
3. Calcular slip angles front e rear
4. Calcular forcas laterais (com saturacao/clamp)
5. Aplicar e-brake reduzindo grip traseiro
6. Transferencia de peso por aceleracao longitudinal
7. Forca longitudinal = tracao - drag - rollingResistance - braking
8. Aplicar forcas resultantes no CM (Fx total, Fy total)
9. Calcular yaw torque = flatF * b - flatR * c
10. Integrar: accel = F/m, velocity += accel * dt, position += velocity * dt
11. Integrar angular: angularAccel = yawTorque / inertia, yawRate += ... , heading += yawRate * dt
12. Aplicar damping linear e angular
13. Atualizar visual do mesh

Isso sozinho vai eliminar 100% do feel flutuante.

================================================================================
PARTE 6 — JOGOS EXISTENTES PARA ANALISE DE REFERENCIA
================================================================================

Jogo                | Engine          | Fisica                    | Codigo?
--------------------|-----------------|---------------------------|----------
Drift Hunters       | Unity WebGL     | Unity Physics             | Nao
Madalin Stunt Cars  | Unity WebGL     | Unity Physics             | Nao
Burnout Drift       | Unity           | Unity + custom            | Nao (asset store)
HexGL               | Three.js puro   | Custom arcade             | SIM
Retro Racers        | HTML5 Canvas    | Custom 2D top-down        | SIM
Racer-Web           | Three.js        | Simples arcade            | SIM
js-car (oseiskar)   | Canvas 2D       | Custom com slip angle     | SIM
Cannon-Car-Sim      | Three+Cannon    | RaycastVehicle            | SIM
Yo-kart-racing-3d   | Three.js puro   | Custom arcade drift       | SIM

O que aprendemos com eles:
- HexGL: airResist constante todo frame + ground detection + lerps = nao flutua
- Retro Racers: friction = 0.96 aplicado todo frame + decomposicao vForward/vRight
- Yo-kart: drift intensity progressiva + hop + boost por niveis = feel arcade polido
- spacejack: modelo fisico mais "realista" que ainda e arcade (2D top-down)

================================================================================
PARTE 7 — BIBLIOTECAS DISPONIVEIS (CASO MUDE DE IDEIA)
================================================================================

CANNON-ES (mais popular):
  - RaycastVehicle: rodas sao raycasts, nao bodies. Mais estavel.
  - RigidVehicle: rodas sao bodies ligados por constraints internos.
  - HingeConstraint: controle total de cada roda.
  Docs: https://pmndrs.github.io/cannon-es/

Rapier (mais moderno, performance melhor):
  - DynamicRayCastVehicleController: API similar ao Cannon RaycastVehicle.
  - Usado por needle-engine/car-physics.
  Docs: https://rapier.rs/docs/user_guides/javascript/vehicle_controller

Ammo.js (Bullet Physics WASM):
  - Mais poderoso, mais complexo.
  - Projeto: yomboprime/TNTGame

Physijs (LEGADO — nao usar):
  - Wrapper de Ammo.js com Web Worker.
  - Projetos antigos usam, mas esta abandonado.

================================================================================
PARTE 8 — CHECKLIST DE IMPLEMENTACAO SUGERIDA
================================================================================

FASE 1 — FUNDAMENTOS (elimina flutuacao)
[ ] Portar modelo spacejack/carphysics2d para 3D
[ ] Adicionar massa (1200kg) e inertia (1500)
[ ] Implementar yawRate em vez de rotacao direta
[ ] Implementar drag quadratico + rolling resistance
[ ] Garantir grounding (raycast ou clamp Y)

FASE 2 — DRIFT REALISTA
[ ] Separar slip angle por eixo (front/rear)
[ ] Forca lateral com saturacao (clamp)
[ ] E-brake reduzindo grip traseiro
[ ] Transferencia de peso simplificada
[ ] Steering limitado por velocidade

FASE 3 — POLIMENTO ARCADE
[ ] Drift intensity progressiva (como Yo-kart)
[ ] Hop inicial ao iniciar drift (opcional)
[ ] Boost por niveis ao soltar drift (opcional)
[ ] Camera lag + shake
[ ] Fumaça e skid marks ligados a slip ratio real

FASE 4 — OTIMIZACAO
[ ] Limitar numero de skid mark segments (FIFO)
[ ] Pool de particulas em vez de criar/destruir
[ ] LOD para objetos distantes da arena
[ ] InstancedMesh para cones e obstaculos repetidos
[ ] Compactar BufferGeometry de skid marks (reutilizar buffers)
