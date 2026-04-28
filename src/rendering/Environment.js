import * as THREE from 'three';

export function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2a32';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 30 + Math.random() * 30;
    ctx.fillStyle = `rgba(${v},${v},${v + 5},${0.15 + Math.random() * 0.15})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * 512;
    ctx.fillStyle = 'rgba(20,20,25,0.08)';
    ctx.fillRect(x, 0, 2 + Math.random() * 4, 512);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  return tex;
}

export function setupEnv(scene) {
  scene.fog = new THREE.Fog(0x1a0b2e, 40, 160);
  const vs = `varying vec3 vWorldPosition; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorldPosition=w.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const fs = `varying vec3 vWorldPosition; void main(){ vec3 top=vec3(0.06,0.02,0.15); vec3 bottom=vec3(0.95,0.35,0.45); float h=normalize(vWorldPosition).y; vec3 col=mix(bottom,top,max(0.0,h*0.5+0.5)); gl_FragColor=vec4(col,1.0); }`;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(250, 32, 32),
    new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, side: THREE.BackSide })
  );
  scene.add(sky);
}

export function setupLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffaaee, 0x222233, 0.5);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(40, 80, 30);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 400;
  dir.shadow.camera.left = -200; dir.shadow.camera.right = 200;
  dir.shadow.camera.top = 200; dir.shadow.camera.bottom = -200;
  scene.add(dir);
  // Retorna refs pra Game.js poder ajustar shadow camera baseado em bbox da pista.
  return { hemi, dir };
}
