# Pesquisa: Shift Logic Realista — Eliminação de Hunting + Shift Maps

**Status:** Proposta — aguardando OK antes de implementar.
**Contexto:** o auto-shift atual oscila entre 2ª e 3ª (hunting) e nunca sobe além de 3ª. Antes de re-implementar, este doc consolida (a) diagnóstico do bug, (b) como AAA / TCU reais resolvem, (c) tabela de shift map proposta para o motor do projeto, (d) plano de execução.

---

## 1. Diagnóstico do hunting atual

### 1.1 Configuração corrente (`src/powertrain.js` — `Gearbox`)

```
upshiftBaseRPM   = 4000   # @ throttle 0%
upshiftRedline   = 6800   # @ throttle 100%
downshiftBaseRPM = 1800   # @ throttle 0%
downshiftPower   = 4200   # @ throttle 100%
shiftCooldownH   = 0.55 s
shiftCooldownSeq = 0.18 s
minPostUpshiftRPM = 2400  # rpm previsto na próxima marcha
```

A curva é `up = upBase + load·(upRedline − upBase)` e idem pro down. A distância entre upshift e downshift cai junto com `load`:

| throttle | upshift RPM | downshift RPM | gap (hyst.) |
|---:|---:|---:|---:|
| 0%  | 4000 | 1800 | **2200** |
| 50% | 5400 | 3000 | **2400** |
| 100%| 6800 | 4200 | **2600** |

Aparentemente o gap é grande. **Mas o gap é entre os dois RPMs aplicados ao mesmo sigRPM** — não considera que **upshift troca a marcha e o RPM cai**. A pergunta correta é: *após um upshift N→N+1, o novo RPM imediatamente pós-shift fica abaixo do downshift threshold?* Se sim → loop.

### 1.2 Modelagem do par 2ª↔3ª (gear ratios `2.2` e `1.5`, finalDrive `3.8`)

Razão de queda de RPM ao subir 2→3: `1.5 / 2.2 ≈ 0.682`. Ou seja, ao trocar, o RPM cai **31.8%**.

- Upshift 2→3 dispara em sigRPM = `upshiftRPM` (depende do throttle).
- RPM logo após = `upshiftRPM × 0.682`.
- Para *não* disparar downshift de volta, precisamos: `upshiftRPM × 0.682 > downshiftRPM`.

Resolvendo para cada throttle:

| throttle | upshift | upshift × 0.682 (pós) | downshift | hunting risk? |
|---:|---:|---:|---:|:---:|
| 0%   | 4000 | 2728 | 1800 | OK  |
| 30%  | 4840 | 3301 | 2520 | OK  |
| 50%  | 5400 | 3683 | 3000 | OK (margem 683) |
| 70%  | 5960 | 4065 | 3480 | OK (margem 585) |
| 90%  | 6520 | 4447 | 3960 | margem ~487 |
| 100% | 6800 | 4636 | 4200 | **margem 436** |

A 100% throttle a margem é só 436 RPM. **Não é loop matemático ainda — então o hunting deve vir de algum outro lugar**.

### 1.3 Por que oscila na prática (hipóteses ranqueadas)

**H1 — Engine RPM "decola" durante o shift e pós-shift cai abaixo do downshift por inércia.**
Durante `isShifting`, `gearRatio=0` e o motor é `updateFree`: sem load, throttle máximo, motor sobe ao rev limit (7200) em milissegundos. Pós-shift, o motor *acima* do drivetrain transfere torque positivo até convergir — leva ~100-300 ms. Durante esse transiente, `clutch.isSlipping=true`, então `sigRPM = drivetrainRPM`. Mas se em algum sub-step `clutchSlipping` ler `false` (por exemplo, no PowertrainSystem o stick mode resetta `isSlipping=false` na linha `986`), o `sigRPM` vira o `engineRPM`, que pode estar oscilando — e a próxima leitura pode bater abaixo do downshift se a oscilação for pra baixo.

**H2 — `minPostUpshiftRPM = 2400` não é o vilão direto, mas é insuficiente como única defesa.** Não há regra equivalente para downshift que olhe a marcha *anterior* — se downshift faria voltar ao loop, devia recusar.

**H3 — Auto-shift roda 4× por frame (sub-stepping).** Cada sub-step tem `dt = 1/60/4 ≈ 4ms`. Cooldown de 0.55s decai por sub-step. Em si não é problema, mas **o shift é resolvido no mesmo sub-step em que o threshold é cruzado**, e não há "time-in-band" debounce real (i.e. o threshold tem que estar excedido por X ms antes de aceitar).

**H4 — RPMs base pequenos demais entre marcha alta** — em modo sequential o shiftTime=0.06s e cooldown=0.18s; a janela de ré-engate é estreita, e qualquer transiente de RPM pode bater limites errados.

### 1.4 Conclusão do diagnóstico

O modelo atual é **hysteresis paramétrica linear sem time-debounce e sem proteção bidirectional cross-gear**. AAA e TCUs reais usam:

- **Mapa explícito por marcha** (não fórmula linear global).
- **Debounce temporal** (precisa permanecer no condition window por N ms).
- **Cross-gear protection** (downshift de N+1→N só permitido se RPM previsto > upshift threshold pra ainda estar abaixo de redline; ou seja: se acabou de subir, *não* desce).
- **Anti-hunting flag** (após shift, lock direção: se o último foi upshift, downshift fica inibido por X ms a menos que RPM caia bem abaixo do downshift).

---

## 2. Estado da arte — como AAA e TCUs reais resolvem

### 2.1 Forza (Motorsport / Horizon)

Engenharia reversa do auto-shifter (projeto público `theRTB/ForzaShiftTone` no GitHub) mostra que o ótimo de upshift seria o **crossover de curvas de potência**: o RPM em que a potência da próxima marcha pós-shift supera a potência da atual. Na prática **o auto-shift do Forza não usa o crossover ótimo** — sobe perto do redline (`redline × 0.99`). Por isso jogadores reclamam de upshifts "tarde demais". Mas mesmo essa estratégia simples não causa hunting porque:

1. O *gear ratio drop* é pequeno (carros AAA têm transmissão fechada, `ratio_N+1 / ratio_N ≈ 0.78–0.85`), então pós-shift o RPM ainda cai numa faixa alta.
2. O cooldown é grande e há time-debounce.

> Fonte: https://github.com/theRTB/ForzaShiftTone — https://forums.forza.net/t/make-automatic-shifting-controls-change-gears-at-max-rpm-instead-of-redline/545030

### 2.2 Assetto Corsa

O AC tem **dois valores globais** no `drivetrain.ini` por carro (seção `[AUTO_SHIFTER]`):

```
UP=7200
DOWN=4000
```

Não é por marcha. O gap UP-DOWN (3200 RPM) é gigantesco para que o sistema simplista nunca caia em hunting — sacrificando otimização. Mods comunitários (ex.: `AnnoyingTechnology/assetto-corsa-real-automatic-gearbox`) substituem esse modelo por mapas de carga e regras como "não desce pra 1ª acima de 10 km/h".

> Fonte: https://www.overtake.gg/threads/automatic-gearshifting.191972/ — https://github.com/AnnoyingTechnology/assetto-corsa-real-automatic-gearbox

### 2.3 TCUs reais (ZF 8HP, GM 4L60E, Aisin AW)

São mapas 2D `RPM × TPS` por marcha, com hysteresis explícita. Patente Chrysler **US5669850A** (Shift Hunting Prevention) descreve a primitiva clássica:

1. Calcular **torque reserve** na marcha atual e na próxima.
2. Antes de aceitar upshift, validar que o veículo continuará acelerando na próxima marcha sob a carga atual. Se não, **inibir o upshift**.
3. Em terreno inclinado / detecção de "carga dinâmica" volátil, `grade_hunting_flag` força permanecer na marcha atual por debounce extra.

Patente Cummins **US6098004A** generaliza pra debounce por velocidade angular do shaft de saída.

A regra prática (MegaShift / EFILive / Tuning-X): em throttle baixo, upshift entre 2.000–3.000 RPM; em WOT, perto do redline. **Nunca deixe upshift e downshift se cruzarem no mesmo TPS**. Hysteresis mínima recomendada: **400–600 RPM** entre o par.

> Fonte: https://patents.google.com/patent/US5669850A — http://www.msgpio.com/manuals/mshift/tuning.html — https://tuning-x.com/transmission-tuning — https://www.8speed.au/blogs/news/turbolamik-automatic-shift-points

### 2.4 Carros tunados (turbo 4cyl)

Para um motor turbo com peak power a 5500 RPM (caso do projeto: redline 7200, peak power ~5500), a regra de carros de drift / tunados (DSPort, SpoolStreet) é:

- **Shift point WOT = peak power + 200 a 500 RPM** (5800–6000), para que ao cair na próxima marcha você aterrisse no peak torque (~3500–4000).
- Usuário sugeriu "3-4k como limite": **isso é cedo demais para WOT** — sai da zona de boost a cada troca. Faz sentido só pra cruise / eco.

> Fonte: https://dsportmag.com/the-tech/learning-curves-recognizing-a-race-friendly-dyno-graph/2/ — https://www.spoolstreet.com/threads/stock-turbo-best-shift-points-n55-auto-1-4mile.1545/

---

## 3. Shift map proposto para o motor do projeto

**Motor (de `CarConfig`):** redline 7200, peak torque @ 3500 (480 Nm), peak power @ ~5500. Gear ratios `[N=0, R=-2.9, 1ª=3.6, 2ª=2.2, 3ª=1.5, 4ª=1.1, 5ª=0.85, 6ª=0.65]`.

A queda de RPM ao subir cada marcha:

| Shift | ratio drop | % drop |
|---|---:|---:|
| 1→2 | 2.2/3.6 = 0.611 | -39% |
| 2→3 | 1.5/2.2 = 0.682 | -32% |
| 3→4 | 1.1/1.5 = 0.733 | -27% |
| 4→5 | 0.85/1.1 = 0.773 | -23% |
| 5→6 | 0.65/0.85 = 0.765 | -23% |

A 1ª→2ª é a queda mais agressiva (40%) — janela de hunting mais difícil aqui. As marchas altas têm step menor → upshift pode ser mais cedo sem bog.

### 3.1 Tabela proposta — `upshiftRPM` e `downshiftRPM` por par

Valores em **WOT (throttle 100%)**. Em throttle parcial, escala linear entre `cruise` e `WOT`.

| Shift par | upshift WOT | upshift cruise | downshift WOT | downshift cruise | gap min (WOT) | RPM pós-up (WOT) | margem hunting |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1↔2 | 6500 | 3000 | 3500 | 1700 | 3000 | 3972 | **+472** |
| 2↔3 | 6300 | 2800 | 3700 | 1700 | 2600 | 4297 | **+597** |
| 3↔4 | 6200 | 2600 | 3900 | 1700 | 2300 | 4544 | **+644** |
| 4↔5 | 6000 | 2400 | 4000 | 1700 | 2000 | 4640 | **+640** |
| 5↔6 | 5800 | 2200 | 4000 | 1700 | 1800 | 4441 | **+441** |

**Garante**: pós-shift WOT, o RPM em que cai sempre fica ≥ 400 RPM acima do downshift do mesmo par. Margem cruise é trivial.

### 3.2 Defesas extras

- **Debounce temporal**: o threshold tem que estar excedido por **180 ms** antes de aceitar. Filtra picos de RPM em transientes (ex: pós-shift slipping).
- **Anti-hunting lockout**: após qualquer shift, downshift fica **bloqueado por 700 ms** a menos que RPM caia abaixo de `downshift × 0.85` (situação de freada forte / kickdown).
- **Slip-safe sigRPM**: o sinal usado é sempre o **drivetrainRPM** (RPM virtual = `wheelOmega · ratio · finalDrive`). Nunca usa `engineRPM`. O drivetrainRPM evolui suavemente com a velocidade do carro e não decola em slip — elimina H1.
- **Kickdown**: throttle > 90% + freio motor saturado força downshift se sigRPM < `downshiftRPM × 1.3`, ignorando lockout.
- **Inibir upshift em drift sustentado**: se `rear slip angle > 0.25 rad` por > 300 ms, não sobe — driver provavelmente quer manter a marcha.

### 3.3 Estrutura de dados proposta

```js
shiftMap = {
  1: { upWOT: 6500, upCruise: 3000, downWOT: 3500, downCruise: 1700 },
  2: { upWOT: 6300, upCruise: 2800, downWOT: 3700, downCruise: 1700 },
  3: { upWOT: 6200, upCruise: 2600, downWOT: 3900, downCruise: 1700 },
  4: { upWOT: 6000, upCruise: 2400, downWOT: 4000, downCruise: 1700 },
  5: { upWOT: 5800, upCruise: 2200, downWOT: 4000, downCruise: 1700 },
};
// índice = currentGear (2..6 = 1ª..5ª, gera shift pra próxima)
// thresholds em throttle parcial: lerp(cruise, WOT, throttle)
```

---

## 4. Plano de implementação (ordem)

1. **Refatorar `Gearbox` para usar shiftMap** por par (substitui as 4 constantes lineares atuais).
2. **Trocar `sigRPM` para sempre = `drivetrainRPM`** no auto-shift (mata a fonte de oscilação H1). `engineRPM` continua sendo usado pelo gating de over-rev em `shiftDown` manual.
3. **Adicionar debounce temporal**: `_thresholdTimer` (acumula tempo em condição), aceita shift só quando ≥ 180 ms.
4. **Anti-hunting lockout**: após qualquer shift, `_lastShiftDirection` + `_antiHuntTimer = 0.7s`. Downshift bloqueado nesse timer salvo kickdown ou RPM colapsando.
5. **Inibir upshift em drift sustentado**: ler slip dos pneus traseiros (passar via `inputs`).
6. **Ajustar `shiftCooldownH/Seq`** para 0.35 / 0.12 (mais curto, debounce + lockout substituem o cooldown grande).
7. **HUD: mostrar threshold do upshift dinâmico** numa linha do telemetry (`UP@xxxx | DOWN@xxxx`), pra debug visual.
8. **Validação manual**: arrancada WOT 1ª→6ª, lift-off + freada 6ª→2ª, cruise 60-100 km/h sem hunting, drift sustentado em 2ª.

---

## 5. Decisões pendentes (perguntas pro usuário)

1. **Confirmação do redline efetivo**: 7200 (atual) ou 7500? Tabela acima assume 7200.
2. **Modo padrão**: `h_pattern` (atual) ou `sequential`? Sequential com debounce mais curto (60 ms) é mais "raw" e drift-friendly.
3. **Inibir upshift em drift**: é desejado? Em alguns drift games o auto-shift continua subindo pra manter velocidade durante slide longo.
4. **Aceita o shift map proposto**, ou prefere mais conservador (subir mais cedo, ~5500 WOT)?

---

## Referências

- Patente Chrysler — Shift Hunting Prevention (US5669850A): https://patents.google.com/patent/US5669850A/en
- Patente Cummins — Preventing gear hunting (US6098004A): https://patents.google.com/patent/US6098004A/en
- MegaShift — Shift Table Tuning (hysteresis prática): http://www.msgpio.com/manuals/mshift/tuning.html
- Tuning-X — Transmission Tuning: https://tuning-x.com/transmission-tuning
- ZF 8HP shift maps (8speed.au TurboLAMIK): https://www.8speed.au/blogs/news/turbolamik-automatic-shift-points
- ZF 8HP guide (ZackTuned): https://www.zacktuned.com/blogs/zacktuned/8hp-transmission-control-guide
- ECU Testing — TCU explained: https://www.ecutesting.com/categories/transmission-ecu-explained/
- Engineer Fix — RPM shift points: https://engineerfix.com/at-what-rpm-should-an-automatic-transmission-shift-gears/
- Engineer Fix — Kickdown: https://engineerfix.com/what-is-kickdown-in-a-car-and-how-does-it-work/
- ForzaShiftTone (engenharia reversa Forza): https://github.com/theRTB/ForzaShiftTone
- Forza forums — auto upshift behavior: https://forums.forza.net/t/make-automatic-shifting-controls-change-gears-at-max-rpm-instead-of-redline/545030
- Assetto Corsa AUTO_SHIFTER discussion: https://www.overtake.gg/threads/automatic-gearshifting.191972/
- AC real automatic gearbox mod: https://github.com/AnnoyingTechnology/assetto-corsa-real-automatic-gearbox
- DSPort — race-friendly dyno curves: https://dsportmag.com/the-tech/learning-curves-recognizing-a-race-friendly-dyno-graph/2/
- SpoolStreek — turbo 4cyl shift points: https://www.spoolstreet.com/threads/stock-turbo-best-shift-points-n55-auto-1-4mile.1545/
- proEFI Transmission Shift Schedule manual: https://download.proefi.com/Tuning%20Instructions/Transmission%20Control%20Setup.pdf
- Nature Sci Reports — Shifting process control: https://www.nature.com/articles/s41598-022-17413-7
