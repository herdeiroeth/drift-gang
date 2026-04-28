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
  yawRateDamping: 0.998,

  // Damping da angularVelocity da roda quando solta no ar (sem grip)
  wheelAirDamping: 0.9995,

  // Steer smoothing
  steerInputAccel: 9.0,
  steerCenterReturn: 6.0,

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

  // ----- Gear-shift gating (Forza/AC style) -----
  // Margem em RPM acima do redline tolerada num downshift (rev-match window).
  // Se projectedRPM(newGear) > maxRPM + margin → recusa o shift (motor explodiria).
  shiftOverrevMarginRPM: 250,

  // RPM mínimo aceitável após upshift. Abaixo disso é "bog" (motor afogado).
  // Auto-shift usa também isso para decidir SE faz upshift (precisa cair acima).
  shiftMinRPMAfterUpshift: 1700,

  // RPM-alvo ideal pós-upshift no auto-shift; só upshift quando o RPM previsto
  // na próxima marcha cair entre [minRPMAfterUpshift, redline-margem].
  // Implementação: upshift se projectedRPM ≥ minPostShiftRPM E motorRPM atual ≥ upshiftRPM.
  shiftMinPostUpshiftRPM: 2400,

  // Cooldown entre auto-shifts (s). Maior = menos chatter.
  shiftCooldownH: 0.55,
  shiftCooldownSeq: 0.18,

  // Auto-shift requer engine ESTAR acoplado ao drivetrain (clutch sem slip).
  // Se clutch tá slipping (arrancada, burnout), auto-shift usa o
  // drivetrainRPM (RPM virtual da roda) em vez de engineRPM como sinal.
  // Isso evita pular pra 6ª em arrancada.
  autoShiftUseDrivetrainRPMWhenSlip: true,
};
