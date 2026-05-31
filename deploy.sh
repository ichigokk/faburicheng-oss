#!/usr/bin/env bash
# 通用自托管部署脚本。运行前通过环境变量传入服务器与公网地址。
set -euo pipefail

: "${SERVER:?请设置 SERVER，例如 ubuntu@example.com 或 SSH config 别名}"
: "${WEB_URL:?请设置 WEB_URL，例如 https://example.com}"
: "${API_URL:?请设置 API_URL，例如 https://api.example.com}"

DIR="${DIR:-/opt/faburicheng}"
PORT="${PORT:-3000}"
PM2_NAME="${PM2_NAME:-fbc-api}"

echo "→ 1/3 同步代码（排除密钥、数据和本地文件）"
rsync -az --itemize-changes \
  --exclude='.git' --exclude='node_modules' --exclude='.env' \
  --exclude='data' --exclude='data.bak.*' --exclude='.env.bak.*' \
  --exclude='*.zip' --exclude='.claude' --exclude='.playwright-cli' \
  --exclude='.preview' --exclude='.DS_Store' --exclude='cloud-env.json' \
  --exclude='mp-preview-*.png' --exclude='mp/project.private.config.json' \
  ./ "${SERVER}:${DIR}/"

echo "→ 2/3 重启服务"
ssh "${SERVER}" "cd ${DIR} && pm2 restart ${PM2_NAME} --update-env >/dev/null && sleep 2 && \
  echo -n '   healthz: ' && curl -s http://127.0.0.1:${PORT}/healthz && echo"

echo "→ 3/3 公网校验"
curl -s -o /dev/null -w "   web HTTP %{http_code}\n" "${WEB_URL}/"
curl -s -o /dev/null -w "   api HTTP %{http_code}\n" "${API_URL}/healthz"
echo "✅ 部署完成"
