# Pesquisa: Anti-serrilhamento e anti-shimmer

## Diagnostico no projeto

O renderer ja usava `WebGLRenderer({ antialias: true })`, mas o jogo renderizava direto no framebuffer. Esse MSAA do canvas ajuda nas bordas do render final, mas nao resolve bem tres pontos que aparecem forte no M4:

- bordas finas e pecas pequenas do GLB em movimento;
- highlights de clearcoat, metal e environment map piscando de frame para frame;
- rodas, aros e discos girando rapido, que viram strobe temporal mesmo com MSAA.

O sintoma piorar quando acelera indica que nao era so "faltou antialias": a roda em alta rotacao e o brilho especular precisavam de tratamento proprio.

## Decisao

Para o preset de qualidade maxima, a solucao adotada e em camadas:

1. `EffectComposer` com `RenderPass -> SMAAPass -> OutputPass`.
2. `WebGLRenderTarget` com MSAA (`samples: 4`) quando a GPU/browser expoe `renderer.capabilities.maxSamples`.
3. Pixel ratio minimo de `1.25` em tela DPR 1 e teto `2` para evitar custo explosivo.
4. Perfil anti-shimmer nos materiais do GLB, elevando roughness e reduzindo intensity de reflexos pontuais.
5. Motion blur visual so nas partes rotativas internas da roda, com fade progressivo dos aros/discos.
6. Shadow map local dinamico, com `4096` e frustum menor seguindo o carro com snap por texel.

## Alternativas avaliadas

- FXAA: barato, mas borra o carro e limpa menos bem diagonais/subpixel que SMAA.
- TAA: qualidade potencial alta, mas sem motion vectors/history rejection tende a gerar ghosting em drift, camera chase e roda girando rapido.
- SSAA continuo: excelente visualmente, mas caro demais para gameplay em browser porque re-renderiza a cena em multiplas amostras.
- Apenas aumentar `devicePixelRatio`: melhora tudo um pouco, mas custa muito e nao resolve strobe temporal de rodas.
- Apenas mexer em materiais: reduz sparkle, mas nao limpa bordas geometricas nem serrilhado de pecas finas.

## Parametros iniciais implementados

- Preset padrao: `ultra`.
- Comparacao por URL: `?aa=off` e `?aa=ultra`.
- Debug runtime: `window.__game.renderPipeline.setDebugMode('off')` ou `'ultra'`.
- MSAA: ate `4` samples, limitado por `renderer.capabilities.maxSamples`.
- SMAA: ligado no preset `ultra`.
- Sombra: `PCFShadowMap`, `4096`, raio local de `58 m` ao redor do carro. Nesta versao do Three, `PCFSoftShadowMap` emite warning de deprecacao e cai para PCF.
- Motion blur de roda: comeca em `35 rad/s` e chega ao maximo em `90 rad/s`.
- Material da pintura: `roughness >= 0.22`, `clearcoatRoughness >= 0.18`, `envMapIntensity <= 1.45`.
- Metais, aros e freios: `roughness >= 0.45`, `envMapIntensity <= 1.2`.

## Criterios de aceite

- O M4 deve ficar claramente mais limpo em camera proxima e durante aceleracao forte.
- Highlights nao devem piscar agressivamente em pintura, vidro, aro e freio.
- Rodas nao devem formar strobe serrilhado duro em burnout ou reta acelerando.
- A sombra do carro deve ficar mais estavel e detalhada sem depender de um shadow frustum espalhado pela pista inteira.
- `npm run build` deve passar.

## Fontes

- Three.js `WebGLRenderer`, `WebGLRenderTarget`, `EffectComposer`, `SMAAPass`, `OutputPass`, `Texture`, `MeshStandardMaterial`, `MeshPhysicalMaterial` e `LightShadow`.
- SMAA: Enhanced Subpixel Morphological Antialiasing.
- NVIDIA: survey de temporal antialiasing e riscos de reprojecao/history em conteudo com movimento rapido.
