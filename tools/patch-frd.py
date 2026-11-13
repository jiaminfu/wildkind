# -*- coding: utf-8 -*-
"""FRD v1.1 -> v2.0 结构性同步：范围、角色、页面清单、5.9 账户中心、BR-20、后台权限、变更记录"""
import io, sys

P = 'review/FRD-功能需求说明书-v2.0.html'
s = io.open(P, encoding='utf-8').read()
n0 = len(s)
miss = []

def rep(a, b, tag=''):
    global s
    if a not in s:
        miss.append(tag or a[:50])
        return
    s = s.replace(a, b, 1)

# ---------- 1. 变更摘要：加 v2.0 段 ----------
rep('''  <div class="note" style="margin-top:26px"><b>v1.1 变更摘要</b>''',
'''  <div class="note" style="margin-top:26px"><b>v2.0 变更摘要</b>：把文档拉回与原型一致。核心一处是<b>范围变更</b>——v1.1 写「不做用户注册与登录」，而原型已实现完整账户中心（8 页）并跑通购买链路，v2.0 正式纳入账户体系，同时保留访客下单。另修订：品牌统一为 TIDEGLASS、后台账号由单密码改为同账号体系 + 权限位、补齐 7 条原型已实现但文档缺失的需求、9 条文档先行需求标注覆盖状态。详见 12.6。</div>
  <div class="note" style="margin-top:14px"><b>v1.1 变更摘要</b>''', 'v2.0摘要')

# ---------- 2. 2.1 本期包含 ----------
rep('''  <li>前台：首页、集合页、商品详情、搜索、购物车、结算、订单完成、订单查询、评价提交、内容页、404。</li>''',
'''  <li>前台：首页、集合页、商品详情、搜索、购物车、结算、订单完成、订单查询、评价提交、内容页、404，以及<b>账户中心</b>（登录 / 注册 / 概览 / 订单 / 地址簿 / 心愿单 / 设置，见 5.9）。</li>''', '2.1前台')

# ---------- 3. 2.2 不做清单：用户体系翻案 ----------
rep('''  <li>用户注册与登录体系（首版<b>仅访客下单</b>，订单号 + 邮箱查询）。<span class="tag">已确认</span></li>''',
'''  <li><b>账户体系做，访客下单也保留</b>——二者并存：不注册可直接下单，注册后订单自动归入账户。<span class="tag">v2.0 修订</span> 理由见 5.9 开头：账户支撑复购与订单归属，但不该成为成交流程的门槛。</li>
  <li>第三方社交登录（Google / Apple / Facebook SSO）不做，首版仅邮箱 + 密码。<span class="tag">偏离</span></li>''', '2.2用户体系')

# ---------- 4. 第 3 节角色与权限 ----------
rep('''  <tr><td>访客消费者</td><td>未登录，占流量 95% 以上</td><td>全部前台公开页</td><td>浏览、搜索、加购、用券、结算、提交评价</td></tr>
  <tr><td>回访客户（无账户）</td><td>已有至少一笔订单，凭订单号 + 邮箱识别</td><td>同上 + 邮件里的订单链接</td><td>查单、申请退换、颜色保证换新、确认收货后评价</td></tr>
  <tr><td>运营（后台）</td><td>你本人 / 助理</td><td>后台全部模块</td><td>商品上下架、改价、订单发货、库存调整、营销活动配置、评价审核与删除、内容维护</td></tr>
  <tr><td>财务（后台）</td><td>可选，v2 引入</td><td>订单、成本、导出</td><td>对账、导出、退款审批 <span class="tag">待确认</span></td></tr>
</table>
<p class="small">首版后台为<b>单角色全权限</b>，不做权限矩阵；如需多人协作再拆角色。注意：v1.0 把"下单客户"写成一种登录角色是错的——首版没有账户体系，客户只是<b>以邮箱聚合的订单数据集</b>，不构成可登录主体。</p>''',
'''  <tr><td>访客</td><td>未登录，预计占流量 60–75%</td><td>全部前台公开页</td><td>浏览、搜索、加购、用券、结算（访客模式）、凭订单号 + 邮箱查单与评价</td></tr>
  <tr><td>注册客户</td><td>已登录（<code>role = customer</code>）</td><td>前台公开页 + 账户中心</td><td>上述全部 + 订单历史、地址簿、心愿单、再次购买、改资料</td></tr>
  <tr><td>运营 staff</td><td>你本人 / 助理（<code>role = staff</code>）</td><td>后台除设置与客户导出的模块</td><td>商品上下架、改价、订单发货、库存调整、营销配置、评价审核与删除、内容维护</td></tr>
  <tr><td>店主 owner</td><td>你本人（<code>role = owner</code>）</td><td>后台全部模块</td><td>上述全部 + 设置与费用参数、账号与权限管理、客户数据导出、退款审批</td></tr>
</table>
<p class="small"><b>v2.0 改动</b>：v1.1 写「单角色全权限，不做权限矩阵」，前提是没有账户体系。现在前台有了账户，后台若仍是"任意邮箱 + 一个写死的密码"，等于把改价、删评价、导出客户的权限对外敞开。因此改为<b>同一账号体系 + 权限位</b>：用户表加 <code>role</code>，后台登录复用前台会话只校验 role，敏感操作（改价、删评价、导出客户、退款）单独校验权限位并写操作日志（FR-A-016）。店主可用同一个账号在前台下单测试、在后台管理，不需要维护两套密码。</p>''', '第3节角色')

# ---------- 5. 4.2 页面清单补账户中心 ----------
rep('''  <tr><td class="id">A-01</td><td>后台登录</td>''',
'''  <tr><td class="id">S-13</td><td>登录</td><td><code>/account/login</code></td><td class="p1">🔴</td><td>邮箱 + 密码，支持 <code>?next=</code> 回跳 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">S-14</td><td>注册</td><td><code>/account/register</code></td><td class="p1">🔴</td><td>姓名 + 邮箱 + 密码，成功后自动登录 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">S-15</td><td>账户概览</td><td><code>/account</code></td><td class="p1">🔴</td><td>订单数 / 在途 / 心愿单 + 最近一单进度 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">S-16</td><td>订单列表</td><td><code>/account/orders</code></td><td class="p1">🔴</td><td>倒序，含状态与缩略图 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">S-17</td><td>订单详情</td><td><code>/account/orders/{no}</code></td><td class="p1">🔴</td><td>明细 / 金额构成 / 地址 / 物流 / 时间线 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">S-18</td><td>地址簿</td><td><code>/account/addresses</code></td><td class="p2">🟡</td><td>增删改 + 设默认 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">S-19</td><td>心愿单</td><td><code>/account/wishlist</code></td><td class="p2">🟡</td><td>收藏商品，可移除可加购 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">S-20</td><td>账户设置</td><td><code>/account/settings</code></td><td class="p2">🟡</td><td>改资料 / 改密码 / 注销 <span class="tag">v2.0 新增</span></td></tr>
  <tr><td class="id">A-01</td><td>后台登录</td>''', '4.2页面')

# ---------- 6. 新增 5.9 会计中心整节 ----------
rep('''<h2 id="s6"><span class="n">6</span>后台功能需求</h2>''',
'''<h3 id="s5-9">5.9 账户中心 S-13 ~ S-20（v2.0 新增）</h3>
<p class="small">这一节是 v2.0 唯一一处<b>范围翻案</b>，先说清楚为什么翻：v1.1 判断"首版不做账户"是为了让成交流程最短，这个判断在当时成立；但原型做出来之后暴露了两件访客模式做不到的事——<b>订单归属</b>（客户换个设备就查不到自己的单）与<b>复购路径</b>（心愿单、地址复用、再次购买全都没有落点）。饰品的复购周期是 3–6 个月，没有账户等于每次复购都要重新拉新。所以改为：<b>访客下单保留，账户体系同时提供</b>，注册不是结算的前置条件。</p>
<table>
  <tr><th>编号</th><th>需求描述</th><th>优先级</th><th>验收标准</th></tr>
  <tr><td class="id">FR-S-140</td><td>注册：姓名 + 邮箱 + 密码（≥8 位，含字母与数字）；邮箱唯一，重复注册给出明确提示；<b>密码只存不可逆摘要，永不存明文</b>；注册成功自动登录并按 <code>?next=</code> 回跳 <span class="tag">增强</span></td><td class="p1">🔴</td><td>弱密码被拒并说明规则；重复邮箱不覆盖已有账户；库中查不到明文密码</td></tr>
  <tr><td class="id">FR-S-141</td><td>登录：邮箱 + 密码；失败提示<b>不区分"账号不存在"与"密码错误"</b>（防账号枚举）；支持 <code>?next=</code> 回跳，目标仅允许 <code>/checkout</code> 与 <code>/cart</code> 白名单 <span class="tag">增强</span></td><td class="p1">🔴</td><td>从结算页登录后回到结算页而不是首页；<code>?next=//evil.com</code> 被忽略</td></tr>
  <tr><td class="id">FR-S-142</td><td>账户门禁：未登录访问任意 <code>/account/*</code> 时，展示登录 / 注册二选一，<b>不做强制跳转</b>（跳转会丢失用户原本想去的页面） <span class="tag">增强</span></td><td class="p1">🔴</td><td>门禁页保留原始目标，登录后直达</td></tr>
  <tr><td class="id">FR-S-143</td><td>账户概览：欢迎语（用名字）、三格统计（订单总数 / 在途订单 / 心愿单件数）、最近一单的进度时间线、常用入口 <span class="tag">增强</span></td><td class="p1">🔴</td><td>无订单时显示引导下单的空态，不出现 0 值堆叠</td></tr>
  <tr><td class="id">FR-S-144</td><td>订单列表：按下单时间倒序，每行显示订单号、日期、状态、件数、金额、首件商品缩略图；点击进详情 <span class="tag">增强</span></td><td class="p1">🔴</td><td>分页或懒加载，50 单以上不卡顿</td></tr>
  <tr><td class="id">FR-S-145</td><td>订单详情：商品明细（图 / 名 / 变体 / 数量 / 单价）、金额构成（商品小计 / 优惠券 / 补贴 / 运费 / 税 / 合计，<b>赠品行显示 $0</b>）、收货地址、物流承运商与单号、进度时间线 <span class="tag">增强</span></td><td class="p1">🔴</td><td>金额与下单邮件、后台订单详情三处完全一致</td></tr>
  <tr><td class="id">FR-S-146</td><td>地址簿：新增 / 编辑 / 删除 / 设为默认；结算页优先带出默认地址；删除默认地址时提示重新指定 <span class="tag">增强</span></td><td class="p2">🟡</td><td>至少保留 1 个地址时才允许删除</td></tr>
  <tr><td class="id">FR-S-147</td><td>心愿单：商品页心形按钮切换收藏（未登录点击引导登录并回跳原商品）；列表支持移除与直接加购；空态给推荐商品 <span class="tag">增强</span></td><td class="p2">🟡</td><td>收藏状态跨设备一致（登录态）</td></tr>
  <tr><td class="id">FR-S-148</td><td>账户设置：改姓名、改邮箱、改密码、注销账号。改邮箱需<b>验证当前密码</b>并<b>同步迁移历史订单归属</b>；改密码需验证旧密码；注销需二次确认并说明后果 <span class="tag">增强</span></td><td class="p2">🟡</td><td>改邮箱后历史订单仍在列表中；注销后原邮箱可重新注册且看不到旧订单</td></tr>
  <tr><td class="id">FR-S-149</td><td>访客查单 S-08 保留：订单号 + 邮箱即可查，<b>不要求登录</b>；查询结果页提供"用这个邮箱注册，自动归入账户"的入口 <span class="tag">复刻</span></td><td class="p1">🔴</td><td>邮箱大小写不敏感；错误组合不泄露订单是否存在</td></tr>
  <tr><td class="id">FR-S-150</td><td>订单归属：订单创建时固化下单邮箱，账户订单按邮箱匹配（规则见 BR-20） <span class="tag">增强</span></td><td class="p1">🔴</td><td>用同邮箱注册后，历史访客订单自动出现</td></tr>
  <tr><td class="id">FR-S-151</td><td>结算页在已登录状态<b>锁定邮箱输入框</b>，只读展示"Signed in as {email}"并给 Change 入口（改邮箱等于换账户，应引导先改账户邮箱） <span class="tag">增强</span></td><td class="p1">🔴</td><td>已登录时无法在结算页改动邮箱；未登录时可自由填</td></tr>
  <tr><td class="id">FR-S-152</td><td>页头登录态：桌面显示 <code>Hello, {名}</code> 并可进账户；移动端窄屏隐藏问候语后，<b>必须保留账户图标入口</b> <span class="tag">增强</span></td><td class="p1">🔴</td><td>375px 宽度下仍能进入账户中心</td></tr>
  <tr><td class="id">FR-S-153</td><td>购物车抽屉底部显示登录态：未登录显示 Sign in（带 <code>?next=/checkout</code>）并说明"登录后订单会存进账户"；已登录显示当前账号 <span class="tag">增强</span></td><td class="p2">🟡</td><td>不阻断访客结算</td></tr>
</table>
<div class="note"><b>三条容易漏的一致性规则</b>（原型已实现，文档原先完全没有，开发时最容易出事）：<br>
① <b>订单归属按邮箱匹配</b>，大小写不敏感。所以结算页已登录时必须锁邮箱，否则用户改个邮箱下单，订单就从账户里消失了。<br>
② <b>改邮箱要迁移订单</b>。账户里改邮箱若只更新用户表，历史订单还是挂在旧邮箱上，用户会看到"我的订单空了"。必须在同一事务里把订单的 email 一起改。<br>
③ <b>注销不删订单</b>。订单是财务与税务凭证，注销只解除账户关联，订单本身保留。</div>

<h2 id="s6"><span class="n">6</span>后台功能需求</h2>''', '5.9节')

# ---------- 7. BR-20 订单归属 ----------
rep('''  <tr><td class="id">BR-19</td>''', '''  <tr><td class="id">BR-20</td><td class="p1">订单归属与账户一致性</td><td>① 订单创建瞬间固化 <code>email</code>，归属按邮箱<b>大小写不敏感</b>匹配；② 已登录用户在结算页<b>锁定邮箱</b>，如需换邮箱应先改账户邮箱；③ 账户改邮箱时，历史订单的 <code>email</code> <b>在同一事务内一并迁移</b>；④ 访客用某邮箱下单后，用同一邮箱注册即<b>自动继承</b>历史订单；⑤ <b>注销账户不删除订单</b>，仅解除账户关联（订单为财务与税务凭证，按当地法规需留存）；⑥ 一个邮箱不允许绑定多个账户</td></tr>
  <tr><td class="id">BR-19</td>''', 'BR-20')

# BR-08 / BR-13 前缀
rep('<code>WK-1xx</code> 项链','<code>TG-1xx</code> 项链','BR-08')
rep('<code>WK-</code> + 6 位年月 + 4 位流水，如 <code>WK-2611-0042</code>','<code>TG-</code> + 4 位年月 + 4 位流水，如 <code>TG-2611-0042</code>（原型演示用简化序号 <code>#TG1132</code>，生产按此规范）','BR-13')

# ---------- 8. FR-A-001 后台登录改权限位 ----------
rep('''  <tr><td class="id">FR-A-001</td><td>登录：邮箱 + 密码，会话 24 小时，连续失败 5 次锁定 10 分钟 <span class="tag">增强</span></td><td class="p1">🔴</td><td>未登录访问任意后台页均跳登录</td></tr>''',
'''  <tr><td class="id">FR-A-001</td><td class="p1">登录与权限：<b>复用前台账号体系</b>，后台只校验 <code>role ∈ {staff, owner}</code>；<code>customer</code> 角色访问后台一律拒绝。会话 24 小时，连续失败 5 次锁定 10 分钟；<b>敏感操作按权限位二次校验</b>（改价、删评价、导出客户、退款审批） <span class="tag">v2.0 修订</span></td><td class="p1">🔴</td><td>顾客账号无法进入后台；staff 看不到设置与导出入口；所有写操作进操作日志（FR-A-016）</td></tr>
  <tr><td class="id">FR-A-001b</td><td>账号与权限管理（仅 owner）：成员列表、角色分配（staff / owner）、权限位勾选、停用账号；<b>不提供自助注册</b>，后台账号由 owner 邀请创建 <span class="tag">增强</span></td><td class="p2">🟡</td><td>停用后该账号立即失去后台权限，前台账户仍可用</td></tr>''', 'FR-A-001')

# ---------- 9. 第 11 节待确认 ----------
rep('''  <tr><td>Q1</td><td>品牌正式名称与域名？当前用 TIDEGLASS 占位</td><td>确认后全局替换</td><td>文案、SEO、邮件模板</td></tr>''',
'''  <tr><td>Q1</td><td>品牌名已定为 <b>TIDEGLASS</b>（商标与域名核查见 <code>branding/品牌名核查-v1.0.html</code>）。<b>待办</b>：tideglassjewelry.com 等域名注册、USPTO / UKIPO Class 14 正式检索</td><td>先注册域名占位，再委托代理做跨境检索</td><td>上线时间、包装印刷、社媒账号注册</td></tr>
  <tr><td>Q5</td><td><b>价格带是否锁定 $58–$143？</b>原型数据已按此三档上调（基础 58–89 / 珍珠 92–118 / 套装 120–143）。若改为低价切入（$42–$96），毛利从 48% 降到 35%，扣除获客成本后可能无利</td><td>锁定 $58 起价。低价款用入门小件（$58 耳钉 / 脚链）承担引流，不整体降价</td><td>毛利模型、免邮门槛、赠品门槛</td></tr>
  <tr><td>Q6</td><td><b>品类轴到底有没有耳环 / 发饰？</b>规划是发饰 6 款、无耳环；原型导航是 EARRINGS、无发饰</td><td>按规划去掉耳环、补发饰，或反过来调整规划</td><td>11 项一级导航、集合挂载、筛选维度</td></tr>''', 'Q1')

# ---------- 10. 第 12 章标题与 12.6 变更记录 ----------
rep('<h2 id="s12"><span class="n">12</span>决策记录与变更（v1.0 → v1.1）</h2>',
    '<h2 id="s12"><span class="n">12</span>决策记录与变更（v1.0 → v2.0）</h2>', 's12标题')

rep('''<h2 id="s12"><span class="n">12</span>决策记录与变更（v1.0 → v2.0）</h2>''',
'''<h2 id="s12"><span class="n">12</span>决策记录与变更（v1.0 → v2.0）</h2>
<h3>12.6 v2.0 变更（与原型同步）</h3>
<p class="small">v2.0 不新增业务想象，只做一件事：<b>把文档拉回到原型已经验证过的现实</b>。依据是 <code>review/同步核查报告-v1.0.html</code> 的核查结论（硬冲突 6 · 原型超前 7 · 文档超前 9 · 文档内耗 3）。</p>
<table>
  <tr><th>类别</th><th>变更</th><th>条目</th></tr>
  <tr><td><b>范围翻案</b></td><td>用户注册登录从「不做」改为「做」，新增 5.9 账户中心 14 条需求、8 个页面（S-13~S-20）；访客下单保留</td><td>2.1、2.2、3、4.2、FR-S-140~153</td></tr>
  <tr><td><b>权限模型</b></td><td>后台由「单密码、单角色、全权限」改为「同账号体系 + role + 权限位 + 操作日志」</td><td>FR-A-001、FR-A-001b、第 3 节</td></tr>
  <tr><td><b>一致性规则</b></td><td>新增订单归属规则（按邮箱匹配、锁定、迁移、继承、注销保留）</td><td>BR-20、FR-S-150~151</td></tr>
  <tr><td><b>品牌</b></td><td>Wildkind → TIDEGLASS；编号 WK- → TG-；SKU 与订单号前缀同步</td><td>全文</td></tr>
  <tr><td><b>数据口径</b></td><td>原型 36 款商品价格按 BR-01 三档上调至 $58–$143，与毛利模型一致</td><td>BR-01（未变）、原型数据</td></tr>
  <tr><td><b>补写缺失</b></td><td>把原型已实现但文档未写的 7 项补进需求：支付失败重试、邮箱锁定、订单迁移、抽屉登录态、移动端账户入口、登录回跳、心愿单</td><td>FR-S-076、151、153、152、141、147、148</td></tr>
  <tr><td><b>标注覆盖</b></td><td>9 条文档先行需求标注覆盖状态：mega menu 与 Cookie 条为真缺，其余属「原型抽样不覆盖」</td><td>见附录 A 覆盖矩阵</td></tr>
  <tr><td><b>待确认</b></td><td>Q1 品牌清单化、新增 Q5 价格带、Q6 品类轴</td><td>第 11 节</td></tr>
</table>''', '12.6')

io.open(P, 'w', encoding='utf-8').write(s)
print('size', n0, '->', len(s))
print('MISS:', miss if miss else 'none')
