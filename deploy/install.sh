#!/usr/bin/env bash
# ============================================================
# TIDEGLASS · 首次部署脚本（Ubuntu 22.04 / 24.04 / Debian 12）
#
# 有域名：
#   sudo bash deploy/install.sh shop.example.com git@github.com:jiaminfu/wildkind.git you@mail.com
#
# 没有域名 / 服务器上已经跑着别的项目（Nginx 方式，一个端口都不抢）：
#   sudo LISTEN_PORT=8080 bash deploy/install.sh - git@github.com:jiaminfu/wildkind.git
#
# 服务器上的 80/443 被 Docker 容器（Caddy / Traefik / Nginx Proxy Manager）占着，
# 宿主机装不了系统 Nginx——这时用「直连模式」，完全跳过 Nginx：
#   sudo NO_NGINX=1 LISTEN_PORT=8080 bash deploy/install.sh - https://github.com/jiaminfu/wildkind.git
#
#   参数 1  域名；写 - 表示「还没有域名」，走 IP + 端口模式，绝不碰已有的 80/443
#   参数 2  仓库地址（必填）
#   参数 3  邮箱（可选；有域名才用得上，用于签 Let's Encrypt 证书）
#
# 环境变量：
#   LISTEN_PORT  对外监听端口（默认 8080）。Nginx 模式下是 Nginx 的端口
#   APP_PORT     Node 监听端口（默认 4600）。设了 NO_NGINX=1 时会被 LISTEN_PORT 覆盖
#   NO_NGINX=1   不装、不配、不动系统 Nginx；Node 直接监听 LISTEN_PORT 对外提供服务
#
# 它会做：装 Node 22 → 建系统用户 → 拉代码 → 生成环境变量与随机口令
#          → 初始化数据 → 装 systemd 服务 → 配 Nginx（可跳过）→ 防火墙 → 签证书 → 自检
#
# 幂等：重复执行为「更新」语义——代码会 git pull，数据文件绝不覆盖。
# 共存：不删 sites-enabled/default、不擅自启用 ufw、不抢 80/443，改用独立端口。
#       NO_NGINX=1 时连 nginx 这个包都不装——80/443 归已有的容器，一行都不碰。
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
PORT_DEFAULT="${APP_PORT:-4600}"
LISTEN_PORT="${LISTEN_PORT:-8080}"

# 「还没有域名」的三种写法都认
NO_DOMAIN=0
case "$DOMAIN" in
  ""|-|none|NONE|ip) NO_DOMAIN=1 ;;
esac

# 直连模式：不装 Nginx，Node 自己监听对外端口。
# 用于「80/443 已被 Docker 容器占用」的机器——那种机器上装系统 Nginx 会起不来。
NO_NGINX="${NO_NGINX:-0}"
if [ "$NO_NGINX" -eq 1 ]; then
  NO_DOMAIN=1
  PORT_DEFAULT="$LISTEN_PORT"
fi

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die()    { red "[×] $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash deploy/install.sh <域名|-> <仓库地址> [邮箱]"
[ -n "$REPO" ]   || die "缺少仓库地址。示例：sudo bash deploy/install.sh - https://github.com/jiaminfu/wildkind.git"
[ "$NO_DOMAIN" -eq 1 ] || [ -n "$DOMAIN" ] || die "域名参数为空"

export DEBIAN_FRONTEND=noninteractive

if [ "$NO_NGINX" -eq 1 ]; then
  yellow "模式：直连（不装 Nginx，Node 监听 0.0.0.0:$LISTEN_PORT），80/443 留给已有服务"
elif [ "$NO_DOMAIN" -eq 1 ]; then
  yellow "模式：无域名（IP + 端口 $LISTEN_PORT），不会修改已有站点、不抢 80/443"
else
  green "模式：域名 $DOMAIN"
fi

# ---------- 0. 端口占用体检 ----------
# 服务器上已经有别的项目在跑，最怕的就是端口撞车。先看再装。
check_port() {
  local p="$1" who
  if ! command -v ss >/dev/null 2>&1; then
    yellow "    （没有 ss 命令，跳过端口体检）"
    return 0
  fi
  who="$(ss -lntp 2>/dev/null | awk -v port=":$p" '$4 ~ (port "$") {print $6; exit}')"
  if [ -n "$who" ]; then
    die "端口 $p 已被占用（$who）。换一个重跑：APP_PORT=4601 或 LISTEN_PORT=8081"
  fi
}
step "检查端口占用"
check_port "$PORT_DEFAULT"
if [ "$NO_DOMAIN" -eq 1 ] && [ "$NO_NGINX" -eq 0 ]; then
  check_port "$LISTEN_PORT"
fi
if [ "$NO_NGINX" -eq 1 ]; then
  green "    $PORT_DEFAULT 可用（直连，仅此一个端口）"
elif [ "$NO_DOMAIN" -eq 1 ]; then
  green "    $PORT_DEFAULT 与 $LISTEN_PORT 都可用"
else
  green "    $PORT_DEFAULT 可用"
fi

# ---------- 1. 基础包 ----------
step "安装基础软件包"
apt-get update -qq
# 直连模式不装 nginx：装完 apt 会自动 start，80 端口被 Docker 容器占着就直接报错，
# 有些人看到 nginx 起不来会去 systemctl stop docker——那才是真正的灾难。
if [ "$NO_NGINX" -eq 1 ]; then
  apt-get install -y -qq curl ca-certificates git openssl >/dev/null
  green "    已装 curl/git/openssl（跳过 nginx，80/443 归已有服务）"
else
  apt-get install -y -qq curl ca-certificates git nginx openssl >/dev/null
fi
# ufw 只在本来就装了的情况下才动它，避免把已有项目的端口墙掉
if ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y -qq ufw >/dev/null || true
fi

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
  if [ "$NO_DOMAIN" -eq 1 ]; then
    CORS_LINE="CORS_ORIGIN=*"
  else
    CORS_LINE="CORS_ORIGIN=https://$DOMAIN"
  fi
  cat > "$ENV_FILE" <<EOF
# 由 deploy/install.sh 生成于 $(date -Is)
PORT=$PORT_DEFAULT

# 只在首次 node app/server/seed.js 时生效；数据已存在时改这里无效
ADMIN_PASSWORD=$OWNER_PW
OPS_PASSWORD=$OPS_PW

$CORS_LINE

# 生产环境不要设置 ALLOW_TEST_RESET
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  green "    已生成随机口令（收好，登录要用）"
  echo
  if [ "$NO_DOMAIN" -eq 1 ]; then
    ADD_HINT="http://<服务器IP>:$LISTEN_PORT/#/admin"
  else
    ADD_HINT="https://$DOMAIN/#/admin"
  fi
  echo "    ┌──────────────────────────────────────────────"
  echo "    │ 后台地址： $ADD_HINT"
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
# 关键：不删任何已有站点、不动 sites-enabled/default。
# 服务器上可能已经有别的项目在用 80/443，删默认站点或让我们的块抢 default_server
# 都会把别人的流量截走。这里只用「独立端口」或「精确 server_name」两种方式接入。
if [ "$NO_NGINX" -eq 1 ]; then
  step "反向代理"
  yellow "    直连模式，跳过 Nginx（Node 已在 0.0.0.0:$PORT 上对外服务）"
  if command -v nginx >/dev/null 2>&1; then
    yellow "    注意：本机已装 nginx，脚本不会碰它任何配置"
  fi
else
  step "配置 Nginx"
  mkdir -p /var/www/certbot
  NGX_SITE="/etc/nginx/sites-available/tideglass.conf"

  if [ "$NO_DOMAIN" -eq 1 ]; then
    sed -e "s/__LISTEN_PORT__/$LISTEN_PORT/g" -e "s/__APP_PORT__/$PORT/g" \
        "$APP_DIR/deploy/nginx-tideglass-port.conf" > "$NGX_SITE"
  else
    sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx-tideglass.conf" > "$NGX_SITE"
  fi
  ln -sf "$NGX_SITE" /etc/nginx/sites-enabled/tideglass.conf

  # 配置写错就把自己的站点摘掉，别把别人正在跑的服务一起带下水
  if ! nginx -t 2>/tmp/nginx-tideglass-test.log; then
    rm -f /etc/nginx/sites-enabled/tideglass.conf
    cat /tmp/nginx-tideglass-test.log
    die "Nginx 配置校验失败，已撤销本次站点配置（已有站点未受影响）"
  fi
  if ! systemctl reload nginx; then
    rm -f /etc/nginx/sites-enabled/tideglass.conf
    systemctl reload nginx || true
    die "Nginx reload 失败（常见原因：IPv6 未启用却写了 listen [::]），已撤销本次站点配置"
  fi
  green "    已生效（未改动任何已有站点）"
fi

# ---------- 10. 防火墙 ----------
# 服务器上已有项目时，最危险的动作是「顺手 ufw enable」：
# 如果防火墙原本是关的，启用后只放行 22/80/443，别人跑在 3000/8080 的服务立刻对外失联。
# 所以这里只做「防火墙本来就是开的」那种情况下的增量放行。
step "防火墙"
if ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
  if [ "$NO_DOMAIN" -eq 1 ]; then
    ufw allow "$LISTEN_PORT"/tcp >/dev/null 2>&1 || true
    green "    已放行 22 与 $LISTEN_PORT"
  else
    ufw allow 80/tcp  >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    green "    已放行 22/80/443"
  fi
  # 直连模式下 PORT == LISTEN_PORT，封了就等于把自己封了
  if [ "$NO_NGINX" -eq 0 ] && [ "$PORT" != "$LISTEN_PORT" ]; then
    ufw deny "$PORT"/tcp >/dev/null 2>&1 || true
    green "    已封 $PORT（业务端口只给本机 Nginx）"
  fi
else
  yellow "    防火墙当前未启用，脚本不做改动（避免墙掉已有项目）"
  if [ "$NO_DOMAIN" -eq 1 ]; then
    echo "    如需启用：sudo ufw allow OpenSSH && sudo ufw allow $LISTEN_PORT/tcp && sudo ufw enable"
  else
    echo "    如需启用：sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable"
  fi
fi

# ---------- 11. HTTPS ----------
if [ "$NO_DOMAIN" -eq 1 ]; then
  step "HTTPS"
  yellow "    无域名模式，跳过证书。当前走 http://<服务器IP>:$LISTEN_PORT"
  echo "    拿到域名后按部署手册「无域名上线」一节切换，不必重装。"
elif [ -n "$EMAIL" ]; then
  step "签发 HTTPS 证书"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    green "    证书已就绪，已配置自动续期"
  else
    red "    签发失败（多半是 DNS 还没指过来）。DNS 生效后重跑："
    echo "    sudo certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect"
  fi
else
  step "HTTPS"
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
  red "    接口探活失败，看 journalctl -u $SERVICE -n 40"
fi

if [ "$NO_DOMAIN" -eq 1 ]; then
  curl -fsS -o /dev/null -w "    站点 HTTP %{http_code}（127.0.0.1:$LISTEN_PORT）\n" \
       "http://127.0.0.1:$LISTEN_PORT/" || true
  PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
else
  curl -fsS -o /dev/null -w "    站点 HTTP %{http_code}（Host: $DOMAIN）\n" \
       -H "Host: $DOMAIN" http://127.0.0.1/ || true
  PUBLIC_IP="$DOMAIN"
fi

if [ "$NO_DOMAIN" -eq 1 ]; then
  SITE_FRONT="http://$PUBLIC_IP:$LISTEN_PORT/"
  SITE_ADMIN="http://$PUBLIC_IP:$LISTEN_PORT/#/admin"
  SITE_HEALTH="http://$PUBLIC_IP:$LISTEN_PORT/api/v1/health"
else
  SITE_FRONT="https://$DOMAIN/"
  SITE_ADMIN="https://$DOMAIN/#/admin"
  SITE_HEALTH="https://$DOMAIN/api/v1/health"
fi

cat <<EOF

$(green '============================================')
 部署完成
$(green '============================================')
  前台   $SITE_FRONT
  后台   $SITE_ADMIN
  健康   $SITE_HEALTH

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

if [ "$NO_DOMAIN" -eq 1 ]; then
  cat <<EOF

  ⚠ 无域名模式的额外注意
    · 当前是 HTTP，后台口令在网络上是明文。验证完请立刻收紧来源：
EOF
  if [ "$NO_NGINX" -eq 1 ]; then
    cat <<EOF
      sudo ufw allow from 你的公网IP to any port $LISTEN_PORT proto tcp
      sudo ufw delete allow $LISTEN_PORT/tcp
      （直连模式没有 Nginx 的 allow/deny，只能用防火墙按来源 IP 收紧）
EOF
  else
    cat <<EOF
      把 deploy/nginx-tideglass-port.conf 里的 allow / deny 两行取消注释并填你的 IP
EOF
  fi
  cat <<EOF
    · 云厂商控制台的安全组也要放行 $LISTEN_PORT
    · 拿到域名后切 HTTPS，见手册第 5.6 节，不用重装
EOF
fi

