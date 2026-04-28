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
    this.wheelInertia = 0.5 * this.wheelMass * this.wheelRadius * this.wheelRadius;

    // Coeficiente de fricção base. 1.20 = pneu drift/competition (slick warm).
    // Antes 1.05 era street tire — carro grudava menos e parecia "fraco" em
    // arrancada (peak Fx = mu·N saturava em força baixa).
    this.mu = opts.mu ?? 1.20;
    this.cornerStiffnessFront = opts.cornerStiffnessFront ?? 5.5;
    this.cornerStiffnessRear = opts.cornerStiffnessRear ?? 3.2;
    this.maxSlipAngle = opts.maxSlipAngle ?? 0.55;

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
}
