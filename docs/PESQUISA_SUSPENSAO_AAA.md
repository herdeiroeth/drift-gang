# Pesquisa: física de carro AAA → proposta para drift-game web

> Pesquisa técnica + proposta arquitetural para evoluir o sistema atual de suspensão/load transfer ao nível de Forza Motorsport / Assetto Corsa, mantendo viabilidade para WebGL (target 60 fps com folga em desktops modernos).

---

## 1. Diagnóstico do sistema atual — onde está o "mole"

Lendo o código de física (`src/physics/Car.js`, `Wheel.js`, `Tire.js`), identifiquei **8 lacunas estruturais** que combinadas produzem o feel de carro "boiante":

### 1.1 Load sensitivity ausente (CRÍTICO)
**Onde:** [Tire.js:104,129](../src/physics/Tire.js)
```js
const D = mu * N;   // linear em Fz — ERRADO
```
Pneus reais têm `Fy_max ∝ Fz^n` com `n ∈ [0.7, 0.9]` ([Wikipedia: Tire load sensitivity](https://en.wikipedia.org/wiki/Tire_load_sensitivity)). Isso significa que **dobrar a carga sobre uma roda não dobra a força lateral disponível** — só dá ~80%. Esse é o motor físico do oversteer/understeer **dinâmico**: quando o peso transfere pra fora em curva, a roda externa ganha Fz mas perde μ.

**Sintoma observado:** carro "neutro demais", drift simétrico, falta de "sensação" do peso transferindo. **Custo de fix: zero (substituir 1 linha).**

### 1.2 Pitch/roll ad-hoc (ESTRUTURAL)
**Onde:** [Car.js:383-388](../src/physics/Car.js)
```js
const targetPitch = -this.accelLocal.x * PHYSICS_CFG.pitchAccelGain;
const targetRoll  = -this.accelLocal.z * PHYSICS_CFG.rollAccelGain;
this.pitchVel += ((targetPitch - this.pitch) * c.pitchStiff - this.pitchVel * c.pitchDamp) * sdt;
```
Pitch e roll são uma mola+amortecedor que persegue um ângulo proporcional à aceleração — **não emerge da física**. É puro "feel post-processing".

**Consequências:**
- Não existe roll axis real. Carros AAA têm a inclinação saindo do ponto onde sprung mass pivota (roll center) — aqui é apenas decoração.
- Pitch e roll não afetam realmente a posição do CG (`carPos.y` segue só `velocity.y` integrada da soma de molas). Em curvas reais, o CG sobe um pouco no body roll.
- Compressão das suspensões (FL/FR/RL/RR) **não está acoplada** ao pitch/roll do body — molas e ângulo do chassi são duas histórias separadas.

### 1.3 Sprung/unsprung não separados (CRÍTICO)
**Onde:** [Wheel.js:55-115](../src/physics/Wheel.js) — só há 1 massa por canto (a do chassi); a roda em si não oscila verticalmente independente.

`wheelMass = 18 kg` é usado só para inércia rotacional (`wheelInertia`), nunca pra dinâmica vertical. Resultado: **a roda se gruda no chassi** — sem oscilação independente em ~12 Hz, sem wheel hop, sem "vida" no contato com curbs/pista irregular.

**Frequência natural sprung:** ~1.5-2.5 Hz (bem). 
**Frequência natural unsprung:** ~10-16 Hz (faltando aqui — colapsada na sprung).

### 1.4 Load transfer puramente elástico
**Onde:** [Car.js:239-250](../src/physics/Car.js)
```js
const totalSusp = fl.suspensionForce + fr.suspensionForce + rl.suspensionForce + rr.suspensionForce;
// ...
const frontRoll = c.antiRollFront * (fl.compression - fr.compression);
fl.normalLoad = Math.max(0, fl.suspensionForce + frontRoll * 0.5);
```
A carga normal é só `springForce ± ARB term`. Falta a **componente geométrica instantânea** do load transfer:
```
ΔFz_geom = m_axle · ay · h_RC / track
```
Em carros reais, parte do load transfer é instantânea (via roll center geometry) e parte é elástica (via compressão de mola). Sem o geom, o carro sempre sente "lag" antes da carga transferir — é parte do "mole".

### 1.5 ARB simplificado
ARB atual transfere carga proporcional à diferença de compressão. Real: barra torsional com motion ratio, contribuição em **antifase** apenas (paralelo cancela). Faltam parâmetros físicos (diâmetro, comprimento, módulo de cisalhamento).

### 1.6 Self-aligning torque (SAT) é hack no input
**Onde:** [Car.js:191-200](../src/physics/Car.js)
```js
correction = -avgFrontSlip * speedFactor * SAT_STRENGTH * dt;
this.steer = Math.max(-1.0, Math.min(1.0, this.steer + correction));
```
Aplicado direto no canal de input do steer, com força arbitrária `SAT_STRENGTH = 0.6`. SAT real emerge de:
```
M_kingpin = Fy_front · (mech_trail + pneumatic_trail(α))
```
Onde `mech_trail = R_wheel · sin(caster)` e pneumatic trail decai a zero pós-peak de slip. **Drift cars usam 5–12° de caster** justamente porque um SAT alto faz o volante voltar sozinho no countersteer ([Suspension Secrets — Drift Setup](https://suspensionsecrets.co.uk/drift-car-set-up/)).

### 1.7 Contact patch pontual
1 raycast por roda → modelo "single-point". Forza Motorsport 2023 introduziu **8 pontos de contato por pneu** ([Forza.net news](https://forza.net/news/forza-motorsport-drivatars-tire-physics)) — 48× a fidelidade da geração anterior. Em web, **4 pontos** (cantos do contact patch) é viável e cobre 80% do ganho.

### 1.8 Sem geometria de suspensão (anti-dive / anti-squat)
Não há pickup points 3D. Anti-dive% e anti-squat% são derivados da geometria de braços (LCA + UCA) — sem isso, o carro mergulha igual em qualquer setup, e não tem como tunar "throttle-on oversteer autêntico" via setup.

---

## 2. Estado da arte AAA (síntese)

| Engine | Freq | Massa | Tire model | Suspensão |
|---|---|---|---|---|
| **Forza Motorsport 2023** | **360 Hz** | Single body + 4 corners | **8-point contact patch** discretizado | Multi-link parametrizado, ARB real |
| **Assetto Corsa Comp.** | **400 Hz** (v1.8+) | Sprung + 4 unsprung **separados** | Brush model 5-point | **Pickup points 3D puros** — anti-dive/squat emergem |
| **iRacing NTM v10** | ~360 chassi / ~600 tire | Sprung + unsprung + carcaça elástica | **NTM:** N-slice contact patch com termo, condicionamento e wear independentes por slice. Double-precision. | Pickup points + flex chassis |
| **rFactor 2** | ~400 Hz | Sprung + unsprung | **TGM thermomechanical** com LUTs pré-computados | Pickup points reais |
| **GT7** | ~360 Hz | Single body | Híbrido empírico/heurístico | Geometria parametrizada |
| **BeamNG** | **2000 Hz** | Soft-body completa (node-beam) | Pneu também soft-body | Emergente da malha de beams |

**4 traços comuns dos sims puros:**
1. ≥ 360 Hz física
2. Sprung / unsprung separados
3. Suspensão por **pickup points 3D** (anti-dive/squat/roll-center emergentes)
4. Tire model com **brush model** ou superior, **load sensitivity sublinear**, **temperatura por slice**

---

## 3. Conceitos-chave aplicáveis (resumo executivo)

### 3.1 Sprung / unsprung
- **Sprung:** chassis + motor + ocupantes (~85-90% massa)
- **Unsprung:** roda + freio + half-shaft (~10-15% massa, ~18-30 kg/canto)
- Frequência: `f = (1/2π)·√(k/m)` — 1.5-2.5 Hz sprung, 10-16 Hz unsprung
- **Implementação mínima:** 4 osciladores 1D verticais acoplados ao body. +4 DOFs, +50 muls/frame

### 3.2 Load transfer total (lateral)
```
ΔFz_total = m · ay · h_CG / track          // não muda com setup
```
Mas a **distribuição** entre os 3 caminhos sim:
- Geométrica (instantânea, via roll center): `m_axle · ay · h_RC / track`
- Elástica (com lag, via mola+ARB): proporcional a roll stiffness
- Unsprung: `m_unsprung · ay · h_unsprung_CG / track`

**Em drift:** roll center traseiro alto = transferência geométrica rápida = "pega slide imediato". Tunável.

### 3.3 Tire load sensitivity
Pacejka 1994 usa `D = a1·Fz² + a2·Fz` com `a1 < 0`, naturalmente sublinear. Forma simplificada que vou propor:
```
mu_eff(Fz) = mu0 · (Fz/Fz_ref)^(n-1)    com n ≈ 0.85, Fz_ref = static load
```

### 3.4 Caster trail / SAT
```
mech_trail   = R_wheel · sin(caster_angle)         // fixo, ~0.02-0.04 m
pneum_trail  = trail0 · (1 - |α|/α_peak)·sign(α)   // varia com slip angle
M_kingpin    = Fy_front · (mech_trail + pneum_trail)
```
Esse momento aplicado ao "steer" gera o countersteer "vivo" sem hack.

### 3.5 Anti-roll bar (real)
```
K_arb_wheel = K_arb · (track²) / motion_ratio²
F_arb_per_wheel = K_arb_wheel · (compr_left - compr_right) / 2     // antifase apenas
```

### 3.6 Pickup points 3D (anti-geometry)
Definir 6 pontos 3D por canto:
- LCA inboard + outboard (Lower Control Arm)
- UCA inboard + outboard (Upper Control Arm)
- Tie rod inboard + outboard

**Anti-squat% (rear, throttle):**
```
tan(θ_arm_side) · (wheelbase / h_CG) × 100
```
- θ_arm_side: ângulo da linha que vai do contact patch ao instant center (intersecção das linhas dos braços projetadas no plano lateral)

---

## 4. Proposta arquitetural — "Drift Engine v2"

Fases ordenadas por **(custo de implementação) × (impacto no feel)**. Começa em quick wins, termina em refactors maiores.

### Fase 1 — Quick wins (1-2 dias, ROI massivo)
**Risco:** baixo. **Compatibilidade física:** 100%.

#### F1.1 Load sensitivity sublinear no Pacejka
Trocar 1 linha em [Tire.js:104,129](../src/physics/Tire.js):
```js
// antes:
const D = mu * N;
// depois:
const Fz_ref = 4000;       // ~static load por roda em carro 1300kg
const n = 0.85;
const D = mu * N * Math.pow(Math.max(N, 100) / Fz_ref, n - 1);
```
**Custo:** 1 pow/frame/roda = ~20 ns extras. **Impacto: muda DRAMATICAMENTE o feel.**

#### F1.2 Caster trail + SAT físico
Adicionar `casterAngle = 0.10` rad (~5.7°) ao `CarConfig`. Calcular `mech_trail` no constructor de `Wheel`. Substituir [Car.js:191-200](../src/physics/Car.js) `applySelfAligningTorque` por:
```js
applyKingpinSAT(dt) {
  const fl = this.wheels[0], fr = this.wheels[1];
  const Fy_front = fl.lateralForce + fr.lateralForce;
  // pneumatic trail (decai pós-peak)
  const alpha = (fl.slipAngle + fr.slipAngle) * 0.5;
  const alphaPeak = 0.105;
  const pneumTrail = this.cfg.pneumTrail0 * Math.max(0, 1 - Math.abs(alpha)/alphaPeak) * Math.sign(alpha);
  const mechTrail = this.cfg.mechTrail;
  const M_kingpin = Fy_front * (mechTrail + pneumTrail);
  // converte momento em correção de input do steer (dt convertido pra cinemática)
  const correction = M_kingpin * this.cfg.steerSatGain * dt;
  this.steer = Math.max(-1.0, Math.min(1.0, this.steer + correction));
}
```
**Custo:** trivial. **Impacto:** countersteer "vivo", feedback muscular do volante via gamepad force-feedback, drift autêntico.

#### F1.3 Tire pneumatic trail post-peak (já tem 50%)
Já temos `slipAngle` clampado em `maxSlipAngle = 0.55`. Adicionar pneumatic trail explícito acima.

**Total Fase 1:** ~3 horas de código, ~15 linhas alteradas. Impact: **alto**. É a faixa que mais muda o feel sem refactor.

---

### Fase 2 — Sprung/unsprung separation + ARB real (3-5 dias)
**Risco:** médio. **Compatibilidade:** mantém interface de Wheel.js, adiciona DOF.

#### F2.1 Modelo 8-DOF vertical
Hoje: 1 DOF vertical (carPos.y). Adicionar 4 unsprung masses verticais independentes.

**Estrutura:**
```js
class Wheel {
  // ... existentes
  unsprung_y = 0;          // posição vertical da massa unsprung relativa ao chassi
  unsprung_vy = 0;         // velocidade vertical
  unsprungMass = 22;       // kg, novo no CarConfig
}
```

**Forças no sistema 5-massa (sprung + 4 unsprung):**
- Spring: `F_spring = k · (compression_total)` agora dividido em **2 estágios**:
  - Tire spring (carcaça): `k_tire · (ground_y - unsprung_y - tireRadius)`
  - Suspension spring: `k_susp · (chassis_attach_y - unsprung_y - rest_offset)`
- Damper: análogo para cada estágio
- ARB: aplicado entre unsprungs do mesmo eixo

**Integração:** 4 osciladores semi-implicit Euler acoplados ao body (já existente). +4 DOFs, +30 muls/frame, +1 KB de memória de estado.

**Resultado físico:** 
- Roda passa a oscilar a ~12 Hz independente do chassi
- Curbs e zebras geram wheel hop visível
- Clutch-kick rear unsprung "rebota" → spike instantâneo de Fz → controle de drift mais autêntico

#### F2.2 ARB real (motion-ratio + antifase)
Substituir o cálculo simples de [Car.js:245-250](../src/physics/Car.js) por:
```js
// Front ARB
const dz_front = (fl.unsprung_y - fr.unsprung_y);
const F_arb_front = c.antiRollFront_K * dz_front * c.arbMotionRatio_front;
fl.suspensionForce += F_arb_front;
fr.suspensionForce -= F_arb_front;
// Rear análogo
```

#### F2.3 Pitch/roll emergentes
Remover [Car.js:383-388](../src/physics/Car.js) (pitch/roll ad-hoc). Substituir por **derivação geométrica** das compressões:
```js
this.roll = Math.atan2((rl.unsprung_y + fl.unsprung_y) - (rr.unsprung_y + fr.unsprung_y), 2*c.trackWidth);
this.pitch = Math.atan2((fl.unsprung_y + fr.unsprung_y) - (rl.unsprung_y + rr.unsprung_y), 2*c.wheelBase);
```
Pitch e roll **emergem** das deflexões reais das suspensões, sem mola ad-hoc. **CG sobe levemente em roll** — efeito real.

**Total Fase 2:** ~600 linhas de código novo, refactor cuidadoso de Wheel.js + Car.js.doPhysics. Tuning UI ganha 4 sliders novos (k_tire, unsprungMass, arbMotionRatio_F, _R).

---

### Fase 3 — Pickup points 3D + anti-geometry (1-2 semanas)
**Risco:** alto. **Compatibilidade:** quebra layout de Wheel; refactor profundo.

#### F3.1 Suspension topology
Definir em `CarConfig`:
```js
suspensionPivots: {
  fl: {
    LCA_inboard:  new Vec3(-0.30, 0.10, 1.30),  // chassis side
    LCA_outboard: new Vec3(-0.78, 0.10, 1.35),  // wheel hub side
    UCA_inboard:  new Vec3(-0.35, 0.40, 1.30),
    UCA_outboard: new Vec3(-0.75, 0.45, 1.35),
    tieRod_inboard:  new Vec3(-0.40, 0.20, 1.10),
    tieRod_outboard: new Vec3(-0.78, 0.22, 1.32),
  },
  fr: { /* mirror */ }, rl: { ... }, rr: { ... }
}
```

#### F3.2 Cinemática constrained
A cada frame, dado o estado vertical da roda (`unsprung_y`), calcular:
- Posição do hub via constraints geométricos (o hub deve manter distâncias dos braços)
- **Camber angle:** ângulo do hub em relação ao chassi
- **Toe angle:** rotação do hub no eixo Y
- **Anti-squat / anti-dive:** ângulo do braço lateralmente projetado × wheelbase / h_CG

#### F3.3 Roll center dinâmico
```js
// Linha do contact patch ao instant center (IC)
// IC = intersecção das projeções dos braços no plano lateral
// Roll center = intersecção da linha CP→IC com a centerline
this.rollCenterFront_h = computeRollCenterHeight(fl.pivots, fr.pivots);
this.rollCenterRear_h  = computeRollCenterHeight(rl.pivots, rr.pivots);
```
Aplicar load transfer geométrico:
```js
const ay_axle_front = ay * (fl.normalLoad + fr.normalLoad) / totalNormalLoad;
const dFz_geom_front = m_axle * ay_axle_front * this.rollCenterFront_h / c.trackWidth;
fl.normalLoad += dFz_geom_front; fr.normalLoad -= dFz_geom_front;
// resto vai pra elástico via spring + ARB (Fase 2)
```

**Total Fase 3:** refactor pesado, ~1500 linhas. Tuning UI ganha vista de pivots 3D editáveis. **ROI:** drift cars com camber gain real, throttle-on oversteer autoconfigurável via setup.

---

### Fase 4 — Web Worker física + LUT (3-5 dias)
**Risco:** médio. **Foco: performance.**

#### F4.1 Mover doPhysics pra Web Worker
- Worker dedicado roda física a 240+ Hz
- Main thread renderiza a 60 fps consumindo estado via SharedArrayBuffer
- Latência de input: 1 frame (~16ms) — imperceptível
- **Ganho:** desacopla física de stutter de render. Frame drops no main thread não afetam física.

#### F4.2 LUT de Pacejka
Pré-computar tabela 2D `Fy(slipAngle, Fz)` e `Fx(slipRatio, Fz)`:
- Resolução: 64 × 16 = 1024 entradas × 4 bytes = 4 KB
- Bilinear interp em runtime: 6 muls em vez de 4 atan + 2 sin + 4 mul
- **Ganho:** ~5× speedup no tire model

#### F4.3 WASM hot loop (opcional)
Compilar `Wheel.updateTireForces` + `Wheel.updateSuspension` pra WASM via AssemblyScript. **Ganho típico:** 3-10× sobre JS para hot loops numéricos. Justifica ROI só se Fase 1+2 saturarem o orçamento de 5-8 ms.

---

## 5. Performance budget

**Estimativa para 1 carro com pipeline AAA-like completo, em desktop moderno (M2 / Ryzen 5000):**

| Componente | Custo (ms/frame @ 240 Hz × 60 fps) |
|---|---|
| Suspensão atual (raycast + spring/damper) | 0.3 |
| Pacejka full + load sensitivity | 0.5 |
| Sprung/unsprung 8-DOF + ARB real | 0.4 |
| Pickup points 3D constrained | 0.8 |
| Multi-point contact (4 pts/pneu) | 0.6 |
| Powertrain (já existe) | 0.3 |
| **Total física** | **~2.9 ms** |
| Render (Three.js BMW M4 GLB ~500k tris) | 6-8 ms |
| **Total frame** | **~10-12 ms** (60 fps com folga) |

**Em desktops mais fracos** (laptop integrada): mover física pra Web Worker (Fase 4) garante 60 fps de render mesmo se física spikar.

---

## 6. Roadmap recomendado

1. **Sprint 1 (esta semana):** Fase 1 inteira. Quick wins. Validar feel.
2. **Sprint 2:** Fase 2.1 (sprung/unsprung) + 2.3 (pitch/roll emergente). Adicionar 4 sliders no Tuning UI.
3. **Sprint 3:** Fase 2.2 (ARB real) + benchmarks. Comparar contra setup target.
4. **Sprint 4-5:** Decidir Fase 3 baseado no feel pós-Fase 2. Se já estiver "AC tier", talvez não precise.
5. **Sprint paralelo:** Fase 4 (Web Worker) — pode rodar em paralelo, não bloqueia.

**Decisão estratégica:** começa por F1 (3h, mudança massiva), avalia, depois F2.1+F2.3 (mola+amortecedor 2-stage + pitch/roll geométrico). Se sentir AAA-tier após isso, economiza Fase 3.

---

## 7. Referências (curadas, prioridade técnica)

### Engenheiros de sims (publicações diretas)
- [Aris Vasilakos (Kunos AC) — 5-point tire & chassis flex](https://www.bsimracing.com/assetto-corsa-competizione-talking-physics-with-aristotelis-vasilakos/)
- [Dave Kaemmer (iRacing) — three-zone tire curve, theory vs empirical](https://www.iracing.com/the-sticking-points-in-modeling-tires/)
- [iRacing NTM v10 detalhado](https://iracerhub.com/iracing-ntmv10-tire-model-explainer/) — slicing, 40+ params
- [Forza 2023 — 8-point contact patch + 360 Hz](https://forza.net/news/forza-motorsport-drivatars-tire-physics)
- [Yamauchi (GT7) — tire model is the hardest, drivability é o desafio](https://www.gtplanet.net/dr-kazunori-yamauchi-gives-lecture-gran-turismos-driving-physics-production/)

### GDC / Talks
- [GDC 2019 — Hamish Young, Vehicle Physics & Tire Dynamics in Just Cause 4](https://www.gdcvault.com/play/1026035/Vehicle-Physics-and-Tire-Dynamics) — crítica do Magic Formula, propõe modelo designer-friendly. **Direto relevante.**

### Papers acadêmicos
- [A physical tire model for real-time simulations (ScienceDirect 2024)](https://www.sciencedirect.com/science/article/pii/S0378475424001460) — brush otimizado para hard real-time, com benchmarks
- [Brush-based thermo-physical tyre model (FSAE)](https://radar.brookes.ac.uk/radar/file/9c79f105-7bed-4abf-be0d-4e6be7d9eb46/1/fulltext.pdf)
- [Pacejka '94 parameters explained (Edy.es)](https://www.edy.es/dev/docs/pacejka-94-parameters-explained-a-comprehensive-guide/)
- [Stanford Brake-By-Wire tires (PDF)](http://www-cdr.stanford.edu/dynamic/bywire/tires.pdf) — brush vs Pacejka comparados

### Vehicle dynamics fundamentals
- [Suspension Secrets — Lateral & Longitudinal Load Transfer](https://suspensionsecrets.co.uk/lateral-and-longitudinal-load-transfer/) — fórmulas
- [Suspension Secrets — Drift Setup (caster, toe, spring)](https://suspensionsecrets.co.uk/drift-car-set-up/)
- [Suspension Secrets — Anti-Squat / Dive / Lift Geometry](https://suspensionsecrets.co.uk/anti-squat-dive-and-lift-geometry/)
- [OptimumG — Bar Talk (ARB theory)](https://optimumg.com/bar-talk/)
- [OptimumG — The Anti-Antis (anti-dive/squat math)](https://optimumg.com/the-anti-antis/)
- [Wavey Dynamics — Anti-Geometry breakdown](https://www.waveydynamics.com/post/anti-geometry)
- [Wavey Dynamics — Weight Transfer + Roll Centre](https://www.waveydynamics.com/post/weight-transfer-rc)
- [Tire load sensitivity — Wikipedia](https://en.wikipedia.org/wiki/Tire_load_sensitivity)

### Game implementation references
- [Marco Monster — Car Physics for Games (sua base atual)](https://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/Car%20Physics%20for%20Games.html)
- [Vehicle Physics Pro — Tires (Edy)](https://vehiclephysics.com/blocks/tires/)
- [Gaffer on Games — Integration Basics (semi-implicit Euler ftw)](https://gafferongames.com/post/integration_basics/)

### Soft-body extremo (referência de teto)
- [BeamNG.tech Whitepaper](https://beamng.tech/blog/2021-06-21-beamng-tech-whitepaper/bng_technical_paper.pdf) — node-beam, 2 kHz, Verlet
