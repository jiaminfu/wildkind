#!/usr/bin/env bash
# ============================================================
# TIDEGLASS · 首次部署脚本（Ubuntu 22.04 / 24.04 / Debian 12）
#
#   sudo bash deploy/install.sh shop.example.com git@github.com:jiaminfu/wildkind.git you@mail.com
#
#   参数 1  域名（必填）
#   参数 2  仓库地址（必填）
#   参数 3  邮箱（可选；给了就顺手签 Let's Encrypt 证书）
#
# 它会做：装 Node 22 → 建系统用户 → 拉代码 → 生成环境变量与随机口令
#          → 初始化数据 → 装 systemd 服务 → 配 Nginx → 开防火墙 → 签证书 → 自检
#
# 幂等：重复执行为「更新」语义——代码会 git pull，数据文件绝不覆盖。
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
REPO="${2:-}"
EMAIL="${3:-}"

APP_USER="tideglass"
APP_DIR="/opt/tideglass/current"
ENV_DIR="/etc/tideglass"
ENV_FILE="$ENV_DIR/tideglass.env"
SERVICE="tideglass-api"
PORT_DEFAULT="4600"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die()   { red "[×] $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash deploy/install.sh <域名> <仓库地址> [邮箱]"
[ -n "$DOMAIN" ] || die "缺少域名。示例：sudo bash deploy/install.sh shop.tideglass.com git@github.com:jiaminfu/wildkind.git"
[ -n "$REPO" ]   || die "缺少仓库地址。示例：https://github.com/jiaminfu/wildkind.git"

export DEBIAN_FRONTEND=noninteractive

# ---------- 1. 基础包 ----------
step "安装基础软件包"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git nginx ufw openssl >/dev/null

# ---------- 2. Node.js ----------
step "检查 Node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 18 ]; then
    green "    已有 Node.js $(node -v)，跳过安装"
    need_node=0
  fi
fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  green "    已安装 Node.js $(node -v)"
fi
NODE_BIN="$(command -v node)"

# ---------- 3. 系统用户 ----------
step "准备运行账号 $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home /opt/tideglass --shell /usr/sbin/nologin "$APP_USER" >/dev/null
  green "    已创建系统用户"
else
  green "    用户已存在"
fi

# ---------- 4. 代码 ----------
step "拉取代码到 $APP_DIR"
mkdir -p /opt/tideglass
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin main
  git -C "$APP_DIR" reset --hard origin/main
  green "    已更新到 origin/main（$(git -C "$APP_DIR" rev-parse --short HEAD)）"
else
  git clone --depth 1 -b main "$REPO" "$APP_DIR"
  green "    已克隆（$(git -C "$APP_DIR" rev-parse --short HEAD)）"
fi

# ---------- 5. 环境变量 ----------
step "写入环境变量 $ENV_FILE"
mkdir -p "$ENV_DIR"
if [ -f "$ENV_FILE" ]; then
  green "    已存在，保持不动（改口令见部署手册 6.4）"
else
  OWNER_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
  OPS_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
  cat > "$ENV_FILE" <<EOF
# 由 deploy/install.sh 生成于 $(date -Is)
PORT=$PORT_DEFAULT

# 只在首次 node app/server/seed.js 时生效；数据已存在时改这里无效
ADMIN_PASSWORD=$OWNER_PW
OPS_PASSWORD=$OPS_PW

CORS_ORIGIN=https://$DOMAIN

# 生产环境不要设置 ALLOW_TEST_RESET
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  green "    已生成随机口令（收好，登录要用）"
  echo
  echo "    ┌──────────────────────────────────────────────"
  echo "    │ 后台地址： https://$DOMAIN/#/admin"
  echo "    │ 老板账号： owner@tideglassjewelry.com"
  echo "    │ 密码　　： $OWNER_PW"
  echo "    │ 运营账号： ops@tideglassjewelry.com"
  echo "    │ 密码　　： $OPS_PW"
  echo "    └──────────────────────────────────────────────"
fi

# 后续步骤要复用端口
set -a; . "$ENV_FILE"; set +a
PORT="${PORT:-$PORT_DEFAULT}"

# ---------- 6. 目录权限 ----------
step "修正目录权限"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 755 /opt/tideglass /opt/tideglass/current
# Nginx 需要能读静态文件
chmod -R a+rX "$APP_DIR/app/web"
mkdir -p "$APP_DIR/app/server/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/app/server/data"
chmod 750 "$APP_DIR/app/server/data"

# ---------- 7. 初始化数据（只在缺失时） ----------
step "初始化数据"
if [ -f "$APP_DIR/app/server/data/db.json" ]; then
  green "    db.json 已存在，跳过（不会覆盖现网数据）"
else
  sudo -u "$APP_USER" env ADMIN_PASSWORD="$ADMIN_PASSWORD" OPS_PASSWORD="$OPS_PASSWORD" \
       HOME=/opt/tideglass "$NODE_BIN" "$APP_DIR/app/server/seed.js"
  chown "$APP_USER":"$APP_USER" "$APP_DIR/app/server/data/db.json" "$APP_DIR/app/server/data/db.seed.json"
  green "    已生成演示数据"
fi

# ---------- 8. systemd ----------
step "安装 systemd 服务"
sed -e "s#/usr/bin/node#$NODE_BIN#" \
    -e "s#WorkingDirectory=.*#WorkingDirectory=$APP_DIR#" \
    -e "s#EnvironmentFile=.*#EnvironmentFile=$ENV_FILE#" \
    -e "s#ReadWritePaths=.*#ReadWritePaths=$APP_DIR/app/server/data#" \
    "$APP_DIR/deploy/tideglass-api.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 40 --no-pager; die "服务没起来，看上面日志"; }
green "    服务运行中"

# ---------- 9. Nginx ----------
step "配置 Nginx"
mkdir -p /var/www/certbot
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx-tideglass.conf" > "/etc/nginx/sites-available/tideglass.conf"
ln -sf /etc/nginx/sites-available/tideglass.conf /etc/nginx/sites-enabled/tideglass.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
green "    已生效"

# ---------- 10. 防火墙 ----------
step "配置防火墙"
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
# 应用端口不对公网开放，只允许本机 Nginx 访问
ufw deny "$PORT"/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true
green "    已放行 22/80/443，已封 $PORT"

# ---------- 11. HTTPS ----------
step "签发 HTTPS 证书"
if [ -n "$EMAIL" ]; then
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    green "    证书已就绪，已配置自动续期"
  else
    red "    签发失败（多半是 DNS 还没指过来）。DNS 生效后重跑："
    echo "    sudo certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect"
  fi
else
  red "    未提供邮箱，跳过。HTTPS 上线前执行："
  echo "    sudo apt install -y certbot python3-certbot-nginx"
  echo "    sudo certbot --nginx -d $DOMAIN -m 你的邮箱 --agree-tos --redirect"
fi

# ---------- 12. 自检 ----------
step "自检"
sleep 1
if curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null; then
  green "    接口健康：$(curl -fsS http://127.0.0.1:$PORT/api/v1/health)"
else
  red "    接口探活失败"
fi
curl -fsS -o /dev/null -w "    Nginx 首页 HTTP %{http_code}\n" -H "Host: $DOMAIN" http://127.0.0.1/ || true

cat <<EOF

$(green '============================================')
 部署完成
$(green '============================================')
  前台   https://$DOMAIN/
  后台   https://$DOMAIN/#/admin
  健康   https://$DOMAIN/api/v1/health

  常用命令
    systemctl status $SERVICE        看状态
    systemctl restart $SERVICE       重启
    journalctl -u $SERVICE -f        跟日志
    bash $APP_DIR/deploy/update.sh   更新代码
    bash $APP_DIR/deploy/backup.sh   备份数据

  接下来必须做（部署手册第 7 章）
    1. 确认 ALLOW_TEST_RESET 没被设置
    2. 登录后台改掉随机口令，换成自己的
    3. 配好 db.json 定时备份，并真的恢复演练一次

EOF
