/**
 * Telemetry — overlay HUD em tempo real para tunar a física do drift.
 *
 * Ferramenta de dev/debug: mostra speed, steer input, yaw rate, e uma tabela
 * 4×4 (FL/FR/RL/RR × slipAngle/slipRatio/Fy/Fz) + um gráfico canvas de slip
 * angle das rodas traseiras nos últimos ~3s.
 *
 * Toggleável via método `toggle()` (wired pra tecla H em Game.js). Visível
 * por padrão. Performance-conscious: textContent (não innerHTML) nos updates,
 * canvas de 240×60 com ~180 samples.
 *
 * Não toca em código de física. Lê só campos públicos do Car/Wheel.
 */

const RAD2DEG = 180 / Math.PI;
const MS2KMH = 3.6;

const GRAPH_W = 240;
const GRAPH_H = 60;
const GRAPH_SAMPLES = 180;          // ~3s a 60fps
const GRAPH_RANGE_DEG = 45;          // eixo Y: -45° a +45°

const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

export class Telemetry {
  constructor() {
    // ---- root overlay
    const root = document.createElement('div');
    root.id = 'telemetry-overlay';
    root.style.cssText = [
      'position:absolute',
      'top:8px',
      'left:calc(100vw - 320px)',
      'font-family:ui-monospace,Menlo,Consolas,monospace',
      'font-size:11px',
      'line-height:1.35',
      'background:rgba(0,0,0,0.65)',
      'color:#4ade80',
      'padding:8px',
      'border-radius:4px',
      'pointer-events:auto',
      'z-index:1000',
      'min-width:280px',
      'user-select:none',
      'touch-action:none',
    ].join(';');

    // ---- header (drag handle)
    const header = document.createElement('div');
    header.textContent = '⠿ TELEMETRY (H to toggle)';
    header.style.cssText = 'font-weight:bold;color:#a7f3d0;margin-bottom:6px;border-bottom:1px solid #14532d;padding-bottom:4px;cursor:move';
    root.appendChild(header);
    this._wireDrag(root, header);

    // ---- speed
    root.appendChild(this._makeRow('Speed', (this.elSpeed = document.createElement('span')), 'km/h'));

    // ---- steer (label + bar + value)
    const steerWrap = document.createElement('div');
    steerWrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px';
    const steerLabel = document.createElement('span');
    steerLabel.textContent = 'Steer';
    steerLabel.style.cssText = 'min-width:46px;color:#86efac';
    steerWrap.appendChild(steerLabel);

    // bar background (full width = ±1)
    const barBg = document.createElement('div');
    barBg.style.cssText = 'position:relative;flex:1;height:10px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.35);border-radius:2px;overflow:hidden';
    // center tick
    const centerTick = document.createElement('div');
    centerTick.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(167,243,208,0.6)';
    barBg.appendChild(centerTick);
    // fill — anchored to center, extending left or right via transform
    const barFill = document.createElement('div');
    barFill.style.cssText = 'position:absolute;left:50%;top:1px;bottom:1px;width:0;background:#4ade80;transform-origin:left center;transition:none';
    barBg.appendChild(barFill);
    this.elSteerBar = barFill;
    steerWrap.appendChild(barBg);

    this.elSteer = document.createElement('span');
    this.elSteer.style.cssText = 'min-width:46px;text-align:right;color:#d1fae5';
    this.elSteer.textContent = '0.00';
    steerWrap.appendChild(this.elSteer);
    root.appendChild(steerWrap);

    // ---- yaw rate
    root.appendChild(this._makeRow('YawRate', (this.elYaw = document.createElement('span')), '°/s'));

    // ---- wheel table
    const table = document.createElement('div');
    table.style.cssText = 'display:grid;grid-template-columns:32px 1fr 1fr 1fr 1fr;gap:2px 6px;margin-top:6px;font-size:10.5px';
    // header row
    ['', 'SlipA°', 'SlipR%', 'Fy(N)', 'Fz(N)'].forEach((h, i) => {
      const c = document.createElement('div');
      c.textContent = h;
      c.style.cssText = 'color:#a7f3d0;text-align:' + (i === 0 ? 'left' : 'right') + ';font-weight:bold';
      table.appendChild(c);
    });

    // 4 wheel rows × 4 metric cells
    this.elWheels = [];                  // [{slipA, slipR, fy, fz}, ...]
    for (let i = 0; i < 4; i++) {
      const lab = document.createElement('div');
      lab.textContent = WHEEL_LABELS[i];
      lab.style.cssText = 'color:#86efac;font-weight:bold';
      table.appendChild(lab);

      const slipA = document.createElement('div'); slipA.style.textAlign = 'right'; slipA.textContent = '0.0';
      const slipR = document.createElement('div'); slipR.style.textAlign = 'right'; slipR.textContent = '0.0';
      const fy    = document.createElement('div'); fy.style.textAlign    = 'right'; fy.textContent    = '0';
      const fz    = document.createElement('div'); fz.style.textAlign    = 'right'; fz.textContent    = '0';
      table.appendChild(slipA);
      table.appendChild(slipR);
      table.appendChild(fy);
      table.appendChild(fz);
      this.elWheels.push({ slipA, slipR, fy, fz });
    }
    root.appendChild(table);

    // ---- graph: rear slip angles (RL red, RR blue)
    const graphLegend = document.createElement('div');
    graphLegend.style.cssText = 'margin-top:6px;font-size:10px;color:#a7f3d0;display:flex;gap:10px';
    graphLegend.innerHTML = '<span>Rear SlipA (±45°)</span>'
      + '<span style="color:#f87171">— RL</span>'
      + '<span style="color:#60a5fa">— RR</span>';
    root.appendChild(graphLegend);

    const canvas = document.createElement('canvas');
    canvas.width = GRAPH_W;
    canvas.height = GRAPH_H;
    canvas.style.cssText = 'display:block;margin-top:2px;background:rgba(0,0,0,0.4);border:1px solid rgba(74,222,128,0.25);border-radius:2px;width:' + GRAPH_W + 'px;height:' + GRAPH_H + 'px';
    root.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // ring buffers para slip angle (em graus) das rodas traseiras
    this.bufRL = new Float32Array(GRAPH_SAMPLES);
    this.bufRR = new Float32Array(GRAPH_SAMPLES);
    this.bufHead = 0;            // próximo index a escrever
    this.bufFilled = 0;          // quantas amostras válidas

    document.body.appendChild(root);
    this.root = root;
    this.visible = true;
    this._restorePosition(root);
  }

  _wireDrag(root, handle) {
    let dragging = false;
    let offX = 0;
    let offY = 0;

    const onDown = (ev) => {
      dragging = true;
      const rect = root.getBoundingClientRect();
      const px = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const py = ev.touches ? ev.touches[0].clientY : ev.clientY;
      offX = px - rect.left;
      offY = py - rect.top;
      root.style.right = 'auto';
      root.style.transition = 'none';
      ev.preventDefault();
    };

    const onMove = (ev) => {
      if (!dragging) return;
      const px = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const py = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const maxX = window.innerWidth - root.offsetWidth;
      const maxY = window.innerHeight - root.offsetHeight;
      const x = Math.max(0, Math.min(maxX, px - offX));
      const y = Math.max(0, Math.min(maxY, py - offY));
      root.style.left = x + 'px';
      root.style.top = y + 'px';
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem('drift-game:telemetry:pos', JSON.stringify({
          left: root.style.left,
          top: root.style.top,
        }));
      } catch (_) { /* storage indisponível */ }
    };

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  _restorePosition(root) {
    try {
      const raw = localStorage.getItem('drift-game:telemetry:pos');
      if (!raw) return;
      const { left, top } = JSON.parse(raw);
      if (typeof left === 'string' && typeof top === 'string') {
        root.style.left = left;
        root.style.top = top;
        root.style.right = 'auto';
      }
    } catch (_) { /* ignora */ }
  }

  /**
   * Linha label/valor/unit padrão. Retorna o div pra dar append.
   * O `valueEl` é guardado pelo caller (atualiza textContent depois).
   */
  _makeRow(label, valueEl, unit) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px';

    const lab = document.createElement('span');
    lab.textContent = label;
    lab.style.cssText = 'min-width:46px;color:#86efac';
    row.appendChild(lab);

    valueEl.style.cssText = 'flex:1;text-align:right;color:#d1fae5';
    valueEl.textContent = '0.0';
    row.appendChild(valueEl);

    if (unit) {
      const u = document.createElement('span');
      u.textContent = unit;
      u.style.cssText = 'min-width:32px;color:#6ee7b7;font-size:10px';
      row.appendChild(u);
    }
    return row;
  }

  /**
   * Atualiza todos os displays. Chamar uma vez por frame, DEPOIS do car.doPhysics().
   * Skip silencioso quando invisible — economiza redraws inúteis.
   */
  update(car) {
    if (!this.visible || !car) return;

    // ---- speed
    const kmh = (car.absVel || 0) * MS2KMH;
    this.elSpeed.textContent = kmh.toFixed(1);

    // ---- steer (-1..1)
    const steer = car.steer || 0;
    this.elSteer.textContent = (steer >= 0 ? '+' : '') + steer.toFixed(2);
    // bar fill: largura = |steer| * 50%, transform pra esquerda quando negativo
    const halfPct = Math.min(1, Math.abs(steer)) * 50;
    if (steer >= 0) {
      this.elSteerBar.style.transform = 'translateX(0)';
    } else {
      this.elSteerBar.style.transform = 'translateX(-' + halfPct + '%)';
    }
    this.elSteerBar.style.width = halfPct + '%';

    // ---- yaw rate (rad/s → °/s)
    const yawDeg = (car.yawRate || 0) * RAD2DEG;
    this.elYaw.textContent = (yawDeg >= 0 ? '+' : '') + yawDeg.toFixed(1);

    // ---- per-wheel
    const wheels = car.wheels || [];
    for (let i = 0; i < 4 && i < wheels.length; i++) {
      const w = wheels[i];
      if (!w) continue;
      const cells = this.elWheels[i];
      cells.slipA.textContent = ((w.slipAngle || 0) * RAD2DEG).toFixed(1);
      cells.slipR.textContent = ((w.slipRatio || 0) * 100).toFixed(1);
      cells.fy.textContent    = (w.lateralForce || 0).toFixed(0);
      cells.fz.textContent    = (w.normalLoad || 0).toFixed(0);
    }

    // ---- graph buffers (rear: RL=2, RR=3)
    const rl = wheels[2], rr = wheels[3];
    const slipRL = rl ? (rl.slipAngle || 0) * RAD2DEG : 0;
    const slipRR = rr ? (rr.slipAngle || 0) * RAD2DEG : 0;
    this.bufRL[this.bufHead] = slipRL;
    this.bufRR[this.bufHead] = slipRR;
    this.bufHead = (this.bufHead + 1) % GRAPH_SAMPLES;
    if (this.bufFilled < GRAPH_SAMPLES) this.bufFilled++;

    this._drawGraph();
  }

  _drawGraph() {
    const ctx = this.ctx;
    const w = GRAPH_W;
    const h = GRAPH_H;
    const halfH = h / 2;

    ctx.clearRect(0, 0, w, h);

    // zero line
    ctx.strokeStyle = 'rgba(167,243,208,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(w, halfH);
    ctx.stroke();

    if (this.bufFilled < 2) return;

    const n = this.bufFilled;
    // oldest sample index in buffer:
    const start = (this.bufHead - n + GRAPH_SAMPLES) % GRAPH_SAMPLES;
    const xStep = w / (GRAPH_SAMPLES - 1);
    // tail x para que samples velhos fiquem à esquerda e o mais novo na direita
    const xOffset = w - (n - 1) * xStep;

    const drawSeries = (buf, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const idx = (start + i) % GRAPH_SAMPLES;
        const v = buf[idx];
        // clamp pro range do gráfico
        const clamped = Math.max(-GRAPH_RANGE_DEG, Math.min(GRAPH_RANGE_DEG, v));
        const x = xOffset + i * xStep;
        const y = halfH - (clamped / GRAPH_RANGE_DEG) * (halfH - 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawSeries(this.bufRL, '#f87171');   // red
    drawSeries(this.bufRR, '#60a5fa');   // blue
  }

  toggle() {
    this.setVisible(!this.visible);
  }

  setVisible(v) {
    this.visible = !!v;
    this.root.style.display = this.visible ? 'block' : 'none';
  }
}
