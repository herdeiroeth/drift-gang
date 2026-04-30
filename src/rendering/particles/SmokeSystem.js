import * as THREE from 'three';

export class SmokeSystem {
  constructor(scene, max = 1200) {
    this.scene = scene;
    this.max = max;
    this.count = 0;
    this.geometry = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xbbbbbb,
      size: 0.8,
      map: makeSmokeTexture(),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.mesh = new THREE.Points(this.geometry, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  emit(p, intensity = 1) {
    const i = this.count % this.max;
    this.pos[i*3]   = p.x + (Math.random()-.5)*.3;
    this.pos[i*3+1] = p.y + (Math.random()-.5)*.1;
    this.pos[i*3+2] = p.z + (Math.random()-.5)*.3;
    this.vel[i*3]   = (Math.random()-.5)*1.5;
    this.vel[i*3+1] = Math.random()*1.5 + .5;
    this.vel[i*3+2] = (Math.random()-.5)*1.5;
    this.life[i] = 1.0;
    this.maxLife[i] = 0.4 + Math.random()*0.6;
    this.count++;
  }
  update(dt) {
    for (let i=0;i<this.max;i++) {
      if (this.life[i] > 0) {
        this.life[i] -= dt/this.maxLife[i];
        this.pos[i*3]   += this.vel[i*3]*dt;
        this.pos[i*3+1] += this.vel[i*3+1]*dt;
        this.pos[i*3+2] += this.vel[i*3+2]*dt;
        if (this.life[i] <= 0) { this.pos[i*3+1] = -9999; }
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

let smokeTexture = null;

function makeSmokeTexture() {
  if (smokeTexture) return smokeTexture;

  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const center = size * 0.5;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0.0, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  smokeTexture = new THREE.CanvasTexture(canvas);
  smokeTexture.minFilter = THREE.LinearFilter;
  smokeTexture.magFilter = THREE.LinearFilter;
  smokeTexture.generateMipmaps = false;
  return smokeTexture;
}
