export class CarConfig {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 9.81;
    this.mass = opts.mass ?? 1300.0;
    this.inertiaScale = opts.inertiaScale ?? 1.8;
    this.halfWidth = opts.halfWidth ?? 0.82;
    this.cgToFrontAxle = opts.cgToFrontAxle ?? 1.35;
    this.cgToRearAxle = opts.cgToRearAxle ?? 1.35;
    this.cgHeight = opts.cgHeight ?? 0.50;
    this.wheelRadius = opts.wheelRadius ?? 0.34;
    this.wheelWidth = opts.wheelWidth ?? 0.26;
    this.wheelMass = opts.wheelMass ?? 18.0;
    this.unsprungMass = opts.unsprungMass ?? 28.0;
    this.sprungMass = opts.sprungMass ?? Math.max(1, this.mass - this.unsprungMass * 4);
    this.wheelInertia = 0.5 * this.wheelMass * this.wheelRadius * this.wheelRadius;

    // Coeficiente de fricção base. 1.20 = pneu drift/competition (slick warm).
    // Antes 1.05 era street tire — carro grudava menos e parecia "fraco" em
    // arrancada (peak Fx = mu·N saturava em força baixa).
    this.mu = opts.mu ?? 1.20;
    this.cornerStiffnessFront = opts.cornerStiffnessFront ?? 5.5;
    this.cornerStiffnessRear = opts.cornerStiffnessRear ?? 3.2;
    this.maxSlipAngle = opts.maxSlipAngle ?? 0.55;

    // Load sensitivity sublinear (Pacejka D = mu·N·(N/ref)^(n-1)).
    // n=0.85 é faixa típica de pneus street/sport reais; n=1 colapsa pra
    // arcade. Ref Fz é a carga estática por canto (mass·g/4).
    this.loadSensN     = opts.loadSensN     ?? 0.85;
    // loadSensRefFz é setado abaixo (após mass·gravity disponível).
    this.alphaPeak     = opts.alphaPeak     ?? 0.105;   // rad ~6°

    // SAT físico via kingpin moment.
    //   M_kingpin = Fy_front · (mech_trail + pneum_trail(α))
    //   mech_trail = R_wheel · sin(caster)
    // Drift cars usam 7-12° de caster pro volante voltar agressivo.
    // 5.7° (0.10 rad) é faixa street/sport — ponto de partida.
    this.casterAngle   = opts.casterAngle   ?? 0.10;    // rad ~5.7°
    this.pneumTrail0   = opts.pneumTrail0   ?? 0.040;   // m
    // Ganho do SAT no input do steer (kinematic correction). Magnitude
    // calibrada empiricamente para countersteer "vivo" sem oscilação.
    this.steerSatGain          = opts.steerSatGain          ?? 0.0008;
    // Contribuição pequena do M_kingpin no yaw torque do chassi (~5-10%).
    // Efeito real do braço pneumático puxando atrás do eixo da roda.
    this.M_kingpinChassisGain  = opts.M_kingpinChassisGain  ?? 0.08;

    this.idleRPM = opts.idleRPM ?? 900;
    this.maxRPM = opts.maxRPM ?? 7200;
    this.gearRatios = opts.gearRatios ?? [0, -2.9, 3.6, 2.2, 1.5, 1.1, 0.85, 0.65];
    this.diffRatio = opts.diffRatio ?? 3.8;
    // Eficiência de transmissão (caixa H-pattern street): 92% é o real
    // (manuais ~92-95%, diff adicional ~94-95%). Cumulativo com diff = ~87%.
    // Antes era 0.82 que combinado com diff 0.85 dava só 0.697 (30% perdido).
    this.transEfficiency = opts.transEfficiency ?? 0.92;

    this.brakeTorqueMax = opts.brakeTorqueMax ?? 3200.0;
    this.brakeBiasFront = opts.brakeBiasFront ?? 0.62;
    this.ebrakeTorque = opts.ebrakeTorque ?? 2000.0;

    this.maxSteer = opts.maxSteer ?? 0.70;
    this.ackermannFactor = opts.ackermannFactor ?? 0.85;

    this.Cdrag = opts.Cdrag ?? 0.40;
    this.Crr = opts.Crr ?? 0.012;

    this.springRateFront = opts.springRateFront ?? 52000.0;
    this.springRateRear = opts.springRateRear ?? 48000.0;
    this.springRate = opts.springRate ?? ((this.springRateFront + this.springRateRear) * 0.5);
    this.damperBumpFront = opts.damperBumpFront ?? 4200.0;
    this.damperBumpRear = opts.damperBumpRear ?? 3900.0;
    this.damperReboundFront = opts.damperReboundFront ?? 6800.0;
    this.damperReboundRear = opts.damperReboundRear ?? 6200.0;
    this.damperRate = opts.damperRate ?? ((this.damperBumpFront + this.damperBumpRear) * 0.5);
    this.suspRestLength = opts.suspRestLength ?? 0.32;
    this.suspMaxCompression = opts.suspMaxCompression ?? 0.24;
    this.suspRayExtra = opts.suspRayExtra ?? 0.9;
    this.antiRollFront = opts.antiRollFront ?? 13000.0;
    this.antiRollRear = opts.antiRollRear ?? 10500.0;

    this.tireVerticalRate = opts.tireVerticalRate ?? 240000.0;
    this.tireVerticalDamping = opts.tireVerticalDamping ?? 2200.0;
    this.tireMaxDeflection = opts.tireMaxDeflection ?? 0.085;
    this.bumpStopStart = opts.bumpStopStart ?? 0.19;
    this.bumpStopRate = opts.bumpStopRate ?? 180000.0;
    this.bumpStopProgression = opts.bumpStopProgression ?? 8.0;
    this.droopStopRate = opts.droopStopRate ?? 90000.0;
    this.droopSlack = opts.droopSlack ?? 0.015;
    this.maxSuspensionForce = opts.maxSuspensionForce ?? 45000.0;
    this.maxDroopForce = opts.maxDroopForce ?? 12000.0;
    this.maxTireForce = opts.maxTireForce ?? 60000.0;
    this.unsprungVelocityDamping = opts.unsprungVelocityDamping ?? 0.998;
    this.maxUnsprungVelocity = opts.maxUnsprungVelocity ?? 12.0;

    this.rollCenterHeightFront = opts.rollCenterHeightFront ?? 0.08;
    this.rollCenterHeightRear = opts.rollCenterHeightRear ?? 0.12;

    // Anti-dive (front, em freada) e anti-squat (rear, em aceleração).
    // Percentages [0..1] da parcela do load transfer longitudinal que é
    // absorvida pela GEOMETRIA da suspensão (instant center, control arm
    // angles), reduzindo o pitch do chassi.
    //   - 0.0 = sem geometria, todo transfer pela mola (carro "mergulha")
    //   - 1.0 = 100% geometria, sem dive/squat (rígido demais)
    // 0.30 / 0.25 são valores típicos de carro sport street (BMW M tem ~30%
    // anti-dive, ~25% anti-squat). Drift cars often run lower antiSquat para
    // facilitar o weight transfer e quebrar a traseira mais facilmente.
    this.antiDiveFront = opts.antiDiveFront ?? 0.30;
    this.antiSquatRear = opts.antiSquatRear ?? 0.25;

    // Relaxation length do pneu — distância (m) que o pneu precisa rolar
    // para o slip angle "estabilizar" no contato patch. Tipicamente 0.3-0.5m
    // para pneus street. Implementado como low-pass filter no Wheel.js.
    this.relaxationLength = opts.relaxationLength ?? 0.30;

    // Camber gain dinâmico: quanto o camber muda com 1m de deflexão da
    // suspensão (rad/m). Real BMW M com double-wishbone: ~-0.5 deg/inch =
    // ~-0.34 rad/m. Negativo = mais negative camber quando comprime (bom
    // pra grip lateral em curva). Modificador de D lateral baseado nisso.
    this.camberGainPerMeter = opts.camberGainPerMeter ?? -0.30;
    this.camberStaticFront  = opts.camberStaticFront  ?? -0.025;  // -1.4° street perf
    this.camberStaticRear   = opts.camberStaticRear   ?? -0.020;  // -1.1°
    // Scales recalibradas (geo 0.35→0.7, long 0.25→0.6): antes a
    // transferência de peso instantânea via roll center / pitch geométrico
    // estava sub-escalada, e o pneu externo em curva 1G mal saía da
    // carga estática — Fy_max < demanda centrípeta = "manteiga nas rodas".
    // 0.7 deixa ~70% do load transfer chegar instantâneo (resto via
    // dinâmica de spring); 0.6 idem em longitudinal sob freada/aceleração.
    this.geometricLoadTransferScale = opts.geometricLoadTransferScale ?? 0.70;
    this.longitudinalLoadTransferScale = opts.longitudinalLoadTransferScale ?? 0.60;

    this.pitchDamp = opts.pitchDamp ?? 7.0;
    this.rollDamp = opts.rollDamp ?? 7.5;
    this.pitchStiff = opts.pitchStiff ?? 0.0;
    this.rollStiff = opts.rollStiff ?? 0.0;
    this.maxBodyPitch = opts.maxBodyPitch ?? 0.22;
    this.maxBodyRoll = opts.maxBodyRoll ?? 0.26;

    this._pitchInertiaOverride = typeof opts.pitchInertia === 'number';
    this._rollInertiaOverride = typeof opts.rollInertia === 'number';
    this._loadSensRefFzOverride = typeof opts.loadSensRefFz === 'number';

    this.inertia = 0;
    this.wheelBase = 0;
    this.axleWeightRatioFront = 0;
    this.axleWeightRatioRear = 0;
    this.trackWidth = 0;
    this.pitchInertia = opts.pitchInertia ?? 0;
    this.rollInertia = opts.rollInertia ?? 0;
    this.staticSuspCompressionFront = 0;
    this.staticSuspCompressionRear = 0;
    this.staticTireDeflection = 0;

    // Carga normal estática por canto = m·g/4. Usada como referência da
    // load sensitivity sublinear: Fy/Fx ~= mu·N·(N/ref)^(n-1) cruza com
    // (mu·N) exatamente em N=ref. Carros mais pesados/leves têm seu ref
    // ajustado automaticamente.
    this.loadSensRefFz = opts.loadSensRefFz ?? 0;

    // Mech trail (caster trail) — distância horizontal do contact patch
    // ao eixo do kingpin, derivada da geometria: R·sin(caster).
    // Sob Fy, gera M_kingpin = Fy·trail que tenta voltar o volante ao centro.
    this.mechTrail = 0;
    this.syncDerivedGeometry();
  }

  syncDerivedGeometry() {
    this.wheelInertia = 0.5 * this.wheelMass * this.wheelRadius * this.wheelRadius;
    this.inertia = this.mass * this.inertiaScale;
    this.wheelBase = this.cgToFrontAxle + this.cgToRearAxle;
    this.axleWeightRatioFront = this.cgToRearAxle / Math.max(0.001, this.wheelBase);
    this.axleWeightRatioRear = this.cgToFrontAxle / Math.max(0.001, this.wheelBase);
    this.trackWidth = this.halfWidth * 2;
    if (!this._pitchInertiaOverride) {
      this.pitchInertia = this.sprungMass * this.wheelBase * this.wheelBase * 0.28;
    }
    if (!this._rollInertiaOverride) {
      this.rollInertia = this.sprungMass * this.trackWidth * this.trackWidth * 0.42;
    }
    this.staticSuspCompressionFront = (this.sprungMass * this.gravity * this.axleWeightRatioFront * 0.5) / this.springRateFront;
    this.staticSuspCompressionRear = (this.sprungMass * this.gravity * this.axleWeightRatioRear * 0.5) / this.springRateRear;
    this.staticTireDeflection = ((this.mass * this.gravity) / 4) / this.tireVerticalRate;
    if (!this._loadSensRefFzOverride) {
      this.loadSensRefFz = this.mass * this.gravity / 4;
    }
    this.mechTrail = this.wheelRadius * Math.sin(this.casterAngle);
  }
}
