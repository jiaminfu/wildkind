# -*- coding: utf-8 -*-
"""FRD v2.1 -> v2.2 终稿：架构闭环评估的 16 条补充 + 4 条业务规则"""
import io

P = 'review/FRD-功能需求说明书-v2.2.html'
s = io.open(P, encoding='utf-8').read()
n0 = len(s)
miss = []

def rep(a, b, tag=''):
    global s
    if a not in s:
        miss.append(tag or a[:50]); return
    s = s.replace(a, b, 1)

# 版本
rep('<title>功能需求说明书 · TG-FRD-001 v2.1（评审稿）</title>',
    '<title>功能需求说明书 · TG-FRD-001 v2.2（定稿）</title>', 'title')
rep('<div>版本</div><div>v2.1 评审稿（<span class="badge">含运营意见落地</span>）</div>',
    '<div>版本</div><div>v2.2 定稿（<span class="badge">架构闭环完成</span>）</div>', '版本')

# ---------- 5.10 追加 6 条 ----------
rep('''<div class="warn" style="border-left:2px solid var(--r);background:#fdf6f5;padding:14px 18px;margin:18px 0;font-size:14px"><b>三条不能妥协的边界</b>''',
'''<table>
  <tr><th>编号</th><th>需求描述</th><th>优先级</th><th>验收标准</th></tr>
  <tr><td class="id">FR-S-171</td><td class="p1">退货后的评价处理：订单退款后评价<b>保留并计入评分</b>，但前台标注"Verified purchase · Later returned"（BR-24） <span class="tag">增强</span></td><td class="p1">🔴</td><td>标注随退款完成自动出现，不需人工干预</td></tr>
  <tr><td class="id">FR-S-172</td><td class="p1">弃购发信前二次校验：发送那一刻再查一次该 email 最近 2 小时是否有已支付订单，有则<b>跳过发送</b>并置为已转化 <span class="tag">增强</span></td><td class="p1">🔴</td><td>刚付款的用户不会收到"购物车还在等"的邮件</td></tr>
  <tr><td class="id">FR-S-173</td><td class="p1">注销账户时停止全部营销自动化：营销同意置否、生日同意置否、未发送的营销邮件标记跳过、弃购置为放弃；<b>交易类邮件仍可发</b>（若有在途订单） <span class="tag">增强</span></td><td class="p1">🔴</td><td>注销后不再收到任何营销邮件</td></tr>
  <tr><td class="id">FR-S-174</td><td class="p1">结算价格锁定：进入结算页时生成价格快照并<b>锁定 30 分钟</b>；支付时若商品价格已变，<b>不静默改价</b>，提示"价格已更新，请确认后继续"并展示变动明细（BR-25） <span class="tag">增强</span></td><td class="p1">🔴</td><td>支付金额与页面显示金额永远一致</td></tr>
  <tr><td class="id">FR-S-175</td><td>订单详情状态标签扩展：除主状态外，显示售后状态（退货中 / 已退货 / 换新中 / 已换新） <span class="tag">增强</span></td><td class="p2">🟡</td><td>售后状态与订单主状态互不覆盖，同时可见</td></tr>
  <tr><td class="id">FR-S-176</td><td>评价条款告知：评价提交页需写明"退货后评价仍会保留并标注""图片可用于营销（可拒绝）" <span class="tag">增强</span></td><td class="p2">🟡</td><td>条款在提交前可见，不需展开弹窗</td></tr>
</table>

<div class="warn" style="border-left:2px solid var(--r);background:#fdf6f5;padding:14px 18px;margin:18px 0;font-size:14px"><b>三条不能妥协的边界</b>''', '5.10追加')

# ---------- 6.4 追加 10 条 ----------
rep('''<h2 id="s7"><span class="n">7</span>业务规则</h2>''',
'''<h3 id="s6-5">6.5 账务与对账 A-21 ~ A-25（v2.2 架构闭环新增）</h3>
<p class="small">这一节的 10 条全部来自架构闭环评估（<code>review/架构闭环评估-v1.0.html</code>）。它们不是"新功能"，而是<b>让已有功能在异常路径上仍然算得清账</b>。判断标准：不做的话，第一个月就会出现报表与银行流水对不上。</p>
<table>
  <tr><th>编号</th><th>需求描述</th><th>优先级</th><th>验收标准</th></tr>
  <tr><td class="id">FR-A-062</td><td class="p1">订单类型：Order 增加 <code>orderType</code>（sale / exchange / reship / gift）。<b>全部销售报表默认只统计 sale</b>；换新与补发单在后台独立页签，不计入订单数与 AOV <span class="tag">增强</span></td><td class="p1">🔴</td><td>换新 20 单后，AOV 与订单数不受影响</td></tr>
  <tr><td class="id">FR-A-063</td><td class="p1">退款回退：退款完成时按规则回退——优惠券使用次数、CouponRedemption 标记 revoked（不物理删）、活动 <code>spent</code>、赠品 <code>usedCount</code>。perUserLimit 判定必须排除已 revoked 记录（BR-23） <span class="tag">增强</span></td><td class="p1">🔴</td><td>同一用户退款后可再次使用同一张券</td></tr>
  <tr><td class="id">FR-A-064</td><td class="p1">净营收口径：报表同时展示 GMV 与 <b>netRevenue = total − 已退款金额</b>；<b>ROI / CAC 一律用净营收计算</b> <span class="tag">增强</span></td><td class="p1">🔴</td><td>部分退款的订单在净营收中按实收计</td></tr>
  <tr><td class="id">FR-A-065</td><td class="p1">售后入库决策：售后单必须显式选择 <code>restockDecision</code>（重新入库 / 报废 / 退回供应商）并填写数量；选重新入库才回补 onHand 并写库存流水 <span class="tag">增强</span></td><td class="p1">🔴</td><td>不允许留空；三个月后盘点账实相符</td></tr>
  <tr><td class="id">FR-A-066</td><td class="p1">批量改价冲突预检：批量改价前列出受影响的进行中活动与改后最低成交价，低于成本线时<b>阻止</b>并说明；提供"改价同时暂停相关活动"一步操作 <span class="tag">增强</span></td><td class="p1">🔴</td><td>活动期间无法把成交价改到成本线以下</td></tr>
  <tr><td class="id">FR-A-067</td><td>退款后评价复核：退款完成后在评价列表标记"订单已退款"，供运营决定是否补充说明（<b>默认不删除</b>，删除仍受 BR-19 约束） <span class="tag">增强</span></td><td class="p2">🟡</td><td>标记可见，操作留痕</td></tr>
  <tr><td class="id">FR-A-068</td><td class="p1">库存流水：每次库存变动（下单占用、支付实扣、超时释放、入库、退款回补、报废、盘点调整）写一条不可修改的流水，含变动前后值、原因、关联单据、操作人 <span class="tag">增强</span></td><td class="p1">🔴</td><td>任一 SKU 的当前库存 = 流水累计，可逐笔追溯</td></tr>
  <tr><td class="id">FR-A-069</td><td class="p1">支付对账：每日拉取支付平台流水，与本地订单逐笔比对，输出三类差异（本地有平台无 / 平台有本地无 / 金额不一致），差异需人工标记处理结果 <span class="tag">增强</span></td><td class="p1">🔴</td><td>连续 7 天差异为 0 视为通过；有差异必须能在页面上逐条处理</td></tr>
  <tr><td class="id">FR-A-070</td><td>邮件发送明细可查：列表可看每封邮件的状态与<b>跳过原因</b>（未同意 / 频次超限 / 已转化 / 已退订），便于排障 <span class="tag">增强</span></td><td class="p2">🟡</td><td>跳过原因分类不超过 6 种，可筛选</td></tr>
  <tr><td class="id">FR-A-071</td><td>归因覆盖率提示：渠道报表固定显示"归因覆盖率 = 有渠道来源的订单 / 总订单"；覆盖率 &lt; 70% 时 CAC 与 ROI 标注"参考值"并说明按已归因部分计算（<b>不做比例摊派</b>） <span class="tag">增强</span></td><td class="p1">🔴</td><td>覆盖率数字始终可见，不被折叠</td></tr>
</table>

<h2 id="s7"><span class="n">7</span>业务规则</h2>''', '6.5')

# ---------- BR-23~26 ----------
rep('''  <tr><td class="id">BR-21</td>''',
'''  <tr><td class="id">BR-23</td><td class="p1">退款回退规则</td><td>全额退款时：优惠券使用次数回退、<code>CouponRedemption</code> 置 revoked（保留记录用于审计）、活动 <code>spent</code> 回退、赠品 <code>usedCount</code> 回退。<b>部分退款不回退</b>优惠（优惠已实际享用）。回退后 perUserLimit 的判定必须排除 revoked 记录，否则回退无效</td></tr>
  <tr><td class="id">BR-24</td><td class="p1">退货后评价规则</td><td>订单退款后评价<b>不删除、仍计入评分</b>（用户确实购买并佩戴过），但前台必须标注"Verified purchase · Later returned"。评价提交页需提前告知此规则，避免用户认为品牌擅自改评价。管理员若要删除仍受 BR-19 约束</td></tr>
  <tr><td class="id">BR-25</td><td class="p1">结算价格锁定</td><td>进入结算页生成价格快照，锁定 30 分钟。支付前校验：① 价格未变 → 正常支付；② 价格已变 → <b>不静默改价</b>，提示变动明细由用户确认；③ 商品下架/售罄 → 明确告知并移出结算。<b>任何情况下支付金额必须与用户确认的金额一致</b></td></tr>
  <tr><td class="id">BR-26</td><td class="p1">库存流水完整性</td><td>库存<b>只允许通过流水变动</b>，禁止直接 UPDATE onHand。每条流水记录变动前后值、原因、关联单据、操作人、时间，且不可修改、不可删除（冲正靠反向流水）。盘点差异必须走"盘点调整"流水，不允许静默抹平</td></tr>
  <tr><td class="id">BR-21</td>''', 'BR-23-26')

# ---------- TOC ----------
rep('  <a href="#s6-4" class="sub">6.4 运营效率（v2.1 新增）</a>\n',
    '  <a href="#s6-4" class="sub">6.4 运营效率（v2.1 新增）</a>\n  <a href="#s6-5" class="sub">6.5 账务与对账（v2.2 新增）</a>\n', 'toc6.5')

# ---------- 12.8 ----------
rep('''<h3>12.7 v2.1 变更（运营意见落地）</h3>''',
'''<h3>12.8 v2.2 变更（架构闭环定稿）</h3>
<p class="small">依据 <code>review/架构闭环评估-v1.0.html</code>。评估方法是把 12 条主链路画成状态图，逐对相邻状态检查"上一状态留下的副作用有没有人接手"，共发现 10 处断点，其中 4 处会造成真实账务或数据错误。</p>
<table>
  <tr><th>断点</th><th>问题</th><th>补充</th></tr>
  <tr><td>B1</td><td>换新 $0 单污染订单数与 AOV</td><td>FR-A-062 订单类型</td></tr>
  <tr><td>B2</td><td>退款后券不释放、预算不回退</td><td>FR-A-063、BR-23</td></tr>
  <tr><td>B3</td><td>部分退款后 GMV 虚高</td><td>FR-A-064 净营收口径</td></tr>
  <tr><td>B4</td><td>退货入库只有"人工决定"没有落点</td><td>FR-A-065</td></tr>
  <tr><td>B5</td><td>评价后退货如何处理</td><td>FR-S-171、BR-24</td></tr>
  <tr><td>B6</td><td>弃购邮件与刚下的单竞态</td><td>FR-S-172</td></tr>
  <tr><td>B7</td><td>注销后自动化仍发信</td><td>FR-S-173</td></tr>
  <tr><td>B8</td><td>归因分母口径不清</td><td>FR-A-071</td></tr>
  <tr><td>B9</td><td>批量改价与进行中活动打架</td><td>FR-A-066</td></tr>
  <tr><td>B10</td><td>结算过程中价格变动</td><td>FR-S-174、BR-25</td></tr>
  <tr><td>附</td><td>账实不符、支付差错、邮件排障</td><td>FR-A-068 库存流水、FR-A-069 支付对账、FR-A-070 邮件明细、BR-26</td></tr>
</table>
<p><b>四条现在定、以后改代价很大的决定</b>：① 订单类型分离（事后加要回填历史）；② 净营收口径（中途改会推翻此前投放判断）；③ 价格锁定（涉及支付金额）；④ 归因不摊派（摊派后所有 ROI 都建立在估算上）。</p>

<h3>12.7 v2.1 变更（运营意见落地）</h3>''', '12.8')

io.open(P, 'w', encoding='utf-8').write(s)
print('size', n0, '->', len(s))
print('MISS:', miss if miss else 'none')
