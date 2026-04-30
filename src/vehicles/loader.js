/**
 * VEHICLE DATA LOADER — registry síncrono de templates de veículo.
 *
 * Vite resolve `import x from './foo.json'` estaticamente em build-time.
 * Loader retorna objeto JS já parsed; sem fetch, sem Promise.
 *
 * Para adicionar um veículo novo:
 *   1) criar src/vehicles/<id>.json com o schema do bmw-m4-f82.json
 *   2) `import data from './<id>.json'` aqui e adicionar em REGISTRY
 *
 * Estrutura do JSON (resumo): { meta, chassis, engine, turbo, drivetrain }.
 */

import bmwM4F82 from './bmw-m4-f82.json';

const REGISTRY = {
  'bmw-m4-f82': bmwM4F82,
};

export function loadVehicle(name) {
  return REGISTRY[name] ?? null;
}

export function listVehicles() {
  return Object.keys(REGISTRY);
}
