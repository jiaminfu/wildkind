# -*- coding: utf-8 -*-
"""SDD v2.1 -> v2.2 终稿：架构闭环补充（订单类型、退款回退、库存流水、价格锁定、对账）"""
import io

P = 'review/SDD-系统设计说明书-v2.2.html'
s = io.open(P, encoding='utf-8').read()
n0 = len(s)
miss = []

def rep(a, b, tag=''):
    global s
    if a not in s:
        miss.append(tag or a[:50]); return
    s = s.replace(a, b, 1)

rep('<title>系统设计说明书 · TG-SDD-001 v2.1（评审稿）</title>',
    '<title>系统设计说明书 · TG-SDD-001 v2.2（定稿）</title>', 'title')
rep('<div>版本</div><div>v2.1 评审稿（<span class="badge">含运营意见落地</span>）</div>',
    '<div>版本</div><div>v2.2 定稿（<span class="badge">架构闭环完成</span>）</div>', '版本')
rep('— 文档结束 · TG-SDD-001 v2.1 评审稿 · 与 FRD v2.1 一并确认后再进入实现 —',
    '— 文档结束 · TG-SDD-001 v2.2 定稿 · 与 FRD v2.2 一并作为开发与验收依据 —', '结尾')

rep('<h3>5.2 核心表（33 张）</h3>', '<h3>5.2 核心表（35 张）</h3>', '表数量')

# ---------- Order 加 orderType ----------
rep('<tr><td>Order</td><td>id、number（唯一）、email、status、',
    '<tr><td>Order</td><td class="hl">id、number（唯一）、email、status、<b>orderType（sale / exchange / reship / gift）</b>、', 'Order字段')

# ---------- AfterSale 加字段 ----------
rep('id、orderId、type（return / exchange / partial）、reason、itemsJson、amount、status、operator、createdAt</td>',
    'id、orderId、type（return / exchange / partial）、reason、itemsJson、amount、status、operator、<b>restockDecision（restock / scrap / return_to_supplier）</b>、<b>restockedQty</b>、createdAt</td>', 'AfterSale字段')

# ---------- CouponRedemption revoked ----------
rep('id、couponId、orderId、email、amount、createdAt</td><td class="hl">couponId + email（校验 perUserLimit）；orderId 唯一</td>',
    'id、couponId、orderId、email、amount、<b>revokedAt（退款回退时写入）</b>、createdAt</td><td class="hl">couponId + email（校验 perUserLimit，<b>须排除 revokedAt 非空</b>）；orderId 唯一</td>', 'CouponRevoked')

# ---------- Review laterReturned ----------
rep('status（pending / published / rejected）、pinned、featured、createdAt、publishedAt</td>',
    'status（pending / published / rejected）、pinned、featured、<b>incentiveGranted</b>、<b>laterReturned</b>、monthsOwned、createdAt、publishedAt</td>', 'Review字段')

# ---------- 新增 2 张表：StockLedger / CheckoutSession ----------
rep('''<h4>生命周期与归因（4 张 · v2.1 新增）</h4>''',
'''<h4>账务与一致性（2 张 · v2.2 新增）</h4>
<table>
  <tr><th>表</th><th>关键字段</th><th>索引 / 约束</th></tr>
  <tr><td class="hl">StockLedger</td><td class="hl">id、variantId、delta（正负）、beforeQty、afterQty、reason（reserve / commit / release / restock / refund_return / scrap / adjust）、refType、refId、operator、createdAt</td><td class="hl">variantId + createdAt；<b>只追加，禁止 UPDATE / DELETE</b>；冲正靠反向流水；afterQty 必须等于上一条的 afterQty + 本条 delta</td></tr>
  <tr><td class="hl">CheckoutSession</td><td class="hl">id、cartJson、priceSnapshot（JSON：variantId → price）、subtotal、lockedUntil（30 分钟）、email、createdAt</td><td class="hl">id 由前端带回；lockedUntil 过期后支付必须先重新校验价格</td></tr>
</table>

<h4>生命周期与归因（4 张 · v2.1 新增）</h4>''', '新增表2')

# ---------- 7.4 退款流程补 ----------
rep('''  <li>退款：后台登记售后单 → 二次确认 → 调 Stripe 退款 → 订单转 refunded → 发退款邮件 → 库存是否回补由人工决定（默认不回补，避免二次销售瑕疵品）。</li>''',
'''  <li>退款：后台登记售后单 → 二次确认 → 调 Stripe 退款 → 订单转 refunded → 发退款邮件 → <b>显式选择入库决策</b>（restock / scrap / return_to_supplier，见 FR-A-065，不允许留空）→ 选 restock 才回补 onHand 并写 StockLedger。</li>
  <li class="hl">退款的连带回退（v2.2 补，原先完全缺失）：<b>全额退款</b>时在同一事务里 ① 优惠券使用次数回退 + CouponRedemption 置 revoked；② 活动 spent 回退；③ 赠品 usedCount 回退；④ 退款金额计入 netRevenue。<b>部分退款不回退优惠</b>（优惠已实际享用），只计入净营收。见 BR-23。</li>
  <li class="hl">退款后的评价：Review.laterReturned = true，前台标注 "Verified purchase · Later returned"，<b>不删除、仍计入评分</b>（BR-24）。</li>''', '7.4退款')

# 换新补 orderType
rep('''  <li class="hl">换新（终身颜色保证）：登记 exchange 售后单 → 不退款 → 生成一张 $0 换新发货单 → 扣减一件库存 → 成本从颜色保证准备金归集。旧件不要求退回。</li>''',
'''  <li class="hl">换新（终身颜色保证）：登记 exchange 售后单 → 不退款 → 生成一条 <b>orderType = exchange</b> 的 $0 换新单 → 扣减一件库存（写 StockLedger，reason = restock 的负向 commit）→ 成本从颜色保证准备金归集。旧件不要求退回。<b>该单不计入订单数与 AOV</b>（FR-A-062）。</li>''', '7.4换新')

# ---------- 7.5 注销补 ----------
rep('''  3. <b>订单不删</b>：Order.email 保留（财务与税务凭证需留存 7 年），仅解除账户关联
  4. Address / WishlistItem 物理删除''',
'''  3. <b>订单不删</b>：Order.email 保留（财务与税务凭证需留存 7 年），仅解除账户关联
  3b. <b>停止全部营销自动化</b>（v2.2 补）：
        MarketingConsent.marketingOptIn = false, birthdayOptIn = false
        AbandonedCart where email = ? → stage = 8（已放弃）
        EmailLog where status = 'queued' and category = 'marketing' → status = 'skipped'
        交易类邮件（在途订单）仍可发
  4. Address / WishlistItem 物理删除''', '7.5注销')

# ---------- 7.6 二次校验 ----------
rep('''  每次发送前统一校验（缺一不发）：
    ① MarketingConsent.marketingOptIn == true
    ② 24 小时内该 email 无 marketing 类 EmailLog
    ③ 该轮次未发过（EmailLog 唯一约束兜底）
    ④ 该 email 无已完成订单''',
'''  每次发送前统一校验（缺一不发，<b>全部在发信那一刻执行，不在扫描开始时</b>）：
    ① MarketingConsent.marketingOptIn == true
    ② 24 小时内该 email 无 marketing 类 EmailLog
    ③ 该轮次未发过（EmailLog 唯一约束兜底）
    ④ 该 email 无已完成订单
    ⑤ <b>最近 2 小时无已支付订单</b>（v2.2 补：否则用户刚付完款就收到"购物车还在等"）
    ⑥ 该 email 对应的 User 未处于 deleted_marked 状态''', '7.6校验')

# ---------- 新增 7.9 价格锁定与对账 ----------
rep('''<h2 id="s8"><span class="n">8</span>部署与运维</h2>''',
'''<h3>7.9 价格锁定与支付对账（v2.2 新增）</h3>
<h4>结算价格锁定（BR-25）</h4>
<pre><code>进入结算页：POST /api/checkout/session
  → 返回 { sessionId, priceSnapshot, lockedUntil: now + 30min }
  → 前端随每次请求带回 sessionId

发起支付：POST /api/checkout/pay { sessionId, ... }
  1. 读 CheckoutSession，取 priceSnapshot
  2. 与当前商品价逐项比对
     • 完全一致 → 正常创建支付意图
     • 有差异   → <b>返回 409 + diff 明细</b>，前端展示"价格已更新，请确认后继续"
                  <b>禁止静默按新价扣款</b>
     • 商品下架 / 售罄 → 返回 422，移出结算并说明
  3. 支付意图金额必须等于用户最终确认的金额</code></pre>
<div class="note"><b>为什么不能静默改价</b>：用户看到 $58 却扣了 $62，在美国属于"未经授权的收费"，可以发起 chargeback。一笔 chargeback 的处理成本在 $15–$25，且会拉低支付通道的风险评级。<b>提示一次只损失一次转化，静默改价损失的是通道评级。</b></div>

<h4>支付对账（FR-A-069）</h4>
<pre><code>每日 02:00，拉取前一日支付平台流水（Stripe Balance Transactions）
逐笔比对三组数据：
  平台流水 ←→ PaymentRecord ←→ Order

输出三类差异：
  ① 本地有、平台无  → 可能支付未真正成功（需查 intent 状态）
  ② 平台有、本地无  → 可能回调丢失（需按 intentId 补单）
  ③ 金额不一致      → 退款 / 部分退款 / 币种问题

每条差异必须人工标记结果：confirmed（确认无误）/ fixed（已补单）/ ignored（说明原因）
连续 7 天差异为 0 视为通过；任一天有未处理差异，后台概览顶部常驻提醒</code></pre>

<h3>7.10 库存流水（BR-26）</h3>
<pre><code>所有库存变动只允许一个入口：
  StockService.apply(variantId, delta, reason, refType, refId, operator)

  reason 取值（穷举，不接受自由文本）：
    reserve        下单占用（写 StockReservation）
    commit         支付成功，占用转实扣
    release        超时 / 取消，释放占用
    restock        退货重新入库（需 AfterSale.restockDecision = restock）
    refund_return  退款回补
    scrap          报废（瑕疵品）
    adjust         盘点调整（必须填说明）

  禁止：UPDATE Variant SET onHand = ...（任何绕过 StockService 的写法在 code review 阶段拒绝）</code></pre>

<h2 id="s8"><span class="n">8</span>部署与运维</h2>''', '7.9-7.10')

# ---------- 9 补对账 ----------
rep('''  <tr><td class="hl">营销邮件同意（v2.1）</td>''',
'''  <tr><td class="hl">资金对账（v2.2）</td><td class="hl">每日自动比对支付平台流水与本地订单，三类差异（本地有平台无 / 平台有本地无 / 金额不一致）必须逐条人工标记；未处理差异在后台常驻提醒。<b>不做"总金额相等即视为平"的粗略对账</b>——金额相等但笔数不同的情况真实存在（一笔合并支付、一笔拆单）</td></tr>
  <tr><td class="hl">价格与授权一致性（v2.2）</td><td class="hl">支付金额必须等于用户最终确认的金额（BR-25）；价格变动只能通过"提示确认"处理，禁止静默改价；批量改价需预检冲突并留撤销窗口（FR-A-066）</td></tr>
  <tr><td class="hl">库存审计（v2.2）</td><td class="hl">库存只允许通过流水变动（BR-26），流水不可修改删除；任一 SKU 当前库存必须等于流水累计，可作为盘点依据</td></tr>
  <tr><td class="hl">营销邮件同意（v2.1）</td>''', '9对账')

io.open(P, 'w', encoding='utf-8').write(s)
print('size', n0, '->', len(s))
print('MISS:', miss if miss else 'none')
