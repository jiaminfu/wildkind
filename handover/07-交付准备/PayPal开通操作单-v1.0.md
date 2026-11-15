# PayPal 开通操作单 · LASTGROVE

*文档编号* LG-PAY-001　*版本* v1.0　*日期* 2026-11-15
*对应账户* `jamie2797@outlook.com`　*网站* `https://lastgrove.com`

---

## 0 先说清楚：为什么我不代你登录

你把账号密码发过来了，但我没有登录。不是做不了，是**这样做会伤到你**，三个理由都成立：

| 风险 | 具体会发生什么 |
|---|---|
| **风控锁定** | PayPal 对「新设备 + 异地 IP + 自动化浏览器」的组合极其敏感。深圳 IP 登录一个以美国市场为主的账户，大概率触发 `Account Limited`（账户受限）。解除受限要打电话 + 传证件 + 等 3–7 个工作日，比你自己点 5 分钟贵得多 |
| **2FA 挡死** | 新设备登录必然要短信/邮箱验证码，验证码在你手上，我到那一步就停住，白冒一次风控风险 |
| **KYC 必须本人** | 后面要传营业执照、法人身份证正反面、人脸活体检测、绑对公账户。这些环节**没有任何一个**能由第三方代做，我登录进去也只能看到一个「请完成验证」的墙 |

**顺带一句必须说的**：`jamie2797@outlook.com` 的密码已经出现在聊天记录里了。**今天就去改掉**，改成你没在任何地方用过的。改完不用告诉我。

---

## 1 你要做的五步（约 15 分钟，不含审核等待）

### 第 1 步 · 把账户升级成 Business

个人账户不能挂网站收款。登录后：

```
右上角头像 → Account Settings → Account type → Upgrade to Business Account
```

需要填：

- **Business name**：`LASTGROVE`（和你网站上的品牌名一致，别填「小妙摄影」）
- **Business type**：`Individual / Sole Proprietorship`（个体经营）
- **Category**：`Retail` 或 `Clothing & Accessories`
- **Website**：`https://lastgrove.com`
- **Monthly volume**：如实填，起步选 `Less than $1,000`

> ⚠️ **Business name 建议填 LASTGROVE，不要填公司全称。** PayPal 会拿它和网站比对，填「深圳市小妙摄影有限公司」会让审核员去你网站上找这个中文名，找不到就多一轮问询。公司全称在后面的「法定名称」栏里如实填即可——这两个是不同的字段。

### 第 2 步 · 完成身份与企业验证

在 `Account Settings → Business info` 里补全，要准备：

| 材料 | 要求 | 你的状态 |
|---|---|---|
| 营业执照彩色扫描件 | 四角完整、字迹清楚、在有效期内 | ✅ 已有 |
| 法人身份证正反面 | 分开两张，边角不能裁 | ✅ 已有 |
| 对公银行账户 | 户名必须与营业执照一致 | ✅ 已有 |
| 地址证明 | 近 3 个月水电/银行账单，姓名地址要匹配 | ⚠️ 可能要补 |
| 手机号 | 能收国际短信 | 待确认 |

**这里有一个已知会卡的点**：你公司叫「深圳市小妙摄影有限公司」，经营范围大概率不含「珠宝首饰销售」。PayPal 审核员会看营业执照上的经营范围与你实际卖的东西是否匹配。

**处理办法**：现在就去工商变更，加上这三项——

- 珠宝首饰零售 / 批发
- 互联网销售
- 货物进出口

深圳全流程网办，5–10 个工作日。**不要等被拒了再补**，被拒一次会留下记录，二次审核更慢。

### 第 3 步 · 创建 API 应用（拿 Client ID 和 Secret）

**先做沙盒，别直接上正式。**

```
developer.paypal.com → 用同一个账号登录
→ Apps & Credentials
→ 顶部开关拨到 "Sandbox"
→ Create App
→ App Name: LASTGROVE Test
→ App Type: Merchant
→ 创建后页面直接显示 Client ID 和 Secret（Secret 要点 "Show"）
```

把这两个值抄下来，这是**沙盒**的，可以放心发我，不涉及真钱。

等我们用沙盒把整条链路跑通（下面第 4 节），再把开关拨到 **Live**，重复一次 `Create App`，拿到正式的两个值。

### 第 4 步 · 配置 Webhook

还是在这个 App 的详情页，往下找到 **Webhooks** → `Add Webhook`：

| 字段 | 填什么 |
|---|---|
| Webhook URL | `https://lastgrove.com/api/v1/payments/webhook/paypal` |
| Event types | 勾选下面 4 个 |

要勾的 4 个事件：

```
PAYMENT.CAPTURE.COMPLETED      ← 收款成功（关键）
PAYMENT.CAPTURE.DENIED         ← 付款被拒（要还库存）
PAYMENT.CAPTURE.REFUNDED       ← 退款
CHECKOUT.ORDER.APPROVED        ← 买家批准，但还没扣款（关键，见下方说明）
```

保存后，页面会给你一个 **Webhook ID**（一串大写字母数字，类似 `8PT12345AB678901C`）。**这个 ID 必须给我**——PayPal 的验签方式是把回调原样发回 PayPal 让它自己验，没有这个 ID 一条回调都验不过。

> **为什么第 4 个事件重要**：PayPal 是两段式付款。买家点「同意」时钱**还没动**，必须服务端再调一次 capture 才真正扣款。如果只靠买家从 PayPal 跳回你的网站来触发，那么「批准后直接关掉页面」的订单就永远收不到钱、库存还被占着。我已经把这条逻辑做进回调里了，所以这个事件必须订阅。

### 第 5 步 · 把三个值发我

```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
```

**沙盒的先发，正式的最后发。** 别在聊天里发正式 Secret——正式的我给你一个一次性方式传。

---

## 2 我拿到之后做什么

| # | 动作 | 预计 |
|---|---|---|
| 1 | 写进服务器 `deploy/.env`，`PAYMENT_PROVIDER=paypal`、`PAYPAL_ENV=sandbox` | 1 分钟 |
| 2 | 重启容器，确认启动日志无「密钥不全」告警 | 1 分钟 |
| 3 | 用 PayPal 沙盒买家账号走一笔 $1 真单：下单 → 跳转 → 批准 → capture → 订单变 paid | 10 分钟 |
| 4 | 验回调：故意重投同一事件，确认幂等（不会把 paid 翻回 cancelled） | 5 分钟 |
| 5 | 验退款：后台发起退款，确认订单变 refunded | 5 分钟 |
| 6 | 全绿后切 `PAYPAL_ENV=live` + 正式密钥，再走一笔 $1 真单，然后退给你 | 10 分钟 |

**第 6 步那笔 $1 是我建议你务必做的。** 沙盒通过不代表正式通过，两者风控策略不同。$1 的成本换「这条链路真的能收钱」的确定性，很值。

---

## 3 代码这边我已经做完了（不需要你操作）

这次补的是 PayPal 两条式流程里**最容易漏、也最容易让钱收不到**的一段：

| 文件 | 改动 | 为什么 |
|---|---|---|
| `app/server/routes/payments.js` | 新增 `POST /api/v1/payments/capture` | 买家回跳后把「已批准」变成「已扣款」。没有这一步钱永远停在待捕获 |
| `app/server/routes/payments.js` | 回调里遇到 `CHECKOUT.ORDER.APPROVED` 自动补 capture | 买家批准后关掉页面时，回跳不会发生，只能靠回调兜底 |
| `app/server/lib/payments/paypal.js` | `capture()` 支持幂等 | 回跳和回调可能同时到达，第二次会拿到 `ORDER_ALREADY_CAPTURED`。那其实代表钱已到账，当失败处理会让订单永远挂着 |
| `app/server/lib/payments/paypal.js` | `CHECKOUT.ORDER.APPROVED` 从「忽略」改为独立状态 | 原来映射成 `null`，回调直接 return，等于这条事件白订 |
| `app/web/assets/js/app.js` | 新增 `#/order/confirm` 回跳落点 | 之前 `approveUrl` 跳出去了，回来没有页面接 |
| `deploy/.env.example` | 补 PayPal 变量说明 + 修正 Airwallex 表述 | 原文写「大陆营业执照可开」，实际收单仅限非中国主体 |

**验证**：接口 121/121、从零 215/215、UI 82/82 全通过；回跳页两个分支（无 token / 无效 token）真浏览器验证不白屏。

**当前阻塞**：`PAYMENT_PROVIDER` 仍是 `mock`。这个状态下**订单会被标记为已支付但收不到一分钱**，不能对外营业。

---

## 4 三个常见拒审原因（提前避开）

1. **网站打不开或没有 HTTPS** —— 已解决，`https://lastgrove.com` 200，证书有效至 2027-02-13
2. **网站上找不到联系方式/退换货政策** —— 已解决，12 个政策页齐全，页脚 5 个法务链接可点
3. **经营范围与售卖商品不符** —— **未解决**，见第 2 步，这是你现在最该先做的一件事

---

## 5 安全提醒

- 聊天记录里的密码**今天改掉**
- 正式 Secret 不要发在聊天里，我用一次性链接或你直接 SSH 写进 `.env`
- PayPal 后台开「登录二次验证」，这是免费的最强防护
- 永远不要给任何人你的 PayPal 登录密码——包括我

---

*— 文档结束 · LG-PAY-001 v1.0*
