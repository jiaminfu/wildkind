#!/usr/bin/env bash
# ============================================================
# TIDEGLASS · 更新发布
#   sudo bash /opt/tideglass/deploy/update.sh
#
# 顺序刻意如此：先备份 → 再拉代码 → 再重启 → 再探活。
# 反过来的话，新代码一旦起不来，旧数据和旧代码都在，但你已经没有干净的备份了。
# ============================================================
set -euo pipefail

APP_DIR="/opt/tideglass/current"
SERVICE="tideglass-api"
ENV_FILE="/etc/tideglass/tideglass.env"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die()   { red "[×] $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash $APP_DIR/deploy/update.sh"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR 不是 git 仓库"

set -a; . "$ENV_FILE"; set +a
PORT="${PORT:-4600}"
OLD_REV="$(git -C "$APP_DIR" rev-parse --short HEAD)"

# ---------- 1. 备份 ----------
step "备份当前数据"
bash "$APP_DIR/deploy/backup.sh"

# ---------- 2. 拉代码 ----------
step "拉取新版本"
git -C "$APP_DIR" fetch --depth 1 origin main
NEW_REV="$(git -C "$APP_DIR" rev-parse --short origin/main)"
if [ "$OLD_REV" = "$NEW_REV" ]; then
  green "    已是最新（$OLD_REV），只做重启"
else
  echo "    $OLD_REV → $NEW_REV"
  git -C "$APP_DIR" reset --hard origin/main
fi

# 静态文件是 Nginx 直接读的，权限要保持可读
chown -R tideglass:tideglass "$APP_DIR"
chmod -R a+rX "$APP_DIR/app/web"

# ---------- 3. 重启 ----------
step "重启服务"
systemctl restart "$SERVICE"
sleep 2

# ---------- 4. 探活 ----------
step "健康检查"
if ! systemctl is-active --quiet "$SERVICE"; then
  red "    服务未启动，日志如下："
  journalctl -u "$SERVICE" -n 50 --no-pager
  die "回滚：git -C $APP_DIR reset --hard $OLD_REV && systemctl restart $SERVICE"
fi

if curl -fsS "http://127.0.0.1:$PORT/api/v1/health"; then
  echo
  green "    发布成功（$NEW_REV）"
else
  red "    接口探活失败"
  die "回滚：git -C $APP_DIR reset --hard $OLD_REV && systemctl restart $SERVICE"
fi

echo
echo "回滚命令（记住这一条）："
echo "  sudo git -C $APP_DIR reset --hard $OLD_REV && sudo systemctl restart $SERVICE"
