export const GAME_CFG = {
  nitroMult: 1.5,
  nitroDuration: 2.5,
  nitroCooldown: 5,
  comboTime: 2,
  maxSkids: 800,
  arenaSize: 80,
};

export const PHYSICS_CFG = {
  // Sub-stepping para estabilidade do integrador físico
  subSteps: 4,

  // Damping de yawRate por sub-step (compensa drift numérico do Euler)
  yawRateDamping: 0.992,

  // Damping da angularVelocity da roda quando solta no ar (sem grip)
  wheelAirDamping: 0.9995,

  // Steer smoothing
  steerInputAccel: 2.8,
  steerCenterReturn: 2.0,

  // Pitch/roll dinâmico do chassis (visual feedback de aceleração e curva)
  pitchAccelGain: 0.022,
  rollAccelGain: 0.018,

  // Limite de velocidade para clamping de "carro parado"
  stopVelocityThreshold: 0.3,

  // Detecção de drift no HUD (rear slip angle em rad + velocidade mínima m/s)
  driftSlipThreshold: 0.28,
  driftMinSpeed: 3.5,
  driftSmokeThreshold: 0.12,
  driftSmokeIntensityMult: 2.5,

  // Steer "safe" — reduz max steer com velocidade (anti-flip)
  safeSteerMaxSpeed: 120.0,
  safeSteerCap: 100.0,
};
