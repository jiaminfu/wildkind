# -*- coding: utf-8 -*-
"""FRD v2.0 -> v2.1：落地运营意见评审的采纳项（5.10 自动化、6.4 运营效率、BR-21/22）"""
import io

P = 'review/FRD-功能需求说明书-v2.1.html'
s = io.open(P, encoding='utf-8').read()
n0 = len(s)
miss = []

def rep(a, b, tag=''):
    global s
    if a not in s:
        miss.append(tag or a[:50]); return
    s = s.replace(a, b, 1)

# 版本
rep('<title>功能需求说明书 · TG-FRD-001 v2.0（同步稿）</title>',
    '<title>功能需求说明书 · TG-FRD-001 v2.1（评审稿）</title>', 'title')
rep('<div>版本</div><div>v2.0 同步稿（<span class="badge">待一审</span>）</div>',
    '<div>版本</div><div>v2.1 评审稿（<span class="badge">含运营意见落地</span>）</div>', '版本')
rep('v2.0 同步稿（','v2.1 评审稿（')

# TOC
rep('  <a href="#s5-9" class="sub">5.9 账户中心（v2.0 新增）</a>\n',
    '  <a href="#s5-9" class="sub">5.9 账户中心（v2.0 新增）</a>\n  <a href="#s5-10" class="sub">5.10 生命周期与自动化（v2.1 新增）</a>\n', 'toc5.10')
rep('  <a href="#s6-3" class="sub">6.3 评价与定制（新增）</a>\n',
    '  <a href="#s6-3" class="sub">6.3 评价与定制（新增）</a>\n  <a href="#s6-4" class="sub">6.4 运营效率（v2.1 新增）</a>\n', 'toc6.4')

# ---------- 5.10 ----------
rep('<h2 id="s6"><span class="n">6</span>后台功能需求</h2>',
'''<h3 id="s5-10">5.10 生命周期与自动化 S-21 ~ S-24（v2.1 新增）</h3>
<p class="small">这一节来自运营意见评审（<code>review/运营意见评审记录-v1.0.html</code>）。运营提的是"我需要能追回弃购、能收到评价、能看到什么时候到"，产品在这里补的是<b>这些动作的边界</b>——什么时候发、发几封、怎么退订、激励怎么披露。没有边界，自动化会变成骚扰与合规风险。</p>
<table>
  <tr><th>编号</th><th>需求描述</th><th>优先级</th><th>验收标准</th></tr>
  <tr><td class="id">FR-S-160</td><td class="p1">弃购挽回触发：用户留下邮箱、创建了购物车、未完成支付，且购物车未清空。<b>4 小时</b>后发第一封（仅提醒，不含折扣），<b>24 小时</b>后发第二封（含激励，见 FR-S-161），<b>72 小时</b>后发第三封（最后提醒 + 首单券）。三封均未打开则停止 <span class="tag">增强</span></td><td class="p1">🔴</td><td>已下单或已清空购物车的用户不触发；同一用户 30 天内最多 2 轮</td></tr>
  <tr><td class="id">FR-S-161</td><td class="p1">三段激励策略<b>可配置</b>：第二封对新客为免运、对老客为赠品（海玻璃收纳袋）；第三封为 10% 首单券。<b>免运档默认关闭</b>，需在后台手动开启 <span class="tag">增强</span></td><td class="p1">🔴</td><td>新客 / 老客判定按"该邮箱是否有已完成订单"；配置改动 1 分钟内生效</td></tr>
  <tr><td class="id">FR-S-162</td><td class="p1">邮件合规：每封营销邮件底部含<b>退订链接</b>，退订即时生效（不退订也必须在 10 个工作日内生效，我们取即时）；同一用户 <b>24 小时内最多收 1 封营销邮件</b>；交易类邮件（订单 / 发货 / 退款）不受此限 <span class="tag">增强</span></td><td class="p1">🔴</td><td>退订后不再收到任何营销邮件；频次上限由发送日志强制，不靠模板控制</td></tr>
  <tr><td class="id">FR-S-163</td><td>弃购邮件内的一键回链：点击后恢复到<b>原购物车内容</b>（含变体、数量、已用券），商品若已下架或售罄则明确标出并给替代推荐 <span class="tag">增强</span></td><td class="p2">🟡</td><td>链接带签名且 14 天内有效；恢复后购物车与原状态一致</td></tr>
  <tr><td class="id">FR-S-164</td><td class="p1">邀评触发：订单签收后 <b>第 10 天</b>自动发邀评邮件（不是 7 天——要给足佩戴时间，"戴了多久"才有内容可填）；同一订单只发一次；未评价不重复催 <span class="tag">增强</span></td><td class="p1">🔴</td><td>邮件里的链接免登录可直接进入提交页</td></tr>
  <tr><td class="id">FR-S-165</td><td>评价提交页（强化 FR-S-098）：凭带签名的订单链接进入，<b>不需要登录</b>；必填"佩戴多久"（天 / 周 / 月）；支持 1–5 星、正文、≤3 张图 <span class="tag">增强</span></td><td class="p1">🔴</td><td>一单一商品一次；提交后进待审，前台显示"审核中"</td></tr>
  <tr><td class="id">FR-S-166</td><td class="p1">评价激励与披露：带图评价赠下次可用券，<b>不论星级</b>（1 星带图同样给）；展示时在评价条目标注"Received a thank-you credit"（见 BR-21） <span class="tag">增强</span></td><td class="p1">🔴</td><td>激励发放与星级无关，代码层面禁止按星级判断</td></tr>
  <tr><td class="id">FR-S-167</td><td class="p1">预计送达日期：商品页价格下方与结算页配送方式旁，显示<b>具体到达日期区间</b>（跳过周末与后台设置的节假日）；当计算结果 &gt; 14 天时改为"通常在 X 个工作日内发出" <span class="tag">增强</span></td><td class="p1">🔴</td><td>日期随当天日期动态变化；节假日配置改动后立即反映</td></tr>
  <tr><td class="id">FR-S-168</td><td>凑单推荐：免邮 / 赠品进度条下方给 2–3 件推荐，规则为 <b>①价格差额 +10%~+60% → ②同题材或同集合优先 → ③毛利率排序</b>；<b>硬性排除</b>已加购、缺货、无可用变体的商品 <span class="tag">增强</span></td><td class="p2">🟡</td><td>推荐位不出现购物车里已有的商品；差额为负时不出现</td></tr>
  <tr><td class="id">FR-S-169</td><td>生日字段：账户设置中<b>可选填</b>生日（不填不影响使用）；填写时单独勾选"愿意接收生日提醒"，未勾选则不用于营销 <span class="tag">增强</span></td><td class="p3">🟢</td><td>不勾选也能正常保存生日；生日不用于任何自动化时不得出现在邮件中</td></tr>
  <tr><td class="id">FR-S-170</td><td>售后自助：账户订单详情页提供"申请退换 / 申请颜色保证换新"，表单收集类型、原因、照片，提交后进后台售后队列（FR-A-060），可查进度 <span class="tag">增强</span></td><td class="p2">🟡</td><td>只做提交与查询，不做自动审批；超出 BR-11 期限的申请给出说明而不是直接拒绝</td></tr>
</table>
<div class="warn" style="border-left:2px solid var(--r);background:#fdf6f5;padding:14px 18px;margin:18px 0;font-size:14px"><b>三条不能妥协的边界</b>：① 营销邮件必须先有同意（BR-22），"下单填了邮箱"不等于同意收营销信；② 评价激励不得以正面评价为条件，且必须披露（BR-21）；③ 弃购邮件里的免运默认关闭，先只给赠品——等有 A/B 数据再决定是否放开，否则会训练出"等 24 小时再买"的习惯。</div>

<h2 id="s6"><span class="n">6</span>后台功能需求</h2>''', '5.10')

# ---------- 6.4 ----------
rep('<h2 id="s7"><span class="n">7</span>业务规则</h2>',
'''<h3 id="s6-4">6.4 运营效率 A-14 ~ A-20（v2.1 新增）</h3>
<p class="small">运营视角的六条效率需求。判断标准不是"能不能做"，而是"每周要用一次以上"。一次性配置的事手工做掉就行，不做功能。</p>
<table>
  <tr><th>编号</th><th>需求描述</th><th>优先级</th><th>验收标准</th></tr>
  <tr><td class="id">FR-A-050</td><td class="p1">渠道归因采集：落地页解析 UTM（source / medium / campaign / content），写入首方 cookie；订单创建时固化<b>末次来源</b>与<b>注册来源</b>。<b>必须等 Cookie 同意后才启用</b>（依赖 FR-S-095） <span class="tag">增强</span></td><td class="p1">🔴</td><td>拒绝分析的访问不产生渠道数据；直接访问记为 direct</td></tr>
  <tr><td class="id">FR-A-051</td><td>渠道花费录入：按渠道 + 月份手填花费（广告 / 红人 / 联盟），用于算 CAC 与 ROI <span class="tag">增强</span></td><td class="p2">🟡</td><td>不填时 ROI 显示"—"，不显示 0</td></tr>
  <tr><td class="id">FR-A-052</td><td>渠道报表：每个渠道的订单数、GMV、AOV、退款率、CAC、ROI（可切 7 / 30 / 90 天）；支持导出 <span class="tag">增强</span></td><td class="p2">🟡</td><td>GMV 与订单 GMV 总量一致，差额落在 direct / 未归因</td></tr>
  <tr><td class="id">FR-A-053</td><td class="p1">活动预检与告警：活动<b>生效前 1 小时</b>自动预检（关联商品是否上架、库存是否充足、赠品 SKU 是否有货、门槛是否高于最低在售价），异常发内部邮件；生效 / 结束 / 预算熔断各发一次通知 <span class="tag">增强</span></td><td class="p1">🔴</td><td>预检失败不自动阻止活动，但必须告警并留记录</td></tr>
  <tr><td class="id">FR-A-054</td><td class="p1">商品批量编辑：多选后批量改价（按百分比或固定额）、改状态、加减集合、调库存。<b>仅 owner 可用</b>，需二次确认（显示影响款数与价格区间）→ 写操作日志（逐款记录改前改后）→ 提供 <b>5 分钟内一键撤销</b> <span class="tag">增强</span></td><td class="p1">🔴</td><td>批量改价后 5 分钟内可完整回滚；撤销本身也写日志</td></tr>
  <tr><td class="id">FR-A-055</td><td>CSV 导入导出：导出商品模板 → 填写 → 上传后先<b>校验预览</b>（列出错误行与原因，不写库）→ 确认导入 <span class="tag">增强</span></td><td class="p2">🟡</td><td>不允许"上传即生效"；校验失败最多列出前 50 条错误</td></tr>
  <tr><td class="id">FR-A-056</td><td>库存预警与可售天数：每日发库存邮件，列出低于阈值或"可售天数 &lt; 补货周期"的商品；可售天数 = (onHand − reserved) ÷ 近 30 天日均销量，新品不足 30 天用类目均值兜底 <span class="tag">增强</span></td><td class="p1">🔴</td><td>按可售天数升序排列；阈值为 0 的商品单独标红</td></tr>
  <tr><td class="id">FR-A-057</td><td>客户筛选与导出：按 tier、最后下单距今天数、累计消费区间筛选，导出 CSV（邮箱 / 姓名 / 订单数 / 消费额 / 最后下单日） <span class="tag">增强</span></td><td class="p2">🟡</td><td>导出需 <code>customer.export</code> 权限位；导出行为写日志</td></tr>
  <tr><td class="id">FR-A-058</td><td>处理时长与节假日设置：设置默认处理时长（1–2 个工作日）与不发货日（节假日），供 FR-S-167 计算送达日期 <span class="tag">增强</span></td><td class="p1">🔴</td><td>修改后商品页与结算页的日期立即变化</td></tr>
  <tr><td class="id">FR-A-059</td><td>UGC 精选标记：评价列表可将带图评价标为"精选"，用于前台 UGC 聚合区块与社媒素材库 <span class="tag">增强</span></td><td class="p3">🟢</td><td>仅在用户已授权图片使用（BR-21）的评价上出现该操作</td></tr>
  <tr><td class="id">FR-A-060</td><td>售后队列：列表显示订单号、类型（退换 / 颜色保证）、原因、凭证图、提交时间、状态；可标记处理中 / 已同意 / 已拒绝并填说明 <span class="tag">增强</span></td><td class="p2">🟡</td><td>拒绝必须填原因；处理后自动发通知邮件</td></tr>
  <tr><td class="id">FR-A-061</td><td class="p1">邮件发送日志与限流：记录每封邮件的收件人、模板、类型（交易 / 营销）、发送时间、打开状态；<b>发送前统一校验</b>频次上限与退订状态，命中则不发送并记原因 <span class="tag">增强</span></td><td class="p1">🔴</td><td>限流在服务层强制，任何模板都无法绕过</td></tr>
</table>

<h2 id="s7"><span class="n">7</span>业务规则</h2>''', '6.4')

# ---------- BR-21 / BR-22 ----------
rep('''  <tr><td class="id">BR-20</td>''',
'''  <tr><td class="id">BR-21</td><td class="p1">评价激励与内容授权</td><td>① 带图评价可赠下次可用券，<b>与星级无关</b>（1 星带图同样给），代码层面禁止按星级判断是否发放；② 前台展示该评价时必须标注"Received a thank-you credit"（FTC 要求披露实质性关联）；③ 评价提交页需取得<b>图片营销使用授权</b>，未授权的图片只在前台评价区展示，不得用于首页 / 社媒 / 广告；④ <b>不得引导用户修改或删除低分评价</b>，与 BR-19 一致</td></tr>
  <tr><td class="id">BR-22</td><td class="p1">邮件分类与频次</td><td>① <b>交易类</b>（订单确认 / 发货 / 退款 / 密码重置）无需营销同意，随时可发；② <b>营销类</b>（弃购提醒 / 邀评 / 活动 / 生日 / 补货）必须取得 opt-in，且每封含退订链接；③ 同一用户 <b>24 小时内最多 1 封营销邮件</b>，由 FR-A-061 在服务层强制；④ 退订即时生效，退订后仅保留交易类；⑤ 生日字段仅在用户单独勾选同意后用于营销</td></tr>
  <tr><td class="id">BR-20</td>''', 'BR-21/22')

# ---------- 第11节 Q7 Q8 ----------
rep('''  <tr><td>Q6</td>''',
'''  <tr><td>Q7</td><td><b>弃购第二封要不要开放免运？</b>当前默认关闭、只给赠品。开放的好处是短期挽回率更高，代价是训练出"等 24 小时再买"的习惯，半年后才显形</td><td>先只给赠品，积累 2–3 个月 A/B 数据（首单转化率 + 90 天复购率）再决定</td><td>弃购挽回率、新客首单周期</td></tr>
  <tr><td>Q8</td><td><b>渠道花费手填还是对接广告平台？</b>手填每周约 10 分钟；对接需要开发与长期维护</td><td>首版手填。等月投放额超过 $20k 再考虑对接</td><td>CAC / ROI 报表的准确性</td></tr>
  <tr><td>Q6</td>''', 'Q7Q8')

# ---------- 12.7 ----------
rep('''<h3>12.6 v2.0 变更（与原型同步）</h3>''',
'''<h3>12.7 v2.1 变更（运营意见落地）</h3>
<p class="small">依据 <code>review/运营建议意见稿-v1.0.html</code>（13 条）与 <code>review/运营意见评审记录-v1.0.html</code>（逐条判定）。运营 13 条中采纳 7、部分采纳 5、无否决；产品侧另补 6 条合规与工程约束。</p>
<table>
  <tr><th>类别</th><th>变更</th><th>条目</th></tr>
  <tr><td><b>新增章节</b></td><td>5.10 生命周期与自动化（11 条）、6.4 运营效率（12 条）</td><td>FR-S-160~170、FR-A-050~061</td></tr>
  <tr><td><b>合规硬约束</b></td><td>新增评价激励披露（FTC）与邮件分类频次（CAN-SPAM / GDPR）两条业务规则</td><td>BR-21、BR-22</td></tr>
  <tr><td><b>修正运营建议</b></td><td>弃购首封 1h→4h；邀评 7 天→10 天；凑单推荐不按毛利率优先；批量改价限 owner + 5 分钟撤销；渠道归因仅末次点击</td><td>FR-S-160、164、168、FR-A-050、054</td></tr>
  <tr><td><b>提级</b></td><td>Cookie 同意条（FR-S-095）由"待补"升级为归因前置依赖</td><td>FR-S-095、FR-A-050</td></tr>
  <tr><td><b>降级</b></td><td>客户群发只做筛选导出；生日自动化放二期，字段先埋（可选）</td><td>FR-A-057、FR-S-169</td></tr>
  <tr><td><b>待确认</b></td><td>Q7 弃购免运是否放开、Q8 渠道花费录入方式</td><td>第 11 节</td></tr>
</table>

<h3>12.6 v2.0 变更（与原型同步）</h3>''', '12.7')

io.open(P, 'w', encoding='utf-8').write(s)
print('size', n0, '->', len(s))
print('MISS:', miss if miss else 'none')
