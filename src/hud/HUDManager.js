import { GAME_CFG } from '../core/constants.js';

export class HUDManager {
  constructor() {
    this.driftScore = 0;
    this.totalScore = 0;
    this.combo = 1;
    this.driftTimer = 0;
    this.inDrift = false;
    this.ui = {};
  }

  bind() {
    this.ui = {
      start: document.getElementById('start-screen'),
      hud: document.getElementById('hud'),
      speed: document.getElementById('speed-val'),
      drift: document.getElementById('drift-score'),
      combo: document.getElementById('combo'),
      total: document.getElementById('total-score'),
    };
    if (!this.ui.rpm) {
      const rpmDiv = document.createElement('div');
      rpmDiv.id = 'rpm-val';
      rpmDiv.style.cssText = 'position:absolute;bottom:80px;left:20px;font-size:18px;color:#ff2a6d;font-weight:bold;';
      document.body.appendChild(rpmDiv);
      this.ui.rpm = rpmDiv;
    }
    if (!this.ui.gear) {
      const gearDiv = document.createElement('div');
      gearDiv.id = 'gear-val';
      gearDiv.style.cssText = 'position:absolute;bottom:110px;left:20px;font-size:28px;color:#fff;font-weight:bold;';
      document.body.appendChild(gearDiv);
      this.ui.gear = gearDiv;
    }
    if (!this.ui.telem) {
      const telemDiv = document.createElement('div');
      telemDiv.id = 'telem-text';
      telemDiv.style.cssText = 'position:absolute;top:80px;right:20px;font-size:11px;color:#aaa;font-family:monospace;text-align:right;white-space:pre;';
      document.body.appendChild(telemDiv);
      this.ui.telem = telemDiv;
    }
    if (!this.ui.tireTemps) {
      const ttDiv = document.createElement('div');
      ttDiv.id = 'tire-temps';
      // monospace, posicionado abaixo do telem; HTML porque cada wheel tem cor própria.
      ttDiv.style.cssText = 'position:absolute;bottom:160px;left:20px;font-size:12px;font-family:monospace;color:#ddd;';
      document.body.appendChild(ttDiv);
      this.ui.tireTemps = ttDiv;
    }
    // Barra de progresso de troca de marcha (visível só durante isShifting).
    // Posicionada à direita do indicador de gear, fica visível 100-300ms.
    if (!this.ui.shiftBar) {
      const wrap = document.createElement('div');
      wrap.id = 'shift-bar-wrap';
      wrap.style.cssText = 'position:absolute;bottom:118px;left:90px;width:140px;height:14px;background:rgba(0,0,0,0.45);border:1px solid #444;border-radius:3px;display:none;overflow:hidden;';
      const fill = document.createElement('div');
      fill.id = 'shift-bar-fill';
      fill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#ffba2a,#ff2a6d);transition:width 30ms linear;';
      wrap.appendChild(fill);
      const label = document.createElement('div');
      label.id = 'shift-bar-label';
      label.style.cssText = 'position:absolute;top:-1px;left:0;right:0;text-align:center;font-size:10px;color:#fff;font-family:monospace;text-shadow:0 0 4px #000;letter-spacing:1px;line-height:14px;';
      wrap.appendChild(label);
      document.body.appendChild(wrap);
      this.ui.shiftBar = wrap;
      this.ui.shiftBarFill = fill;
      this.ui.shiftBarLabel = label;
    }
    // Flash de bloqueio de troca (overrev / bog) acima do indicador de gear.
    if (!this.ui.shiftBlocked) {
      const div = document.createElement('div');
      div.id = 'shift-blocked-flash';
      div.style.cssText = 'position:absolute;bottom:150px;left:20px;font-size:13px;font-family:monospace;font-weight:bold;letter-spacing:1px;padding:4px 8px;border-radius:3px;display:none;';
      document.body.appendChild(div);
      this.ui.shiftBlocked = div;
    }
    // RPM bar (visualização tipo tach digital). Vermelho perto do redline.
    if (!this.ui.rpmBar) {
      const bar = document.createElement('div');
      bar.id = 'rpm-bar';
      bar.style.cssText = 'position:absolute;bottom:60px;left:20px;width:240px;height:8px;background:rgba(0,0,0,0.45);border:1px solid #333;border-radius:2px;overflow:hidden;';
      const fill = document.createElement('div');
      fill.id = 'rpm-bar-fill';
      fill.style.cssText = 'height:100%;width:0%;background:#4ce04c;transition:width 60ms linear, background 80ms linear;';
      bar.appendChild(fill);
      document.body.appendChild(bar);
      this.ui.rpmBar = bar;
      this.ui.rpmBarFill = fill;
    }
  }

  // Cor por temperatura do pneu (mesma escala usada por gripFactor):
  //   <60 → azul (cold), 60-110 → verde (optimal), 110-150 → laranja, >150 → vermelho.
  _tireTempColor(t) {
    if (t < 60)  return '#4ea1ff';
    if (t <= 110) return '#4ce04c';
    if (t <= 150) return '#ffa64c';
    return '#ff4040';
  }

  showStart() {
    if (this.ui.start) this.ui.start.classList.remove('hidden');
    if (this.ui.hud) this.ui.hud.classList.add('hidden');
  }

  showPlaying() {
    if (this.ui.start) this.ui.start.classList.add('hidden');
    if (this.ui.hud) this.ui.hud.classList.remove('hidden');
  }

  resetScore() {
    this.driftScore = 0;
    this.totalScore = 0;
    this.combo = 1;
    this.inDrift = false;
    this.driftTimer = 0;
  }

  update(telem, dt, isPlaying) {
    const kmh = Math.abs(telem.forwardSpeed) * 3.6;
    if (this.ui.speed) this.ui.speed.textContent = Math.round(kmh);
    if (this.ui.rpm) this.ui.rpm.textContent = Math.round(telem.rpm) + ' RPM';
    if (this.ui.gear) {
      const g = telem.gear;
      this.ui.gear.textContent = g === 1 ? 'R' : (g === 0 ? 'N' : (g - 1) + 'ª');
    }

    // ----- RPM bar (verde → laranja → vermelho conforme aproxima do redline) -----
    const pt = telem.powertrain;
    if (this.ui.rpmBarFill && pt) {
      const rpm = Math.max(0, telem.rpm);
      const max = pt.engineMaxRPM ?? 7500;
      const red = pt.engineRedlineRPM ?? 7200;
      const pct = Math.min(100, (rpm / max) * 100);
      this.ui.rpmBarFill.style.width = pct + '%';
      let color;
      if (rpm < red * 0.7)        color = '#4ce04c';   // verde (powerband)
      else if (rpm < red * 0.92)  color = '#ffba2a';   // laranja (alto)
      else if (rpm < red)         color = '#ff7a2a';   // laranja-vermelho (perto)
      else                         color = '#ff2a2a';   // vermelho (redline+)
      this.ui.rpmBarFill.style.background = color;
    }

    // ----- Barra de progresso de troca -----
    if (this.ui.shiftBar && this.ui.shiftBarFill && this.ui.shiftBarLabel && pt) {
      if (pt.isShifting) {
        const prog = Math.max(0, Math.min(1, pt.shiftProgress ?? 0));
        this.ui.shiftBar.style.display = 'block';
        this.ui.shiftBarFill.style.width = (prog * 100) + '%';
        const fromIdx = pt.gearIdx, toIdx = pt.targetGearIdx;
        const fromName = fromIdx === 1 ? 'R' : (fromIdx === 0 ? 'N' : (fromIdx - 1));
        const toName   = toIdx   === 1 ? 'R' : (toIdx   === 0 ? 'N' : (toIdx   - 1));
        this.ui.shiftBarLabel.textContent = `${fromName} → ${toName}`;
      } else {
        this.ui.shiftBar.style.display = 'none';
      }
    }

    // ----- Flash de bloqueio (overrev / bog) -----
    if (this.ui.shiftBlocked && pt) {
      const reason = pt.shiftBlockedReason;
      const timer = pt.shiftBlockedTimer ?? 0;
      if (reason && (reason === 'overrev' || reason === 'bog') && timer > 0) {
        const isOver = reason === 'overrev';
        this.ui.shiftBlocked.style.display = 'block';
        this.ui.shiftBlocked.style.background = isOver ? '#7a0000' : '#3a3a00';
        this.ui.shiftBlocked.style.color = isOver ? '#ff6060' : '#ffe04c';
        this.ui.shiftBlocked.style.border = `1px solid ${isOver ? '#ff2a2a' : '#ffba2a'}`;
        this.ui.shiftBlocked.textContent = isOver ? '⚠ OVER-REV' : '⚠ BOG';
        // Fade out conforme timer decai (lastBlockedTimer começa em 0.9s).
        this.ui.shiftBlocked.style.opacity = Math.min(1, timer / 0.4).toFixed(2);
      } else {
        this.ui.shiftBlocked.style.display = 'none';
      }
    }

    if (this.ui.telem && isPlaying) {
      const wd = telem.wheelData;
      let slipStr = wd ?
        `FL sa:${(wd[0]?.slipAngle * 57.3).toFixed(1)}° sr:${(wd[0]?.slipRatio).toFixed(2)}\n` +
        `FR sa:${(wd[1]?.slipAngle * 57.3).toFixed(1)}° sr:${(wd[1]?.slipRatio).toFixed(2)}\n` +
        `RL sa:${(wd[2]?.slipAngle * 57.3).toFixed(1)}° sr:${(wd[2]?.slipRatio).toFixed(2)}\n` +
        `RR sa:${(wd[3]?.slipAngle * 57.3).toFixed(1)}° sr:${(wd[3]?.slipRatio).toFixed(2)}\n`
        : '';
      if (pt) {
        slipStr += `DIFF:${pt?.gear} TC:${pt?.tcActive ? 'ON' : 'OFF'}\n`;
        slipStr += `BOOST:${pt?.boostPsi?.toFixed(1)} PSI\n`;
        slipStr += `LAUNCH:${pt?.launchActive ? '!!' : (pt?.launchArmed ? 'ARM' : '--')}\n`;
        slipStr += `CLUTCH:${pt?.clutchSlip?.toFixed(2)}\n`;
        slipStr += `BOX:${pt?.gearboxMode === 'sequential' ? 'SEQ' : 'H'}\n`;
        // ECU thresholds dinâmicos (FuelTech-style)
        if (typeof pt.ecuUpThreshold === 'number') {
          slipStr += `ECU UP:${Math.round(pt.ecuUpThreshold)} DN:${Math.round(pt.ecuDownThreshold)}\n`;
        }
        if (typeof pt.drivetrainRPM === 'number') {
          slipStr += `DRV RPM:${Math.round(pt.drivetrainRPM)}\n`;
        }
        if (pt.ecuInhibitReason) {
          slipStr += `INHIBIT: ${pt.ecuInhibitReason.toUpperCase()}\n`;
        }
      }
      this.ui.telem.textContent = slipStr;
    }

    if (this.ui.tireTemps && isPlaying) {
      const wd = telem.wheelData;
      if (wd && wd.length >= 4) {
        const labels = ['FL', 'FR', 'RL', 'RR'];
        const parts = ['<span style="color:#888;">TIRE °C</span>'];
        for (let i = 0; i < 4; i++) {
          const t = wd[i]?.tireTemp ?? 25;
          const color = this._tireTempColor(t);
          parts.push(`<span style="color:${color};">${labels[i]}:${Math.round(t)}</span>`);
        }
        this.ui.tireTemps.innerHTML = parts.join(' ');
      }
    }

    if (telem.isDrifting) {
      if (!this.inDrift) { this.inDrift = true; this.driftTimer = 0; }
      this.driftTimer += dt;
      if (this.driftTimer > GAME_CFG.comboTime) {
        this.combo = Math.min(4, this.combo + 1);
        this.driftTimer = 0;
      }
      const ad = (telem.driftAngle * 180 / Math.PI) * Math.abs(telem.forwardSpeed) * dt * this.combo;
      this.driftScore += ad;
      this.totalScore += ad;
      if (this.ui.drift) {
        this.ui.drift.textContent = Math.floor(this.driftScore);
        this.ui.drift.classList.add('active');
      }
      if (this.ui.combo) {
        this.ui.combo.textContent = this.combo + 'x';
        this.ui.combo.classList.add('active');
      }
    } else {
      this.inDrift = false;
      this.driftTimer = 0;
      this.combo = 1;
      this.driftScore = 0;
      if (this.ui.drift) this.ui.drift.classList.remove('active');
      if (this.ui.combo) this.ui.combo.classList.remove('active');
    }
    if (this.ui.total) this.ui.total.textContent = Math.floor(this.totalScore);
  }
}
