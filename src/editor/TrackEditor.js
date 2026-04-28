// Editor 2D top-down de pistas. Overlay full-screen ativado por tecla M.
//
// Interação:
//   - Click esquerdo em vazio: adiciona control point no fim da spline
//   - Click esquerdo em ponto + drag: move ponto
//   - Right-click em ponto: deleta
//   - Shift + drag: pan da câmera (worldview)
//   - Wheel: zoom in/out
//   - Tecla Z: undo
//   - Tecla S: save & reload
//   - Tecla Esc: fecha sem salvar
//   - Tecla C: toggle closed
//
// Salva via trackStorage. Game.rebuildTrack reconstrói a pista 3D.

import * as THREE from 'three';
import { saveTrackData, clearTrackData } from '../track/trackStorage.js';

const STYLE_ID = 'track-editor-style';

const CSS = `
.track-editor {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.92);
  z-index: 1000;
  display: none;
  font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
  color: #e5e7eb;
}
.track-editor.visible { display: flex; }
.te-canvas-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.te-canvas {
  display: block;
  cursor: crosshair;
  background: #0a0a0f;
}
.te-toolbar {
  width: 280px;
  padding: 18px 18px 12px;
  background: rgba(15, 15, 22, 0.97);
  border-left: 2px solid #ff2a6d;
  overflow-y: auto;
}
.te-toolbar h2 {
  font-size: 0.95rem;
  letter-spacing: 0.12em;
  margin: 0 0 14px;
  color: #ff2a6d;
}
.te-toolbar h3 {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  color: #9b9b9b;
  margin: 18px 0 6px;
  text-transform: uppercase;
}
.te-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 0.78rem; }
.te-row label { flex: 1; color: #b8b8b8; }
.te-row input[type="number"], .te-row input[type="range"] {
  flex: 1.4;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e5e7eb;
  padding: 3px 6px;
  font-family: inherit;
  font-size: 0.78rem;
}
.te-row .val { color: #ffd700; min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; }
.te-toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.8rem; color: #b8b8b8; margin: 6px 0;
  cursor: pointer; user-select: none;
}
.te-toggle input { accent-color: #ff2a6d; }
.te-btn {
  display: block; width: 100%;
  padding: 8px 10px;
  margin: 4px 0;
  background: rgba(255, 42, 109, 0.15);
  color: #e5e7eb;
  border: 1px solid #ff2a6d;
  border-radius: 3px;
  font-family: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: background 0.12s;
}
.te-btn:hover { background: rgba(255, 42, 109, 0.35); }
.te-btn.te-btn-secondary {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.2);
}
.te-btn.te-btn-secondary:hover { background: rgba(255,255,255,0.10); }
.te-btn.te-btn-danger {
  background: rgba(255, 95, 95, 0.12);
  border-color: #ff5f5f;
}
.te-status {
  position: absolute;
  bottom: 12px;
  left: 12px;
  font-size: 0.72rem;
  color: #888;
  background: rgba(0,0,0,0.4);
  padding: 6px 10px;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.te-help {
  position: absolute;
  top: 12px;
  left: 12px;
  font-size: 0.7rem;
  color: #888;
  background: rgba(0,0,0,0.4);
  padding: 8px 12px;
  border-radius: 3px;
  pointer-events: none;
  line-height: 1.6;
}
.te-help kbd {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 2px;
  padding: 0 4px;
  font-size: 0.66rem;
  font-family: inherit;
  color: #ffd700;
}
`;

export class TrackEditor {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.trackData = null;
    this.zoom = 3.0;          // px per meter
    this.pan = { x: 0, z: 0 };
    this.selectedIdx = -1;
    this.draggingIdx = -1;
    this.history = [];
    this._panMode = false;
    this._panStart = null;
    this._mouseWorld = { x: 0, z: 0 };
  }

  bind() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const root = document.createElement('div');
    root.className = 'track-editor';
    root.innerHTML = `
      <div class="te-canvas-wrap">
        <canvas class="te-canvas"></canvas>
        <div class="te-help">
          <kbd>click</kbd> add point &nbsp; <kbd>drag</kbd> move &nbsp; <kbd>R-click</kbd> delete<br>
          <kbd>shift+drag</kbd> pan &nbsp; <kbd>wheel</kbd> zoom<br>
          <kbd>Z</kbd> undo &nbsp; <kbd>C</kbd> closed &nbsp; <kbd>S</kbd> save &nbsp; <kbd>Esc</kbd> close
        </div>
        <div class="te-status"></div>
      </div>
      <div class="te-toolbar">
        <h2>TRACK EDITOR</h2>

        <h3>Geometry</h3>
        <div class="te-row">
          <label>Width</label>
          <input type="range" data-prop="width" min="4" max="20" step="0.5">
          <span class="val" data-val="width">12.0</span>
        </div>
        <div class="te-row">
          <label>Curb width</label>
          <input type="range" data-prop="curbWidth" min="0" max="2" step="0.1">
          <span class="val" data-val="curbWidth">0.8</span>
        </div>
        <div class="te-row">
          <label>Tension</label>
          <input type="range" data-prop="tension" min="0" max="1" step="0.05">
          <span class="val" data-val="tension">0.50</span>
        </div>
        <div class="te-row">
          <label>Terrain margin</label>
          <input type="range" data-prop="terrainMargin" min="50" max="400" step="10">
          <span class="val" data-val="terrainMargin">200</span>
        </div>
        <label class="te-toggle">
          <input type="checkbox" data-prop="closed"> Closed circuit
        </label>

        <h3>Stats</h3>
        <div class="te-row">
          <label>Points</label>
          <span class="val" data-stat="numPoints">0</span>
        </div>
        <div class="te-row">
          <label>Length</label>
          <span class="val" data-stat="length">0m</span>
        </div>

        <h3>Actions</h3>
        <button class="te-btn" data-action="save">Save &amp; Reload (S)</button>
        <button class="te-btn te-btn-secondary" data-action="export">Copy JSON</button>
        <button class="te-btn te-btn-secondary" data-action="reset-default">Reset to default</button>
        <button class="te-btn te-btn-danger" data-action="clear">Clear all points</button>
        <button class="te-btn te-btn-secondary" data-action="close">Close (Esc)</button>
      </div>
    `;
    document.body.appendChild(root);

    this.root = root;
    this.canvas = root.querySelector('.te-canvas');
    this.statusEl = root.querySelector('.te-status');
    this.ctx = this.canvas.getContext('2d');

    this._wireEvents();
    return this;
  }

  _wireEvents() {
    // Toolbar inputs
    this.root.querySelectorAll('input[data-prop]').forEach(el => {
      el.addEventListener('input', () => this._onPropChange(el));
    });
    this.root.querySelectorAll('button[data-action]').forEach(el => {
      el.addEventListener('click', () => this._onAction(el.dataset.action));
    });

    // Canvas events
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup',   (e) => this._onMouseUp(e));
    this.canvas.addEventListener('contextmenu', (e) => this._onContextMenu(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    // Keyboard (capturado no document só quando editor visível)
    document.addEventListener('keydown', (e) => this._onKeyDown(e));

    // Resize
    window.addEventListener('resize', () => { if (this.visible) this._resize(); });
  }

  open(trackData) {
    this.trackData = JSON.parse(JSON.stringify(trackData));  // deep copy
    this._normalizeTrackData();
    this.history = [];
    this.selectedIdx = -1;
    this.draggingIdx = -1;
    this.visible = true;
    this.root.classList.add('visible');
    this._syncToolbar();
    this._resize();
    this._render();
  }

  close() {
    this.visible = false;
    this.root.classList.remove('visible');
  }

  _normalizeTrackData() {
    const d = this.trackData;
    d.controlPoints = d.controlPoints ?? [];
    d.width        = d.width ?? 12;
    d.curbWidth    = d.curbWidth ?? 0.8;
    d.tension      = d.tension ?? 0.5;
    d.terrainMargin = d.terrainMargin ?? 200;
    d.closed       = d.closed ?? true;
    d.gates        = d.gates ?? [
      { name: 'start',   t: 0.0,  isStartFinish: true },
      { name: 'sector1', t: 0.33 },
      { name: 'sector2', t: 0.66 },
    ];
    d.spawn = d.spawn ?? { arcLengthT: 0, headingOffset: 0, lateralOffset: 0 };
  }

  _resize() {
    const wrap = this.canvas.parentElement;
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;
  }

  // ---- Event handlers ----

  _onPropChange(el) {
    const prop = el.dataset.prop;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else value = parseFloat(el.value);
    this._pushHistory();
    this.trackData[prop] = value;
    this._syncToolbar();
    this._render();
  }

  _onAction(action) {
    switch (action) {
      case 'save':          this._saveAndReload(); break;
      case 'export':        this._exportJSON(); break;
      case 'reset-default': this._resetToDefault(); break;
      case 'clear':         this._clearAll(); break;
      case 'close':         this.close(); break;
    }
  }

  _onMouseDown(e) {
    if (!this.visible) return;
    e.preventDefault();
    const w = this._mouseToWorld(e);

    if (e.shiftKey || e.button === 1) {
      // pan
      this._panMode = true;
      this._panStart = { sx: e.clientX, sy: e.clientY, panX: this.pan.x, panZ: this.pan.z };
      return;
    }

    if (e.button === 0) {
      const idx = this._findPointAt(w.x, w.z);
      if (idx >= 0) {
        this.selectedIdx = idx;
        this.draggingIdx = idx;
        this._pushHistory();
      } else {
        // Adiciona ponto novo no fim
        this._pushHistory();
        this.trackData.controlPoints.push({ x: w.x, z: w.z });
        this.selectedIdx = this.trackData.controlPoints.length - 1;
        this.draggingIdx = this.selectedIdx;
      }
      this._render();
    }
  }

  _onMouseMove(e) {
    if (!this.visible) return;
    const w = this._mouseToWorld(e);
    this._mouseWorld = w;
    this._updateStatus();

    if (this._panMode && this._panStart) {
      const dx = (e.clientX - this._panStart.sx) / this.zoom;
      const dz = (e.clientY - this._panStart.sy) / this.zoom;
      this.pan.x = this._panStart.panX - dx;
      this.pan.z = this._panStart.panZ + dz;  // tela Y+ = mundo Z-
      this._render();
      return;
    }

    if (this.draggingIdx >= 0) {
      const p = this.trackData.controlPoints[this.draggingIdx];
      // Snap a 0.5m com Alt
      if (e.altKey) {
        p.x = Math.round(w.x * 2) / 2;
        p.z = Math.round(w.z * 2) / 2;
      } else {
        p.x = w.x;
        p.z = w.z;
      }
      this._render();
    }
  }

  _onMouseUp(_e) {
    if (!this.visible) return;
    this._panMode = false;
    this._panStart = null;
    this.draggingIdx = -1;
  }

  _onContextMenu(e) {
    if (!this.visible) return;
    e.preventDefault();
    const w = this._mouseToWorld(e);
    const idx = this._findPointAt(w.x, w.z);
    if (idx >= 0 && this.trackData.controlPoints.length > 1) {
      this._pushHistory();
      this.trackData.controlPoints.splice(idx, 1);
      if (this.selectedIdx === idx) this.selectedIdx = -1;
      else if (this.selectedIdx > idx) this.selectedIdx--;
      this._render();
    }
  }

  _onWheel(e) {
    if (!this.visible) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    // Zoom centrado no mouse
    const w0 = this._mouseToWorld(e);
    this.zoom = Math.max(0.4, Math.min(30, this.zoom * factor));
    const w1 = this._mouseToWorld(e);
    this.pan.x += w0.x - w1.x;
    this.pan.z += w0.z - w1.z;
    this._render();
  }

  _onKeyDown(e) {
    if (!this.visible) return;
    if (e.key === 'Escape')  { this.close(); }
    else if (e.key === 'z' || e.key === 'Z') { this._undo(); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); this._saveAndReload(); }
    else if (e.key === 'c' || e.key === 'C') { this._toggleClosed(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedIdx >= 0 && this.trackData.controlPoints.length > 1) {
        this._pushHistory();
        this.trackData.controlPoints.splice(this.selectedIdx, 1);
        this.selectedIdx = -1;
        this._render();
      }
    }
  }

  // ---- Utilities ----

  _mouseToWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return this._screenToWorld(sx, sy);
  }

  _screenToWorld(sx, sy) {
    return {
      x: (sx - this.canvas.width / 2) / this.zoom + this.pan.x,
      z: -(sy - this.canvas.height / 2) / this.zoom + this.pan.z,
    };
  }

  _worldToScreen(wx, wz) {
    return {
      x: this.canvas.width / 2 + (wx - this.pan.x) * this.zoom,
      y: this.canvas.height / 2 - (wz - this.pan.z) * this.zoom,
    };
  }

  _findPointAt(wx, wz) {
    const HIT_RADIUS = Math.max(0.8, 8 / this.zoom);
    let best = -1, bestD = HIT_RADIUS * HIT_RADIUS;
    for (let i = 0; i < this.trackData.controlPoints.length; i++) {
      const p = this.trackData.controlPoints[i];
      const dx = p.x - wx, dz = p.z - wz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { best = i; bestD = d2; }
    }
    return best;
  }

  _pushHistory() {
    this.history.push(JSON.stringify(this.trackData));
    if (this.history.length > 50) this.history.shift();
  }

  _undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.trackData = JSON.parse(prev);
    this._normalizeTrackData();
    this._syncToolbar();
    this._render();
  }

  _toggleClosed() {
    this._pushHistory();
    this.trackData.closed = !this.trackData.closed;
    this._syncToolbar();
    this._render();
  }

  _resetToDefault() {
    if (!confirm('Resetar pra layout default? Perde edições não salvas.')) return;
    clearTrackData(this.trackData.id);
    this.game.rebuildTrackFromStorage(true);  // force default
    this.close();
  }

  _clearAll() {
    if (!confirm('Apagar todos os control points?')) return;
    this._pushHistory();
    this.trackData.controlPoints = [];
    this.selectedIdx = -1;
    this._render();
  }

  _exportJSON() {
    const txt = JSON.stringify(this.trackData, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(
        () => { this.statusEl.textContent = 'JSON copiado pro clipboard'; },
        () => { console.log(txt); this.statusEl.textContent = 'JSON impresso no console (clipboard falhou)'; },
      );
    } else {
      console.log(txt);
      this.statusEl.textContent = 'JSON impresso no console';
    }
  }

  _saveAndReload() {
    if (this.trackData.controlPoints.length < 4) {
      alert('Pista precisa de pelo menos 4 control points pra Catmull-Rom funcionar.');
      return;
    }
    saveTrackData(this.trackData.id, this.trackData);
    this.game.rebuildTrack(this.trackData);
    this.close();
  }

  _syncToolbar() {
    if (!this.trackData) return;
    this.root.querySelectorAll('input[data-prop]').forEach(el => {
      const p = el.dataset.prop;
      if (el.type === 'checkbox') el.checked = !!this.trackData[p];
      else el.value = this.trackData[p];
    });
    this.root.querySelectorAll('span[data-val]').forEach(el => {
      const p = el.dataset.val;
      const v = this.trackData[p];
      if (typeof v === 'number') {
        el.textContent = (p === 'tension') ? v.toFixed(2) : v.toString();
      }
    });
  }

  _updateStatus() {
    if (!this.trackData) return;
    const np = this.trackData.controlPoints.length;
    const lenStr = this._totalLengthM().toFixed(0);
    this.statusEl.textContent = `mouse: ${this._mouseWorld.x.toFixed(1)}, ${this._mouseWorld.z.toFixed(1)}  |  pts: ${np}  |  len: ${lenStr}m  |  zoom: ${this.zoom.toFixed(1)}px/m  |  ${this.trackData.closed ? 'CLOSED' : 'OPEN'}`;

    // Stats no toolbar
    const elN = this.root.querySelector('span[data-stat="numPoints"]');
    const elL = this.root.querySelector('span[data-stat="length"]');
    if (elN) elN.textContent = np.toString();
    if (elL) elL.textContent = lenStr + 'm';
  }

  _totalLengthM() {
    const d = this.trackData;
    if (!d || d.controlPoints.length < 2) return 0;
    try {
      const pts3 = d.controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
      const curve = new THREE.CatmullRomCurve3(pts3, d.closed && pts3.length >= 4, 'catmullrom', d.tension);
      return curve.getLength();
    } catch { return 0; }
  }

  // ---- Rendering ----

  _render() {
    if (!this.visible) return;
    const ctx = this.ctx;
    const { width: W, height: H } = this.canvas;
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    this._renderGrid();
    this._renderAxes();
    this._renderSpline();
    this._renderGates();
    this._renderPoints();
    this._renderSpawn();
    this._updateStatus();
  }

  _renderGrid() {
    const ctx = this.ctx;
    const { width: W, height: H } = this.canvas;
    const minor = 10;   // m
    const major = 50;   // m

    // Determina range de mundo visível
    const tl = this._screenToWorld(0, 0);
    const br = this._screenToWorld(W, H);
    const x0 = Math.floor(Math.min(tl.x, br.x) / minor) * minor;
    const x1 = Math.ceil(Math.max(tl.x, br.x) / minor) * minor;
    const z0 = Math.floor(Math.min(tl.z, br.z) / minor) * minor;
    const z1 = Math.ceil(Math.max(tl.z, br.z) / minor) * minor;

    ctx.lineWidth = 1;
    for (let wx = x0; wx <= x1; wx += minor) {
      const isMajor = Math.abs(wx) % major < 0.01;
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
      const s = this._worldToScreen(wx, 0);
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, H); ctx.stroke();
    }
    for (let wz = z0; wz <= z1; wz += minor) {
      const isMajor = Math.abs(wz) % major < 0.01;
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
      const s = this._worldToScreen(0, wz);
      ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(W, s.y); ctx.stroke();
    }
  }

  _renderAxes() {
    const ctx = this.ctx;
    const o = this._worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(255, 42, 109, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(o.x - 12, o.y); ctx.lineTo(o.x + 12, o.y);
    ctx.moveTo(o.x, o.y - 12); ctx.lineTo(o.x, o.y + 12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 42, 109, 0.6)';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText('+X', o.x + 14, o.y + 4);
    ctx.fillText('+Z', o.x - 7, o.y - 14);
  }

  _renderSpline() {
    const ctx = this.ctx;
    const d = this.trackData;
    if (!d || d.controlPoints.length < 2) return;

    let curve, samples;
    try {
      const pts3 = d.controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
      const closed = d.closed && pts3.length >= 4;
      curve = new THREE.CatmullRomCurve3(pts3, closed, 'catmullrom', d.tension);
      const N = Math.max(80, d.controlPoints.length * 16);
      samples = curve.getSpacedPoints(N);
    } catch { return; }

    // Banda do asfalto (preenchida)
    const halfW = d.width / 2;
    ctx.fillStyle = 'rgba(50, 50, 60, 0.65)';
    this._drawBand(ctx, curve, samples, halfW, halfW, 'fill');

    // Banda dos curbs (vermelha translúcida)
    if (d.curbWidth > 0) {
      ctx.fillStyle = 'rgba(255, 80, 80, 0.35)';
      this._drawBand(ctx, curve, samples, halfW + d.curbWidth, halfW, 'fill');
      this._drawBand(ctx, curve, samples, -halfW, -halfW - d.curbWidth, 'fill');
    }

    // Spline central (linha rosa)
    ctx.strokeStyle = '#ff2a6d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const s = this._worldToScreen(samples[i].x, samples[i].z);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    if (d.closed && samples.length > 0) {
      const s0 = this._worldToScreen(samples[0].x, samples[0].z);
      ctx.lineTo(s0.x, s0.y);
    }
    ctx.stroke();
  }

  _drawBand(ctx, curve, samples, leftOff, rightOff, mode) {
    // Calcula polígono fechado: lado leftOff ida, lado rightOff volta
    const N = samples.length;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const tg = curve.getTangentAt(t);
      const bx = -tg.z, bz = tg.x;  // binormal = up × tangent (em XZ)
      const wx = samples[i].x + bx * leftOff;
      const wz = samples[i].z + bz * leftOff;
      const s = this._worldToScreen(wx, wz);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    for (let i = N - 1; i >= 0; i--) {
      const t = i / N;
      const tg = curve.getTangentAt(t);
      const bx = -tg.z, bz = tg.x;
      const wx = samples[i].x + bx * rightOff;
      const wz = samples[i].z + bz * rightOff;
      const s = this._worldToScreen(wx, wz);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    if (mode === 'fill') ctx.fill();
    else ctx.stroke();
  }

  _renderGates() {
    const d = this.trackData;
    if (!d || d.controlPoints.length < 2) return;
    let curve;
    try {
      const pts3 = d.controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
      const closed = d.closed && pts3.length >= 4;
      curve = new THREE.CatmullRomCurve3(pts3, closed, 'catmullrom', d.tension);
    } catch { return; }

    const ctx = this.ctx;
    const halfW = d.width / 2 + (d.curbWidth ?? 0);

    for (const g of d.gates) {
      const t = Math.max(0, Math.min(1, g.t ?? 0));
      const p = curve.getPointAt(t);
      const tg = curve.getTangentAt(t);
      const bx = -tg.z, bz = tg.x;

      const a = this._worldToScreen(p.x + bx * halfW, p.z + bz * halfW);
      const b = this._worldToScreen(p.x - bx * halfW, p.z - bz * halfW);

      ctx.strokeStyle = g.isStartFinish ? '#ffd700' : '#5fff8e';
      ctx.lineWidth = 2.5;
      ctx.setLineDash(g.isStartFinish ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const m = this._worldToScreen(p.x, p.z);
      ctx.fillStyle = g.isStartFinish ? '#ffd700' : '#5fff8e';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(g.name, m.x + 8, m.y - 6);
    }
  }

  _renderPoints() {
    const ctx = this.ctx;
    const d = this.trackData;
    if (!d) return;
    for (let i = 0; i < d.controlPoints.length; i++) {
      const p = d.controlPoints[i];
      const s = this._worldToScreen(p.x, p.z);
      const isSelected = i === this.selectedIdx;
      const radius = isSelected ? 7 : 5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#ffd700' : '#ff2a6d';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Index label
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(i.toString(), s.x + 9, s.y + 4);
    }
  }

  _renderSpawn() {
    const d = this.trackData;
    if (!d || d.controlPoints.length < 2) return;
    let curve;
    try {
      const pts3 = d.controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
      const closed = d.closed && pts3.length >= 4;
      curve = new THREE.CatmullRomCurve3(pts3, closed, 'catmullrom', d.tension);
    } catch { return; }

    const ctx = this.ctx;
    const t = d.spawn?.arcLengthT ?? 0;
    const p = curve.getPointAt(t);
    const tg = curve.getTangentAt(t);

    // Seta indicando direção do carro no spawn
    const arrowLen = 8;  // metros
    const tipW = p.x + tg.x * arrowLen;
    const tipZ = p.z + tg.z * arrowLen;

    const sBase = this._worldToScreen(p.x, p.z);
    const sTip = this._worldToScreen(tipW, tipZ);

    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sBase.x, sBase.y);
    ctx.lineTo(sTip.x, sTip.y);
    ctx.stroke();

    // Cabeça da seta
    const ang = Math.atan2(sTip.y - sBase.y, sTip.x - sBase.x);
    const headSize = 8;
    ctx.beginPath();
    ctx.moveTo(sTip.x, sTip.y);
    ctx.lineTo(sTip.x - headSize * Math.cos(ang - 0.4), sTip.y - headSize * Math.sin(ang - 0.4));
    ctx.lineTo(sTip.x - headSize * Math.cos(ang + 0.4), sTip.y - headSize * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = '#ffd700';
    ctx.fill();
  }
}
