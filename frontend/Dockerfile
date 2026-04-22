FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci

# 复制源代码
COPY . .

# 构建项目
RUN npm run build

# 安装生产依赖（用于预览）
RUN npm install -g serve

EXPOSE 5173

# 使用 vite 开发服务器
CMD ["npm", "run", "dev"]