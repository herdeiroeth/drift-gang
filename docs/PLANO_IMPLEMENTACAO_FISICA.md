# Plano de Implementacao — Nova Fisica de Drift 3D

> **Objetivo:** Substituir a fisica atual (flutuante) pelo modelo de Marco Monster adaptado para Three.js 3D, eliminando o feel de flutuacao e adicionando drift realista com slip angles, inercia angular e transferencia de peso.

**Arquitetura:** Manter Input, SmokeSystem, SkidSystem, CamCtrl, buildArena, setupEnv e Game intactos. Substituir apenas a classe `Car` e ajustar `Game.updateHUD()` para a nova telemetria.

**Arquivo alvo:** `main.js`

---

### Tarefa 1: Criar classe CarConfig

Adicionar antes da classe `Car`.

Valores calibrados para drift arcade em arena aberta:
- mass: 1200, inertiaScale: 1.0
- cgToFrontAxle: 1.25, cgToRearAxle: 1.25, cgHeight: 0.55
- tireGrip: 2.0, lockGrip: 0.7
- engineForce: 8000, brakeForce: 12000, eBrakeForce: 4800
- maxSteer: 0.55 rad
- cornerStiffnessFront: 5.0, cornerStiffnessRear: 5.2
- airResist: 2.5, rollResist: 8.0
- weightTransfer: 0.2
- gravity: 9.81

---

### Tarefa 2: Refatorar classe Car — Estado e Setup

Substituir a classe `Car` inteira.

Novos atributos:
- `heading`, `position` (Vector3), `velocity` (Vector3)
- `velocityLocal` (Vector3), `accel`, `accelLocal`
- `absVel`, `yawRate`
- `steer` (-1..1), `steerAngle`
- `forward`, `right` (Vector3) — atualizados todo frame
- `config` (CarConfig)
- `inertia`, `wheelBase`, `axleWeightRatioFront`, `axleWeightRatioRear`
- `nitroT`, `nitroCd` (mantidos do codigo original)
- `onGround` (bool)

Construtor: inicializa config e calcula valores derivados.

buildVisuals, fwd, right, wheelWorld, reset: manter comportamento similar.

---

### Tarefa 3: Implementar loop fisico doPhysics(dt)

Seguir o modelo do spacejack/Car.js passo-a-passo:

1. Atualizar vetores forward/right a partir de heading
2. Decompor velocity mundial em local (dot com forward/right)
3. Transferencia de peso dinamica (usar accelLocal.x do frame anterior)
4. Calcular yawSpeedFront/Rear = yawRate * distancia_ao_CG
5. Slip angles front e rear com atan2
6. Grip traseiro reduzido pelo e-brake
7. Forca lateral saturada (clamp) por eixo
8. Forcas longitudinais: throttle - brake*sign(vx) - drag - rollingResist
9. Total force local, converter para aceleracao local (F/m)
10. Converter aceleracao para mundo
11. Integrar velocidade
12. Yaw torque = flatF * cgToFrontAxle - flatR * cgToRearAxle
13. Integrar yawRate e heading
14. Integrar posicao (x, z)
15. Grounding: raycast simples ou clamp Y=0.3
16. Estabilidade: parar se absVel < 0.5 e sem throttle

---

### Tarefa 4: Implementar steering suavizado

- applySmoothSteer(input, dt): lerp em direcao ao input, volta ao centro quando solto
- applySafeSteer: limita steer pela velocidade (1 - vel/280)
- Atualizar steerAngle = steer * maxSteer

---

### Tarefa 5: Adaptar deteccao de drift e telemetria

Drift = |slipAngleRear| > 0.3 rad E |velocityLocal.x| > 5 m/s
(ou ebrake ativo)

Retornar objeto de telemetria:
- speed (absVel)
- forwardSpeed (velocityLocal.x)
- lateralSpeed (velocityLocal.z)
- isDrifting
- driftAngle (|slipAngleRear|)
- slipAngleFront, slipAngleRear

---

### Tarefa 6: Adaptar Game.updateHUD()

Manter a logica de combo mas usar `telem.driftAngle` (ja e o slipAngleRear).
Ajustar threshold de combo se necessario.

---

### Tarefa 7: Testar no navegador

Verificar:
- Carro nao flutua (grounding funciona)
- Aceleracao tem peso (top speed natural)
- E-brake inicia drift
- Contra-esterço funciona
- Skid marks e fumaça aparecem durante drift
- HUD mostra velocidade e score corretamente
- Reset (R) funciona
- Camera (C) funciona

---

### Tarefa 8: Ajustar parametros

Se o carro estiver muito lento: aumentar engineForce.
Se estiver muito rapido: aumentar airResist.
Se nao driftar: aumentar cornerStiffnessRear ou diminuir tireGrip.
Se driftar demais: aumentar tireGrip ou cornerStiffnessRear.
Se o steering for muito rapido: ajustar maxSteer ou safeSteer.
