export class Input {
  constructor() {
    this.keys = {};
    this.pressed = {};
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (!e.repeat) this.pressed[e.code] = true;
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }
  down(k) { return !!this.keys[k]; }
  once(k) { const v = this.pressed[k]; this.pressed[k] = false; return v; }
  clear() { this.pressed = {}; }

  steeringAxis() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (gp && Math.abs(gp.axes[0]) > 0.05) {
        return -this.applyGamepadCurve(gp.axes[0]);
      }
    }
    let kb = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) kb += 1;
    if (this.down('KeyD') || this.down('ArrowRight')) kb -= 1;
    return kb;
  }

  applyGamepadCurve(raw, deadzone = 0.1, gamma = 1.5) {
    const sign = Math.sign(raw);
    const abs = Math.abs(raw);
    if (abs < deadzone) return 0;
    const adjusted = (abs - deadzone) / (1 - deadzone);
    return sign * Math.pow(adjusted, gamma);
  }
}
