import * as THREE from 'three';

export class CamCtrl {
  constructor(cam) {
    this.cam = cam;
    this.mode = 'chase';
    this.orb = 0;
  }
  next() { this.mode = { chase: 'hood', hood: 'orbital', orbital: 'chase' }[this.mode]; }
  update(dt, pos, heading, spd) {
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
