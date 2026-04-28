// Persistência do TrackData (control points + width + curbWidth + tension + closed + gates)
// no localStorage. Edições via TrackEditor são salvas aqui e carregadas no
// próximo Game.constructor.

const SCHEMA_VERSION = 1;
const KEY = (trackId) => `drift-game:track:${trackId}`;

// Retorna trackData salvo ou null se não houver / schema incompatível.
export function loadTrackData(trackId) {
  try {
    const raw = localStorage.getItem(KEY(trackId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.v !== SCHEMA_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

// Salva trackData. Best-effort — ignora erros (modo privado, quota cheia).
export function saveTrackData(trackId, data) {
  try {
    const payload = {
      v: SCHEMA_VERSION,
      data,
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY(trackId), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearTrackData(trackId) {
  try { localStorage.removeItem(KEY(trackId)); } catch {}
}
