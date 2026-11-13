# ============================================================
# TIDEGLASS · 生产镜像
# 构建（在仓库根目录执行）：
#   docker build -f deploy/Dockerfile -t tideglass:1.0.0 .
# 或直接用 compose：cd deploy && docker compose up -d --build
#
# 本项目零第三方依赖，没有 npm install，所以镜像不含 node_modules，
# 也没有构建阶段——COPY 进来就能跑，镜像约 130MB。
# ============================================================
FROM node:22-alpine

# 不用 root 跑业务进程
RUN addgroup -S -g 10001 tideglass \
 && adduser  -S -u 10001 -G tideglass tideglass

WORKDIR /app

# 只拷运行时真正需要的东西：
#   app/                     前后端
#   prototype/assets/js/     种子数据来源（seed.js 要从这里读 data.js）
COPY app ./app
COPY prototype/assets/js ./prototype/assets/js
COPY deploy/docker-entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/app/server/data \
 && chown -R tideglass:tideglass /app

ENV NODE_ENV=production \
    PORT=4600

EXPOSE 4600

# 编排层看这个探针决定是否重启；测的是真接口，不是端口占用
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4600)+'/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER tideglass

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "app/server/index.js"]
