# TIDEGLASS

跨境饰品 DTC 独立站 —— 前台商店 + 后台运营，前后端分离，零第三方依赖。

- 市场：美国（主力）/ 加拿大 / 英国 · 单币种 USD · 海外仓本地发货
- 商品：316L 不锈钢 + 18k 金 PVD，首批 100 SKU，价位 $35–$85
- 技术：Node 原生 http（无框架、无 npm 依赖）+ 静态 SPA + JSON 存储

**全部交付文档在 [`handover/`](handover/README.md) —— 从那里开始看。**

**要上线到服务器？直接看 [`handover/07-交付准备/服务器部署手册-v1.0.md`](handover/07-交付准备/服务器部署手册-v1.0.md)（约 40 分钟，含一键脚本）。**

---

## 快速开始

```bash
node app/server/seed.js      # 生成演示数据（36 商品 / 67 SKU / 90 订单 / 200 条库存流水）
node app/server/index.js     # → http://localhost:4600
```

Node.js ≥ 18，不需要 `npm install`。端口用环境变量改：`PORT=5000 node app/server/index.js`

反复跑接口测试时必须带复位开关，否则第二遍会撞上一遍的数据和限流：

```bash
ALLOW_TEST_RESET=1 node app/server/index.js
curl -X POST http://127.0.0.1:4600/api/v1/__test/reset
```

Windows 双击 `start.bat`，会自动 seed、起服务并打开浏览器。

---

## 两个入口

| 入口 | 地址 | 说明 |
|---|---|---|
| 商店（买家） | http://localhost:4600/#/ | 首页、集合、详情、购物车、结算、账户、12 个内容页 |
| 后台（运营） | http://localhost:4600/#/admin | 13 个模块：看板 / 订单 / 商品 / 集合 / 库存 / 券 / 评价 / 定制需求 / 客户 / 内容 / 流水 / 审计 / 设置 |

后台账号：

| 账号 | 密码 | 权限 |
|---|---|---|
| `owner@tideglassjewelry.com` | `tideglass2026` | 10 位权限全开 |
| `ops@tideglassjewelry.com` | `tideglass-ops` | 少设置与退款权限，用来验收越权拦截 |

界面逐页说明见 [`handover/06-原型/原型说明.md`](handover/06-原型/原型说明.md)，两套整页截图在 `handover/06-原型/screenshots/`。

> 仓库里另有 `prototype/` + `server.js` —— 那是早期的**单文件设计原型**，服务端拼 HTML、数据读 `data/db.json`，只用于看视觉与信息架构。**验收和联调一律用 4600 的分离版**，两者不要混看。

---

## 目录结构

```
wildkind/
├── app/
│   ├── server/                  # REST API（Node 原生 http）
│   │   ├── index.js             #   入口、路由注册、静态托管
│   │   ├── seed.js              #   演示数据生成（含库存流水推导）
│   │   ├── routes/
│   │   │   ├── catalog.js       #   目录 / 商品 / 集合 / 搜索（9 个端点）
│   │   │   ├── checkout.js      #   报价 / 下单 / 查单（7 个端点）
│   │   │   └── admin.js         #   后台运营（31 个端点）
│   │   ├── lib/
│   │   │   ├── store.js         #   JSON + 内存镜像 + 串行原子写 + tx 回滚
│   │   │   ├── pricing.js       #   定价引擎（纯函数，唯一价格来源）
│   │   │   ├── auth.js          #   scrypt 口令、Bearer 会话、权限位
│   │   │   └── http.js          #   统一响应/错误、CORS、限流令牌桶
│   │   └── data/                #   db.json（运行数据）+ db.seed.json（基线）
│   └── web/                     # SPA 前端
│       ├── index.html
│       └── assets/
│           ├── css/             #   app.css 设计系统 / refine.css 观感层 / web.css 补充
│           ├── js/              #   api / core / ui / views / pages / admin / app
│           └── img/             #   商品图与场景图
├── handover/                    # ★ 全部交付文档（从这里开始看）
├── deploy/                      # 部署产物：systemd / nginx / docker / 脚本
├── review/                      # 文档 HTML 源文件（MD 是它的产物）
├── tools/                       # 测试与生成脚本
├── prototype/ + server.js       # 早期单文件原型（看设计用，也是 seed 的数据源）
└── start.bat
```

---

## 部署

```bash
# 服务器上（Ubuntu 22.04+ / Debian 12，root）
mkdir -p /opt/tideglass
git clone https://github.com/jiaminfu/wildkind.git /opt/tideglass/current
bash /opt/tideglass/current/deploy/install.sh shop.你的域名.com \
     https://github.com/jiaminfu/wildkind.git you@mail.com
```

跑完会打印后台地址与随机口令。脚本做完了：装 Node → 建用户 → 拉代码 → 生成环境变量 → 初始化数据 → systemd → Nginx → 防火墙 → HTTPS → 自检。

之后：`deploy/update.sh` 发版、`deploy/backup.sh` 备份/恢复。详见部署手册。

> **一条铁律**：业务进程只能一个。数据是单文件 JSON + 内存镜像，多开会互相覆盖。不要 `pm2 -i`、不要多副本。原因见部署手册第 3 章。

---

## 测试

| 套件 | 命令 | 当前结果 |
|---|---|---|
| 接口自动化 | `node tools/api-test.js` | 121 / 121 |
| 双端适配体检 | `node tools/app-check.js` | 66 / 66（21 路由 × 390/768/1440） |
| 后台点击巡查 | `node tools/admin-sweep.js` | 13 / 13（13 模块 × 3 宽度） |
| 定价与库存单元 | `node tools/unit-core.js` | 38 / 38 |
| 端到端（原型版） | `node tools/e2e.js` · `node tools/e2e-flow.js` | 17 / 17 · 47 / 47 |
| 溢出专项 | `node tools/overflow-check.js` | 28 / 28 |
| 文档生成 | `node tools/gen-openapi.js` | 生成 `handover/04-接口文档/openapi.json` |
| 截图归档 | `node tools/shot-doc.js <目录> [--only=admin\|store] [--w=390]` | 26 张/端 |

前三个需要服务已运行；`api-test.js` 需要 `ALLOW_TEST_RESET=1`（生产环境绝不要设）。

---

## 几条硬约束（写在代码里，不是文档承诺）

- **价格只在服务端算**。前端传上来的金额字段一律丢弃，只采信 `productId / metal / size / qty`
- **报价锁**。下单必须带 15 分钟有效的 `quoteId`，金额不一致直接 `PRICE_CHANGED`
- **幂等下单**。`Idempotency-Key` 头，重放返回 `replayed: true` 与原订单，不会重复扣款
- **库存只走流水**。`stockLedger` 只追加，判据是「末条 balanceAfter = 当前库存」
- **状态机单向**。终态不可回退，退款必须走 `/refund` 出口（回补库存 + 释放券 + 冲减消费）
- **前后台同一份数据**。后台改任何设置，前台下一次请求就变，没有缓存层

---

## 已知限制

| 限制 | 现状 | 解除条件 |
|---|---|---|
| 支付是测试模式 | 结算不扣真实款项 | 提供 Stripe 密钥（见 `handover/07-交付准备/`） |
| 不发真实邮件 | 写入 `mailLog`，不投递 | 提供 Resend API Key + 验发信域名 |
| 物流不回调 | 运单号可填，不查物流商 | 3PL 对接方式确定 |
| 商品图不分金属 | 一商品一套图，色点只展示 | 补齐素材后恢复卡内切换 |
| **hash 路由不利 SEO** | `#/products/xxx` 搜索引擎抓不到 | 上线前换真实路径 + SSR/预渲染（已进演进路线） |
| JSON 单文件存储 | 单人运营够用 | 订单量上去后迁 Postgres |
| 单仓 / 单币种 | 美国仓、USD | 首批 100 SKU 跑顺之后 |

前四条卡在**外部资料**上，清单与优先级见 [`handover/07-交付准备/外部资料需求清单-v1.0.md`](handover/07-交付准备/外部资料需求清单-v1.0.md)。

---

## 文档维护

- `review/*.html` 是源，`handover/**/*.md` 是 `tools/html2md.js` 的产物。改内容请改 HTML 再重新生成，直接改 MD 会被覆盖。
- 改接口后必须跑 `node tools/gen-openapi.js`，否则 OpenAPI 会悄悄过期。
- 改 UI 后跑 `tools/shot-doc.js` 重出截图，不要手工截。
