# 域名接入执行单 · lastgrove.com

*文档编号* LG-OPS-001　*版本* **v1.1**　*日期* 2026-11-15　*目标服务器* `194.36.85.20`

> 前提：`lastgrove.com` 已注册，NS 在 Cloudflare（`candy/sean.ns.cloudflare.com`）。
> 本文只写**需要做什么**与**为什么**，命令逐条可复制。

> **v1.1 修订说明**：v1.0 中「443 未发布、需改 QRIS compose 并中断 2 秒」的推论**是错的**。
> 2026-11-15 13:35 上机实测推翻了它：caddy 容器**早已发布 443**，iptables 也已放行，
> 真正原因是**容器内只监听 `:80`**（Caddyfile 只写 `:80`）。加上域名站点后 caddy 自行监听 443，
> **全程无需改 compose、无需重建容器、QRIS 零中断**。第 4 节保留作应急参考，本次未执行。

---

## 1 服务器现状（2026-11-15 上机实测）

| 项 | 实测结果 | 含义 |
|---|---|---|
| `http://194.36.85.20/` | 200 · `<title>QRIS 收银台 · Bali</title>` | 80 归 QRIS 的 Caddy（Docker 容器） |
| `http://194.36.85.20:8080/` | **200** | LASTGROVE 已在跑（Docker，独立端口） |
| 容器内 `ss -lntp` | 只有 `:::80` | **443 没监听**，这才是外网 refused 的真因 |
| `docker ps` 端口 | `0.0.0.0:443->443/tcp` + `[::]:443` | **443 早就发布了**，v1.0 的判断有误 |
| `iptables -S` | `-A INPUT -p tcp --dport 443 -j ACCEPT` | 防火墙已放行 |
| `host.docker.internal` | **解析失败**（ExtraHosts 为空） | 反代不能用它，见第 5 节 |

**关键结论**：不是端口没发布，是**容器里没人监听 443**。Caddyfile 加上带域名的站点后，
caddy 自动开 443 并申请证书，端口映射无需改动。

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
| caddy **有** `0.0.0.0:443->443/tcp` | 直接做第 5 节，无需改 compose ← **本次即此分支** |
| caddy **没有** 443 | 先做第 4 节补端口（会重建 caddy 容器，QRIS 中断约 2 秒），再做第 5 节 |

---

## 4 补 443（**实测不需要** —— 保留作应急）

> 本次实测：caddy 已发布 `443->443/tcp`，**本节未执行**。若将来换机器或重建 caddy，
> 且 `docker ps` 里确实看不到 443，再按下面做。

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

**改哪个文件**：caddy 挂载的是 `/opt/qris-cashier/deploy/Caddyfile.ip`（IP 直连版），
不是 `Caddyfile`。追加到前者，改完在宿主机就生效（bind mount）。

**必须原地追加，不能 `mv` 覆盖**：单文件 bind mount 锁的是 inode，
用 `mv` 换文件会让容器仍指向旧 inode，改了看不到。用 `>>` 或原地写入。

在 Caddyfile.ip 末尾追加（本次实际内容）：

```
lastgrove.com, www.lastgrove.com {
	encode zstd gzip

	reverse_proxy 172.18.0.1:8080 {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
		flush_interval -1
	}

	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	log {
		output file /data/lastgrove-access.log {
			roll_size 10mb
			roll_keep 3
		}
	}
}
```

**为什么是 `172.18.0.1:8080` 而不是容器名或容器 IP**（三条都实测过）：

| 写法 | 结果 | 原因 |
|---|---|---|
| `host.docker.internal:8080` | ✗ 解析失败 | caddy 的 `HostConfig.ExtraHosts` 为空 |
| `172.19.0.2:4600`（lastgrove 容器 IP） | ✗ 超时 | 跨网桥被 `-A DOCKER ! -i br-8f4c7af3442f -o br-8f4c7af3442f -j DROP` 拦掉 |
| `172.18.0.1:8080`（宿主机网关） | ✓ 返回 health JSON | 走 docker-proxy，不受网桥隔离影响 |

`172.18.0.1` 是 caddy 所在网桥 `br-8f4c7af3442f` 的网关地址。**docker 网络重建后可能变**，
届时用 `ip -4 addr show | grep br-` 确认并改这一行。

**注意 `Host` 必须透传**：`app/server` 的限流与 SEO 里用到 Host；不透传会拿到网关地址。

改完先校验再 reload：

```bash
CADDY=qris-cashier-caddy-1

# 备份（带时间戳，出问题 10 秒回滚）
cp -a /opt/qris-cashier/deploy/Caddyfile.ip /opt/qris-cashier/deploy/Caddyfile.ip.bak-$(date +%Y%m%d-%H%M)

# 语法校验——这一步不过就别 reload
docker exec $CADDY caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# 生效（reload 不断连接，QRIS 不受影响）
docker exec -w /etc/caddy $CADDY caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

# 立刻确认 QRIS 没被影响
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
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

## 11 本次实际执行记录（2026-11-15 13:33–13:45）

| 步骤 | 命令要点 | 结果 |
|---|---|---|
| 1 | 装公钥到 `~/.ssh/authorized_keys` | 免密登录成功 |
| 2 | 跑 `deploy/diag.sh` 体检 | 发现 443 已发布、Caddyfile 挂的是 `.ip` 版 |
| 3 | 备份 `Caddyfile.ip.bak-20261115-053615` | inode 262147 记录在案 |
| 4 | 原地追加 lastgrove 站点块 | 1217 → 2868 字节，inode 未变 |
| 5 | `caddy validate` → `caddy reload` | Valid configuration；QRIS 仍 200 |
| 6 | 代码合入（8 提交 / 127 文件） | GitHub 直连与代理均不可用，改走 `git bundle` + scp |
| 7 | 数据卷 `tideglass-data` → `lastgrove-data` | 保留 uid 10001，含 45 张 uploads |
| 8 | `deploy/.env` 生成 | 密码从旧容器提取，未回显；`PUBLIC_URL`/`CORS_ORIGIN` 指向域名 |
| 9 | `docker compose build` → `up -d` | `lastgrove:1.0.0`，healthy，8080 正常 |
| 10 | 本地 db.json + uploads 同步进容器 | 12→37 商品、0→92 订单；`chown lastgrove` 否则无法写入 |
| 11 | 品牌核对 | `brand=LASTGROVE`、`Grows on you.`、无旧品牌残留、sitemap 域名正确 |

**代码传输的坑**：`git push` 走代理报 `Empty reply from server`，直连 GitHub 超时。
解法是 `git bundle create x.bundle 36804bb..main`（1.7 MB）→ `scp` → 服务器 `git fetch x.bundle main:refs/heads/incoming` → `git merge --ff-only incoming`。

**数据写入的坑**：`docker cp` 后文件属主变成 root，容器内以 `lastgrove`(10001) 运行，
`store.tx()` 写盘会失败。必须 `docker exec -u root lastgrove chown -R lastgrove:lastgrove /app/app/server/data`。

---

## 12 待决策（本次留口）

| 项 | 现状 | 影响 |
|---|---|---|
| 92 个测试订单 + 60 条测试评价 | 已随本地库同步上线 | 后台订单/评价列表全是验收假数据，客户看不到，但自己看着乱 |
| `PAYMENT_PROVIDER=mock` | 生产环境仍是 mock | 启动日志每次告警；下单会标"已支付"但实际未收款，**不可对外收单** |
| 8080 公网仍开放 | 可从公网明文访问后台 | 域名生效并验证后应关掉安全组入站 |

---

*— 文档结束 · LG-OPS-001 v1.1 · 现状数据来自 2026-11-15 对 194.36.85.20 的上机实测*
