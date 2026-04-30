import * as THREE from 'three';

const BLUR_START_RAD_S = 35;
const BLUR_FULL_RAD_S = 90;
const TAU = Math.PI * 2;
const NO_FADE_NAME = /(tire|tyre|rubber|pneu)/i;
const DIRECT_FADE_NAME = /(rim|spoke|brakedisc|brake_disc|disc|rotor|hub|wheelspinning|wheel_spinning)/i;

let blurTexture = null;
const materialState = new WeakMap();

export class WheelMotionBlur {
  constructor(wheels, { wheelAssemblies = null, gltfWheelHubs = null } = {}) {
    this.items = wheels.map((wheel, i) => {
      const item = {
        wheel,
        blurPlanes: this._createBlurPlanes(wheel),
        fadeMeshes: [],
      };

      if (wheelAssemblies?.[i]) {
        const wa = wheelAssemblies[i];
        item.fadeMeshes.push(...collectMeshes(wa.rimMesh), wa.brakeDisc);
      }

      const spinHub = gltfWheelHubs?.[i]?.userData?.spinHub;
      if (spinHub) {
        item.fadeMeshes.push(...collectGltfFadeMeshes(spinHub, wheel));
      }

      item.fadeMeshes = item.fadeMeshes.filter(Boolean);
      prepareFadeMaterials(item.fadeMeshes);
      return item;
    });
  }

  update() {
    for (const item of this.items) {
      const av = Math.abs(item.wheel.angularVelocity || 0);
      const t = smoothstep(BLUR_START_RAD_S, BLUR_FULL_RAD_S, av);

      for (const plane of item.blurPlanes) {
        plane.material.opacity = 0.34 * t;
        plane.visible = t > 0.01;
      }

      for (const mesh of item.fadeMeshes) {
        fadeMeshMaterial(mesh, t);
      }
    }
  }

  _createBlurPlanes(wheel) {
    const wr = wheel.cfg.wheelRadius;
    const ww = wheel.cfg.wheelWidth;
    const geo = new THREE.PlaneGeometry(wr * 1.72, wr * 1.72);
    geo.rotateY(Math.PI / 2);

    const planes = [];
    for (const x of [-ww * 0.53, ww * 0.53]) {
      const mat = new THREE.MeshBasicMaterial({
        map: getBlurTexture(),
        color: 0xe2e2e2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.name = 'wheelMotionBlurDisc';
      plane.position.x = x;
      plane.visible = false;
      plane.renderOrder = 2;
      wheel.mesh.add(plane);
      planes.push(plane);
    }

    return planes;
  }
}

export function wrapAngle(angle) {
  if (angle > TAU || angle < -TAU) return angle % TAU;
  return angle;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 1e-6)));
  return t * t * (3 - 2 * t);
}

function collectMeshes(root) {
  const out = [];
  root?.traverse?.((node) => {
    if (node.isMesh) out.push(node);
  });
  return out;
}

function collectGltfFadeMeshes(spinHub, wheel) {
  const out = [];
  spinHub.updateMatrixWorld(true);
  spinHub.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const label = `${node.name || ''} ${materialLabel(node.material)}`;
    if (NO_FADE_NAME.test(label)) return;
    if (DIRECT_FADE_NAME.test(label) || looksLikeInnerWheelPart(node, wheel)) out.push(node);
  });
  return out;
}

function looksLikeInnerWheelPart(node, wheel) {
  const bbox = new THREE.Box3().setFromObject(node);
  if (!isFinite(bbox.min.x)) return false;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const radialDiameter = Math.max(size.y, size.z);
  return radialDiameter > wheel.cfg.wheelRadius * 0.18 && radialDiameter < wheel.cfg.wheelRadius * 1.62;
}

function prepareFadeMaterials(meshes) {
  for (const mesh of meshes) {
    if (!mesh?.material) continue;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => prepareMaterial(m));
    } else {
      mesh.material = prepareMaterial(mesh.material);
    }
  }
}

function prepareMaterial(mat) {
  if (!mat) return mat;
  const cloned = mat.clone();
  materialState.set(cloned, {
    opacity: cloned.opacity ?? 1,
    transparent: cloned.transparent,
    depthWrite: cloned.depthWrite,
  });
  return cloned;
}

function fadeMeshMaterial(mesh, t) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of mats) {
    const base = materialState.get(mat);
    if (!base) continue;
    const nextTransparent = t > 0.01 ? true : base.transparent;
    const nextDepthWrite = t > 0.01 ? false : base.depthWrite;
    if (mat.transparent !== nextTransparent || mat.depthWrite !== nextDepthWrite) {
      mat.transparent = nextTransparent;
      mat.depthWrite = nextDepthWrite;
      mat.needsUpdate = true;
    }
    mat.opacity = base.opacity * (1 - t * 0.78);
  }
}

function materialLabel(material) {
  if (Array.isArray(material)) return material.map((m) => m?.name || '').join(' ');
  return material?.name || '';
}

function getBlurTexture() {
  if (blurTexture) return blurTexture;

  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size * 0.5;

  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(c, c, size * 0.12, c, c, size * 0.48);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.00)');
  grad.addColorStop(0.28, 'rgba(255,255,255,0.20)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.32)');
  grad.addColorStop(0.90, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.49, 0, TAU);
  ctx.arc(c, c, size * 0.16, 0, TAU, true);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.33, a, a + 0.13);
    ctx.stroke();
  }

  blurTexture = new THREE.CanvasTexture(canvas);
  blurTexture.colorSpace = THREE.SRGBColorSpace;
  blurTexture.generateMipmaps = false;
  blurTexture.minFilter = THREE.LinearFilter;
  blurTexture.magFilter = THREE.LinearFilter;
  return blurTexture;
}
