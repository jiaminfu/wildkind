#!/bin/sh
# LASTGROVE 上机体检 · 只读，不改任何配置
# 用法：sudo sh diag.sh > /tmp/lg-diag.txt 2>&1; cat /tmp/lg-diag.txt
# 输出可直接贴回，不含任何口令或密钥

echo "===== 0. 基本信息 ====="
date
hostname
uname -srm
echo "uptime: $(uptime | sed 's/^ *//')"
echo

echo "===== 1. 端口监听（80/443/8080）====="
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep -E ':(80|443|8080)\b' || echo "（以上端口无监听）"
echo

echo "===== 2. 容器与端口映射 ====="
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "docker 不可用"
echo
echo "--- 全部容器（含已停止）---"
docker ps -a --format '{{.Names}} | {{.Status}}' 2>/dev/null
echo

echo "===== 3. Caddy 详情 ====="
CADDY=$(docker ps --filter name=caddy --format '{{.Names}}' 2>/dev/null | head -1)
if [ -n "$CADDY" ]; then
  echo "容器名: $CADDY"
  echo "--- 版本 ---"
  docker exec "$CADDY" caddy version 2>/dev/null
  echo "--- 挂载 ---"
  docker inspect "$CADDY" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' 2>/dev/null
  echo "--- 端口发布 ---"
  docker inspect "$CADDY" --format '{{json .NetworkSettings.Ports}}' 2>/dev/null
  echo "--- Caddyfile ---"
  docker exec "$CADDY" cat /etc/caddy/Caddyfile 2>/dev/null || echo "（读不到 Caddyfile）"
else
  echo "未找到 caddy 容器"
fi
echo

echo "===== 4. LASTGROVE 容器 ====="
LG=$(docker ps -a --filter name=lastgrove --format '{{.Names}}' 2>/dev/null | head -1)
if [ -n "$LG" ]; then
  echo "容器名: $LG"
  docker inspect "$LG" --format '镜像: {{.Config.Image}}
状态: {{.State.Status}}  启动: {{.State.StartedAt}}
端口: {{json .NetworkSettings.Ports}}' 2>/dev/null
  echo "--- 挂载 ---"
  docker inspect "$LG" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' 2>/dev/null
  echo "--- 环境变量（仅键名）---"
  docker inspect "$LG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | cut -d= -f1
  echo "--- 自检 ---"
  curl -s -m 5 -o /dev/null -w 'internal 8080: %{http_code}\n' http://127.0.0.1:8080/ 2>/dev/null
  curl -s -m 5 http://127.0.0.1:8080/api/v1/health 2>/dev/null; echo
else
  echo "未找到 lastgrove 容器"
fi
echo

echo "===== 5. 项目目录 ====="
for d in /opt/lastgrove /opt/tideglass /root/lastgrove /srv/lastgrove; do
  [ -d "$d" ] && echo "存在: $d" && ls -la "$d" 2>/dev/null | head -12
done
echo

echo "===== 6. 数据卷 ====="
docker volume ls 2>/dev/null | grep -Ei 'grove|glass|qris|caddy' || echo "（无相关卷）"
echo

echo "===== 7. 宿主机 nginx 是否存在（应为不存在）====="
command -v nginx >/dev/null 2>&1 && echo "警告：宿主机装了 nginx，会与 Docker 抢 80" || echo "未安装 nginx（正确）"
echo

echo "===== 8. 防火墙 ====="
(ufw status 2>/dev/null | head -3) || echo "ufw 不可用"
(iptables -L INPUT -n 2>/dev/null | head -5) || echo "iptables 需 root"
echo

echo "===== 9. 资源 ====="
df -h / 2>/dev/null | tail -2
free -m 2>/dev/null | head -2
echo

echo "===== 10. 最近错误日志（各 3 行）====="
[ -n "$CADDY" ] && echo "--- caddy ---" && docker logs "$CADDY" --tail 20 2>&1 | grep -iE 'error|fail|warn' | tail -3
[ -n "$LG" ] && echo "--- lastgrove ---" && docker logs "$LG" --tail 20 2>&1 | grep -iE 'error|fail|warn' | tail -3
echo

echo "===== 体检结束 ====="
