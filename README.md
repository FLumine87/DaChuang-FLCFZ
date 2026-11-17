# 基于动态跨模态哈希检索和 RAG 的心理筛查预警系统

面向高校心理健康的筛查与预警平台。学生端用文字、语音、照片、量表四种方式记录近况，
系统把它们编码到同一套哈希空间里做**跨模态相似检索**，再结合规则与大模型给出分析结论；
管理端负责复核、预警处置、案例跟进与智能研判。

- 前端：React 19 + TypeScript + Vite + TailwindCSS 4
- 主后端：Python 3.11 标准库 HTTP 服务（本地 SQLite / 线上 Cloudflare Workers + D1）
- 个人端：FastAPI + Neo4j + OpenAI 兼容大模型接口
- 检索引擎：CMFH + 「时间窗 × 位带」多哈希表 + 跨模态桥接

## 功能一览

### 学生端

- **首次引导与仪表盘**：新用户完成引导后进入工作台；仪表盘汇总近期筛查、预警与待办
- **心理筛查**（`/personal/screening`）：五个标签页
  - 文字记录 / 语音上传 / 照片上传 / 量表填写 / 检索与分析
  - 每次提交后立即返回哈希检索报告：风险档位色条、相似度条、命中模态与依据
- **筛查记录**（`/personal/records`）：按时间回看提交过的内容与当时的结论
- **预警与案例**：查看自己的预警记录、案例档案与关键时间线
- **复核任务**：需要本人确认的筛查复核
- **AI 陪伴对话**：拼接人设、个人知识图谱与最近对话后调用大模型；未配置 Key 时回退本机文案并如实标注
- **个人知识图谱 / 内容推荐**：对话内容抽取三元组写入 Neo4j，图谱随记录生长
- **账号设置**（`/personal/settings`）：改资料、改密码

### 管理端

- **仪表盘**：筛查总量、预警分布、趋势与最新预警
- **筛查管理与数据采集**：问卷模板、筛查记录、多模态数据查看
- **复核**：处理学生提交的复核请求
- **检索与分析**：文字 / 语音 / 图像 / 现场拍照四种查询；命中结果可加载单元媒体并放大查看
- **预警研判与处置**：在一个工作台查看群体筛查、处理预警、核对个案证据与审核随访任务。合成个案可选用 DeepSeek 生成复核草案，账号设置里可开关（默认开启）。
- **案例档案**：表格列表 + 右侧抽屉（筛查记录 / 跟进记录两个页签）

- **Agent 工作台**：个人端 Agent 的调试与验收入口
- **账号设置**：与管理端共用同一套账号接口

## 动态跨模态哈希检索

检索模块把文本 / 图像 / 语音映射到同一套 64 位二值码空间，用「时间窗 × 位带」多哈希表做快速匹配，
支持任意模态查询、任意模态结果，并返回可解释信息（命中主题、查询码、候选数、探测桶数）。

### 引擎要点

| 机制 | 说明 |
|---|---|
| CMFH | 协同矩阵分解哈希，共享二值码 + 各模态投影矩阵，目标中含记录级主题/情绪相似度 `λS` |
| **特征通道化** | 把「模态」细分为「特征通道」：每个（模态 × 特征空间）一个投影矩阵（如 `text@531` / `audio@64` / `audio@2048` / `image@192` / `image@98`），各通道只拟合自己那批样本，但**共享同一个 64 位码空间**。不同数据集的同模态特征因此不会互相拉偏；某通道在某数据集上没有数据时按「缺失视图」处理（Gram 贡献记 0）。实测九格均值 0.3656 → 0.5207 |
| 时间窗模型池 | 每个窗口独立训练一套 CMFH，`WindowModelBank` 按窗口保存；当前 `HASHING_WINDOW_DAYS=122` |
| 多哈希表 | 64 位码切 8 张位带表（每带 8 位），位带内探测 2 比特，汉明半径 16 内不漏召回 |
| 非对称距离 | 库端存二值码、查询端用连续向量，得分 `u·s/(‖u‖√K)` 后归一化，避免查询端量化损失 |
| 多窗口融合 | 相似度 × 表权重 × 查询自适应因子；表权重由 ρ、σ、冗余度、时效衰减、标签覆盖率组成 |
| 弱表淘汰 | 每窗独立评估 σ（编码信息量）与 ρ（语义一致性），低于阈值的表不参与探测 |
| 跨模态桥 | 文-图（λ=20）、音-图（λ=50）各一条独立 CMFH 桥；图像侧用细调 MobileNetV2 CNN 特征 |
| 模态轮转 | 未指定结果模态时各模态各取 top-k 再交错，避免结果页被查询模态占满 |
| 动态增量 | 新记录写入后立即可检索，无需全量重训 |

### 当前语料规模

`backend/data/hashing/real_corpus.db`（本地生成，不入库）现有 **5876 条记录 / 16398 个单元**：

| 数据集 | 文本 | 语音 | 图像 |
|---|---:|---:|---:|
| EATD-Corpus | 486 | 486 | — |
| CSEMOTIONS | 4160 | 4160 | — |
| FER2013 | — | — | 4646 |
| AVDD-TCMI | — | 1230 | 1230 |
| **合计** | **4646** | **5876** | **5876** |

> AVDD-TCMI 含两个子集：**HDS**（华西医院面诊，282 条，临床确诊）与 **SDS**（中学筛查，948 条）。

### AVDD-TCMI 音-图强配对

AVDD-TCMI 的同一受试者同时提供 1024 维帧级音频特征与人脸望诊信息（OpenFace 2.0 的
AU / 头姿 / 眼动），属于**真实同源强配对**——这是本项目唯一「图像 ↔ 音频」的真同源数据，
FER2013 的表情图与任何模态都不同源。

接入方式：**走与其他数据集完全相同的标准适配器**，进入同一份语料、同一次训练、同一个索引，
不新增页面与接口：

```powershell
# 构建语料（--with-avdd 额外接入 AVDD-TCMI）
$env:DACHUANG_ASSETS_ROOT = "D:\DaChuang\dataset"
backend\venv\Scripts\python.exe backend\scripts\build_real_corpus.py `
    --dataset all --with-avdd --queries 280 --out backend\data\hashing\real_corpus.db

# 重建索引（通道化后 W 的键变为 modality@dim，需重训一次）
# 停掉后端后删除 backend\data\hashing\index.db 与 hashing_state.json，再启动后端
```

通道化后 AVDD 落到两个独立通道：`audio@2048`（声学特征池化）与 `image@98`（OpenFace 人脸行为），
音↔图的同源约束由监督矩阵 `S` 表达为强约束。实测 AVDD 的音↔图同记录汉明距离
**20.53**（随机配对 30.17），对齐强度 **+9.63 位**。

> 数据集本身不随仓库分发，需自行下载解压到仓库外，目录结构与下载说明见
> [offline/datasets/README.md](./offline/datasets/README.md)。

## 数据集与配对关系

三个公开数据集 + AVDD-TCMI 均**不随仓库分发**，需自行放到仓库外（默认 `D:\DaChuang\`），
目录结构与下载说明见 [offline/datasets/README.md](./offline/datasets/README.md)。

| 数据集 | 模态 | 标签 | 在本项目中的角色 |
|---|---|---|---|
| EATD-Corpus（ICASSP 2022，中文） | 语音 + 中文转写 | SDS（≥53 判抑郁，30:132 不平衡） | 真实抑郁主轴 |
| CSEMOTIONS（Apache-2.0，中文） | 语音 + 中文文本 | 7 类情绪 | 语音/文本情绪 |
| FER2013 | 48×48 灰度人脸 | 7 类表情 | 图像模态 |
| AVDD-TCMI | 音频特征 + 人脸望诊信息 | 受试者级（临床确诊 / 筛查） | 音-图**强配对** |

**配对关系（论文/答辩必须如实说明）**

- 文本 ↔ 语音：EATD 的 `.wav` 与同名 `.txt`、CSEMOTIONS 每条音频与其文本，都是**真实同源配对**
- 图像 ↔ 文本/语音：FER2013 是纯图像集，按情绪语义挂接到记录上，属**弱配对**
  （`meta.fer.attach_mode` 已标注）
- 音频 ↔ 图像：只有 AVDD-TCMI 是同一受试者的**真实强配对**（HDS 临床确诊 / SDS 筛查两个子集）

> 同源关系由数据集适配器在构建记录时声明（`records.pairing_type`），引擎据此在监督矩阵里
> 把同源对提到强约束、其余走主题弱监督；`scripts/datasets/avdd_tcmi.py` 是 AVDD 的接入点。

引擎的配对训练要求同组记录模态集合一致，纯图像记录与「文本+语音」记录混在一起会让模态交集为空，
因此 FER2013 图像以弱配对方式挂接，这一点无法用实现绕过。

### 三档体验

| 档位 | 数据源 | 适用场景 |
|---|---|---|
| 开箱即用 | `backend/data/hashing/corpus.db`（随仓库发布，900 单元合成语料） | clone 即跑通链路、演示前端交互 |
| 真实语料 | `backend/data/hashing/real_corpus.db`（离线构建，不入库） | 真实中文语音 / 文本 / 人脸 / 面诊图的跨模态检索 |
| 指标复现 | 同上，跑评测脚本 | 复现 mAP / 跨模态类别一致率 / 效率 |

引擎启动时优先读 `real_corpus.db`，缺失则自动回退到 `corpus.db`。

## 技术栈

### 前端

| 技术 | 版本 |
|---|---|
| React / React DOM | 19.2 |
| TypeScript | 5.9 |
| Vite | 7.3 |
| TailwindCSS | 4.2 |
| React Router | 7.13 |
| Recharts | 3.8 |
| Lucide React | 0.577 |
| Playwright（测试） | 1.64 |

### 后端

**主后端 `backend/`**：基于标准库 `ThreadingHTTPServer` 的轻量 HTTP 服务（不再使用 FastAPI + uvicorn）。
本地用 SQLite，线上跑 Cloudflare Workers + D1，同一套代码通过双模式数据访问层切换；
表结构变更由启动时的迁移守卫自动补齐，不使用 Alembic 迁移链。

**个人端 Agent `personal-backend/`**：FastAPI + Uvicorn，知识图谱存 Neo4j，
大模型走 OpenAI 兼容接口，无 Key 时降级为内置 Mock。

两个服务共同依赖 Python 3.11+、numpy + Pillow 多模态特征。

## 项目结构

```
DaChuang-FLCFZ/
├── backend/
│   ├── app/
│   │   ├── core/                 # 请求上下文、响应、鉴权
│   │   ├── db/                   # SQLite 访问层与迁移守卫
│   │   ├── engines/
│   │   │   ├── hashing/          # CMFH、特征通道化、同源分组监督、窗口模型池、多哈希表、跨模态桥
│   │   │   ├── multimodal/       # 文本 / 语音 / 图像特征
│   │   │   ├── rag/              # RAG 报告
│   │   │   └── agent/            # 研判与 Agent 能力
│   │   ├── handlers/             # auth / screening / retrieval / alerts / cases ...
│   │   ├── services/
│   │   ├── config.py
│   │   ├── main.py / server.py / router.py
│   ├── data/
│   │   ├── hashing/              # corpus.db 随仓库；real_corpus.db、索引、桥接权重本地生成
│   │   └── avdd_media/           # AVDD 面诊图（本地生成）
│   ├── scripts/                  # 语料构建、数据集下载、桥接训练、九格评测
│   │   └── datasets/             # 各数据集适配器（eatd / csemotions / fer2013 / avdd_tcmi）
│   ├── tests/                    # 冒烟与验收脚本
│   ├── worker/                   # Cloudflare Worker 部署代码与 D1 seed
│   ├── start.bat / start.sh
│   ├── requirements.txt
│   └── Dockerfile
├── personal-backend/             # FastAPI + Neo4j + LLM（对话 / 图谱 / 推理 / 推荐）
│   ├── app/api/v1/  app/services/  app/schemas/
│   └── start.bat
├── frontend/
│   ├── src/
│   │   ├── pages/                # 学生端页面
│   │   ├── admin/pages/          # 管理端页面
│   │   ├── components/           # 公共组件（含 AI 陪伴形象）
│   │   ├── services/             # API 封装
│   │   └── assets/
│   ├── scripts/                  # 单文件演示打包
│   ├── package.json
│   └── Dockerfile
├── docs/                         # PRD / API / 部署 / 开发记录
├── offline/datasets/             # 数据集存放说明（内容不入库）
├── 启动项目.bat / start_project.ps1 / stop_project.ps1
├── 配置大模型API.bat / configure_api.ps1
├── 启动本地环境.command / 启动本地环境-连后端.command   # macOS
├── docker-compose.yml
└── README.md
```

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+（推荐 20 LTS）
- npm 9+
- 可选：Docker（Neo4j、容器化部署）

### 获取代码

仓库保留了完整开发历史，历史中包含早期提交的大模型文件，完整 `clone` 约 75MB。
只使用最新代码时建议**浅克隆**（约 5–8MB）：

```bash
git clone --depth 1 git@github.com:FLumine87/DaChuang-FLCFZ.git
```

需要查看历史提交时再执行 `git fetch --unshallow` 补全。

以下大文件不在最新代码中，首次使用前需补齐到 `backend/models/`：

| 文件 | 体积 | 获取方式 |
| --- | --- | --- |
| `bge-small-zh.onnx` | 约 91MB | `python backend/scripts/fetch_bge_model.py`，或从已部署环境拷贝 |
| `mobilenetv2-fer.onnx` | 约 8.5MB | 仅 `HASHING_IMAGE_FEATURE=cnn` 时需要 |

缺失时服务仍可启动：文本特征降级为 TF 275 维，检索精度下降，启动日志会提示。

### 一键启动（Windows，推荐）

双击 `启动项目.bat`，或：

```powershell
.\start_project.ps1             # 启动全部服务并打开浏览器
.\start_project.ps1 -NoBrowser  # 只起服务
.\start_project.ps1 -SkipAgent  # 只起主后端 + 前端
.\stop_project.ps1              # 停止
```

脚本会依次：补齐 Python 依赖、创建 personal-backend 的 venv 与 `.env`、判断 Neo4j 走本机还是 Docker、
首次灌入知识图谱种子、按端口等待服务就绪。已占用的端口会跳过；`:5173` 被占用时前端自动换端口。

| 服务 | 地址 |
|---|---|
| 前端 | http://localhost:5173 |
| 主后端 | http://localhost:8000 |
| 个人端 Agent | http://localhost:8001（自带 `/docs`） |
| Neo4j Browser | http://localhost:7474 |

前端默认连真实后端（`VITE_USE_MOCK=false`），接口失败会直接报错，不会静默回退演示数据。

### macOS

双击 `启动本地环境-连后端.command`（连真实后端）或 `启动本地环境.command`。

### 手动启动

```bash
# 主后端
cd backend
start.bat            # Windows
./start.sh           # Linux/macOS

# 个人端 Agent（可选）
cd personal-backend
uvicorn app.main:app --host 0.0.0.0 --port 8001

# 前端
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173/
```

### 纯前端演示（不需要后端）

```bash
cd frontend
npm run dev:demo     # 内置演示数据
```

单文件演示版：`npm run build:single`。

### 演示账号

| 角色 | 账号 |
|---|---|
| 学生端 | `xiaoyu / 123456` |
| 管理端 | `adminer / admin`、`admin / admin123` |

## 配置

### 大模型 API（可选）

RAG 报告、AI 陪伴、推荐语、日常问询共用同一个 OpenAI 兼容接口。双击 `配置大模型API.bat`
（或 `.\configure_api.ps1`），按提示粘贴 Key 即可，内置 DeepSeek / 通义千问 / 智谱 GLM / OpenAI 预设。

- Key 只写入 `backend/.env` 与 `personal-backend/.env`，两个文件均已被 `.gitignore` 忽略
- 不配置也能跑通：相关功能自动降级为内置 Mock
- 还原离线模式：`.\configure_api.ps1 -RestoreOffline`

### 哈希引擎参数（`backend/.env`）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HASHING_USE_MOCK` | False | False = 真实 CMFH + 多哈希表 |
| `HASHING_USE_CORPUS` | True | 使用预构建语料库作为检索数据源 |
| `HASHING_CODE_LENGTH` | 64 | 哈希码长度 |
| `HASHING_BAND_BITS` | 8 | 每条位带的比特数 |
| `HASHING_PROBE_BITS` | 2 | 位带内探测翻转的比特数 |
| `HASHING_LAMBDA_S` | 0.6 | CMFH 中记录级相似度权重 |
| `HASHING_LAMBDA_STRONG` | 1.0 | 同源对（文↔音、音↔图）的强约束权重 |
| `HASHING_WINDOW_DAYS` | 122 | 时间窗跨度（天） |
| `HASHING_EPOCH` | 2025-08-01 | 时间窗起点 |
| `HASHING_TABLE_RHO_MIN` | 0.10 | 表的语义一致性下限 |
| `HASHING_TABLE_SIGMA_MIN` | 0.02 | 表的编码信息量下限 |
| `HASHING_BALANCE_MODALITIES` | True | 混合视图按模态轮转交错 |

完整参数见 [backend/.env.example](./backend/.env.example)。

## 语料构建与评测

```bash
cd backend

# 三模态真实语料（EATD + CSEMOTIONS + FER2013）
python scripts/build_real_corpus.py
python scripts/build_real_corpus.py --dataset eatd   # 其他取值：csemotions | fer | all

# 额外接入 AVDD-TCMI（音↔图真同源；需先下载解压到仓库外）
python scripts/build_real_corpus.py --dataset all --with-avdd
python scripts/download_datasets.py --dataset avdd    # 约 14.5 GB，走国内镜像

# 跨模态桥（文-图 / 音-图）
python scripts/build_bridges.py --pair text  --lambda-s 20
python scripts/build_bridges.py --pair audio --lambda-s 50

# 演示与评测
python scripts/demo_hashing.py        # 索引概览 + 三模态查询 + 动态增量
python scripts/eval_retrieval.py      # mAP / 跨模态类别一致率 / 效率 → data/hashing/eval_report.json
python scripts/eval_dynamic.py        # 动态增量与窗口融合
python scripts/eval_bridge_audio.py   # 音-图桥接
python scripts/eval_modality_matrix.py  # 九格（文/音/图 × 文/音/图）mAP@10
```

### 九格检索矩阵（通道化后）

`scripts/eval_modality_matrix.py` 在 4646 条记录 / 653 条查询上给出九个格子的 mAP@10。
通道化（特征通道化 + 同源分组监督）把它从 **0.3656 提到 0.5207**：

| 格子 | 通道化前 | 通道化后 |
|---|---:|---:|
| 文搜文 | 0.6145 | 0.6264 |
| 文搜音 | 0.3925 | 0.3859 |
| 文搜图 | 0.4316 | 0.4875 |
| 音搜文 | 0.4128 | 0.6035 |
| 音搜音 | 0.3744 | 0.4043 |
| 音搜图 | 0.3192 | 0.4802 |
| 图搜文 | 0.2609 | 0.7629 |
| 图搜音 | 0.2718 | 0.4185 |
| 图搜图 | 0.2123 | 0.5171 |
| **九格均值** | **0.3656** | **0.5207** |

> 提升主要来自**图像终于有了自己的投影矩阵**：此前图像退出配对训练、单元的码是借来的，
> 图像检索实为文本检索的镜像。评测产物见
> `backend/data/hashing/eval_nine_grid_unified.json`。
> ⚠️ 重训存在约 ±2 点的随机波动（训练抽样未固定 seed），做 A/B 对比前请先固定 seed。

最近一次写入 `eval_report.json` 的评测基于 1686 条双模态语料（当时的语料规模）：

| 指标 | 数值 | 说明 |
|---|---|---|
| T2 主题相似 mAP@10 | 0.364 | 随机基线 0.187，相对提升 1.95× |
| T3 跨模态类别一致率 | 0.608 | 随机基线 0.524，提升 1.16×；六种模态对均有值 |
| T1 同源跨模态召回 | 0.032 | 同一记录另一模态单元的命中率（图像为弱配对，反映可学性上限） |
| 平均延迟 | 264 ms | 候选占比 0.70，无全量回退 |

语料已扩到 4928 条记录并加入 AVDD 强配对，需要最新指标时重跑 `eval_retrieval.py` 覆盖该文件。

## 部署

### 本地 / Docker

```bash
docker compose up -d
```

容器名固定为 `psych-screening-*`（见 `docker-compose.yml` 的 `name`），避免中文目录下 project name 为空。

### 线上

- 前端：构建后发布到 GitHub Pages（`npm run build`，产物在 `frontend/dist`）
- 后端：Cloudflare Workers + D1，使用 `uv build --wheel` 与 `pywrangler deploy`

自动部署工作流已移除，需手动执行；步骤与前置配置见 [DEVELOP.md](./DEVELOP.md) 与
[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/PRD.md](./docs/PRD.md) | 产品需求 |
| [docs/API.md](./docs/API.md) | 接口说明 |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 本地 / Docker / 生产部署 |
| [DEVELOP.md](./DEVELOP.md) | 长期开发记录、决策与部署迁移 |
| [README-个人端部署指南.md](./README-个人端部署指南.md) | 个人端 Agent 部署 |
| [演示用户README.md](./演示用户README.md) | 演示账号与数据 |
| [offline/datasets/README.md](./offline/datasets/README.md) | 数据集目录与构建说明 |
| [docs/答辩演示方案.md](./docs/答辩演示方案.md) | 答辩演示流程 |

## 团队信息

### 参赛队伍

「传智杯」参赛队伍 **腾龙队** —— 范永鑫、张文震、黄婉琳

### 项目贡献者与开发历程

本项目由多人协作完成。以下为仓库中各 Git 作者的提交分布
（`git shortlog -sn --all --no-merges`），参赛成员一列标注真实姓名，
可与完整提交历史对照查看：

| Git 作者 | 姓名 | 提交数 | 主要模块 |
|---|---|---:|---|
| `frontend-dev` | — | 150 | 前端（学生端 / 管理端 / 组件） |
| `drinkbeerbest` | **范永鑫** | 66 | 后端与业务接口 |
| `zwz` | **张文震** | 41 | 跨模态哈希检索（特征通道化、AVDD-TCMI 接入） |
| `gong` | — | 37 | 后端 / 数据与工具 |
| `FLumine87` | — | 32 | 项目总体、集成与合并 |
| `epohopes` | **黄婉琳** | 1 | 个人端 Agent（AI 陪伴、3D 星空知识图谱） |
| 其他 6 位 | — | 15 | 见 `git shortlog -sn --all` |

仓库完整历史保留了从「个人端 Agent」到「管理端工作台」再到
「动态跨模态哈希通道化」的演进过程，各阶段的技术决策与踩坑记录见 [DEVELOP.md](./DEVELOP.md)。

## 许可证

本项目仅供学习和研究使用。
