/**
 * TuningUI — overlay estilo Forza/ForzaTune
 *
 * Painel modal aberto com tecla K que permite ajustar em tempo real
 * gear ratios, final drive, parâmetros do diferencial, TC, brake bias,
 * inércia do motor e boost máximo do turbo.
 *
 * Toda mutação é aplicada diretamente em `car.cfg`, `car.powertrain.*`
 * — a próxima chamada de `powertrain.update()` já vê os novos valores.
 *
 * Carrega presets de `src/tuning/presets/*.json` via import dinâmico
 * (Vite resolve os assets JSON).
 */

import drift_beginner from './presets/drift_beginner.json';
import drift_pro from './presets/drift_pro.json';
import track from './presets/track.json';
import burnout from './presets/burnout.json';

const PRESETS = {
  drift_beginner,
  drift_pro,
  track,
  burnout,
};

const STORAGE_KEY = 'drift-game:tuning:current';

const DIFF_TYPES = [
  { value: 'open',       label: 'Open' },
  { value: 'lsd_clutch', label: 'LSD Clutch-Pack' },
  { value: 'welded',     label: 'Welded' },
  { value: 'torsen',     label: 'Torsen' },
];

const TC_MODES = [
  { value: 'off',  label: 'Off' },
  { value: 'low',  label: 'Low' },
  { value: 'high', label: 'High' },
];

export class TuningUI {
  constructor(car) {
    this.car = car;
    this.visible = false;
    this.root = null;
    this.controls = {};

    // snapshot dos defaults pra Reset
    this.defaults = this._snapshot();
  }

  // ------------------------------------------------------------------
  // Build / bind
  // ------------------------------------------------------------------
  bind() {
    if (this.root) return;
    this._injectStyles();
    this._buildPanel();
    this._wireEvents();
    this._syncFromCar();
  }

  toggle() {
    if (!this.root) this.bind();
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) this._syncFromCar();
  }

  // Re-sync UI valores do estado real do carro (caso mudou via tecla T/Y etc).
  update() {
    if (!this.visible) return;
    this._syncFromCar();
  }

  // ------------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------------
  _injectStyles() {
    if (document.getElementById('tuning-ui-styles')) return;
    const css = `
      #tuning-panel {
        position: fixed; top: 0; right: 0; bottom: 0;
        width: 460px; max-width: 95vw;
        background: #0a0a0fee;
        border-left: 2px solid #ff2a6d;
        box-shadow: -4px 0 24px rgba(255, 42, 109, 0.25);
        color: #e5e7eb;
        font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
        font-size: 12px;
        z-index: 9999;
        display: none;
        flex-direction: column;
        overflow: hidden;
      }
      #tuning-panel .tuning-header {
        padding: 14px 18px;
        border-bottom: 1px solid #ff2a6d44;
        display: flex; align-items: center; justify-content: space-between;
        background: linear-gradient(90deg, #ff2a6d22, transparent);
      }
      #tuning-panel .tuning-title {
        color: #ff2a6d;
        font-size: 14px; font-weight: 700; letter-spacing: 0.2em;
      }
      #tuning-panel .tuning-close {
        cursor: pointer; color: #ff2a6d; font-size: 18px;
        background: transparent; border: none; padding: 0 6px;
      }
      #tuning-panel .tuning-actions {
        display: flex; flex-wrap: wrap; gap: 6px;
        padding: 10px 14px;
        border-bottom: 1px solid #ff2a6d22;
      }
      #tuning-panel .tuning-presets {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
        padding: 8px 14px 12px;
        border-bottom: 1px solid #ff2a6d22;
      }
      #tuning-panel .tuning-button,
      #tuning-panel .tuning-preset {
        padding: 6px 10px;
        background: #1a1a22;
        border: 1px solid #ff2a6d66;
        color: #e5e7eb;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: background 0.12s, border-color 0.12s;
      }
      #tuning-panel .tuning-button:hover,
      #tuning-panel .tuning-preset:hover {
        background: #2a1a26;
        border-color: #ff2a6d;
      }
      #tuning-panel .tuning-preset {
        background: #14141c;
        color: #ff8fbc;
      }
      #tuning-panel .tuning-body {
        flex: 1; overflow-y: auto;
        padding: 8px 14px 24px;
      }
      #tuning-panel .tuning-section {
        margin: 14px 0 6px;
        color: #ff2a6d;
        font-size: 10px;
        letter-spacing: 0.25em;
        text-transform: uppercase;
        border-bottom: 1px dashed #ff2a6d44;
        padding-bottom: 4px;
      }
      #tuning-panel .tuning-row {
        display: grid; grid-template-columns: 1fr auto; gap: 4px 12px;
        align-items: center;
        margin: 8px 0;
      }
      #tuning-panel .tuning-row .tuning-label {
        font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #c5c8d4;
      }
      #tuning-panel .tuning-row .tuning-value {
        font-size: 12px; color: #ff2a6d; font-weight: 700;
        min-width: 56px; text-align: right;
        font-variant-numeric: tabular-nums;
      }
      #tuning-panel .tuning-slider {
        grid-column: 1 / -1;
        -webkit-appearance: none; appearance: none;
        width: 100%; height: 4px;
        background: #000;
        border: 1px solid #ff2a6d44;
        border-radius: 2px;
        outline: none;
      }
      #tuning-panel .tuning-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border-radius: 50%;
        background: #ff2a6d;
        border: 1px solid #fff;
        cursor: pointer;
        box-shadow: 0 0 8px #ff2a6d99;
      }
      #tuning-panel .tuning-slider::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%;
        background: #ff2a6d;
        border: 1px solid #fff;
        cursor: pointer;
        box-shadow: 0 0 8px #ff2a6d99;
      }
      #tuning-panel select.tuning-select {
        grid-column: 1 / -1;
        background: #000;
        color: #ff2a6d;
        border: 1px solid #ff2a6d66;
        padding: 4px 8px;
        font-family: inherit;
        font-size: 11px;
        text-transform: uppercase;
        outline: none;
      }
      #tuning-panel .tuning-hint {
        font-size: 10px; color: #6b6f80; padding: 6px 14px;
        text-align: center; letter-spacing: 0.15em;
      }
    `;
    const style = document.createElement('style');
    style.id = 'tuning-ui-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // DOM build
  // ------------------------------------------------------------------
  _buildPanel() {
    const root = document.createElement('div');
    root.id = 'tuning-panel';

    // header
    const header = document.createElement('div');
    header.className = 'tuning-header';
    const title = document.createElement('div');
    title.className = 'tuning-title';
    title.textContent = 'TUNING ▸ FORZA MODE';
    const close = document.createElement('button');
    close.className = 'tuning-close';
    close.textContent = '×';
    close.addEventListener('click', () => this.toggle());
    header.appendChild(title);
    header.appendChild(close);
    root.appendChild(header);

    // actions
    const actions = document.createElement('div');
    actions.className = 'tuning-actions';
    actions.appendChild(this._mkButton('Save Setup',    () => this.saveSetup()));
    actions.appendChild(this._mkButton('Load Setup',    () => this.loadSetup()));
    actions.appendChild(this._mkButton('Reset Default', () => this.resetDefault()));
    root.appendChild(actions);

    // presets
    const presets = document.createElement('div');
    presets.className = 'tuning-presets';
    presets.appendChild(this._mkPreset('Drift Beginner', 'drift_beginner'));
    presets.appendChild(this._mkPreset('Drift Pro',      'drift_pro'));
    presets.appendChild(this._mkPreset('Track',          'track'));
    presets.appendChild(this._mkPreset('Burnout',        'burnout'));
    root.appendChild(presets);

    // body
    const body = document.createElement('div');
    body.className = 'tuning-body';

    body.appendChild(this._mkSection('Drivetrain'));
    this._mkSlider(body, 'finalDrive', 'Final Drive', 1.5, 6.0, 0.05, 2,
      v => {
        this.car.cfg.diffRatio = v;
        if (this.car.powertrain) {
          this.car.powertrain.finalDrive = v;
          if (this.car.powertrain.differential) this.car.powertrain.differential.finalDrive = v;
        }
      });

    body.appendChild(this._mkSection('Gear Ratios'));
    // 7 marchas (DCT M4). Index em gearRatios array (0=N, 1=R, 2..8=1ª..7ª).
    // Range 0.4-5.0 cobre 1ª curtas tipo M4 DCT (4.806) e overdrives muito longos.
    for (let g = 1; g <= 7; g++) {
      const idx = g + 1;
      this._mkSlider(body, `gear${g}`, `${g}ª Gear`, 0.4, 5.0, 0.05, 2,
        v => {
          if (this.car.powertrain?.gearbox?.gearRatios) {
            this.car.powertrain.gearbox.gearRatios[idx] = v;
          }
          if (this.car.cfg?.gearRatios) {
            this.car.cfg.gearRatios[idx] = v;
          }
        });
    }

    body.appendChild(this._mkSection('Differential'));
    this._mkSelect(body, 'diffType', 'Differential Type', DIFF_TYPES,
      v => {
        if (this.car.powertrain?.differential) this.car.powertrain.differential.type = v;
      });
    this._mkSlider(body, 'powerLock', 'Diff Power Lock %', 0, 100, 5, 0,
      v => {
        if (this.car.powertrain?.differential) this.car.powertrain.differential.powerLock = v / 100;
      });
    this._mkSlider(body, 'coastLock', 'Diff Coast Lock %', 0, 100, 5, 0,
      v => {
        if (this.car.powertrain?.differential) this.car.powertrain.differential.coastLock = v / 100;
      });
    this._mkSlider(body, 'preload', 'Diff Preload (Nm)', 0, 200, 5, 0,
      v => {
        if (this.car.powertrain?.differential) this.car.powertrain.differential.preload = v;
      });

    body.appendChild(this._mkSection('Assists & Brakes'));
    this._mkSelect(body, 'tcMode', 'TC Mode', TC_MODES,
      v => {
        if (this.car.powertrain?.setTCMode) this.car.powertrain.setTCMode(v);
        else if (this.car.powertrain?.tc) this.car.powertrain.tc.mode = v;
      });
    this._mkSlider(body, 'brakeBiasFront', 'Brake Bias Front %', 40, 80, 1, 0,
      v => { this.car.cfg.brakeBiasFront = v / 100; });

    body.appendChild(this._mkSection('Engine & Turbo'));
    this._mkSlider(body, 'engineInertia', 'Engine Inertia (kg·m²)', 0.10, 0.40, 0.01, 2,
      v => {
        if (this.car.powertrain?.engine) this.car.powertrain.engine.inertia = v;
      });
    this._mkSlider(body, 'turboMaxBoost', 'Turbo Max Boost (bar)', 0, 2.5, 0.05, 2,
      v => {
        if (this.car.powertrain?.turbo) this.car.powertrain.turbo.maxBoost = v;
      });
    // ECU Tune (M4 vehicle data deixa esses defaults: 1.20 / 80ms / 0.926).
    this._mkSlider(body, 'wastegateBoost', 'Wastegate Boost (bar)', 0.5, 1.8, 0.02, 2,
      v => {
        if (this.car.powertrain?.turbo) this.car.powertrain.turbo.wastegateBoost = v;
      });
    this._mkSlider(body, 'throttleLagMs', 'Throttle Lag (ms)', 0, 200, 5, 0,
      v => {
        if (this.car.powertrain?.engine) this.car.powertrain.engine._throttleTau = v / 1000;
      });
    this._mkSlider(body, 'transEff', 'Trans Efficiency', 0.80, 0.98, 0.005, 3,
      v => {
        if (this.car.powertrain) this.car.powertrain.transEfficiency = v;
        if (this.car.cfg) this.car.cfg.transEfficiency = v;
      });
    // ECU Map: stock = 1.20 bar, stage1 sobe wastegate pra 1.50 bar.
    this._mkSelect(body, 'ecuMap', 'ECU Map', ['stock', 'stage1'],
      v => {
        if (!this.car.powertrain?.turbo) return;
        this.car.powertrain.turbo.wastegateBoost = (v === 'stage1') ? 1.50 : 1.20;
        this.controls.wastegateBoost?.set(this.car.powertrain.turbo.wastegateBoost);
      });

    // ----- Tire / SAT (Sprint 1: load sensitivity + kingpin) -----
    body.appendChild(this._mkSection('Tire / SAT'));
    // Load sensitivity expoente: 1.0 = arcade (linear), 0.85 = realista street.
    this._mkSlider(body, 'loadSensN', 'Tire Load Sens. n', 0.65, 1.00, 0.01, 2,
      v => { if (this.car.cfg) this.car.cfg.loadSensN = v; });
    // Caster em °: drift cars 7-12°. Recomputa mechTrail = R·sin(caster).
    this._mkSlider(body, 'casterDeg', 'Caster Angle (°)', 1, 12, 0.5, 1,
      v => {
        const cfg = this.car.cfg;
        if (!cfg) return;
        cfg.casterAngle = v * Math.PI / 180;
        cfg.mechTrail = cfg.wheelRadius * Math.sin(cfg.casterAngle);
      });
    // Pneumatic trail máximo (mm). Faixa real 20-60mm.
    this._mkSlider(body, 'pneumTrailMM', 'Pneumatic Trail (mm)', 10, 80, 1, 0,
      v => { if (this.car.cfg) this.car.cfg.pneumTrail0 = v / 1000; });
    // Ganho do SAT input-side (countersteer assist). Alto = volante mais "vivo".
    this._mkSlider(body, 'steerSatGain', 'SAT Input Gain', 0.0001, 0.003, 0.0001, 4,
      v => { if (this.car.cfg) this.car.cfg.steerSatGain = v; });

    // ----- Steering (max angle + high-speed reduction assist) -----
    body.appendChild(this._mkSection('Steering'));
    this._mkSlider(body, 'maxSteerDeg', 'Max Steering Angle (°)', 30, 75, 1, 0,
      v => { if (this.car.cfg) this.car.cfg.maxSteer = v * Math.PI / 180; });
    this._mkSlider(body, 'steerSpeedReduction', 'High-Speed Reduction (%)', 0, 50, 1, 0,
      v => { if (this.car.cfg) this.car.cfg.steerSpeedReduction = v / 100; });

    // ----- Suspension AAA-lite -----
    body.appendChild(this._mkSection('Suspension'));
    this._mkSlider(body, 'rideHeightMM', 'Ride Height / Rest (mm)', 240, 420, 5, 0,
      v => { if (this.car.cfg) this.car.cfg.suspRestLength = v / 1000; });
    this._mkSlider(body, 'springFrontKN', 'Spring Front (kN/m)', 30, 80, 1, 0,
      v => { if (this.car.cfg) this.car.cfg.springRateFront = v * 1000; });
    this._mkSlider(body, 'springRearKN', 'Spring Rear (kN/m)', 30, 80, 1, 0,
      v => { if (this.car.cfg) this.car.cfg.springRateRear = v * 1000; });
    this._mkSlider(body, 'bumpFront', 'Damper Bump F', 1500, 8000, 100, 0,
      v => { if (this.car.cfg) this.car.cfg.damperBumpFront = v; });
    this._mkSlider(body, 'bumpRear', 'Damper Bump R', 1500, 8000, 100, 0,
      v => { if (this.car.cfg) this.car.cfg.damperBumpRear = v; });
    this._mkSlider(body, 'reboundFront', 'Damper Rebound F', 2500, 12000, 100, 0,
      v => { if (this.car.cfg) this.car.cfg.damperReboundFront = v; });
    this._mkSlider(body, 'reboundRear', 'Damper Rebound R', 2500, 12000, 100, 0,
      v => { if (this.car.cfg) this.car.cfg.damperReboundRear = v; });
    this._mkSlider(body, 'arbFrontKN', 'ARB Front (kN/m)', 0, 30, 1, 0,
      v => { if (this.car.cfg) this.car.cfg.antiRollFront = v * 1000; });
    this._mkSlider(body, 'arbRearKN', 'ARB Rear (kN/m)', 0, 30, 1, 0,
      v => { if (this.car.cfg) this.car.cfg.antiRollRear = v * 1000; });

    // ----- ECU programável (tipo FuelTech) -----
    body.appendChild(this._mkSection('ECU ▸ Shift Map (per gear)'));
    // 1ª (idx=2) sobe pra 2ª etc. Última transição é 6ª↔7ª (idx=7) no DCT 7v.
    const shiftPairs = [
      { idx: 2, label: '1ª → 2ª' },
      { idx: 3, label: '2ª → 3ª' },
      { idx: 4, label: '3ª → 4ª' },
      { idx: 5, label: '4ª → 5ª' },
      { idx: 6, label: '5ª → 6ª' },
      { idx: 7, label: '6ª → 7ª' },
    ];
    for (const { idx, label } of shiftPairs) {
      // Header linha do par
      const hdr = document.createElement('div');
      hdr.style.cssText = 'margin-top:10px;font-size:10px;color:#ff8fbc;letter-spacing:0.15em;';
      hdr.textContent = label;
      body.appendChild(hdr);

      this._mkSlider(body, `up_wot_${idx}`, '  ↑ WOT (rpm)', 3000, 7200, 50, 0,
        v => { this._setShiftMap(idx, 'upWOT', v); });
      this._mkSlider(body, `up_cruise_${idx}`, '  ↑ Cruise (rpm)', 1500, 5500, 50, 0,
        v => { this._setShiftMap(idx, 'upCruise', v); });
      this._mkSlider(body, `down_wot_${idx}`, '  ↓ WOT (rpm)', 1500, 5500, 50, 0,
        v => { this._setShiftMap(idx, 'downWOT', v); });
      this._mkSlider(body, `down_cruise_${idx}`, '  ↓ Cruise (rpm)', 800, 4000, 50, 0,
        v => { this._setShiftMap(idx, 'downCruise', v); });
    }

    body.appendChild(this._mkSection('ECU ▸ Anti-Hunting'));
    this._mkSlider(body, 'ecuUpDebounce', 'Upshift Debounce (ms)', 0, 600, 10, 0,
      v => { if (this.car.powertrain?.ecu) this.car.powertrain.ecu.upshiftDebounceMs = v; });
    this._mkSlider(body, 'ecuDownDebounce', 'Downshift Debounce (ms)', 0, 600, 10, 0,
      v => { if (this.car.powertrain?.ecu) this.car.powertrain.ecu.downshiftDebounceMs = v; });
    this._mkSlider(body, 'ecuLockout', 'Anti-Hunt Lockout (ms)', 0, 1500, 50, 0,
      v => { if (this.car.powertrain?.ecu) this.car.powertrain.ecu.antiHuntLockoutMs = v; });
    this._mkSlider(body, 'ecuKickdownTPS', 'Kickdown TPS (%)', 50, 100, 1, 0,
      v => { if (this.car.powertrain?.ecu) this.car.powertrain.ecu.kickdownThrottle = v / 100; });
    this._mkSelect(body, 'ecuDriftInhibit', 'Inhibit Upshift in Drift',
      [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      v => { if (this.car.powertrain?.ecu) this.car.powertrain.ecu.inhibitUpshiftInDrift = (v === 'on'); });

    root.appendChild(body);

    // hint
    const hint = document.createElement('div');
    hint.className = 'tuning-hint';
    hint.textContent = 'PRESS K TO CLOSE';
    root.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------
  _wireEvents() {
    // ESC fecha
    this._escHandler = (e) => {
      if (e.code === 'Escape' && this.visible) {
        this.toggle();
      }
    };
    window.addEventListener('keydown', this._escHandler);
  }

  // ------------------------------------------------------------------
  // Helpers de DOM
  // ------------------------------------------------------------------
  _mkButton(label, onClick) {
    const b = document.createElement('button');
    b.className = 'tuning-button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _mkPreset(label, key) {
    const b = document.createElement('button');
    b.className = 'tuning-preset';
    b.textContent = label;
    b.addEventListener('click', () => this.applyPreset(key));
    return b;
  }

  _mkSection(title) {
    const s = document.createElement('div');
    s.className = 'tuning-section';
    s.textContent = title;
    return s;
  }

  _mkSlider(parent, key, label, min, max, step, decimals, onChange) {
    const row = document.createElement('div');
    row.className = 'tuning-row';

    const lab = document.createElement('div');
    lab.className = 'tuning-label';
    lab.textContent = label;

    const val = document.createElement('div');
    val.className = 'tuning-value';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'tuning-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(decimals);
      try { onChange(v); } catch (e) { console.warn('TuningUI onChange', key, e); }
    });

    row.appendChild(lab);
    row.appendChild(val);
    row.appendChild(slider);
    parent.appendChild(row);

    this.controls[key] = {
      type: 'slider',
      element: slider,
      valueEl: val,
      decimals,
      onChange,
      set: (v) => {
        slider.value = String(v);
        val.textContent = (+v).toFixed(decimals);
      },
      get: () => parseFloat(slider.value),
    };
  }

  _mkSelect(parent, key, label, options, onChange) {
    const row = document.createElement('div');
    row.className = 'tuning-row';

    const lab = document.createElement('div');
    lab.className = 'tuning-label';
    lab.textContent = label;

    const val = document.createElement('div');
    val.className = 'tuning-value';
    val.textContent = '';

    const sel = document.createElement('select');
    sel.className = 'tuning-select';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      val.textContent = sel.options[sel.selectedIndex]?.textContent || '';
      try { onChange(sel.value); } catch (e) { console.warn('TuningUI onChange', key, e); }
    });

    row.appendChild(lab);
    row.appendChild(val);
    row.appendChild(sel);
    parent.appendChild(row);

    this.controls[key] = {
      type: 'select',
      element: sel,
      valueEl: val,
      onChange,
      set: (v) => {
        sel.value = v;
        val.textContent = sel.options[sel.selectedIndex]?.textContent || '';
      },
      get: () => sel.value,
    };
  }

  // ------------------------------------------------------------------
  // ECU helpers
  // ------------------------------------------------------------------
  _setShiftMap(gearIdx, key, value) {
    const ecu = this.car?.powertrain?.ecu;
    if (!ecu?.shiftMap?.[gearIdx]) return;
    ecu.shiftMap[gearIdx][key] = value;
  }

  // ------------------------------------------------------------------
  // Sync UI ← car
  // ------------------------------------------------------------------
  _syncFromCar() {
    const c = this.car;
    if (!c) return;
    const pt = c.powertrain;
    const cfg = c.cfg ?? {};

    const finalDrive = pt?.differential?.finalDrive ?? pt?.finalDrive ?? cfg.diffRatio ?? 3.8;
    this.controls.finalDrive?.set(finalDrive);

    const gr = pt?.gearbox?.gearRatios ?? cfg.gearRatios ?? [];
    for (let g = 1; g <= 7; g++) {
      const idx = g + 1;
      const v = gr[idx];
      if (typeof v === 'number') this.controls[`gear${g}`]?.set(v);
    }

    const diff = pt?.differential;
    if (diff) {
      const t = diff.type;
      // map legacy 'lsd' → 'lsd_clutch' for UI
      const uiType = (t === 'lsd') ? 'lsd_clutch' : t;
      this.controls.diffType?.set(uiType ?? 'open');
      this.controls.powerLock?.set(((diff.powerLock ?? 0) * 100));
      this.controls.coastLock?.set(((diff.coastLock ?? 0) * 100));
      this.controls.preload?.set(diff.preload ?? diff.lsdPreload ?? 0);
    }

    if (pt?.tc) this.controls.tcMode?.set(pt.tc.mode ?? 'off');
    this.controls.brakeBiasFront?.set((cfg.brakeBiasFront ?? 0.62) * 100);
    if (pt?.engine) this.controls.engineInertia?.set(pt.engine.inertia ?? 0.18);
    if (pt?.turbo) {
      this.controls.turboMaxBoost?.set(pt.turbo.maxBoost ?? 0);
      this.controls.wastegateBoost?.set(pt.turbo.wastegateBoost ?? pt.turbo.maxBoost ?? 1.20);
    }
    if (pt?.engine) {
      this.controls.throttleLagMs?.set((pt.engine._throttleTau ?? 0) * 1000);
    }
    this.controls.transEff?.set(pt?.transEfficiency ?? cfg.transEfficiency ?? 0.926);
    // ECU map é heurístico — interpreta wastegate atual.
    const wg = pt?.turbo?.wastegateBoost ?? 1.20;
    this.controls.ecuMap?.set(wg >= 1.40 ? 'stage1' : 'stock');

    // Tire / SAT (Sprint 1)
    this.controls.loadSensN?.set(cfg.loadSensN ?? 0.85);
    this.controls.casterDeg?.set((cfg.casterAngle ?? 0.10) * 180 / Math.PI);
    this.controls.pneumTrailMM?.set((cfg.pneumTrail0 ?? 0.040) * 1000);
    this.controls.steerSatGain?.set(cfg.steerSatGain ?? 0.0008);

    // Steering
    this.controls.maxSteerDeg?.set((cfg.maxSteer ?? 1.0472) * 180 / Math.PI);
    this.controls.steerSpeedReduction?.set((cfg.steerSpeedReduction ?? 0.20) * 100);

    // Suspension
    this.controls.rideHeightMM?.set((cfg.suspRestLength ?? 0.32) * 1000);
    this.controls.springFrontKN?.set((cfg.springRateFront ?? cfg.springRate ?? 52000) / 1000);
    this.controls.springRearKN?.set((cfg.springRateRear ?? cfg.springRate ?? 48000) / 1000);
    this.controls.bumpFront?.set(cfg.damperBumpFront ?? cfg.damperRate ?? 4200);
    this.controls.bumpRear?.set(cfg.damperBumpRear ?? cfg.damperRate ?? 3900);
    this.controls.reboundFront?.set(cfg.damperReboundFront ?? cfg.damperRate ?? 6800);
    this.controls.reboundRear?.set(cfg.damperReboundRear ?? cfg.damperRate ?? 6200);
    this.controls.arbFrontKN?.set((cfg.antiRollFront ?? 13000) / 1000);
    this.controls.arbRearKN?.set((cfg.antiRollRear ?? 10500) / 1000);

    // ECU sliders
    const ecu = pt?.ecu;
    if (ecu) {
      for (const idx of [2, 3, 4, 5, 6, 7]) {
        const m = ecu.shiftMap?.[idx];
        if (!m) continue;
        this.controls[`up_wot_${idx}`]?.set(m.upWOT);
        this.controls[`up_cruise_${idx}`]?.set(m.upCruise);
        this.controls[`down_wot_${idx}`]?.set(m.downWOT);
        this.controls[`down_cruise_${idx}`]?.set(m.downCruise);
      }
      this.controls.ecuUpDebounce?.set(ecu.upshiftDebounceMs ?? 180);
      this.controls.ecuDownDebounce?.set(ecu.downshiftDebounceMs ?? 220);
      this.controls.ecuLockout?.set(ecu.antiHuntLockoutMs ?? 700);
      this.controls.ecuKickdownTPS?.set((ecu.kickdownThrottle ?? 0.92) * 100);
      this.controls.ecuDriftInhibit?.set(ecu.inhibitUpshiftInDrift ? 'on' : 'off');
    }
  }

  // ------------------------------------------------------------------
  // Snapshot / Save / Load / Reset
  // ------------------------------------------------------------------
  _snapshot() {
    const c = this.car;
    if (!c) return null;
    const pt = c.powertrain ?? {};
    const diff = pt.differential ?? {};
    return {
      finalDrive: diff.finalDrive ?? pt.finalDrive ?? c.cfg?.diffRatio ?? 3.8,
      gearRatios: Array.isArray(pt.gearbox?.gearRatios)
        ? [...pt.gearbox.gearRatios]
        : (Array.isArray(c.cfg?.gearRatios) ? [...c.cfg.gearRatios] : []),
      differential: {
        type: diff.type ?? 'open',
        preload: diff.preload ?? diff.lsdPreload ?? 50,
        powerLock: diff.powerLock ?? 0.5,
        coastLock: diff.coastLock ?? 0.3,
      },
      tcMode: pt.tc?.mode ?? 'off',
      brakeBiasFront: c.cfg?.brakeBiasFront ?? 0.62,
      engineInertia: pt.engine?.inertia ?? 0.18,
      turboMaxBoost: pt.turbo?.maxBoost ?? 0,
      suspension: {
        suspRestLength: c.cfg?.suspRestLength ?? 0.32,
        springRateFront: c.cfg?.springRateFront ?? 52000,
        springRateRear: c.cfg?.springRateRear ?? 48000,
        damperBumpFront: c.cfg?.damperBumpFront ?? 4200,
        damperBumpRear: c.cfg?.damperBumpRear ?? 3900,
        damperReboundFront: c.cfg?.damperReboundFront ?? 6800,
        damperReboundRear: c.cfg?.damperReboundRear ?? 6200,
        antiRollFront: c.cfg?.antiRollFront ?? 13000,
        antiRollRear: c.cfg?.antiRollRear ?? 10500,
      },
      steering: {
        maxAngleDeg: (c.cfg?.maxSteer ?? 1.0472) * 180 / Math.PI,
        speedReductionPct: (c.cfg?.steerSpeedReduction ?? 0.20) * 100,
      },
    };
  }

  saveSetup() {
    try {
      const data = this._snapshot();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      console.log('[TuningUI] saved setup', data);
    } catch (e) {
      console.warn('[TuningUI] saveSetup failed', e);
    }
  }

  loadSetup() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this._applyData(data);
      this._syncFromCar();
      console.log('[TuningUI] loaded setup', data);
    } catch (e) {
      console.warn('[TuningUI] loadSetup failed', e);
    }
  }

  resetDefault() {
    if (!this.defaults) return;
    this._applyData(this.defaults);
    this._syncFromCar();
  }

  // ------------------------------------------------------------------
  // Presets
  // ------------------------------------------------------------------
  applyPreset(key) {
    const p = PRESETS[key];
    if (!p) {
      console.warn('[TuningUI] unknown preset', key);
      return;
    }
    if (typeof this.car.applyPreset === 'function') {
      this.car.applyPreset(p);
    } else {
      this._applyData(p);
    }
    this._syncFromCar();
    console.log('[TuningUI] applied preset', p.name ?? key);
  }

  // ------------------------------------------------------------------
  // Apply raw data object (used by Load/Reset; presets prefer car.applyPreset)
  // ------------------------------------------------------------------
  _applyData(d) {
    const c = this.car;
    if (!c) return;
    const pt = c.powertrain;

    if (typeof d.finalDrive === 'number') {
      if (c.cfg) c.cfg.diffRatio = d.finalDrive;
      if (pt) pt.finalDrive = d.finalDrive;
      if (pt?.differential) pt.differential.finalDrive = d.finalDrive;
    }

    if (Array.isArray(d.gearRatios)) {
      if (pt?.gearbox) pt.gearbox.gearRatios = [...d.gearRatios];
      if (c.cfg) c.cfg.gearRatios = [...d.gearRatios];
    }

    if (d.differential && pt?.differential) {
      const diff = pt.differential;
      if (typeof d.differential.type === 'string') diff.type = d.differential.type;
      if (typeof d.differential.preload === 'number') diff.preload = d.differential.preload;
      if (typeof d.differential.powerLock === 'number') diff.powerLock = d.differential.powerLock;
      if (typeof d.differential.coastLock === 'number') diff.coastLock = d.differential.coastLock;
    }

    if (typeof d.tcMode === 'string' && pt) {
      if (typeof pt.setTCMode === 'function') pt.setTCMode(d.tcMode);
      else if (pt.tc) pt.tc.mode = d.tcMode;
    }

    if (typeof d.brakeBiasFront === 'number' && c.cfg) {
      c.cfg.brakeBiasFront = d.brakeBiasFront;
    }

    if (typeof d.engineInertia === 'number' && pt?.engine) {
      pt.engine.inertia = d.engineInertia;
    }

    if (typeof d.turboMaxBoost === 'number' && pt?.turbo) {
      pt.turbo.maxBoost = d.turboMaxBoost;
    }

    if (d.suspension && c.cfg) {
      const s = d.suspension;
      if (typeof s.suspRestLength === 'number') c.cfg.suspRestLength = s.suspRestLength;
      if (typeof s.springRateFront === 'number') c.cfg.springRateFront = s.springRateFront;
      if (typeof s.springRateRear === 'number') c.cfg.springRateRear = s.springRateRear;
      if (typeof s.damperBumpFront === 'number') c.cfg.damperBumpFront = s.damperBumpFront;
      if (typeof s.damperBumpRear === 'number') c.cfg.damperBumpRear = s.damperBumpRear;
      if (typeof s.damperReboundFront === 'number') c.cfg.damperReboundFront = s.damperReboundFront;
      if (typeof s.damperReboundRear === 'number') c.cfg.damperReboundRear = s.damperReboundRear;
      if (typeof s.antiRollFront === 'number') c.cfg.antiRollFront = s.antiRollFront;
      if (typeof s.antiRollRear === 'number') c.cfg.antiRollRear = s.antiRollRear;
    }

    if (d.steering && c.cfg) {
      const s = d.steering;
      if (typeof s.maxAngleDeg === 'number') {
        c.cfg.maxSteer = s.maxAngleDeg * Math.PI / 180;
      }
      if (typeof s.speedReductionPct === 'number') {
        c.cfg.steerSpeedReduction = s.speedReductionPct / 100;
      }
    }
  }
}

export default TuningUI;
