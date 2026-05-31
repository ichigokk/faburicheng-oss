# 部署说明

本项目可以直接使用 Node.js 运行，也可以部署到 Docker 平台或自有服务器。生产环境的密钥和用户数据不应提交到 Git。

## Node.js 自托管

```bash
cp .env.example .env
# 编辑 .env，至少配置管理员和需要使用的模型密钥
npm start
```

默认监听 `0.0.0.0:5173`。建议使用 Caddy 或 Nginx 提供 HTTPS，并将流量反向代理到 Node.js 服务。

## Docker

```bash
docker build -t faburicheng .
docker run --rm -p 5173:80 --env-file .env -v "$PWD/data:/app/persistent/data" faburicheng
```

## 可选：使用部署脚本

服务器需预先安装 Node.js、pm2 和 rsync，并创建应用目录与 `.env`。首次启动：

```bash
ssh ubuntu@example.com
cd /opt/faburicheng
pm2 start server.js --name fbc-api --node-args="--env-file=.env"
pm2 save
```

之后可以从本机执行：

```bash
SERVER=ubuntu@example.com \
WEB_URL=https://example.com \
API_URL=https://api.example.com \
bash deploy.sh
```

可选变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DIR` | `/opt/faburicheng` | 服务器应用目录 |
| `PORT` | `3000` | Node.js 监听端口 |
| `PM2_NAME` | `fbc-api` | pm2 进程名 |

## 微信小程序

1. 使用微信开发者工具打开 `mp/`。
2. 在 `mp/project.config.json` 中替换为你自己的 AppID。
3. 在 `mp/utils/api.js` 中将 `API_BASE` 替换为你的 HTTPS API 地址。
4. 在微信公众平台中将该 API 域名加入 `request` 合法域名。

## 发布前检查

```bash
npm run check
git diff --check
```

确认 `.env`、`data/`、`cloud-env.json`、`mp/project.private.config.json` 和预览图片没有进入 Git。
