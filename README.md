# Drift Game

Jogo de drift arcade em 3D feito com **Three.js** + **Vite**. Fisica customizada baseada no modelo analitico de [Marco Monster](http://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/Car%20Physics%20for%20Games.html), adaptado para fisica RWD (tracao traseira) com suspensao independente por roda.

## Demo

Abra `http://localhost:5173` apos iniciar o servidor de desenvolvimento.

## Stack

- **Three.js** — renderizacao 3D
- **Vite** — build tool / dev server
- **Vanilla JS** — sem frameworks de fisica (Cannon/Rapier). Fisica propria implementada do zero

## Controles

| Tecla | Acao |
|-------|------|
| `W` / Seta Cima | Acelerar |
| `S` / Seta Baixo | Freio / Marcha re |
| `A` / Seta Esquerda | Virar esquerda |
| `D` / Seta Direita | Virar direita |
| `Shift` | Freio de mao (handbrake) |
| `Espaco` | Nitro |
| `C` | Trocar camera (chase / hood / orbital) |
| `R` | Resetar posicao |

## Fisica implementada

- **Tração Traseira (RWD)** — aceleracao 100% no eixo traseiro, freio com distribuicao 70/30
- **Suspensao independente por roda** — raycast + mola/amortecedor para cada roda
- **Slip angles** — separacao de forcas laterais e longitudinais nos pneus
- **Weight transfer** — transferencia de carga longitudinal/lateral entre os eixos
- **Oversteer / drift** — corner stiffness assimétrico (dianteiro rigido, traseiro mole) + perda de grip traseiro sob potencia
- **Pitch / Roll dinamicos** — chassis inclina em aceleracao, freio e curvas
- **Particulas de fumaca** — sistema de particulas GPU-friendly (BufferGeometry)
- **Skid marks** — marcas de derrapagem no asfalto

## Rodando localmente

```bash
cd drift-game
npm install
npm run dev
```

## Estrutura

```
drift-game/
├── main.js          # motor do jogo: fisica, input, render, UI
├── index.html       # entry point
├── style.css        # HUD e estilos da UI
└── docs/
    └── MODELO_FISICO_3D_PROPOSTA.md  # especificacao tecnica da fisica
```

## Inspiracoes

- [Marco Monster — Car Physics for Games](http://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/Car%20Physics%20for%20Games.html)
- [spacejack/carphysics2d](https://github.com/spacejack/carphysics2d)
- [Yo-kart-racing-3d](https://github.com/Yo-kart-racing-3d)
- [HexGL](https://github.com/BKcore/HexGL)

## TODO

- [ ] Pistas com curvas definidas (não apenas arena aberta)
- [ ] Contador de tempo / volta
- [ ] Multiplayer local (split-screen)
- [ ] Tuning de carro (suspensao, diferencial, downforce)
- [ ] Sons (motor, pneu, impacto)

---

Arcade drift physics experiment.
