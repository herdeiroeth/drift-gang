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

    if (this.ui.telem && isPlaying) {
      const wd = telem.wheelData;
      const pt = telem.powertrain;
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
