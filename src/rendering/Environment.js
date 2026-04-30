import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import {
  createAsphaltMaps,
  createAsphaltMaterial,
} from './materials/Asphalt.js';

export function createAsphaltTexture() {
  return createAsphaltMaps({ repeatX: 40, repeatY: 40 }).map;
}

export function createOpenArenaAsphaltMaterial() {
  return createAsphaltMaterial({ repeatX: 46, repeatY: 46, seed: 2619, normalStrength: 0.85 });
}

// Parâmetros golden hour calibrados — sol baixo a SO, atmosfera limpa,
// um pouco de Mie scattering pra dar glow warm ao redor do sol.
const SKY_PARAMS = {
  // Calibrado pelo exemplo padrão three.js webgl_shaders_sky com tweak golden.
  turbidity: 10,
  rayleigh: 2.8,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.78,
  elevation: 3.5,         // sol bem baixo no horizonte = golden hour pic
  // Three.js Sky: theta=azimuth em rad, sin(theta) controla Z, cos(theta) controla X.
  // Carro aponta +Z; câmera chase olha pra +Z. Pra sol VISÍVEL na frente,
  // azimuth ~110-150° (frente-esquerda) ou 30-70° (frente-direita).
  azimuth: 100,
};

const HDR_ENV_URL = '/textures/sky/golden_hour_2k.hdr';
const HDR_ENV_INTENSITY = 1.35;

let cachedSky = null;
let cachedSunDir = new THREE.Vector3();

function computeSunDirection() {
  const phi = THREE.MathUtils.degToRad(90 - SKY_PARAMS.elevation);
  const theta = THREE.MathUtils.degToRad(SKY_PARAMS.azimuth);
  const dir = new THREE.Vector3();
  dir.setFromSphericalCoords(1, phi, theta);
  return dir;
}

export function getSunDirection() {
  if (cachedSunDir.lengthSq() < 0.5) cachedSunDir.copy(computeSunDirection());
  return cachedSunDir;
}

// Configura Sky shader (Preetham) + PMREM env map pra IBL.
// scene.background = Sky (renderiza como sphere ao infinito).
// scene.environment começa com PMREM do Sky e depois, quando carregado,
// passa a usar o HDR local. Isso dá reflexos ricos para pintura/vidro sem
// depender de um céu procedural liso.
export function setupEnv(scene, renderer) {
  const sun = computeSunDirection();
  cachedSunDir.copy(sun);

  const sky = new Sky();
  // Camera.far = 6000 em Game.js — sky.scale precisa caber.
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = SKY_PARAMS.turbidity;
  u.rayleigh.value = SKY_PARAMS.rayleigh;
  u.mieCoefficient.value = SKY_PARAMS.mieCoefficient;
  u.mieDirectionalG.value = SKY_PARAMS.mieDirectionalG;
  u.sunPosition.value.copy(sun);
  scene.add(sky);
  cachedSky = sky;

  // PMREM: gera env map do Sky pra IBL. Desativa sun disc (artifacts em reflexões).
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envSky = sky.clone();
  envSky.material = sky.material.clone();
  envSky.material.uniforms.turbidity.value = SKY_PARAMS.turbidity;
  envSky.material.uniforms.rayleigh.value = SKY_PARAMS.rayleigh;
  envSky.material.uniforms.mieCoefficient.value = SKY_PARAMS.mieCoefficient;
  envSky.material.uniforms.mieDirectionalG.value = SKY_PARAMS.mieDirectionalG;
  envSky.material.uniforms.sunPosition.value.copy(sun);
  // Reduz intensity do sun disc na env map (evita highlight pontual em reflexões)
  envScene.add(envSky);

  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  if ('environmentIntensity' in scene) scene.environmentIntensity = HDR_ENV_INTENSITY;
  pmrem.dispose();

  loadHdrEnvironment(scene, renderer, envRT);

  // Fog cor warm matching horizon ao SO (cor do Sky calculada empiricamente
  // pra elevation=12, azimuth=230, rayleigh=2.4)
  scene.fog = new THREE.Fog(0xd9c4a3, 140, 560);

  return { sky, sun, params: SKY_PARAMS };
}

function loadHdrEnvironment(scene, renderer, fallbackRT) {
  if (!renderer) return;

  const loader = new HDRLoader();
  loader.load(
    HDR_ENV_URL,
    (hdrTexture) => {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const hdrRT = pmrem.fromEquirectangular(hdrTexture);

      scene.environment = hdrRT.texture;
      if ('environmentIntensity' in scene) scene.environmentIntensity = HDR_ENV_INTENSITY;

      hdrTexture.dispose();
      fallbackRT?.dispose();
      pmrem.dispose();
    },
    undefined,
    (err) => {
      console.warn(`[Environment] HDR environment failed to load (${HDR_ENV_URL}); keeping procedural sky IBL.`, err);
    },
  );
}

export function setupLights(scene) {
  const sun = getSunDirection();

  // Hemisphere: contraste warm sky / cool earth pra dar VOLUME no carro
  // (sem isso, PBR fica achatado e parece "massa de modelar").
  // Sky levemente warm reflete a atmosfera golden hour, ground escuro pra
  // contraste das partes inferiores.
  const hemi = new THREE.HemisphereLight(0xc4d8ff, 0x382414, 0.55);
  scene.add(hemi);

  // DirectionalLight ("sol"): direção CASA com sun position do Sky shader,
  // intensidade moderada (HDRI/IBL/hemi cuidam da maior parte do ambient).
  const dir = new THREE.DirectionalLight(0xfff0d4, 2.25);
  dir.position.copy(sun).multiplyScalar(180);  // 180m de distância na direção do sol
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.bias = -0.00008;
  dir.shadow.normalBias = 0.025;
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 600;
  dir.shadow.camera.left = -240;
  dir.shadow.camera.right = 240;
  dir.shadow.camera.top = 240;
  dir.shadow.camera.bottom = -240;
  scene.add(dir);
  scene.add(dir.target);

  // Fill light frio (oposto ao sol) — RIM clássico key-fill pra contraste de
  // cor que destaca a forma 3D. Sem isso, BMW vira mancha uniforme golden.
  const fillDir = new THREE.Vector3(-sun.x, Math.max(0.3, sun.y * 0.6), -sun.z).normalize();
  const fill = new THREE.DirectionalLight(0x6b8bb8, 0.38);
  fill.position.copy(fillDir).multiplyScalar(120);
  scene.add(fill);

  return { hemi, dir, fill };
}
