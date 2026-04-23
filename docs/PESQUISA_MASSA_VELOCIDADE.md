# Pesquisa: Influencia da Massa/Peso na Aceleracao, Frenagem e Velocidade

> Objetivo: entender como a massa do veiculo afeta a dinamica longitudinal (acelerar/frear/velocidade maxima) em jogos de corrida, para aplicar no drift-game.

---

## 1. Fundamento Basico: F = ma

A segunda lei de Newton governa tudo:

```
F = m * a
a = F / m
```

**O que isso significa na pratica:**
- Se o motor aplica uma forca de tração de 8000N em um carro de 1200kg → `a = 6.67 m/s²`
- Se o mesmo motor aplica 8000N em um carro de 2000kg → `a = 4.0 m/s²`
- **A aceleracao é INVERSAMENTE proporcional à massa.**

**Problema no drift-game hoje:**
A forca do motor (`engineForce = 8000N`) é aplicada diretamente como força de tração, sem considerar que essa força vem do torque do motor multiplicado pela transmissao. Isso funciona para um carro fixo, mas se quisermos que a massa influencie, precisamos ou:
(a) manter a força fixa e dividir pela massa (ja fazemos em parte), ou
(b) modelar o drivetrain (torque do motor → força na roda).

**Ponto critico:** Hoje o `engineForce` é um numero magico. Em um modelo real, o motor gera torque, o torque é multiplicado pelas marchas e pelo diferencial, e resulta em força no pneu. Se trocarmos a massa do carro mas mantivermos o mesmo motor, a aceleração muda naturalmente via `F/m`.

---

## 2. Do Motor à Tração: Como a Força Real é Calculada

### 2.1. Torque do Motor → Força na Roda

```
Torque na roda = Torque do motor * ratio da marcha * ratio do diferencial * eficiencia
Força de tração = Torque na roda / raio da roda

Fw = (Te * ix * i0 * n) / Rw
```

**Exemplo prático (Corvette C5):**
- Torque do motor: 448 Nm @ 2500 rpm
- 1ª marcha: 2.66
- Diferencial: 3.42
- Eficiência: 0.7 (30% de perda)
- Raio da roda: 0.34 m

```
Fw = (448 * 2.66 * 3.42 * 0.7) / 0.34 = 8391 N
```

**Observacao:** Com 8391N de força e massa de 1520kg, a aceleração seria `5.52 m/s²`.

### 2.2. Curva de Torque vs RPM

Motores reais não entregam torque constante. Ele varia com as rotações:

```
torque_maximo = lookupCurve(rpm_atual)
torque_aplicado = throttle * torque_maximo
```

**Por que isso importa para massa:**
- Um carro mais pesado demora mais para acelerar, então o motor fica mais tempo em cada RPM
- Isso afeta o "feel" do carro além do simples `F/m`
- Para arcade, podemos simplificar, mas a curva de torque é o que dá "personalidade" ao motor

### 2.3. Marchas e Troca de Marcha

Cada marcha multiplica o torque de forma diferente:

| Marcha | Ratio | Força na roda (Corvette) |
|--------|-------|--------------------------|
| 1ª | 2.66 | ~8391 N |
| 2ª | 1.78 | ~5613 N |
| 3ª | 1.30 | ~4100 N |
| 4ª | 1.00 | ~3154 N |
| 5ª | 0.74 | ~2334 N |
| 6ª | 0.50 | ~1577 N |

**Trade-off:** Marchas baixas = mais força, menos velocidade. Marchas altas = menos força, mais velocidade.

**Para o drift-game:** Podemos implementar um sistema de marchas simplificado ou manter automatico, mas o ratio da marcha afeta diretamente a força de tração e portanto a aceleração para uma dada massa.

---

## 3. Resistências ao Movimento

O carro não acelera para sempre. Existem forças contrárias:

### 3.1. Resistência ao Rolamento (Rolling Resistance)

```
Frr = -Crr * v
```

- Proporcional à velocidade (não ao quadrado)
- Dominante em baixas velocidades
- **Depende da massa:** `Crr` é uma constante, mas a força de atrito de rolamento real é proporcional ao peso do veículo (`μ * N`)

**Implementação mais realista:**
```
Frr = -Crr * mass * gravity * sign(v)
```

**Efeito da massa:** Carro mais pesado = mais rolling resistance.

### 3.2. Resistência Aerodinâmica (Drag)

```
Fdrag = -0.5 * rho * Cd * A * v * |v|
```

- Proporcional ao QUADRADO da velocidade
- Dominante em altas velocidades
- **NÃO depende da massa** (depende apenas da forma/frontal area)

**Constante simplificada:**
```
Fdrag = -Cdrag * v * |v|
```

Onde `Cdrag = 0.5 * rho * Cd * A` (~0.4257 para um Corvette).

### 3.3. Força Total Longitudinal

```
Flong = Ftraction + Fdrag + Frr
a = Flong / mass
```

**Velocidade máxima (top speed):** Ocorre quando `Ftraction = |Fdrag + Frr|`

**Efeito da massa no top speed:**
- Em teoria, massa não afeta o top speed se a única resistência for aerodinâmica (drag)
- Na prática, massa aumenta o rolling resistance, então carros mais pesados têm top speed ligeiramente menor
- O efeito dominante da massa está na **aceleração**, não no top speed

---

## 4. Frenagem e Massa

### 4.1. Física da Frenagem

```
Fbrake = μ * N
```

Onde:
- `μ` = coeficiente de atrito do pneu com o solo (~1.0 para pneus de rua, até 1.5 para slick)
- `N` = carga normal no pneu (peso sobre a roda)

**Aceleração de frenagem:**
```
abrake = Fbrake / mass = (μ * N) / mass
```

**Para um carro com distribuição 50/50 parado:**
- Cada eixo tem `N = mass * gravity / 2`
- Força total de freio = `μ * mass * gravity`
- `abrake = μ * gravity` (~9.81 m/s² para μ=1.0)

**Ponto crucial:** A desaceleração máxima teórica é `μ * g`, independente da massa! Um caminhão e um kart com o mesmo μ param na mesma distância (em teoria).

**Mas na prática:**
- Carros mais pesados geram mais calor nos freios (fade)
- Sistemas de freio têm limites de força
- Pneus têm load sensitivity (grip não escala linearmente com carga)

### 4.2. Weight Transfer durante Frenagem

Quando freia, o peso transfere para a frente:

```
ΔWeight_front = (h / L) * mass * a_brake
```

Onde:
- `h` = altura do CG
- `L` = wheelbase
- `a_brake` = desaceleração (positiva em módulo)

**Resultado:**
- Rodas dianteiras ganham carga → mais grip → freiam mais
- Rodas traseiras perdem carga → menos grip → podem travar
- Por isso freios dianteiros são maiores em carros de rua

**Para drift-game:**
- Hoje temos `brakeForce = 12000N` como constante
- Deveria ser: `brakeForce = μ * carga_no_pneu * nrodas`
- Ou simplificado: `brakeForce_max = μ * mass * gravity * weight_ratio`

### 4.3. Como a Massa Deveria Afetar a Frenagem no Jogo

**Modelo arcade simplificado:**
```
brakeForceFront = brakeInput * μ * frontAxleLoad
brakeForceRear  = brakeInput * μ * rearAxleLoad
```

**Com weight transfer dinâmico:**
```
frontLoad = staticFrontLoad + (h/L) * mass * longitudinalAccel
rearLoad  = staticRearLoad  - (h/L) * mass * longitudinalAccel
```

**Consequência:** Carro mais pesado tem mais carga para transferir, o que pode melhorar o freio da frente mas piorar o da trás (mais fácil travar a traseira).

---

## 5. Weight Transfer Longitudinal (Aceleração/Frenagem)

### 5.1. Fórmulas

**Durante aceleração (squat):**
```
frontLoad = staticFront - (h / L) * mass * a
rearLoad  = staticRear  + (h / L) * mass * a
```

**Durante frenagem (dive):**
```
frontLoad = staticFront + (h / L) * mass * |a|
rearLoad  = staticRear  - (h / L) * mass * |a|
```

**Exemplo numérico:**
- Massa: 1200kg, CG: 0.55m, Wheelbase: 2.5m
- Aceleração: 6 m/s²

```
ΔLoad = (0.55 / 2.5) * 1200 * 6 = 1584 N (~161 kg)
frontLoad perde ~161 kg
rearLoad  ganha ~161 kg
```

### 5.2. Efeito no Grip

O grip do pneu é proporcional à carga, mas não linearmente (load sensitivity):

```
grip_efetivo = carga * μ * (1 - load_sensitivity * (carga / carga_max))
```

**Ou simplificado (linear):**
```
Ffriction_max = μ * carga_no_pneu
```

**O que isso significa:**
- Aceleração aumenta carga traseira → mais grip traseiro → melhor tração (bom para RWD)
- Mas diminui carga dianteira → menos grip dianteiro → substerço na saída de curva
- Frenagem aumenta carga dianteira → melhor frenagem na frente
- Mas diminui carga traseira → traseira solta mais fácil (oversteer em trail braking)

---

## 6. Yaw Inertia (Momento Polar de Inércia)

### 6.1. O que é

É a resistência do carro a girar (yaw). Depende da distribuição da massa:

```
Iz = mass * (distribuicao da massa)^2
```

**Fórmula aproximada:**
```
Iz = inertiaScale * mass
```

No drift-game hoje: `inertia = mass * inertiaScale` (onde `inertiaScale = 1.5`)

### 6.2. Efeito no Handling

- **Carro com massa concentrada no centro** (motor central): baixo Iz → gira rápido, responsivo
- **Carro com massa nas pontas** (motor dianteiro, traseira longa): alto Iz → gira devagar, mais estável

**Para drift:**
- Baixo Iz = carro "joga" rápido, fácil de iniciar drift
- Alto Iz = carro demora a responder, mais previsível

**A massa afeta diretamente o Iz.** Se dobrarmos a massa sem mudar a distribuição, o Iz dobra, e o carro demora o dobro do tempo para iniciar uma rotação.

---

## 7. Como Jogos Implementam Isso

### 7.1. Marco Monster (Modelo Analítico)

- Usa forças separadas: longitudinal e lateral
- Top speed é emergente (quando tração = resistências)
- Simplifica drivetrain como "engineForce" constante
- Implementa weight transfer para mudar cargas nos eixos
- Massa afeta aceleração via `F/m`

**Limitação:** O modelo original não simula curva de torque nem marchas. É uma simplificação razoável para arcade.

### 7.2. Assetto Corsa / rFactor (Simulação)

- Curva de torque completa do motor
- Sistema de marchas com ratios reais
- Pacejka tire model (força do pneu depende de carga, slip angle, temperatura)
- Suspensão completa com kinemática
- Massa afeta tudo: aceleração, frenagem, yaw inertia, load transfer

### 7.3. Forza / Gran Turismo (Simcade)

- Curva de torque simplificada
- Marchas automáticas ou sequenciais
- Weight transfer dinâmico
- Massa do carro é um atributo que afeta PI (Performance Index)
- Upgrades de peso (redução) melhoram aceleração e handling

### 7.4. Need for Speed / Burnout (Arcade)

- Aceleração muitas vezes constante (independente de massa)
- Massa afeta principalmente colisões
- Top speed frequentemente hard-coded
- Foco em "feel"而不是 física exata

---

## 8. O que Falta no drift-game Atual

### 8.1. Problemas Identificados

| Aspecto | Estado Atual | O Ideal |
|---------|-------------|---------|
| Aceleração | `engineForce = 8000N` fixo, dividido por massa | Força de tração deve vir de torque do motor × transmissão / raio da roda |
| Frenagem | `brakeForce = 12000N` fixo | Deveria ser `μ * carga_no_pneu` por eixo, com weight transfer dinâmico |
| Rolling Resistance | `Crr * v` (não depende de massa) | Deveria ser `Crr * mass * gravity * sign(v)` |
| Weight Transfer Longitudinal | Implementado parcialmente via pitch visual | Deveria afetar as cargas dos pneus em cada frame |
| Yaw Inertia | `mass * 1.5` | OK para arcade, mas poderia considerar distribuição de massa |
| Marchas | Não existe | Poderia adicionar para mais realismo |

### 8.2. Como a Massa Deveria Influenciar

**Aceleração:**
```
// Atual
accel = engineForce / mass

// Ideal
wheelForce = (engineTorque * gearRatio * diffRatio * efficiency) / wheelRadius
accel = (wheelForce - drag - rollingResistance) / mass
```

**Frenagem:**
```
// Atual
brakeForce = 12000 * brakeInput

// Ideal
frontBrake = brakeInput * mu * frontTireLoad
rearBrake  = brakeInput * mu * rearTireLoad
totalBrake = frontBrake + rearBrake
```

**Rolling Resistance:**
```
// Atual
Frr = -Crr * v

// Ideal
Frr = -Crr * mass * gravity * sign(v)
```

**Top Speed:**
- Hoje é emergente (quando força do motor = resistências)
- Massa tem efeito pequeno via rolling resistance
- Efeito principal da massa é no tempo para atingir top speed, não no top speed em si

---

## 9. Recomendações para Implementação

### Nível 1: Arcade (Mínimo Viable)

1. **Fazer rolling resistance depender da massa:**
   ```
   Frr = -rollResist * mass * gravity * sign(vx)
   ```

2. **Fazer brake force depender da carga do eixo:**
   ```
   frontLoad = staticFrontLoad + weightTransfer
   rearLoad  = staticRearLoad  - weightTransfer
   brakeForce = brakeInput * mu * (frontLoad + rearLoad)
   ```

3. **Ajustar engineForce para ser proporcional à massa (ou implementar torque do motor):**
   ```
   // Opcao A: engineForce escalonado por massa
   engineForce = baseEngineForce * (mass / referenceMass)
   
   // Opcao B: torque do motor
   engineTorque = throttle * maxTorque
   wheelForce = engineTorque * gearRatio * diffRatio * efficiency / wheelRadius
   ```

### Nível 2: Simcade

4. **Implementar weight transfer longitudinal dinâmico afetando cargas dos pneus:**
   ```
   weightTransfer = (cgHeight / wheelbase) * mass * longitudinalAccel
   frontLoad = staticFront - weightTransfer  // acelerando
   rearLoad  = staticRear  + weightTransfer
   ```

5. **Adicionar curva de torque simples:**
   ```
   torque = lerp(lowRPMetorque, highRPMetorque, rpm / maxRPM)
   ```

6. **Sistema de marchas simplificado (2-3 marchas):**
   - 1ª: drift/baixa velocidade
   - 2ª: média
   - 3ª: alta/automática

### Nível 3: Simulação

7. **Pacejka tire model simplificado**
8. **Suspensão com kinemática**
9. **Temperatura e desgaste de pneus**

---

## 10. Formulas de Referência Rápida

```
// Aceleração
a = F_total / mass
F_total = F_traction - F_drag - F_rr - F_brake

// Tração (RWD)
F_traction = (T_engine * i_gear * i_diff * efficiency) / R_wheel

// Resistências
F_drag = 0.5 * rho * Cd * A * v^2
F_rr   = Crr * mass * g * sign(v)

// Weight transfer longitudinal
ΔW = (h / L) * mass * a_longitudinal

// Carga nos eixos
W_front = W_static_front - ΔW  // acelerando
W_rear  = W_static_rear  + ΔW

// Frenagem máxima por eixo
F_brake_max_front = μ * W_front
F_brake_max_rear  = μ * W_rear

// Yaw inertia
Iz = mass * k^2   // k = raio de giração

// Top speed (v quando F_traction = F_drag + F_rr)
v_max ≈ sqrt((F_traction - F_rr) / (0.5 * rho * Cd * A))
```

---

## 11. Fontes

1. Marco Monster - Car Physics for Games (http://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/)
2. x-engineer.org - Calculate Wheel Torque from Engine Torque
3. Wikipedia - Weight Transfer
4. Suspension Secrets - Lateral and Longitudinal Load Transfer
5. Physics StackExchange - Effect of weight on top speed
6. Brian Beckman - The Physics of Racing
7. spacejack/carphysics2d (GitHub)

---

## 12. Próximos Passos

Baseado nesta pesquisa, o plano de implementação deve decidir:

1. **Qual nível de complexidade?** (Arcade / Simcade / Simulação)
2. **Implementar rolling resistance com massa primeiro** (baixo custo, alto impacto)
3. **Refatorar brake force para usar carga dos pneus** (critical para RWD)
4. **Decidir sobre sistema de marchas** (muda a arquitetura do input)
5. **Ajustar parâmetros de massa/inércia para diferentes carros** (se houver múltiplos)
