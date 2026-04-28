// Pista 1 — Tsukuba-inspired (drift touge técnico).
// Layout: reta principal → hairpin direita → S-curve → hairpin esquerda
// → reta de volta → curva final. ~600m total, 3 sectores.
//
// Convenção de eixos: +X direita, +Z frente. Pista no plano XZ (Y=0).
// Spawn em arcLengthT=0 → carro nasce no primeiro control point com heading
// alinhado ao tangente da spline naquele ponto.

export const track01 = {
  id: 'track01',
  name: 'Pista 1 — Tsukuba',

  // 15 control points formando circuito fechado tipo touge.
  // Tangent em (0,0) = ((next.x - prev.x)/2, (next.z - prev.z)/2)
  //                 = ((0-0)/2, (60-(-25))/2) = (0, +42.5) → heading 0 (+Z) ✓
  controlPoints: [
    { x: 0,    z: 0    },   // 0  — START/FINISH (reta principal apontando +Z)
    { x: 0,    z: 60   },   // 1  — meio reta principal
    { x: 5,    z: 110  },   // 2  — preparação hairpin direita
    { x: 30,   z: 140  },   // 3  — entrada hairpin direita
    { x: 60,   z: 140  },   // 4  — apex hairpin direita
    { x: 75,   z: 110  },   // 5  — saída hairpin direita
    { x: 65,   z: 60   },   // 6  — preparação S
    { x: 30,   z: 30   },   // 7  — meio S (transição direita→esquerda)
    { x: -10,  z: 50   },   // 8  — meio S (já em curva esquerda)
    { x: -50,  z: 80   },   // 9  — entrada hairpin esquerda
    { x: -80,  z: 60   },   // 10 — apex hairpin esquerda
    { x: -75,  z: 20   },   // 11 — saída hairpin esquerda
    { x: -50,  z: -20  },   // 12 — reta de volta
    { x: -20,  z: -30  },   // 13 — preparação curva final
    { x: 0,    z: -25  },   // 14 — saída final, conecta com (0,0)
  ],
  closed: true,
  tension: 0.5,

  width: 12,
  curbWidth: 0.8,   // zebra red/white de 0.8m em cada lado da pista
  grassWidth: 0,    // grass terrain é um plano grande embaixo (TrackBuilder)
  terrainMargin: 200, // m de grama além do bbox da pista

  spawn: {
    arcLengthT: 0.0,
    headingOffset: 0,
    lateralOffset: 0,
  },

  // Gates definidos mas não consumidos na Fase 1 (LapSystem entra na Fase 2).
  gates: [
    { name: 'start',   t: 0.0,  isStartFinish: true },
    { name: 'sector1', t: 0.33 },
    { name: 'sector2', t: 0.66 },
  ],

  environment: {
    fogNear: undefined,
    fogFar:  undefined,
  },
};
