# 基于动态跨模态哈希检索和RAG的心理筛查预警系统

## 项目简介

本系统是一个结合**动态跨模态哈希检索**与**RAG（检索增强生成）**技术的心理健康筛查预警平台。通过多模态数据采集（文本、语音、图像），实现高效的心理健康筛查、智能分析与预警，帮助实现心理问题的早发现、早干预。

## 核心功能

### 仪表盘
- 筛查统计总览（总筛查人数、本月筛查数、预警人数等）
- 预警等级分布可视化
- 近期筛查趋势图表
- 最新预警列表
- 快捷操作入口

### 筛查管理
- 问卷模板管理（支持 PHQ-9、GAD-7、SCL-90 等量表）
- 筛查任务创建与管理
- 筛查记录列表与详情查看
- 筛查结果分析

### 多模态数据采集
- 文本采集（结构化问卷 + 开放式文本）
- 语音采集（录音上传，用于情感分析）
- 图像采集（绘画测试图片上传）
- 数据预览与确认

### 跨模态哈希检索与RAG分析
- 跨模态相似案例检索（基于哈希编码的快速匹配）：文本 / 图像 / 语音三种查询都可以发起
- 检索结果展示（相似度、模态来源、跨模态标识、内联媒体缩略图、哈希过程信息）
- RAG智能分析报告生成
- 分析报告结构化展示

## 动态跨模态哈希检索（真实数据集）

检索模块把文本 / 图像 / 语音映射到同一套二进制哈希码空间，用「时间窗 × 位带」多哈希表
做快速匹配，支持**任意模态查询、任意模态结果**（跨模态检索），并保留可解释信息
（命中主题、查询码、候选数、探测桶数）。

### 数据来源与三档体验

| 档位 | 数据源 | 适用场景 | 如何获得 |
|------|--------|----------|----------|
| 档 0 · 开箱即用 | 合成语料 `backend/data/hashing/corpus.db`（随仓库发布） | clone 即跑通链路、演示前端交互 | 无需操作，真实语料缺失时自动回退到它 |
| 档 1 · 真实语料 | `backend/data/hashing/real_corpus.db`（离线构建，不入库） | 基于真实面部图像 / 语音 / 自述文本的跨模态检索 | 见下方「构建真实语料」 |
| 档 2 · 指标复现 | 同上，跑评测脚本 | 复现检索质量指标（mAP / 跨模态类别一致率） | 见下方「复现指标」 |

> 真实数据集 **Context-Aware Multimodal Depression Dataset** 体积大且带使用条款，
> **不随仓库分发**：原始数据放在仓库外（如 `<仓库>/offline/datasets/`），仓库内只保留
> 构建脚本与派生产物。引擎启动时优先读真实语料，缺失则自动回退合成语料，因此
> **没有数据集也能完整跑通演示**。

### 构建真实语料

数据集三模态之间**没有被试级身份配对**，只有风险类别（Depressed / Normal）一级对齐，
因此构建脚本按「同类别配对」组织记录：一条记录 = 1 条文本自述 + 1 张面部图像 + 1 段语音
（风险类别一致）。跨模态检索在「风险类别 / 文本主题」层面成立；「同一被试」层面受数据集
限制不可辨识，评测中的 T1 指标会如实体现。

```bash
cd backend
# 方式一：数据集放在 <仓库>/offline/datasets/Context-Aware Multimodal Depression Dataset/
python scripts/build_real_corpus.py
# 方式二：显式指定数据集根目录（或设环境变量 DACHUANG_ASSETS_ROOT）
python scripts/build_real_corpus.py --dataset-root "D:\path\to\dataset"
```

产物为 `backend/data/hashing/real_corpus.db`，包含记录级 / 单元级 / 评测查询三类数据，
并**离线预抽取**图像（192 维：强度 + HOG）与语音（64 维：MFCC + 韵律）特征，避免检索时重复解码。

### 复现指标

```bash
cd backend
python scripts/demo_hashing.py     # 一键演示：索引概览 + 三模态查询 + 动态增量
python scripts/eval_retrieval.py   # 评测：mAP / 跨模态类别一致率 / 效率，写入 data/hashing/eval_report.json
```

评测口径（`data/hashing/eval_report.json`）：T2 主题相似 mAP@10 与随机基线对比，
T3 跨模态类别一致率 vs 先验（衡量跨模态检索是否真的比随机更准）。
由于数据集只有类别级对齐，**T1（同一被试命中）不可辨识属数据集限制**，报告只作链路验证与相对比较。

### 索引与检索行为

- **多哈希表索引**：64 位码切 8 张位带表，位带内探测 2 比特 → 汉明半径 16（相似度 ≥ 0.75）内不漏召回。
- **时间窗表质量淘汰**：每个时间窗独立评估 σ（编码信息量）与 ρ（语义一致性），弱表不再参与探测。
- **混合视图模态轮转**：未指定结果模态时，各模态各取 top-k 再轮转交错，保证跨模态命中进入结果页
  （真实语料下同模态码天然更相近，纯全局排序会让结果页被查询模态占满）。
- **动态增量**：新记录写入后立即可检索，无需全量重训。

### 预警管理
- 预警规则配置（阈值和等级设定）
- 预警记录列表与筛选
- 预警详情查看
- 预警处理流程（确认、分配、跟进、关闭）

### 案例管理
- 案例列表与搜索
- 案例详情综合视图
- 案例时间线展示
- 案例标签分类

## 技术架构

### 前端技术栈
| 技术 | 版本 | 说明 |
|------|------|------|
| React | 19.x | 前端框架 |
| TypeScript | 5.x | 类型安全 |
| Vite | 7.x | 构建工具 |
| TailwindCSS | 4.x | CSS框架 |
| React Router | 7.x | 路由管理 |
| Recharts | 3.x | 图表库 |
| Lucide React | - | 图标库 |

### 后端技术栈
| 技术 | 版本 | 说明 |
|------|------|------|
| Python | 3.11+ | 编程语言 |
| FastAPI | 0.115.x | Web框架 |
| SQLAlchemy | 2.0.x | ORM框架 |
| Alembic | 1.14.x | 数据库迁移 |
| Pydantic | 2.10.x | 数据验证 |
| SQLite | - | 默认数据库 |
| Uvicorn | 0.32.x | ASGI服务器 |

### 核心引擎
- **动态跨模态哈希检索引擎**: CMFH（协同矩阵分解哈希）+ 「时间窗 × 位带」多哈希表，已落地
- **多模态特征**: 图像（强度 + HOG，192 维）/ 语音（MFCC + 韵律，64 维）手工特征，仅依赖 numpy + Pillow
- **RAG分析引擎**: DeepSeek / 智谱 API，无密钥时自动降级 Mock 报告

## 项目结构

```
DaChuang-FLCFZ/
├── backend/                    # 后端代码
│   ├── app/
│   │   ├── api/v1/            # API路由
│   │   ├── core/              # 核心模块（异常、响应、安全）
│   │   ├── db/                # 数据库模型
│   │   ├── engines/           # 核心引擎
│   │   │   ├── hashing/       # 哈希检索引擎
│   │   │   ├── multimodal/    # 多模态处理引擎
│   │   │   └── rag/           # RAG分析引擎
│   │   ├── schemas/           # Pydantic模型
│   │   ├── services/          # 业务服务
│   │   ├── config.py          # 配置文件
│   │   └── main.py            # 应用入口
│   ├── alembic/               # 数据库迁移
│   ├── uploads/               # 上传文件存储
│   ├── requirements.txt       # Python依赖
│   ├── Dockerfile             # 后端Docker配置
│   └── .env.example           # 环境变量示例
├── frontend/                   # 前端代码
│   ├── src/
│   │   ├── components/        # 公共组件
│   │   ├── pages/             # 页面组件
│   │   ├── services/          # API服务
│   │   ├── data/              # Mock数据
│   │   ├── App.tsx            # 应用入口
│   │   └── main.tsx           # 渲染入口
│   ├── public/                # 静态资源
│   ├── package.json           # Node依赖
│   ├── Dockerfile             # 前端Docker配置
│   └── vite.config.ts         # Vite配置
├── docs/                       # 文档
│   ├── PRD.md                 # 产品需求文档
│   └── API.md                 # API接口文档
├── docker-compose.yml          # Docker Compose配置
└── README.md                   # 项目说明
```

## 快速开始

### 环境要求
- Python 3.11+
- Node.js 18+
- npm 或 yarn

### 本地开发

#### 后端启动
```bash
cd backend

# Windows
start.bat

# Linux/macOS
chmod +x start.sh
./start.sh
```

后端服务将在 `http://localhost:8000` 启动，API文档地址：`http://localhost:8000/docs`

#### 前端启动
```bash
cd frontend
npm install
npm run dev
```

前端服务将在 `http://localhost:5173` 启动

### Docker部署
```bash
docker-compose up -d
```

详细部署说明请参考 [DEPLOYMENT.md](./docs/DEPLOYMENT.md)

## API文档

启动后端服务后，可通过以下地址访问API文档：
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

详细的API接口说明请参考 [API.md](./docs/API.md)

## 配置说明

### 后端环境变量

在 `backend/` 目录下创建 `.env` 文件：

```env
DATABASE_URL=sqlite:///./mental_screening.db
SECRET_KEY=your-secret-key-change-in-production
DEBUG=True
ENABLE_MOCK_ENGINES=True
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| DATABASE_URL | 数据库连接字符串 | sqlite:///./mental_screening.db |
| SECRET_KEY | JWT密钥 | - |
| DEBUG | 调试模式 | True |
| ENABLE_MOCK_ENGINES | 启用Mock引擎 | True |
| HASHING_USE_MOCK | 哈希引擎走 Mock（False = 真实 CMFH + 多哈希表） | False |
| HASHING_USE_CORPUS | 使用预构建语料库作为检索数据源 | True |
| HASHING_CORPUS_DB | 真实语料库路径（缺失时自动回退合成语料） | backend/data/hashing/real_corpus.db |
| HASHING_FALLBACK_CORPUS_DB | 合成语料库路径（随仓库发布，兜底） | backend/data/hashing/corpus.db |
| HASHING_BALANCE_MODALITIES | 混合视图按模态轮转交错，保证跨模态命中可见 | True |

> 完整哈希参数（码长、位带、时间窗、质量阈值等）见 [backend/.env.example](./backend/.env.example)。

### 前端配置

前端通过 Vite 代理连接后端API，默认配置：
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
  }
}
```

## 开发指南

### 后端开发
```bash
cd backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows
venv\Scripts\activate
# Linux/macOS
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动开发服务器
uvicorn app.main:app --reload
```

### 前端开发
```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

### 数据库迁移
```bash
cd backend

# 生成迁移文件
alembic revision --autogenerate -m "description"

# 执行迁移
alembic upgrade head
```

## 许可证

本项目仅供学习和研究使用。

## 贡献指南

欢迎提交 Issue 和 Pull Request。
