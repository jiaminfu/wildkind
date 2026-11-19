#!/usr/bin/env bash
# ============================================================
# LASTGROVE · Docker 模式数据备份 / 恢复
#
#   bash deploy/backup-docker.sh                    备份一次
#   bash deploy/backup-docker.sh --list             看已有备份
#   bash deploy/backup-docker.sh --restore <文件>   从备份恢复
#
# 与仓库里 deploy/backup.sh 的区别：那份假设数据在宿主机目录、且宿主机有 node。
# 这台机器是纯 Docker 部署、宿主机没有 node，所以数据从容器里取、用容器里的
# node 做 JSON 校验。
#
# 为什么每次都要校验：db.json 就是全部生意（商品、订单、客户、库存流水、
# 口令 hash）。解析不了的备份等于没有备份，所以坏文件当场删掉，不留着骗人。
# ============================================================
set -euo pipefail

CONTAINER="lastgrove"
VOLUME="lastgrove-data"
IMAGE="lastgrove:1.0.0"
DEST="${BACKUP_DIR:-/var/backups/lastgrove}"
KEEP="${BACKUP_KEEP:-30}"

# 路径一律从脚本自身位置推导，不写死 /opt/xxx。
# 这台机器的代码目录历史上叫 /opt/tideglass，品牌改名后没有搬（搬目录要停机、
# 要改 compose 与 systemd，收益为零），写死路径会让脚本在新机器上静默跑错目录。
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SELF_DIR/.." && pwd)"

# 容器名以 compose 为准，镜像以实际运行的容器为准：改过名、换过 tag 都不会失效。
if [ -f "$SELF_DIR/docker-compose.yml" ]; then
  _cn="$(awk '/^[[:space:]]*container_name:/{print $2; exit}' "$SELF_DIR/docker-compose.yml" 2>/dev/null || true)"
  [ -n "${_cn:-}" ] && CONTAINER="$_cn"
fi
_running="$(docker ps --filter "name=^${CONTAINER}$" --format '{{.Image}}' 2>/dev/null | head -1 || true)"
[ -n "${_running:-}" ] && IMAGE="$_running"

# 探活端口同样从 .env 读，别假设 8080
HOST_PORT="$(sed -n 's/^HOST_PORT=//p' "$SELF_DIR/.env" 2>/dev/null | tail -1)"
HOST_PORT="${HOST_PORT:-4600}"

# 探活地址要跟着 BIND_ADDR 走：绑定到网桥地址（如 172.18.0.1）时 127.0.0.1 上没有监听，
# 写死 127.0.0.1 会把「服务正常」误判成「服务没起来」
BIND_ADDR="$(sed -n 's/^BIND_ADDR=//p' "$SELF_DIR/.env" 2>/dev/null | tail -1)"
case "${BIND_ADDR:-}" in
  ''|0.0.0.0|'[::]'|::) PROBE_HOST=127.0.0.1 ;;
  *)                   PROBE_HOST="$BIND_ADDR" ;;
esac

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
die()   { red "[x] $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行"

# ---------- 恢复 ----------
if [ "${1:-}" = "--restore" ]; then
  SRC="${2:-}"
  [ -n "$SRC" ] || die "用法：bash $SELF_DIR/backup-docker.sh --restore /var/backups/lastgrove/db-xxx.json.gz"
  [ -f "$SRC" ] || die "找不到文件：$SRC"

  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  case "$SRC" in
    *.gz) gzip -dc "$SRC" > "$TMP" ;;
    *)    cp "$SRC" "$TMP" ;;
  esac
  # 容器里的进程是 uid 10001，mktemp 默认 0600/root，不改权限它读不到
  chmod 644 "$TMP"

  # 先用容器里的 node 校验，坏文件绝不覆盖现网。
  # --entrypoint node 绕开镜像入口脚本，否则会顺带跑一次 seed。
  if ! docker run --rm -v "$TMP":/chk.json:ro --entrypoint node "$IMAGE" \
        -e "JSON.parse(require('fs').readFileSync('/chk.json','utf8'))" >/dev/null 2>&1; then
    die "这个备份解析不了，拒绝覆盖现网数据"
  fi

  docker run --rm -v "$TMP":/chk.json:ro --entrypoint node "$IMAGE" -e "
    const d=JSON.parse(require('fs').readFileSync('/chk.json','utf8'));
    console.log('  商品 %d · 订单 %d · 客户 %d', (d.products||[]).length, (d.orders||[]).length, (d.customers||[]).length);
  "

  echo "即将用 $SRC 覆盖现网数据，5 秒后开始（Ctrl+C 取消）"
  sleep 5

  cd "$SELF_DIR"
  docker compose stop >/dev/null
  # 以 root 写卷，写完把属主调回 10001，否则容器起来写不了数据
  docker run --rm --user 0:0 -v "$VOLUME":/data -v "$TMP":/chk.json:ro --entrypoint sh "$IMAGE" \
    -c 'cat /chk.json > /data/db.json && chown 10001:10001 /data/db.json && chmod 644 /data/db.json'
  docker compose start >/dev/null

  for i in $(seq 1 20); do
    if curl -fsS -m 3 "http://$PROBE_HOST:$HOST_PORT/api/v1/health" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  green "已恢复并重启：$(curl -s -m 5 "http://$PROBE_HOST:$HOST_PORT/api/v1/health")"
  exit 0
fi

# ---------- 列表 ----------
if [ "${1:-}" = "--list" ]; then
  [ -d "$DEST" ] || die "还没有备份目录"
  ls -lh "$DEST" | sed '1d'
  exit 0
fi

# ---------- 备份 ----------
mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DEST/db-$STAMP.json.gz"

docker exec "$CONTAINER" cat /app/app/server/data/db.json | gzip -9 > "$FILE.tmp"

if ! gzip -dc "$FILE.tmp" | docker exec -i "$CONTAINER" node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  let d; try { d=JSON.parse(s); } catch(e) { console.error('JSON 解析失败'); process.exit(1); }
  for (const k of ['products','orders','customers','settings']) if(!d[k]) { console.error('缺字段 '+k); process.exit(1); }
  console.log('  商品 '+d.products.length+' · 订单 '+d.orders.length+' · 客户 '+d.customers.length);
});"; then
  rm -f "$FILE.tmp"
  die "备份校验失败，已删除（不留假备份）"
fi

mv "$FILE.tmp" "$FILE"

# 商品图单独打包：db.json 里存的是 uploads/xxx.jpg 这样的路径，
# 只回滚数据不恢复图片，商品会全部变成裂图。图不多（100 款 × 3 张约 100MB），
# 压完几十 MB，值得一起备。
IMG="$DEST/uploads-$STAMP.tar.gz"
if docker exec "$CONTAINER" sh -c 'ls -1 /app/app/server/data/uploads 2>/dev/null | head -1' | grep -q .; then
  docker exec "$CONTAINER" tar -czf - -C /app/app/server/data uploads > "$IMG"
  green "[ok] $IMG  ($(du -h "$IMG" | cut -f1))"
else
  echo "  （还没有上传过图片，跳过）"
fi

# 只留最近 KEEP 份
ls -1t "$DEST"/db-*.json.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$DEST"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

green "[ok] $FILE  ($(du -h "$FILE" | cut -f1))"
