# Drift Game — Guia para Claude

Jogo de drift 3D em **Three.js + Vite** com física de carro implementada do zero (sem Cannon/Rapier). Modelo lateral baseado em Marco Monster (`spacejack/carphysics2d`), evoluído para Pacejka Magic Formula + círculo de fricção, RWD com suspensão independente por roda, e powertrain modular completo.

**Filosofia:** "modo Forza" — fidelidade tipo Forza Motorsport / Assetto Corsa, com assistências configuráveis. Não punitivo por padrão, mas tunável via UI até modo simulador puro.

## Stack

- **Three.js** `^0.184.0` — render 3D
- **Vite** `^8.0.10` — dev server / build (módulos ES nativos)
- **Vanilla JS módulos ES** (`type: "module"`), sem TypeScript, sem framework

## Comandos

```bash
npm run dev      # servidor de dev → http://localhost:5173
npm run build    # build de produção em ./dist
npm run preview  # serve o build
```

## Estrutura

```
drift-game/
├── index.html
├── style.css
├── package.json
├── src/
│   ├── main.js                    # entry: import Game; new Game()
│   ├── powertrain.js              # Engine, Clutch, Gearbox, Differential, TC, Launch, Turbo, PowertrainSystem
│   ├── core/
│   │   ├── Game.js                # loop principal, instancia tudo
│   │   ├── Input.js               # keydown/keyup, .down() / .once()
│   │   └── constants.js           # GAME_CFG, PHYSICS_CFG (magic numbers nomeados)
│   ├── physics/
│   │   ├── CarConfig.js           # massa, geometria, suspensão, gear ratios, mu base
│   │   ├── Car.js                 # orquestra wheels + powertrain + sub-stepping físico
│   │   ├── Wheel.js               # raycast suspensão + slip + chama Tire
│   │   └── Tire.js                # Pacejka Magic Formula + círculo de fricção + heat/grip
│   ├── rendering/
│   │   ├── Camera.js              # CamCtrl: chase / hood / orbital
│   │   ├── Environment.js         # skybox shader + fog + setupLights
│   │   ├── Arena.js               # ground + grid procedural (textura asfalto)
│   │   └── particles/
│   │       ├── SmokeSystem.js     # GPU points (BufferGeometry)
│   │       └── SkidSystem.js      # quads dinâmicos por roda
│   ├── hud/
│   │   └── HUDManager.js          # speed, RPM, gear, telemetria, tire temps colorido, drift score
│   └── tuning/
│       ├── TuningUI.js            # painel ForzaTune (sliders + presets + localStorage)
│       └── presets/
│           ├── drift_beginner.json
│           ├── drift_pro.json
│           ├── track.json
│           └── burnout.json
└── docs/
    ├── POWERTRAIN_DESIGN.md           # spec técnica do powertrain
    ├── MODELO_FISICO_3D_PROPOSTA.md   # base Marco Monster
    ├── PESQUISA_FISICA_REFERENCIAS.md
    ├── PESQUISA_MASSA_VELOCIDADE.md
    ├── PESQUISA_SUSPENSAO_AMORTECEDORES.md
    ├── PLANO_IMPLEMENTACAO_FISICA.md
    ├── CHANGELOG.md
    └── referencias/                   # carphysics2d, Yo-kart, Driftin-Deliveries
```

## Arquitetura do Powertrain (`src/powertrain.js`)

Pipeline modular: `Engine → Clutch → Gearbox → Differential → Wheels`. Tudo orquestrado por `PowertrainSystem.update(dt, inputs, wheelData)`.

| Classe | Responsabilidade | Notas críticas |
|---|---|---|
| `Engine` | Curva de torque interpolada, idle controller, rev limiter (hard/soft/2-step), inércia rotacional, fricção (passive + linear + quadrático), **coast curve** (engine-braking), stall + bump-start | `getCoastTorque(rpm)` retorna torque negativo proporcional ao RPM quando throttle<5%. `updateFree` (livre/slip/neutro) vs `updateLocked` (acoplado) |
| `Clutch` | **Karnopp tanh smooth slip** com `T_friction = T_max · tanh(5·Δω)`. Stick quando `|Δω| < 0.5 rad/s`, slip suave fora. `wear` e `temperature` integrados | Interface: `getTransmittingTorque(engineTorque, deltaOmega)`. `isSlipping` virou derivado de `Δω`, sem chatter |
| `Gearbox` | H-pattern (`shiftTime` 0.3s) ou **sequential** (`shiftTime` 0.06s + ignition cut implícito + rev-match blip de 100ms em downshift). Auto-shift dinâmico baseado em throttle; kickdown no handbrake | `mode: 'h_pattern' \| 'sequential'`, configurável por preset (`drift_pro` é sequential). `gearRatios = [0(N), -2.9(R), 3.6, 2.2, 1.5, 1.1, 0.85, 0.65]` |
| `Differential` | `open` / `welded` (real, vínculo `ωL=ωR` via damping clampado) / `lsd_clutch` (Salisbury com `preload`+`powerLock`+`coastLock`) / `torsen` (TBR) | Welded usa `K=50000` damping clampado a ~2000 Nm. LSD: `T_lock = preload + lock·\|T\|·tan(45°)`, torque vai pra roda mais lenta. Torsen: `T_high = TBR·T_low` |
| `TractionControl` | PID por slip ratio com modos `off`/`low`/`high` | Cuts em `targetSlip` = 0.08 (low) / 0.18 (high) |
| `LaunchControl` | 2-step rev limiter (`launchRPM` ≈ 4500) | Requer `armed = true` (toggla via tecla `L`) ALÉM das condições de clutch+throttle+speed |
| `Turbocharger` | Spool exponencial, blow-off em release. **Formula AC:** `T_final = T_base × (1 + boost)` (1 bar = +100% torque) | Default `maxBoost = 0.8 bar`, `spoolRate = 2.0` |

## Modelo de Pneu (`src/physics/Tire.js`)

Pacejka Magic Formula simplificada com peak (não mais linear-saturado):

```
F_y = D·sin(C·atan(B·α − E·(B·α − atan(B·α))))   // lateral
F_x = D·sin(C·atan(B·κ − E·(B·κ − atan(B·κ))))   // longitudinal
```

Defaults seco/asfalto:
- Lateral: `B=10, C=1.3, D=mu·N, E=0.97` (peak ~6° de slip angle)
- Longitudinal: `B=10, C=1.65, D=mu·N, E=0.97` (peak ~10% de slip ratio)

`combinedSlipForces(slipAngle, slipRatio, mu, N, params)` retorna `{Fx, Fy}` aplicando o **círculo de fricção elíptico**. Param `isRear: true` aplica `driftBias` para o rear sustentar slide sob potência.

**Tire heat / grip degradation:**
- `tireTemp` (°C) por roda. Ambient 25, optimal 60-110, max 200.
- Heat in: `slipPower · 1.5e-4` (slipPower = work de slip lateral + longitudinal).
- Heat out: `(T - 25) · 0.4`.
- `mu_efetivo = mu_base · gripFactor(T)` onde gripFactor = 0.85 (cold), 1.0 (optimal), decai até 0.55 a 200°C.

## Integração no carro (`src/physics/Car.js`)

- `Car.cfg` — instância de `CarConfig` com massa, geometria, suspensão, base mu, gear ratios.
- `Car.powertrain` — instância de `PowertrainSystem`, configurada com defaults "modo Forza" (welded + TC off + turbo 0.8 bar).
- `Car.doPhysics(dt, throttle, brake, steer, ebrake, clutchPedal)` → sub-step **4×** com semi-implicit Euler. Aplica torques retornados em `rl/rr` (RWD).
- **Inércia equivalente refletida** (motor↔roda) é somada à inércia da roda traseira: `I_eq = I_wheel + I_engine·(gear·diff)²/2`. Sem isso, cada marcha sentiria igual.
- `Car.applyPreset(presetData)` muta `cfg` + powertrain runtime — chamado pelo `TuningUI` ao clicar preset.

## Tuning UI (`src/tuning/TuningUI.js`)

Painel overlay aberto por tecla `K`. Sliders para: final drive, gear 1ª–6ª, diff power lock, diff coast lock, diff preload, brake bias, engine inertia, turbo max boost. Dropdowns para tipo de diff e TC mode. Botões: **Save Setup** / **Load Setup** (localStorage `drift-game:tuning:current`), **Reset Default**, e presets rápidos (Beginner, Pro, Track, Burnout).

## Controles

| Tecla | Ação |
|---|---|
| `W` / `↑` | Acelerar |
| `S` / `↓` | Freio / ré |
| `A` / `D` / `←` / `→` | Esterçar |
| `Shift` | Freio de mão (handbrake) |
| `Ctrl` | **Embreagem analógica** (hold-time progression: 1s pisa fundo, 0.33s solta) |
| `Espaço` | Nitro / Start |
| `Q` / `E` | Reduzir / Subir marcha (manual) |
| `T` | Cicla TC (off → low → high) |
| `Y` | Cicla diferencial (open → lsd_clutch → torsen → welded) |
| `U` | Cicla gearbox mode (h_pattern → sequential) |
| `L` | **Arm/Disarm** Launch Control |
| `K` | Abrir/fechar **Tuning UI** |
| `C` | Trocar câmera (chase / hood / orbital) |
| `R` | Reset do carro |

## Convenções e gotchas

- **Unidades SI no código de física:** rad/s para ω, Nm para torque, m/s para velocidade, kg para massa. RPM aparece só em UI/HUD via `omegaToRPM()`.
- **Eixos Three.js:** `+X` = direita, `+Y` = cima, `+Z` = frente do carro (heading=0). Câmera chase em `z = -8.5` (atrás).
- **Visual das rodas:** `mesh.rotation.set(pitch, heading + steerAngle, -roll, 'YXZ')` — só dianteiras têm `steerAngle ≠ 0`.
- **RWD por design:** torque motor vai 100% para `rl/rr`; freio tem distribuição via `brakeBiasFront` (default 0.62).
- **Integrator:** semi-implicit Euler (atualiza `v` antes de `x`) em todas as integrações de `Car.doPhysics`. Não trocar para Euler explícito (instável em spring-damper).
- **Sub-stepping físico 4×** dentro de `doPhysics`. `wheelData` é declarado fora do loop e populado no último sub-step para retorno (CHANGELOG bug #1).
- **Não introduza** Cannon, Rapier ou qualquer engine de física pronto — projeto é "do zero" por escolha de design.
- **Não introduza** lib de UI (React/Vue) — tuning panel é vanilla DOM.
- **Magic numbers críticos** vivem em `src/core/constants.js` (`PHYSICS_CFG`). Nunca espalhe novos magic numbers — adicione lá com nome + comentário.
- **Welded damping** está clampado a ~2000 Nm: K=50000 explodiria a roda em 1 sub-step. Se mudar, validar estabilidade.
- **Gear ratio array:** `[0=N, 1=R, 2..7 = 1ª..6ª]`. Off-by-one comum.

## Débitos técnicos conhecidos

- `CarConfig.cornerStiffnessFront/Rear` ficaram órfãos após Pacejka substituir o modelo linear-saturado em `Wheel.js`. Manter ou remover.
- `gripFactor(T)` em `Tire.js` é piecewise linear com derivada descontínua em 60/110/150°C. Funciona, mas seria mais smooth com cubic ease.
- TuningUI não tem slider para `gearboxMode` nem botão para `launch.armed` — usar tecla U/L.
- Conflitos de pneu em handbrake-drift de baixa velocidade ainda usam ramp `slipRatio*2.0` em `Wheel.js` quando vxAbs<eps. Não é Pacejka puro, é heurística para enable clutch-kick em standing burnout.

## Próximos passos sugeridos

- Sons (motor procedural ou sample-based, turbo whistle, blow-off, tire screech).
- Pistas com curvas definidas (não apenas arena aberta).
- Multiplayer local (split-screen).
- AWD opcional (hoje só RWD; precisaria diff central + diff dianteiro).
- Telemetria gráfica (RPM/boost/throttle plots tipo MoTeC).
