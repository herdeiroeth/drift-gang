# Pesquisa: audio de motor realista para Drift Gang

Data: 29 Abr 2026

Objetivo: mapear materiais e caminhos tecnicos para criar som de motor, aceleracao, troca de marcha, turbo, limitador e pneus usando uma BMW M4 real como referencia sonora, adaptando o que a comunidade de Assetto Corsa/FMOD ja documentou para o nosso runtime em Three.js + Web Audio.

## Resumo executivo

O caminho com melhor custo/beneficio para o projeto e implementar um motor de audio sample-based no browser:

1. Usar a fisica atual como fonte de verdade: `rpm`, `throttle`, `gear`, `isShifting`, `clutchSlip`, `boostPsi`, `turboSpooling` e `slipIntensity`.
2. Tocar loops reais em faixas de RPM, separados em `on-load` e `off-load`.
3. Fazer crossfade entre os loops vizinhos e ajustar `playbackRate` com base no RPM real.
4. Disparar eventos curtos para troca de marcha, limiter, backfire, blow-off, skid e impacto de transmissao.
5. Comecar com um pack simples e depois substituir por uma biblioteca real de BMW M4 licenciada.

Assetto Corsa e Wwise usam variacoes do mesmo conceito: audio dirigido por parametros vindos da simulacao, principalmente RPM e Load/Throttle. Nao precisamos usar FMOD no runtime do nosso jogo; podemos copiar a arquitetura conceitual e implementar em Web Audio.

## Estado atual do nosso projeto

Ja temos quase toda a telemetria que o audio precisa:

- `src/powertrain.js` simula motor, clutch, gearbox, differential, TC, launch e turbo.
- `Engine` ja tem `rpm`, `throttlePos`, `idleRPM`, `redlineRPM`, `revLimitRPM`, coast torque e torque curve.
- `Gearbox` ja expoe `isShifting`, `shiftProgress`, `shiftTime`, `gearIdx`, `targetGearIdx` e modo H-pattern/sequential.
- `Turbocharger` ja expoe boost, spool e queda rapida de pressao no throttle release.
- `Car.update()` ja retorna `rpm`, `gear`, `wheelData`, `slipIntensity` e `powertrain`.
- O audio atual e so beep procedural em `src/audio/LapSoundFX.js`; nao existe ainda sistema continuo de motor.

Isso significa que o trabalho de audio nao precisa mexer na fisica primeiro. Ele deve ler a fisica e traduzir estado mecanico em mix.

## Como Assetto Corsa organiza isso

Assetto Corsa usa FMOD e trabalha com banks de audio por carro. A comunidade documenta a existencia do SDK de audio no proprio install do jogo, em algo como:

```text
assettocorsa/sdk/audio/AC Audio Pipeline 1.9.pdf
assettocorsa/sdk/audio/ac_fmod_sdk_1_9/ac_fmod_sdk_1_9.fspro
```

O material comunitario mostra a taxonomia de eventos por carro, por exemplo:

```text
event:/cars/<car>/engine_ext
event:/cars/<car>/engine_int
event:/cars/<car>/gear_ext
event:/cars/<car>/gear_int
event:/cars/<car>/gear_grind
event:/cars/<car>/limiter
event:/cars/<car>/turbo
event:/cars/<car>/skid_ext
event:/cars/<car>/skid_int
event:/cars/<car>/wind
event:/cars/<car>/backfire_ext
event:/cars/<car>/backfire_int
```

Adaptacao util para nos: usar essa lista como checklist de eventos, nao como fonte de audio. Banks de Assetto Corsa, sons Kunos, sons de mods e sons extraidos de YouTube nao devem entrar no jogo publicado sem licenca clara.

## Modelo tecnico recomendado

### Parametros de entrada

Criar um objeto por frame:

```js
const audioState = {
  rpm,
  rpmNorm,
  throttle,
  load,          // -1..1: coast/off-load ate on-load
  gearIdx,
  isShifting,
  shiftProgress,
  clutchSlip,
  boostPsi,
  turboSpooling,
  launchActive,
  tcCut,
  slipIntensity,
  speed,
  cameraMode,
};
```

Mapeamento inicial:

```js
rpmNorm = clamp((rpm - idleRPM) / (redlineRPM - idleRPM), 0, 1)
load = throttle > 0.05
  ? throttle
  : -rpmNorm * smoothstep(idleRPM + 300, redlineRPM, rpm)
```

Depois podemos refinar `load` usando torque real:

```js
load = clamp(transmittedTorque / maxEngineTorque, -1, 1)
```

Mas para a primeira versao, `throttle + coast + boost` ja resolve bem.

### Loops de motor

Estrutura dos assets:

```text
public/audio/cars/m4/
  manifest.json
  engine/
    int_on_1000.wav
    int_on_2000.wav
    int_on_3000.wav
    int_on_4000.wav
    int_on_5000.wav
    int_on_6000.wav
    int_on_7000.wav
    int_off_1000.wav
    int_off_2000.wav
    ...
    ext_on_1000.wav
    ext_off_1000.wav
  events/
    shift_up_01.wav
    shift_down_blip_01.wav
    limiter_01.wav
    backfire_01.wav
    blowoff_01.wav
    starter_01.wav
```

Manifest:

```json
{
  "id": "bmw_m4_s55",
  "idleRPM": 850,
  "redlineRPM": 7600,
  "loops": [
    { "file": "engine/int_on_1000.wav", "baseRPM": 1000, "load": "on", "perspective": "interior" },
    { "file": "engine/int_off_1000.wav", "baseRPM": 1000, "load": "off", "perspective": "interior" }
  ]
}
```

Para cada loop:

- `gain = rpmBlend(baseRPM) * loadBlend(on/off) * perspectiveBlend`
- `playbackRate = clamp(rpm / baseRPM, 0.75, 1.35)`
- `filterFrequency` abre com RPM e carga
- `distortion/saturation` cresce com carga e boost

No Web Audio, `AudioBufferSourceNode.playbackRate` e um `AudioParam`, entao da para automatizar pitch em tempo real. Como `AudioBufferSourceNode` e one-shot, a implementacao cria fontes em loop para cada sample e controla o ganho de cada uma, recriando fontes so quando trocar de car pack ou reiniciar audio.

### Troca de marcha

Durante `isShifting`:

- reduzir ganho do on-load por 40-120 ms;
- tocar `gear_int` ou `gear_ext`;
- em sequential, adicionar ignition cut curto;
- em downshift, usar `pendingEngineBlipRPM`/`shiftProgress` para tocar blip;
- se `clutchSlip` alto, adicionar chirp mecanico/transmission whine.

Eventos simples:

```js
if (becameShifting) playOneShot("shift_up");
if (gearChanged && rpmDroppedFast) playOneShot("shift_thump");
if (downshift && rpmBlip) playOneShot("rev_match_blip");
```

### Turbo e blow-off

Ja temos `boostPsi` e `turboSpooling`:

- spool: loop tonal/noise com volume baseado em `boostPsi` e `turboSpooling`;
- wastegate/blow-off: one-shot quando throttle cai rapidamente e boost estava alto;
- filtro highpass/lowpass para separar whistle de hiss.

### Pneus

O projeto ja calcula `slipAngle`, `slipRatio`, `slipIntensity` e temperatura. Audio de pneu deve usar:

- volume por `max(abs(slipAngle), abs(slipRatio))`;
- pitch por velocidade da roda/velocidade do carro;
- camada lateral para drift continuo;
- camada curta para lockup, handbrake e transicao de grip.

## Materiais pesquisados

### Definir qual M4 estamos mirando

Existem duas referencias praticas para o nosso caso:

- BMW M4 2014 F82/F83, motor S55, 3.0 turbo inline-6. E a que casa melhor com a biblioteca Sonniss BMW M4 2014.
- BMW M4 atual G82/G83, motor S58, 3.0 turbo inline-6. A pagina atual da BMW USA lista 2.993 cc, 6 cilindros e variantes de 473/503/523 hp.

Para som, a geracao importa muito: escape, turbo, isolamento de cabine, ASD e cambio mudam a assinatura. A recomendacao e comecar com F82/S55 se formos usar a Sonniss, ou criar um `m4_g82_s58` separado se quisermos o modelo atual.

### Assetto Corsa / FMOD

- AC Audio Pipeline 1.9: guia oficial distribuido dentro do install de Assetto Corsa. A comunidade aponta esse PDF e o projeto `ac_fmod_sdk_1_9.fspro` como ponto de partida para sound banks.
- Forum Assetto Corsa Mods: guia rapido recomenda abrir o PDF do SDK, usar a versao correta do FMOD Studio e estudar o projeto exemplo.
- Forum Assetto Corsa Mods: exemplos de `GUIDs.txt` mostram os eventos de carro, incluindo `engine_ext`, `engine_int`, `gear_ext`, `gear_int`, `gear_grind`, `limiter`, `turbo`, `skid` e `wind`.
- Forum FMOD: confirma que o projeto de exemplo de Assetto Corsa fica no subdiretorio `sdk` do install e recomenda usar a comunidade de AC para detalhes.

Uso recomendado: estudar taxonomia e comportamento. Nao usar banks/samples de AC como asset do jogo sem permissao.

### FMOD e Wwise - arquitetura

- Tsugi/GameSynth + FMOD: workflow de renderizar samples on-load e off-load por RPM, criar parametros `RPM` e `Load`, usar crossfade e Auto Pitch.
- FMOD forum: RPM + Load e o padrao de loops sao citados como abordagem comum; AutoPitch e o recurso esperado para ajustar pitch por RPM.
- Audiokinetic/Wwise loop-based engine design: define os parametros basicos como `Rpm`, `Load` e `Throttle`; explica on-load, off-load e neutral load.
- Audiokinetic 2025: compara sample-based com granular synthesis; recomenda loops de steady RPM para sample-based e ramps `Accel`, `Decel`, `Idle` para granular.
- Wwise Integration Demo: tem um exemplo de RTPC de motor em que um slider de RPM controla um parametro associado ao audio.

Uso recomendado: copiar o design de parametros e crossfade. Para runtime browser, Web Audio substitui FMOD/Wwise.

### Projetos abertos

- `ange-yaghi/engine-sim`: simulador de combustao em tempo real focado em audio de motor e resposta de motor. Licenca MIT. Excelente como referencia de sintese fisica/procedural, mas pesado para portar direto.
- `Antonio-R1/engine-sound-generator`: gerador de som de motor em JavaScript/Web Audio/Three.js, com AudioWorklet e versao WASM. Licenca MIT. Melhor referencia tecnica para um futuro modo procedural no nosso stack.
- `rdoerfler/procedural-engine-sounds`: dataset sintetico com RPM e torque anotados. Licenca CC BY-NC 4.0; serve para pesquisa/prototipo, nao para assets comerciais.
- `Sounds of Vehicle Internal Combustion Engines` no Zenodo: dataset real CC BY 4.0 com sons de motores em idle/aceleracao parcial. Bom para testes de analise, mas nao e M4 nem pack de loops pronto para jogo.

Uso recomendado: MIT pode inspirar codigo com atribuicao; datasets ajudam a validar algoritmos, nao substituem um pack de M4 real.

### Bibliotecas/sons de BMW M4

- Sonniss / Pole Position - BMW M4 2014: biblioteca paga, 189 arquivos, 15.67 GB, 96 kHz, 24-bit, mono/stereo/surround, motor 3L turbo straight-six, com onboard, exterior, steady RPM, gearshifts e ramps. E a melhor candidata encontrada para um pack realista de M4.
- Sound Ideas / Sounding Sweet - BMW M4 F83: biblioteca paga com 170 WAV, 7.03 GB, 96 kHz/24-bit, onboard e exterior. A pagina menciona "4.4L Twin Turbocharged V8", o que conflita com a M4 F83 real, entao vale ouvir/validar antes de comprar.
- OverTake - SCIBSOUND BMW M4 Akrapovic sound mod: mod gratuito para Assetto Corsa. Bom para referencia auditiva e estudo de estrutura, mas permissao de uso em outro jogo precisa ser confirmada diretamente com o autor.

Uso recomendado: comprar/licenciar Sonniss se quisermos som real de M4 sem gravar. Mods de AC entram como referencia, nao como asset.

## Gravacao propria de uma M4

Se formos gravar uma M4 real, o ideal:

- gravar em 96 kHz/24-bit;
- usar mic dinamico perto do escape, mic no engine bay, mic interior e um par externo;
- gravar idle, startup, shutdown, steady RPM em passos de 1000 rpm, ramp up/down em neutro, aceleracoes em marcha, lifts e gearshifts;
- evitar vento, clipping e reflexoes fortes;
- gravar on-load real preferencialmente em dinamometro ou pista controlada; steady RPM parado tende a soar fraco porque nao tem carga.

Checklist minimo de captacao:

```text
Idle: 30s limpo
Steady: 1000, 2000, 3000, 4000, 5000, 6000, 7000 rpm
Ramps: idle -> redline -> idle, lento e rapido
Load: 2a/3a marcha WOT de baixa para alta rotacao
Off-load: lift de alta rotacao, engine braking
Events: shifts, limiter, pops/backfire, blow-off/spool, starter
Perspectivas: interior, engine bay, exhaust, exterior pass-by
```

## Plano de implementacao

### Fase 1 - EngineAudio sample-based

Criar `src/audio/EngineAudio.js`:

- `init()` lazy depois do primeiro gesto do usuario;
- `loadCarPack(manifestUrl)`;
- `update(dt, audioState)`;
- `playOneShot(name, intensity)`;
- `setListener(camera)`;
- crossfade por RPM e load;
- smoothing de RPM/load para evitar zipper/click.

Criar `public/audio/cars/dev/manifest.json` com samples placeholder ou sinteticos curtos enquanto nao compramos ou gravamos uma M4.

### Fase 2 - Integracao com Car/Game

Adicionar `audioState` ao retorno de `Car.update()`:

- incluir `throttleInput`, `brakeInput`, `clutchHold`, `powertrain`, `speed`, `slipIntensity`;
- no `Game` loop, chamar `engineAudio.update(dt, audioState)`.

Disparar eventos por transicao:

- `becameShifting`;
- `gearChanged`;
- `revLimiterHit`;
- `boostRelease`;
- `tcCutStarted`;
- `driftSlipStarted`.

### Fase 3 - M4 pack

Opcao A: comprar Sonniss BMW M4 2014, editar loops no Reaper/Audacity e converter para assets web.

Opcao B: gravar M4 real.

Formato web:

- desenvolvimento: WAV para qualidade e edicao facil;
- producao: OGG/Opus ou AAC, mantendo WAV master fora do bundle;
- loops curtos, sem click, normalizados por camada.

### Fase 4 - Upgrade procedural/granular

Depois do sample-based funcionando:

- adicionar AudioWorklet para granular/ramp playback;
- usar ramp `Accel/Decel/Idle` para som mais fluido em RPM rapido;
- aproveitar conceitos do `engine-sound-generator` e do `engine-sim`;
- opcionalmente gerar camadas harmonicas por ordem de motor inline-6.

## Recomendacao final

Para o Drift Gang agora:

1. Implementar `EngineAudio` sample-based com Web Audio.
2. Usar manifest de car pack inspirado em AC/FMOD.
3. Comecar com 7 faixas de RPM x 2 cargas x 1 perspectiva.
4. Adicionar turbo, shift, limiter e tyre como eventos/camadas.
5. Comprar/licenciar Sonniss BMW M4 2014 ou gravar uma M4 real.
6. So depois considerar granular/procedural, porque o sample-based ja vai entregar 80% do realismo com muito menos risco.

## Fontes

- FMOD Studio docs: https://www.fmod.com/docs/
- FMOD forum - Car engine sound: https://qa.fmod.com/t/car-engine-sound/11999
- FMOD forum - Assetto Corsa gearshift / SDK mention: https://qa.fmod.com/t/cant-trigger-sound-from-gearshifts-properly-in-assetto-corsa/20025
- Assetto Corsa Mods - Start with Sound Modding: https://assettocorsamods.net/threads/start-with-sound-modding-quick-guide.1163/
- Assetto Corsa Mods - FMOD/GUIDs event example: https://assettocorsamods.net/threads/fmod-and-assetto-corsa-unofficial-fix.132/
- Kunos official forum - Sounds modding section: https://www.assettocorsa.net/forum/index.php
- Tsugi - From the Engines Plug-in to FMOD: https://tsugi-studio.com/blog/2022/05/19/from-engine-plug-in-to-fmod-studio/
- Audiokinetic - Loop-Based Car Engine Design with Wwise: https://www.audiokinetic.com/blog/loop-based-car-engine-design-with-wwise-part-1
- Audiokinetic - Engine Sound Modeling: https://www.audiokinetic.com/ko/blog/engine-sound-modeling-from-sampling-to-granular-synthesis-in-wwise/
- Audiokinetic SDK - RTPC Car Engine demo: https://www.audiokinetic.com/en/public-library/2024.1.9_8920/?id=soundengine_integration_samplecode.html&source=SDK
- MDN - AudioBufferSourceNode playbackRate: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate
- MDN - Web Audio spatialization basics: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics
- Engine Simulator: https://github.com/ange-yaghi/engine-sim
- Engine Sound Generator JS/Web Audio: https://github.com/Antonio-R1/engine-sound-generator
- Procedural Engine Sounds Dataset: https://huggingface.co/datasets/rdoerfler/procedural-engine-sounds
- Paper - Analysis-Driven Procedural Generation of an Engine Sound Dataset: https://arxiv.org/abs/2603.07584
- Zenodo - Sounds of Vehicle Internal Combustion Engines: https://zenodo.org/records/18777405
- Sonniss - BMW M4 2014: https://sonniss.com/sound-effects/bmw-m4-2014/
- Sound Ideas - BMW M4 F83 by Sounding Sweet: https://www.sound-ideas.com/Product/2448/BMW-M4-F83-by-Sounding-Sweet
- OverTake - SCIBSOUND BMW M4 Akrapovic sound mod: https://www.overtake.gg/downloads/scibsound-bmw-m4-akrapovic-sound-mod.44972/
- BMW USA - M4 specs: https://www.bmwusa.com/vehicles/m-series/bmw-4-series-m-models/bmw-m4-coupe-technical-highlights.html/FAQ.bmwusa.com
