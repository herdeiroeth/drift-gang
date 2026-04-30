// Defaults visuais do carro. Separado de CarConfig (que é puramente físico)
// para evitar acoplamento entre cores/segmentos e parâmetros de suspensão/motor.
//
// Cores em hex 0xRRGGBB. Geometria é descrita pelos consumidores das partes —
// aqui ficam só constantes "estéticas" (cor, contagens de segmentos, raios cosméticos).
export const VISUAL_CFG = {
  // Body 3D externo (glTF). Quando enabled=true e o modelo carrega com sucesso,
  // o body procedural (Chassis.js) é substituído pelo GLB; rodas do GLB são
  // extraídas e reparentadas nos wheel.mesh físicos. Fallback automático
  // pra procedural se o asset falhar ou rodas não puderem ser extraídas.
  gltfBody: {
    enabled:          true,
    // Prefer the full source GLB for close-up paint quality; the optimized
    // asset is only a lightweight fallback.
    url:              ['/models/bmw_m4_f82.glb', '/models/bmw_m4_f82.opt.glb'],
    // Comprimento total = wheelBase × scaleFactor. 1.55 ≈ proporção típica
    // de carros esportivos (BMW M4 F82 real: wheelBase 2.81m, length 4.67m → 1.66).
    scaleFactor:      1.66,
    // +1 = forward é +Z (Three.js padrão). -1 = forward é -Z (Blender padrão).
    // Detectar visualmente após primeira render: faróis devem ficar onde W aponta.
    forwardSign:      +1,
    // Aplica clearcoat à pintura (materiais com metalness alto). Visual showroom.
    applyClearcoat:   true,
    // Habilita extração das rodas do GLB pra reparentar nos wheel.mesh físicos.
    // Se false, esconde as rodas do GLB (se detectadas) e usa WheelAssembly procedural.
    useGltfWheels:    true,
    // Usa o layout real das rodas do GLB para calibrar track/radius visual da física.
    syncWheelGeometryFromGltf: true,
    // Centraliza os wheel wells do GLB no eixo físico atual antes de extrair as rodas.
    alignWheelWellsToPhysics: true,
    // Offset lateral extra por lado nas rodas traseiras do GLB. O modelo fica
    // visualmente melhor com a traseira um pouco mais para fora dos paralamas.
    rearWheelOutboardOffset: 0.08,
    // Mesmo princípio nas dianteiras, mas com magnitude menor — visualmente as
    // dianteiras pedem track um pouco mais estreita que as traseiras.
    frontWheelOutboardOffset: 0.05,
    // Debug/legado: desenhar suspensão/drivetrain procedural por cima do GLB.
    // Default false para usar a mecânica visível que já vem no asset.
    showProceduralUndercarriage: false,
    // Esconde body procedural mesmo se GLB falhar. Default false: melhor ter
    // car procedural visível do que carro invisível.
    hideProceduralOnFail: false,
  },

  body: {
    color:               0xff2a6d,
    roughness:           0.25,
    metalness:           0.30,
    clearcoat:           1.0,
    clearcoatRoughness:  0.15,
  },
  glass: {
    color:        0x111111,
    roughness:    0.05,
    metalness:    0.40,
    transmission: 0.40,
    thickness:    0.05,
  },
  mirrors: {
    enabled:     true,
    textureWidth: 1024,
    textureHeight: 512,
    multisample: 0,
    anisotropy:  16,
    updateEvery: 1,
    fov:         54,
    near:        0.08,
    far:         360,
    flipX:       true,
    hideCarInReflection: true,
    cameraEye:   { x: 0.0, y: 1.28, z: -1.15 },
    cameraLook:  { x: 0.0, y: 1.12, z: -48.0 },
    // Dois retrovisores externos + um interno. A textura é compartilhada:
    // uma câmera alta definição por frame em vez de um render extra por mesh.
    maxActive:   3,
  },
  spoiler: { color: 0x0a0a0a, roughness: 0.40, metalness: 0.60 },
  headlight: { color: 0xffffcc, emissive: 0xffffaa, intensity: 2.5 },
  taillight: { color: 0xff1111, emissive: 0xff0000, intensity: 1.5 },

  // Sistema de luzes funcionais do GLB. Estados:
  //   0 = off (tudo desligado, brake ainda funciona)
  //   1 = DRL + lanterna traseira de posição (farol off)
  //   2 = farol baixo + lanterna de posição traseira + spotlight low
  //   3 = farol alto + lanterna de posição traseira + spotlight high
  //
  // Tecla F cicla 0→1→2→3→0. Brake light intensifica sobre `position` quando
  // brake>0.05 (independente do modo, pra brake-light sempre funcionar).
  lights: {
    defaultMode: 1,                                  // arranca em DRL (cinema)
    drl:      { color: 0xfff4d6, intensity: 0.9 },   // headsignal frontal — sempre on em mode≥1
    low:      { color: 0xfff4d6, intensity: 2.4 },   // lowbeam emissive
    high:     { color: 0xffffff, intensity: 4.5 },   // highbeam emissive
    position: { color: 0xff1818, intensity: 0.55 },  // taillight L/R "snake" — on em mode≥1
    brakeBoost: 2.5,                                 // somado em cima da posição quando brake>0.05
    // SpotLight real (cone de luz no chão). Só ativo em mode 2/3.
    spot: {
      angle: Math.PI / 7,             // ~25.7°
      penumbra: 0.55,
      distance: 60,
      intensityLow:  120,             // physicallyCorrectLights units
      intensityHigh: 280,
      castShadow: true,
      shadowMapSize: 1024,            // menor que sun (4096) — perf
      shadowBias: -0.0002,
      // Offset local do farol em relação ao car.mesh (pivot do mesh é o CG).
      // Z = +frente do carro. Y/X = altura/lateral. Valores afinados pra
      // BMW M4 F82 escala atual; ajustar se mudar `scaleFactor`.
      mountY: 0.55,
      mountZHint: 1.55,                // tentativa de frente; sobrescrito pelo headlight mesh world pos
      // Direção do feixe: low aponta levemente pra baixo, high mais alto.
      targetForwardZ: 12.0,            // m à frente
      targetLowY:  -1.0,               // alvo abaixo do farol (low aponta pro asfalto perto)
      targetHighY: -0.55,              // high beam: aponta menos pra baixo que low, mas
                                       // ainda ilumina o asfalto (era -0.15 = quase reto,
                                       // perdia o feixe próximo do carro).
    },
  },

  tire: {
    color:        0x0c0c0c,
    roughness:    0.95,
    metalness:    0.02,
    radialSegs:   32,
    treadGrooves: 12,
  },
  rim: {
    color:      0x2a2a30,
    roughness:  0.20,
    metalness:  0.92,
    spokes:     5,
    latheSegs:  24,
  },
  brake: {
    discColor:    0x4a4a4e,
    discRough:    0.60,
    discMetal:    0.85,
    caliperColor: 0xc8181f,
    caliperRough: 0.35,
    caliperMetal: 0.50,
  },
  spring: {
    color:        0xff2a6d,
    roughness:    0.35,
    metalness:    0.55,
    turns:        8,
    radius:       0.045,
    tubeRadius:   0.008,
    tubularSegs:  96,
    radialSegs:   6,
    minScaleY:    0.40,
    maxScaleY:    1.05,
  },
  damper: { color: 0x1a1a20, roughness: 0.35, metalness: 0.85, radius: 0.022 },
  axle:   { color: 0x4a4a50, roughness: 0.40, metalness: 0.92, radius: 0.025 },
  control:{ color: 0x35353a, roughness: 0.55, metalness: 0.80, radius: 0.025 },
  diff:   { color: 0x2a2a2c, roughness: 0.50, metalness: 0.70 },
};
