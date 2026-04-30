import { CAMERA_STORAGE_KEY } from '../rendering/Camera.js';

const SLIDERS = [
  { key: 'distance', label: 'Distance', min: -3, max: 18, step: 0.1, decimals: 1 },
  { key: 'height', label: 'Height', min: 0.2, max: 8, step: 0.1, decimals: 1 },
  { key: 'side', label: 'Side Offset', min: -4, max: 4, step: 0.1, decimals: 1 },
  { key: 'lookHeight', label: 'Look Height', min: 0, max: 4, step: 0.05, decimals: 2 },
  { key: 'lookAhead', label: 'Look Ahead', min: 0, max: 40, step: 0.5, decimals: 1 },
  { key: 'fov', label: 'FOV', min: 45, max: 95, step: 1, decimals: 0 },
  { key: 'smoothing', label: 'Smoothing', min: 1, max: 18, step: 0.1, decimals: 1 },
  { key: 'lag', label: 'Lag', min: 0, max: 0.35, step: 0.01, decimals: 2 },
  { key: 'sideFollow', label: 'Side Follow', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'speedFov', label: 'Speed FOV', min: 0, max: 0.8, step: 0.01, decimals: 2 },
  { key: 'shake', label: 'Shake', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'driftLook', label: 'Drift Look', min: 0, max: 5, step: 0.1, decimals: 1 },
];

export class CameraStudioUI {
  constructor(camCtrl) {
    this.camCtrl = camCtrl;
    this.visible = false;
    this.root = null;
    this.modeSelect = null;
    this.statusEl = null;
    this.controls = {};
  }

  bind() {
    if (this.root) return;
    this._injectStyles();
    this._buildPanel();
    this._wireEvents();
    this.syncFromCamera();
  }

  toggle() {
    if (!this.root) this.bind();
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) this.syncFromCamera();
  }

  update() {
    if (!this.visible) return;
    if (this.modeSelect && this.modeSelect.value !== this.camCtrl.getMode()) {
      this.syncFromCamera();
    }
  }

  syncFromCamera() {
    if (!this.root) return;
    const mode = this.camCtrl.getMode();
    if (this.modeSelect) this.modeSelect.value = mode;
    this._syncSliders(this.camCtrl.getPreset(mode));
  }

  saveCustom() {
    try {
      localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(this.camCtrl.getCustomPreset()));
      this._setStatus('SAVED');
    } catch (_) {
      this._setStatus('SAVE FAILED');
    }
  }

  loadCustom() {
    try {
      const raw = localStorage.getItem(CAMERA_STORAGE_KEY);
      if (!raw) {
        this._setStatus('NO SAVE');
        return;
      }
      this.camCtrl.setCustomPreset(JSON.parse(raw));
      this.camCtrl.setMode('custom');
      this.syncFromCamera();
      this._setStatus('LOADED');
    } catch (_) {
      this._setStatus('LOAD FAILED');
    }
  }

  resetCustom() {
    this.camCtrl.resetCustomPreset();
    this.camCtrl.setMode('custom');
    try { localStorage.removeItem(CAMERA_STORAGE_KEY); } catch (_) { /* storage indisponível */ }
    this.syncFromCamera();
    this._setStatus('RESET');
  }

  _injectStyles() {
    if (document.getElementById('camera-studio-styles')) return;
    const css = `
      #camera-studio-panel {
        position: fixed; top: 0; right: 0; bottom: 0;
        width: 430px; max-width: 95vw;
        background: #080b10ee;
        border-left: 2px solid #00d9ff;
        box-shadow: -4px 0 24px rgba(0, 217, 255, 0.2);
        color: #e5e7eb;
        font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
        font-size: 12px;
        z-index: 9998;
        display: none;
        flex-direction: column;
        overflow: hidden;
      }
      #camera-studio-panel .camera-studio-header {
        padding: 14px 18px;
        border-bottom: 1px solid #00d9ff44;
        display: flex; align-items: center; justify-content: space-between;
        background: linear-gradient(90deg, #00d9ff22, transparent);
      }
      #camera-studio-panel .camera-studio-title {
        color: #00d9ff;
        font-size: 14px; font-weight: 700; letter-spacing: 0.18em;
      }
      #camera-studio-panel .camera-studio-close {
        cursor: pointer; color: #00d9ff; font-size: 18px;
        background: transparent; border: none; padding: 0 6px;
      }
      #camera-studio-panel .camera-studio-actions {
        display: flex; flex-wrap: wrap; gap: 6px;
        padding: 10px 14px;
        border-bottom: 1px solid #00d9ff22;
      }
      #camera-studio-panel .camera-studio-button {
        padding: 6px 10px;
        background: #111827;
        border: 1px solid #00d9ff66;
        color: #e5e7eb;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: background 0.12s, border-color 0.12s;
      }
      #camera-studio-panel .camera-studio-button:hover {
        background: #10202a;
        border-color: #00d9ff;
      }
      #camera-studio-panel .camera-studio-status {
        margin-left: auto;
        min-width: 74px;
        color: #ff8fbc;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-align: right;
        align-self: center;
      }
      #camera-studio-panel .camera-studio-body {
        flex: 1; overflow-y: auto;
        padding: 10px 14px 24px;
      }
      #camera-studio-panel .camera-studio-section {
        margin: 12px 0 8px;
        color: #00d9ff;
        font-size: 10px;
        letter-spacing: 0.25em;
        text-transform: uppercase;
        border-bottom: 1px dashed #00d9ff44;
        padding-bottom: 4px;
      }
      #camera-studio-panel .camera-studio-row {
        display: grid; grid-template-columns: 1fr auto; gap: 4px 12px;
        align-items: center;
        margin: 8px 0;
      }
      #camera-studio-panel .camera-studio-label {
        font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #c5c8d4;
      }
      #camera-studio-panel .camera-studio-value {
        font-size: 12px; color: #00d9ff; font-weight: 700;
        min-width: 56px; text-align: right;
        font-variant-numeric: tabular-nums;
      }
      #camera-studio-panel .camera-studio-slider {
        grid-column: 1 / -1;
        -webkit-appearance: none; appearance: none;
        width: 100%; height: 4px;
        background: #020617;
        border: 1px solid #00d9ff44;
        border-radius: 2px;
        outline: none;
      }
      #camera-studio-panel .camera-studio-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border-radius: 50%;
        background: #00d9ff;
        border: 1px solid #fff;
        cursor: pointer;
        box-shadow: 0 0 8px #00d9ff99;
      }
      #camera-studio-panel .camera-studio-slider::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%;
        background: #00d9ff;
        border: 1px solid #fff;
        cursor: pointer;
        box-shadow: 0 0 8px #00d9ff99;
      }
      #camera-studio-panel select.camera-studio-select {
        grid-column: 1 / -1;
        background: #020617;
        color: #00d9ff;
        border: 1px solid #00d9ff66;
        padding: 5px 8px;
        font-family: inherit;
        font-size: 11px;
        text-transform: uppercase;
        outline: none;
      }
      #camera-studio-panel .camera-studio-hint {
        font-size: 10px; color: #6b7280; padding: 6px 14px;
        text-align: center; letter-spacing: 0.15em;
      }
    `;
    const style = document.createElement('style');
    style.id = 'camera-studio-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  _buildPanel() {
    const root = document.createElement('div');
    root.id = 'camera-studio-panel';

    const header = document.createElement('div');
    header.className = 'camera-studio-header';
    const title = document.createElement('div');
    title.className = 'camera-studio-title';
    title.textContent = 'CAMERA STUDIO';
    const close = document.createElement('button');
    close.className = 'camera-studio-close';
    close.textContent = 'x';
    close.addEventListener('click', () => this.toggle());
    header.appendChild(title);
    header.appendChild(close);
    root.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'camera-studio-actions';
    actions.appendChild(this._mkButton('Save Custom', () => this.saveCustom()));
    actions.appendChild(this._mkButton('Load Custom', () => this.loadCustom()));
    actions.appendChild(this._mkButton('Reset Custom', () => this.resetCustom()));
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'camera-studio-status';
    actions.appendChild(this.statusEl);
    root.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'camera-studio-body';

    body.appendChild(this._mkSection('Preview'));
    this._mkModeSelect(body);

    body.appendChild(this._mkSection('Custom Camera'));
    for (const cfg of SLIDERS) this._mkSlider(body, cfg);
    root.appendChild(body);

    const hint = document.createElement('div');
    hint.className = 'camera-studio-hint';
    hint.textContent = 'PRESS V TO CLOSE';
    root.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;
  }

  _wireEvents() {
    this._escHandler = (e) => {
      if (e.code === 'Escape' && this.visible) {
        this.toggle();
      }
    };
    window.addEventListener('keydown', this._escHandler);
  }

  _mkButton(label, onClick) {
    const b = document.createElement('button');
    b.className = 'camera-studio-button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _mkSection(title) {
    const s = document.createElement('div');
    s.className = 'camera-studio-section';
    s.textContent = title;
    return s;
  }

  _mkModeSelect(parent) {
    const row = document.createElement('div');
    row.className = 'camera-studio-row';

    const lab = document.createElement('div');
    lab.className = 'camera-studio-label';
    lab.textContent = 'Mode';

    const val = document.createElement('div');
    val.className = 'camera-studio-value';
    val.textContent = '';

    const sel = document.createElement('select');
    sel.className = 'camera-studio-select';
    for (const mode of this.camCtrl.getModes()) {
      const opt = document.createElement('option');
      opt.value = mode.value;
      opt.textContent = mode.label;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      this.camCtrl.setMode(sel.value);
      val.textContent = sel.options[sel.selectedIndex]?.textContent || '';
      this._syncSliders(this.camCtrl.getPreset(sel.value));
    });

    row.appendChild(lab);
    row.appendChild(val);
    row.appendChild(sel);
    parent.appendChild(row);

    this.modeSelect = sel;
    this.modeValueEl = val;
  }

  _mkSlider(parent, cfg) {
    const row = document.createElement('div');
    row.className = 'camera-studio-row';

    const lab = document.createElement('div');
    lab.className = 'camera-studio-label';
    lab.textContent = cfg.label;

    const val = document.createElement('div');
    val.className = 'camera-studio-value';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'camera-studio-slider';
    slider.min = String(cfg.min);
    slider.max = String(cfg.max);
    slider.step = String(cfg.step);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(cfg.decimals);
      this._applySliderEdit(cfg.key, v);
    });

    row.appendChild(lab);
    row.appendChild(val);
    row.appendChild(slider);
    parent.appendChild(row);

    this.controls[cfg.key] = { element: slider, valueEl: val, decimals: cfg.decimals };
  }

  _syncSliders(preset) {
    for (const cfg of SLIDERS) {
      const c = this.controls[cfg.key];
      if (!c) continue;
      const value = preset[cfg.key];
      c.element.value = String(value);
      c.valueEl.textContent = Number(value).toFixed(cfg.decimals);
    }
    if (this.modeSelect && this.modeValueEl) {
      this.modeValueEl.textContent = this.modeSelect.options[this.modeSelect.selectedIndex]?.textContent || '';
    }
  }

  _readSliderPreset() {
    const preset = {};
    for (const cfg of SLIDERS) {
      preset[cfg.key] = parseFloat(this.controls[cfg.key].element.value);
    }
    return preset;
  }

  _applySliderEdit(key, value) {
    const preset = this._readSliderPreset();
    preset[key] = value;
    this.camCtrl.setCustomPreset(preset);
    if (this.camCtrl.getMode() !== 'custom') {
      this.camCtrl.setMode('custom');
      if (this.modeSelect) this.modeSelect.value = 'custom';
      if (this.modeValueEl) this.modeValueEl.textContent = 'Custom';
    }
  }

  _setStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      if (this.statusEl) this.statusEl.textContent = '';
    }, 1400);
  }
}
