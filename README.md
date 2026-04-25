# Drift Gang

Jogo de drift 3D em **Three.js + Vanilla JS**, com física de carro implementada do zero — sem Cannon, sem Rapier, sem engine pronto. O modelo de pneu usa **Pacejka Magic Formula**, o powertrain é modular (motor, embreagem com Karnopp, gearbox H-pattern + sequential, diferenciais open/welded/LSD-Salisbury/Torsen), e o carro é tunável em tempo real por uma UI estilo **ForzaTune**.

```
http://localhost:5173/
```

![Stack](https://img.shields.io/badge/Three.js-0.184-black) ![Vite](https://img.shields.io/badge/Vite-8.0-646cff) ![Vanilla JS](https://img.shields.io/badge/JS-ES%20Modules-yellow)

---

## Por que existe

Forza Motorsport e Assetto Corsa entregam um "feel" de drift que não vem de truque visual — vem de uma cadeia de subsistemas reais conversando entre si: curva de torque, embreagem com slip, diferencial com lock variável, pneu com peak de fricção, transferência de carga. Este projeto implementa essa cadeia em JavaScript puro, no browser, sem engine de física pronto.

A filosofia é **"modo Forza"**: assistências são configuráveis, defaults são tunáveis e nada é punitivo por padrão — mas a física por baixo é fiel o suficiente para que técnicas reais (clutch-kick, weight transfer, brake bias) funcionem como em sims AAA.

---

## Como rodar

Pré-requisitos: Node 18+ e npm.

```bash
git clone https://github.com/herdeiroeth/drift-gang.git
cd drift-gang
npm install
npm run dev
```

Abra `http://localhost:5173/` e aperte `SPACE` na tela inicial.

Para build de produção:

```bash
npm run build      # gera ./dist
npm run preview    # serve o build localmente
```

---

## Controles

| Tecla | Ação |
|---|---|
| `W` / `↑` | Acelerar |
| `S` / `↓` | Freio / ré |
| `A` `D` / `←` `→` | Esterçar |
| `Shift` | Freio de mão (handbrake) |
| `Ctrl` | **Embreagem analógica** (hold-time: 1s pisa fundo, 0.33s solta) |
| `Espaço` | Nitro / Start |
| `Q` / `E` | Reduzir / Subir marcha (manual) |
| `T` | Cicla TC (off → low → high) |
| `Y` | Cicla diferencial (open → LSD → Torsen → welded) |
| `U` | Cicla gearbox mode (H-pattern → sequential) |
| `L` | **Arm/Disarm** Launch Control (2-step) |
| `K` | Abrir/fechar **Tuning UI** |
| `C` | Câmera (chase / hood / orbital) |
| `R` | Reset do carro |

---

## O que está modelado

### Powertrain modular (`src/powertrain.js`)

```
Engine → Clutch → Gearbox → Differential → Wheels
              ↑           ↑
        Karnopp slip  Sequential mode
```

- **Engine** — curva de torque interpolada, idle controller, rev limiter (hard / soft / 2-step), inércia rotacional, fricção (passive + linear + quadrática), **coast curve** (engine-braking real ao soltar o acelerador), stall + bump-start.
- **Clutch** — modelo **Karnopp** com `T_friction = T_max · tanh(5·Δω)`. Stick suave abaixo de 0.5 rad/s, slip suave acima — sem chatter, sem boolean. Wear e temperatura integrados.
- **Gearbox** — H-pattern (shift time 0.3s) ou **sequential** (0.06s + ignition cut + rev-match blip de 100ms em downshift). Auto-shift dinâmico baseado em throttle. 6 marchas + ré + neutro.
- **Differential** — quatro tipos reais:
  - `open` — split 50/50 fixo (burnout 1-roda quando uma rodadestraciona).
  - `welded` — vínculo `ωL = ωR` real, via damping clampado a ~2000 Nm. Drift rei.
  - `lsd_clutch` — Salisbury com `preload + powerLock·|T|·tan(45°)` (acelerando) ou `coastLock·|T|·tan(60°)` (em coast). Torque vai pra roda mais lenta.
  - `torsen` — TBR (torque bias ratio) tipo `T_high = TBR · T_low`. Lock colapsa quando uma roda perde contato.
- **TractionControl** — PID por slip ratio, modos `off / low / high`.
- **LaunchControl** — 2-step rev limiter com **arm manual** (tecla L). Ativa em clutch>0.7 + throttle>0.8 + speed<1.5 m/s.
- **Turbocharger** — spool exponencial, blow-off em release, formula AC: `T_final = T_base · (1 + boost)` (1 bar = +100% torque).

### Modelo de pneu (`src/physics/Tire.js`)

**Pacejka Magic Formula** simplificada com peak — não mais linear-saturado:

```
F_y = D·sin(C·atan(B·α − E·(B·α − atan(B·α))))
F_x = D·sin(C·atan(B·κ − E·(B·κ − atan(B·κ))))
```

Com **círculo de fricção elíptico** acoplando longitudinal e lateral. Defaults seco/asfalto: lateral peak ~6° de slip angle, longitudinal peak ~10% de slip ratio. O eixo traseiro tem `driftBias` que sustenta o slide sob potência (não trava de volta no aperto da curva).

### Tire heat + grip degradation

Cada roda tem `tireTemp` (°C). Heat in vem de `slipPower = |F_long·vSlipLong| + |F_lat·vSlipLat|`. Heat out é proporcional a `(T - 25°C)`. O `mu` efetivo passado pra Pacejka é multiplicado por `gripFactor(T)`:

| Temperatura | Grip factor |
|---|---|
| < 60°C (cold) | 0.85 |
| 60–110°C (optimal) | 1.00 |
| 110–150°C | 1.00 → 0.85 |
| > 150°C (overheat) | 0.85 → 0.55 a 200°C |

HUD mostra as 4 temperaturas coloridas em tempo real (azul / verde / laranja / vermelho).

### Suspensão e dinâmica do chassis

- 4 raycasts independentes (mola + amortecedor por roda).
- Anti-roll bars front/rear (transfere carga pra roda externa em curvas).
- Weight transfer longitudinal e lateral via aceleração local.
- Pitch e roll dinâmicos do chassis (visual + funcional).
- Inércia equivalente refletida do motor: `I_eq = I_wheel + (I_engine·(gear·diff)²)/2`. É por isso que cada marcha sente diferente.

### Integrador

Semi-implicit Euler em todas as integrações de `Car.doPhysics()`, com **sub-stepping 4×** por frame para estabilidade. Atualiza velocidade antes de posição, conserva energia em média.

### Tuning UI estilo ForzaTune (`src/tuning/`)

Tecla `K` abre painel overlay com:

- **Sliders:** final drive, gear 1ª–6ª, diff power lock, diff coast lock, diff preload (Nm), brake bias, engine inertia, turbo max boost.
- **Dropdowns:** tipo de diferencial, modo TC.
- **Save / Load** via `localStorage` (chave `drift-game:tuning:current`).
- **Presets de 1 clique:**
  - `drift_beginner` — LSD 0.45/0.25, TC low, brake bias 55%, gear curtos.
  - `drift_pro` — Welded, TC off, sequential gearbox, preload 150 Nm.
  - `track` — LSD 0.30/0.40 (mais coast pra estabilizar), gear longo, brake bias 62%.
  - `burnout` — Welded, gear 1ª 4.5, final drive 5.5, turbo 2.0 bar, inércia leve.

Todas as mutações são in-place — a próxima chamada `update()` do powertrain já lê os novos valores.

---

## Estrutura

```
drift-gang/
├── index.html
├── style.css
├── package.json
├── src/
│   ├── main.js                    # entry: import Game; new Game()
│   ├── powertrain.js              # Engine, Clutch, Gearbox, Differential, TC, Launch, Turbo
│   ├── core/
│   │   ├── Game.js                # loop principal
│   │   ├── Input.js               # keydown/keyup tracking
│   │   └── constants.js           # GAME_CFG, PHYSICS_CFG (magic numbers nomeados)
│   ├── physics/
│   │   ├── Car.js                 # orquestra wheels + powertrain + sub-stepping
│   │   ├── CarConfig.js           # massa, geometria, suspensão, gear ratios
│   │   ├── Wheel.js               # raycast suspensão + chama Tire
│   │   └── Tire.js                # Pacejka + círculo de fricção + heat/grip
│   ├── rendering/
│   │   ├── Camera.js              # chase / hood / orbital
│   │   ├── Environment.js         # skybox shader + fog + lights
│   │   ├── Arena.js               # ground procedural (textura asfalto)
│   │   └── particles/
│   │       ├── SmokeSystem.js     # GPU points
│   │       └── SkidSystem.js      # quads dinâmicos
│   ├── hud/
│   │   └── HUDManager.js          # speed, RPM, gear, telemetria, tire temps, drift score
│   └── tuning/
│       ├── TuningUI.js            # painel ForzaTune
│       └── presets/
│           ├── drift_beginner.json
│           ├── drift_pro.json
│           ├── track.json
│           └── burnout.json
└── docs/                          # specs e pesquisas
    ├── POWERTRAIN_DESIGN.md
    ├── MODELO_FISICO_3D_PROPOSTA.md
    ├── PESQUISA_*.md
    └── CHANGELOG.md
```

---

## Inspirações e referências técnicas

- [Marco Monster — *Car Physics for Games*](http://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/Car%20Physics%20for%20Games.html) — modelo lateral base.
- [spacejack/carphysics2d](https://github.com/spacejack/carphysics2d) — port JS do Marco Monster.
- [Vehicle Physics Pro (Edy)](https://vehiclephysics.com/) — arquitetura modular do powertrain (Engine / Clutch / Gearbox / Differential blocks).
- [BeamNG.drive Powertrain Wiki](https://wiki.beamng.com/Powertrain.html) — tree de devices, torque-down + speed-up feedback.
- [Assetto Corsa modding](https://www.overtake.gg/threads/engine-ini-explained.181061/) — formato `engine.ini` / `drivetrain.ini` (POWER + COAST + PRELOAD virou a interface do nosso `Differential`).
- [Pacejka Magic Formula](http://www.racer.nl/reference/pacejka.htm) — modelo de pneu.
- [Glenn Fiedler — *Integration Basics*](https://gafferongames.com/post/integration_basics/) — semi-implicit Euler.
- [Erin Catto — *Numerical Methods* (GDC 2015)](https://box2d.org/files/ErinCatto_NumericalMethods_GDC2015.pdf).
- [Karnopp friction model](https://academiaromana.ro/sectii2002/proceedings/doc2011-2/05-Bataus.pdf) — clutch slip suave via tanh.

---

## Roadmap

Próximos passos não-bloqueantes (em ordem de ROI percebido):

- [ ] **Sons** — motor procedural (síntese baseada em RPM × throttle × load), turbo whistle, blow-off, tire screech.
- [ ] **Pistas com geometria definida** (curvas designed, não só arena aberta).
- [ ] **Sistema de cronometragem / volta**.
- [ ] **Telemetria gráfica** (RPM/boost/throttle plots tipo MoTeC, debug overlay).
- [ ] **AWD opcional** (diff central + diff dianteiro — hoje só RWD).
- [ ] **Multiplayer local** (split-screen).
- [ ] **Tuning UI: editor de curva de torque** (drag points como AC).

---

## Filosofia de código

- **Sem TypeScript, sem framework.** Vanilla ES modules.
- **Sem física pronta** — Cannon e Rapier estão fora. Tudo é integrado à mão.
- **Magic numbers nomeados** em `src/core/constants.js`. Espalhar `0.992` solto pelo código é rejeitado.
- **Unidades SI no código de física** (rad/s, Nm, m/s, kg). RPM aparece só na UI via `omegaToRPM()`.
- **Semi-implicit Euler** em todas as integrações (atualiza `v` antes de `x`).
- **Modular sobre monolito.** Cada subsistema é um arquivo independente que pode ser substituído sem refatorar o resto.

---

Built with custom physics, no shortcuts.
