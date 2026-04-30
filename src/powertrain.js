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
    // Curva de torque turbo 1.8L tunado (~390cv @ 6000 com boost ~0.8 bar).
    // Característica turbo: subida rápida do torque com o boost (1500-3500),
    // PLATEAU sustentado de peak torque entre 3500-4500 (limite mecânico do turbo),
    // depois cai gradualmente — peak power perto de 5500-6000.
    // Antes a curva caía cedo demais (NA-like) e o carro perdia força acima de 4500.
    this.torqueCurve = opts.torqueCurve ?? [
      { r: 900,  t: 250 },
      { r: 1500, t: 360 },
      { r: 2500, t: 480 },
      { r: 3500, t: 540 },   // peak torque
      { r: 4500, t: 540 },   // plateau (turbo limit)
      { r: 5500, t: 510 },   // peak power (~390 cv)
      { r: 6500, t: 450 },
      { r: 7200, t: 380 },
    ];

    this.idleRPM        = opts.idleRPM        ?? 900;
    this.redlineRPM     = opts.redlineRPM     ?? 7200;
    this.maxRPM         = opts.maxRPM         ?? 7500;
    this.stallRPM       = opts.stallRPM       ?? 400;
    this.canStall       = opts.canStall       ?? true;

    // Inércia rotacional do motor em kg·m²
    this.inertia        = opts.inertia        ?? 0.18;

    // Curvas de fricção interna (3 componentes).
    // frictionTorque = passive + linear*w + quadratic*w². Defaults turbo
    // tunado: passive 14, linear 0.010, quadratic 1.4e-5 — somam ~35Nm em
    // 7000rpm. Antes (22+0.014w+2e-5w²) somavam ~50Nm e o topo da potência
    // sumia.
    this.frictionPassive    = opts.frictionPassive    ?? 14.0;
    this.frictionLinear     = opts.frictionLinear     ?? 0.010;
    this.frictionQuadratic  = opts.frictionQuadratic  ?? 1.4e-5;

    // Coast torque (engine braking quando solta o acelerador, proporcional ao RPM).
    // Em Nm @ redline. Refs: motor 2.0L NA real ~150-220 Nm de freio motor @ redline,
    // turbo de série ~120-180 (válvulas mais leves). Aplicado quando throttle < 0.05.
    this.coastTorque        = opts.coastTorque        ?? 180.0;

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

  // Estado livre (neutro, embreagem aberta, ou slip).
  // turboMult: multiplicador de boost a aplicar SOBRE o torque da curva
  //   (1.0 = sem turbo; 1.8 = +0.8 bar). Mantém a integração da omega coerente
  //   com o torque que efetivamente sai do motor (cilindros + turbina).
  updateFree(dt, clutchTransmitTorque = 0, externalLoadTorque = 0, turboMult = 1.0) {
    if (!this.isRunning) {
      if (this.isStalled) this.rpm = 0;
      return 0;
    }

    const w = this.angularVel;
    const rawTorque = this.getTorqueAt(this.rpm) * turboMult;
    const friction = this.getFrictionTorque(w);

    let coast = 0;
    if (this.throttlePos < 0.05 && this.rpm > this.idleRPM) {
      coast = this.getCoastTorque(this.rpm);   // negativo
    }

    let idleCorrection = 0;
    if (this.rpm < this.idleRPM + 200) {
      idleCorrection = (this.idleRPM - this.rpm) * this.idleGain;
    }

    const netTorque = rawTorque - friction + coast - clutchTransmitTorque + idleCorrection;
    this.angularVel += (netTorque / this.inertia) * dt;
    this.rpm = this.omegaToRPM(this.angularVel);

    this._applyRevLimiter();

    if (this.canStall && this.rpm < this.stallRPM && !this._clutchEngaged) {
      // Stall handling externo (PowertrainSystem)
    }

    if (this.rpm < 0) { this.rpm = 0; this.angularVel = 0; }

    return rawTorque;  // torque bruto produzido (com boost)
  }

  // Estado acoplado (locked ao drivetrain). turboMult aplicado ao raw da curva.
  updateLocked(dt, drivetrainOmega, clutchTransmitTorque, turboMult = 1.0) {
    if (!this.isRunning) return 0;

    this.angularVel = drivetrainOmega;
    this.rpm = this.omegaToRPM(drivetrainOmega);

    const rawTorque = this.getTorqueAt(this.rpm) * turboMult;
    const friction = this.getFrictionTorque(this.angularVel);

    let coast = 0;
    if (this.throttlePos < 0.05 && this.rpm > this.idleRPM) {
      coast = this.getCoastTorque(this.rpm);  // negativo
    }

    let idleCorrection = 0;
    if (this.rpm < this.idleRPM + 100 && this.throttlePos < 0.05) {
      idleCorrection = (this.idleRPM - this.rpm) * this.idleGain;
    }

    const netTorque = rawTorque - friction + coast - clutchTransmitTorque + idleCorrection;

    this._applyRevLimiter();
    if (this.rpm < 0) { this.rpm = 0; this.angularVel = 0; }

    return netTorque;  // torque líquido (com boost) — vai pro drivetrain
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

  // Torque REAL transmitido ao drivetrain (Karnopp friction model puro).
  //
  // Em **slip** (|Δω| ≥ stickThreshold): T = sign(Δω) · maxTransfer · |tanh(k·Δω)|.
  //   O tanh modula a magnitude SEMPRE — não só em casos especiais — gerando a
  //   curva suave que dá sensação de "engatar progressivo". Sinal sempre na
  //   direção que reduz Δω (motor mais rápido ⇒ torque flui motor→drivetrain).
  //   Capamos pelo torque do motor SE motor empurra na mesma direção e produz
  //   menos que o friction (caso contrário, friction puro sustenta o torque).
  //
  // Em **stick** (|Δω| < stickThreshold): clutch lock — passa o torque que o
  //   motor produz, capado em maxTransfer. O sync ω_engine = ω_drivetrain é
  //   feito externamente em `PowertrainSystem.updateLocked` (rebatendo a
  //   velocidade angular do motor para a do drivetrain).
  //
  // O transição slip→stick agora é contínua porque tanh(k·0.5) = tanh(2.5) ≈
  // 0.987 — quase saturado quando entra no stick threshold, evitando notch.
  getTransmittingTorque(engineTorque, deltaOmega = 0) {
    const maxTransfer = this.getMaxTransferableTorque();
    const k = 5.0;
    const stickThreshold = 0.5;
    const dw = deltaOmega;
    const isStick = Math.abs(dw) < stickThreshold;

    let transmitted;
    if (isStick) {
      const sign = Math.sign(engineTorque) || 1;
      transmitted = sign * Math.min(Math.abs(engineTorque), maxTransfer);
    } else {
      const tanhFactor = Math.tanh(k * dw);
      const frictionMag = maxTransfer * Math.abs(tanhFactor);
      const sign = Math.sign(dw);
      // Cap por engine torque: se motor empurra na mesma direção do friction
      // e produz MENOS que o friction max, motor é o limitante. Caso contrário
      // (motor freando ou motor produzindo mais que friction), o friction
      // sustenta sozinho — saturado em frictionMag.
      let mag = frictionMag;
      if (Math.sign(engineTorque) === sign && Math.abs(engineTorque) < frictionMag) {
        mag = Math.abs(engineTorque);
      }
      transmitted = sign * mag;
    }

    // Estado derivado (HUD/wear — boolean apenas heurístico).
    this.isSlipping = !isStick;
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
    this.upshiftRedline   = opts.upshiftRedline   ?? 6800;
    this.downshiftBaseRPM = opts.downshiftBaseRPM ?? 1800;
    this.downshiftPower   = opts.downshiftPower   ?? 4200;
    this.reverseLockSpeed = opts.reverseLockSpeed ?? 1.0;  // m/s

    // Cache para rev-match e gating
    this._lastWheelOmega = 0;
    this._finalDrive = opts.finalDrive ?? 3.8;

    // Limites de RPM pra gating (setados externamente pelo PowertrainSystem
    // a partir do Engine; deixa um default razoável caso seja usado isolado).
    this.engineMaxRPM = opts.engineMaxRPM ?? 7500;
    this.engineRedlineRPM = opts.engineRedlineRPM ?? 7200;
    this.engineIdleRPM = opts.engineIdleRPM ?? 900;

    // Gating thresholds (vêm do PHYSICS_CFG via PowertrainSystem).
    this.overrevMarginRPM     = opts.overrevMarginRPM     ?? 250;
    this.minRPMAfterUpshift   = opts.minRPMAfterUpshift   ?? 1700;
    this.minPostUpshiftRPM    = opts.minPostUpshiftRPM    ?? 2400;

    // Estado pra HUD: motivo do último shift recusado + timer de exibição.
    this.lastBlockedReason = null;       // 'overrev' | 'bog' | 'cooldown' | null
    this.lastBlockedTimer = 0;
  }

  // RPM previsto se entrássemos numa marcha específica AGORA.
  // wheelOmega: rad/s na roda traseira média.
  projectedRPMInGear(gearIdx, wheelOmega = this._lastWheelOmega, finalDrive = this._finalDrive) {
    const ratio = this.gearRatios[gearIdx] ?? 0;
    if (Math.abs(ratio) < 0.01) return 0;
    return Math.abs(wheelOmega) * Math.abs(ratio) * finalDrive * 30 / Math.PI;
  }

  _flagBlocked(reason) {
    this.lastBlockedReason = reason;
    this.lastBlockedTimer = 0.9;  // 900 ms de exibição na HUD
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

  // Gating realista (Forza/AC). Retorna `true` se o shift foi aceito,
  // `false` (com lastBlockedReason setado) caso contrário.
  // `force` ignora gating de RPM mas mantém limites estruturais (range / cooldown).
  shiftUp(force = false) {
    if (this.isShifting) { this._flagBlocked('cooldown'); return false; }
    if (this.shiftCooldown > 0) { this._flagBlocked('cooldown'); return false; }
    if (this.currentGear >= this.gearRatios.length - 1) return false;

    const next = this.currentGear + 1;

    if (!force && this.currentGear >= 2) {
      // Bog protection: se o RPM previsto na próxima marcha for absurdamente baixo,
      // e estamos em movimento (wheelOmega não desprezível), recusa.
      // Em standstill (wheelOmega ≈ 0) não bloqueia — driver pode estar
      // pré-selecionando 2ª/3ª no clutch para um launch.
      const wheelOmegaAbs = Math.abs(this._lastWheelOmega);
      if (wheelOmegaAbs > 1.0) {
        const projected = this.projectedRPMInGear(next, this._lastWheelOmega, this._finalDrive);
        if (projected < this.engineIdleRPM * 0.85) {
          this._flagBlocked('bog');
          return false;
        }
      }
    }

    this.targetGear = next;
    this._startShift();
    return true;
  }

  shiftDown(force = false) {
    if (this.isShifting) { this._flagBlocked('cooldown'); return false; }
    if (this.shiftCooldown > 0) { this._flagBlocked('cooldown'); return false; }
    if (this.currentGear <= 1) return false;

    const prev = this.currentGear - 1;

    if (!force && prev >= 2) {
      // Over-rev protection: usa engineRPM ATUAL projetado pra nova ratio.
      // Antes usava `_lastWheelOmega` (= slowestRearOmega), que em wheelspin
      // assimétrico ficava em zero → projected=0 → "passa", motor explodia
      // ao engatar marcha menor. Agora: motor real × ratio_new / ratio_old
      // = motor RPM no novo gear, garantido sem assumptions de wheel ω.
      const oldRatio = this.gearRatios[this.currentGear] ?? 0;
      const newRatio = this.gearRatios[prev] ?? 0;
      if (Math.abs(oldRatio) > 0.01 && Math.abs(newRatio) > 0.01) {
        const projectedEngineRPM = this._lastEngineRPM
          * (Math.abs(newRatio) / Math.abs(oldRatio));
        if (projectedEngineRPM > this.engineMaxRPM + this.overrevMarginRPM) {
          this._flagBlocked('overrev');
          return false;
        }
      }
    }

    this.targetGear = prev;

    // Rev-match em downshift sequencial: calcula RPM esperado na nova marcha
    // e arma um blip de 100ms para o PowertrainSystem aplicar.
    if (this.mode === 'sequential') {
      const newRatio = this.gearRatios[this.targetGear] ?? 0;
      if (Math.abs(newRatio) > 0.01) {
        const targetEngineRPM = Math.abs(this._lastWheelOmega) * Math.abs(newRatio) * this._finalDrive * 30 / Math.PI;
        // Clamp ao redline pra blip nunca empurrar acima do limit (gating já filtrou).
        this.pendingEngineBlipRPM = Math.min(targetEngineRPM, this.engineRedlineRPM);
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

  // Auto-shift agora é DELEGADO para a ECU (PowertrainSystem chama `ecu.decide`
  // e injeta o resultado via `_autoShiftCommand` antes de `Gearbox.update`).
  // Esta função cuida só de timers de shift (timer/cooldown) + execução do
  // comando recebido. A lógica de quando subir/descer mora na ECU.
  update(dt, engineRPM, _throttleInput, avgRearWheelOmega, finalDrive, _handbrakeInput, _clutchSlipping = false) {
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;
    if (this.lastBlockedTimer > 0) {
      this.lastBlockedTimer -= dt;
      if (this.lastBlockedTimer <= 0) this.lastBlockedReason = null;
    }

    // Cache para rev-match em downshift e gating de RPM previsto
    this._lastWheelOmega = avgRearWheelOmega;
    this._finalDrive = finalDrive;
    this._lastEngineRPM = engineRPM ?? 0;  // p/ overrev gating no shiftDown

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
        // Cooldown CURTO — debounce/lockout da ECU já protegem contra hunting.
        // Cooldown aqui só evita que dois comandos sejam executados no mesmo
        // sub-step (limite estrutural).
        this.shiftCooldown = (this.mode === 'sequential')
          ? this._cooldownSeq : this._cooldownH;
      }
      return;  // durante troca: gearRatio = 0
    }

    // Comando da ECU (setado via `setAutoShiftCommand` antes deste update).
    if (this.autoShift && this.shiftCooldown <= 0 && this._autoShiftCommand) {
      if (this._autoShiftCommand === 'up') {
        this.shiftUp();
      } else if (this._autoShiftCommand === 'down') {
        this.shiftDown();
      }
      this._autoShiftCommand = null;
    }
  }

  // Recebe a decisão da ECU. Limpa após processar no próximo update.
  setAutoShiftCommand(cmd) {
    this._autoShiftCommand = cmd;
  }

  // Cache mutável dos cooldowns (PowertrainSystem injeta a partir de PHYSICS_CFG)
  get _cooldownH() { return this._cdH ?? 0.55; }
  set _cooldownH(v) { this._cdH = v; }
  get _cooldownSeq() { return this._cdSeq ?? 0.18; }
  set _cooldownSeq(v) { this._cdSeq = v; }

  // Progresso da troca (0 = recém começou, 1 = completa). 0 quando idle.
  get shiftProgress() {
    if (!this.isShifting || this.shiftTime <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.shiftTimer / this.shiftTime));
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
// Baumgarte stabilization constants para welded diff. Em vez do K=50000
// fixo + clamp 2000 (que causava deadlock em Δω > 0.08 rad/s), agora o
// damping segue o solver Havok: τ = constante de tempo do constraint
// (~5ms = 3-5 sub-steps a 1000Hz), I_eff_avg = inércia média no eixo
// traseiro acoplada ao motor.
const WELDED_TAU       = 0.005;   // s — converge ω_L = ω_R em ~3·τ = 15ms
const WELDED_I_EFF_AVG = 2.0;     // kg·m² — estimativa I_wheel + I_engine_reflected
const WELDED_DAMP_CLAMP = 4000;   // Nm — sanidade (2 pneus mu=1.2 N=5kN R=0.34)

export class Differential {
  constructor(opts = {}) {
    // Aliases para compat com nomes antigos
    // Default mudou: 'open' → 'lsd_clutch' (Salisbury). Drift precisa de lockup;
    // open diff perde a roda interna e entrega torque pra zero. LSD trava parcial.
    let type = opts.type ?? 'lsd_clutch';
    if (type === 'lsd') type = 'lsd_clutch';
    this.type = type;  // 'open'|'welded'|'lsd_clutch'|'torsen'

    this.finalDrive = opts.finalDrive ?? 3.8;
    // Eficiência mecânica do diff (rolamentos + atrito interno). Real ~0.94-0.96.
    // Antes 0.85 era pessimista demais (combinado com transEfficiency 0.82
    // dava 0.697, perdendo 30% do torque do motor — carro ficava "fraco").
    this.efficiency = opts.efficiency ?? 0.95;

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

    // ===== WELDED — Baumgarte stabilization =====
    // Constraint kinemático: ω_L = ω_R. Implementado via penalty viscoso
    // (D·Δω) com D escalado pelo dt do sub-step do powertrain — recipe Havok:
    //   τ = constante de tempo do constraint (≈ 3-5 sub-steps)
    //   D = 2·I_eff/τ (criticamente amortecido; sem termo K porque não temos
    //                   estado angular relativo, só velocidade)
    // Resultado: ω_L → ω_R em ~3·τ = 15ms, sem o "deadlock" que K fixo + clamp
    // 2000 Nm causava (ativava em Δω > 0.08 rad/s e travava o transfer).
    if (this.type === 'welded') {
      this.lockAmount = 1.0;
      const omegaDiff = omegaLeft - omegaRight;
      const D = (2 * WELDED_I_EFF_AVG) / WELDED_TAU;   // ~800 N·m·s/rad
      let dampingTorque = D * (omegaDiff * 0.5);
      if (dampingTorque >  WELDED_DAMP_CLAMP) dampingTorque =  WELDED_DAMP_CLAMP;
      if (dampingTorque < -WELDED_DAMP_CLAMP) dampingTorque = -WELDED_DAMP_CLAMP;
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

  update(dt, engineRPM, throttleInput, wheelEngagement = 1.0) {
    // Exhaust flow → target boost
    // Quanto mais alto o rpm e mais aberto o throttle, mais boost.
    // wheelEngagement (0..1) atenua o exhaustFlow quando o drivetrain não
    // está acompanhando o motor (clutch slipping em arrancada): sem essa
    // atenuação, o turbo spoolava para 0.8 bar em standstill com motor
    // alto, e na hora que a roda finalmente engatava, vinha pancada de
    // torque desproporcional (wheelie/instabilidade na arrancada).
    const rpmNorm = Math.min(1.0, engineRPM / 7000);
    const exhaustFlow = throttleInput * Math.pow(rpmNorm, 1.3) * wheelEngagement;
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
// ECU — Central de Injeção Programável (estilo FuelTech FT450/600)
// ========================================================================
//
// Decide quando subir/descer marcha lendo:
//   - drivetrainRPM (RPM virtual da roda — sinal MAIS confiável que engineRPM
//     pois evita "decolagem" em arrancada/burnout)
//   - throttle position (TPS), 0..1
//   - rear slip angle (rad) — pra inibir upshift em drift sustentado
//
// Tabela: por marcha atual N, define `upWOT/upCruise/downWOT/downCruise`.
// Em throttle parcial, faz lerp linear (igual TCUs reais — que internamente
// armazenam a tabela 2D RPM × TPS interpolada do mesmo jeito).
//
// Defesas anti-hunting:
//   - Debounce temporal: o threshold tem que ficar excedido por X ms antes
//     de aceitar a troca (filtra picos de RPM em transientes pós-shift).
//   - Anti-hunt lockout: pós-shift, downshift fica bloqueado por Y ms a menos
//     que sigRPM colapse abaixo de `down × 0.85` (kickdown / freada forte).
//   - Drift inhibit: upshift bloqueado se rear slip angle > threshold por Z ms.
//   - Kickdown: throttle > 92% + sigRPM baixo força downshift ignorando lockout.
//
// Refs:
//   - Patente Chrysler US5669850A (Shift Hunting Prevention)
//   - MegaShift / EFILive shift table tuning (hysteresis 400-600 RPM mínima)
//   - FuelTech FTManager — shift cut, shift delay, shift dwell
// ========================================================================

export class ECU {
  constructor(opts = {}) {
    // Shift map. Chave = currentGear (índice no array gearRatios: 2=1ª, 3=2ª, ...).
    // Cada entrada controla a transição PARA a próxima marcha, e o downshift
    // PARA voltar à atual quando estamos uma acima.
    //
    // Defaults calibrados pra motor 1.8L turbo @ redline 7200, peak power 5500.
    // Garantem margem de hunting ≥ 440 RPM em WOT (ver PESQUISA_SHIFT_LOGIC_REAL.md).
    this.shiftMap = opts.shiftMap ?? {
      2: { upWOT: 6500, upCruise: 3000, downWOT: 3500, downCruise: 1700 },  // 1ª↔2ª
      3: { upWOT: 6300, upCruise: 2800, downWOT: 3700, downCruise: 1700 },  // 2ª↔3ª
      4: { upWOT: 6200, upCruise: 2600, downWOT: 3900, downCruise: 1700 },  // 3ª↔4ª
      5: { upWOT: 6000, upCruise: 2400, downWOT: 4000, downCruise: 1700 },  // 4ª↔5ª
      6: { upWOT: 5800, upCruise: 2200, downWOT: 4000, downCruise: 1700 },  // 5ª↔6ª
    };

    // Janelas temporais (ms → s internamente)
    this.upshiftDebounceMs   = opts.upshiftDebounceMs   ?? 180;
    this.downshiftDebounceMs = opts.downshiftDebounceMs ?? 220;
    this.antiHuntLockoutMs   = opts.antiHuntLockoutMs   ?? 700;
    this.driftDwellMs        = opts.driftDwellMs        ?? 300;

    // Kickdown
    this.kickdownThrottle = opts.kickdownThrottle ?? 0.92;  // TPS pra ativar kickdown
    this.kickdownRPMRatio = opts.kickdownRPMRatio ?? 1.30;  // sigRPM < down·1.3 → desce

    // Drift inhibit
    this.inhibitUpshiftInDrift = opts.inhibitUpshiftInDrift ?? true;
    this.driftSlipThreshold    = opts.driftSlipThreshold    ?? 0.25;  // rad

    // Rev limit RPM — usado no override "wheelspinHigh em redline" para
    // permitir upshift mesmo com wheelspin quando o motor não tem onde subir.
    // PowertrainSystem injeta o valor real do Engine.revLimitRPM.
    this._revLimitRPM = opts.revLimitRPM ?? 7200;

    // Estado interno (s)
    this._upTimer    = 0;
    this._downTimer  = 0;
    this._lockoutTimer = 0;
    this._driftTimer = 0;
    this._lastDir    = 0;   // -1 = down, +1 = up, 0 = idle

    // Telemetria (HUD): última decisão e thresholds dinâmicos resolvidos.
    this.lastUpThreshold   = 0;
    this.lastDownThreshold = 0;
    this.lastDecision = null;     // 'up' | 'down' | null
    this.lastInhibitReason = null; // 'drift' | 'lockout' | 'debounce' | null
  }

  // Resolve thresholds ativos para a marcha atual e throttle.
  resolveThresholds(currentGear, throttle) {
    const map = this.shiftMap[currentGear];
    if (!map) return { up: Infinity, down: 0 };
    const t = Math.max(0, Math.min(1, throttle));
    const up   = map.upCruise   + t * (map.upWOT   - map.upCruise);
    const down = map.downCruise + t * (map.downWOT - map.downCruise);
    return { up, down };
  }

  // Avalia uma vez por sub-step. Retorna 'up' | 'down' | null.
  // ctx: { throttle, engineRPM, drivetrainRPM, clutchSlipping, currentGear,
  //         isShifting, rearSlipAngle, handbrake }
  decide(dt, ctx) {
    const {
      throttle,
      engineRPM,
      drivetrainRPM,
      clutchSlipping,  // mantido p/ debug
      currentGear,
      isShifting,
      rearSlipAngle,
      rearSlipRatio,   // NOVO: inibe upshift em wheelspin alto
      handbrake,
    } = ctx;
    // Sinais RPM SEPARADOS por direção do shift:
    //
    //   - sigUp = engineRPM: motor é o que decide upshift. Em wheelspin
    //     sustentado, motor sobe a redline, mas o `wheelspinHigh` flag
    //     inibe upshift falso. Em cruise, engine ≈ drivetrain.
    //
    //   - sigDown = drivetrainRPM: drivetrain (= ω_roda real · gear · fd)
    //     é o que decide downshift. Por que NÃO engineRPM:
    //       a) Em wheelspin com carro PARADO ou destracionado e WOT, motor
    //          fica em redline (rev limiter), drivetrain≈0 → downshift
    //          cascata para 1ª, restaurando força (caso reportado: "perde
    //          traseira, fica em 6ª sem força pra voltar").
    //       b) Em coast (engine brake), engine cai junto com drivetrain →
    //          downshift normal funciona.
    //       c) Curva onde pneu perde tração: drivetrain cai (roda freia
    //          contra centrípeta) → ECU desce, motor canta pneu, recupera.
    //
    // Antes (sigRPM = engineRPM SEMPRE) o motor em redline em wheelspin
    // mantinha sig acima do down threshold, ECU nunca descia, carro
    // travava em alta marcha sem torque.
    const sigUp = engineRPM ?? 0;
    const sigDown = drivetrainRPM ?? 0;
    // Wheelspin alto: rearSlipRatio > 0.5 = roda girando >50% mais rápido que
    // o esperado pela velocidade. Threshold conservador — slipRatio normal de
    // arrancada é 0.1-0.3.
    //
    // Override de redline: em 1ª-3ª, motor pode estar saturado em redline com
    // wheelspin (asfalto WOT em arrancada). Sem override, carro trava em
    // baixa marcha porque upshift fica permanentemente bloqueado.
    //
    // Em 4ª+ NÃO há override — wheelspin sustentado em alta marcha indica
    // que o pneu não dá conta do gear, e upshift agrava (gear ainda mais
    // alto = menos torque na roda = mais wheelspin saturado = velocidade
    // CAI). Mantém o motor em peak power band do gear atual.
    const inRevLimitZone = (engineRPM ?? 0) >= (this._revLimitRPM ?? 7200) * 0.95;
    const allowRedlineOverride = inRevLimitZone && currentGear <= 4;  // 1ª, 2ª, 3ª
    const wheelspinHigh = ((rearSlipRatio ?? 0) > 0.5) && !allowRedlineOverride;

    // Decai lockout sempre
    if (this._lockoutTimer > 0) this._lockoutTimer = Math.max(0, this._lockoutTimer - dt);

    // Drift dwell (acumula tempo em slip alto)
    const slipAbs = Math.abs(rearSlipAngle ?? 0);
    if (slipAbs > this.driftSlipThreshold) {
      this._driftTimer = Math.min(this.driftDwellMs / 1000 * 2, this._driftTimer + dt);
    } else {
      this._driftTimer = Math.max(0, this._driftTimer - dt * 2);
    }
    const driftSustained = this._driftTimer >= this.driftDwellMs / 1000;

    this.lastDecision = null;
    this.lastInhibitReason = null;

    if (isShifting || currentGear < 2) {
      this._upTimer = 0;
      this._downTimer = 0;
      return null;
    }

    const { up, down } = this.resolveThresholds(currentGear, throttle);
    this.lastUpThreshold = up;
    this.lastDownThreshold = down;

    // -------------- UPSHIFT (sigUp = engineRPM) --------------
    // Inibe se há wheelspin alto: motor decolou além das rodas, subir gear
    // só piora (motor cai em RPM e roda continua patinando). Aguarda o pneu
    // engatar antes de upshift. Mantém engine no peak power band.
    if (sigUp > up) {
      this._upTimer += dt;
      this._downTimer = 0;
      const dwellOK = this._upTimer >= this.upshiftDebounceMs / 1000;
      const driftOK = !(this.inhibitUpshiftInDrift && driftSustained);
      const spinOK = !wheelspinHigh;
      if (!dwellOK) {
        this.lastInhibitReason = 'debounce';
      } else if (!driftOK) {
        this.lastInhibitReason = 'drift';
      } else if (!spinOK) {
        this.lastInhibitReason = 'wheelspin';
      } else {
        this._upTimer = 0;
        this._lastDir = 1;
        this._lockoutTimer = this.antiHuntLockoutMs / 1000;
        this.lastDecision = 'up';
        return 'up';
      }
    } else {
      this._upTimer = 0;
    }

    // -------------- KICKDOWN (sigUp=engineRPM, com lockout) --------------
    // Player pisa fundo num cruzeiro lento: motor está abaixo do peak,
    // ECU desce 1 gear pra trazer motor pra zona de torque alta.
    //
    // Sinal: usar **engineRPM** (não drivetrainRPM). Em wheelspin com motor
    // em redline, drivetrainRPM caía abaixo de down·1.3 e tripava kickdown
    // PARADOXAL — motor já no peak mas ECU descia gear, hunting eterno
    // 2-3-2-3-2.
    //
    // Lockout: respeita `_lockoutTimer` (700ms anti-hunt). Antes, kickdown
    // ignorava o lockout — logo após upshift 2→3, motor ainda em RPM alto
    // mas drivetrainRPM caiu pela ratio menor → kickdown trip volta pra 2ª.
    if (
      throttle > this.kickdownThrottle &&
      sigUp < down * this.kickdownRPMRatio &&
      currentGear > 2 &&
      this._lockoutTimer <= 0
    ) {
      this._downTimer = 0;
      this._lastDir = -1;
      this._lockoutTimer = this.antiHuntLockoutMs / 1000;
      this.lastDecision = 'down';
      return 'down';
    }

    // -------------- DOWNSHIFT (sigDown = drivetrainRPM) --------------
    // Carro perdendo velocidade ou destracionado: drivetrain cai abaixo do
    // down threshold, ECU cascata até equilibrar. Em wheelspin com carro
    // parado, drivetrain≈0 → desce até 1ª, restaurando força.
    if (sigDown < down && currentGear > 2) {
      this._downTimer += dt;
      this._upTimer = 0;
      const dwellOK = this._downTimer >= this.downshiftDebounceMs / 1000;
      const lockoutOK = this._lockoutTimer <= 0 || sigDown < down * 0.85;
      if (!dwellOK) {
        this.lastInhibitReason = 'debounce';
      } else if (!lockoutOK) {
        this.lastInhibitReason = 'lockout';
      } else {
        this._downTimer = 0;
        this._lastDir = -1;
        this._lockoutTimer = this.antiHuntLockoutMs / 1000;
        this.lastDecision = 'down';
        return 'down';
      }
    } else {
      this._downTimer = 0;
    }

    // -------------- HANDBRAKE KICKDOWN (drift) --------------
    if (handbrake > 0 && sigDown < 4000 && currentGear > 2 && this._lockoutTimer <= 0) {
      this._lastDir = -1;
      this._lockoutTimer = this.antiHuntLockoutMs / 1000;
      this.lastDecision = 'down';
      return 'down';
    }

    return null;
  }

  reset() {
    this._upTimer = 0;
    this._downTimer = 0;
    this._lockoutTimer = 0;
    this._driftTimer = 0;
    this._lastDir = 0;
    this.lastDecision = null;
    this.lastInhibitReason = null;
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
    // ECU programável (FuelTech-style). Decide auto-shift via shift map 2D.
    this.ecu = new ECU(opts.ecu);
    // Injeta o revLimitRPM real do engine pro override de wheelspin em redline.
    this.ecu._revLimitRPM = this.engine.revLimitRPM ?? this.engine.maxRPM ?? 7200;

    // Parâmetros globais
    this.finalDrive = opts.finalDrive ?? 3.8;
    // Eficiência da transmissão (caixa). Combinada com diff (0.95) → ~0.87
    // total. Antes era 0.82, somando 0.697 — fuga de potência grande.
    this.transEfficiency = opts.transEfficiency ?? 0.92;

    // Propaga limites de RPM do engine pro gearbox (gating de over-rev/bog).
    this._syncEngineLimitsToGearbox();

    // Permite override de cooldowns/thresholds via opts.shifting:{...}
    if (opts.shifting) {
      const s = opts.shifting;
      if (typeof s.cooldownH === 'number')           this.gearbox._cooldownH = s.cooldownH;
      if (typeof s.cooldownSeq === 'number')         this.gearbox._cooldownSeq = s.cooldownSeq;
      if (typeof s.overrevMarginRPM === 'number')    this.gearbox.overrevMarginRPM = s.overrevMarginRPM;
      if (typeof s.minRPMAfterUpshift === 'number')  this.gearbox.minRPMAfterUpshift = s.minRPMAfterUpshift;
      if (typeof s.minPostUpshiftRPM === 'number')   this.gearbox.minPostUpshiftRPM = s.minPostUpshiftRPM;
    }

    // Estado interno
    this.drivetrainOmega = 0;
    this.lastWheelOmegas = [0, 0, 0, 0];
  }

  // Mantém o gearbox sabendo o redline/idle/maxRPM atuais (chamado no construtor
  // e quando o engine recebe novos limites via tuning).
  _syncEngineLimitsToGearbox() {
    if (!this.gearbox || !this.engine) return;
    this.gearbox.engineMaxRPM     = this.engine.maxRPM;
    this.gearbox.engineRedlineRPM = this.engine.redlineRPM;
    this.gearbox.engineIdleRPM    = this.engine.idleRPM;
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

    // 2. Velocidades das rodas motrizes (traseiras = RWD).
    //    avgRearOmega: representa "o que o motor sente via clutch" — é o sig
    //      correto para ECU (decisão de upshift/downshift/kickdown) E para
    //      sync do clutch.
    //    slowestRearOmega: representa "qual roda vai bog primeiro num downshift"
    //      — usado APENAS no gating overrev/bog do Gearbox (projectedRPMInGear).
    //      Evita aceitar shift que faria a roda mais lenta dar overrev.
    //
    //    Por que separar: usar slowest na ECU dispara kickdown em wheelspin
    //    sustentado (redline+WOT). drivetrainRPM_slow cai abaixo de down·1.3,
    //    `throttle>0.92`, `currentGear>2` → kickdown errado em redline.
    //    Avg "sente a carga real" do motor, evitando esse falso positivo.
    const avgRearOmega = (wRL.angularVelocity + wRR.angularVelocity) * 0.5;
    const slowestRearOmega = Math.sign(avgRearOmega || 1)
      * Math.min(Math.abs(wRL.angularVelocity), Math.abs(wRR.angularVelocity));

    // 3. Drivetrain RPM from wheels — ECU/clutch usam avg.
    const drivetrainRPM = this.gearbox.getDrivetrainRPM(avgRearOmega, this.finalDrive);
    this.drivetrainOmega = avgRearOmega;

    // 4a. ECU decide auto-shift.
    //     - sigRPM = engineRPM SEMPRE (espelha ECU real lendo OBD do motor)
    //     - rearSlipRatio: usado para inibir UPSHIFT quando há wheelspin alto
    //       (motor decola além das rodas; subir gear não ajuda — só piora).
    //     - rearSlipAngle: drift dwell (já existente).
    const rearSlipAngleAvg = ((wRL.slipAngle ?? 0) + (wRR.slipAngle ?? 0)) * 0.5;
    const rearSlipRatioAvg = (Math.abs(wRL.slipRatio ?? 0) + Math.abs(wRR.slipRatio ?? 0)) * 0.5;
    const ecuCmd = this.ecu.decide(dt, {
      throttle,
      engineRPM: this.engine.rpm,
      drivetrainRPM,
      clutchSlipping: this.clutch.isSlipping,
      currentGear: this.gearbox.currentGear,
      isShifting: this.gearbox.isShifting,
      rearSlipAngle: rearSlipAngleAvg,
      rearSlipRatio: rearSlipRatioAvg,
      handbrake,
    });
    this.gearbox.setAutoShiftCommand(ecuCmd);

    // 4b. Gearbox executa o comando da ECU + tica timers.
    //     Gating overrev/bog usa slowestRearOmega: numa proposta de downshift,
    //     a roda mais lenta projeta o RPM mais conservador → bloqueia shift
    //     que faria mesmo um lado dar overrev. (`shiftDown` em Gearbox usa
    //     `_lastWheelOmega` setado aqui, via `projectedRPMInGear`.)
    this.gearbox.update(dt, this.engine.rpm, throttle, slowestRearOmega, this.finalDrive, handbrake);

    // 5. Launch control
    this.launch.update(clutchPedal, throttle, speedMS, this.engine.rpm);

    // 6a. Turbo ANTES do clutch (ordem física correta).
    // O turbo modifica o torque produzido pelo motor; o clutch transmite esse
    // torque já boosteado. Antes o turbo era multiplicado APÓS o clutch,
    // o que: (a) deixava o engine.angularVel ser integrado sem ver o boost
    // (motor desacelerava demais ao acoplar), (b) mascarava qualquer cap
    // do clutch (clutch via só raw, ignorando o pico de boost).
    let turboMult = 1.0;
    if (this.turbo) {
      // wheelEngagement = quão acoplada a roda está com o motor (0..1).
      // Em arrancada com clutch slipping, drivetrain ω ≪ engine ω → ratio
      // baixo → turbo cresce mais devagar. Floor 0.2 garante que turbo
      // ainda spoola em standstill (não fica completamente apagado).
      const ptGearRatio = this.gearbox.getGearRatio();
      const drivetrainSideOmega = avgRearOmega * ptGearRatio * this.finalDrive;
      const engineOmegaAbs = Math.max(50, Math.abs(this.engine.angularVel));
      const wheelEngagement = Math.max(0.2,
        Math.min(1.0, Math.abs(drivetrainSideOmega) / engineOmegaAbs));
      this.turbo.update(dt, this.engine.rpm, throttle, wheelEngagement);
      turboMult = this.turbo.getTorqueMultiplier();
    }

    // 6b. Determinar estado do clutch (Karnopp tanh model)
    // Δω = engineOmega - drivetrainOmega·gearRatio·finalDrive (em rad/s).
    const ptGearRatio = this.gearbox.getGearRatio();
    const drivetrainSideOmega = avgRearOmega * ptGearRatio * this.finalDrive;
    const deltaOmega = this.engine.angularVel - drivetrainSideOmega;
    // engineRawTorque agora INCLUI o boost — é o torque real saindo do motor.
    const engineRawTorque = this.engine.getTorqueAt(this.engine.rpm, throttle) * turboMult;

    let transmittedTorque = 0;

    if (this.gearbox.isShifting || ptGearRatio === 0) {
      // Neutro ou trocando: ignição cortada. Engine livre.
      transmittedTorque = 0;
      this.engine.updateFree(dt, 0, 0);
      this.clutch.isSlipping = false;

    } else if (Math.abs(deltaOmega) < 0.5 && this.clutch.isEngaged() && Math.abs(avgRearOmega) > 0.5) {
      // STICK: motor acoplado. Aplica boost ao raw da curva e usa esse torque
      // como base do net (raw·boost − fricção + coast). Sem isso o motor
      // "perdia" o boost ao acoplar e ficava sem força em alta carga.
      this.engine.angularVel = drivetrainSideOmega;
      this.engine.rpm = this.engine.omegaToRPM(this.engine.angularVel);

      transmittedTorque = this.engine.updateLocked(dt, this.engine.angularVel, 0, turboMult);
      this.clutch.isSlipping = false;
      this.clutch.temperature *= 0.95;

    } else {
      // SLIP ou parado: torque transmitido via Karnopp (tanh smooth).
      // engineRawTorque já inclui boost — o clutch enxerga o torque real.
      transmittedTorque = this.clutch.getTransmittingTorque(engineRawTorque, deltaOmega);
      this.engine.updateFree(dt, transmittedTorque, 0, turboMult);
    }

    // Rev-match blip (sequencial)
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
        transmittedTorque *= 0.1;
      }
    }

    // 9. (turbo já aplicado em 6a — antes do clutch).

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
      drivetrainRPM,
      gear: this.gearbox.getGearName(),
      gearIdx: this.gearbox.currentGear,
      targetGearIdx: this.gearbox.targetGear,
      isShifting: this.gearbox.isShifting,
      shiftProgress: this.gearbox.shiftProgress,
      shiftTime: this.gearbox.shiftTime,
      shiftBlockedReason: this.gearbox.lastBlockedReason,
      shiftBlockedTimer: this.gearbox.lastBlockedTimer,
      gearboxMode: this.gearbox.mode,
      // Sempre expor slip% — em zero se não há diff de RPM. HUD bar usa
      // como indicador contínuo, não só on/off.
      clutchSlip: this.clutch.getSlipPercentage(this.engine.rpm, drivetrainRPM),
      tcActive: this.tc.active,
      tcCut: this.tc.cutLevel,
      launchActive: this.launch.active,
      launchArmed: this.launch.armed,
      boostPsi: this.turbo ? this.turbo.getBoostPSI() : 0,
      maxBoostPsi: this.turbo ? this.turbo.maxBoost * 14.504 : 0,
      turboSpooling: this.turbo ? this.turbo.isSpooling : false,
      clutchTemp: this.clutch.temperature,
      clutchWear: this.clutch.wear,
      // Engine limits — HUD usa pra colorir RPM gauge perto do redline.
      engineRedlineRPM: this.engine.redlineRPM,
      engineMaxRPM: this.engine.maxRPM,
      engineIdleRPM: this.engine.idleRPM,
      // ECU telemetria (HUD: linha UP@xxxx | DOWN@xxxx + razão de inibição).
      ecuUpThreshold:    this.ecu.lastUpThreshold,
      ecuDownThreshold:  this.ecu.lastDownThreshold,
      ecuLastDecision:   this.ecu.lastDecision,
      ecuInhibitReason:  this.ecu.lastInhibitReason,
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
    this.gearbox.shiftCooldown = 0;
    this.gearbox._autoShiftCommand = null;
    if (this.ecu) this.ecu.reset();
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
