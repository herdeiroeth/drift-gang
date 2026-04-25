import * as THREE from 'three';
import { GAME_CFG } from '../../core/constants.js';

export class SkidSystem {
  constructor(scene, maxSeg = GAME_CFG.maxSkids) {
    this.scene = scene;
    this.max = maxSeg;
    this.cnt = 0;
    this.last = [null,null,null,null];
    this.geo = new THREE.BufferGeometry();
    this.v = new Float32Array(maxSeg*18);
    this.uv = new Float32Array(maxSeg*12);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.v,3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv,2));
    const mat = new THREE.MeshBasicMaterial({ color:0x151515, transparent:true, opacity:0.45, depthWrite:false });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  _sv(o,p){ this.v[o]=p.x; this.v[o+1]=p.y; this.v[o+2]=p.z; }
  add(i,p1,p2,p3,p4){
    const o=i*18;
    this._sv(o,p1); this._sv(o+3,p2); this._sv(o+6,p3);
    this._sv(o+9,p2); this._sv(o+12,p4); this._sv(o+15,p3);
    const uo=i*12;
    this.uv[uo]=0;this.uv[uo+1]=0;this.uv[uo+2]=1;this.uv[uo+3]=0;this.uv[uo+4]=0;this.uv[uo+5]=1;
    this.uv[uo+6]=1;this.uv[uo+7]=0;this.uv[uo+8]=1;this.uv[uo+9]=1;this.uv[uo+10]=0;this.uv[uo+11]=1;
    this.cnt++;
  }
  emit(idx, pos, fwd, w=0.22) {
    const r = new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).normalize().multiplyScalar(w*0.5);
    const a=pos.clone().add(r), b=pos.clone().sub(r);
    if(this.last[idx]){ const lp=this.last[idx]; this.add(this.cnt%this.max,lp.a,lp.b,a,b); }
    this.last[idx]={a,b};
  }
  clear(i){ this.last[i]=null; }
  update(){ this.geo.attributes.position.needsUpdate=true; this.geo.attributes.uv.needsUpdate=true; }
}
