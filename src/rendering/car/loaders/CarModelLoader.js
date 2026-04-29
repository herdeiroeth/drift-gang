import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Cache em módulo: o GLB carrega 1× por sessão; sucessivas chamadas retornam
// um clone profundo da scene. Sem o cache, recarregar o carro (reset, troca
// de cena) baixaria 23MB de novo do disco.
let cachedScene = null;
let inflight = null;

export function loadCarModel(url, { onProgress } = {}) {
  if (cachedScene) return Promise.resolve(cachedScene.clone(true));
  if (inflight)    return inflight.then(s => s.clone(true));

  const loader = new GLTFLoader();
  inflight = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        cachedScene = gltf.scene;
        resolve(cachedScene);
      },
      (xhr) => {
        if (onProgress && xhr.lengthComputable) {
          onProgress(xhr.loaded / xhr.total);
        }
      },
      (err) => reject(err),
    );
  });
  return inflight.then(s => s.clone(true));
}
