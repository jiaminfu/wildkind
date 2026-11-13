# -*- coding: utf-8 -*-
"""SDD v2.0 -> v2.1：落地运营评审采纳项（4 张表 / 3 个流程 / 合规补充）"""
import io

P = 'review/SDD-系统设计说明书-v2.1.html'
s = io.open(P, encoding='utf-8').read()
n0 = len(s)
miss = []

def rep(a, b, tag=''):
    global s
    if a not in s:
        miss.append(tag or a[:50]); return
    s = s.replace(a, b, 1)

# 版本
rep('<title>系统设计说明书 · TG-SDD-001 v2.0（同步稿）</title>',
    '<title>系统设计说明书 · TG-SDD-001 v2.1（评审稿）</title>', 'title')
rep('<div>版本</div><div>v2.0 同步稿（<span class="badge">待一审</span>）</div>',
    '<div>版本</div><div>v2.1 评审稿（<span class="badge">含运营意见落地</span>）</div>', '版本')
rep('— 文档结束 · TG-SDD-001 v2.0 同步稿 · 与 FRD v2.0 一并确认后再进入实现 —',
    '— 文档结束 · TG-SDD-001 v2.1 评审稿 · 与 FRD v2.1 一并确认后再进入实现 —', '结尾')

# 表数量 29 -> 33
rep('<h3>5.2 核心表（29 张）</h3>', '<h3>5.2 核心表（33 张）</h3>', '表数量')

# ---------- 新增 4 张表（放在账户与权限之后） ----------
rep('''<h4>评价与运营（7 张）</h4>''',
'''<h4>生命周期与归因（4 张 · v2.1 新增）</h4>
<table>
  <tr><th>表</th><th>关键字段</th><th>索引 / 约束</th></tr>
  <tr><td class="hl">AbandonedCart</td><td class="hl">id、email、cartJson（快照）、subtotal、itemCount、startedAt、lastSeenAt、stage（0 未发 / 1 已发提醒 / 2 已发激励 / 3 已发末次 / 9 已转化 / 8 已放弃）、recoveredOrderId、round（第几轮）</td><td class="hl">email + startedAt；stage + lastSeenAt 供定时任务扫描；<b>同一 email 30 天内 round ≤ 2</b></td></tr>
  <tr><td class="hl">MarketingConsent</td><td class="hl">id、email（唯一）、marketingOptIn、birthdayOptIn、source（checkout / account / footer）、ip、consentedAt、revokedAt</td><td class="hl">email 唯一；<b>退订后 marketingOptIn = false 且不得再写 true</b>（只能用户自己重新勾选）</td></tr>
  <tr><td class="hl">EmailLog</td><td class="hl">id、email、templateKey、category（transactional / marketing）、refType（order / cart / review / user）、refId、status（queued / sent / failed / skipped）、skipReason、openedAt、sentAt</td><td class="hl">email + sentAt（频次校验）；<b>(refType, refId, templateKey) 唯一</b>——邀评与弃购靠它做幂等，同一订单同一模板只发一次</td></tr>
  <tr><td class="hl">ChannelCost</td><td class="hl">id、channel、month（YYYY-MM）、spend、note、updatedAt</td><td class="hl">channel + month 唯一；手填，用于 CAC / ROI</td></tr>
</table>

<h4>评价与运营（7 张）</h4>''', '新增表')

# ---------- 7.6 / 7.7 / 7.8 ----------
rep('''<h2 id="s8"><span class="n">8</span>部署与运维</h2>''',
'''<h3>7.6 弃购挽回流程（v2.1 新增）</h3>
<pre><code>触发：POST /api/cart/touch（每次购物车变更，节流 60s 写一次）
  条件：有 email + 有商品 + 未下单
  写 AbandonedCart(lastSeenAt = now)

定时任务（每 30 分钟）：
  for cart in AbandonedCart where stage in (0,1,2) and 未转化:
      elapsed = now - lastSeenAt
      if stage == 0 and elapsed >= 4h  → stage 1，发「提醒」模板
      if stage == 1 and elapsed >= 24h → stage 2，发「激励」模板
      if stage == 2 and elapsed >= 72h → stage 3，发「末次」模板
  每次发送前统一校验（缺一不发）：
    ① MarketingConsent.marketingOptIn == true
    ② 24 小时内该 email 无 marketing 类 EmailLog
    ③ 该轮次未发过（EmailLog 唯一约束兜底）
    ④ 该 email 无已完成订单

激励策略（FR-S-161）：
  新客 = 无已完成订单 → 赠品（默认）或免运（开关，默认关）
  老客 = 有已完成订单 → 赠品（永不给免运折扣）
  末次 = 10% 券，作用域仅限本购物车所含集合</code></pre>
<div class="note"><b>为什么把免运做成开关而不是默认开</b>：免运直接减少收入，且会训练"等 24 小时"的行为。做成开关意味着它可以先关着上线，等 A/B 数据出来再决定——<b>把不可逆的决策变成可逆的配置</b>，这是这类增长功能正确的接入方式。</div>

<h3>7.7 邀评与激励流程（v2.1 新增）</h3>
<pre><code>定时任务（每日）：
  扫 Order where status = 'completed' and completedAt = today - 10d
  为每个 OrderItem 生成邀评邮件（一单一次，不按商品拆封）
  发送前校验：MarketingConsent + 频次 + EmailLog 幂等
  链接 = /reviews/write?token=HMAC(orderId, email, exp=30d)

提交（无需登录）：
  1. 验签 token → 取 orderId
  2. 校验该 orderItem 未评价过（Review 唯一约束）
  3. 写入 Review(status = 'pending', monthsOwned, incentiveGranted = false)
  4. <b>若含图 → 发券，不判断星级</b>（BR-21）
     发券后 Review.incentiveGranted = true
  5. 前台展示时若 incentiveGranted → 标注 "Received a thank-you credit"

代码层面的约束：
  禁止任何 if (rating >= 4) 才发激励的分支 —— 由 lint 规则与 code review 双重把守</code></pre>

<h3>7.8 渠道归因采集（v2.1 新增）</h3>
<pre><code>落地页（首次进入）：
  解析 utm_source / utm_medium / utm_campaign / utm_content
  若 Cookie 同意为「分析类已同意」→ 写 first_touch cookie（90 天）
  未同意 → 不写任何 cookie，仅本次会话内存可用，关闭即失

每次进入：
  有新的 utm → 覆盖 last_touch cookie（30 天）

下单（Order 创建）：
  channel.first = first_touch.source  ?? 'direct'
  channel.last  = last_touch.source   ?? 'direct'
  固化写入 Order（不随后续 cookie 变化）

报表（FR-A-052）：
  GMV(channel) = Σ Order.total where channel.last = channel
  CAC(channel) = ChannelCost.spend(month) / 新客数(channel.last, 首单)
  ROI = (GMV × 毛利率 − spend) / spend
  未归因部分单列 direct / unattributed，不做摊派</code></pre>
<div class="warn" style="border-left:2px solid var(--r);background:#fdf6f5;padding:14px 18px;margin:18px 0;font-size:14px"><b>依赖关系要写死在这里</b>：FR-S-095 的 Cookie 同意条不是"体验优化"，而是<b>归因功能的前置条件</b>。同意条没上线，7.8 的采集就是违规采集 GDPR 意义上的个人数据。因此实施顺序必须是：同意条 → 归因采集 → 归因报表，不能倒序。</div>

<h2 id="s8"><span class="n">8</span>部署与运维</h2>''', '7.6-7.8')

# 实体关系补
rep('''User (账户) ──&lt; Session (会话)''',
'''AbandonedCart (弃购 · 按 email)   EmailLog (发送日志)   MarketingConsent (订阅授权)   ChannelCost (渠道花费)

User (账户) ──&lt; Session (会话)''', '实体关系')

# ---------- 9 合规补充 ----------
rep('''  <tr><td class="hl">营销防刷</td>''',
'''  <tr><td class="hl">营销邮件同意（v2.1）</td><td class="hl">严格区分交易类与营销类：交易类（订单 / 发货 / 退款 / 密码重置）无需同意，营销类（弃购 / 邀评 / 活动 / 生日 / 补货）必须有 opt-in 且每封含退订；<b>退订即时生效</b>；服务层强制同一用户 24 小时内最多 1 封营销信（BR-22 / FR-A-061）；"下单时填了邮箱"不得视作营销同意</td></tr>
  <tr><td class="hl">评价激励合规（v2.1）</td><td class="hl">激励不得以正面评价为条件（带图即赠，不论星级）；展示处必须标注激励来源（FTC 要求）；<b>禁止引导修改或删除低分评价</b>；图片营销使用需单独授权，未授权图片不得用于首页 / 社媒 / 广告（BR-21）</td></tr>
  <tr><td class="hl">归因与 Cookie（v2.1）</td><td class="hl">分析类 Cookie 必须先取得同意才写入；未同意时只允许会话内存态，不落持久 cookie；归因报表只使用已同意用户的数据，<b>并在报表页注明覆盖率</b>（避免用违规数据算出的 ROI 误导投放决策）</td></tr>
  <tr><td class="hl">个人信息用途限制（v2.1）</td><td class="hl">生日字段可选填、仅用于用户单独同意的生日提醒；不用于画像或第三方共享；账户注销时营销同意与生日字段一并清除</td></tr>
  <tr><td class="hl">营销防刷</td>''', '安全合规')

# ---------- 追溯矩阵 ----------
rep('''  <tr><td>FR-S-090~098 内容与辅助</td>''',
'''  <tr><td class="hl">FR-S-160~170 生命周期（v2.1）</td><td class="hl">growth、mail、catalog、after-sale</td><td class="hl">AbandonedCart、EmailLog、MarketingConsent、Review</td><td class="hl"><code>/api/cart/touch</code>、<code>/api/reviews/write</code>、<code>/api/account/after-sale</code></td><td class="hl">邮件 / S-21~S-24</td></tr>
  <tr><td>FR-S-090~098 内容与辅助</td>''', '追溯1')

rep('''  <tr><td>BR-01~21 业务规则</td>''',
'''  <tr><td class="hl">FR-A-050~061 运营效率（v2.1）</td><td class="hl">analytics、catalog、inventory、mail</td><td class="hl">ChannelCost、EmailLog、Variant、Customer</td><td class="hl"><code>/api/admin/analytics/*</code>、<code>/api/admin/bulk/*</code></td><td class="hl">A-14~A-20</td></tr>
  <tr><td>BR-01~22 业务规则</td>''', '追溯2')

# 模块划分补两个模块
rep('''<h2 id="s5"><span class="n">5</span>数据模型</h2>''',
'''<p class="small"><b>v2.1 新增两个模块</b>：<code>growth</code>（弃购、邀评、归因编排，只做流程串联不做业务计算）与 <code>mail</code>（模板渲染 + 频次限流 + 发送日志；<b>限流在这里统一做，各业务模块不得自行发信</b>）。归因的采集埋点在 <code>analytics</code>，报表在后台读取。</p>

<h2 id="s5"><span class="n">5</span>数据模型</h2>''', '模块')

io.open(P, 'w', encoding='utf-8').write(s)
print('size', n0, '->', len(s))
print('MISS:', miss if miss else 'none')
