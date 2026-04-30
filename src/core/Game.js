import * as THREE from 'three';
import { Input } from './Input.js';
import { Car } from '../physics/Car.js';
import { CamCtrl } from '../rendering/Camera.js';
import { setupEnv, setupLights } from '../rendering/Environment.js';
import { buildOpenArena } from '../rendering/Arena.js';
import { buildTrack } from '../tracks/TrackBuilder.js';
import { track01 } from '../tracks/track01.js';
import { SmokeSystem } from '../rendering/particles/SmokeSystem.js';
import { SkidSystem } from '../rendering/particles/SkidSystem.js';
import { HUDManager } from '../hud/HUDManager.js';
import { LapHUD } from '../hud/LapHUD.js';
import { LapSystem } from '../track/LapSystem.js';
import { loadLapStats, saveLapStats } from '../track/lapStorage.js';
import { loadTrackData } from '../track/trackStorage.js';
import { LapSoundFX } from '../audio/LapSoundFX.js';
import { TRACK_CFG } from './constants.js';
import { TuningUI } from '../tuning/TuningUI.js';
import { TrackEditor } from '../editor/TrackEditor.js';
import { Telemetry } from '../ui/Telemetry.js';
import { CameraStudioUI } from '../ui/CameraStudioUI.js';
import { loadCarModel } from '../rendering/car/loaders/CarModelLoader.js';
import { VISUAL_CFG } from '../rendering/car/CarVisualConfig.js';

// Toggle de modo: pista vs arena livre. Default: pista (Pista 1).
// Arena livre é mantido para testes de tuning sem voltas (legado).
const USE_TRACK = true;

export class Game {
  // Pré-carrega o GLB do carro antes de instanciar o Game (Car.constructor é
  // síncrono, então o asset precisa estar pronto quando ele rodar). Mantém
  // tela de loading visível e atualiza progresso via callback.
  static async create() {
    const cfg = VISUAL_CFG.gltfBody;
    let gltfScene = null;
    if (cfg.enabled) {
      try {
        gltfScene = await loadCarModel(cfg.url, {
          onProgress: (p) => {
            const el = document.getElementById('loading-progress');
            if (el) el.textContent = `${Math.round(p * 100)}%`;
          },
        });
      } catch (err) {
        console.error('[Game] Failed to load car GLB, falling back to procedural:', err);
      }
    }
    const loading = document.getElementById('loading-screen');
    if (loading) loading.classList.add('hidden');
    return new Game({ gltfScene });
  }

  constructor(opts = {}) {
    this.opts = opts;
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 600);

    this.input = new Input();
    this.smoke = new SmokeSystem(this.scene);
    this.skids = new SkidSystem(this.scene);

    setupEnv(this.scene);
    this.lights = setupLights(this.scene);

    if (USE_TRACK) {
      // Tenta carregar trackData editado do localStorage; fallback no default.
      const customData = loadTrackData(track01.id);
      const trackToUse = customData ?? track01;
      this.track = buildTrack(this.scene, trackToUse);
      this.groundObjects = this.track.groundObjects;
      this.arena = null;
      // Ajustar shadow camera ao bbox da pista pra sombras crisp em pista grande.
      this._fitShadowCameraToTrack(this.track.bbox);
    } else {
      this.arena = buildOpenArena(this.scene);
      this.groundObjects = this.arena.groundObjects;
      this.track = null;
    }
    this.car = new Car(this.scene, this.groundObjects, { gltfScene: this.opts.gltfScene });
    this.camCtrl = new CamCtrl(this.camera);

    this.hud = new HUDManager();
    this.hud.bind();

    this.tuning = new TuningUI(this.car);
    this.tuning.bind();

    this.cameraStudio = new CameraStudioUI(this.camCtrl);
    this.cameraStudio.bind();

    this.telemetry = new Telemetry();

    // Sistema de voltas — só ativo quando há pista carregada.
    if (this.track) {
      const trackId = this.track.trackData.id;
      const initialStats = loadLapStats(trackId);
      this.lapSystem = new LapSystem(this.track.gates, { initialStats });
      this.lapHud = new LapHUD();
      this.lapHud.bind();
    } else {
      this.lapSystem = null;
      this.lapHud = null;
    }

    // Track editor (overlay 2D top-down)
    this.trackEditor = new TrackEditor(this);
    this.trackEditor.bind();

    this.state = 'start';

    this.bindResize();
    this.lastTime = performance.now();
    window.__game = this;
    requestAnimationFrame(t => this.loop(t));
  }

  bindResize() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    });
  }

  // Ajusta o frustum ortográfico do shadow camera ao bbox da pista + margem.
  // Sem isso, sombras numa pista de 600m ficam serrilhadas pq usam o frustum
  // default 400×400 espalhado em 2048×2048 texels.
  _fitShadowCameraToTrack(bbox) {
    const dir = this.lights?.dir;
    if (!dir) return;
    const m = TRACK_CFG.shadowCameraMargin ?? 50;
    dir.shadow.camera.left   = bbox.minX - m;
    dir.shadow.camera.right  = bbox.maxX + m;
    dir.shadow.camera.top    = bbox.maxZ + m;
    dir.shadow.camera.bottom = bbox.minZ - m;
    // Far precisa cobrir altura do sol (80m) + altura máxima de geometria.
    dir.shadow.camera.far = 200;
    dir.shadow.camera.updateProjectionMatrix();
  }

  // Reconstrói a pista a partir de novo trackData. Limpa meshes antigos da
  // scene/dispose recursos, recria meshes via buildTrack, atualiza groundObjects
  // do car, recria LapSystem com novos gates, reset car no novo spawn.
  // Chamado pelo TrackEditor após save.
  rebuildTrack(newTrackData) {
    if (!this.track) return;
    // Dispose recursos antigos
    for (const mesh of Object.values(this.track.meshes)) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
    // Build novo
    this.track = buildTrack(this.scene, newTrackData);
    this.groundObjects = this.track.groundObjects;
    this.car.groundObjects = this.groundObjects;
    this._fitShadowCameraToTrack(this.track.bbox);
    // Recria LapSystem preservando best stats
    if (this.lapSystem) {
      const stats = {
        bestLap: this.lapSystem.getBestLap(),
        bestSectors: this.lapSystem.getBestSectors(),
      };
      this.lapSystem = new LapSystem(this.track.gates, { initialStats: stats });
    }
    this.car.reset(this.track.spawn);
  }

  // Recarrega trackData a partir do localStorage (ou default se forceDefault).
  // Usado pelo botão "Reset to default" do editor.
  rebuildTrackFromStorage(forceDefault = false) {
    const data = forceDefault ? track01 : (loadTrackData(track01.id) ?? track01);
    this.rebuildTrack(data);
  }

  start() {
    this.state = 'playing';
    this.hud.showPlaying();
    this.car.reset(this.track?.spawn);
    if (this.lapSystem) this.lapSystem.reset();
    if (this.lapHud) this.lapHud.show();
  }

  _openEditor() {
    if (!this.track || !this.trackEditor) return;
    this._stateBeforeEditor = this.state;
    this.state = 'editing';
    this.trackEditor.open(this.track.trackData);
    // Quando editor fechar (via close() ou save), volta ao estado anterior.
    // Fechamento é detectado polling em loop().
  }

  loop(time) {
    requestAnimationFrame(t => this.loop(t));
    try {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05);
      this.lastTime = time;

      if (this.state === 'start') {
        this.camCtrl.update(dt, { car: this.car, telem: { speed: 0 } });
        this.renderer.render(this.scene, this.camera);
        if (this.input.once('Space')) this.start();
        if (this.input.once('KeyM')) this._openEditor();
        this.input.clear();
        return;
      }

      // Estado 'editing' — pausa game (renderiza scene congelada embaixo do overlay)
      if (this.state === 'editing') {
        // Detecta se editor foi fechado (via Esc, save, ou close button)
        if (!this.trackEditor.visible) {
          this.state = this._stateBeforeEditor || 'playing';
          this._stateBeforeEditor = null;
        }
        this.renderer.render(this.scene, this.camera);
        this.input.clear();
        return;
      }

      if (this.input.once('KeyC')) {
        this.camCtrl.next();
        this.cameraStudio.syncFromCamera();
      }
      if (this.input.once('KeyR')) {
        this.car.reset(this.track?.spawn);
        this.hud.resetScore();
        if (this.lapSystem) this.lapSystem.reset();
      }
      if (this.input.once('KeyK')) this.tuning.toggle();
      if (this.input.once('KeyV')) this.cameraStudio.toggle();
      if (this.input.once('KeyH')) this.telemetry.toggle();
      if (this.input.once('KeyM')) this._openEditor();
      this.tuning.update();
      this.cameraStudio.update();

      const telem = this.car.update(dt, this.input, this.smoke, this.skids);
      this.telemetry.update(this.car);
      this.smoke.update(dt);
      this.skids.update();

      // Lap system — atualiza após car.update() (posição já integrada do frame).
      if (this.lapSystem) {
        const now = performance.now();
        const event = this.lapSystem.update(now, this.car.position, this.car.wheels);
        if (event?.type === 'lap_complete') {
          // Persistir best/sectors no localStorage
          saveLapStats(this.track.trackData.id, {
            bestLap: this.lapSystem.getBestLap(),
            bestSectors: this.lapSystem.getBestSectors(),
          });
          // Sound + flash visual
          if (event.isPersonalBest) {
            LapSoundFX.playPersonalBest();
            this.lapHud?.flashLap(event);
          } else if (event.lap.valid) {
            LapSoundFX.playLapComplete();
          } else {
            LapSoundFX.playInvalid();
          }
        }
        if (this.lapHud) this.lapHud.update(this.lapSystem, now);
      }

      // Infinite ground: só no modo arena livre. Pista é fechada → não faz sentido.
      const arena = this.arena;
      if (arena && !this.track) {
        const carX = this.car.position.x;
        const carZ = this.car.position.z;
        const floor = arena.floor;
        const grid = arena.grid;
        const halfSize = 180;
        if (Math.abs(carX - floor.position.x) > halfSize) {
          floor.position.x += Math.round((carX - floor.position.x) / halfSize) * halfSize;
          if (grid) grid.position.x = floor.position.x;
        }
        if (Math.abs(carZ - floor.position.z) > halfSize) {
          floor.position.z += Math.round((carZ - floor.position.z) / halfSize) * halfSize;
          if (grid) grid.position.z = floor.position.z;
        }
        if (floor.material && floor.material.map) {
          floor.material.map.offset.x = floor.position.x / halfSize;
          floor.material.map.offset.y = floor.position.z / halfSize;
        }
      }

      this.camCtrl.update(dt, { car: this.car, telem });
      this.hud.update(telem, dt, this.state === 'playing');
      this.renderer.render(this.scene, this.camera);
      this.input.clear();
    } catch (e) {
      console.error('GAME LOOP CRASH:', e.message, e.stack);
      throw e;
    }
  }
}
