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
}
