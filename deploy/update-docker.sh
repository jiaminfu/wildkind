#!/usr/bin/env bash
# ============================================================
# LASTGROVE · 更新发布（Docker 版）
#
#   sudo bash /opt/tideglass/current/deploy/update-docker.sh
#   sudo bash .../update-docker.sh --rev 82fc81a      # 部署到指定提交（回退用）
#   sudo bash .../update-docker.sh --no-backup        # 跳过备份（仅调试用）
#
# 与 update.sh 的区别：那份走 systemd + 宿主机 node；这份走 docker compose，
# 宿主机除了 docker 什么都不用装。这台生产机是纯 Docker 部署，用这份。
#
# 顺序刻意如此：先备份 → 再拉代码 → 再重建 → 再探活。
# 反过来的话，新镜像一旦起不来，旧数据和旧代码都在，但你已经没有干净的备份了。
# ============================================================
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SELF_DIR/.." && pwd)"

TARGET_REV=""
DO_BACKUP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --rev)       TARGET_REV="${2:-}"; shift 2 ;;
    --no-backup) DO_BACKUP=0; shift ;;
    -h|--help)   sed -n '2,14p' "$0"; exit 0 ;;
    *)           echo "未知参数：$1"; exit 1 ;;
  esac
done

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die()   { red "[x] $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash $SELF_DIR/update-docker.sh"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR 不是 git 仓库"
[ -f "$SELF_DIR/docker-compose.yml" ] || die "$SELF_DIR 下没有 docker-compose.yml"

# 端口从 .env 读，别假设 8080
HOST_PORT="$(sed -n 's/^HOST_PORT=//p' "$SELF_DIR/.env" 2>/dev/null | tail -1)"
HOST_PORT="${HOST_PORT:-4600}"

# 探活地址跟着 BIND_ADDR 走（锚定 172.18.0.1 时 127.0.0.1 无监听）
BIND_ADDR="$(sed -n 's/^BIND_ADDR=//p' "$SELF_DIR/.env" 2>/dev/null | tail -1)"
case "${BIND_ADDR:-}" in
  ''|0.0.0.0|'[::]'|::) PROBE_HOST=127.0.0.1 ;;
  *)                   PROBE_HOST="$BIND_ADDR" ;;
esac
HEALTH_URL="http://$PROBE_HOST:$HOST_PORT/api/v1/health"

OLD_REV="$(git -C "$APP_DIR" rev-parse --short HEAD)"
step "当前版本 $OLD_REV"

# ---------- 1. 备份 ----------
if [ "$DO_BACKUP" -eq 1 ]; then
  step "备份数据"
  bash "$SELF_DIR/backup-docker.sh" || die "备份失败，已中止（不带着风险发版）"
else
  red "    [跳过备份] --no-backup 已指定"
fi

# ---------- 2. 拉代码 ----------
step "拉取代码"
git -C "$APP_DIR" fetch --depth 1 origin main
if [ -n "$TARGET_REV" ]; then
  NEW_REV="$(git -C "$APP_DIR" rev-parse --short "$TARGET_REV")"
  echo "    指定版本：$NEW_REV"
else
  NEW_REV="$(git -C "$APP_DIR" rev-parse --short origin/main)"
fi

if [ "$OLD_REV" = "$NEW_REV" ]; then
  green "    代码已是最新（$OLD_REV），继续重建镜像"
else
  echo "    $OLD_REV → $NEW_REV"
  git -C "$APP_DIR" reset --hard "$NEW_REV"
fi
git -C "$APP_DIR" log -1 --format='    %h %ad %s' --date=short

# ---------- 3. 重建 ----------
step "重建并启动"
cd "$SELF_DIR"
docker compose up -d --build || {
  red "构建或启动失败，回滚命令："
  echo "  sudo git -C $APP_DIR reset --hard $OLD_REV"
  echo "  cd $SELF_DIR && sudo docker compose up -d --build"
  die "发版未完成"
}

# ---------- 4. 探活 ----------
step "健康检查（最多等 40 秒）"
OK=0
for i in $(seq 1 20); do
  if BODY="$(curl -fsS -m 3 "$HEALTH_URL" 2>/dev/null)"; then
    OK=1
    green "    $BODY"
    break
  fi
  sleep 2
done

if [ "$OK" -ne 1 ]; then
  red "    服务没起来，最后 30 行日志："
  docker compose logs --tail=30
  echo
  red "回滚命令："
  echo "  sudo git -C $APP_DIR reset --hard $OLD_REV"
  echo "  cd $SELF_DIR && sudo docker compose up -d --build"
  die "健康检查失败"
fi

# ---------- 5. 数据没丢 ----------
COUNT="$(curl -fsS -m 5 "$HEALTH_URL" | sed -n 's/.*"products":\([0-9]*\).*/\1/p')"
green "[完成] $OLD_REV → $NEW_REV · 商品 $COUNT 件 · 端口 $HOST_PORT"
echo "  回退：sudo bash $SELF_DIR/update-docker.sh --rev $OLD_REV"
