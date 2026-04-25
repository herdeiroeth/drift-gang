================================================================================
POWERTRAIN SYSTEM DESIGN — Drift Game
================================================================================
Versão: 1.0
Data: 25 Abr 2026
Objetivo: Substituir powertrain inline por arquitetura modular completa
Engine: Three.js + vanilla JS

================================================================================
1. ARQUITETURA GERAL
================================================================================

PowertrainSystem
├── Engine          // Combustão com torque curve fricção curvas idle rev limiter stall
├── Clutch          // Disco de fricção real com slip e wear
├── Gearbox         // Manual com shift time model, auto-shift map
├── Differential    // Open vs Welded vs LSD clutch-type configurable
└── Electronics
    ├── TractionControl   // Slip ratio PID + cut
    ├── LaunchControl     // 2-step rev limiter
    └── BoostController   // Turbo spool + boost target

METODOLOGIA:
- Engine produz torque_bruto = f(rpm, throttle)
- Clutch transmite até maxFrictionTorque baseado no pedal (0-1)
- Se engineTorque < clutchCapacity → clutch locked, rpm_engine == rpm_drivetrain
- Se engineTorque > clutchCapacity → clutch SLIPS, rpm_engine acelera solo
  rmp_engine_deriv = (engineTorque.desired - clutchFrictionTorque) / engineInertia
  torque_to_gearbox = clutchFrictionTorque (constante por posição do pedal)
- Gearbox multiplica por gearRatio, divide por diff, chega nas rodas
- Differential split torque left/right conforme tipo

FUNDAMENTO DO CLUTCH SLIP:
+ Fonte: Edy Vehicle Physics Pro + Stack Exchange Engineering
+ "When fully engaged, allows max torque transfer (Max Torque Transfer).
   If engine produces MORE torque than this value, the clutch SLIPS and
   engine/transmission RPMs won't match."
+ Isso permite:
  - Burnout real (acelera sem andar com clutch meio pressionado)
  - Stall real (liberar clutch em marcha baixa = kill rpm)
  - Drift clutch-kick (pisar clutch enquanto acelera → rpm sobe → solta
    clutch = torque shock instantaneo na traseira = break traction)

================================================================================
2. ENGINE
================================================================================

PARAMETROS:
  idleRPM, redlineRPM, maxRPM, stallRPM
  inertiaEngine (kg*m²)  // ~0.15 para 4-cil, ~0.25 para 6-cil inline
  torqueCurve[]          // Pontos {rpm, torqueNm} interpolados
  
  // Fricção interna (3 componentes)
  frictionPassiveNm      // constante (rolamento mancais)
  frictionLinearCoeff    // linear em ω
  frictionQuadraticCoeff // quadrático em ω² (viscoso)
  
  idleMode: 'active'|'passive'  // active = eletronico; passive = carburetor
  idleThrottle           // throttle mínimo para manter idle
  
  // Rev limiter
  revLimitRPM
  revLimitMode: 'hard'|'soft'|'2step'  // hard = corta injeção; soft = limita

ESTADO:
  rpm, angularVel (rad/s), throttlePos, isRunning, isStalled

METODOS update(dt):
  1. rawTorque = lerpTorqueCurve(rpm) * throttlePos
  2. frictionTorque = frictionPassive + frictionLinear*ω + frictionQuadratic*ω²
  
  CASO clutch DESENGATADO (neutral ou pedal 100% ou trocando marcha):
    netTorque = rawTorque - frictionTorque
    angularVel += netTorque / inertia * dt
    rpm = angularVel * 60 / (2π)
  
  CASO clutch TRAVADO (locked, sem slip):
    // Engine + transmission formam um sistema acoplado
    // RPM é determinado pela velocidade das rodas
    angularVel = ω_drivetrain
    netTorque = rawTorque - frictionTorque  // feedback para trans
  
  CASO clutch SLIPPANDO:
    // Engine gira livre, limitado apenas pelo clutch friction
    // (veja secao Clutch abaixo)
    clutchFeedTorque = clutch.getTransmittingTorque()
    netTorque = rawTorque - frictionTorque - clutchFeedTorque
    angularVel += netTorque / inertia * dt
  
  Idle control:
    Se rpm < idleRPM + 200:
      idleCorrectionTorque = (idleRPM - rpm) * idleGain
      rawTorque += idleCorrectionTorque
  
  Rev limit:
    Se rpm > revLimitRPM:
      Se hard: rawTorque = 0 (corta injeção)
      Se 2step: rawTorque = rawTorque * 0.1 (limitado)
  
  Stall:
    Se canStall === true E rpm < stallRPM E clutchEngaged:
      isStalled = true; isRunning = false
    Bump-start: carro em movimento em marcha alta com clutch solto
      → inercia do carro puxa o motor → rpm sobe → start

================================================================================
3. CLUTCH (Friction Disc)
================================================================================

PARAMETROS:
  maxTorqueTransfer (Nm)  // ~2x max engine torque (bom default)
  engagementSpeed         // Quão rápido o pedal afeta o clutch (0-1/ms)
  
ESTADO:
  pedalPos (0=engaged/solto = connected, 1=disengaged/pisado = open)
  wear (0=novo, 1=usado → maxTorqueTransfer diminui)
  isSlipping

METODOS:
  // Capacidade de transferência baseada no pedal
  getMaxTransferableTorque():
    pedaled = 1.0 - pedalPos  // 1.0 = fully engaged, 0.0 = fully disengaged
    return maxTorqueTransfer * pedaled * (1.0 - wear * 0.4)
  
  // Torque REAL transmitido (pode ser menor se engine produz menos)
  getTransmittingTorque(engineTorque):
    maxTransfer = getMaxTransferableTorque()
    if engineTorque <= maxTransfer:
      isSlipping = false
      return engineTorque  // 100% transmitido
    else:
      isSlipping = true
      return maxTransfer   // Limitado pela capacidade do clutch
  
  // Slip ratio para UI/sonoro
  getSlipRatio(engineRPM, drivetrainRPM):
    if drivetrainRPM < 10: return 0
    return (engineRPM - drivetrainRPM) / drivetrainRPM

COMPORTAMENTOS ARCADE FODAS:
  - Drift clutch-kick: rapidamente pisar/soltar clutch + acelerador = torque
    shock para fazer a traseira sair de traseira
  - Rev match downshift: pisar clutch + abrir acelerador → rpm sobe → soltar
    clutch com rpm alto = suave (Match)
  - Jumpy start: max clutch + highway = burnout / launch

================================================================================
4. GEARBOX
================================================================================

PARAMETROS:
  gearRatios: [0, -2.9, 3.6, 2.2, 1.5, 1.1, 0.85, 0.65]
  // index 0 = neutral (0 ratio), 1 = reverse (-), 2+ = forward
  diffFinalDrive = 3.8
  shiftTime = 0.35  // segundos (H-pattern real)
  autoShift = true|false
  
ESTADO:
  currentGear, targetGear, shiftTimer, isShifting

METODOS:
  getGearRatio(): return gearRatios[currentGear]
  
  getOutputRPM(engineRPM, clutchPedal):
    if clutchPedal > 0.9: // disengaged
      // transmission roda livre (freio por fricção interna da trans)
      return transmissionRPM  // inercia própria
    else:
      return engineRPM / (getGearRatio() * diffFinalDrive)
  
  shiftUp()/shiftDown():
    if !isShifting:
      targetGear = currentGear +/- 1
      isShifting = true
      shiftTimer = shiftTime
      // Corta torque durante a troca
  
  update(dt, engineRPM, clutchSlip):
    if isShifting:
      shiftTimer -= dt
      if shiftTimer <= 0:
        currentGear = targetGear
        isShifting = false
        if clutchSlip === false:
          // Shift complete, engine RPM jumps to match new gear ratio
          // engineRPM = drivetrainRPM * gearRatio * diff
    
    Auto-shift map (dynamic):
      load = throttleInput  // 0-1
      upshiftRPM = 4000 + load * (redline - 4000)  // pé leve sobe cedo
      downshiftRPM = 2000 + load * (4500 - 2000)  // pé fundo reduz cedo

SHIFT TIME MODEL:
  Durante a troca (isShifting = true):
  - clutch automaticamente disengaged (corta conexão motor-roda)
  - engine RPM flutua livre → pode fazer rev-match manual
  - gear ratio = 0 (nenhum torque passa)
  - Igual carro real: power-to-wheels = 0 durante a troca

================================================================================
5. DIFFERENTIAL
================================================================================

TIPOS:
  1. OPEN DIFF (default de fabrica)
     - Split torque 50/50 fixo
     - Quando uma roda patina, perde toda a tração na outra (burnout 1 roda)
     - Simples: driveTorquePerWheel = totalDriveTorque * 0.5
  
  2. WELDED / SPOOL (drift car)
     - Duas rodas travadas juntas (mesma velocidade angular)
     - 100% lock, torque split ajusta dinamicamente baseado na aderência
     - Simulação: wheelL.ω = wheelR.ω (forçado)
     - Freinando a diferenca de velocidade com muito damping
  
  3. LSD CLUTCH-TYPE (Viscous ou Clutch Pack)
     - lockRatio baseado na diferença de velocidade das rodas (Δω)
     - Mais Δω → mais lock → até 100%
     - preload: sempre aplica um pouco de lock
     - Config: preload (Nm), lockRate (quanto Δω engaja lock)
     
     lockAmount = min(1.0, preload + lockRate * abs(Δω))
     leftRatio = 0.5 + (lockAmount - 0.5) * (ωL > ωR ? -1 : 1) * 0.5
     // Se ωL > ωR, lsd bloqueia, envia mais torque para a roda MAIS LENTA

RECOMENDAÇÃO PARA DRIFT GAME:
  Tenha um select de diff no menu:
  - Open: fácil, substeer, burnout 1-wheel (beginner)
  - LSD 1.5way: meio-termo, drift consistente (intermediate)
  - Welded: drift king, oversteer sempre, snap transition (advanced)

================================================================================
6. TRACTION CONTROL (TC)
================================================================================

PRINCIPIO:
  Monitora slipRatio de cada roda motriz em tempo real
  slipRatio = (wheelSpeed - groundSpeed) / max(abs(groundSpeed), 0.1)
  slipRatio > 0.15 = light slip
  slipRatio > 0.30 = heavy slip / burnout

IMPLEMENTACAO:
  Mode: 'off' | 'low' | 'high'
  
  if TC is ON:
    targetSlip = mode === 'low' ? 0.08 : 0.15
    error = slipRatio - targetSlip
    if error > 0:
      torqueCut = min(1.0, error * tcGain)
      engineRawTorque *= (1.0 - torqueCut)
  
  // Visual: TC light pisca no HUD quando ativado

PARA DRIFT GAME:
  TC OFF = purê, total controle do motorista
  TC LOW = ajuda sutil para iniciantes
  TC HIGH = quase impossível de driftar (modo cronometro/corrida)

================================================================================
7. LAUNCH CONTROL (2-STEP)
================================================================================

PRINCIPIO:
  2-step rev limiter: motor limita em launchRPM quando clutch + acelerador
  Soltar clutch = full torque instantaneo = launch perfeito

IMPLEMENTACAO:
  activate: clutchPedal > 0.8 && throttle > 0.8 && speed < 5 km/h
  if active:
    hardLimitRPM = launchRPM (ex: 4500)
    if rpm > launchRPM: cut ignition 100%
    HUD: "LAUNCH" + barra de rpm como rev gauge que vai até o target
  
  on clutch release:
    launch control desabilita automaticamente

================================================================================
8. TURBO / SUPERCHARGER
================================================================================

TURBO (exhaust-driven):
  boostPsi: 0  // 0 a ~30 psi (2 bar)
  spoolRate:  // Quão rápido sobe
  lag:        // Delay inicial
  
  update(dt, exhaustFlow proportional a throttle * rpm):
    // exhaustFlow = throttleInput * (rpm / redline) ^ 1.5
    targetBoost = maxBoost * exhaustFlow
    // Lag exponencial
    boostPsi += (targetBoost - boostPsi) * spoolRate * dt
    // Potencia extra
    extraTorqueMult = 1.0 + (boostPsi / 14.7) * 0.3  // ~30% extra a 2 bar

SUPERCHARGER (belt-driven):
  // Sem lag, boost proporcional a rpm diretamente
  boostPsi = maxBoost * (rpm / redline)
  // Consome potencia do motor (parasitic loss ~10-15%)

================================================================================
9. INTEGRATION NO CAR (doPhysics)
================================================================================

STEP ATUAL → NOVO:

ANTES (inline):
  engineTorque = throttle * torqueCurve(rpm)
  driveTorque = engineTorque * gearRatio * diff * efficiency  // instant
  rpm = lerp(rpm, wheelRPM * gearRatio * diff)              // simple

DEPOIS (powertrain system):
  
  // 1. Throttle/brake inputs
  engine.setThrottle(throttleInput)
  clutch.setPedal(clutchPedal)
  
  // 2. Gearbox state
  if shiftUp/shiftDown requested:
    gearbox.shift(targetGear)
  gearbox.update(dt)
  
  // 3. Drivetrain RPM from wheels
  avgRearWheelRPM = (rl.ω + rr.ω) * 0.5 * 60/(2π)
  drivetrainRPM = avgRearWheelRPM * gearbox.getGearRatio() * diff
  
  // 4. Clutch decides state
  clutchTorque = clutch.getTransmittingTorque(engine.getTorque())
  isSlipping = clutch.isSlipping
  
  // 5. Engine update
  if clutch.isEngaged && !isSlipping && !gearbox.isShifting:
    engine.setRPM(drivetrainRPM)  // locked together
    engineTorque = engine.update(dt, clutchTorque)  // feedback
  else:
    // Engine roda livre ou slip
    engineTorque = engine.updateFree(dt, clutchTorque)
  
  // 6. Traction control
  if tcEnabled:
    avgSlip = (rl.slipRatio + rr.slipRatio) * 0.5
    engineTorque *= tc.getTorqueMultiplier(avgSlip)
  
  // 7. Launch control
  if launchControlActive:
    engine.clampRPM(launchRPM)
    engineTorque = engine.getTorqueAt(launchRPM) * throttle
  
  // 8. Turbo
  if turbo:
    turbo.update(dt, engine.rpm, throttleInput)
    engineTorque *= turbo.getTorqueMult()
  
  // 9. Differential split
  diffTorque = engineTorque * gearbox.getGearRatio() * diff * efficiency
  torqueL, torqueR = differential.split(diffTorque, rl.ω, rr.ω)
  
  // 10. Aplica nas rodas
  rl.driveTorque = torqueL
  rr.driveTorque = torqueR

================================================================================
10. HUD TELEMETRY NOVO
================================================================================

RPM Gauge: barra de 0 a redline com zona de torque (colorida)
            section vermelha = rev limit
            pisca em cut = launch control/2-step ativo

Gear Display: N, R, 1-6 com shift indicator (pisca durante troca)

Boost Gauge: 0 a 30 PSI (se turbo) ou Supercharger icon

TC Indicator: TC OFF (vermelho), TC LOW (amarelo), TC HIGH (verde piscando)

Clutch: Barra de 0-100% + "SLIP" warning quando patinando

Diff Type: Open / LSD / Welded (textual no telemetria)

Wheel Slip: Slip ratio de cada roda motriz em tempo real

================================================================================
11. REFERENCIAS
================================================================================

- Vehicle Physics Pro (Edy): vehiclephysics.com — Clutch, Engine, Diff blocks
- Marco Monster's Car Physics: spacejack/carphysics2d
- GTPlanet Engine Simulation Thread: procedural engine torque/RPM model
- Engineering Stack Exchange: "Calculating Car Engine RPM for Game"
- GameDev.net: "Car engine and feedback torque" — clutch lock/slip dynamics
- BeamNG.drive: Torque converter physics, drivetrain constraints
- ArcadeCarPhysics (SergeyMakeev): Speed curves, stabilizer bars, Ackermann
