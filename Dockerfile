# 微信云托管 / 任何 Docker 平台都通用
FROM node:20-alpine

WORKDIR /app

# 先复制 package 文件让缓存层最大化
COPY package*.json ./

# 当前项目没有 npm 依赖，但保留 install 以兼容未来
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; \
    elif [ -f package.json ]; then npm install --omit=dev || true; fi

# 复制全部源代码
COPY . .

# 云托管约定：容器内监听 80 端口
ENV PORT=80
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/persistent/data

# 启动前确保挂载目录存在（即便没挂卷也不会崩）
RUN mkdir -p /app/persistent/data

EXPOSE 80

CMD ["node", "server.js"]
