// Utilitários do sistema de voltas. Funções puras — sem estado interno.
// Geometria 2D no plano XZ (pista plana V1).

// Line-line intersection 2D clássica. Retorna true se os segmentos
// (p0→p1) e (p2→p3) se cruzam em ponto interior a ambos.
// Usa parametrização barycêntrica + cross product. Robusto pra qualquer
// velocidade do carro (não tem aproximação por bbox).
export function segSegIntersect(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
  const dx1 = p1x - p0x, dy1 = p1y - p0y;
  const dx2 = p3x - p2x, dy2 = p3y - p2y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-9) return false;  // paralelos / colineares

  const sx = p2x - p0x, sy = p2y - p0y;
  const t = (sx * dy2 - sy * dx2) / denom;
  const u = (sx * dy1 - sy * dx1) / denom;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// Testa se o segmento de movimento (p0 → p1) cruza o gate E na direção esperada.
// gate = { ax, az, bx, bz, dirX, dirZ } — endpoints (a,b) + tangente da pista.
// p0/p1 são objetos com {x, z} (plano XZ).
//
// Direction check: vetor de movimento deve ter componente positivo no tangente
// da pista. Sem isso, dar meia-volta e cruzar o finish "ao contrário" contaria
// como progresso (cheese trivial).
export function segmentIntersectsGate(p0, p1, gate) {
  const cross = segSegIntersect(
    p0.x, p0.z, p1.x, p1.z,
    gate.ax, gate.az, gate.bx, gate.bz,
  );
  if (!cross) return false;
  const moveDot = (p1.x - p0.x) * gate.dirX + (p1.z - p0.z) * gate.dirZ;
  return moveDot > 0;
}

// Formata milissegundos como 'MM:SS.mmm'. Pra display no HUD.
//   formatTime(83456) → '01:23.456'
//   formatTime(0)     → '00:00.000'
export function formatTime(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '--:--.---';
  const totalMs = Math.floor(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return (
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' +
    String(millis).padStart(3, '0')
  );
}

// Formata delta em milissegundos com sinal e 3 casas.
//   formatDelta(124)   → '+0.124'
//   formatDelta(-89)   → '-0.089'
//   formatDelta(null)  → '----'
export function formatDelta(ms) {
  if (ms == null || !isFinite(ms)) return '----';
  const sign = ms >= 0 ? '+' : '-';
  const abs = Math.abs(ms);
  const seconds = Math.floor(abs / 1000);
  const millis = Math.floor(abs % 1000);
  return sign + seconds + '.' + String(millis).padStart(3, '0');
}
