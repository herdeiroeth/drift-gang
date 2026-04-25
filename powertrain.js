/**
 * POWERTRAIN SYSTEM — Drift Game
 * Módulo completo de simulação do trem de força:
 *   Engine → Clutch → Gearbox → Differential → Wheels
 * + Traction Control, Launch Control, Turbocharger
 * 
 * Referências:
 *   - Vehicle Physics Pro (edy.es / vehiclephysics.com)
 *   - Marco Monster Car Physics Paper
 *   - Engineering Stack Exchange — Engine RPM calc
 *   - GameDev.net — Clutch lock/slip dynamics
 */

// ========================================================================
// ENGINE — Combustão Interna
// ========================================================================

export class Engine {
  constructor(opts = {}) {
    // Curva de torque (pares rpm→torque para interpolação)
    this.torqueCurve = opts.torqueCurve ?? [
      { r: 900,  t: 220 },
      { r: 1500, t: 310 },
      { r: 2500, t: 420 },
      { r: 3500, t: 480 },
      { r: 4500, t: 460 },
      { r: 5500, t: 430 },
      { r: 6500, t: 380 },
      { r: 7200, t: 320 },
    ];

    this.idleRPM        = opts.idleRPM        ?? 900;
    this.redlineRPM     = opts.redlineRPM     ?? 7200;
    this.maxRPM         = opts.maxRPM         ?? 7500;
    this.stallRPM       = opts.stallRPM       ?? 400;
    this.canStall       = opts.canStall       ?? true;

    // Inércia rotacional do motor em kg·m²
    this.inertia        = opts.inertia        ?? 0.18;

    // Curvas de fricção interna (3 componentes)
    // frictionTorque = passive + linear*w + quadratic*w²
    this.frictionPassive    = opts.frictionPassive    ?? 15.0;
    this.frictionLinear     = opts.frictionLinear     ?? 0.008;
    this.frictionQuadratic  = opts.frictionQuadratic  ?? 1.2e-5;

    // Idle control
    this.idleMode       = opts.idleMode       ?? 'active';  // 'active'|'passive'
    this.idleGain       = opts.idleGain       ?? 0.15;      // corretivo proporcional
    this.idleThrottle   = opts.idleThrottle   ?? 0.12;      // throttle mínimo no idle

    // Rev limiter
    this.revLimitRPM    = opts.revLimitRPM    ?? 7200;
    this.revLimitMode   = opts.revLimitMode   ?? 'hard';    // 'hard'|'soft'|'2step'

    // Estado
    this.rpm            = this.idleRPM;
    this.angularVel     = this.rpmToOmega(this.rpm);
    this.throttlePos    = 0;
    this.isRunning      = true;
    this.isStalled      = false;
    this.startupTimer   = 0;   // delay no starter motor

    // Cache: max torque da curva
    this._maxTorque     = Math.max(...this.torqueCurve.map(p => p.t));
  }

  rpmToOmega(rpm) { return rpm * Math.PI / 30; }
  omegaToRPM(omega) { return omega * 30 / Math.PI; }

  getTorqueAt(rpm, throttlePos = this.throttlePos) {
    // Torque da curva para este RPM
    const raw = this._interpolateTorque(rpm);
    // Escala pelo throttle (mapa WOT → throttle parcial)
    // Na vida real o torque não é linear com throttle mas serve pra arcade
    return raw * throttlePos;
  }

  getFrictionTorque(omega) {
    const w = Math.abs(omega);
    return this.frictionPassive
         + this.frictionLinear * w
         + this.frictionQuadratic * w * w;
  }

  // Estado livre (neutro, embreagem aberta, ou slip)
  updateFree(dt, clutchTransmitTorque = 0, externalLoadTorque = 0) {
    if (!this.isRunning) {
      if (this.isStalled) this.rpm = 0;
      return 0;
    }

    const w = this.angularVel;
    const rawTorque = this.getTorqueAt(this.rpm);
    const friction = this.getFrictionTorque(w);

    // Idle control ativo
    let idleCorrection = 0;
    if (this.rpm < this.idleRPM + 200) {
      idleCorrection = (this.idleRPM - this.rpm) * this.idleGain;
    }

    const netTorque = rawTorque - friction - clutchTransmitTorque + idleCorrection;
    this.angularVel += (netTorque / this.inertia) * dt;
    this.rpm = this.omegaToRPM(this.angularVel);

    // Rev limiter
    this._applyRevLimiter();

    // Stall check
    if (this.canStall && this.rpm < this.stallRPM && !this._clutchEngaged) {
      // Se a embreagem estiver engatada E rpm cair demais → stall
      // _clutchEngaged é setado externamente pelo PowertrainSystem
    }

    // Clamp mínimo
    if (this.rpm < 0) { this.rpm = 0; this.angularVel = 0; }

    return rawTorque;  // torque bruto produzido
  }

  // Estado acoplado (locked ao drivetrain)
  updateLocked(dt, drivetrainOmega, clutchTransmitTorque) {
    if (!this.isRunning) return 0;

    // RPM é imposto pela velocidade do drivetrain
    this.angularVel = drivetrainOmega;
    this.rpm = this.omegaToRPM(drivetrainOmega);

    const rawTorque = this.getTorqueAt(this.rpm);
    const friction = this.getFrictionTorque(this.angularVel);

    // Idle correction se necessário
    let idleCorrection = 0;
    if (this.rpm < this.idleRPM + 100 && this.throttlePos < 0.05) {
      idleCorrection = (this.idleRPM - this.rpm) * this.idleGain;
    }

    const netTorque = rawTorque - friction - clutchTransmitTorque + idleCorrection;

    this._applyRevLimiter();
    if (this.rpm < 0) { this.rpm = 0; this.angularVel = 0; }

    return netTorque;  // torque que sobra para acelerar o drivetrain
  }

  _interpolateTorque(rpm) {
    const c = this.torqueCurve;
    if (rpm <= c[0].r) return c[0].t;
    if (rpm >= c[c.length - 1].r) return 0;  // além do redline = 0
    for (let i = 0; i < c.length - 1; i++) {
      if (rpm >= c[i].r && rpm <= c[i + 1].r) {
        const f = (rpm - c[i].r) / (c[i + 1].r - c[i].r);
        // interpolação linear — para arcade é suficiente
        return c[i].t + f * (c[i + 1].t - c[i].t);
      }
    }
    return 0;
  }

  _applyRevLimiter() {
    if (this.rpm > this.revLimitRPM) {
      if (this.revLimitMode === 'hard') {
        this.rpm = this.revLimitRPM;
        this.angularVel = this.rpmToOmega(this.rpm);
        this._isRevLimited = true;
      } else if (this.revLimitMode === 'soft') {
        const over = this.rpm - this.revLimitRPM;
        const damp = Math.max(0, 1.0 - over * 0.01);
        this.rpm = this.revLimitRPM + over * damp;
        this.angularVel = this.rpmToOmega(this.rpm);
      } else if (this.revLimitMode === '2step') {
        // Launch control gerencia isso externamente
        this._isRevLimited = true;
      }
    } else {
      this._isRevLimited = false;
    }
  }

  setThrottle(t) { this.throttlePos = Math.max(0, Math.min(1, t)); }
  setRPM(rpm) {
    this.rpm = Math.max(0, Math.min(this.maxRPM, rpm));
    this.angularVel = this.rpmToOmega(this.rpm);
  }
  getPowerKW() { return this.getTorqueAt(this.rpm) * this.rpm * Math.PI / 30000; }

  // Bump-start: carro em movimento → transmissão gira motor → restart
  tryBumpStart(drivetrainOmega) {
    if (!this.isStalled || !this.canStall) return false;
    const bumpRPM = this.omegaToRPM(Math.abs(drivetrainOmega));
    if (bumpRPM > this.idleRPM + 200) {
      this.isStalled = false;
      this.isRunning = true;
      this.setRPM(bumpRPM);
      return true;
    }
    return false;
  }
}


// ========================================================================
// CLUTCH — Disco de Fricção
// ========================================================================

export class Clutch {
  constructor(opts = {}) {
    this.maxTorqueTransfer = opts.maxTorqueTransfer ?? 500.0;  // ~2x max engine torque
    this.engagementSpeed   = opts.engagementSpeed   ?? 8.0;    // 0-1 / segundo
    this.pedalPos          = 0;    // 0 = solto (engaged), 1 = pisado (open)
    this.wear              = 0;    // 0 = novo, 1 = gasto
    this.isSlipping        = false;
    this.slipRatio         = 0;    // engine vs transmission RPM diff
    this.temperature       = 0;    // 0-1000°C, afeta wear
  }

  setPedal(pos) {
    this.pedalPos = Math.max(0, Math.min(1, pos));
  }

  // Capacidade máxima de transferência baseada no pedal
  getMaxTransferableTorque() {
    const engaged = 1.0 - this.pedalPos;  // 1.0 = fully engaged
    const wearFactor = 1.0 - this.wear * 0.4;
    return this.maxTorqueTransfer * engaged * wearFactor;
  }

  // Torque REAL transmitido ao drivetrain
  getTransmittingTorque(engineTorque) {
    const maxTransfer = this.getMaxTransferableTorque();
    if (Math.abs(engineTorque) <= maxTransfer) {
      this.isSlipping = false;
      this.temperature *= 0.95;  // resfria rápido
      return engineTorque;  // 100% transmitido
    } else {
      this.isSlipping = true;
      this.temperature += Math.abs(engineTorque - maxTransfer) * 0.01;
      this.wear += Math.abs(engineTorque - maxTransfer) * 1e-6;  // desgaste lento
      this.temperature = Math.min(1000, this.temperature);
      this.wear = Math.min(1.0, this.wear);
      const sign = Math.sign(engineTorque);
      return sign * maxTransfer;  // Limitado pela capacidade
    }
  }

  // Estado booleano
  isEngaged() { return this.pedalPos < 0.05; }
  isDisengaged() { return this.pedalPos > 0.95; }

  // Para UI: 0.0 = no slip, 1.0 = full slip (motor decolado)
  getSlipPercentage(engineRPM, drivetrainRPM) {
    if (engineRPM < 100) return 0;
    const diff = Math.abs(engineRPM - drivetrainRPM);
    return Math.min(1.0, diff / 2000);
  }
}


// ========================================================================
// GEARBOX — Transmissão Manual com Shift Time
// ========================================================================

export class Gearbox {
  constructor(opts = {}) {
    this.gearRatios = opts.gearRatios ?? [0, -2.9, 3.6, 2.2, 1.5, 1.1, 0.85, 0.65];
    // index: 0=neutral, 1=reverse, 2=1st, 3=2nd, etc.
    this.shiftTime = opts.shiftTime ?? 0.35;     // segundos de troca
    this.currentGear = 2;  // start in 1st
    this.targetGear = 2;
    this.isShifting = false;
    this.shiftTimer = 0;
    this.shiftCooldown = 0;
    this.autoShift = opts.autoShift ?? true;

    // Shift map dinâmico
    this.upshiftBaseRPM   = opts.upshiftBaseRPM   ?? 4000;
    this.upshiftRedline   = opts.upshiftRedline   ?? 7000;
    this.downshiftBaseRPM = opts.downshiftBaseRPM ?? 2000;
    this.downshiftPower   = opts.downshiftPower   ?? 4500;
    this.reverseLockSpeed = opts.reverseLockSpeed ?? 1.0;  // m/s
  }

  getGearRatio() {
    return this.isShifting ? 0 : (this.gearRatios[this.currentGear] ?? 0);
  }

  getDrivetrainRPM(wheelOmega, finalDrive) {
    const wheelRPM = wheelOmega * 30 / Math.PI;
    return wheelRPM * Math.abs(this.getGearRatio()) * finalDrive;
  }

  getWheelOmega(engineRPM, finalDrive) {
    const ratio = this.getGearRatio();
    if (Math.abs(ratio) < 0.01) return 0;
    return (engineRPM * Math.PI / 30) / (Math.abs(ratio) * finalDrive);
  }

  shiftUp() {
    if (this.isShifting || this.currentGear >= this.gearRatios.length - 1) return false;
    this.targetGear = this.currentGear + 1;
    this._startShift();
    return true;
  }

  shiftDown() {
    if (this.isShifting || this.currentGear <= 1) return false;
    this.targetGear = this.currentGear - 1;
    this._startShift();
    return true;
  }

  setNeutral() {
    if (this.isShifting) return false;
    this.targetGear = 0;
    this._startShift();
    return true;
  }

  setReverse() {
    if (this.isShifting || this.currentGear === 1) return false;
    this.targetGear = 1;
    this._startShift();
    return true;
  }

  _startShift() {
    this.isShifting = true;
    this.shiftTimer = this.shiftTime;
  }

  update(dt, engineRPM, throttleInput, avgRearWheelOmega, finalDrive, handbrakeInput) {
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;

    if (this.isShifting) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.currentGear = this.targetGear;
        this.isShifting = false;
        this.shiftCooldown = 0.15;  // cooldown pos-troca
      }
      return;  // durante troca: gearRatio = 0
    }

    // Auto-shift
    if (this.autoShift && this.shiftCooldown <= 0 && this.currentGear >= 2) {
      const load = Math.max(0, throttleInput);
      const upshiftRPM = this.upshiftBaseRPM + load * (this.upshiftRedline - this.upshiftBaseRPM);
      const downshiftRPM = this.downshiftBaseRPM + load * (this.downshiftPower - this.downshiftBaseRPM);

      // Drift kickdown
      const kickdownRPM = 4000;

      if (engineRPM > upshiftRPM && this.currentGear < this.gearRatios.length - 1) {
        this.shiftUp();
      } else if (engineRPM < downshiftRPM && this.currentGear > 2) {
        this.shiftDown();
      } else if (handbrakeInput > 0 && engineRPM < kickdownRPM && this.currentGear > 2) {
        this.shiftDown();
      }
    }
  }

  getGearName() {
    if (this.currentGear === 0) return 'N';
    if (this.currentGear === 1) return 'R';
    return (this.currentGear - 1).toString();
  }
}


// ========================================================================
// DIFFERENTIAL — Open / Welded / LSD
// ========================================================================

export class Differential {
  constructor(opts = {}) {
    this.type = opts.type ?? 'open';  // 'open'|'welded'|'lsd'
    this.finalDrive = opts.finalDrive ?? 3.8;
    this.efficiency = opts.efficiency ?? 0.85;

    // LSD params
    this.lsdPreload     = opts.lsdPreload     ?? 50;    // Nm
    this.lsdLockRate    = opts.lsdLockRate    ?? 0.002; // lock per rad/s diff
    this.lsdMaxLock     = opts.lsdMaxLock     ?? 0.95;  // max lock ratio

    // Estado
    this.lockAmount = 0;
  }

  // Recebe torque total do motor após gearbox, retorna split L/R
  split(totalTorque, omegaLeft, omegaRight, brakeTorqueL = 0, brakeTorqueR = 0) {
    const absTotal = Math.abs(totalTorque);

    if (this.type === 'open') {
      // 50/50 fixo, como no powertrain original
      return [
        totalTorque * 0.5 * this.efficiency,
        totalTorque * 0.5 * this.efficiency
      ];
    }

    if (this.type === 'welded') {
      // Spool: força ambas as rodas a terem a mesma velocidade
      // Split é baseado na disponibilidade de tração
      // Se uma roda patina → outra recebe mais torque
      // Simplificação arcade:
      const avgOmega = (omegaLeft + omegaRight) * 0.5;
      const omegaDiff = Math.abs(omegaLeft - omegaRight);
      
      // Mais lock → mais igual
      this.lockAmount = 1.0;  // welded = sempre 100%
      
      // Para drift welded: quando uma roda acelera mais que a outra,
      // o torque não diminui — é distribuído pelo que consegue segurar
      // Simplificação: split 50/50 com damping da diferença
      const damping = Math.max(0, 1.0 - omegaDiff * 0.5);  // menos damping se dif alta
      return [
        totalTorque * 0.5 * this.efficiency * damping,
        totalTorque * 0.5 * this.efficiency * damping
      ];
    }

    if (this.type === 'lsd') {
      // Lock baseado na diferença de velocidade angular
      const omegaDiff = Math.abs(omegaLeft - omegaRight);
      this.lockAmount = Math.min(this.lsdMaxLock,
        this.lsdPreload / 1000 + this.lsdLockRate * omegaDiff);

      // Split: mais torque para a roda mais LENTA (que tem mais grip)
      let leftRatio = 0.5;
      if (omegaLeft > omegaRight) {
        // Roda esquerda girando mais rápido (menos grip) → menos torque
        leftRatio = 0.5 - (this.lockAmount - 0.5) * 0.5;
      } else if (omegaRight > omegaLeft) {
        leftRatio = 0.5 + (this.lockAmount - 0.5) * 0.5;
      }
      leftRatio = Math.max(0.1, Math.min(0.9, leftRatio));
      
      return [
        totalTorque * leftRatio * this.efficiency,
        totalTorque * (1 - leftRatio) * this.efficiency
      ];
    }

    return [0, 0];
  }
}


// ========================================================================
// TRACTION CONTROL
// ========================================================================

export class TractionControl {
  constructor(opts = {}) {
    this.mode = opts.mode ?? 'off';  // 'off'|'low'|'high'
    this.gain = opts.gain ?? 6.0;    // intensidade do corte
    this.targetSlipLow  = opts.targetSlipLow  ?? 0.08;
    this.targetSlipHigh = opts.targetSlipHigh ?? 0.18;
    this.active = false;
    this.cutLevel = 0;  // 0-1, para HUD
  }

  setMode(mode) {
    this.mode = mode;
  }

  // Retorna multiplicador de torque (0-1)
  getTorqueMultiplier(avgSlipRatio) {
    if (this.mode === 'off') {
      this.active = false;
      this.cutLevel = 0;
      return 1.0;
    }

    const target = this.mode === 'low' ? this.targetSlipLow : this.targetSlipHigh;
    const error = avgSlipRatio - target;

    if (error <= 0) {
      this.active = false;
      this.cutLevel = 0;
      return 1.0;
    }

    this.active = true;
    this.cutLevel = Math.min(1.0, error * this.gain);
    return 1.0 - this.cutLevel;
  }
}


// ========================================================================
// LAUNCH CONTROL (2-Step Rev Limiter)
// ========================================================================

export class LaunchControl {
  constructor(opts = {}) {
    this.launchRPM      = opts.launchRPM      ?? 4500;
    this.minSpeed      = opts.minSpeed       ?? 1.5;   // m/s
    this.enabled       = opts.enabled        ?? true;
    this.active        = false;
    this.engagedTimer  = 0;
  }

  update(clutchPedal, throttle, speedMS, engineRPM) {
    if (!this.enabled) {
      this.active = false;
      return false;
    }

    const shouldActivate = clutchPedal > 0.7
                        && throttle > 0.8
                        && speedMS < this.minSpeed;

    if (shouldActivate) {
      this.active = true;
      this.engagedTimer += 1;  // frames ativos (para HUD)
    } else {
      this.active = false;
      this.engagedTimer = 0;
    }

    return this.active;
  }

  // Retorna RPM limitado se ativo
  limitRPM(engineRPM) {
    if (!this.active) return engineRPM;
    return Math.min(engineRPM, this.launchRPM);
  }

  // Retorna se deve cortar injeção
  shouldCut(engineRPM) {
    return this.active && engineRPM >= this.launchRPM;
  }
}


// ========================================================================
// TURBOCHARGER
// ========================================================================

export class Turbocharger {
  constructor(opts = {}) {
    this.maxBoost       = opts.maxBoost       ?? 1.0;    // bar
    this.spoolRate      = opts.spoolRate      ?? 2.5;    // resposta do boost
    this.lagFactor      = opts.lagFactor      ?? 0.85;   // 0=lento, 1=instantâneo
    this.blowOffEnabled = opts.blowOffEnabled ?? true;

    this.boostBar = 0;     // boost atual em bar
    this.turboRPM = 0;     // RPM da turbina (para visual/sonoro)
    this.isSpooling = false;
    this._lastThrottle = 0;
  }

  update(dt, engineRPM, throttleInput) {
    // Exhaust flow → target boost
    // Quanto mais alto o rpm e mais aberto o throttle, mais boost
    const rpmNorm = Math.min(1.0, engineRPM / 7000);
    const exhaustFlow = throttleInput * Math.pow(rpmNorm, 1.3);
    const targetBoost = this.maxBoost * exhaustFlow;

    // Lag exponencial (turbo é lenta)
    this.boostBar += (targetBoost - this.boostBar) * this.spoolRate * dt * this.lagFactor;
    if (this.boostBar < 0) this.boostBar = 0;

    // Turbo shaft RPM (para efeito visual)
    this.turboRPM = this.boostBar * 150000;  // 1 bar ≈ 150k turb RPM

    // Blow-off quando solta o acelerador (dump de pressão)
    if (this.blowOffEnabled && throttleInput < 0.1 && this._lastThrottle > 0.3) {
      // Quando solta o acelerador com boost alto → hiss
      if (this.boostBar > 0.3) {
        // Blow-off event — pode disparar som/efeito
        // Aqui apenas derruba a pressão rápido
      }
      this.boostBar *= 0.3;  // dump rápido
    }

    this._lastThrottle = throttleInput;
    this.isSpooling = this.boostBar > 0.05 && targetBoost > this.boostBar;
  }

  // Torque multiplier: engineTorque *= mult
  getTorqueMultiplier() {
    // Boost em bar → pressão adicional
    // 1 bar = pressão atmosférica extra → ~30% mais torque
    return 1.0 + (this.boostBar / 1.0) * 0.35;
  }

  getBoostPSI() {
    return this.boostBar * 14.504;  // bar → PSI
  }
}


// ========================================================================
// POWERTRAIN SYSTEM (Coordinator)
// ========================================================================

export class PowertrainSystem {
  constructor(opts = {}) {
    this.engine = new Engine(opts.engine);
    this.clutch = new Clutch(opts.clutch);
    this.gearbox = new Gearbox(opts.gearbox);
    this.differential = new Differential(opts.differential);
    this.tc = new TractionControl(opts.tractionControl);
    this.launch = new LaunchControl(opts.launchControl);
    this.turbo = opts.turbo ? new Turbocharger(opts.turbo) : null;

    // Parâmetros globais
    this.finalDrive = opts.finalDrive ?? 3.8;
    this.transEfficiency = opts.transEfficiency ?? 0.82;

    // Estado interno
    this.drivetrainOmega = 0;
    this.lastWheelOmegas = [0, 0, 0, 0];
  }

  // ---------------------------------------------------------------
  // UPDATE PRINCIPAL — chamado a cada frame
  // ---------------------------------------------------------------
  update(dt, inputs, wheelData) {
    const {
      throttle = 0,
      clutchPedal = 0,
      brakeInput = 0,
      handbrake = 0,
      shiftUp = false,
      shiftDown = false,
      speedMS = 0,
    } = inputs;

    const [wFL, wFR, wRL, wRR] = wheelData;  // objetos Wheel

    // 1. Inputs → componentes
    this.engine.setThrottle(throttle);
    this.clutch.setPedal(clutchPedal);

    if (shiftUp) this.gearbox.shiftUp();
    if (shiftDown) this.gearbox.shiftDown();

    // 2. Média da velocidade das rodas motrizes (traseiras = RWD)
    const avgRearOmega = (wRL.angularVelocity + wRR.angularVelocity) * 0.5;

    // 3. Drivetrain RPM from wheels
    const drivetrainRPM = this.gearbox.getDrivetrainRPM(avgRearOmega, this.finalDrive);
    this.drivetrainOmega = avgRearOmega;

    // 4. Gearbox update (auto-shift)
    this.gearbox.update(dt, this.engine.rpm, throttle, avgRearOmega, this.finalDrive, handbrake);

    // 5. Launch control
    this.launch.update(clutchPedal, throttle, speedMS, this.engine.rpm);

    // 6. Determinar estado do clutch
    const clutchMax = this.clutch.getMaxTransferableTorque();
    const engineRawTorque = this.engine.getTorqueAt(this.engine.rpm, throttle);
    const willSlip = Math.abs(engineRawTorque) > clutchMax;

    let transmittedTorque = 0;
    let netEngineTorque = 0;

    if (this.gearbox.isShifting || this.gearbox.getGearRatio() === 0) {
      // Neutro ou trocando: motor roda livre
      transmittedTorque = 0;
      this.engine.updateFree(dt, 0, 0);
      this.clutch.isSlipping = false;

    } else if (!willSlip && this.clutch.isEngaged()) {
      // TRAVADO (locked): motor + drivetrain acoplados
      // O RPM do motor é imposto pela velocidade das rodas
      const coupledOmega = this.gearbox.getWheelOmega(this.engine.rpm, this.finalDrive);
      this.engine.angularVel = avgRearOmega * this.gearbox.getGearRatio() * this.finalDrive;
      this.engine.rpm = this.engine.omegaToRPM(this.engine.angularVel);

      transmittedTorque = this.engine.updateLocked(dt, this.engine.angularVel, 0);
      this.clutch.isSlipping = false;

    } else {
      // SLIPPANDO: motor acelera livre, torque limitado ao clutch
      transmittedTorque = this.clutch.getTransmittingTorque(engineRawTorque);
      this.engine.updateFree(dt, transmittedTorque, 0);
    }

    // 7. Traction Control
    const avgSlip = (Math.abs(wRL.slipRatio) + Math.abs(wRR.slipRatio)) * 0.5;
    const tcMult = this.tc.getTorqueMultiplier(avgSlip);
    transmittedTorque *= tcMult;

    // 8. Launch control → limita RPM
    if (this.launch.active) {
      this.engine.rpm = this.launch.limitRPM(this.engine.rpm);
      this.engine.angularVel = this.engine.rpmToOmega(this.engine.rpm);
      if (this.launch.shouldCut(this.engine.rpm)) {
        // Corte: ignição cortada → torque cai
        transmittedTorque *= 0.1;
      }
    }

    // 9. Turbo
    let turboMult = 1.0;
    if (this.turbo) {
      this.turbo.update(dt, this.engine.rpm, throttle);
      turboMult = this.turbo.getTorqueMultiplier();
      transmittedTorque *= turboMult;
    }

    // 10. Gearbox ratio → total torque after diff
    const gearRatio = this.gearbox.getGearRatio();
    const diffInputTorque = transmittedTorque * gearRatio * this.finalDrive * this.transEfficiency;

    // 11. Differential split
    const [torqueL, torqueR] = this.differential.split(
      diffInputTorque,
      wRL.angularVelocity,
      wRR.angularVelocity,
      wRL.brakeTorque,
      wRR.brakeTorque
    );

    // 12. Aplicar torques nas rodas (via return)
    return {
      wheelTorques: {
        fl: 0,  // RWD
        fr: 0,
        rl: torqueL,
        rr: torqueR,
      },
      // HUD / telemetry
      rpm: this.engine.rpm,
      gear: this.gearbox.getGearName(),
      isShifting: this.gearbox.isShifting,
      clutchSlip: this.clutch.isSlipping ? this.clutch.getSlipPercentage(this.engine.rpm, drivetrainRPM) : 0,
      tcActive: this.tc.active,
      tcCut: this.tc.cutLevel,
      launchActive: this.launch.active,
      boostPsi: this.turbo ? this.turbo.getBoostPSI() : 0,
      turboSpooling: this.turbo ? this.turbo.isSpooling : false,
      clutchTemp: this.clutch.temperature,
      clutchWear: this.clutch.wear,
    };
  }

  // ---------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------

  reset() {
    this.engine.setRPM(this.engine.idleRPM);
    this.engine.isRunning = true;
    this.engine.isStalled = false;
    this.clutch.setPedal(0);
    this.clutch.wear = 0;
    this.clutch.temperature = 0;
    this.gearbox.currentGear = 2;
    this.gearbox.targetGear = 2;
    this.gearbox.isShifting = false;
    this.tc.active = false;
    this.launch.active = false;
    if (this.turbo) {
      this.turbo.boostBar = 0;
      this.turbo.turboRPM = 0;
    }
  }

  setDifferentialType(type) {
    this.differential.type = type;
  }

  setTCMode(mode) {
    this.tc.setMode(mode);
  }
}

export default PowertrainSystem;
