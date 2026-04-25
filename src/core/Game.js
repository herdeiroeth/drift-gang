import * as THREE from 'three';
import { Input } from './Input.js';
import { Car } from '../physics/Car.js';
import { CamCtrl } from '../rendering/Camera.js';
import { setupEnv, setupLights } from '../rendering/Environment.js';
import { buildArena } from '../rendering/Arena.js';
import { SmokeSystem } from '../rendering/particles/SmokeSystem.js';
import { SkidSystem } from '../rendering/particles/SkidSystem.js';
import { HUDManager } from '../hud/HUDManager.js';
import { TuningUI } from '../tuning/TuningUI.js';

export class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 600);

    this.input = new Input();
    this.smoke = new SmokeSystem(this.scene);
    this.skids = new SkidSystem(this.scene);

    setupEnv(this.scene);
    setupLights(this.scene);
    const arena = buildArena(this.scene);
    this.groundObjects = arena.groundObjects;
    this.arena = arena;
    this.car = new Car(this.scene, this.groundObjects);
    this.camCtrl = new CamCtrl(this.camera);

    this.hud = new HUDManager();
    this.hud.bind();

    this.tuning = new TuningUI(this.car);
    this.tuning.bind();

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
    });
  }

  start() {
    this.state = 'playing';
    this.hud.showPlaying();
    this.car.reset();
  }

  loop(time) {
    requestAnimationFrame(t => this.loop(t));
    try {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05);
      this.lastTime = time;

      if (this.state === 'start') {
        this.camCtrl.update(dt, this.car.position, this.car.heading, 0);
        this.renderer.render(this.scene, this.camera);
        if (this.input.once('Space')) this.start();
        this.input.clear();
        return;
      }

      if (this.input.once('KeyC')) this.camCtrl.next();
      if (this.input.once('KeyR')) {
        this.car.reset();
        this.hud.resetScore();
      }
      if (this.input.once('KeyK')) this.tuning.toggle();
      this.tuning.update();

      const telem = this.car.update(dt, this.input, this.smoke, this.skids);
      this.smoke.update(dt);
      this.skids.update();

      // Infinite ground: floor follows car em chunks de halfSize
      const arena = this.arena;
      if (arena) {
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

      this.camCtrl.update(dt, this.car.position, this.car.heading, telem.speed);
      this.hud.update(telem, dt, this.state === 'playing');
      this.renderer.render(this.scene, this.camera);
      this.input.clear();
    } catch (e) {
      console.error('GAME LOOP CRASH:', e.message, e.stack);
      throw e;
    }
  }
}
