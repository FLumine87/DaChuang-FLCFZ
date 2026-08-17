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
- 跨模态相似案例检索（基于哈希编码的快速匹配）
- 检索结果展示（相似度、模态来源、关键特征）
- RAG智能分析报告生成
- 分析报告结构化展示

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

### 核心引擎（规划中）
- **哈希检索引擎**: 动态跨模态哈希模型
- **RAG分析引擎**: LangChain + LLM API
- **多模态处理引擎**: 语音/图像分析模型

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
