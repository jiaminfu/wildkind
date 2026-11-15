# 域名接入执行单 · lastgrove.com

*文档编号* LG-OPS-001　*版本* v1.0　*日期* 2026-11-15　*目标服务器* `194.36.85.20`

> 前提：`lastgrove.com` 已注册，NS 在 Cloudflare（`candy/sean.ns.cloudflare.com`）。
> 本文只写**需要做什么**与**为什么**，命令逐条可复制。

---

## 1 服务器现状（2026-11-15 实测，非推测）

| 项 | 实测结果 | 含义 |
|---|---|---|
| `http://194.36.85.20/` | 200 · `<title>QRIS 收银台 · Bali</title>` | 80 归 QRIS 的 Caddy（Docker 容器） |
| `http://194.36.85.20:8080/` | **200** | LASTGROVE 已在跑（Docker，独立端口） |
| `443` | **Connection refused** | 机器可达，但 443 无人监听 → **caddy 容器很可能没发布 443** |
| `lastgrove.com` A 记录 | 无 | DNS 未配 |

**关键推论**：Caddy 现在用的是「只有 IP」的配置（只写 `:80`）。加域名站点会让 Caddy 自动申请证书并监听 443——但如果容器没把 443 发布出来，证书签了也访问不到。**上机第一件事是确认这一点。**

---

## 2 安全红线（照《同机共存部署检查单 v1.0》）

| # | 不能做 | 后果 |
|---|---|---|
| 1 | 在这台机 `apt install nginx` | 与 Docker 抢 80，Caddy 起不来 |
| 2 | `docker compose down -v` | 删掉 QRIS 的数据卷 `qris-data`，不可恢复 |
| 3 | `ufw enable` | 别的服务立刻对外失联 |
| 4 | 不加备份就改 Caddyfile | QRIS 站点可能一起挂 |

---

## 3 上机体检（先把输出贴回来，再动手）

```bash
# 1. 谁在听 80/443/8080（docker-proxy 就是容器发布出来的）
sudo ss -lntp | grep -E ':(80|443|8080)\b'

# 2. 容器与端口映射——重点看 caddy 有没有 443
docker ps --format 'table {{.Names}}\t{{.Ports}}'

# 3. 定位 Caddyfile（两种常见位置）
docker inspect $(docker ps --filter name=caddy --format '{{.Names}}') \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'

# 4. Caddy 当前配置里有哪些站点
docker exec $(docker ps --filter name=caddy --format '{{.Names}}') \
  cat /etc/caddy/Caddyfile
```

### 判定分支

| 体检结果 | 走哪条路 |
|---|---|
| caddy **有** `0.0.0.0:443->443/tcp` | 直接做第 5 节，无需改 compose |
| caddy **没有** 443 | 先做第 4 节补端口（**会重建 caddy 容器，QRIS 中断约 2 秒**），再做第 5 节 |

---

## 4 补 443（仅当容器未发布 443 时）

在 QRIS 的 `docker-compose.yml` 里给 caddy 服务加两行：

```yaml
  caddy:
    ports:
      - "80:80"
      - "443:443"        # 新增
      - "443:443/udp"    # 新增（HTTP/3，可选）
    extra_hosts:
      - "host.docker.internal:host-gateway"   # 新增，供反代宿主机 8080
```

然后：

```bash
cd <qris 项目目录>
docker compose up -d caddy     # 只重建 caddy，不碰 app 与 sweeper
docker ps --format 'table {{.Names}}\t{{.Ports}}'   # 确认 443 出现
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/   # QRIS 仍 200
```

**这是唯一会短暂影响另一个项目的步骤，执行前需要用户确认。**

---

## 5 加站点（核心改动）

在 Caddyfile 末尾追加：

```
lastgrove.com, www.lastgrove.com {
	encode gzip
	reverse_proxy host.docker.internal:8080 {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
	}
}
```

**为什么反代到 `8080` 而不是容器名 `lastgrove:4600`**：两个项目在各自独立的 compose 网络里，
容器名互相解析不到。走上宿主机端口最省事，且不改 LASTGROVE 的 compose。
想更彻底可以后期把两个网络接起来，收益只是少一跳 NAT，现在不值得。

**注意 `Host` 必须透传**：`app/server` 的限流与 SEO 里用到 Host；不透传会拿到 `host.docker.internal`。

改完先校验再 reload：

```bash
CADDY=$(docker ps --filter name=caddy --format '{{.Names}}')

# 备份（带时间戳，出问题 10 秒回滚）
docker exec $CADDY cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M)

# 语法校验——这一步不过就别 reload
docker exec $CADDY caddy validate --config /etc/caddy/Caddyfile

# 生效（reload 不断连接，QRIS 不受影响）
docker exec $CADDY caddy reload --config /etc/caddy/Caddyfile
```

---

## 6 DNS（由用户在 Cloudflare 操作）

| 类型 | 名称 | 内容 | 代理状态 |
|---|---|---|---|
| A | `@` | `194.36.85.20` | **仅 DNS（灰云）** |
| A | `www` | `194.36.85.20` | **仅 DNS（灰云）** |

**必须灰云**：橙云会让 Cloudflare 接管解析，Caddy 的 HTTP-01 校验失败，证书签不下来。

先配 DNS 等解析生效，再 reload Caddy，否则证书申请会失败并进入退避重试（Caddy 会自己重试，但会浪费十几分钟）。

```bash
# 解析生效的判断标准（本机）
nslookup lastgrove.com 8.8.8.8
# 应返回 194.36.85.20，且不是 Cloudflare 的 104.x/172.67.x
```

---

## 7 验收（7 条，缺一不可）

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | 证书签发成功 | `docker exec $CADDY ls /data/caddy/certificates` | 有 `lastgrove.com` 目录 |
| 2 | 主域 HTTPS | `curl -sI https://lastgrove.com/` | `200`，且 `content-type: text/html` |
| 3 | www 也通 | `curl -sI https://www.lastgrove.com/` | `200` 或 `301` 到主域 |
| 4 | HTTP 自动跳 HTTPS | `curl -sI http://lastgrove.com/` | `308` |
| 5 | 接口走同域 | `curl -s https://lastgrove.com/api/v1/health` | `{"status":"ok",...}` |
| 6 | **QRIS 没被影响** | `curl -sI http://127.0.0.1/` | 200，标题仍是 QRIS |
| 7 | 证书有效期 | `curl -sI https://lastgrove.com/ \| grep -i expires` | 有值 |

第 5 条最关键：它证明 `Host` 透传与反代链路都对。如果 502，先看 `docker logs $CADDY --tail=50`。

---

## 8 上线后必做（当天）

| # | 动作 | 原因 |
|---|---|---|
| 1 | 设 `PUBLIC_URL=https://lastgrove.com` 并重启 lastgrove 容器 | 邮件里的链接、发票、canonical 会用到 |
| 2 | 云安全组**关闭 8080 公网入站** | 否则 HTTP 明文可绕过 HTTPS 访问后台 |
| 3 | 提交 `sitemap.xml` 到 Google Search Console | 新域名需要收录 |
| 4 | Cloudflare 若要开橙云：SSL 模式设 `Full (strict)` | 否则重定向死循环 |
| 5 | 备份 cron（原本就该有） | `15 3 * * * /opt/<项目>/deploy/backup.sh` |

> 第 2 条注意：关 8080 后，第 5 节的反代不受影响（Caddy 走宿主机内网），但**从公网直接测 8080 会失败**，这是预期行为。

---

## 9 回滚

```bash
# 只回滚 Caddy 配置（最快，10 秒）
docker exec $CADDY cp /etc/caddy/Caddyfile.bak-<时间戳> /etc/caddy/Caddyfile
docker exec $CADDY caddy reload --config /etc/caddy/Caddyfile

# 如果第 4 节动过 compose，去掉那两行再：
cd <qris 项目目录> && docker compose up -d caddy
```

LASTGROVE 容器不需要动——它一直在 8080 上独立运行，域名只是外面加了一层。

---

## 10 本文未覆盖、需要单独确认的

| 项 | 说明 |
|---|---|
| 服务器上 LASTGROVE 的实际目录 | 文档假设 `/opt/lastgrove`，但是否已按新名部署需上机确认 |
| 容器名与数据卷名 | 若仍是 `lastgrove`/`lastgrove-data`，改名要迁数据，**建议保留不动**——用户看不见，改了只有风险 |
| 8080 是否在安全组放行 | 现已可从公网访问，说明是放行的；第 8 节要关掉 |
| Caddy 版本 | `caddy version` 确认 ≥ 2.5（`host.docker.internal` 依赖 `host-gateway`） |

---

*— 文档结束 · LG-OPS-001 v1.0 · 现状数据来自 2026-11-15 对 194.36.85.20 的实测探测*
