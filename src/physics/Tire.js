/**
 * TIRE — Modelo de pneu Pacejka simplificado (Magic Formula)
 *
 * Forças longitudinal e lateral com peak característico:
 *   F_y = D · sin(C · atan(B·α − E·(B·α − atan(B·α))))
 *   F_x = D · sin(C · atan(B·κ − E·(B·κ − atan(B·κ))))
 *
 * Defaults seco/asfalto (sport tire):
 *   - Lateral: B=10, C=1.3, D=mu·N, E=0.97
 *     (peak ~6° de slip angle ≈ 0.105 rad, depois cai suavemente)
 *   - Longitudinal: B=10, C=1.65, D=mu·N, E=0.97
 *     (peak ~10% de slip ratio)
 *
 * Combined slip via círculo/elipse de fricção:
 *   combinedSlip = sqrt((α/α_peak)² + (κ/κ_peak)²)
 *   redução de cada componente proporcional ao excesso.
 *
 * Referências:
 *   - http://www.racer.nl/reference/pacejka.htm
 *   - Pacejka, "Tire and Vehicle Dynamics" 3rd ed.
 */

// ---------------------------------------------------------------
// Tire temperature constants
// ---------------------------------------------------------------
export const TIRE_AMBIENT_C  = 25;
export const TIRE_OPTIMAL_C  = 90;
export const TIRE_MAX_C      = 200;
export const TIRE_HEAT_GAIN  = 1.5e-4;   // K / (W·s) — slipPower → ΔT
export const TIRE_COOL_RATE  = 0.4;      // 1/s — proporcional a (T - T_ambient)

/**
 * Multiplicador de mu efetivo em função da temperatura do pneu.
 *   T < 60     → 0.85 (cold tire = pouco grip)
 *   60..110    → 1.0 (optimal window)
 *   110..150   → linear: 1.0 → 0.85
 *   T > 150    → linear: 0.85 → 0.55 em 200°C (heat fade)
 */
export function gripFactor(T) {
  if (T < 60)   return 0.85;
  if (T <= 110) return 1.0;
  if (T <= 150) return 1.0 - ((T - 110) / 40) * 0.15;
  // overheating: 0.85 → 0.55 entre 150 e 200°C, depois clampa
  const overheat = Math.min(50, T - 150);
  return 0.85 - (overheat / 50) * 0.30;
}

// ---------------------------------------------------------------
// Defaults canônicos (asfalto seco, pneu street/sport)
// ---------------------------------------------------------------

export const DEFAULT_PACEJKA_LATERAL = {
  B: 10.0,   // stiffness factor
  C: 1.3,    // shape factor
  E: 0.97,   // curvature factor (próximo de 1 = peak suave)
};

// Rear-axle Pacejka lateral tunado pra DRIFT:
//   - B menor (8 vs 10): peak mais "raso" — menos pico afiado, slip angle de
//     pico um pouco maior (~7.5°) → mais janela de controle no slide.
//   - C maior (1.4 vs 1.3): shape factor alto reforça o "shelf" pós-peak,
//     deixando a curva cair menos depois do break-away → drift sustentável.
//   - E menor (0.92 vs 0.97): curvatura mais agressiva no falloff, mas
//     combinado com C alto resulta num platô amigável a slip angles altos.
// Resumo: rear segura mais a saída do peak, melhora controlabilidade
// em oversteer power-on típico de drift.
export const REAR_PACEJKA_LATERAL = {
  B: 8.0,
  C: 1.4,
  E: 0.92,
};

export const DEFAULT_PACEJKA_LONGITUDINAL = {
  B: 10.0,
  C: 1.65,
  E: 0.97,
};

// Slip de pico aproximados (úteis para o cálculo de combined slip elíptico)
// derivados das curvas: α_peak ≈ tan(π/(2C))/B ≈ 0.105 rad para C=1.3,B=10
// e κ_peak ≈ 0.1 para C=1.65,B=10. Usamos valores fixos para estabilidade.
export const ALPHA_PEAK = 0.105;   // rad (~6°)
export const KAPPA_PEAK = 0.10;    // 10%

// ---------------------------------------------------------------
// Load sensitivity (Pacejka D coefficient — sublinear em Fz)
// ---------------------------------------------------------------

/**
 * Coeficiente D efetivo do Pacejka, com load sensitivity sublinear.
 *
 *   D(N) = mu · N · (N / N_ref)^(n - 1)
 *
 * - n = 1.0  → linear (mu·N), comportamento "arcade".
 * - n = 0.85 → sublinear realista; dobrar N só dá ~80% mais grip.
 *   Esse expoente é o motor físico do dynamic understeer/oversteer:
 *   quando o peso transfere pra fora em curva, a roda externa ganha
 *   Fz mas perde μ_eff, e o eixo mais carregado fica "menos pegajoso".
 *
 * Referência: Wikipedia "Tire load sensitivity"; Pacejka 1994 usa
 * `D = a1·Fz² + a2·Fz` com a1<0, naturalmente sublinear — esta é a
 * forma simplificada equivalente.
 *
 * @param {number} mu     coeficiente de fricção combinado
 * @param {number} N      carga normal (N)
 * @param {object} params { loadSensN?, loadSensRefFz? }
 * @returns {number} D (N) — força máxima disponível neste eixo
 */
export function effectiveD(mu, N, params = {}) {
  if (N <= 0) return 0;
  const n = params.loadSensN ?? 0.85;
  if (n >= 0.999 && n <= 1.001) return mu * N;   // fast path linear
  const ref = params.loadSensRefFz ?? 3200;       // ≈ static corner load (1300kg·g/4)
  return mu * N * Math.pow(N / ref, n - 1);
}

// ---------------------------------------------------------------
// Pneumatic trail (braço pneumático para SAT)
// ---------------------------------------------------------------

/**
 * Trail pneumático em função do slip angle.
 *
 *   t_pneum(α) = t0 · max(0, 1 - |α|/α_peak) · sign(α)
 *
 * Decai linearmente até zero no peak (~6°). Pós-peak: zero.
 * Combinado com mech_trail = R·sin(caster) no SAT do kingpin:
 *   M_kingpin = Fy · (mech_trail + pneum_trail)
 *
 * O fato de o trail pneumático cair pra zero **antes** que Fy caia
 * é o que dá a sensação de "warning" do pneu antes do break-away
 * em pads/teclado: o volante fica leve um instante antes do front
 * perder grip de fato.
 *
 * @param {number} slipAngle  rad
 * @param {object} params     { alphaPeak?, pneumTrail0? }
 * @returns {number} trail (m), com sinal do slip angle
 */
export function pneumaticTrail(slipAngle, params = {}) {
  const alphaPeak = params.alphaPeak ?? ALPHA_PEAK;
  const t0 = params.pneumTrail0 ?? 0.040;        // m
  const a = Math.abs(slipAngle);
  if (a >= alphaPeak) return 0;
  return t0 * (1 - a / alphaPeak) * Math.sign(slipAngle);
}

// ---------------------------------------------------------------
// Magic Formula puro (sem coupling)
// ---------------------------------------------------------------

/**
 * F_y = D · sin(C · atan(B·α − E·(B·α − atan(B·α))))
 * Sinal: força lateral *opõe* ao slip angle (estabilizadora) → retorno negativo.
 *
 * @param {number} slipAngle  rad
 * @param {number} mu         coeficiente de fricção combinado pista×pneu
 * @param {number} N          carga normal (N)
 * @param {object} params     { B, C, E } opcional
 * @returns {number} força lateral (N) — sinal oposto ao slipAngle
 */
export function pacejkaLateral(slipAngle, mu, N, params = {}) {
  if (N <= 0) return 0;
  const B = params.B ?? DEFAULT_PACEJKA_LATERAL.B;
  const C = params.C ?? DEFAULT_PACEJKA_LATERAL.C;
  const E = params.E ?? DEFAULT_PACEJKA_LATERAL.E;
  const D = effectiveD(mu, N, params);

  const Ba = B * slipAngle;
  const inner = Ba - E * (Ba - Math.atan(Ba));
  const F = D * Math.sin(C * Math.atan(inner));
  // pneu opõe ao slip angle: se α > 0 (carro escorregando p/ direita do eixo do pneu),
  // a força aponta para a esquerda → negativo.
  return -F;
}

/**
 * F_x = D · sin(C · atan(B·κ − E·(B·κ − atan(B·κ))))
 * Sinal: força longitudinal acompanha o sinal do slipRatio.
 *
 * @param {number} slipRatio  adimensional (-1..1)
 * @param {number} mu
 * @param {number} N
 * @param {object} params     { B, C, E } opcional
 * @returns {number} força longitudinal (N)
 */
export function pacejkaLongitudinal(slipRatio, mu, N, params = {}) {
  if (N <= 0) return 0;
  const B = params.B ?? DEFAULT_PACEJKA_LONGITUDINAL.B;
  const C = params.C ?? DEFAULT_PACEJKA_LONGITUDINAL.C;
  const E = params.E ?? DEFAULT_PACEJKA_LONGITUDINAL.E;
  const D = effectiveD(mu, N, params);

  const Bk = B * slipRatio;
  const inner = Bk - E * (Bk - Math.atan(Bk));
  return D * Math.sin(C * Math.atan(inner));
}

/**
 * Combined slip via círculo/elipse de fricção.
 * Calcula F_x e F_y simultaneamente, acoplando lateralmente conforme o slip total.
 *
 * Estratégia (Pacejka similarity method, simplificado):
 *   1. Calcula F_x0 e F_y0 puros via Magic Formula.
 *   2. Calcula razão combinada s = sqrt((α/α_peak)² + (κ/κ_peak)²).
 *   3. Se s > 1 (sobrepassou o envelope), escala F_x e F_y para caber no
 *      círculo de fricção D = mu·N.
 *   4. Tratamento assimétrico opcional para `isRear: true`:
 *      preserva mais força longitudinal (drift sustentado sob potência),
 *      sacrificando lateral — emula o comportamento de pneus traseiros
 *      em RWD com diff blocado durante power-on oversteer.
 *
 * @param {number} slipAngle
 * @param {number} slipRatio
 * @param {number} mu
 * @param {number} N
 * @param {object} params  { lateral?, longitudinal?, isRear?, driftBias? }
 *   - lateral / longitudinal: overrides do Pacejka
 *   - isRear: bool — aplica viés de drift
 *   - driftBias: 0..1 — quanto preservar de longitudinal vs lateral no rear
 *     (default 0.4 = 40% de viés pra longitudinal sob power-on)
 * @returns {{Fx: number, Fy: number}}
 */
export function combinedSlipForces(slipAngle, slipRatio, mu, N, params = {}) {
  if (N <= 0) return { Fx: 0, Fy: 0 };

  // Auto-routing dos params de Pacejka lateral por eixo:
  //   - se o caller já mandou params.lateral explícito, respeita.
  //   - senão, rear usa REAR_PACEJKA_LATERAL (curva drift-friendly),
  //     front usa DEFAULT_PACEJKA_LATERAL (turn-in afiado).
  // Isso evita ter que rotear params diferentes lá em Wheel.js — a distinção
  // por eixo já vive no modelo de pneu.
  const lateralParams = params.lateral
    ?? (params.isRear ? REAR_PACEJKA_LATERAL : DEFAULT_PACEJKA_LATERAL);

  // Routing dos params de load sensitivity para as funções puras.
  // Ambas precisam ver os mesmos `loadSensN` e `loadSensRefFz` que estão
  // no envelope `params` deste call — caso contrário Fx0 e Fy0 saem
  // computados com defaults e o círculo de fricção fica inconsistente.
  const lateralCall = { ...lateralParams, loadSensN: params.loadSensN, loadSensRefFz: params.loadSensRefFz };
  const longCall = { ...(params.longitudinal ?? {}), loadSensN: params.loadSensN, loadSensRefFz: params.loadSensRefFz };

  const Fx0 = pacejkaLongitudinal(slipRatio, mu, N, longCall);
  const Fy0 = pacejkaLateral(slipAngle, mu, N, lateralCall);

  // razão combinada (envelope elíptico em α-κ space)
  const aNorm = slipAngle / ALPHA_PEAK;
  const kNorm = slipRatio / KAPPA_PEAK;
  const sCombined = Math.sqrt(aNorm * aNorm + kNorm * kNorm);

  if (sCombined < 1.0) {
    // dentro do envelope: forças puras já são consistentes com o círculo
    return { Fx: Fx0, Fy: Fy0 };
  }

  // fora do envelope: aplica círculo de fricção (D já com load sens sublinear)
  const D = effectiveD(mu, N, params);
  const Fmag = Math.sqrt(Fx0 * Fx0 + Fy0 * Fy0);
  if (Fmag <= 1e-6) return { Fx: 0, Fy: 0 };

  let scale = Math.min(1.0, D / Fmag);
  let Fx = Fx0 * scale;
  let Fy = Fy0 * scale;

  // viés de drift no rear: redistribui parte do envelope pro longitudinal
  // quando há slip ratio significativo na direção do movimento (power-on)
  if (params.isRear && Math.abs(slipRatio) > KAPPA_PEAK) {
    // 0.5 (era 0.4): mais "throttle steer" feel — preserva mais força
    // longitudinal sob oversteer power-on, sustenta o slide melhor.
    const driftBias = params.driftBias ?? 0.5;
    // sob power-on (κ alto), preserva longitudinal e atenua lateral
    const longBoost = 1.0 + driftBias * Math.min(1.0, (Math.abs(slipRatio) - KAPPA_PEAK) / KAPPA_PEAK);
    const latLoss = 1.0 - driftBias * Math.min(1.0, (Math.abs(slipRatio) - KAPPA_PEAK) / KAPPA_PEAK);
    Fx *= longBoost;
    Fy *= latLoss;

    // re-clip ao círculo (não pode estourar o D mesmo com viés)
    const reMag = Math.sqrt(Fx * Fx + Fy * Fy);
    if (reMag > D) {
      const reScale = D / reMag;
      Fx *= reScale;
      Fy *= reScale;
    }
  }

  return { Fx, Fy };
}

// ---------------------------------------------------------------
// Classe wrapper (opcional) para tuning per-axle
// ---------------------------------------------------------------

export class Tire {
  constructor(opts = {}) {
    this.mu = opts.mu ?? 1.0;
    this.lateral = {
      B: opts.lateralB ?? DEFAULT_PACEJKA_LATERAL.B,
      C: opts.lateralC ?? DEFAULT_PACEJKA_LATERAL.C,
      E: opts.lateralE ?? DEFAULT_PACEJKA_LATERAL.E,
    };
    this.longitudinal = {
      B: opts.longB ?? DEFAULT_PACEJKA_LONGITUDINAL.B,
      C: opts.longC ?? DEFAULT_PACEJKA_LONGITUDINAL.C,
      E: opts.longE ?? DEFAULT_PACEJKA_LONGITUDINAL.E,
    };
    this.isRear = opts.isRear ?? false;
    // 0.5 (era 0.4): default mais drift-friendly — alinha com combinedSlipForces.
    this.driftBias = opts.driftBias ?? 0.5;
  }

  computeForces(slipAngle, slipRatio, N, muOverride = null) {
    const mu = muOverride ?? this.mu;
    return combinedSlipForces(slipAngle, slipRatio, mu, N, {
      lateral: this.lateral,
      longitudinal: this.longitudinal,
      isRear: this.isRear,
      driftBias: this.driftBias,
    });
  }
}

export default Tire;
