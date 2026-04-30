import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RENDER_QUALITY_PRESETS } from './RenderQualityConfig.js';

export class RenderPipeline {
  constructor({ renderer, scene, camera, quality = RENDER_QUALITY_PRESETS.ultra }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.debugMode = quality.name ?? 'ultra';
    this.composer = null;
    this.renderTarget = null;
    this.renderPass = null;
    this.smaaPass = null;
    this.outputPass = null;
    this.failed = false;

    this._build();
  }

  resize(width, height) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  render(dt = 0) {
    if (!this.composer || this.failed || !this.quality.useComposer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    try {
      this.composer.render(dt);
    } catch (err) {
      console.warn('[RenderPipeline] Composer failed; falling back to direct render.', err);
      this.failed = true;
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.composer?.dispose();
    this.composer = null;
    this.renderTarget = null;
    this.renderPass = null;
    this.smaaPass = null;
    this.outputPass = null;
  }

  setDebugMode(mode) {
    if (!mode) return this.debugMode;
    const key = String(mode).toLowerCase();
    const next = RENDER_QUALITY_PRESETS[key];
    if (!next) {
      console.warn(`[RenderPipeline] Unknown debug mode "${mode}". Use "off" or "ultra".`);
      return this.debugMode;
    }

    this.debugMode = key;
    this.quality = next;
    this.failed = false;
    this.dispose();
    this._build();

    const size = this.renderer.getSize(new THREE.Vector2());
    this.resize(size.x, size.y);
    console.info(`[RenderPipeline] AA mode -> ${key}`, this.getInfo());
    return this.debugMode;
  }

  getInfo() {
    return {
      mode: this.debugMode,
      composer: !!this.composer,
      smaa: !!this.smaaPass,
      msaaSamples: this.renderTarget?.samples ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  _build() {
    if (!this.quality.useComposer) return;

    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: this._resolveBufferType(),
      depthBuffer: true,
      stencilBuffer: false,
      samples: this._resolveMsaaSamples(),
    });
    renderTarget.texture.name = 'RenderPipeline.msaaColor';

    const composer = new EffectComposer(this.renderer, renderTarget);
    composer.setPixelRatio(this.renderer.getPixelRatio());

    this.renderTarget = renderTarget;
    this.composer = composer;
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    if (this.quality.smaa) {
      this.smaaPass = new SMAAPass();
      this.composer.addPass(this.smaaPass);
    }

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  _resolveBufferType() {
    if (!this.quality.halfFloatPreferred) return THREE.UnsignedByteType;
    const readable = this.renderer.capabilities.textureTypeReadable?.(THREE.HalfFloatType);
    return readable === false ? THREE.UnsignedByteType : THREE.HalfFloatType;
  }

  _resolveMsaaSamples() {
    const requested = this.quality.msaaSamples ?? 0;
    const maxSamples = this.renderer.capabilities.maxSamples ?? 0;
    return Math.max(0, Math.min(requested, maxSamples));
  }
}
