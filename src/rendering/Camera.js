import * as THREE from 'three';

const _tmpDir = new THREE.Vector3();
const _tmpOff = new THREE.Vector3();

export class CamCtrl {
  constructor(cam) {
    this.cam = cam;
    this.mode = 'chase';
    this.orb = 0;

    // Free-look (botão direito do mouse). Coordenadas polares centradas no
    // alvo (carro). yaw=azimuth em torno de +Y, pitch=elevation, radius=distância.
    this.freeLook = false;
    this.freeYaw = 0;
    this.freePitch = 0.25;
    this.freeRadius = 9.0;
    this._dragX = 0;
    this._dragY = 0;
    this._sensitivity = 0.005;
    this._zoomMin = 3;
    this._zoomMax = 40;

    this._setupMouse();
  }

  _setupMouse() {
    window.addEventListener('contextmenu', (e) => {
      // Sempre suprime o menu de contexto sobre o canvas — ele atrapalha o
      // gameplay e o free-look usa esse botão.
      e.preventDefault();
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      this.freeLook = true;
      this._dragX = e.clientX;
      this._dragY = e.clientY;
      // Snapshot dos params polares a partir da posição atual da câmera —
      // free-look começa SEM salto visual, exatamente onde a câmera está.
      this._captureFromCurrentCam();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 2) return;
      this.freeLook = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.freeLook) return;
      const dx = e.clientX - this._dragX;
      const dy = e.clientY - this._dragY;
      this._dragX = e.clientX;
      this._dragY = e.clientY;
      this.freeYaw   -= dx * this._sensitivity;
      this.freePitch += dy * this._sensitivity;
      // Clamp pitch pra não atravessar polos (singularidade do lookAt).
      const lim = Math.PI / 2 - 0.05;
      if (this.freePitch >  lim) this.freePitch =  lim;
      if (this.freePitch < -lim) this.freePitch = -lim;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.freeLook) return;
      e.preventDefault();
      this.freeRadius += e.deltaY * 0.01;
      if (this.freeRadius < this._zoomMin) this.freeRadius = this._zoomMin;
      if (this.freeRadius > this._zoomMax) this.freeRadius = this._zoomMax;
    }, { passive: false });
  }

  // Snapshot dos polares (yaw/pitch/radius) a partir da posição atual da
  // câmera relativa ao último target conhecido. Chamado no início do drag
  // pra evitar "salto" da câmera.
  _captureFromCurrentCam() {
    if (!this._lastTarget) return;
    _tmpOff.subVectors(this.cam.position, this._lastTarget);
    this.freeRadius = _tmpOff.length() || this.freeRadius;
    if (this.freeRadius < 0.1) return;
    _tmpOff.divideScalar(this.freeRadius);
    this.freeYaw   = Math.atan2(_tmpOff.x, _tmpOff.z);
    this.freePitch = Math.asin(Math.max(-1, Math.min(1, _tmpOff.y)));
  }

  next() {
    if (this.freeLook) return; // ignora trocas de modo durante free-look
    this.mode = { chase: 'hood', hood: 'orbital', orbital: 'chase' }[this.mode];
  }

  update(dt, pos, heading, spd) {
    // Memoriza alvo pro snapshot de início de free-look.
    this._lastTarget = pos;

    if (this.freeLook) {
      const cp = Math.cos(this.freePitch);
      const sp = Math.sin(this.freePitch);
      const sy = Math.sin(this.freeYaw);
      const cy = Math.cos(this.freeYaw);
      _tmpDir.set(sy * cp, sp, cy * cp);
      this.cam.position.copy(pos).add(_tmpDir.multiplyScalar(this.freeRadius));
      this.cam.lookAt(pos.x, pos.y + 0.6, pos.z);
      return;
    }

    if (this.mode === 'chase') {
      const off = new THREE.Vector3(0, 3.8, -8.5);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      this.cam.position.lerp(pos.clone().add(off), Math.min(1, 4.5 * dt));
      this.cam.lookAt(pos.clone().add(new THREE.Vector3(0, 1.4, 0)));
    } else if (this.mode === 'hood') {
      const off = new THREE.Vector3(0, 1.4, 0.5);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      this.cam.position.copy(pos).add(off);
      const t = pos.clone().add(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(25));
      this.cam.lookAt(t);
    } else {
      this.orb += dt * 0.25;
      const r = 16;
      this.cam.position.set(pos.x + Math.cos(this.orb) * r, pos.y + 8, pos.z + Math.sin(this.orb) * r);
      this.cam.lookAt(pos);
    }
    if (spd > 26) {
      const sh = (spd - 26) * 0.001;
      this.cam.position.x += (Math.random() - .5) * sh;
      this.cam.position.y += (Math.random() - .5) * sh;
    }
  }
}
