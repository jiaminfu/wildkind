# 物流追踪接入说明 — 17TRACK · v1.0

| 项 | 值 |
|---|---|
| 文档编号 | LG-TRK-001 |
| 版本 | v1.0 |
| 日期 | 2026-11-15 |
| 状态 | 已上线（17TRACK 试用额度：UPS / FedEx 正常，USPS 受政策限制） |
| 平台 | 17TRACK Tracking API **v2.4** |
| 回调地址 | `https://lastgrove.com/api/v1/webhooks/tracking` |
| 相关提交 | `100630c`（feat(tracking) 接入 17TRACK） |

---

## 1. 一句话结论

单号从后台录入那一刻起自动订阅到 17TRACK，承运商每扫一次件就往站内推一次，
客户在订单页看到「最新的在最上面」的真实轨迹，送达后订单自动变 Delivered。

**但有一件事必须先说：试用额度下 USPS 被 17TRACK 策略挡住，无法自动追踪。**
美国线是我们的主力，这条不解决，等于大部分包裹仍然只能给承运商官网链接。

---

## 2. 现在的真实能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 后台录单号即订阅 | ✅ | 保存运单号后异步订阅，不阻塞后台操作 |
| 轨迹自动推送 | ✅ | webhook + SHA-256 验签，非 200 会被重投 3 次 |
| 前台时间线 | ✅ | 查单页、订单确认页，最新在顶，最多 6 条 +「还有 N 条」 |
| 送达自动完结 | ✅ | `fulfilled` 状态下收到 `Delivered` 自动转 `completed` |
| 后台手动刷新 | ✅ | 「Refresh tracking」，查询不消耗额度，可随便点 |
| 订阅失败如实降级 | ✅ | 前台改说「自动更新不可用，去承运商官网查」，不留空框 |
| 额度自检 | ✅ | `GET /api/v1/admin/tracking/quota` |
| **USPS** | ❌ | 试用额度下 `-18019823`：需先购买套餐才放开 |
| 邮件带轨迹链接 | ✅ | 发货邮件里的按钮指向承运商官网（已有） |

---

## 3. 数据模型

轨迹存在订单对象上，不另建表——订单本身就是天然主键，
而 `db.json` 是全量落盘的单文件库，多一张表就多一份一致性负担。

```jsonc
order.trackingState = {
  status: "Delivered",            // 17TRACK 9 个主状态之一
  subStatus: "Delivered_Other",
  label: "Delivered",             // 翻成人话，前端直接显示
  stage: 4,                       // 0..4，给进度条用
  provider: "UPS",                // 实际承运商（17TRACK 识别出来的）
  events: [{ at, text, place, stage }],  // 只留最近 20 条
  eventCount: 17,
  lastEventAt: "2025-12-05T16:29:38Z",
  deliveredAt: "2025-12-05T16:29:38Z",
  registeredFor: "1Z999AA10123456784",   // 已订阅的单号
  registeredAt: "...",
  awaitingFirstScan: false,       // 订上了但承运商还没扫
  error: null,                    // 非空 = 订阅被拒，前台降级
  errorCode: -18019823,
  updatedAt: "..."
}
```

**为什么只留 20 条**：一个包裹动辄 30+ 条事件，几百单叠起来会把 `db.json`
撑到几 MB，而客户真正会看的就是最近几条。要看全部，点「see all on <承运商>」。

**为什么记 `registeredFor`**：`register` 是计费的（每个单号一次）。
不记住「这个单号已经订过」，客户每点一次刷新就烧一个额度。
换单号时（补发、输错重录）才会重新订阅。

---

## 4. 两条链路

### 出站：订阅

```
后台 POST /admin/orders/:number/tracking
  → 存单号 + 状态转 fulfilled + 发发货邮件（同步，立即返回）
  → 异步 syncOrder()：
       register(单号, tag=订单号)     ← 计费，只做一次
       gettrackinfo(单号)             ← 不计费
       写 order.trackingState
```

`tag` 用订单号而不是单号：客户改了单号（打错重输）之后，tag 仍然指向原订单。

### 入站：推送

```
17TRACK POST /api/v1/webhooks/tracking
  → 验签 SHA256(原始报文 + "/" + Key) == header sign
  → 按 tag 找订单，找不到再按单号找
  → normalize() 压平 providers[].events[]
  → apply() 幂等写入（只比内容，不比时间戳）
  → 送达则 fulfilled → completed
  → 200 { received: true }
```

**必须 200**：17TRACK 对非 200 会重投 3 次然后放弃这次变更。
**必须用原始字节验签**：JSON 重新序列化会改键序和空格，哈希必然对不上，
等于把自己的回调全部拒掉。`lib/http.js` 的 `withRaw` 已经把原文留在 `req.body.__raw`。

---

## 5. 额度与成本

| 项 | 值 |
|---|---|
| 计费单位 | 每个**新订阅的单号** 1 个额度（自动跟踪期内不重复计） |
| 当前账户 | 试用：总额度 200，今日已用 2，日上限 30 |
| 正式套餐 | ¥299 / 10,000 单（≈¥0.03/单，12 个月有效） |
| `gettrackinfo` | **不计费**，可无限查 |
| 自动跟踪节奏 | 6–12 小时一轮；已送达/异常 24 小时一轮 |
| 停止条件 | 连续 30 天无更新，或送达后 15 天 |

---

## 6. ⚠️ USPS 的策略限制（必须处理）

试用额度下订阅 USPS 单号会直接被拒：

```
-18019823  Sorry, due to the policy restrictions of the carrier 'USPS' (code: '21051'),
           registration is temporarily not supported.
           Please complete the package purchase and subsequent processes before proceeding.
```

17TRACK 官方说明是「USPS 查询受政策变化限制，需解锁更多查询额度」。
实测 UPS、FedEx 单号在试用额度下**正常订阅并返回完整轨迹**（UPS 那笔 17 条事件、
状态 Delivered 全部正确），所以链路本身没问题，卡的是 USPS 这一个承运商。

**三条路，按推荐顺序：**

1. **买套餐解锁 USPS**（¥299 / 10,000 单）。这是主路线，买完在后台把
   `-18019823` 那些单点一次「Refresh tracking」即可补订，不用改代码。
2. **换承运商**：UPS / FedEx 试用下可跑，但单价高，与 $35–85 价位不匹配。
3. **临时接受降级**：USPS 单只显示「去 USPS 官网查」链接，站内无轨迹。
   功能上可用，但客户体验和「物流透明」这个卖点就没了。

---

## 7. 部署与配置

```bash
# deploy/.env
TRACK17_KEY=170400C9B387992571F7C0B44D4B07AD
```

不配也能跑：单号照存、前台照给官网链接，只是没有自动轨迹。
启动日志会打印 `物流追踪：17TRACK 已配置（webhook 推送）` 或 `未配置`。

**17TRACK 后台设置（已按截图配置完成）**

| 项 | 值 |
|---|---|
| 小包跟踪推送 URL | `https://lastgrove.com/api/v1/webhooks/tracking` |
| 版本 | V2.4 |
| 物流状态 | 9 个状态全部勾选 |

---

## 8. 本期修掉的三个坑

| 坑 | 后果 | 处理 |
|---|---|---|
| `-18019901 已经注册过` 被当成失败 | 同一单号被两单复用（补发、退换）时，订单被永久盖上「追踪不可用」，后台点刷新也修不回来 | 识别为成功，直接进查询 |
| 幂等判断比了整块对象 | `updatedAt` 每次都新 → webhook 重投一律报 `updated:1`，日志里再也看不出真实变更 | 只比 status / label / events 等内容字段 |
| 时间线类名用了 `.tl` | 与既有的横向步骤条 `.tl{display:flex}` 撞名，标题和事件列表被挤成左右两栏 | 改名 `.trk*` |

顺带修的既有问题：确认页/查单页的订单行没有缩略图，却套了
`grid-template-columns: 46px 1fr auto`，标题被塞进 46px 那一列，
窄屏上「Cowrie Anklet」被拆成一字一行。新增 `.paysum__line--ni` 两列栅格。

---

## 9. 验收记录（本地，2026-11-15）

| # | 用例 | 结果 |
|---|---|---|
| ① | 后台刷新 → register + gettrackinfo 真链路 | ✅ 16 条事件，Delivered，承运商 UPS |
| ② | 错误签名推送 | ✅ 400 `bad signature` |
| ③ | 无签名推送 | ✅ 400 |
| ④ | 正确签名推送 | ✅ 200，`updated:1`，订单 fulfilled→completed |
| ⑤ | 重投同一事件 | ✅ 200，`updated:0`（幂等） |
| ⑥ | 前台查单接口带出轨迹 | ✅ 状态 Delivered，16 条事件 |
| ⑦ | health / quota | ✅ subscribed:1 / 200-2 |
| ⑧ | 390px 窄屏 | ✅ 无横向溢出 |
| ⑨ | USPS 被拒后降级 | ✅ 前台改说「自动更新不可用」+ USPS 官网链接 |

---

## 10. 待确认 / 待办

| # | 事项 | 负责 |
|---|---|---|
| Q-01 | 是否购买 ¥299/10,000 套餐解锁 USPS | 用户 |
| Q-02 | 面单由海外仓代打（给我们单号）还是自己打？自己打要另接 EasyPost/Shippo | 用户 |
| T-01 | 送达后是否要发「已送达」邮件（现在没有） | 待定 |
| T-02 | 批量补订：历史订单里已有的单号一键补订阅（买完套餐后可能需要） | 待定 |
