# DriftGang

🏎️ **纯前端 3D 漂移模拟器** — 基于 Three.js 的零物理引擎漂移赛车游戏。自定义 RWD 物理、Pacejka 轮胎模型、模块化动力总成，全部用 Vanilla JS 实现。

🏎️ **Front-end 3D drift simulator** — Zero-physics-engine drift racing game built on Three.js. Custom RWD physics, Pacejka tire model, and modular powertrain, all in Vanilla JS.

[![zh](https://img.shields.io/badge/lang-zh--CN-blue.svg)](/README.md) [![en](https://img.shields.io/badge/lang-en-red.svg)](/README.md)

![zh](https://img.shields.io/badge/lang-zh--CN-blue.svg)
![en](https://img.shields.io/badge/lang-en-red.svg)

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/herdeiroeth/drift-gang)
[![Tests](https://img.shields.io/badge/tests-42%20passing-brightgreen)](https://github.com/herdeiroeth/drift-gang)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)
[![Three.js](https://img.shields.io/badge/three.js-^0.184.0-orange)](https://threejs.org)
[![Vite](https://img.shields.io/badge/vite-^8.2.1-purple)](https://vitejs.dev)

---

`DriftGang` 是一个轻量级 3D 漂移赛车模拟器，100% 客户端运行。物理引擎完全自研，无 Cannon/Rapier 依赖。特点包括：Pacejka 魔术公式轮胎模型、模块化动力总成（发动机→离合器→变速箱→差速器→车轮）、实时调校 UI、赛道圈速计时、2D 赛道编辑器。

`DriftGang` is a lightweight 3D drift racing simulator that runs 100% client-side. Its physics engine is completely custom — no Cannon/Rapier dependency. Features include: Pacejka Magic Formula tires, modular powertrain (Engine→Clutch→Gearbox→Differential→Wheels), real-time tuning UI, lap timing, and a 2D track editor.

**⚠️ 注意：** 此项目不包含后端或身份验证。所有数据存储在 `localStorage` 中。GLB 车型资产需要单独下载（CC-BY 4.0）。

**⚠️ Note:** This project has no backend or authentication. All data is stored in `localStorage`. The GLB car model asset is external (CC-BY 4.0).

---

## ✨ 功能特性 / Features

| 特性 | 说明 |
|------|------|
| 🏎️ 自定义 RWD 物理 | 4×子步进半隐式欧拉积分，独立悬挂每轮 |
| 🔧 Powertrain 模块化 | 发动机（含扭矩曲线、怠速控制、限速器）、离合器（Karnopp 摩擦模型）、变速箱（H 型/序列式，含转速匹配）、差速器（开放式/焊接式/LSD/Torsen）、涡轮增压器、牵引力控制、起步控制 |
| 🛞 Pacejka 魔术公式轮胎 | 侧向+纵向抓地力，摩擦椭圆耦合，负载敏感性，轮胎温度+衰退模型 |
| 🎮 调校 UI | ForzaTune 风格面板，含最终传动比、各档位齿比、差速器设置、悬挂参数、预设系统 |
| 🏁 赛道+计时系统 | 分段计时、最佳圈速持久化、无效圈检测 |
| ✏️ 2D 赛道编辑器 | 在游戏内编辑赛道布局，支持碰撞点拖拽、持久化到 localStorage |
| 📊 遥测+HUD | 可拖拽遥测面板、轮胎温度显示、抓地力探测、漂移计分+连击 |
| 🎥 多视角相机 | 追逐/引擎盖/轨道模式 + Studio UI |
| 💨 粒子效果 | 烟雾系统（GPU 粒子）+ 轮胎痕迹（动态四边形） |
| 🔦 动态车灯 | PBR 材质、车灯控制、灯光秀 |

---

## 📦 快速开始 / Quick Start

```bash
# 克隆仓库 / Clone the repository
git clone <repo-url>
cd drift-gang

# 安装依赖 / Install dependencies
pnpm install

# 启动开发服务器 / Start dev server
pnpm dev

# 构建生产版本 / Production build
pnpm build

# 运行测试 / Run tests
pnpm test
```

打开 Vite 输出的 URL（默认 `http://localhost:5173/`），按 **空格键** 开始游戏。

Open the URL printed by Vite (default `http://localhost:5173/`), press **Space** to start.

> **注意：** 此项目使用 `pnpm` 作为包管理器。如果环境中设置了 `NODE_ENV=production`，请使用 `NODE_ENV=development pnpm install` 确保 devDependencies（如 Vite）被安装。
>
> **Note:** This project uses `pnpm` as the package manager. If `NODE_ENV=production` is set in your environment, use `NODE_ENV=development pnpm install` to ensure devDependencies (like Vite) are installed.

---

## 🚀 使用方法 / Usage

### 控制器 / Controls

| 按键 | 操作 |
|-------|------|
| `W` / `↑` | 加速 / Accelerate |
| `S` / `↓` | 刹车/倒车 / Brake / Reverse |
| `A` / `D` / `←` / `→` | 转向 / Steer |
| `Shift` | 手刹 / Handbrake |
| `Ctrl` | 离合器（按住时间=踩下深度） / Clutch (press duration = pedal depth) |
| `Space` | 氮气加速 / Nitro / Start |
| `Q` / `E` | 降档/升档 / Shift down/up |
| `T` | 切换 TC 模式 / Cycle TC mode |
| `Y` | 切换差速器类型 / Cycle diff type |
| `U` | 切换变速箱模式 / Cycle gearbox mode |
| `L` | 启用/禁用起步控制 / Toggle launch control |
| `K` | 打开调校面板 / Open Tuning UI |
| `C` | 切换视角 / Cycle camera |
| `V` | Camera Studio |
| `F` / `G` | 车灯 / 灯光秀 / Lights / Light show |
| `H` | 切换遥测面板 / Toggle telemetry |
| `M` | 打开赛道编辑器 / Open track editor |
| `R` | 重置车辆 / Reset car |

### 预设 / Presets

通过调校面板（按 `K`）可加载预设：

| 预设 | 风格 |
|-------|------|
| Drift Beginner | 新手漂移（宽容度高的操控） |
| Drift Pro | 高级漂移（更真实的物理反馈） |
| Track | 赛道驾驶（高抓地力） |
| Burnout | 烧胎模式（锁定差速器+高转速） |

---

## 🔧 架构 / Architecture

```
Browser (ES modules)
├── Vite dev/build
├── Three.js (render, loaders GLTF/HDR, Sky, PMREM)
├── Game loop
│   ├── Input → Car.doPhysics (4× sub-stepping)
│   │            ├── Wheels + Tire (Pacejka MF)
│   │            └── PowertrainSystem
│   │                ├── Engine (torque curve, idle, rev-limit, coast)
│   │                ├── Clutch (Karnopp tanh friction model)
│   │                ├── Gearbox (H-pattern / sequential, auto-shift, gating)
│   │                ├── Differential (open / welded / LSD / torsen)
│   │                ├── TractionControl (PID slip-target)
│   │                ├── LaunchControl (2-step rev limiter)
│   │                └── Turbocharger (exponential spool, blow-off)
│   ├── Track / LapSystem / Scenery
│   ├── Particles (smoke GPU, skid quads)
│   └── HUD + TuningUI + CameraStudio + Telemetry
└── localStorage (setup, camera, track edits, best laps)
```

### 物理管线 / Physics Pipeline

1. **输入处理** — 键盘/手柄轴
2. **悬挂更新** — 每轮独立射线检测 + 弹簧/阻尼器
3. **负载转移** — 防倾杆、纵向（含防点头/防蹲）、侧向
4. **Ackermann 转向** — 内轮比外轮转更多
5. **Powertrain** — 发动机扭矩 → 离合器 → 变速箱 → 差速器 → 车轮
6. **轮胎力** — Pacejka Magic Formula + 摩擦椭圆 + 温度模型
7. **SAT** — 主销回正力矩（机械拖距+气动拖距）
8. **车身积分** — 半隐式 Euler，4×子步进

### 项目结构 / Project Structure

```
drift-gang/
├── index.html                 # 入口点 + 叠加层 / Entry point + overlays
├── style.css                  # 全局样式 / Global styles
├── package.json
├── vitest.config.js           # 测试配置 / Test configuration
├── LICENSE                    # MIT 许可证 / MIT License
├── .npmrc                     # 包管理器配置 / Package manager config
├── CLAUDE.md                  # AI 开发指南 / AI dev guide
├── test/                      # 单元测试 / Unit tests
│   ├── tire.test.js           #   Pacejka 轮胎模型测试 / Tire model tests
│   └── powertrain.test.js     #   动力总成测试 / Powertrain tests
├── public/
│   ├── models/                # GLB 资产（未版本化） / GLB assets (not versioned)
│   └── textures/              # 纹理 / Textures (asphalt, grass, sky)
├── src/
│   ├── main.js                # 入口 / Entry point
│   ├── powertrain.js          # 动力总成系统 / Powertrain system
│   ├── core/                  # 游戏核心 / Game core
│   │   ├── Game.js            #   游戏循环 / Game loop
│   │   ├── Input.js           #   输入处理 / Input handling
│   │   └── constants.js       #   游戏常量 / Constants
│   ├── physics/               # 物理引擎 / Physics engine
│   │   ├── Car.js             #   车辆主类 / Car class
│   │   ├── CarConfig.js       #   车辆配置 / Car configuration
│   │   ├── Wheel.js           #   车轮 + 悬挂 / Wheel + suspension
│   │   ├── Tire.js            #   Pacejka 轮胎模型 / Tire model
│   │   └── SuspensionCorner.js # 单轮悬挂 / Corner suspension
│   ├── rendering/             # 3D 渲染 / 3D rendering
│   │   ├── Camera.js          #   相机控制 / Camera controls
│   │   ├── Environment.js     #   环境 / Environment
│   │   ├── Arena.js           #   竞技场 / Arena
│   │   ├── Scenery.js         #   场景装饰 / Scenery
│   │   ├── car/               #   车辆视觉 / Car visuals
│   │   ├── materials/         #   PBR 材质 / PBR materials
│   │   └── particles/         #   粒子系统 / Particles
│   ├── tracks/ + track/       # 赛道系统 / Track system
│   ├── editor/                # 赛道编辑器 / Track editor
│   ├── hud/ + ui/ + tuning/   # 界面 / UI
│   └── audio/                 # 音效 / Audio FX
└── docs/                      # 开发文档 / Design docs
```

---

## 🧪 测试 / Tests

```bash
pnpm test            # 运行所有测试 / Run all tests
pnpm test:watch      # 监视模式 / Watch mode
```

目前 42 个测试覆盖：

| 模块 | 测试数量 | 覆盖内容 |
|------|---------|---------|
| `Tire.js` | 22 | Pacejka MF 侧向/纵向、摩擦椭圆、胎温、负载敏感性、拖距、外倾角因素 |
| `powertrain.js` | 20 | 发动机扭矩/限速/惯性、离合器摩擦/滑移、变速箱换挡/齿比、差速器 split、涡轮增压 |

42 unit tests currently cover:
| Module | Tests | Coverage |
|--------|-------|----------|
| `Tire.js` | 22 | Pacejka MF lateral/longitudinal, friction ellipse, tire temp, load sensitivity, trail, camber |
| `powertrain.js` | 20 | Engine torque/rev-limiter/inertia, clutch friction/slip, gearbox shifting/ratios, diff split, turbo |

---

## ⚠️ 已知限制 / Known Limitations

| 方面 | 状态 | 说明 |
|------|------|------|
| 3D 车型资产 | 外部 | `bmw_m4_f82.glb` 不在仓库中（CC-BY 4.0），需手动下载 |
| 听感 | 未实现 | 引擎声音、轮胎尖叫、涡轮泄气阀等音效待开发 |
| 多人在线 | 未实现 | 本地分屏/网络多人待开发 |
| AWD | 未实现 | 目前仅 RWD，AWD 需要中差+前差 |
| 天气 | 未实现 | 雨天/湿地物理待开发 |
| GLB 依赖 | 可选 | 无 GLB 时会回退到程序化生成的车辆视觉 |
| 大块 JS | ~846KB | 代码拆分（code splitting）待优化 |

| Aspect | Status | Note |
|--------|--------|------|
| 3D car asset | External | `bmw_m4_f82.glb` not in repo (CC-BY 4.0), download required |
| Audio | TODO | Engine sounds, tire screech, turbo blow-off |
| Multiplayer | TODO | Local split-screen / network multiplayer |
| AWD | TODO | Currently RWD only |
| Weather | TODO | Rain/wet surface physics |
| GLB dependency | Optional | Falls back to procedural car visuals |
| Chunk size | ~846KB | Code splitting needs optimization |

---

## 📄 许可证 / License

MIT © [herdeiroeth](https://github.com/herdeiroeth)

3D 车型资产：CC-BY 4.0（详见 `public/models/README.md`）

Three.js / Vite：各自包的许可证适用范围。

使用 ❤️ 和纯 JavaScript 打造，无第三方物理引擎。

Built with ❤️ and zero third-party physics engines.
