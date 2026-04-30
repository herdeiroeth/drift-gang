// Orquestra a construção de uma pista a partir de TrackData (track01.js etc).
// Retorna meshes, groundObjects, gates calculados no mundo, spawn calculado.

import * as THREE from 'three';
import {
  createCurbTexture,
  createTrackMarkingsTexture,
  createCheckerTexture,
} from './TrackTextures.js';
import { createAsphaltMaterial } from '../rendering/materials/Asphalt.js';
import { createGrassMaterial } from '../rendering/materials/Grass.js';
import { TRACK_CFG } from '../core/constants.js';
import {
  buildCurve,
  sampleSpline,
  buildSurfaceGeometry,
  buildCurbProfileGeometry,
  computeSamplesBbox,
} from './TrackGeometry.js';

// Y offsets pra evitar z-fight entre asfalto, markings overlay, curbs e terrain.
const Y_TERRAIN = -0.05;
const Y_ASPHALT = 0.0;
const Y_MARKINGS = 0.004;   // overlay com markings 4mm acima do asfalto
const Y_CHECKER = 0.015;
// Curb agora tem perfil 3D próprio (rampa-plateau-rampa). Altura do plateau
// e fração de rampa são parâmetros físicos — afetam o que a suspensão sente.
const CURB_HEIGHT_M  = 0.08;   // 8cm plateau (range F1: 4-10cm)
const CURB_RAMP_FRAC = 0.30;   // 30% rampa de cada lado, 40% plateau

// Constrói pista e adiciona à scene. Não toca em iluminação/skybox/fog (Environment.js cuida).
//
// Returns: { meshes, groundObjects, spawn, gates, totalLength, bbox, trackData }
export function buildTrack(scene, trackData) {
  const curve = buildCurve(trackData.controlPoints, trackData.closed, trackData.tension);
  const { samples, totalLength } = sampleSpline(curve);
  const bbox = computeSamplesBbox(samples);

  const halfWidth = trackData.width * 0.5;
  const curbWidth = trackData.curbWidth ?? 0;

  // ---- Asfalto base (PBR externo, anti-tile via shader patch)
  // UV-V do mesh está em arc-length em metros, UV-U em [0,1] lateral.
  // Tile lateral = trackData.width / 4 (≈ 3 metros por tile, casa com tamanho real
  // do bloco de asfalto poly haven). Tile longitudinal = totalLength / 4.
  const asphaltGeo = buildSurfaceGeometry(samples, +halfWidth, -halfWidth, trackData.closed, Y_ASPHALT);
  const tileLateral = Math.max(1, trackData.width / 4);
  const tileLongitudinal = Math.max(1, totalLength / 4);
  const asphaltMat = createAsphaltMaterial({
    repeatX: tileLateral,
    repeatY: tileLongitudinal,
    seed: 3907,
    normalStrength: 0.85,
  });
  const asphalt = new THREE.Mesh(asphaltGeo, asphaltMat);
  asphalt.receiveShadow = true;
  asphalt.userData.surfaceType = 'asphalt';
  scene.add(asphalt);

  // ---- Markings overlay (linhas brancas + tracejado) — mesh sobreposto com
  // canvas transparente. Usa polygonOffset + Y bump pra evitar z-fight.
  const markingsGeo = buildSurfaceGeometry(samples, +halfWidth, -halfWidth, trackData.closed, Y_MARKINGS);
  const markingsTex = createTrackMarkingsTexture(totalLength, trackData.width);
  markingsTex.repeat.set(1, 1 / totalLength);
  markingsTex.needsUpdate = true;
  const markingsMat = new THREE.MeshBasicMaterial({
    map: markingsTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const markings = new THREE.Mesh(markingsGeo, markingsMat);
  markings.userData.skipRaycast = true;
  scene.add(markings);

  // ---- Curbs (zebras red/white) com perfil 3D real (rampa-plateau-rampa).
  // Volume sentido pelo raycast da suspensão → pneu sobe no kerb, suspensão
  // comprime, drift game ganha "feel" de F1.
  let curbLeft = null, curbRight = null;
  if (curbWidth > 0) {
    // Curb left: inner = +halfWidth (junto asfalto), outer = +halfWidth+curbW
    const curbLeftGeo = buildCurbProfileGeometry(
      samples, +halfWidth, +halfWidth + curbWidth,
      CURB_HEIGHT_M, CURB_RAMP_FRAC, trackData.closed);
    // Curb right: inner = -halfWidth, outer = -halfWidth-curbW (offsets negativos)
    const curbRightGeo = buildCurbProfileGeometry(
      samples, -halfWidth, -halfWidth - curbWidth,
      CURB_HEIGHT_M, CURB_RAMP_FRAC, trackData.closed);

    const curbTex = createCurbTexture();
    curbTex.repeat.set(1, 1 / TRACK_CFG.curbPatternMeters);
    curbTex.needsUpdate = true;

    // DoubleSide evita lidar com winding quando outerOffset < innerOffset.
    // Custo: 2× fragment shader nos curbs apenas. Imperceptível.
    const curbMat = new THREE.MeshStandardMaterial({
      map: curbTex,
      roughness: 0.7,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    curbLeft = new THREE.Mesh(curbLeftGeo, curbMat);
    curbLeft.receiveShadow = true;
    curbLeft.castShadow = true;
    curbLeft.userData.surfaceType = 'curb';
    scene.add(curbLeft);

    curbRight = new THREE.Mesh(curbRightGeo, curbMat);
    curbRight.receiveShadow = true;
    curbRight.castShadow = true;
    curbRight.userData.surfaceType = 'curb';
    scene.add(curbRight);
  }

  // ---- Terrain (grass plane gigante embaixo de tudo) — PBR externo
  const margin = trackData.terrainMargin ?? 200;
  const terrainSizeX = bbox.sizeX + margin * 2;
  const terrainSizeZ = bbox.sizeZ + margin * 2;

  // Tile ~4m por bloco — grass aerial poly haven foi capturada em ângulo,
  // 4m casa bem com a escala da textura.
  const grassMat = createGrassMaterial({
    repeatX: terrainSizeX / 4,
    repeatY: terrainSizeZ / 4,
    normalStrength: 0.85,
  });
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(terrainSizeX, terrainSizeZ),
    grassMat,
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.set(bbox.cx, Y_TERRAIN, bbox.cz);
  terrain.receiveShadow = true;
  terrain.userData.surfaceType = 'grass';
  scene.add(terrain);

  // ---- Spawn + gates (computados antes do checker pattern, que usa o gate start)
  const spawn = computeSpawn(curve, trackData.spawn ?? {});
  const gates = (trackData.gates ?? []).map(g => computeGate(curve, g, trackData));

  // ---- Checker pattern visual na linha de chegada (puramente decorativo)
  let startChecker = null;
  const startGate = gates.find(g => g.isStartFinish);
  if (startGate) {
    const checkerW = trackData.width;       // cobre largura inteira
    const checkerD = 1.2;                   // 1.2m no eixo do tangent
    const checkerTex = createCheckerTexture(8);
    checkerTex.repeat.set(checkerW / 1.5, checkerD / 1.5);
    checkerTex.needsUpdate = true;

    const checkerMat = new THREE.MeshStandardMaterial({
      map: checkerTex,
      roughness: 0.85,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // BoxGeometry usado como "decal" achatado, perpendicular ao tangente
    startChecker = new THREE.Mesh(
      new THREE.BoxGeometry(checkerW, 0.02, checkerD),
      checkerMat,
    );
    startChecker.position.set(startGate.x, Y_CHECKER, startGate.z);
    // Heading visual: alinhar ao tangente do gate (rotação Y)
    startChecker.rotation.y = Math.atan2(startGate.dirX, startGate.dirZ);
    startChecker.receiveShadow = true;
    scene.add(startChecker);
  }

  // ---- groundObjects (em ordem de importância; raycast retorna mais próximo)
  const groundObjects = [asphalt];
  if (curbLeft) groundObjects.push(curbLeft);
  if (curbRight) groundObjects.push(curbRight);
  groundObjects.push(terrain);

  // Força matrixWorld update agora pra garantir que o primeiro raycast da
  // suspensão funcione antes do primeiro renderer.render() (autoUpdate só
  // roda no render — em raycast manual antes do 1º frame ficaria stale).
  for (const m of groundObjects) m.updateMatrixWorld(true);

  return {
    meshes: { asphalt, markings, curbLeft, curbRight, terrain, startChecker },
    groundObjects,
    spawn,
    gates,
    totalLength,
    bbox,
    trackData,
  };
}

function computeSpawn(curve, spawnData) {
  const t = spawnData.arcLengthT ?? 0;
  const pos = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const heading = Math.atan2(tangent.x, tangent.z) + (spawnData.headingOffset ?? 0);

  let x = pos.x;
  let z = pos.z;
  const lat = spawnData.lateralOffset ?? 0;
  if (lat !== 0) {
    const up = new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(up, tangent).normalize();
    x += binormal.x * lat;
    z += binormal.z * lat;
  }
  return { x, z, heading };
}

function computeGate(curve, gateData, trackData) {
  const t = gateData.t ?? 0;
  const pos = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const binormal = new THREE.Vector3().crossVectors(up, tangent).normalize();

  const gateHalfWidth = Math.max(
    TRACK_CFG.gateMinWidth * 0.5,
    trackData.width * 0.5 + (trackData.curbWidth ?? 0) + (trackData.grassWidth ?? 0),
  );

  return {
    name: gateData.name,
    isStartFinish: gateData.isStartFinish ?? false,
    x: pos.x,
    z: pos.z,
    ax: pos.x + binormal.x * gateHalfWidth,
    az: pos.z + binormal.z * gateHalfWidth,
    bx: pos.x - binormal.x * gateHalfWidth,
    bz: pos.z - binormal.z * gateHalfWidth,
    dirX: tangent.x,
    dirZ: tangent.z,
    width: gateHalfWidth * 2,
  };
}
