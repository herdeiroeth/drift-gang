// Sons procedurais via Web Audio API. Sem assets — beeps gerados ao vivo.
// AudioContext é instanciado lazy (1ª chamada) pra respeitar autoplay policy
// dos browsers (precisa de gesto do usuário pra dar resume).

let _ctx = null;

function ctx() {
  if (!_ctx) {
    const Klass = window.AudioContext || window.webkitAudioContext;
    if (!Klass) return null;
    _ctx = new Klass();
  }
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
  return _ctx;
}

// Beep curto: oscillator + envelope ADSR rápido.
function beep(freqHz, durationS = 0.18, volume = 0.12, type = 'square') {
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqHz, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationS);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durationS + 0.02);
}

export const LapSoundFX = {
  // Volta normal completada — single beep
  playLapComplete() {
    beep(660, 0.16, 0.10, 'square');
  },

  // Personal best — arpeggio ascendente em 3 notas
  playPersonalBest() {
    const c = ctx();
    if (!c) return;
    beep(660, 0.12, 0.10, 'square');
    setTimeout(() => beep(880, 0.12, 0.10, 'square'), 120);
    setTimeout(() => beep(1320, 0.22, 0.12, 'square'), 240);
  },

  // Volta inválida — buzz curto em frequência baixa
  playInvalid() {
    beep(180, 0.18, 0.08, 'sawtooth');
  },
};
