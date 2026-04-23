# PESQUISA: Fisica de Suspensao e Amortecedores — Sistema Independente por Roda

## 1. Objetivo

Eliminar o comportamento "flutuante" do carro no drift-game usando suspensao raycast
independente por roda. Cada roda deve ter sua propria mola+amortecedor, calcular
compressao via raycast, e a carga vertical resultante deve alimentar o modelo de
pneu (slip angle) que ja temos baseado no Marco Monster.

---

## 2. Referencias Encontradas

### 2.1 Artigos Tecnicos (obrigatorios)

| # | Fonte | URL | O que tem |
|---|-------|-----|-----------|
| 1 | Marco Monster — Car Physics for Games | https://rsms.me/etc/car-physics/ | Modelo base de slip angle, weight transfer, drivetrain |
| 2 | Suspension Secrets — Lateral & Longitudinal Load Transfer | https://suspensionsecrets.co.uk/lateral-and-longitudinal-load-transfer/ | Formulas de transferencia de peso com exemplos numericos |
| 3 | Wavey Dynamics — Weight Transfer & Roll Centre | https://www.waveydynamics.com/post/weight-transfer-rc | Geometric vs elastic weight transfer, roll centre, trade-offs |
| 4 | OptimumG — The No Way Transfer Part 1 | https://optimumg.com/wp-content/uploads/2021/10/OptimumG-August-2021.pdf | PDF avancado sobre load transfer com massa suspensa/nao-suspensa |
| 5 | BND TechSource — Vehicle Load Transfer (PDF) | https://bndtechsource.ucoz.com/BND_Docs/Vehicle_Load_Transfer_PartI_III_OCT14.pdf | Formulas completas com roll centers, roll axis, tire stiffness |

### 2.2 Projetos Open Source (para estudar codigo)

| # | Projeto | Engine | O que estudar |
|---|---------|--------|---------------|
| 1 | `spacejack/carphysics2d` | JS puro | Implementacao direta do Marco Monster em JS |
| 2 | `w0rm/elm-physics` (RaycastCar) | Elm | Raycast suspension pura sem engine externa |
| 3 | `react-spring/cannon-es` | Cannon-es | RaycastVehicle oficial do Cannon, ver `examples/raycast_vehicle.html` |
| 4 | `tokyogeometry/nani-raycast-wheel` | Godot 4 | Raycast tire+suspension physics em Godot |
| 5 | `LeehamsonThe3rd/raycastsuspensionwheel` | Roblox | Modulo de suspensao por raycast, codigo simples |

### 2.3 Discussoes de Implementacao

| # | Fonte | URL |
|---|-------|-----|
| 1 | GameDev.net — Suspension/Spring Damping | https://gamedev.net/forums/topic/109429-suspensionspring-damping/ |
| 2 | GameDev.net — Weight Distribution Between Wheels | https://gamedev.net/forums/topic/677238-best-way-to-simulate-weight-distribution-between-car-wheels/ |
| 3 | Three.js Discourse — RaycastVehicle Cannon-es | https://discourse.threejs.org/t/issues-with-raycastvehicle-in-cannon-es-physics-engine/54627 |
| 4 | RV Engine — Three.js Raycast Vehicle | https://discourse.threejs.org/t/rv-engine-upload-drive-your-favorite-car-model-on-the-web-and-generate-physics-code/73549 |

---

## 3. Fisica Teorica — Modelo por Roda (Quarter-Car)

### 3.1 Massa-Spring-Damper Basico

Cada roda e um sistema massa-mola-amortecedor 1D vertical. A forca de suspensao
em cada roda `i` e:

```
F_susp_i = ks * compression_i + kd * compression_speed_i
```

Onde:
- `compression_i = rest_length - hit_distance` (quanto a mola esta comprimida)
- `compression_speed_i = (compression_i - compression_i_prev) / dt`
- `ks` = spring constant (N/m) — tipico: 20.000~80.000 N/m
- `kd` = damping coefficient (N·s/m) — tipico: 1.500~4.000 N·s/m

**REGRA CRITICAL:** A mola so empurra (push only). Se `compression < 0` (roda no ar),
`F_susp = 0`. Nao pode puxar o carro para baixo.

### 3.2 Raycast por Roda

Para cada roda:
1. Lancar raycast do ponto de montagem da suspensao (chassis) para baixo
2. Medir distancia ate o solo `hit_distance`
3. `compression = max(0, rest_length - hit_distance)`
4. Se nao bater em nada, roda no ar → `compression = 0`, `F_susp = 0`

### 3.3 Aplicacao da Forca

A forca calculada e aplicada no **chassis** no ponto de montagem da roda,
direcao para cima (normal do solo ou Y+ do mundo).

```js
// pseudo-codigo
const suspensionForce = new THREE.Vector3(0, 1, 0).multiplyScalar(F_susp_i);
// aplicar no chassis no ponto wheelPosition
chassis.applyForceAtPoint(suspensionForce, wheelPosition);
```

A gravidade continua atuando apenas no **centro de massa** do carro. O rigid-body
solver resolve o resto (transferencia de peso, pitch, roll).

**ISSO E A CHAVE:** Nao precisamos calcular manualmente a carga em cada roda.
A fisica do corpo rigido (nosso integrador custom) resolve isso automaticamente
quando aplicamos as forcas de suspensao nos pontos corretos.

---

## 4. Transferencia de Peso (Weight Transfer)

### 4.1 Longitudinal (Aceleracao / Freio)

```
deltaW_long = (mass * ax * h_cg) / wheelbase

W_front = static_front - deltaW_long
W_rear  = static_rear  + deltaW_long
```

- `ax` = aceleracao longitudinal (m/s^2, positivo = acelerando)
- `h_cg` = altura do centro de gravidade
- `wheelbase` = distancia entre eixos

Exemplo numerico:
- Carro 1000kg, CG a 0.6m, wheelbase 2.7m, acelerando a 1g (9.81 m/s^2)
- `deltaW = (1000 * 9.81 * 0.6) / 2.7 = 222.2 kg` transferido para tras

### 4.2 Lateral (Curva)

```
deltaW_lat_total = (mass * ay * h_cg) / track_width
```

Distribuicao por roda (simplificado, sem roll center):

```
W_front_inner = W_front_static/2 - (deltaW_lat_total * front_distribution)
W_front_outer = W_front_static/2 + (deltaW_lat_total * front_distribution)
W_rear_inner  = W_rear_static/2  - (deltaW_lat_total * rear_distribution)
W_rear_outer  = W_rear_static/2  + (deltaW_lat_total * rear_distribution)
```

Onde `front_distribution` e `rear_distribution` somam 1.0 e dependem da
stiffness relativa de cada eixo (springs + anti-roll bars).

### 4.3 Distribuicao Estatica por Roda

```
static_front = (c / wheelbase) * total_mass  // c = distancia CG ao eixo traseiro
static_rear  = (b / wheelbase) * total_mass  // b = distancia CG ao eixo dianteiro

// por roda (simetria esquerda/direita)
W_fl = W_fr = static_front / 2
W_rl = W_rr = static_rear / 2
```

---

## 5. Roll Centre e Anti-Roll Bars (Nivel Avancado)

### 5.1 Roll Centre
O roll centre (RC) e o ponto em torno do qual o chassis tende a rolar numa curva.

- **Geometric weight transfer:** transferencia que ocorre SEM compressao das molas,
  devido a geometria da suspensao (bracos de suspensao, etc).
- **Elastic weight transfer:** transferencia que ocorre PELA compressao das molas.

### 5.2 Anti-Roll Bar (Sway Bar)
Uma barra que conecta as rodas do mesmo eixo. Quando uma roda sobe e a outro desce,
a barra torce e cria forca adicional.

```
roll_stiffness_spring = wheel_rate * (track_width^2) / 2
roll_stiffness_arb    = arb_stiffness * (track_width^2) / 2
total_roll_stiffness  = roll_stiffness_spring + roll_stiffness_arb
```

**Para V1 do drift-game:** Podemos simplificar e usar apenas `roll_stiffness`
como um parametro unificado por eixo, sem simular a barra explicitamente.

---

## 6. Proposta de Implementacao para Three.js / Vanilla JS

### 6.1 Estrutura de Dados por Roda

```js
const wheel = {
  position: new THREE.Vector3(x, y, z),  // offset local do CG
  rayOrigin: new THREE.Vector3(),         // mundo: posicao do raycast
  rayDirection: new THREE.Vector3(0, -1, 0),
  restLength: 0.3,        // comprimento livre da suspensao (m)
  maxCompression: 0.15,   // ate onde pode comprimir
  springRate: 35000,      // N/m (esportivo)
  damperRate: 2500,       // N·s/m
  compression: 0,         // atual
  prevCompression: 0,     // frame anterior
  force: 0,               // forca vertical calculada
  isGrounded: false,      // raycast bateu?
  slipAngle: 0,           // do modelo de pneu
  slipRatio: 0,
};
```

### 6.2 Loop de Fisica Atualizado (por frame)

```js
function updatePhysics(dt) {
  // 1. Atualiza heading/yawRate (modelo Marco Monster ja existente)
  // ...

  // 2. Para CADA roda:
  for (let w of wheels) {
    // 2.1 Calcula posicao do raycast no mundo
    w.rayOrigin.copy(w.position).applyMatrix4(chassis.matrixWorld);

    // 2.2 Raycast para baixo
    const hit = raycast(w.rayOrigin, w.rayDirection, w.restLength + w.radius);

    if (hit) {
      w.isGrounded = true;
      const hitDistance = hit.distance;
      w.compression = Math.max(0, w.restLength - hitDistance);
    } else {
      w.isGrounded = false;
      w.compression = 0;
    }

    // 2.3 Velocidade de compressao
    const compressionSpeed = (w.compression - w.prevCompression) / dt;
    w.prevCompression = w.compression;

    // 2.4 Forca de suspensao (mola + amortecedor)
    w.force = (w.springRate * w.compression) + (w.damperRate * compressionSpeed);

    // CLAMP: nao pode puxar para baixo
    if (w.force < 0) w.force = 0;

    // 2.5 Aplica forca no chassis no ponto da roda
    if (w.isGrounded && w.force > 0) {
      const forceVector = new THREE.Vector3(0, 1, 0).multiplyScalar(w.force);
      applyForceAtPoint(forceVector, w.rayOrigin);
    }
  }

  // 3. Gravidade atua no CG (ja existe no nosso codigo)
  // 4. Integra velocidade linear
  // 5. Calcula torques de yaw (flatF, flatR do Marco Monster)
  // 6. Integra yawRate
  // 7. Atualiza posicao/rotacao do mesh
}
```

### 6.3 Integracao com o Modelo de Pneu

A carga vertical `W` para o calculo de grip de cada roda e:

```js
W = w.force;  // forca de suspensao daquela roda (ja inclui weight transfer!)
```

Isso substitui o calculo manual de weight transfer que temos hoje.

No modelo de pneu:
```js
// Antes (manual):
const weightF = staticFront; // ou com transfer manual

// Depois (fisico):
const weightFL = wheels[0].force;
const weightFR = wheels[1].force;
const weightRL = wheels[2].force;
const weightRR = wheels[3].force;

// grip por roda = friction_coeff * weight
const gripFL = mu * weightFL;
// etc
```

---

## 7. Parametros Recomendados (inicial)

Baseado em valores reais de simulacao:

| Parametro | Valor | Observacao |
|-----------|-------|------------|
| mass | 1200 kg | massa total do carro |
| sprungMass (aprox) | 1000 kg | massa suspensa (sem rodas, motor, etc) |
| unsprungMass per wheel | ~50 kg | massa nao suspensa por roda |
| springRate | 35.000 N/m | esportivo, firme |
| damperRate | 2.500 N·s/m | damping medio |
| restLength | 0.30 m | altura livre suspensao |
| maxCompression | 0.15 m | bump stop |
| wheelRadius | 0.33 m | raio da roda |
| cgHeight | 0.55 m | altura do CG |
| wheelbase | 2.50 m | distancia eixos |
| trackWidth | 1.60 m | largura entre rodas |

**Presets de referencia (do simulador online sharetechnote):**

| Veiculo | massa suspensa (kg) | ks (kN/m) | cs (N·s/m) | Caracter |
|---------|---------------------|-----------|------------|----------|
| Sedan | 300 | 20 | 1.500 | Conforto/handling balance |
| Esportivo | 250 | 35 | 2.500 | Firme, responsivo |
| Rally | 280 | 40 | 3.500 | Alto damping, terreno irregular |
| F1 | 150 | 80 | 4.000 | Extremamente firme |

*Nota: os valores do simulador sao por quarter-car (1/4 do carro). Multiplicar
massa por 4 para total.*

---

## 8. Visualizacao e Debug

E essencial visualizar o que a suspensao esta fazendo:

1. **Linhas de raycast:** desenhar linhas coloridas de cada roda ate o hit point
2. **Barras de compressao:** desenhar cilindros ou linhas verticais mostrando
   o quanto cada amortecedor esta comprimido
3. **Texto de forca:** mostrar `F_susp` em cada roda (UI ou 3D text)
4. **Grafico em tempo real:** plotar compressao das 4 rodas ao longo do tempo

---

## 9. Checklist de Implementacao

- [ ] Criar classe/array `wheels` com 4 rodas, cada uma com parametros proprios
- [ ] Implementar raycast vertical por roda usando `THREE.Raycaster`
- [ ] Calcular compressao e velocidade de compressao
- [ ] Calcular forca `F = ks*x + kd*v` com clamp `F >= 0`
- [ ] Aplicar forca no chassis no ponto correto (nao no CG!)
- [ ] Remover weight transfer manual e usar `w.force` como carga do pneu
- [ ] Testar em terreno plano — carro deve ficar na altura correta e estabilizar
- [ ] Testar em rampas/inclinacoes — roda mais baixa comprime mais
- [ ] Testar aceleracao — carro deve dar um "squat" para tras
- [ ] Testar curvas — carro deve inclinar (roll) para fora
- [ ] Testar freio — carro deve "dive" para frente
- [ ] Ajustar `ks` e `kd` ate o carro parar de balancar (under-damped vs over-damped)

---

## 10. Proximos Passos

1. Implementar a estrutura de dados `wheels[]` com raycast
2. Integrar forca de suspensao no integrador existente
3. Substituir `weightF`/`weightR` manual pelas forcas das rodas
4. Adicionar debug visual (raycast lines + compression bars)
5. Tunar constantes ate eliminar flutuacao

---

**Documento compilado em:** 2026-04-23
**Baseado em:** Marco Monster, Suspension Secrets, Wavey Dynamics, GameDev.net,
OptimumG, cannon-es, elm-physics, quarter-car model.
