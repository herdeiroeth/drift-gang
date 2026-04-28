// Persistência de stats de voltas em localStorage. Schema simples e versionado
// — se mudarmos formato no futuro, bump SCHEMA_VERSION e adicionar migração.

const SCHEMA_VERSION = 1;
const KEY = (trackId) => `drift-game:laps:${trackId}`;

// Carrega stats salvos (best lap + best sectors) ou null se não houver.
// Returns: { bestLap: { lapNumber, totalMs, sectors }, bestSectors: [...] } | null
export function loadLapStats(trackId) {
  try {
    const raw = localStorage.getItem(KEY(trackId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.v !== SCHEMA_VERSION) return null;  // versão incompatível
    return {
      bestLap: parsed.bestLap ?? null,
      bestSectors: Array.isArray(parsed.bestSectors) ? parsed.bestSectors : [],
    };
  } catch {
    return null;
  }
}

// Salva stats. Best-effort — ignora QuotaExceededError e privates.
export function saveLapStats(trackId, stats) {
  try {
    const payload = {
      v: SCHEMA_VERSION,
      bestLap: stats.bestLap ?? null,
      bestSectors: stats.bestSectors ?? [],
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY(trackId), JSON.stringify(payload));
  } catch {
    // localStorage indisponível (modo privado, quota cheia) — silencioso.
  }
}

export function clearLapStats(trackId) {
  try { localStorage.removeItem(KEY(trackId)); } catch {}
}
