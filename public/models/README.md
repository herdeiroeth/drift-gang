# Modelos 3D — assets externos

Os arquivos `.glb` aqui não vão para o git (binários grandes). Para rodar o jogo localmente, baixe-os e coloque nesta pasta.

## bmw_m4_f82.glb (~23 MB)

Carro principal do jogo. BMW M4 F82 com texturas PBR embedadas.

**Origem:** modelo baixado do Sketchfab (3D Warehouse / autor original do upload).
**Licença:** CC-BY 4.0 — uso livre, **crédito obrigatório**.
**Atribuição visível em:**
- Rodapé de [`index.html`](../../index.html)
- Tela de start (HUD)

**Para obter o arquivo:**

Caso o GLB já esteja nos seus Downloads:
```bash
cp ~/Downloads/bmw_m4_f82.glb ./public/models/
```

Caso queira re-baixar via Sketchfab API (se tiver acesso à conta original):
```bash
python3 ~/.agents/skills/sketchfab/scripts/sketchfab.py model:download \
  <UID> --format glb --out ./public/models/
```

## Pipeline de otimização (opcional)

Se o FPS cair em hardware modesto, decimar o modelo offline:

```bash
npx --yes @gltf-transform/cli optimize \
  ./public/models/bmw_m4_f82.glb \
  ./public/models/bmw_m4_f82.opt.glb \
  --texture-compress webp \
  --simplify --simplify-ratio 0.5
```

Atualizar `gltfBody.url` em [`src/rendering/car/CarVisualConfig.js`](../../src/rendering/car/CarVisualConfig.js) para apontar pro arquivo otimizado.
