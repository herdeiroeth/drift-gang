import * as THREE from 'three';

export const RENDER_QUALITY_PRESETS = {
  off: {
    name: 'off',
    useComposer: false,
    smaa: false,
    msaaSamples: 0,
    pixelRatioMax: 1,
    pixelRatioMinWhenDpr1: 1,
    halfFloatPreferred: false,
    shadowMapSize: 2048,
    shadowFocusRadius: 95,
    shadowLightDistance: 220,
    dynamicShadowFocus: false,
    shadowMapType: THREE.PCFShadowMap,
  },

  ultra: {
    name: 'ultra',
    useComposer: true,
    smaa: true,
    msaaSamples: 4,
    pixelRatioMax: 2,
    pixelRatioMinWhenDpr1: 1.25,
    halfFloatPreferred: true,
    shadowMapSize: 4096,
    shadowFocusRadius: 58,
    shadowLightDistance: 220,
    dynamicShadowFocus: true,
    shadowMapType: THREE.PCFShadowMap,
  },
};

export function resolveRenderQuality() {
  const aa = new URLSearchParams(window.location.search).get('aa');
  if (aa && RENDER_QUALITY_PRESETS[aa]) return RENDER_QUALITY_PRESETS[aa];
  return RENDER_QUALITY_PRESETS.ultra;
}

export function resolveRenderPixelRatio(quality, dpr = window.devicePixelRatio || 1) {
  const max = quality.pixelRatioMax ?? 2;
  const minAtDpr1 = quality.pixelRatioMinWhenDpr1 ?? 1;
  if (dpr <= 1.05) return Math.min(max, minAtDpr1);
  return Math.min(dpr, max);
}
