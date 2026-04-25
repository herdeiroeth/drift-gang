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

    // Coast torque (engine braking quando solta o acelerador, proporcional ao RPM).
    // Em Nm @ redline. Aplicado adicionalmente à fricção quando throttle < 0.05.
    this.coastTorque        = opts.coastTorque        ?? 60.0;

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

  /**
   * Engine braking real (coast torque). Proporcional ao RPM relativo ao redline.
   * Retorna torque NEGATIVO (sempre opondo a rotação do motor).
   * Aplicado quando throttle ≈ 0 e rpm > idle, somando à fricção viscosa.
   */
  getCoastTorque(rpm) {
    if (rpm <= this.idleRPM) return 0;
    return -this.coastTorque * (rpm / this.redlineRPM);
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

    // Coast (engine braking) — só aplicado off-throttle e acima do idle
    let coast = 0;
    if (this.throttlePos < 0.05 && this.rpm > this.idleRPM) {
      coast = this.getCoastTorque(this.rpm);   // negativo
    }

    // Idle control ativo
    let idleCorrection = 0;
    if (this.rpm < this.idleRPM + 200) {
      idleCorrection = (this.idleRPM - this.rpm) * this.idleGain;
    }

    const netTorque = rawTorque - friction + coast - clutchTransmitTorque + idleCorrection;
    // semi-implicit Euler: v += a·dt (depois rpm é derivado de v).
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

    // Coast (engine braking): só off-throttle E acima do idle
    let coast = 0;
    if (this.throttlePos < 0.05 && this.rpm > this.idleRPM) {
      coast = this.getCoastTorque(this.rpm);  // negativo
    }

    // Idle correction se necessário
    let idleCorrection = 0;
    if (this.rpm < this.idleRPM + 100 && this.throttlePos < 0.05) {
      idleCorrection = (this.idleRPM - this.rpm) * this.idleGain;
    }

    const netTorque = rawTorque - friction + coast - clutchTransmitTorque + idleCorrection;

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

  // Torque REAL transmitido ao drivetrain.
  // Modelo Karnopp friction com tanh smooth: elimina o boolean "stick vs slip"
  // por uma transição contínua T_friction = T_max · tanh(k·Δω). Quando Δω≈0
  // o torque transmitido é o do motor (stick); quando Δω cresce, satura em
  // ±T_max. Isso evita chatter na fronteira stick/slip.
  getTransmittingTorque(engineTorque, deltaOmega = 0) {
    const maxTransfer = this.getMaxTransferableTorque();
    const k = 5.0;  // smoothness factor (rad/s⁻¹) — Karnopp tanh slope
    const dw = deltaOmega;
    const tanhFactor = Math.tanh(k * dw);
    // Capacidade dinâmica do clutch acompanha tanh: |Δω| pequeno → ~0
    // ⇒ permite stick (passa o engineTorque inteiro). |Δω| grande → ±maxTransfer.
    const frictionCap = maxTransfer * Math.abs(tanhFactor);
    // Stick: |Δω| pequeno, frictionCap também é pequeno mas o torque a transmitir
    // ≤ engineTorque do motor — quando |Δω| < 0.5, "stick" e passa o torque
    // demandado (limitado pelo cap absoluto).
    let transmitted;
    const stickThreshold = 0.5;  // rad/s
    const isStick = Math.abs(dw) < stickThreshold;
    if (isStick) {
      // Stick zone: clutch carrega o que o motor pede, até o teto absoluto.
      const sign = Math.sign(engineTorque) || 1;
      transmitted = sign * Math.min(Math.abs(engineTorque), maxTransfer);
    } else {
      // Slip zone: torque de fricção dominante, direção dada pelo Δω
      // (velocidade relativa: motor mais rápido → torque positivo no eixo).
      const sign = Math.sign(dw);
      transmitted = sign * Math.min(maxTransfer, Math.abs(engineTorque) + frictionCap);
      // Não pode exceder o que o motor realmente produz nessa direção.
      if (Math.sign(engineTorque) === sign) {
        transmitted = sign * Math.min(Math.abs(engineTorque), maxTransfer);
      } else {
        // engine braking contra o sentido de Δω: cap por friction
        transmitted = sign * Math.min(maxTransfer * Math.abs(tanhFactor), Math.abs(engineTorque));
      }
    }

    // Estado derivado (não mais boolean rígido — apenas heurística pra HUD/wear)
    this.isSlipping = Math.abs(dw) > stickThreshold;
    if (this.isSlipping) {
      const slipAmt = Math.abs(dw) * Math.abs(transmitted);
      this.temperature += slipAmt * 0.0005;
      this.wear += slipAmt * 5e-8;
      this.temperature = Math.min(1000, this.temperature);
      this.wear = Math.min(1.0, this.wear);
    } else {
      this.temperature *= 0.95;
    }

    return transmitted;
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
    this.mode = opts.mode ?? 'h_pattern';        // 'h_pattern' | 'sequential'
    this.shiftTime = opts.shiftTime ?? (this.mode === 'sequential' ? 0.06 : 0.35);
    this.currentGear = 2;  // start in 1st
    this.targetGear = 2;
    this.isShifting = false;
    this.shiftTimer = 0;
    this.shiftCooldown = 0;
    this.autoShift = opts.autoShift ?? true;

    // Sequential gearbox features
    this.ignitionCutDuringShift = (this.mode === 'sequential');
    // Rev-match blip: setado em downshift sequencial; PowertrainSystem usa por
    // alguns ms para forçar engine.rpm ≥ blipRPM (simula o "throttle blip").
    this.pendingEngineBlipRPM = 0;
    this.pendingBlipTimer = 0;     // segundos restantes de blip ativo

    // Shift map dinâmico
    this.upshiftBaseRPM   = opts.upshiftBaseRPM   ?? 4000;
    this.upshiftRedline   = opts.upshiftRedline   ?? 7000;
    this.downshiftBaseRPM = opts.downshiftBaseRPM ?? 2000;
    this.downshiftPower   = opts.downshiftPower   ?? 4500;
    this.reverseLockSpeed = opts.reverseLockSpeed ?? 1.0;  // m/s

    // Cache para rev-match
    this._lastWheelOmega = 0;
    this._finalDrive = opts.finalDrive ?? 3.8;
  }

  setMode(mode) {
    if (mode !== 'h_pattern' && mode !== 'sequential') return;
    this.mode = mode;
    this.shiftTime = (mode === 'sequential') ? 0.06 : 0.35;
    this.ignitionCutDuringShift = (mode === 'sequential');
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

    // Rev-match em downshift sequencial: calcula RPM esperado na nova marcha
    // e arma um blip de 100ms para o PowertrainSystem aplicar.
    if (this.mode === 'sequential') {
      const newRatio = this.gearRatios[this.targetGear] ?? 0;
      if (Math.abs(newRatio) > 0.01) {
        const wheelOmega = this._lastWheelOmega;
        const targetEngineRPM = Math.abs(wheelOmega) * Math.abs(newRatio) * this._finalDrive * 30 / Math.PI;
        this.pendingEngineBlipRPM = targetEngineRPM;
        this.pendingBlipTimer = 0.1;  // 100 ms de blip ativo
      }
    }

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

    // Cache para rev-match em downshift
    this._lastWheelOmega = avgRearWheelOmega;
    this._finalDrive = finalDrive;

    // Decay do blip de rev-match (sequencial)
    if (this.pendingBlipTimer > 0) {
      this.pendingBlipTimer -= dt;
      if (this.pendingBlipTimer <= 0) {
        this.pendingBlipTimer = 0;
        this.pendingEngineBlipRPM = 0;
      }
    }

    if (this.isShifting) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.currentGear = this.targetGear;
        this.isShifting = false;
        this.shiftCooldown = (this.mode === 'sequential') ? 0.04 : 0.15;
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

/**
 * Differential — interface AC/VPP canônica.
 * Tipos suportados: 'open' | 'welded' | 'lsd_clutch' | 'torsen'
 *
 * Aliases legados: 'lsd' → 'lsd_clutch' (compat retroativa).
 *
 * Salisbury / clutch-pack (lsd_clutch):
 *   T_lock = preload + powerLock·|T_input|·tan(45°)   se acelerando (T·ω > 0)
 *   T_lock = preload + coastLock·|T_input|·tan(60°)   se freando motor
 *   torque flui da roda mais rápida → mais lenta.
 *
 * Welded:
 *   damping forte K (ωL−ωR)/2 aplicado em sentidos opostos para
 *   forçar igualdade angular. Não é constraint rígido (eq de velocidade)
 *   mas converge rapidamente em poucos sub-steps.
 *
 * Torsen:
 *   torque bias ratio (TBR ~ 2.5–3.5 em street).
 *   Se T_low·TBR < T_high → transfere o excesso para o low-side.
 *   Comporta-se como open dentro do TBR.
 */

const TAN_POWER_ANGLE = Math.tan(45 * Math.PI / 180);   // 1.0
const TAN_COAST_ANGLE = Math.tan(60 * Math.PI / 180);   // ~1.732
const WELDED_DAMPING_K = 50000;  // N·m·s/rad — forte, mas estável

export class Differential {
  constructor(opts = {}) {
    // Aliases para compat com nomes antigos
    // Default mudou: 'open' → 'lsd_clutch' (Salisbury). Drift precisa de lockup;
    // open diff perde a roda interna e entrega torque pra zero. LSD trava parcial.
    let type = opts.type ?? 'lsd_clutch';
    if (type === 'lsd') type = 'lsd_clutch';
    this.type = type;  // 'open'|'welded'|'lsd_clutch'|'torsen'

    this.finalDrive = opts.finalDrive ?? 3.8;
    this.efficiency = opts.efficiency ?? 0.85;

    // ---- Salisbury / clutch-pack (lsd_clutch)
    // Defaults TUNADOS PRA DRIFT (eram 50 / 0.4 / 0.15):
    //   - preload 100 Nm: sempre tem alguma carga estática nos discos —
    //     elimina o "neutral patch" no centro, resposta mais previsível.
    //   - powerLock 0.65: ~65% de lockup sob aceleração — motor empurra as
    //     duas rodas ao mesmo tempo, slide sustentável power-on.
    //   - coastLock 0.45: ~45% sob desaceleração — ajuda a desestabilizar
    //     a traseira no lift-off (entry to drift) e mantém a linha em coast.
    this.preload   = opts.preload   ?? opts.lsdPreload ?? 100;    // Nm sempre aplicado
    this.powerLock = opts.powerLock ?? 0.65;  // 0=open, 1=spool — sob aceleração
    this.coastLock = opts.coastLock ?? 0.45;  // 0=open, 1=spool — em coast/motor freio

    // ---- Torsen
    this.torsenTBR = opts.torsenTBR ?? 3.0;   // street: 2.5-3.5

    // Estado (HUD/telemetria)
    this.lockAmount = 0;
  }

  /**
   * Divide o torque entre as duas rodas motrizes.
   * @param {number} totalTorque  torque na entrada do diff (após gearbox·finalDrive·efficiency)
   * @param {number} omegaLeft    velocidade angular da roda esquerda (rad/s)
   * @param {number} omegaRight   velocidade angular da roda direita (rad/s)
   * @returns {[number, number]}  [torqueL, torqueR] aplicáveis na roda
   */
  split(totalTorque, omegaLeft, omegaRight) {
    // ===== OPEN =====
    if (this.type === 'open') {
      this.lockAmount = 0;
      const half = totalTorque * 0.5 * this.efficiency;
      return [half, half];
    }

    // ===== WELDED =====
    // Aplicamos torque base 50/50 + damping fortíssimo que arrasta as duas ω
    // para a mesma média. Para evitar explosão do integrator, clampamos o
    // damping ao máximo torque que o pneu consegue reagir (μN·R, estimado ~2000 Nm).
    // Resultado: ωL ≈ ωR depois de alguns sub-steps; resíduo aceitável.
    if (this.type === 'welded') {
      this.lockAmount = 1.0;
      const omegaDiff = omegaLeft - omegaRight;
      let dampingTorque = WELDED_DAMPING_K * (omegaDiff * 0.5);
      // Clamp para o que um pneu consegue absorver realisticamente — evita
      // explosão numérica quando Δω é alto. ~2000 Nm equivale a μ·N·R com
      // μ=1, N=6kN, R=0.34m (folgado para SUV; passa a saturar pneu).
      const DAMP_CLAMP = 2000;
      if (dampingTorque >  DAMP_CLAMP) dampingTorque =  DAMP_CLAMP;
      if (dampingTorque < -DAMP_CLAMP) dampingTorque = -DAMP_CLAMP;
      const baseHalf = totalTorque * 0.5 * this.efficiency;
      return [
        baseHalf - dampingTorque,
        baseHalf + dampingTorque,
      ];
    }

    // ===== LSD CLUTCH (Salisbury) =====
    if (this.type === 'lsd_clutch') {
      const isPower = totalTorque > 0;  // power-on (acelerando)
      const tan = isPower ? TAN_POWER_ANGLE : TAN_COAST_ANGLE;
      const ramp = isPower ? this.powerLock : this.coastLock;
      const T_lock = this.preload + ramp * Math.abs(totalTorque) * tan;
      this.lockAmount = Math.min(1.0, T_lock / Math.max(1, Math.abs(totalTorque) + this.preload));

      const baseHalf = totalTorque * 0.5 * this.efficiency;
      const omegaDiff = omegaLeft - omegaRight;

      // direção do transfer: torque vai pra roda MAIS LENTA
      // se ωL > ωR: left é o "fast" → tira torque do left, dá pro right
      // T_transfer no máximo = T_lock/2 (cada lado recebe ±T_lock/2 de redistribuição)
      const transferMag = Math.min(Math.abs(T_lock) * 0.5, Math.abs(baseHalf) * 2);
      const sign = Math.sign(omegaDiff);   // +1 se left mais rápido
      return [
        baseHalf - sign * transferMag,
        baseHalf + sign * transferMag,
      ];
    }

    // ===== TORSEN =====
    // Comporta como open enquanto |T_high / T_low| ≤ TBR.
    // Quando excede, transfere o excesso pro lado low.
    // Limitação real: se uma roda perde contato (omega disparando), o lock colapsa.
    if (this.type === 'torsen') {
      // Estimativa: o lado com ω maior é o "spinning" (low grip).
      // No regime de open (sem evento de spin), divide 50/50.
      // Quando omegaDiff é alta, simulamos o torque-bias bias usando a magnitude
      // da diferença como proxy do "torque que cada roda 'pede'".
      const omegaDiff = Math.abs(omegaLeft - omegaRight);
      const TBR = this.torsenTBR;

      // Se rodas próximas em ω: open. Se uma dispara, transfere até TBR:1.
      // Threshold: ~ 5 rad/s = ~50rpm de roda; ajustável.
      const spinThreshold = 2.0;
      const lockRatio = Math.min(1.0, Math.max(0, (omegaDiff - spinThreshold) / 5.0));
      this.lockAmount = lockRatio;

      // Lado mais lento ganha torque até TBR vezes o do mais rápido
      // T_low = totalTorque * (TBR / (TBR + 1))   no limite (lockRatio=1)
      // T_high = totalTorque * (1 / (TBR + 1))
      const baseHalf = 0.5;
      const lowFrac  = baseHalf + lockRatio * (TBR / (TBR + 1) - baseHalf);
      const highFrac = 1 - lowFrac;

      const omegaDiffSigned = omegaLeft - omegaRight;
      const eff = this.efficiency;
      if (omegaDiffSigned > 0) {
        // left = fast (high RPM, low grip) → menos torque
        return [totalTorque * highFrac * eff, totalTorque * lowFrac * eff];
      } else {
        return [totalTorque * lowFrac * eff, totalTorque * highFrac * eff];
      }
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
    this.armed         = opts.armed          ?? false; // toggle manual (KeyL)
    this.active        = false;
    this.engagedTimer  = 0;
  }

  update(clutchPedal, throttle, speedMS, engineRPM) {
    if (!this.enabled || !this.armed) {
      this.active = false;
      this.engagedTimer = 0;
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
  // AC modding standard: 1 bar de boost = +100% torque.
  // MAX_BOOST=1.5 (default Turbo) ⇒ até +150% no peak.
  getTorqueMultiplier() {
    return 1.0 + this.boostBar;
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

    // 6. Determinar estado do clutch (Karnopp tanh model)
    // Δω = engineOmega - drivetrainOmega·gearRatio·finalDrive (em rad/s).
    const ptGearRatio = this.gearbox.getGearRatio();
    const drivetrainSideOmega = avgRearOmega * ptGearRatio * this.finalDrive;
    const deltaOmega = this.engine.angularVel - drivetrainSideOmega;
    const engineRawTorque = this.engine.getTorqueAt(this.engine.rpm, throttle);

    let transmittedTorque = 0;

    if (this.gearbox.isShifting || ptGearRatio === 0) {
      // Neutro ou trocando: ignição cortada (já é gearRatio=0). No sequential,
      // explicitamos que torque transmitido = 0 (ignition cut).
      transmittedTorque = 0;
      this.engine.updateFree(dt, 0, 0);
      this.clutch.isSlipping = false;

    } else if (Math.abs(deltaOmega) < 0.5 && this.clutch.isEngaged() && Math.abs(avgRearOmega) > 0.5) {
      // STICK (Δω≈0 e clutch fechado e movendo): motor + drivetrain acoplados.
      // Sincroniza engine ao drivetrain.
      this.engine.angularVel = drivetrainSideOmega;
      this.engine.rpm = this.engine.omegaToRPM(this.engine.angularVel);

      transmittedTorque = this.engine.updateLocked(dt, this.engine.angularVel, 0);
      // Para HUD: stick zone — sem slip percebido
      this.clutch.isSlipping = false;
      this.clutch.temperature *= 0.95;

    } else {
      // SLIP ou parado: torque transmitido via Karnopp (tanh smooth)
      transmittedTorque = this.clutch.getTransmittingTorque(engineRawTorque, deltaOmega);
      this.engine.updateFree(dt, transmittedTorque, 0);
    }

    // Rev-match blip (sequencial): força engine.rpm pra cima durante 100ms
    // após um downshift, simulando throttle blip automático.
    if (this.gearbox.pendingBlipTimer > 0 && this.gearbox.pendingEngineBlipRPM > 0) {
      if (this.engine.rpm < this.gearbox.pendingEngineBlipRPM) {
        this.engine.rpm = this.gearbox.pendingEngineBlipRPM;
        this.engine.angularVel = this.engine.rpmToOmega(this.engine.rpm);
      }
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
      gearboxMode: this.gearbox.mode,
      clutchSlip: this.clutch.isSlipping ? this.clutch.getSlipPercentage(this.engine.rpm, drivetrainRPM) : 0,
      tcActive: this.tc.active,
      tcCut: this.tc.cutLevel,
      launchActive: this.launch.active,
      launchArmed: this.launch.armed,
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
