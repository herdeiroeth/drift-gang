# Pesquisa: Shift Feel + Engine RPM Build-up + Weight Transfer

**Status:** Proposta — aguardando OK antes de implementar.
**Contexto:** o usuário relata que o motor "não enche" de forma convincente e que durante a troca de marcha não há sensação de "peso do carro caindo" na suspensão. Antes de codar, este doc consolida (a) diagnóstico do estado atual, (b) como AAA resolvem (Forza, AC, iRacing, VPP), (c) fórmulas concretas, (d) plano de implementação ordenado.

---

## 1. Diagnóstico do estado atual

### 1.1 Pitch dynamics — atualmente é fudge visual

`Car.js:410-415`:

```js
const targetPitch = -this.accelLocal.x * PHYSICS_CFG.pitchAccelGain;  // 0.022
this.pitchVel += ((targetPitch - this.pitch) * c.pitchStiff - this.pitchVel * c.pitchDamp) * sdt;
this.pitch += this.pitchVel * sdt;
this.mesh.rotation.set(this.pitch, this.heading, -this.roll);
```

O `pitch` é apenas a rotação visual do mesh — NÃO é integração rigid-body real. A magnitude depende de `pitchAccelGain` (0.022) e converge ao `targetPitch` via spring-damper. **Não tem F_x acoplado ao momento de pitch real do chassi.** Em consequência:

- A transferência de carga na roda (`normalLoad`) só vem do **raycast da suspensão**, que ENCONTRA o piso quando o pitch (visual) inclina o ponto do raycast. Há um efeito mas é indireto e amortecido.
- Não há "anti-squat" geometry — toda transferência de peso passa pelas molas.
- O **jerk longitudinal** (derivada da aceleração) na transição de torque é absurdo no código (de full a 0 em 1 frame), mas a suspensão não recebe o impulso correspondente.

### 1.2 Engine RPM build-up — equação está certa, parametrização está OK

`Engine.updateFree` integra `dω/dt = (T_raw·boost − T_friction + coast − T_clutch + idle)/J_e` com `J_e = 0.20`. Isso É a equação Newton-Euler que AAA usam (VPP, AC). Os parâmetros estão razoáveis. O que falta:

- Throttle map é **linear** (`raw·throttle`). Real: 50% pedal ≈ 70% torque em low RPM (Project Motor Racing 2025). Linear faz o pedal sentir "morto" no início.
- Não há "throttle smoothing" — input do teclado (0/1 binário) chega cru no engine. Em real, drive-by-wire tem ~30-80ms de smoothing.

### 1.3 Shift transient — instantâneo

Atualmente:

- Durante `isShifting` (300ms h-pattern, 60ms sequential): `gearRatio=0` → `transmittedTorque=0`. Torque cai no cliff a zero.
- Pós-shift: torque volta **a 100% no mesmo frame**. Não há ramp-up via clutch slipping.

Em AAA, o shift é uma máquina de estados: `PRE → CUT (50–150ms torque=0) → SLIP (50–150ms ramp 0→100%) → LOCKED`. Hoje é só `PRE → CUT → LOCKED` sem o estado SLIP.

### 1.4 Reflected inertia — implementada, mas só na roda

`Car.js:341-342`:

```js
effectiveRearInertia += (engine.inertia * (gearRatio * diffRatio)²) / 2;
```

Bom — em 1ª (3.6×3.8) gera `+20.6 kg·m²`. Cada marcha "pesa" diferente. Mas só afeta a integração da `wheelOmega`, não há driveline torsional spring nem oscilação de "shuffle".

### 1.5 Lacunas resumidas

| # | Lacuna | Impacto sentido |
|---|---|---|
| A | Pitch não é rigid-body real (sem F_x · h coupling) | Shift não "trança" a suspensão |
| B | Sem anti-squat / anti-dive geometry | Squat/dive uniforme, sem variação por geometria |
| C | Sem state machine de shift (sem SLIP ramp) | Trocas instantâneas, sem "kick" suave |
| D | Throttle map linear | Pedal binário "morto", motor não modula bem |
| E | Sem throttle smoothing | Input cru de teclado gera transientes irreais |
| F | Sem driveline torsional spring | Sem "shuffle" pós-shift (~6 Hz) |

---

## 2. Estado da arte (AAA)

### 2.1 Engine RPM build-up

Todas as sims (AC, VPP, iRacing, PMR) usam a mesma primitiva:

```
dω_e/dt = (T_combustion − T_friction − T_clutch) / J_e
```

`J_e` típico: F1 ~0.10, road car ~0.15-0.30, truck ~8-10. Project Motor Racing (2025) inova com **throttle response não-linear**: a 50% pedal o motor entrega ~70% torque em RPM baixo (curva de mapa TPS×RPM no driver-by-wire).

### 2.2 Shift transient — emerge naturalmente

A pesquisa é categórica: **"AAA sims do NOT add ad-hoc shift jerk; they let the body's rigid-body dynamics react to the change in F_x at the contact patches"**. Ou seja: o pitch sentido na troca não é um efeito visual hardcoded, é o resultado natural de:

1. Pré-shift: `F_x_rear` = peak → squat traseiro (load transfer).
2. Mid-shift (clutch open): `F_x → 0` em 50-150ms → desaceleração de drag → forward dive leve.
3. Re-engage (clutch slipping): `F_x` ramps up → squat traseiro + possível overshoot se anti-squat baixo.

### 2.3 Pitch dynamics — half-car 4-DOF

Modelo padrão AAA (Milliken, citado por Forza):

```
m_s · z̈ + Σ(c·ż_i + k·z_i) = 0                     # heave
I_y · θ̈ = l_f · F_sf − l_r · F_sr + h · F_x        # pitch
```

O termo crítico é `h · F_x`: força longitudinal aplicada no contact patch (em z = -h relativo ao CG) gera momento de pitch automático. **Esse é o acoplamento que falta no projeto hoje.**

Load transfer estático (referência):

```
ΔW_long = m · a_x · h / L
N_f = (c/L)·m·g − ΔW_long
N_r = (b/L)·m·g + ΔW_long
```

### 2.4 Anti-squat / Anti-dive geometry

Geometria do braço de controle determina quanto da força longitudinal vai pelo braço (sem comprimir mola) vs pela mola.

```
AS% = tan(θ_sva) · L / h_cg
```

`AS%` 100% → traseira não comprime sob aceleração. `<100%` → squat. `>100%` → traseira levanta. Em drift cars (Toyota AE86, Nissan S-chassis): AS% ~30-50% — squat sentido mas controlável.

Implementação prática: multiplicar a parcela de `F_x` que vai como força vertical na suspensão por `(1 - AS%/100)`.

### 2.5 Shift state machine

```
PRE      throttle aberto, gear N, clutch lock
  ↓ user press shift
CUT      torque = 0, clutch open, 50-150ms        # ignition cut em sequential
  ↓
SHIFT    gearRatio em transição (sincronizadores), 30-80ms
  ↓
SLIP     clutch friction ramps 0→1, 50-150ms     # T_clutch = μ·F·R · ramp
  ↓
LOCKED   ω_e = ω_d · ratio, transmissão direta
```

`T_clutch` durante SLIP segue:

```
T_clutch(t) = μ · F_clamp(t) · R_eff · sign(ω_e − ω_d)
F_clamp(t) = F_max · ramp(t)         # ramp linear ou ease-in
```

### 2.6 Driveline torsional dynamics (polish)

Eixo de transmissão é mola torsional `K_shaft` (1000-5000 Nm/rad) entre engine output e wheel input. Após shift, ω_e ≠ ω_d → impulse de slip → squat + oscilação **shuffle 4-12 Hz** (Schaeffler). Modela como:

```
T_shaft = K_shaft · (θ_e − θ_d) + C_shaft · (ω_e − ω_d)
```

É polish — só vale implementar se os passos 1-3 da seção 4 não bastarem.

---

## 3. Fórmulas que vamos precisar

### 3.1 Pitch acceleration (rigid body real)

```
I_y = m · k_y²                        # k_y ≈ 1.0–1.5 m (radius of gyration)
                                      # ou aproximação: I_y ≈ m·(L²/12 + h²/3)

# Pitch torque a partir de F_x e F_susp em offsets
τ_pitch = Σ (F_x_i · h_cg) + Σ (F_susp_i · z_offset_i)

θ̈ = τ_pitch / I_y
```

Para o nosso `CarConfig` (`m=1300, L=2.7, h=0.5`):

```
I_y ≈ 1300 · (2.7²/12 + 0.5²/3) ≈ 1300 · (0.6 + 0.083) ≈ 888 kg·m²
```

### 3.2 Load transfer instantâneo (a aplicar como overlay no normalLoad)

```
ΔN = m · a_x · h / L                  # transferência da frente pra trás (positivo = traseira ganha)
N_f += -ΔN/2 cada (frente)
N_r += +ΔN/2 cada (traseira)
```

Em arrancada a 0.85g: `ΔN = 1300 · 8.34 · 0.5 / 2.7 ≈ 2007 N` redistribuídos.

### 3.3 Anti-squat partition

```
F_susp_long_share_rear = F_x_rear · (1 - AS_rear/100)    # parcela que vai pra mola
F_arm_long_share_rear  = F_x_rear · (AS_rear/100)         # parcela que vai pelo braço (não comprime)
```

### 3.4 Clutch slip ramp (shift state SLIP)

```
ramp(t) = clamp(t / slipTime, 0, 1)
ramp_smooth(t) = 0.5 · (1 − cos(π · ramp(t)))   # ease-in-out, mais suave
T_transmitted = T_engine_locked · ramp_smooth(t)
```

### 3.5 Throttle response não-linear

```
T_eff = T_curve(rpm) · throttle_map(throttle, rpm)

# throttle_map sugerido (curva inspirada PMR):
throttle_map(p, rpm) =
  rpm < 2000 ? p^0.7 :       # low RPM: 50% pedal = 70% torque (responsivo)
  rpm > 5000 ? p^1.2 :       # high RPM: 50% pedal = 38% (linear-ish, mas penaliza meio-pedal)
                p             # mid RPM: linear
```

---

## 4. Plano de implementação (ordem de impacto)

### Fase 1 — pitch rigid-body real (impacto: ALTO)

1. Adicionar `pitchInertia (I_y)` em `CarConfig` (~888 kg·m²).
2. Adicionar `cgHeight` já existe (0.50). Adicionar `antiSquatRear` (default 35%) e `antiDiveFront` (default 50%).
3. Em `Car.doPhysics`, após calcular `totalFx`:
   ```
   pitchTorque = totalFx · cgHeight     # F_x no patch puxa pitch positivo
   pitchAccel = pitchTorque / I_y
   pitchRate += pitchAccel · sdt
   pitch     += pitchRate · sdt
   pitch     -= pitch · pitchDamp · sdt   # damping conjunto da suspensão
   ```
4. **Remover o targetPitch fudge atual.**
5. Aplicar load transfer overlay no `normalLoad`:
   ```
   ΔN = mass · accelLocal.x · cgHeight / wheelBase
   fl/fr.normalLoad -= ΔN/2
   rl/rr.normalLoad += ΔN/2
   ```
   Aplicar APÓS o anti-roll já existente.

### Fase 2 — Shift state machine com SLIP ramp (impacto: ALTO)

1. Adicionar estados em `Gearbox`: `PRE | CUT | SLIP | LOCKED`.
2. `cutTime` (30-80ms sequential, 80-150ms h-pattern), `slipTime` (50-150ms).
3. Durante CUT: `transmittedTorque = 0` (já é).
4. Durante SLIP: `transmittedTorque *= ramp_smooth(t/slipTime)`.
5. Engine permanece em estado `updateFree` durante CUT+SLIP, integrando ω_e contra friction (gera flare natural).

### Fase 3 — Anti-squat / Anti-dive partition (impacto: MÉDIO)

1. Em vez de `F_x` chegar nas rodas como força horizontal pura, separar em:
   - `(1 − AS%) · F_x` → transmite ao chassi via mola (gera momento de pitch real).
   - `AS% · F_x` → transmite via braço da suspensão (sem comprimir mola).
2. Visualmente: traseira "salta" menos sob power-on quando AS é alto.

### Fase 4 — Throttle response não-linear + smoothing (impacto: MÉDIO)

1. Adicionar `throttle_map(throttle, rpm)` em `Engine`.
2. Smoothing: `throttleSmoothed += (throttleInput − throttleSmoothed) · k · dt` com `k ≈ 12` (Tau ~80ms).

### Fase 5 — Driveline torsional spring (POLISH, opcional)

1. Variável `θ_e − θ_d` (twist do eixo).
2. `T_shaft = K · twist + C · (ω_e − ω_d)`.
3. Modela "shuffle" pós-shift de 6 Hz.

---

## 5. Decisões pendentes (perguntas pro usuário)

1. **Vai pela Fase 1+2 (pitch real + shift state machine)** primeiro, e validamos antes de mexer nas outras? Ou faz tudo de uma vez?
2. **Shift duration**: prefere mais arcade (cutTime curto, slipTime curto, total ~100ms) ou simulador (h-pattern total ~300ms)? Posso deixar tunável no painel ECU.
3. **Anti-squat default**: 35% rear / 50% front (drift street típico) ou 70% rear (pickup/SUV-like, traseira firme)?
4. **Throttle map curve**: aplica a curva PMR-inspired, ou deixa linear para keyboard binário?
5. **Pitch limit**: cap em `±15°` para evitar capotamento visual exagerado?

---

## 6. Notas de implementação

- O `pitch` virá **rigid-body real** mas ainda integrado em 1-DOF (não half-car 4-DOF completo). Isso é suficiente para o feel de shift; half-car completo é overkill pra um arcade-sim.
- Preserva o anti-roll existente (Car.js:269-275). Anti-roll é lateral; pitch é longitudinal — não conflitam.
- A `effectiveRearInertia` JÁ inclui o `I_engine·(gear·diff)²/2` (Car.js:342). Isso continua valendo durante LOCKED. Durante SLIP, a inércia "vista" pela roda é menor (motor ainda livre) — vou ajustar o cálculo conforme estado do shift.
- O `mesh.rotation.set(pitch, heading, -roll)` continua. O que muda é COMO o `pitch` é calculado — agora rigid-body real.

---

## Referências consultadas

### Engine + drivetrain
- Vehicle Physics Pro — Engine block: https://vehiclephysics.com/blocks/engine/
- Vehicle Physics Pro — Inertia: https://vehiclephysics.com/blocks/inertia/
- Edy — Engine/clutch/gearbox in VPP: https://www.edy.es/dev/2015/02/engine-clutch-and-gearbox-in-vehicle-physics-pro/
- x-engineer — Simple engine and driveline modeling: https://x-engineer.org/engine-driveline-modeling-simulation/
- VDS Section 7 — Drivetrain Dynamics: https://bamason2.github.io/ttc066-module/notes/Section_7.html
- Project Motor Racing — Throttle Response Model (2025): https://projectmotorracing.com/newsArticle.php?articleCode=OWEyOTQ5MDZh
- AC engine inertia: https://assettocorsamods.net/threads/calculating-engine-inertia-under-engine-ini.3584/

### Pitch / load transfer / anti-squat
- Wikipedia — Weight transfer: https://en.wikipedia.org/wiki/Weight_transfer
- Suspension Secrets — Lateral and Longitudinal Load Transfer: https://suspensionsecrets.co.uk/lateral-and-longitudinal-load-transfer/
- Suspension Secrets — Anti Squat, Dive and Lift: https://suspensionsecrets.co.uk/anti-squat-dive-and-lift-geometry/
- Azman/Rahnejat — Anti-dive/anti-squat (SAGE): https://journals.sagepub.com/doi/10.1243/1464419043541464
- OptimumG — The anti-antis: https://optimumg.com/the-anti-antis/
- Wavey Dynamics — Anti-Geometry: https://www.waveydynamics.com/post/anti-geometry
- Najam R. Syed — Half-car suspension model: https://nrsyed.com/2018/01/07/numerical-approach-to-studying-vehicle-dynamics-with-a-half-car-suspension-model/
- Half-car GitHub: https://github.com/nrsyed/half-car

### Shift transient + clutch
- ResearchGate — Accelerations during 2-3 upshift: https://www.researchgate.net/figure/Accelerations-during-2-3-upshift-transient-simulation-a-C1-clutch-hub-acceleration-in_fig6_245390795
- Schaeffler 2010 — Clutch + torsional dampers: https://www.schaeffler.com/remotemedien/media/_shared_media/08_media_library/01_publications/schaeffler_2/symposia_1/downloads_11/Schaeffler_Kolloquium_2010_01_en.pdf
- LuK 2006 — DMF simulation: https://www.schaeffler.com/remotemedien/media/_shared_media/08_media_library/01_publications/schaeffler_2/symposia_1/downloads_11/04_DMF_simulation_techniques.pdf
- Shift dynamics DCT (MMT): https://www.sciencedirect.com/science/article/abs/pii/S0094114X06000565
- GameDev.net — Driveline simulation: https://www.gamedev.net/forums/topic/632180-car-physics-proper-driveline-simulation/
- Xineering — WOT Shift (ignition cut) modules: https://xineering.com/igncut.html

### AAA references
- PCGamer — Forza Motorsport handling secrets: https://www.pcgamer.com/the-secrets-behind-the-exquisite-handling-of-forza-motorsport/
- Forza.net — Drivatars + tire physics: https://forza.net/news/forza-motorsport-drivatars-tire-physics
- iRacing Car Technology: https://www.iracing.com/car-technology/
- Marco Monster (mirrored): https://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/Car%20Physics%20for%20Games.html
