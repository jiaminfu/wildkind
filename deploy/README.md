# deploy/ —— 部署产物

完整步骤、验证清单、故障排查在
**[`handover/07-交付准备/服务器部署手册-v1.0.md`](../handover/07-交付准备/服务器部署手册-v1.0.md)**。
这里只放能直接用的文件。

| 文件 | 用途 |
|---|---|
| `install.sh` | 首次部署一条命令搞定（Ubuntu 22.04/24.04、Debian 12） |
| `update.sh` | 更新发布：备份 → 拉代码 → 重启 → 探活，失败给回滚命令 |
| `backup.sh` | 备份 / 列备份 / 恢复，带 JSON 合法性硬校验 |
| `tideglass-api.service` | systemd 单元，含最小权限加固 |
| `nginx-tideglass.conf` | Nginx 反代 + 静态托管 + HTTPS + 安全头 |
| `.env.example` | 生产环境变量样例（复制到 `/etc/tideglass/tideglass.env`） |
| `Dockerfile` / `docker-compose.yml` / `docker-entrypoint.sh` | 容器方案（数据挂卷、首次启动自动初始化） |

## 最短路径

```bash
# 服务器上（root）
mkdir -p /opt/tideglass
git clone https://github.com/jiaminfu/wildkind.git /opt/tideglass/current
sudo bash /opt/tideglass/current/deploy/install.sh shop.你的域名.com \
     https://github.com/jiaminfu/wildkind.git you@mail.com
```

跑完会打印后台地址与随机口令。**登录后第一件事是改口令。**

## 一条铁律

业务进程**只能有一个**。数据层是单文件 JSON + 内存镜像，限流与会话也在进程内存里，
起第二个进程会让两边互相覆盖数据。不要用 `pm2 -i`、不要 `--scale`、不要多副本。
需要横向扩容时先按手册第 12 章把存储换成 PostgreSQL。
