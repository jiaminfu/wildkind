# -*- coding: utf-8 -*-
"""SDD v1.1 -> v2.0：补账户与权限模型、订单归属流程、鉴权口径、追溯矩阵"""
import io

P = 'review/SDD-系统设计说明书-v2.0.html'
s = io.open(P, encoding='utf-8').read()
n0 = len(s)
miss = []

def rep(a, b, tag=''):
    global s
    if a not in s:
        miss.append(tag or a[:50]); return
    s = s.replace(a, b, 1)

# ---------- 0 品牌与版本 ----------
s = s.replace('Wildkind', 'TIDEGLASS')
s = s.replace('WK-SDD-001', 'TG-SDD-001')
rep('<title>系统设计说明书 · TG-SDD-001 v1.0（评审稿）</title>',
    '<title>系统设计说明书 · TG-SDD-001 v2.0（同步稿）</title>', 'title')
rep('<div>版本</div><div>v1.1 评审稿（<span class="badge">待二审</span>）</div>',
    '<div>版本</div><div>v2.0 同步稿（<span class="badge">待一审</span>）</div>', '版本')
rep('— 文档结束 · TG-SDD-001 v1.1 评审稿 · 与 FRD v1.1 一并确认后再进入实现 —',
    '— 文档结束 · TG-SDD-001 v2.0 同步稿 · 与 FRD v2.0 一并确认后再进入实现 —', '结尾')

# ---------- 1 实体关系 ----------
rep('''Customer 1──&lt; Order (以邮箱识别)   Setting (单行)   ContentBlock / ContentPage</code></pre>''',
'''Customer 1──&lt; Order (以邮箱识别)   Setting (单行)   ContentBlock / ContentPage

User (账户) ──&lt; Session (会话)
  ├──&lt; Address
  ├──&lt; WishlistItem &gt;── Product
  └─(email)─&gt; Order   ← 归属靠邮箱匹配，<b>不设外键</b>：访客订单要先能存在，用户后才注册</code></pre>''', '5.1实体')

# ---------- 2 表数量 ----------
rep('<h3>5.2 核心表（25 张）</h3>', '<h3>5.2 核心表（29 张）</h3>', '表数量')

# ---------- 3 新增账户与权限表组 ----------
rep('''<h4>评价与运营（7 张）</h4>''',
'''<h4>账户与权限（4 张 · v2.0 新增）</h4>
<table>
  <tr><th>表</th><th>关键字段</th><th>索引 / 约束</th></tr>
  <tr><td class="hl">User</td><td class="hl">id、email（唯一）、passwordHash（argon2id）、name、<b>role</b>（customer / staff / owner）、<b>permissions</b>（JSON 数组，权限位）、status（active / disabled）、createdAt、lastLoginAt</td><td class="hl">email 唯一且<b>入库前统一小写</b>（否则 A@x.com 与 a@x.com 会变成两个账户，订单归属立刻错）；role + status</td></tr>
  <tr><td class="hl">Session</td><td class="hl">id、userId、tokenHash（唯一）、userAgent、ip、expiresAt、revokedAt、createdAt</td><td class="hl">tokenHash 唯一（库里只有哈希，泄库不能直接冒用）；expiresAt 索引供清理任务；同一用户允许多设备会话</td></tr>
  <tr><td class="hl">Address</td><td class="hl">id、userId、first、last、line1、line2、city、state、zip、country、phone、isDefault</td><td class="hl">userId + isDefault；每个用户至多一个默认地址（部分唯一索引保证）</td></tr>
  <tr><td class="hl">WishlistItem</td><td class="hl">id、userId、productId、createdAt</td><td class="hl">userId + productId 唯一（重复收藏靠 upsert 幂等）</td></tr>
</table>

<h4>评价与运营（7 张）</h4>''', '账户表')

# ---------- 4 Setting 去掉后台密码 ----------
rep('adminEmail、adminPasswordHash</td>',
    'ownerEmail（仅作通知收件人，<b>不再是登录凭据</b>，v2.0 起后台登录走 User 表）</td>', 'Setting')

# ---------- 5 关键设计决定：五条改六条 ----------
rep('<h3>5.3 五个关键设计决定</h3>', '<h3>5.4 六个关键设计决定</h3>', '5.3标题')
rep('''  <li><b>客户以邮箱为主键</b>：不做账户体系时，邮箱是唯一可用的身份锚点；同一邮箱多次下单聚合为同一客户，用于复购统计与优惠券的 perUserLimit 校验。</li>''',
'''  <li><b>订单归 User，但归属靠邮箱</b>：订单表存 <code>email</code>，账户订单按邮箱匹配（BR-20）。<b>刻意不给 Order 加 userId 外键</b>——访客必须先能下单，用户是后注册的；若用外键，访客订单无处挂载，注册时还要回填。代价是改邮箱必须迁移订单，这一点在 7.5 里用同一事务保证。Customer 表退化为<b>统计视图</b>（按邮箱聚合），不再承担身份职责。</li>
  <li class="hl"><b>权限位与角色分离</b>：<code>role</code> 决定"能不能进后台"，<code>permissions</code> 决定"进去能做什么"。<code>staff</code> 默认无 <code>price.write</code> / <code>review.delete</code> / <code>customer.export</code> / <code>refund.approve</code> 四个权限位——这四项直接对应钱与口碑，误操作代价最高。<b>判断权限只看权限位，不看角色</b>，避免"加个新角色到处改 if"。</li>''', '设计决定')

# ---------- 6 新增 7.5 账户与订单归属流程 ----------
rep('''<h2 id="s8"><span class="n">8</span>部署与运维</h2>''',
'''<h3>7.5 账户与订单归属（v2.0 新增）</h3>
<p class="small">这条流程看着简单，但四个环节任一处理错，用户就会看到"我的订单不见了"。原型里已经把四条都实现，这里给出服务端口径。</p>
<h4>注册与访客订单继承</h4>
<pre><code>POST /api/auth/register { name, email, password }
  1. email 归一化小写 → 查 User 唯一性，冲突返 409
  2. passwordHash = argon2id(password)
  3. 事务：INSERT User
          + 把 Order.email = 该邮箱的<b>访客订单</b>自动归入账户（无需回填字段，靠匹配即生效）
  4. 建 Session（HttpOnly Cookie）→ 写 lastLoginAt
  5. 发欢迎邮件（EmailTemplate key = welcome）</code></pre>
<h4>登录</h4>
<pre><code>POST /api/auth/login { email, password }
  失败一律返回「邮箱或密码不正确」，<b>不区分账号是否存在</b>（防枚举）
  计数键 = email + ip，5 次失败锁定 10 分钟
  成功 → 建 Session；若带 ?next= 且在白名单（/checkout、/cart）则跳回</code></pre>
<h4 class="hl">改邮箱（最容易出事的环节）</h4>
<pre><code>PATCH /api/account/email { newEmail, currentPassword }
  1. 校验 currentPassword —— 改邮箱属于敏感操作，必须验密码
  2. 校验 newEmail 未被占用（含大小写归一后）
  3. <b>单事务内</b>：
       UPDATE User    SET email = newEmail WHERE id = ?
       UPDATE "Order" SET email = newEmail WHERE lower(email) = lower(oldEmail)
  4. 若两步分属不同事务，中间失败 = 用户历史订单全部"消失"
  5. 发安全通知邮件到<b>旧邮箱</b>（异常改绑的第一时间告知）</code></pre>
<h4>注销</h4>
<pre><code>DELETE /api/account  { password }
  1. 二次确认 + 验密码
  2. User.status = 'deleted_marked'，Session 全部 revoke，PII（姓名 / 电话 / 地址）清空
  3. <b>订单不删</b>：Order.email 保留（财务与税务凭证需留存 7 年），仅解除账户关联
  4. Address / WishlistItem 物理删除
  5. 记录删除请求时间与范围，供 GDPR / CCPA 审计</code></pre>
<div class="note"><b>为什么订单不跟着删</b>：GDPR 的删除权与税务留存义务是冲突的，通行做法是<b>保留交易记录、清除可直接识别个人的字段</b>。所以注销后订单仍在库里（金额、商品、日期），但姓名、电话、详细地址被清空，只留邮箱作为交易凭证索引——这一点必须写进隐私政策，否则会被投诉"说好删除却还留着"。</div>

<h2 id="s8"><span class="n">8</span>部署与运维</h2>''', '7.5')

# ---------- 7 安全章节：鉴权口径 ----------
rep('''  <tr><td>后台鉴权</td><td>密码哈希（bcrypt/argon2）、HttpOnly + SameSite Cookie、会话 24h、登录失败限流与锁定</td></tr>''',
'''  <tr><td class="hl">账户鉴权（v2.0 扩充）</td><td class="hl">前后台<b>同一套 User 表</b>：argon2id 密码哈希（<b>永不存明文、不可逆</b>）、HttpOnly + SameSite=Lax + Secure Cookie、会话 24h、登录失败按 email + ip 限流并锁定、Session 只存 tokenHash、改邮箱与改密码均需验旧密码并通知旧邮箱</td></tr>
  <tr><td class="hl">后台授权</td><td class="hl">进后台校验 <code>role ∈ {staff, owner}</code>，<code>customer</code> 一律 403；敏感操作按权限位二次校验：<code>price.write</code>（改价）、<code>review.delete</code>（删评价）、<code>customer.export</code>（导出客户）、<code>refund.approve</code>（退款审批）；越权尝试写安全日志</td></tr>
  <tr><td>登录枚举防护</td><td>注册与登录对"邮箱已存在 / 不存在"给出统一文案，避免被批量探测账号；忘记密码同样只回"如果该邮箱已注册，我们已发送邮件"</td></tr>''', '安全章节')

# ---------- 8 追溯矩阵 ----------
rep('''  <tr><td>FR-S-090~098 内容与辅助</td>''',
'''  <tr><td class="hl">FR-S-140~153 账户中心（v2.0）</td><td class="hl">auth、account、order</td><td class="hl">User、Session、Address、WishlistItem、Order(email)</td><td class="hl"><code>/api/auth/*</code>、<code>/api/account/*</code>、<code>/api/orders/lookup</code></td><td class="hl">S-13~S-20</td></tr>
  <tr><td>FR-S-090~098 内容与辅助</td>''', '追溯矩阵')

rep('''  <tr><td>BR-01~20 业务规则</td>''', '''  <tr><td>BR-01~21 业务规则</td>''', 'BR范围')

io.open(P, 'w', encoding='utf-8').write(s)
print('size', n0, '->', len(s))
print('MISS:', miss if miss else 'none')
