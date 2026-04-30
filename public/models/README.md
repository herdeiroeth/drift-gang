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

## Pipeline de otimização (recomendado)

O jogo tenta carregar primeiro `bmw_m4_f82.opt.glb` e cai para `bmw_m4_f82.glb`
se o otimizado não existir. Para gerar o arquivo otimizado mantendo a hierarquia
e os nomes usados pelo rig/luzes do jogo:

```bash
npx --yes @gltf-transform/cli optimize \
  ./public/models/bmw_m4_f82.glb \
  ./public/models/bmw_m4_f82.opt.glb \
  --texture-compress webp \
  --texture-size 1024 \
  --compress meshopt \
  --meshopt-level medium \
  --simplify true \
  --simplify-ratio 0.72 \
  --simplify-error 0.0002 \
  --flatten false \
  --join false \
  --join-meshes false \
  --join-named false \
  --instance false \
  --palette false
```
