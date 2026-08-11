import { describe, it, expect } from 'vitest';
import {
  pacejkaLateral,
  pacejkaLongitudinal,
  combinedSlipForces,
  gripFactor,
  pneumaticTrail,
  effectiveD,
  camberFactor,
  ALPHA_PEAK,
  KAPPA_PEAK,
  DEFAULT_PACEJKA_LATERAL,
  DEFAULT_PACEJKA_LONGITUDINAL,
  REAR_PACEJKA_LATERAL,
} from '../src/physics/Tire.js';

describe('Tire — Pacejka Magic Formula', () => {
  describe('gripFactor(temperature)', () => {
    it('returns cold grip at ambient temperature', () => {
      expect(gripFactor(25)).toBeCloseTo(0.92, 5);
    });
    it('returns peak grip in optimal window (60–110°C)', () => {
      expect(gripFactor(80)).toBe(1.0);
      expect(gripFactor(60)).toBe(1.0);
      expect(gripFactor(110)).toBe(1.0);
    });
    it('fades gradually in heat zone', () => {
      const at150 = gripFactor(150);
      expect(at150).toBeGreaterThan(0.8);
      expect(at150).toBeLessThan(0.9);
    });
    it('clamps at minimum grip above 200°C', () => {
      expect(gripFactor(250)).toBeCloseTo(0.55, 5);
    });
  });

  describe('pacejkaLateral(slipAngle, mu, N)', () => {
    const mu = 1.2;
    const N = 3200; // ~static load per corner

    it('returns zero force with zero load', () => {
      expect(pacejkaLateral(0.1, mu, 0)).toBe(0);
    });

    it('returns zero force at zero slip angle', () => {
      expect(pacejkaLateral(0, mu, N)).toBeCloseTo(0, 10);
    });

    it('opposes slip angle (negative Fy for positive slip)', () => {
      const Fy = pacejkaLateral(0.05, mu, N);
      expect(Fy).toBeLessThan(0); // Fy opposes slip
    });

    it('increases with load', () => {
      const FyLight = pacejkaLateral(0.05, mu, N);
      const FyHeavy = pacejkaLateral(0.05, mu, N * 2);
      expect(Math.abs(FyHeavy)).toBeGreaterThan(Math.abs(FyLight));
    });

    it('increases with slip angle and plateaus near peak (Pacejka shape)', () => {
      const forces = [];
      for (let i = 0; i <= 200; i++) {
        const a = i / 1000; // 0..0.2 rad
        forces.push(Math.abs(pacejkaLateral(a, mu, N)));
      }
      // Force should be strictly increasing for small angles (0..0.06 rad)
      expect(forces[30]).toBeGreaterThan(forces[10]);
      expect(forces[60]).toBeGreaterThan(forces[30]);
      // The peak is expected around 0.105-0.26 rad depending on MF params
      // At α=0.2 rad, Fy should be near its maximum (≥ 95% of peak)
      const peak = Math.max(...forces);
      expect(forces[200]).toBeGreaterThan(peak * 0.95);
    });
  });

  describe('pacejkaLongitudinal(slipRatio, mu, N)', () => {
    const mu = 1.2;
    const N = 3200;

    it('returns zero at zero slip', () => {
      expect(pacejkaLongitudinal(0, mu, N)).toBe(0);
    });

    it('produces positive force for positive slip (acceleration)', () => {
      expect(pacejkaLongitudinal(0.05, mu, N)).toBeGreaterThan(0);
    });

    it('produces negative force for negative slip (braking)', () => {
      expect(pacejkaLongitudinal(-0.05, mu, N)).toBeLessThan(0);
    });
  });

  describe('combinedSlipForces(slipAngle, slipRatio, mu, N)', () => {
    const mu = 1.2;
    const N = 3200;

    it('returns pure lateral when slipRatio is zero', () => {
      const pureLat = pacejkaLateral(0.08, mu, N);
      const combined = combinedSlipForces(0.08, 0, mu, N);
      expect(combined.Fx).toBeCloseTo(0, 1);
      expect(combined.Fy).toBeCloseTo(pureLat, 0); // same magnitude
    });

    it('reduces lateral force under combined slip', () => {
      const pureLat = Math.abs(pacejkaLateral(0.08, mu, N));
      const combined = combinedSlipForces(0.08, 0.15, mu, N);
      expect(Math.abs(combined.Fy)).toBeLessThan(pureLat);
    });

    it('applies drift bias for rear wheels under power', () => {
      const normal = combinedSlipForces(0.08, 0.15, mu, N, { isRear: false });
      const biased = combinedSlipForces(0.08, 0.15, mu, N, { isRear: true, driftBias: 0.5 });
      // Rear should preserve more longitudinal force
      expect(Math.abs(biased.Fx)).toBeGreaterThanOrEqual(Math.abs(normal.Fx) * 0.95);
    });
  });

  describe('pneumaticTrail(slipAngle)', () => {
    it('returns zero when slip > alphaPeak', () => {
      expect(pneumaticTrail(0.2)).toBe(0);
    });
    it('returns positive trail for small positive slip', () => {
      expect(pneumaticTrail(0.03)).toBeGreaterThan(0);
    });
    it('matches slip angle sign', () => {
      expect(pneumaticTrail(-0.03)).toBeLessThan(0);
    });
  });

  describe('effectiveD(mu, N)', () => {
    it('returns mu*N for linear mode (n≈1)', () => {
      expect(effectiveD(1.2, 3000, { loadSensN: 1.0 })).toBeCloseTo(3600, 0);
    });
    it('is sublinear for n<1 (returns less than linear at high loads)', () => {
      // With N > ref, the sublinear model returns less than mu*N
      const D_high = effectiveD(1.2, 5000, { loadSensN: 0.85, loadSensRefFz: 3200 });
      expect(D_high).toBeLessThan(1.2 * 5000);
      // With N <= ref, n<1 actually gives slightly more grip (load sensitivity bulge)
      const D_low = effectiveD(1.2, 1500, { loadSensN: 0.85, loadSensRefFz: 3200 });
      expect(D_low).toBeGreaterThan(1.2 * 1500);
    });
  });

  describe('camberFactor(camberRad)', () => {
    it('boosts D for negative camber', () => {
      expect(camberFactor(-0.05)).toBeGreaterThan(1.0);
    });
    it('reduces D for positive camber', () => {
      expect(camberFactor(0.05)).toBeLessThan(1.0);
    });
  });
});
