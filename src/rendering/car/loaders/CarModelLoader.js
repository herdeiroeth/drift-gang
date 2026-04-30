import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Cache em módulo: o GLB carrega 1× por URL; sucessivas chamadas retornam
// um clone profundo da scene. Sem o cache, recarregar o carro (reset, troca
// de cena) baixaria 23MB de novo do disco.
const cachedScenes = new Map();
const inflightLoads = new Map();

export async function loadCarModel(urlOrUrls, { onProgress } = {}) {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  let lastError = null;
  for (const url of urls) {
    try {
      return await loadCarModelUrl(url, { onProgress });
    } catch (err) {
      lastError = err;
      console.warn(`[CarModelLoader] Failed to load ${url}; trying next fallback if available.`, err);
    }
  }
  throw lastError ?? new Error('No car model URL provided.');
}

function loadCarModelUrl(url, { onProgress } = {}) {
  if (cachedScenes.has(url)) return Promise.resolve(cachedScenes.get(url).clone(true));
  if (inflightLoads.has(url)) return inflightLoads.get(url).then(s => s.clone(true));

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const inflight = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        cachedScenes.set(url, gltf.scene);
        resolve(gltf.scene);
      },
      (xhr) => {
        if (onProgress && xhr.lengthComputable) {
          onProgress(xhr.loaded / xhr.total);
        }
      },
      (err) => reject(err),
    );
  });
  inflightLoads.set(url, inflight);
  return inflight.then(s => s.clone(true));
}
