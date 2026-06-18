#!/bin/bash
# 在香港雨云服务器上首次执行（仅需一次）
# 用法: bash server-init.sh

set -e
REPO_URL="${REPO_URL:-https://github.com/yinsuecci/phyfog_rw.git}"
APP_DIR="${APP_DIR:-/var/www/phyfog}"

echo "==> 安装 Node.js 20..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs git nginx
fi

echo "==> 克隆仓库..."
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

npm install --production
npm install -g pm2

echo "==> 启动 PM2..."
pm2 delete phyfog 2>/dev/null || true
pm2 start server.js --name phyfog
pm2 save
pm2 startup | tail -1 | bash || true

echo "==> 完成。请在本机配置 Nginx 反代到 127.0.0.1:3000 并申请 SSL。"
echo "    域名: rw.udclass.top"
