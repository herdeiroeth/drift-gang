import * as THREE from 'three';

export const CAMERA_STORAGE_KEY = 'drift-game:camera:custom';

export const CAMERA_PRESETS = {
  chase_far: {
    label: 'Chase Far',
    distance: 11.5,
    height: 4.4,
    side: 0,
    lookHeight: 1.6,
    lookAhead: 6.5,
    fov: 68,
    smoothing: 4.2,
    lag: 0.16,
    sideFollow: 0.35,
    speedFov: 0.18,
    shake: 0.18,
    driftLook: 0.8,
  },
  chase_mid: {
    label: 'Chase Mid',
    distance: 8.5,
    height: 3.4,
    side: 0,
    lookHeight: 1.35,
    lookAhead: 5.5,
    fov: 66,
    smoothing: 5.5,
    lag: 0.12,
    sideFollow: 0.3,
    speedFov: 0.16,
    shake: 0.2,
    driftLook: 0.65,
  },
  chase_close: {
    label: 'Chase Close',
    distance: 5.4,
    height: 2.35,
    side: 0,
    lookHeight: 1.15,
    lookAhead: 4.3,
    fov: 64,
    smoothing: 7.5,
    lag: 0.08,
    sideFollow: 0.22,
    speedFov: 0.12,
    shake: 0.15,
    driftLook: 0.45,
  },
  low_drift: {
    label: 'Low Drift',
    distance: 6.8,
    height: 1.25,
    side: -0.55,
    lookHeight: 0.9,
    lookAhead: 7.2,
    fov: 72,
    smoothing: 6.2,
    lag: 0.18,
    sideFollow: 0.55,
    speedFov: 0.22,
    shake: 0.28,
    driftLook: 1.2,
  },
  bumper: {
    label: 'Bumper',
    distance: -2.2,
    height: 0.62,
    side: 0,
    lookHeight: 0.72,
    lookAhead: 28,
    fov: 74,
    smoothing: 16,
    lag: 0,
    sideFollow: 0.05,
    speedFov: 0.18,
    shake: 0.12,
    driftLook: 0.1,
  },
  hood: {
    label: 'Hood',
    distance: -0.75,
    height: 1.35,
    side: 0,
    lookHeight: 1.25,
    lookAhead: 35,
    fov: 69,
    smoothing: 16,
    lag: 0,
    sideFollow: 0.05,
    speedFov: 0.12,
    shake: 0.07,
    driftLook: 0.08,
  },
  orbital: {
    label: 'Orbital',
    type: 'orbital',
    distance: 16,
    height: 8,
    side: 0,
    lookHeight: 0.9,
    lookAhead: 0,
    fov: 64,
    smoothing: 6,
    lag: 0,
    sideFollow: 0,
    speedFov: 0,
    shake: 0,
    driftLook: 0,
  },
};

export const CUSTOM_CAMERA_DEFAULT = {
  label: 'Custom',
  distance: 6.2,
  height: 2.6,
  side: 0,
  lookHeight: 1.2,
  lookAhead: 5.0,
  fov: 66,
  smoothing: 7,
  lag: 0.1,
  sideFollow: 0.28,
  speedFov: 0.14,
  shake: 0.15,
  driftLook: 0.55,
};

const CAMERA_MODE_ORDER = [
  'chase_far',
  'chase_mid',
  'chase_close',
  'low_drift',
  'bumper',
  'hood',
  'orbital',
  'custom',
];

const CUSTOM_LIMITS = {
  distance: [-3, 18],
  height: [0.2, 8],
  side: [-4, 4],
  lookHeight: [0, 4],
  lookAhead: [0, 40],
  fov: [45, 95],
  smoothing: [1, 18],
  lag: [0, 0.35],
  sideFollow: [0, 1],
  speedFov: [0, 0.8],
  shake: [0, 1],
  driftLook: [0, 5],
};

const _tmpDir = new THREE.Vector3();
const _tmpOff = new THREE.Vector3();
const _tmpForward = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _tmpCamTarget = new THREE.Vector3();
const _tmpLookTarget = new THREE.Vector3();
const _tmpVelocity = new THREE.Vector3();
const _tmpLag = new THREE.Vector3();

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function expLerpAlpha(rate, dt) {
  return 1 - Math.exp(-Math.max(0.001, rate) * dt);
}

function clonePreset(preset) {
  return { ...preset };
}

function sanitizeCustomPreset(input = {}) {
  const out = clonePreset(CUSTOM_CAMERA_DEFAULT);
  for (const key of Object.keys(CUSTOM_LIMITS)) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) continue;
    const [min, max] = CUSTOM_LIMITS[key];
    out[key] = clamp(input[key], min, max);
  }
  out.label = 'Custom';
  return out;
}

function loadStoredCustomPreset() {
  try {
    const raw = localStorage.getItem(CAMERA_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeCustomPreset(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

export class CamCtrl {
  constructor(cam) {
    this.cam = cam;
    this.mode = 'chase_mid';
    this.orb = 0;
    this.customPreset = loadStoredCustomPreset() ?? clonePreset(CUSTOM_CAMERA_DEFAULT);
    this._lastTarget = new THREE.Vector3();

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
      // free-look começa sem salto visual, exatamente onde a câmera está.
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

  getModes() {
    return CAMERA_MODE_ORDER.map(value => ({
      value,
      label: value === 'custom' ? this.customPreset.label : CAMERA_PRESETS[value].label,
    }));
  }

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    if (!CAMERA_MODE_ORDER.includes(mode)) return;
    this.mode = mode;
  }

  getPreset(mode = this.mode) {
    if (mode === 'custom') return clonePreset(this.customPreset);
    return clonePreset(CAMERA_PRESETS[mode] ?? CAMERA_PRESETS.chase_mid);
  }

  getCustomPreset() {
    return clonePreset(this.customPreset);
  }

  setCustomPreset(preset) {
    this.customPreset = sanitizeCustomPreset(preset);
  }

  resetCustomPreset() {
    this.customPreset = clonePreset(CUSTOM_CAMERA_DEFAULT);
  }

  next() {
    if (this.freeLook) return; // ignora trocas de modo durante free-look
    const idx = CAMERA_MODE_ORDER.indexOf(this.mode);
    this.mode = CAMERA_MODE_ORDER[(idx + 1) % CAMERA_MODE_ORDER.length];
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

  update(dt, context) {
    const car = context?.car;
    const telem = context?.telem ?? {};
    if (!car?.position) return;

    const pos = car.position;
    const heading = car.heading ?? 0;
    const spd = telem.speed ?? car.absVel ?? 0;
    const preset = this.getPreset(this.mode);

    this._lastTarget.copy(pos);

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

    if (preset.type === 'orbital') {
      this._updateOrbital(dt, pos, preset);
    } else {
      this._updateFollowCamera(dt, car, telem, preset);
    }

    const fovTarget = clamp(preset.fov + spd * preset.speedFov, 45, 98);
    const fovAlpha = expLerpAlpha(5, dt);
    this.cam.fov += (fovTarget - this.cam.fov) * fovAlpha;
    this.cam.updateProjectionMatrix();
  }

  _updateOrbital(dt, pos, preset) {
    this.orb += dt * 0.25;
    const radius = Math.max(1, preset.distance);
    _tmpCamTarget.set(
      pos.x + Math.cos(this.orb) * radius,
      pos.y + preset.height,
      pos.z + Math.sin(this.orb) * radius,
    );
    this.cam.position.lerp(_tmpCamTarget, expLerpAlpha(preset.smoothing, dt));
    this.cam.lookAt(pos.x, pos.y + preset.lookHeight, pos.z);
  }

  _updateFollowCamera(dt, car, telem, preset) {
    const pos = car.position;
    const heading = car.heading ?? 0;
    const speed = telem.speed ?? car.absVel ?? 0;
    const lateralSpeed = telem.lateralSpeed ?? car.velocityLocal?.z ?? 0;
    const yawRate = telem.yawRate ?? car.yawRate ?? 0;
    const pitch = car.pitch ?? 0;
    const roll = car.roll ?? 0;

    _tmpForward.set(Math.sin(heading), 0, Math.cos(heading));
    _tmpRight.set(Math.cos(heading), 0, -Math.sin(heading));
    _tmpVelocity.copy(car.velocity ?? _tmpDir.set(0, 0, 0));

    const sideFollow = preset.sideFollow ?? 0.3;
    const driftSignal = clamp((lateralSpeed / 9) * sideFollow + (yawRate * 0.35), -1, 1);
    const rollSide = clamp(-roll * 0.35, -0.35, 0.35);

    _tmpCamTarget.copy(pos)
      .addScaledVector(_tmpRight, preset.side + rollSide)
      .addScaledVector(_tmpForward, -preset.distance);
    _tmpCamTarget.y += preset.height;

    if (preset.lag > 0 && _tmpVelocity.lengthSq() > 0.0001) {
      const forwardVel = _tmpForward.dot(_tmpVelocity);
      const sideVel = _tmpRight.dot(_tmpVelocity);
      _tmpLag.copy(_tmpForward).multiplyScalar(-forwardVel * preset.lag);
      _tmpLag.addScaledVector(_tmpRight, -sideVel * preset.lag * sideFollow);
      const maxLag = 3.2;
      if (_tmpLag.length() > maxLag) _tmpLag.setLength(maxLag);
      _tmpCamTarget.add(_tmpLag);
    }

    const shakeAmp = Math.max(0, speed - 24) * 0.006 * preset.shake;
    if (shakeAmp > 0) {
      _tmpCamTarget.x += (Math.random() - 0.5) * shakeAmp;
      _tmpCamTarget.y += (Math.random() - 0.5) * shakeAmp;
    }

    const alpha = expLerpAlpha(preset.smoothing, dt);
    this.cam.position.lerp(_tmpCamTarget, alpha);

    _tmpLookTarget.copy(pos)
      .addScaledVector(_tmpForward, preset.lookAhead)
      .addScaledVector(_tmpRight, driftSignal * preset.driftLook);
    _tmpLookTarget.y += preset.lookHeight + Math.sin(pitch) * Math.max(0, preset.lookAhead * 0.2);

    this.cam.lookAt(_tmpLookTarget);
  }
}
