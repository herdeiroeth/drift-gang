import * as THREE from 'three';

// Imprime hierarquia do GLB no console com nomes, tipos e dimensões de bbox.
// Útil pra primeira execução: descobrir nomes dos nodes (rodas, body, vidros)
// pra calibrar extractWheels.js. Ativar via `?debug=gltf` na URL.
export function inspectGltf(root, label = 'gltfScene') {
  console.groupCollapsed(`[gltf-inspect] ${label}`);
  const stats = { meshes: 0, groups: 0, totalTris: 0 };
  walk(root, 0, stats);
  console.log(`Total: ${stats.meshes} meshes, ${stats.groups} groups, ~${stats.totalTris.toLocaleString()} triangles`);
  console.groupEnd();
}

function walk(node, depth, stats) {
  const indent = '  '.repeat(depth);
  const bbox = new THREE.Box3().setFromObject(node);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const sizeStr = isFinite(size.x)
    ? ` bbox=[${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}]`
    : '';

  let extra = '';
  if (node.isMesh) {
    stats.meshes++;
    const tris = node.geometry?.index
      ? node.geometry.index.count / 3
      : (node.geometry?.attributes?.position?.count ?? 0) / 3;
    stats.totalTris += tris;
    extra = ` [Mesh, tris=${tris.toFixed(0)}]`;
  } else if (node.isGroup || node.type === 'Object3D') {
    stats.groups++;
  }

  console.log(`${indent}• ${node.name || '(unnamed)'}${extra}${sizeStr}`);
  for (const child of node.children) walk(child, depth + 1, stats);
}

export function isDebugEnabled(flag = 'gltf') {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const dbg = params.get('debug');
  if (!dbg) return false;
  return dbg === flag || dbg === '1' || dbg === 'all' || dbg.split(',').includes(flag);
}
