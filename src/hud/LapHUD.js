// HUD de voltas — Fases 2-6: counter, current time, best, last, sector splits,
// INVALID badge, flash em personal best.
//
// Padrão idêntico ao TuningUI/HUDManager: constructor → bind() cria DOM e
// injeta CSS, update(lapSystem, now) faz polling no game loop.

import { formatTime, formatDelta } from '../track/lapUtils.js';

const STYLE_ID = 'lap-hud-style';

const CSS = `
.lap-hud {
  position: fixed;
  top: 88px;
  left: 24px;
  min-width: 240px;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.55);
  border-left: 3px solid #ff2a6d;
  border-radius: 4px;
  color: #e5e7eb;
  font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
  pointer-events: none;
  z-index: 50;
  display: none;
}
.lap-hud.visible { display: block; }
.lap-hud .lap-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.lap-hud .lap-counter {
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  color: #ff2a6d;
}
.lap-hud .lap-invalid {
  font-size: 0.7rem;
  color: #ff5f5f;
  background: rgba(255, 95, 95, 0.18);
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.1em;
  display: none;
}
.lap-hud .lap-invalid.show { display: inline; }
.lap-hud .lap-time {
  font-size: 1.7rem;
  color: #ffd700;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  margin: 2px 0;
  transition: color 0.3s;
}
.lap-hud .lap-time.invalid { color: #ff5f5f; text-decoration: line-through; }
.lap-hud .lap-time.pb-flash {
  animation: lap-pb-flash 1.6s ease-out;
}
@keyframes lap-pb-flash {
  0%   { color: #fff; text-shadow: 0 0 16px #ffd700, 0 0 32px #ffd700; transform: scale(1.06); }
  60%  { color: #ffd700; text-shadow: 0 0 8px #ffd700; }
  100% { color: #ffd700; text-shadow: none; transform: scale(1); }
}
.lap-hud .lap-sectors {
  display: flex;
  gap: 6px;
  font-size: 0.78rem;
  margin: 4px 0 6px;
}
.lap-hud .lap-sectors .sector {
  flex: 1;
  padding: 2px 4px;
  background: rgba(255,255,255,0.05);
  border-radius: 2px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.lap-hud .lap-sectors .sector.ahead  { color: #5fff8e; }
.lap-hud .lap-sectors .sector.behind { color: #ff5f5f; }
.lap-hud .lap-sectors .sector.pending { color: #6b6b6b; }
.lap-hud .lap-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.78rem;
  color: #b8b8b8;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
}
.lap-hud .lap-meta .label { color: #888; margin-right: 6px; }
.lap-hud .lap-meta .invalid-mark { color: #ff5f5f; margin-left: 4px; font-size: 0.7em; }
.lap-hud .lap-status {
  font-size: 0.7rem;
  color: #9b9b9b;
  margin-top: 4px;
  letter-spacing: 0.05em;
}
`;

export class LapHUD {
  constructor() {
    this.root = null;
    this._lastLapNumberFlashed = -1;
  }

  bind() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const root = document.createElement('div');
    root.className = 'lap-hud';
    root.innerHTML = `
      <div class="lap-row">
        <div class="lap-counter">LAP --</div>
        <div class="lap-invalid">INVALID</div>
      </div>
      <div class="lap-time">--:--.---</div>
      <div class="lap-sectors">
        <div class="sector pending">S1 ----</div>
        <div class="sector pending">S2 ----</div>
        <div class="sector pending">S3 ----</div>
      </div>
      <div class="lap-meta">
        <div><span class="label">Best</span><span class="best-time">--:--.---</span></div>
        <div><span class="label">Last</span><span class="last-time">--:--.---</span><span class="invalid-mark"></span></div>
      </div>
      <div class="lap-status">aguardando volta</div>
    `;
    document.body.appendChild(root);

    this.root = root;
    this.elCounter = root.querySelector('.lap-counter');
    this.elInvalid = root.querySelector('.lap-invalid');
    this.elTime = root.querySelector('.lap-time');
    this.elSectors = Array.from(root.querySelectorAll('.lap-sectors .sector'));
    this.elBest = root.querySelector('.best-time');
    this.elLast = root.querySelector('.last-time');
    this.elLastInvalidMark = root.querySelector('.invalid-mark');
    this.elStatus = root.querySelector('.lap-status');
    return this;
  }

  show() { if (this.root) this.root.classList.add('visible'); }
  hide() { if (this.root) this.root.classList.remove('visible'); }

  // Chamado quando event.type === 'lap_complete'. Faz flash dourado se PB.
  flashLap(event) {
    if (!this.elTime) return;
    if (event?.isPersonalBest && event.lap.lapNumber !== this._lastLapNumberFlashed) {
      this._lastLapNumberFlashed = event.lap.lapNumber;
      this.elTime.classList.remove('pb-flash');
      void this.elTime.offsetWidth;  // force reflow pra reiniciar animação
      this.elTime.classList.add('pb-flash');
    }
  }

  // Renderiza estado atual do LapSystem. Chamado todo frame.
  update(lapSystem, now) {
    if (!this.root || !lapSystem) return;

    const lap = lapSystem.getCurrentLap();
    const isPre = lapSystem.isPreLap();
    const isValid = lapSystem.isCurrentValid();

    this.elCounter.textContent = isPre ? 'LAP --' : `LAP ${lap}`;
    this.elInvalid.classList.toggle('show', !isPre && !isValid);

    const t = lapSystem.getCurrentLapTime(now);
    this.elTime.textContent = formatTime(t);
    this.elTime.classList.toggle('invalid', !isPre && !isValid);

    // Sectors — mostra splits da volta atual + pendentes
    const splits = lapSystem.getCurrentSplits();
    for (let i = 0; i < this.elSectors.length; i++) {
      const el = this.elSectors[i];
      const split = splits[i];
      if (split == null) {
        el.textContent = `S${i + 1} ----`;
        el.className = 'sector pending';
      } else if (split.deltaMs == null) {
        el.textContent = `S${i + 1} ${formatTime(split.timeMs)}`;
        el.className = 'sector pending';
      } else {
        el.textContent = `S${i + 1} ${formatDelta(split.deltaMs)}`;
        el.className = `sector ${split.deltaMs < 0 ? 'ahead' : 'behind'}`;
      }
    }

    // Best / Last
    const best = lapSystem.getBestLap();
    this.elBest.textContent = best ? formatTime(best.totalMs) : '--:--.---';

    const last = lapSystem.getLastLap();
    this.elLast.textContent = last ? formatTime(last.totalMs) : '--:--.---';
    this.elLastInvalidMark.textContent = (last && !last.valid) ? '(invalid)' : '';

    // Status
    if (isPre) {
      this.elStatus.textContent = 'cruze a linha pra começar';
    } else {
      const sec = lapSystem.getCurrentSector();
      this.elStatus.textContent = `sector ${sec + 1} / ${lapSystem.numSectors}`;
    }
  }
}
