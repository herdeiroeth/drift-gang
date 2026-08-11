import { describe, it, expect } from 'vitest';
import {
  Engine,
  Clutch,
  Gearbox,
  Differential,
  TractionControl,
  LaunchControl,
  Turbocharger,
} from '../src/powertrain.js';

describe('Powertrain — Engine', () => {
  it('starts at idle RPM', () => {
    const eng = new Engine();
    expect(eng.rpm).toBeCloseTo(900, 0);
  });

  it('produces torque proportional to throttle', () => {
    const eng = new Engine();
    const tFull = eng.getTorqueAt(3500, 1.0);
    const tHalf = eng.getTorqueAt(3500, 0.5);
    expect(tHalf).toBeCloseTo(tFull * 0.5, 0);
  });

  it('coast torque is negative and proportional to RPM', () => {
    const eng = new Engine();
    expect(eng.getCoastTorque(5000)).toBeLessThan(0);
    expect(eng.getCoastTorque(2000)).toBeGreaterThan(eng.getCoastTorque(5000)); // less negative
  });

  it('rev limiter hard-caps RPM', () => {
    const eng = new Engine({ revLimitMode: 'hard', revLimitRPM: 7200, maxRPM: 7500 });
    eng.rpm = 7500;
    eng.angularVel = eng.rpmToOmega(7500);
    eng._applyRevLimiter();
    expect(eng.rpm).toBeLessThanOrEqual(eng.revLimitRPM + 1);
  });

  it('RPM/omega conversion round-trips', () => {
    const eng = new Engine();
    expect(eng.omegaToRPM(eng.rpmToOmega(5000))).toBeCloseTo(5000, 0);
  });
});

describe('Powertrain — Clutch', () => {
  it('fully engaged with pedal at 0', () => {
    const c = new Clutch({ maxTorqueTransfer: 1000 });
    c.setPedal(0);
    expect(c.isEngaged()).toBe(true);
  });

  it('transmits engine torque in stick state', () => {
    const c = new Clutch({ maxTorqueTransfer: 1000 });
    c.setPedal(0);
    const t = c.getTransmittingTorque(500, 0); // deltaOmega=0 → stick
    expect(t).toBeCloseTo(500, 0); // engine torque passes through
  });

  it('limits to maxTransfer when engine torque exceeds it', () => {
    const c = new Clutch({ maxTorqueTransfer: 500 });
    c.setPedal(0);
    const t = c.getTransmittingTorque(800, 0);
    expect(Math.abs(t)).toBeLessThanOrEqual(501);
  });

  it('slipping reduces transmitted torque', () => {
    const c = new Clutch({ maxTorqueTransfer: 1000 });
    c.setPedal(0);
    const tStick = c.getTransmittingTorque(800, 0);
    const tSlip = c.getTransmittingTorque(800, 100); // large deltaOmega
    // In slip, the transmitted torque should be limited by friction model
    expect(Math.abs(tSlip)).toBeLessThanOrEqual(Math.abs(tStick));
  });
});

describe('Powertrain — Gearbox', () => {
  it('starts in 1st gear (index 2)', () => {
    const gb = new Gearbox();
    expect(gb.currentGear).toBe(2);
  });

  it('upshift increases gear', () => {
    const gb = new Gearbox();
    gb._lastWheelOmega = 100; // non-zero for gating
    gb._lastEngineRPM = 5000;
    expect(gb.shiftUp()).toBe(true);
    expect(gb.targetGear).toBe(3);
  });

  it('downshift decreases gear', () => {
    const gb = new Gearbox();
    gb._lastWheelOmega = 100;
    gb._lastEngineRPM = 5000;
    expect(gb.shiftDown()).toBe(true);
    expect(gb.targetGear).toBe(1);
  });

  it('gear ratio changes with index', () => {
    const gb = new Gearbox({
      gearRatios: [0, -2.9, 3.6, 2.2, 1.5],
    });
    // currentGear=2 → ratio 3.6
    expect(gb.getGearRatio()).toBeCloseTo(3.6, 2);
  });

  it('returns neutral ratio during shifting', () => {
    const gb = new Gearbox();
    gb.isShifting = true;
    expect(gb.getGearRatio()).toBe(0);
  });
});

describe('Powertrain — Differential', () => {
  it('open diff splits torque equally', () => {
    const diff = new Differential({ type: 'open', finalDrive: 3.8 });
    const [tl, tr] = diff.split(500, 100, 100);
    expect(tl).toBeCloseTo(tr, 0);
  });

  it('welded diff produces unequal torques with speed difference', () => {
    const diff = new Differential({ type: 'welded', finalDrive: 3.8 });
    const [tl, tr] = diff.split(500, 50, 200);
    // Welded clamps omega difference → torques are unequal to counter Δω
    expect(Math.abs(tl - tr)).toBeGreaterThan(0);
  });

  it('LSD clutch produces torque on both outputs', () => {
    const diff = new Differential({ type: 'lsd_clutch', finalDrive: 3.8, preload: 80 });
    const [tl, tr] = diff.split(500, 100, 100);
    expect(tl).toBeGreaterThan(0);
    expect(tr).toBeGreaterThan(0);
  });
});

describe('Powertrain — Turbocharger', () => {
  it('starts with no boost', () => {
    const t = new Turbocharger({ maxBoost: 0.8, spoolRate: 2.0 });
    expect(t.boostBar).toBe(0);
  });

  it('spools under throttle', () => {
    const t = new Turbocharger({ maxBoost: 0.8, spoolRate: 2.0 });
    t.update(0.1, 4000, 1.0);
    expect(t.boostBar).toBeGreaterThan(0);
  });

  it('boost multiplier is ≥ 1.0', () => {
    const t = new Turbocharger({ maxBoost: 0.8, spoolRate: 2.0 });
    expect(t.getTorqueMultiplier()).toBeGreaterThanOrEqual(1.0);
  });
});
