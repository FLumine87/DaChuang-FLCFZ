# Docker部署心理筛查预警系统 - 完整指南

## 什么是Docker？

Docker是一个开源的容器化平台，它可以让你把应用程序及其依赖打包成一个轻量级、可移植的容器。容器就像一个独立的"盒子"，里面包含了运行应用所需的一切，比如代码、运行时、库和环境变量。这样，无论在哪台机器上运行，应用的行为都保持一致，避免了"在我机器上能跑"的问题。

## 安装Docker（Windows和Mac）

### Windows系统
1. 访问 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop) 下载安装包
2. 运行安装程序，按照提示完成安装
3. 安装完成后重启电脑
4. 启动Docker Desktop（会在系统托盘显示）

### Mac系统
1. 访问 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop) 下载安装包
2. 打开`.dmg`文件，将Docker图标拖到Applications文件夹
3. 从Applications文件夹启动Docker Desktop
4. 按照提示完成初始化设置

## 确保Docker和Docker Compose已安装

安装完成后，打开终端（Windows用PowerShell，Mac用Terminal），运行以下命令检查版本：

```bash
docker --version
docker-compose --version
```

如果看到版本信息，说明安装成功。

## 准备项目代码

1. 确保你已经有项目代码，如果没有，可以克隆或下载项目到本地
2. 打开终端（Windows用PowerShell，Mac用Terminal）
3. 进入项目目录：
   若已克隆项目，执行以下命令：
   ```bash
   cd DaChuang-FLCFZ
   git checkout develop/backend/gu
   git pull
   ```  
   若未克隆项目，执行以下命令：
   ```bash
   git clone https://github.com/FLumine87/DaChuang-FLCFZ.git
   cd DaChuang-FLCFZ
   git checkout develop/backend/gu
   git pull
   ```

## 使用Docker Compose一键启动

1. 在项目根目录运行以下命令：
   ```bash
   docker compose up -d
   ```
   这个命令会：
   - 构建前端和后端的Docker镜像
   - 创建并启动容器
   - 映射所需的端口
   - 设置环境变量

2. 查看服务状态：
   ```bash
   docker compose ps
   ```
   你应该能看到两个服务：backend和frontend，状态都是"Up"

3. 查看日志（可选）：
   ```bash
   docker compose logs -f
   ```
   这个命令会实时显示容器的日志输出，按Ctrl+C退出

## 验证服务是否正常运行

1. 前端界面：打开浏览器访问 http://localhost:5173
2. 后端API：访问 http://localhost:8000
3. API文档：访问 http://localhost:8000/docs

## 常见问题解决

1. **端口被占用**
   - 检查是否有其他程序占用了8000或5173端口
   - 可以在`docker-compose.yml`中修改端口映射

2. **Docker启动失败**
   - 确保Docker Desktop正在运行
   - 检查系统资源是否充足（至少4GB内存）

3. **服务启动缓慢**
   - 第一次构建镜像会比较慢，需要下载依赖
   - 后续启动会快很多

4. **无法访问服务**
   - 检查容器是否正常运行：`docker compose ps`
   - 查看日志找错误：`docker compose logs backend` 或 `docker compose logs frontend`

## 停止服务

当你想停止服务时，在项目根目录运行：
```bash
docker compose down
```

## 重启服务

如果需要重启服务：
```bash
docker compose restart
```

## 重新构建

如果修改了代码需要重新构建：
```bash
docker compose up -d --build
```

---
  
## 卸载Docker（Windows和Mac）  
  
当然，你不需要卸载docker，在你今后的日子，docker会一直存在。
Fly safe!