#!/usr/bin/env bash
# ============================================================
# TIDEGLASS · 数据备份 / 恢复
#
#   sudo bash deploy/backup.sh                  备份一次
#   sudo bash deploy/backup.sh --list           看已有备份
#   sudo bash deploy/backup.sh --restore <文件>  从备份恢复
#
# 为什么要单独写脚本：db.json 就是全部生意——商品、订单、客户、券、库存流水、
# 账号口令 hash 都在这一个文件里。丢了没有第二个地方能找回来。
# 所以每次备份都要「能解析成合法 JSON」才算成功，不做这个校验的备份等于没有。
# ============================================================
set -euo pipefail

DATA_DIR="/opt/tideglass/current/app/server/data"
DB="$DATA_DIR/db.json"
DEST="${BACKUP_DIR:-/var/backups/tideglass}"
KEEP="${BACKUP_KEEP:-30}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
die()   { red "[×] $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行"
mkdir -p "$DEST"

case "${1:-}" in
  --list)
    ls -lh "$DEST" | sed '1d'
    exit 0
    ;;
  --restore)
    SRC="${2:-}"
    [ -n "$SRC" ] || die "用法：bash deploy/backup.sh --restore $DEST/db-20261113-101500.json.gz"
    [ -f "$SRC" ] || die "找不到文件：$SRC"

    TMP="$(mktemp)"
    case "$SRC" in
      *.gz) gzip -dc "$SRC" > "$TMP" ;;
      *)    cp "$SRC" "$TMP" ;;
    esac

    node -e "JSON.parse(require('fs').readFileSync('$TMP','utf8'))" \
      || { rm -f "$TMP"; die "这个备份文件解析不了，拒绝用它覆盖现网数据"; }

    echo "即将用以下文件覆盖现网数据："
    echo "  $SRC"
    node -e "
      const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));
      console.log('  商品 %d · 订单 %d · 客户 %d', d.products.length, d.orders.length, d.customers.length);
    "
    read -r -p "确认恢复？现网数据会被先另存一份 [y/N] " ok
    [ "$ok" = "y" ] || die "已取消"

    # 覆盖前先把现状存一份，恢复错了还能退回来
    cp "$DB" "$DEST/before-restore-$(date +%Y%m%d-%H%M%S).json"
    systemctl stop tideglass-api
    install -o tideglass -g tideglass -m 640 "$TMP" "$DB"
    rm -f "$TMP"
    systemctl start tideglass-api
    sleep 2
    systemctl is-active --quiet tideglass-api \
      && green "    已恢复并重启成功" \
      || die "恢复后服务没起来，看 journalctl -u tideglass-api"
    exit 0
    ;;
esac

# ---------- 备份 ----------
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/db-$TS.json"

[ -f "$DB" ] || die "找不到 $DB"

# 数据层用「写临时文件 + rename」保证不出现半个 JSON，
# 所以这里直接 cp 拿到的必然是某一次完整写入的内容，不会读到中间态。
cp "$DB" "$OUT"

# 硬校验：解析不了就当场废掉这份备份，不要留一个看起来存在的坏备份
if ! node -e "JSON.parse(require('fs').readFileSync('$OUT','utf8'))" 2>/dev/null; then
  rm -f "$OUT"
  die "备份文件无法解析，已删除"
fi

gzip -9 "$OUT"
green "    已备份 $(basename "$OUT").gz（$(du -h "$OUT.gz" | cut -f1)）"

# ---------- 保留策略 ----------
COUNT="$(find "$DEST" -maxdepth 1 -name 'db-*.json.gz' | wc -l)"
if [ "$COUNT" -gt "$KEEP" ]; then
  find "$DEST" -maxdepth 1 -name 'db-*.json.gz' -printf '%T@ %p\n' \
    | sort -n | head -n "$((COUNT - KEEP))" | cut -d' ' -f2- | xargs -r rm -f
  echo "    已清理，保留最近 $KEEP 份"
fi

# ---------- 异地一份（可选） ----------
# 服务器整机挂了，本地备份跟着一起没。若配了 rclone 就顺手推到对象存储：
#   apt install -y rclone && rclone config    # 建一个名为 oss 的远端
#   export RCLONE_REMOTE=oss:tideglass-backup
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$OUT.gz" "$RCLONE_REMOTE" --quiet && green "    已同步到 $RCLONE_REMOTE"
fi

echo
echo "恢复：sudo bash deploy/backup.sh --restore $OUT.gz"
