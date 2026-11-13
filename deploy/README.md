# deploy/ —— 部署产物

完整步骤、验证清单、故障排查在
**[`handover/07-交付准备/服务器部署手册-v1.1.md`](../handover/07-交付准备/服务器部署手册-v1.1.md)**。
这里只放能直接用的文件。

| 文件 | 用途 |
|---|---|
| `install.sh` | 首次部署一条命令搞定（Ubuntu 22.04/24.04、Debian 12） |
| `update.sh` | 更新发布：备份 → 拉代码 → 重启 → 探活，失败给回滚命令 |
| `backup.sh` | 备份 / 列备份 / 恢复，带 JSON 合法性硬校验 |
| `tideglass-api.service` | systemd 单元，含最小权限加固 |
| `nginx-tideglass.conf` | 有域名版：Nginx 反代 + 静态托管 + HTTPS + 安全头 |
| `nginx-tideglass-port.conf` | **无域名版**：只听独立端口，不碰已有站点的 80/443 |
| `.env.example` | 生产环境变量样例（复制到 `/etc/tideglass/tideglass.env`） |
| `Dockerfile` / `docker-compose.yml` / `docker-entrypoint.sh` | 容器方案（数据挂卷、首次启动自动初始化） |

## 最短路径

**有域名：**

```bash
# 服务器上（root）
mkdir -p /opt/tideglass
git clone https://github.com/jiaminfu/wildkind.git /opt/tideglass/current
sudo bash /opt/tideglass/current/deploy/install.sh shop.你的域名.com \
     https://github.com/jiaminfu/wildkind.git you@mail.com
```

**还没有域名 / 80·443 已被别的项目占用：**

```bash
sudo LISTEN_PORT=8080 bash /opt/tideglass/current/deploy/install.sh - \
     https://github.com/jiaminfu/wildkind.git
# → http://<服务器IP>:8080/
```

第一个参数写 `-` 就走无域名模式：不删默认站点、不抢 80/443、不动防火墙、跳过证书。
拿到域名后按手册 5.6.3 原地升级，不用重装。

跑完会打印后台地址与随机口令。**登录后第一件事是改口令。**

## 一条铁律

业务进程**只能有一个**。数据层是单文件 JSON + 内存镜像，限流与会话也在进程内存里，
起第二个进程会让两边互相覆盖数据。不要用 `pm2 -i`、不要 `--scale`、不要多副本。
需要横向扩容时先按手册第 12 章把存储换成 PostgreSQL。
