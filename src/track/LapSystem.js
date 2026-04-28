// Sistema de voltas — não conhece geometria 3D. Consome gates 2D no plano XZ
// + posição do carro a cada frame. Reusável em qualquer pista.
//
// Capacidades (após Fases 2-5):
//   - cruzamento de gate (segment-segment 2D + direction check)
//   - advance de sector na ordem
//   - lap counter + tempo da volta atual
//   - best lap, last lap, best sectors (theoretical best)
//   - sector splits (delta vs best por sector concluído)
//   - track-cut detection (4 rodas off-track por > debounce → invalida volta)
//   - persistência via callbacks externos (ver Game.js)

import { segmentIntersectsGate } from './lapUtils.js';

const OFFTRACK_DEBOUNCE_FRAMES = 6;  // ~100ms @ 60fps antes de invalidar volta

export class LapSystem {
  // gates = array ordenado por arc-length; gates[0] tem isStartFinish=true.
  // opts.minLapTimeMs — backstop anti-glitch (default 8000)
  // opts.initialStats — { bestLap, bestSectors } pra hidratar do localStorage
  constructor(gates, opts = {}) {
    if (!Array.isArray(gates) || gates.length === 0) {
      throw new Error('LapSystem: gates obrigatório (array não-vazio)');
    }
    this.gates = gates;
    this.numSectors = gates.length;
    this.minLapTimeMs = opts.minLapTimeMs ?? 8000;

    // Stats persistentes — sobrevivem a reset(), só zeram via clearAllStats()
    this.bestLap = opts.initialStats?.bestLap ?? null;
    this.bestSectors = opts.initialStats?.bestSectors?.length === gates.length
      ? [...opts.initialStats.bestSectors]
      : new Array(gates.length).fill(null);
    this.lastLap = null;

    this._reset();
  }

  reset() { this._reset(); }

  // Apaga TUDO (best lap + best sectors). Não tem hotkey por padrão — chamado
  // só via console ou opção explícita.
  clearAllStats() {
    this.bestLap = null;
    this.bestSectors = new Array(this.numSectors).fill(null);
    this.lastLap = null;
  }

  _reset() {
    this.currentLap = 0;
    this.currentSector = 0;
    this.lapStartMs = null;
    this.sectorStartMs = null;
    this.currentSectorTimes = [];     // splits do sector i da volta atual (ms)
    this.lapHistory = [];
    this._prevPos = null;
    this.isCurrentLapValid = true;
    this._offTrackFrames = 0;
  }

  // Chamado pelo Game.loop após car.update().
  // wheels (opcional) = car.wheels — se passado, faz track-cut detection.
  update(now, carPos, wheels = null) {
    if (!this._prevPos) {
      this._prevPos = { x: carPos.x, z: carPos.z };
      return null;
    }

    // ---- Track-cut detection (Fase 5)
    if (wheels && this.lapStartMs != null) {
      const allOff = wheels.every(w => w.currentSurface === 'grass');
      if (allOff) {
        this._offTrackFrames++;
        if (this._offTrackFrames > OFFTRACK_DEBOUNCE_FRAMES) {
          this.isCurrentLapValid = false;
        }
      } else {
        this._offTrackFrames = 0;
      }
    }

    // ---- Cruzamento de gate
    let event = null;
    const expected = this.gates[this.currentSector];
    if (segmentIntersectsGate(this._prevPos, carPos, expected)) {
      event = this._onGateCrossed(now);
    }

    this._prevPos.x = carPos.x;
    this._prevPos.z = carPos.z;
    return event;
  }

  _onGateCrossed(now) {
    const gate = this.gates[this.currentSector];

    // Caso 1: cruzou start/finish E já tinha começado uma volta — completa.
    if (gate.isStartFinish && this.lapStartMs != null) {
      const totalMs = now - this.lapStartMs;
      if (totalMs >= this.minLapTimeMs) {
        // Push tempo do último sector
        const lastSectorMs = now - this.sectorStartMs;
        this.currentSectorTimes.push(lastSectorMs);

        const lap = {
          lapNumber: this.currentLap,
          totalMs,
          sectors: [...this.currentSectorTimes],
          valid: this.isCurrentLapValid,
        };
        this.lapHistory.push(lap);
        this.lastLap = lap;

        // Atualizar best (apenas voltas válidas)
        let isPersonalBest = false;
        if (lap.valid) {
          if (!this.bestLap || lap.totalMs < this.bestLap.totalMs) {
            this.bestLap = lap;
            isPersonalBest = true;
          }
          // Best sectors (theoretical best — independente da volta total)
          for (let i = 0; i < this.numSectors; i++) {
            const s = lap.sectors[i];
            if (s != null && (this.bestSectors[i] == null || s < this.bestSectors[i])) {
              this.bestSectors[i] = s;
            }
          }
        }

        this._advanceLap(now);
        return { type: 'lap_complete', lap, isPersonalBest };
      }
      return null;  // < minLapTime: ignora
    }

    // Caso 2: cruzou start/finish pela primeira vez (volta de aquecimento)
    if (gate.isStartFinish && this.lapStartMs == null) {
      this._advanceLap(now);
      return { type: 'sector', sector: 0, gateName: gate.name };
    }

    // Caso 3: setor intermediário — push split, advance.
    const sectorMs = now - this.sectorStartMs;
    this.currentSectorTimes.push(sectorMs);
    this.sectorStartMs = now;
    this.currentSector = (this.currentSector + 1) % this.numSectors;

    // Delta vs best sector (pra HUD mostrar +/-)
    const sectorIdx = this.currentSectorTimes.length - 1;
    const bestForThis = this.bestSectors[sectorIdx];
    const delta = bestForThis != null ? sectorMs - bestForThis : null;

    return {
      type: 'sector',
      sector: this.currentSector,
      gateName: gate.name,
      sectorTimeMs: sectorMs,
      sectorIdx,
      deltaMs: delta,
    };
  }

  _advanceLap(now) {
    this.lapStartMs = now;
    this.sectorStartMs = now;
    this.currentLap++;
    this.currentSector = (this.currentSector + 1) % this.numSectors;
    this.currentSectorTimes = [];
    this.isCurrentLapValid = true;
    this._offTrackFrames = 0;
  }

  // ----- API consumida pelo HUD (polling) -----

  getCurrentLapTime(now) {
    if (this.lapStartMs == null) return 0;
    return now - this.lapStartMs;
  }

  getCurrentSectorTime(now) {
    if (this.sectorStartMs == null) return 0;
    return now - this.sectorStartMs;
  }

  getCurrentLap()    { return this.currentLap; }
  getCurrentSector() { return this.currentSector; }
  getBestLap()       { return this.bestLap; }
  getLastLap()       { return this.lastLap; }
  getBestSectors()   { return this.bestSectors; }
  getLapHistory()    { return this.lapHistory; }
  isCurrentValid()   { return this.isCurrentLapValid; }
  isPreLap()         { return this.lapStartMs == null; }

  // Splits da volta atual com delta vs best — pra HUD renderizar S1 +0.124, S2 ----, etc.
  getCurrentSplits() {
    return this.currentSectorTimes.map((ms, i) => ({
      sectorIdx: i,
      timeMs: ms,
      deltaMs: this.bestSectors[i] != null ? ms - this.bestSectors[i] : null,
    }));
  }
}
