#!/bin/sh
# ============================================================
# TIDEGLASS · 容器启动入口
# 只在「数据卷里还没有 db.json」时做一次初始化，绝不覆盖已有数据。
# 这一步不能放进 Dockerfile 的 build 阶段：镜像里烘进种子数据，
# 每次拉新镜像都会把现网订单盖掉。
# ============================================================
set -e

DATA_DIR=/app/app/server/data
DB=$DATA_DIR/db.json

if [ ! -f "$DB" ]; then
  echo "[init] $DB 不存在，用种子数据初始化…"
  node app/server/seed.js
  echo "[init] 完成。请立即登录后台修改默认口令。"
else
  echo "[init] 已有数据文件，跳过初始化（商品订单不受本次部署影响）"
fi

exec "$@"
