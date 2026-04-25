# Changelog - Correções de Bugs (25 de Abril)

Este documento registra as três correções críticas aplicadas na implementação do modelo físico (Marco Monster) em `main.js`.

## 1. Correção do Crash no Loop Principal (Física)
- **Problema:** O jogo congelava completamente ao apertar a tecla "Espaço" para iniciar, sem processar nenhum input ou animação.
- **Causa:** Um `ReferenceError` disparado pela função `doPhysics()`. A variável `wheelData` estava sendo instanciada internamente como constante em um bloco de *sub-stepping* (`const wheelData = [];`), mas a função tentava utilizá-la fora do escopo no comando `return`.
- **Solução:** A declaração de `wheelData` foi movida para o topo da função (`let wheelData = [];`) e re-inicializada no interior do loop, permitindo que a telemetria do pneu fosse corretamente calculada e entregue ao sistema de HUD (slip angles/ratios).

## 2. Correção da Orientação da Câmera Chase
- **Problema:** A câmera principal do jogo estava acompanhando a parte frontal do carro (vendo o para-choque), tornando a condução inviável.
- **Causa:** Na classe `CamCtrl`, o vetor de *offset* Z da câmera tipo `chase` possuía um valor positivo (`+8.5`), colocando a visão fisicamente à frente do eixo +Z do carro.
- **Solução:** O *offset* de profundidade foi invertido para `-8.5` (`const off=new THREE.Vector3(0,3.8,-8.5);`). Isso reposicionou adequadamente a câmera para a traseira do veículo.

## 3. Correção da Rotação Visual e Esterçamento das Rodas
- **Problema:** As rodas traseiras pareciam esterçar sozinhas quando o carro fazia curvas, e as rodas dianteiras pivotavam de maneira errada, ignorando o chassi.
- **Causa:** A malha (`mesh`) visual de cada roda estava recendo apenas o valor do esterçamento (`w.steerAngle`) no eixo Y global, ignorando a inclinação (`pitch`), rolagem (`roll`) e principalmente a rotação global da carroceria do veículo (`heading`).
- **Solução:** Foi aplicado um ajuste no loop da função `update()`, definindo a orientação visual completa para todas as quatro rodas baseada no corpo principal do carro somado ao ângulo de direção: 
  `w.mesh.rotation.set(this.pitch, this.heading + w.steerAngle, -this.roll, 'YXZ');`
  Com isso, as rodas traseiras (`steerAngle = 0`) permanecem rígidas com a carroceria, enquanto as dianteiras esterçam com precisão em relação à direção em que o chassi aponta.
