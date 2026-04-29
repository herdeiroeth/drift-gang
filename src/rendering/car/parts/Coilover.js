import * as THREE from 'three';
import { VISUAL_CFG } from '../CarVisualConfig.js';
import { cylinderBetween } from './cylinderBetween.js';

// Coilover = mola helicoidal + amortecedor interno + mounts.
//
// Spring: TubeGeometry de uma curva helicoidal pré-criada com comprimento Y
// igual a 1.0 (escala via mesh.scale.y é aplicada pelo cylinderBetween
// implicitamente). O raio do helix permanece constante mesmo com escala em Y
// (porque o scale é uniforme em XZ=1).
//
// Damper interno: cilindro fino paralelo à mola.
//
// Top mount: ponto fixo no chassis. Bottom mount: lido do mundo via callback
// (geralmente wheel.mesh.position + offset).

const _bWorld = new THREE.Vector3();
const _bLocal = new THREE.Vector3();

class HelixCurve extends THREE.Curve {
  constructor(turns, radius) {
    super();
    this.turns = turns;
    this.radius = radius;
  }
  getPoint(t, target = new THREE.Vector3()) {
    const angle = t * Math.PI * 2 * this.turns;
    return target.set(
      this.radius * Math.cos(angle),
      t,
      this.radius * Math.sin(angle),
    );
  }
}

let _sharedSpringGeo = null;
let _sharedDamperGeo = null;

function getSharedSpringGeo() {
  if (_sharedSpringGeo) return _sharedSpringGeo;
  const v = VISUAL_CFG.spring;
  const curve = new HelixCurve(v.turns, v.radius);
  _sharedSpringGeo = new THREE.TubeGeometry(curve, v.tubularSegs, v.tubeRadius, v.radialSegs, false);
  return _sharedSpringGeo;
}

function getSharedDamperGeo() {
  if (_sharedDamperGeo) return _sharedDamperGeo;
  const v = VISUAL_CFG.damper;
  // Cilindro Y-up de y=0 a y=1 (não o default y=-0.5 a y=+0.5),
  // pra alinhar com a spring (que vai de y=0 a y=1).
  _sharedDamperGeo = new THREE.CylinderGeometry(v.radius, v.radius, 1.0, 8, 1);
  _sharedDamperGeo.translate(0, 0.5, 0);
  return _sharedDamperGeo;
}

export class Coilover {
  constructor(parent, chassisTop, getKnuckleWorld, car, opts = {}) {
    this.car = car;
    this.chassisTop = chassisTop.clone();
    this.getKnuckleWorld = getKnuckleWorld;
    this.minScaleY = opts.minScaleY ?? VISUAL_CFG.spring.minScaleY;
    this.maxScaleY = opts.maxScaleY ?? VISUAL_CFG.spring.maxScaleY;

    const sv = VISUAL_CFG.spring;
    const dv = VISUAL_CFG.damper;

    const springMat = new THREE.MeshStandardMaterial({
      color:     sv.color,
      roughness: sv.roughness,
      metalness: sv.metalness,
    });
    const damperMat = new THREE.MeshStandardMaterial({
      color:     dv.color,
      roughness: dv.roughness,
      metalness: dv.metalness,
    });

    // O group é orientado por cylinderBetween (eixo Y local = direção mola).
    // Spring geometry vai de y=0 a y=1; cylinderBetween posiciona o group no
    // midpoint e aplica scale.y = distance. Spring com pontos em [0,1] +
    // group.scale.y = dist + group.position = midpoint significa que a
    // spring efetivamente vai de midpoint - 0.5*dist a midpoint + 0.5*dist
    // — o que é exatamente A→B. Mas há offset: o ponto y=0 da spring
    // (centro do midpoint) deveria estar em A, não no meio. Pra corrigir:
    // pré-translatamos a geometry pra y∈[-0.5, 0.5] e tudo casa.
    const adjustedSpringGeo = getSharedSpringGeo().clone();
    adjustedSpringGeo.translate(0, -0.5, 0);
    const adjustedDamperGeo = getSharedDamperGeo().clone();
    adjustedDamperGeo.translate(0, -0.5, 0);

    this.group = new THREE.Group();
    this.spring = new THREE.Mesh(adjustedSpringGeo, springMat);
    this.damper = new THREE.Mesh(adjustedDamperGeo, damperMat);
    this.group.add(this.spring, this.damper);
    if (opts.castShadow !== false) {
      this.spring.castShadow = true;
      this.damper.castShadow = true;
    }
    parent.add(this.group);
  }

  update() {
    this.getKnuckleWorld(_bWorld);
    _bLocal.copy(_bWorld);
    this.car.mesh.worldToLocal(_bLocal);
    cylinderBetween(this.group, this.chassisTop, _bLocal);
    // Clamp scale.y entre [minScaleY, maxScaleY] pra evitar helix sobre-
    // esticada ou esmagada em situações limite (ex: pulo extremo).
    const sy = this.group.scale.y;
    if (sy < this.minScaleY) this.group.scale.y = this.minScaleY;
    else if (sy > this.maxScaleY) this.group.scale.y = this.maxScaleY;
  }
}
