function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export class SuspensionCorner {
  constructor(cfg, isFront) {
    this.cfg = cfg;
    this.isFront = isFront;

    this.wheelY = 0;
    this.wheelVy = 0;
    this.prevCompression = 0;
    this.prevRawCompression = 0;

    this.compression = 0;
    this.rawCompression = 0;
    this.compressionSpeed = 0;

    this.springForce = 0;
    this.damperForce = 0;
    this.bumpStopForce = 0;
    this.droopForce = 0;
    this.arbForce = 0;
    this.geoLoad = 0;
    this.suspensionForceBase = 0;
    this.suspensionForce = 0;
    this.tireForce = 0;
    this.normalLoad = 0;
    this.tireDeflection = 0;
  }

  get springRate() {
    const c = this.cfg;
    return this.isFront ? (c.springRateFront ?? c.springRate) : (c.springRateRear ?? c.springRate);
  }

  get damperBump() {
    const c = this.cfg;
    return this.isFront ? (c.damperBumpFront ?? c.damperRate) : (c.damperBumpRear ?? c.damperRate);
  }

  get damperRebound() {
    const c = this.cfg;
    return this.isFront ? (c.damperReboundFront ?? c.damperRate) : (c.damperReboundRear ?? c.damperRate);
  }

  get staticSprungLoad() {
    const c = this.cfg;
    const axleRatio = this.isFront ? c.axleWeightRatioFront : c.axleWeightRatioRear;
    return c.sprungMass * c.gravity * axleRatio * 0.5;
  }

  get staticCornerLoad() {
    return this.staticSprungLoad + this.cfg.unsprungMass * this.cfg.gravity;
  }

  reset(anchorY, groundY = 0) {
    const c = this.cfg;
    const staticCompression = clamp(
      this.staticSprungLoad / Math.max(1, this.springRate),
      0,
      c.suspMaxCompression * 0.85,
    );
    const staticTireDeflection = clamp(
      this.staticCornerLoad / Math.max(1, c.tireVerticalRate),
      0,
      c.tireMaxDeflection,
    );

    this.wheelY = groundY + c.wheelRadius - staticTireDeflection;
    this.wheelVy = 0;
    this.prevCompression = staticCompression;
    this.prevRawCompression = staticCompression;
    this.compression = staticCompression;
    this.rawCompression = staticCompression;
    this.compressionSpeed = 0;
    this.springForce = this.springRate * staticCompression;
    this.damperForce = 0;
    this.bumpStopForce = 0;
    this.droopForce = 0;
    this.arbForce = 0;
    this.geoLoad = 0;
    this.suspensionForceBase = this.springForce;
    this.suspensionForce = this.springForce;
    this.tireForce = this.staticCornerLoad;
    this.normalLoad = this.staticCornerLoad;
    this.tireDeflection = staticTireDeflection;

    const expectedWheelY = anchorY - (c.suspRestLength - staticCompression);
    if (Number.isFinite(expectedWheelY)) {
      this.wheelY = Math.min(this.wheelY, expectedWheelY + c.tireMaxDeflection);
    }
  }

  update(dt, anchorY, groundY, hasGround) {
    const c = this.cfg;
    const safeDt = Math.max(dt, 1e-5);

    const distance = anchorY - this.wheelY;
    const rawCompression = c.suspRestLength - distance;
    const compression = clamp(rawCompression, 0, c.suspMaxCompression);
    const compressionSpeed = (rawCompression - this.prevRawCompression) / safeDt;

    const springForce = this.springRate * compression;
    const damperK = compressionSpeed >= 0 ? this.damperBump : this.damperRebound;
    let damperForce = damperK * compressionSpeed;

    const bumpStart = c.bumpStopStart;
    const bumpTravel = Math.max(0, compression - bumpStart);
    const bumpStopForce = bumpTravel > 0
      ? c.bumpStopRate * bumpTravel * (1 + bumpTravel * c.bumpStopProgression)
      : 0;

    const droopForce = rawCompression < 0
      ? rawCompression * c.droopStopRate
      : 0;

    let suspensionForceBase = springForce + damperForce + bumpStopForce + droopForce;
    suspensionForceBase = clamp(suspensionForceBase, -c.maxDroopForce, c.maxSuspensionForce);
    damperForce = suspensionForceBase - springForce - bumpStopForce - droopForce;

    const tireDeflection = hasGround
      ? clamp(groundY + c.wheelRadius - this.wheelY, 0, c.tireMaxDeflection)
      : 0;
    let tireForce = 0;
    if (tireDeflection > 0) {
      tireForce = c.tireVerticalRate * tireDeflection - c.tireVerticalDamping * this.wheelVy;
      tireForce = clamp(tireForce, 0, c.maxTireForce);
    }

    const forceOnWheel = tireForce - (suspensionForceBase + this.arbForce) - c.unsprungMass * c.gravity;
    const wheelAy = forceOnWheel / Math.max(1, c.unsprungMass);
    this.wheelVy += wheelAy * safeDt;
    this.wheelVy *= c.unsprungVelocityDamping;
    this.wheelVy = clamp(this.wheelVy, -c.maxUnsprungVelocity, c.maxUnsprungVelocity);
    this.wheelY += this.wheelVy * safeDt;

    const minWheelY = anchorY - c.suspRestLength - c.droopSlack;
    if (this.wheelY < minWheelY) {
      this.wheelY = minWheelY;
      if (this.wheelVy < 0) this.wheelVy = 0;
    }

    const maxWheelY = anchorY - (c.suspRestLength - c.suspMaxCompression);
    if (this.wheelY > maxWheelY) {
      this.wheelY = maxWheelY;
      if (this.wheelVy > 0) this.wheelVy = 0;
    }

    if (hasGround) {
      const lowestWheelY = groundY + c.wheelRadius - c.tireMaxDeflection;
      if (this.wheelY < lowestWheelY) {
        this.wheelY = lowestWheelY;
        if (this.wheelVy < 0) this.wheelVy = 0;
      }
    }

    this.rawCompression = rawCompression;
    this.compression = compression;
    this.compressionSpeed = compressionSpeed;
    this.springForce = springForce;
    this.damperForce = damperForce;
    this.bumpStopForce = bumpStopForce;
    this.droopForce = droopForce;
    this.suspensionForceBase = suspensionForceBase;
    this.suspensionForce = suspensionForceBase + this.arbForce;
    this.tireForce = tireForce;
    this.tireDeflection = tireDeflection;
    this.normalLoad = tireForce;
    this.prevCompression = compression;
    this.prevRawCompression = rawCompression;
  }

  applyLoads(arbForce, geoLoad, grounded) {
    this.arbForce = arbForce;
    this.geoLoad = geoLoad;
    this.suspensionForce = this.suspensionForceBase + arbForce;
    this.normalLoad = grounded ? Math.max(0, this.tireForce + arbForce + geoLoad) : 0;
  }
}
