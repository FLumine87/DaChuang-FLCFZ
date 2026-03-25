# 数据库管理工具

本工具用于在 Docker 环境中管理心理筛查预警系统的数据库。

## 快速开始

### Windows

```bash
cd backend

# 初始化数据库（首次使用）
db_tools\db.bat init

# 查看帮助
db_tools\db.bat help
```

### Linux/macOS

```bash
cd backend

# 添加执行权限
chmod +x db_tools/db.sh

# 初始化数据库（首次使用）
./db_tools/db.sh init

# 查看帮助
./db_tools/db.sh help
```

## 命令说明

| 命令 | 说明 |
|------|------|
| `build` | 构建 Docker 镜像 |
| `start` | 启动数据库管理容器 |
| `stop` | 停止容器 |
| `init` | 初始化数据库（创建表和示例数据） |
| `reset` | 重置数据库（删除后重新初始化） |
| `shell` | 进入 Python 交互环境 |
| `sql` | 进入 SQLite 命令行 |
| `backup` | 备份数据库到 data 目录 |
| `restore` | 从备份恢复数据库 |
| `status` | 查看数据库状态 |

## 使用示例

### 1. 首次初始化

```bash
# Windows
db_tools\db.bat init

# Linux/macOS
./db_tools/db.sh init
```

输出：
```
Initializing sample data...
Sample data initialized successfully!
```

### 2. 查看 SQLite 数据

```bash
# Windows
db_tools\db.bat sql

# Linux/macOS
./db_tools/db.sh sql
```

进入 SQLite 后：
```sql
.tables
SELECT * FROM users;
SELECT * FROM screenings;
.quit
```

### 3. 使用 Python 操作数据库

```bash
# Windows
db_tools\db.bat shell

# Linux/macOS
./db_tools/db.sh shell
```

进入 Python 后：
```python
from app.db.session import SessionLocal
from app.db.models.user import User

db = SessionLocal()
users = db.query(User).all()
for u in users:
    print(u.username, u.name)
db.close()
```

### 4. 备份与恢复

```bash
# 备份
db_tools\db.bat backup

# 恢复
db_tools\db.bat restore
```

### 5. 重置数据库

```bash
# 删除所有数据并重新初始化
db_tools\db.bat reset
```

## 数据库文件位置

```
backend/
├── mental_screening.db      # 工作数据库
├── data/                    # 数据目录
│   ├── dev.db              # 开发模板（可手动保存）
│   └── backup_*.db         # 备份文件
└── db_tools/               # 管理工具
    ├── Dockerfile
    ├── docker-compose.db.yml
    ├── db.bat              # Windows 脚本
    ├── db.sh               # Linux/macOS 脚本
    └── README.md           # 本文档
```

## 保存开发模板

初始化完成后，建议保存一份开发模板：

```bash
# Windows
mkdir data
copy mental_screening.db data\dev.db

# Linux/macOS
mkdir -p data
cp mental_screening.db data/dev.db
```

之后可以使用以下命令重置到开发模板：

```bash
# Windows
copy data\dev.db mental_screening.db

# Linux/macOS
cp data/dev.db mental_screening.db
```

## 常见问题

### Q: 容器启动失败？

确保 Docker 已安装并运行：
```bash
docker --version
docker compose version
```

### Q: 数据库文件在哪里？

数据库文件位于 `backend/mental_screening.db`，可以直接用 SQLite 工具打开。

### Q: 如何查看数据？

方式一：使用 `db.bat sql` 进入 SQLite 命令行
方式二：使用 DB Browser for SQLite 等可视化工具打开 `.db` 文件
