import * as THREE from 'three';

const LIGHT_PRESETS = {
  lowBeam:      { color: 0xfff1d2, baseIntensity: 3.0 },
  highBeam:     { color: 0xfff7e8, baseIntensity: 4.2 },
  runningLight: { color: 0xd7ecff, baseIntensity: 3.2 },
  frontSignal:  { color: 0xffa23a, baseIntensity: 3.3 },
  sideSignal:   { color: 0xffa23a, baseIntensity: 2.6 },
  tailLight:    { color: 0xff1616, baseIntensity: 4.4 },
  brakeLight:   { color: 0xff1010, baseIntensity: 3.8 },
  rearSignal:   { color: 0xff4a20, baseIntensity: 5.0 },
  reverseLight: { color: 0xe0efff, baseIntensity: 2.8 },
};

export function classifyCarLightMaterial(materialName = '') {
  const name = materialName.toLowerCase();

  if (name.includes('runninglight')) return 'runningLight';
  if (name.includes('lowbeam')) return 'lowBeam';
  if (name.includes('highbeam')) return 'highBeam';
  if (name.includes('headsignal')) return name.includes('_alt') ? 'rearSignal' : 'frontSignal';
  if (name.includes('tailsignal')) return 'frontSignal';
  if (name.includes('signal_l') || name.includes('signal_r')) return 'sideSignal';
  if (name.includes('taillight_alt')) return 'tailLight';
  if (name.includes('chmsl')) return 'brakeLight';
  if (name.includes('rev.')) return 'reverseLight';

  return null;
}

export function resolveCarLightRole(materialName = '', meshName = '') {
  const role = classifyCarLightMaterial(materialName);
  if (!role) return null;

  const label = `${materialName} ${meshName}`.toLowerCase();
  const isHeadlight = label.includes('headlight_');
  const isRearLamp = label.includes('taillight_') || label.includes('trunklight_');
  const isMirror = label.includes('mirror_');
  const isChmsl = label.includes('chmsl');

  if (role === 'lowBeam' || role === 'highBeam' || role === 'runningLight') {
    return isHeadlight ? role : null;
  }
  if (role === 'frontSignal') {
    return isHeadlight ? role : null;
  }
  if (role === 'sideSignal') {
    return isMirror ? role : null;
  }
  if (role === 'tailLight' || role === 'rearSignal' || role === 'reverseLight') {
    return isRearLamp ? role : null;
  }
  if (role === 'brakeLight') {
    return isChmsl ? role : null;
  }

  return role;
}

export function isCarLightMaterial(materialName = '') {
  return classifyCarLightMaterial(materialName) != null;
}

export function ensureCarLightMaterial(material, role = classifyCarLightMaterial(material?.name)) {
  if (!material || !role) return material;

  const preset = LIGHT_PRESETS[role];
  if (!preset) return material;

  if (!material.emissive) material.emissive = new THREE.Color(0x000000);
  const emissiveEnergy = material.emissive.r + material.emissive.g + material.emissive.b;
  const hasAuthoredEmissive = emissiveEnergy >= 0.0001;
  if (!hasAuthoredEmissive) {
    material.emissive.setHex(preset.color);
  }

  material.emissiveIntensity = hasAuthoredEmissive
    ? Math.max(material.emissiveIntensity ?? 0, preset.baseIntensity)
    : preset.baseIntensity;
  material.toneMapped = false;
  material.needsUpdate = true;
  return material;
}

export function getCarLightBaseIntensity(role) {
  return LIGHT_PRESETS[role]?.baseIntensity ?? 0;
}
