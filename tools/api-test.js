/* ============================================================
   LASTGROVE API · 接口自动化测试
   覆盖：健康检查 / 目录 / 筛选 / 详情 / 报价 / 下单 / 幂等 /
        查单 / 库存扣减 / 赠品 / 后台登录 / 权限 / 状态机 / 退款回补
   用法：node tools/api-test.js [baseUrl]
   ============================================================ */
'use strict';
const BASE = process.argv[2] || 'http://localhost:4600';

/* 幂等键必须每次运行都不同。写死 'test-key-1' 的话，第二遍运行会命中上一轮
   那张已经退款的订单：重放拿回旧单、状态流转 409、退款 409 —— 一连串假红，
   查半天才发现是测试自己踩了自己。 */
const IDEM = 'apitest-' + Date.now();

let pass = 0, fail = 0;
const failures = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

async function call(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

(async () => {
  /* ---------- 0. 复位到基线 ---------- */
  // 这套用例会真的下单、退款、改设置，跑第二遍时数据已被改过，断言必然失败。
  // 因此开跑前先复位；服务没开复位端点（缺 ALLOW_TEST_RESET=1）时只警告不中断，
  // 但要提醒：那种情况下这套测试只能跑一次，不具备回归价值。
  section('0 数据复位');
  const reset = await call('POST', '/api/v1/__test/reset');
  if (reset.status === 200) {
    chk('数据已复位到基线', true, reset.body.data.orders + ' 单 / 下一个单号 ' + reset.body.data.nextOrderNumber);
  } else if (reset.status === 404) {
    console.log('  ⚠️  服务未开启复位端点（需以 ALLOW_TEST_RESET=1 启动），本次结果依赖当前数据状态');
  } else {
    chk('数据复位', false, 'status=' + reset.status + ' ' + JSON.stringify(reset.body).slice(0, 120));
  }

  /* ---------- 1. 健康与目录 ---------- */
  section('1 健康检查与目录');
  const health = await call('GET', '/api/v1/health');
  chk('健康检查 200', health.status === 200, 'status=' + health.status);
  /* 商品总数不写死：调价、上新、下架都会让它变。
     写死数字的结果是「数据一变回归就红」，红的还不是代码问题，
     久了我自己也不看这份报告了。改为与商品接口的口径互相印证。 */
  const TOTAL_PRODUCTS = health.body && health.body.data.products;
  chk('返回商品总数', typeof TOTAL_PRODUCTS === 'number' && TOTAL_PRODUCTS > 0, TOTAL_PRODUCTS);

  const boot = await call('GET', '/api/v1/bootstrap');
  chk('bootstrap 200', boot.status === 200);
  chk('含导航项', boot.body.data.nav.length >= 8, boot.body.data.nav.length + ' 项');
  chk('含免邮门槛', boot.body.data.settings.freeShippingThreshold === 95);
  chk('含赠品规则', boot.body.data.settings.giftThreshold === 120);

  const list = await call('GET', '/api/v1/products');
  chk('商品列表 200', list.status === 200);
  chk('列表返回 24 条（默认分页）', list.body.data.length === 24, list.body.data.length);
  chk('列表不外泄成本价', list.body.data.every(p => p.cost === undefined));

  const gold = await call('GET', '/api/v1/products?metal=Gold');
  chk('金属筛选生效', gold.body.data.every(p => p.variants.some(v => v.metal === 'Gold')), gold.body.data.length + ' 款');
  const cheap = await call('GET', '/api/v1/products?price=under-70');
  chk('价格筛选生效', cheap.body.data.every(p => p.price < 70), cheap.body.data.length + ' 款');
  const sorted = await call('GET', '/api/v1/products?sort=price-asc&limit=48');
  const prices = sorted.body.data.map(p => p.price);
  chk('价格升序排序正确', prices.every((v, i) => i === 0 || prices[i - 1] <= v));

  const pdp = await call('GET', '/api/v1/products/foxtrot-pendant-necklace');
  chk('商品详情 200', pdp.status === 200 && pdp.body.data.product.id === 'LG-101');
  chk('详情含评价', Array.isArray(pdp.body.data.reviews));
  chk('详情含关联推荐', pdp.body.data.related.length > 0, pdp.body.data.related.length + ' 款');

  const missing = await call('GET', '/api/v1/products/does-not-exist');
  chk('不存在的商品返回 404', missing.status === 404 && missing.body.error.code === 'NOT_FOUND');

  /* ---------- 2. 报价 ---------- */
  section('2 报价与定价规则');
  /* 单价不写死。调一次价、上下架一款，写死的断言就变红，红的还不是代码问题。
     这里从商品接口现取，测试跟着数据走；断言的是「算式对不对」而不是「数据长什么样」。 */
  const catalog = (await call('GET', '/api/v1/products?limit=48')).body.data;
  const unitOf = id => (catalog.find(p => p.id === id) || {}).price;
  const P101 = unitOf('LG-101');
  const P102 = unitOf('LG-102');
  chk('能取到两款测试商品的价格', typeof P101 === 'number' && typeof P102 === 'number',
    'LG-101=$' + P101 + ' LG-102=$' + P102);
  const EXP_SUB = Math.round((P101 + P102) * 100) / 100;   // 小计
  const EXP_DISC = Math.round(EXP_SUB * 10) / 100;         // LASTGROVE10 打 10%

  const items = [
    { productId: 'LG-101', metal: 'Gold', qty: 1 },
    { productId: 'LG-102', metal: 'Silver', qty: 1 },
  ];
  const q1 = await call('POST', '/api/v1/checkout/quote', { items });
  chk('报价 200', q1.status === 200, q1.body.error && q1.body.error.message);
  chk('返回 quoteId', /^Q[a-f0-9]{18}$/.test(q1.body.data.quoteId), q1.body.data.quoteId);
  chk('小计 = ' + P101 + ' + ' + P102, q1.body.data.subtotal === EXP_SUB, q1.body.data.subtotal);
  chk('满 $95 免标准运费', q1.body.data.shipping === 0, q1.body.data.shipping);
  chk('满 $120 带赠品', !!q1.body.data.gift, q1.body.data.gift && q1.body.data.gift.title);
  /* 不带州 → 不收税，所以合计必然等于小计。断言「合计=小计+税」这个恒等式，
     而不是断言一个具体数字：加了税、改了免税门槛，这条仍然有意义。 */
  chk('合计 = 小计 + 税', q1.body.data.total === Math.round((q1.body.data.subtotal +
    (q1.body.data.tax || 0)) * 100) / 100, q1.body.data.total + ' (tax=' + (q1.body.data.tax || 0) + ')');
  chk('未指定州不收税', !q1.body.data.tax, '$' + (q1.body.data.tax || 0));

  const qx = await call('POST', '/api/v1/checkout/quote', { items, shippingMethod: 'Express' });
  chk('Express 运费 $18', qx.body.data.shipping === 18, qx.body.data.shipping);

  const bogusPrice = await call('POST', '/api/v1/checkout/quote', {
    items: [{ productId: 'LG-101', metal: 'Gold', qty: 1, unitPrice: 1, lineTotal: 1 }],
  });
  chk('前端伪造价格被忽略', bogusPrice.body.data.subtotal === P101, bogusPrice.body.data.subtotal);

  const oos = await call('POST', '/api/v1/checkout/quote', {
    items: [{ productId: 'LG-101', metal: 'Gold', qty: 99 }],
  });
  chk('超量数量被拒（>10 限购）', oos.status === 422 && oos.body.error.code === 'CART_INVALID',
    oos.body.error && oos.body.error.code);

  const couponOk = await call('POST', '/api/v1/coupons/validate', { code: 'LASTGROVE10', items });
  chk('优惠码校验 200', couponOk.status === 200);
  chk('10% 折扣 = ' + EXP_DISC, couponOk.body.data.discount === EXP_DISC, couponOk.body.data.discount);

  const couponMin = await call('POST', '/api/v1/coupons/validate', {
    code: 'WELCOME15', items: [{ productId: 'LG-101', metal: 'Gold', qty: 1 }],
  });
  chk('未达门槛返回 COUPON_MIN_SUBTOTAL', couponMin.status === 422 &&
    couponMin.body.error.code === 'COUPON_MIN_SUBTOTAL', couponMin.body.error && couponMin.body.error.code);

  const couponDead = await call('POST', '/api/v1/coupons/validate', { code: 'SUMMER20', items });
  chk('过期码返回 COUPON_EXPIRED', couponDead.status === 422 &&
    couponDead.body.error.code === 'COUPON_EXPIRED', couponDead.body.error && couponDead.body.error.code);

  const couponFuture = await call('POST', '/api/v1/coupons/validate', { code: 'BF30', items });
  chk('未开始码返回 COUPON_NOT_STARTED', couponFuture.status === 422 &&
    couponFuture.body.error.code === 'COUPON_NOT_STARTED', couponFuture.body.error && couponFuture.body.error.code);

  const couponFake = await call('POST', '/api/v1/coupons/validate', { code: 'NOPE123', items });
  chk('无效码返回 COUPON_NOT_FOUND', couponFake.status === 422 &&
    couponFake.body.error.code === 'COUPON_NOT_FOUND');

  /* ---------- 3. 下单 ---------- */
  section('3 下单与库存');
  const beforeStock = (await call('GET', '/api/v1/products/foxtrot-pendant-necklace'))
    .body.data.product.variants.find(v => v.metal === 'Gold').stock;

  const q2 = await call('POST', '/api/v1/checkout/quote', {
    items: [{ productId: 'LG-101', metal: 'Gold', qty: 2 }],
    couponCode: 'LASTGROVE10',
    /* 必须带收货州：销售税按州算。报价不带州、下单地址带州时，
       服务端会判「金额变了」并拒单。真实前端也是这么传的（app.js → quoteNow）。 */
    state: 'TX',
  });
  const quoteId = q2.body.data.quoteId;

  const noQuote = await call('POST', '/api/v1/orders', {
    email: 'apitest@example.com', firstName: 'Api', lastName: 'Test',
    address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'United States' },
  });
  chk('不带报价下单被拒', noQuote.status === 422 && noQuote.body.error.code === 'QUOTE_REQUIRED');

  const badAddr = await call('POST', '/api/v1/orders', {
    quoteId, email: 'bad', firstName: '', lastName: '',
    address: { line1: '', city: '', state: '', zip: '', country: 'Germany' },
  });
  chk('地址校验返回 400', badAddr.status === 400, badAddr.status);
  chk('逐字段列出错误', Array.isArray(badAddr.body.error.details) && badAddr.body.error.details.length >= 5,
    badAddr.body.error.details.length + ' 项');

  const payload = {
    quoteId,
    email: 'ApiTest@Example.com',
    firstName: 'Api', lastName: 'Test',
    address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'United States' },
    payment: { last4: '4242' },
  };
  const created = await call('POST', '/api/v1/orders', payload, { 'Idempotency-Key': IDEM });
  chk('下单 201', created.status === 201, created.body.error && created.body.error.message);
  const order = created.body.data.order;
  chk('单号格式 #TGxxxx', /^#TG\d+$/.test(order.number), order.number);
  chk('订单邮箱已小写', order.email === 'apitest@example.com', order.email);
  chk('订单含赠品行', order.items.some(i => i.isGift), order.items.map(i => i.title).join(' | '));
  chk('赠品单价为 0', order.items.filter(i => i.isGift).every(i => i.unitPrice === 0));
  chk('折扣已落单', order.discount > 0, '$' + order.discount);
  chk('支付为模拟态并留痕', order.payment.mode === 'simulated' && !!order.payment.reference);

  const afterStock = (await call('GET', '/api/v1/products/foxtrot-pendant-necklace'))
    .body.data.product.variants.find(v => v.metal === 'Gold').stock;
  chk('库存按数量扣减', afterStock === beforeStock - 2, beforeStock + ' → ' + afterStock);

  const replay = await call('POST', '/api/v1/orders', payload, { 'Idempotency-Key': IDEM });
  chk('同幂等键重放不再建单', replay.status === 200 && replay.body.data.replayed === true &&
    replay.body.data.order.number === order.number, replay.body.data.order.number);

  const reuseQuote = await call('POST', '/api/v1/orders', payload, { 'Idempotency-Key': IDEM + '-2' });
  chk('报价用后失效', reuseQuote.status === 422 && reuseQuote.body.error.code === 'QUOTE_REQUIRED');

  /* ---------- 4. 查单 ---------- */
  section('4 访客查单');
  const lookupOk = await call('GET', '/api/v1/orders/lookup?number=' +
    encodeURIComponent(order.number) + '&email=apitest@example.com');
  chk('单号+邮箱可查', lookupOk.status === 200 && lookupOk.body.data.order.number === order.number);

  const lookupWrong = await call('GET', '/api/v1/orders/lookup?number=' +
    encodeURIComponent(order.number) + '&email=someone@else.com');
  chk('邮箱不符查不到', lookupWrong.status === 404);

  const lookupNoHash = await call('GET', '/api/v1/orders/lookup?number=' +
    encodeURIComponent(order.number.replace('#', '')) + '&email=apitest@example.com');
  chk('不带 # 也能查', lookupNoHash.status === 200);

  /* ---------- 5. 后台鉴权 ---------- */
  section('5 后台鉴权与权限位');
  const noAuth = await call('GET', '/api/v1/admin/metrics');
  chk('未登录访问后台 401', noAuth.status === 401 && noAuth.body.error.code === 'UNAUTHORIZED');

  const wrongPw = await call('POST', '/api/v1/admin/login', {
    email: 'owner@lastgrove.com', password: 'wrong',
  });
  chk('错误密码 401', wrongPw.status === 401);

  const login = await call('POST', '/api/v1/admin/login', {
    email: 'owner@lastgrove.com', password: 'lastgrove2026',
  });
  chk('正确密码登录 200', login.status === 200, login.body.error && login.body.error.message);
  const token = login.body.data.token;
  chk('返回令牌', /^[a-f0-9]{48}$/.test(token), token && token.slice(0, 8) + '…');
  chk('令牌有效期 12h', login.body.data.expiresIn === 43200);
  const AUTH = { Authorization: 'Bearer ' + token };

  const me = await call('GET', '/api/v1/admin/me', undefined, AUTH);
  chk('me 返回权限位', me.status === 200 && me.body.data.staff.permissions.length === 10,
    me.body.data.staff.permissions.length + ' 项');

  const opsLogin = await call('POST', '/api/v1/admin/login', {
    email: 'ops@lastgrove.com', password: 'lastgrove-ops',
  });
  const opsAuth = { Authorization: 'Bearer ' + opsLogin.body.data.token };
  const opsSettings = await call('GET', '/api/v1/admin/settings', undefined, opsAuth);
  chk('ops 无 settings:write → 403', opsSettings.status === 403 &&
    opsSettings.body.error.code === 'FORBIDDEN', opsSettings.status);

  /* ---------- 6. 看板与订单管理 ---------- */
  section('6 看板与订单管理');
  const metrics = await call('GET', '/api/v1/admin/metrics?days=30', undefined, AUTH);
  chk('看板 200', metrics.status === 200);
  chk('含 GMV', typeof metrics.body.data.gmv === 'number', '$' + metrics.body.data.gmv);
  chk('含 30 天序列', metrics.body.data.series.length === 30);
  chk('含低库存清单', Array.isArray(metrics.body.data.lowStock));
  chk('含待发货数', typeof metrics.body.data.awaitingShipment === 'number', metrics.body.data.awaitingShipment);

  const orders = await call('GET', '/api/v1/admin/orders?limit=10', undefined, AUTH);
  chk('订单列表 200', orders.status === 200);
  chk('列表带分页元信息', orders.body.meta && orders.body.meta.total > 0, orders.body.meta.total + ' 单');

  const detail = await call('GET', '/api/v1/admin/orders/' + encodeURIComponent(order.number), undefined, AUTH);
  chk('订单详情 200', detail.status === 200);
  chk('返回允许的流转目标', Array.isArray(detail.body.data.allowedTransitions),
    detail.body.data.allowedTransitions.join(','));

  const badFlow = await call('PATCH', '/api/v1/admin/orders/' + encodeURIComponent(order.number) + '/status',
    { status: 'completed' }, AUTH);
  chk('paid 不能直接跳 completed', badFlow.status === 409 && badFlow.body.error.code === 'CONFLICT',
    badFlow.body.error && badFlow.error && badFlow.body.error.code);

  const shipFlow = await call('PATCH', '/api/v1/admin/orders/' + encodeURIComponent(order.number) + '/status',
    { status: 'fulfilled' }, AUTH);
  chk('paid → fulfilled 被拒（须先 fulfilling）', shipFlow.status === 409, shipFlow.status);

  const preparing = await call('PATCH', '/api/v1/admin/orders/' + encodeURIComponent(order.number) + '/status',
    { status: 'fulfilling' }, AUTH);
  chk('paid → fulfilling 成功', preparing.status === 200 && preparing.body.data.order.status === 'fulfilling');

  const refundDirect = await call('PATCH', '/api/v1/admin/orders/' + encodeURIComponent(order.number) + '/status',
    { status: 'refunded' }, AUTH);
  chk('禁止用状态接口退款', refundDirect.status === 422 &&
    refundDirect.body.error.code === 'USE_REFUND_ENDPOINT', refundDirect.body.error && refundDirect.body.error.code);

  /* ---------- 7. 退款回补 ---------- */
  section('7 退款副作用');
  const stockBeforeRefund = (await call('GET', '/api/v1/products/foxtrot-pendant-necklace'))
    .body.data.product.variants.find(v => v.metal === 'Gold').stock;
  const refund = await call('POST', '/api/v1/admin/orders/' + encodeURIComponent(order.number) + '/refund',
    { restock: true }, AUTH);
  chk('退款 200', refund.status === 200, refund.body.error && refund.body.error.message);
  chk('状态为 refunded', refund.body.data.order.status === 'refunded');
  chk('记录入库决策', refund.body.data.order.restockDecision === 'returned');
  chk('返回退款金额', refund.body.data.refunded === order.total, '$' + refund.body.data.refunded);

  const stockAfterRefund = (await call('GET', '/api/v1/products/foxtrot-pendant-necklace'))
    .body.data.product.variants.find(v => v.metal === 'Gold').stock;
  chk('库存已回补', stockAfterRefund === stockBeforeRefund + 2,
    stockBeforeRefund + ' → ' + stockAfterRefund);

  const refundAgain = await call('POST', '/api/v1/admin/orders/' + encodeURIComponent(order.number) + '/refund',
    {}, AUTH);
  chk('重复退款 409', refundAgain.status === 409, refundAgain.status);

  const ledger = await call('GET', '/api/v1/admin/stock-ledger?sku=LG-101-GO', undefined, AUTH);
  chk('库存流水有记录', ledger.body.data.length > 0, ledger.body.data.length + ' 条');
  chk('流水含 sale 与 refund', ledger.body.data.some(l => l.reason === 'sale') &&
    ledger.body.data.some(l => l.reason === 'refund'));

  /* ---------- 7b. 部分退款 ----------
     以前只能整单退：多件订单退一件，系统会把整单的钱退回去。
     这不是体验问题，是直接亏钱。这里盯三件事：
       ① 退一件只退一件的钱（含该行分摊的折扣）
       ② 税跟着行分摊退（退了货不退税收，等于替州里多吃一笔）
       ③ 退到最后一件时，运费与尾差要一起退掉，总额必须与整单退完全一致 */
  section('7b 部分退款');
  const qPart = await call('POST', '/api/v1/checkout/quote', {
    items: [
      { productId: 'LG-101', metal: 'Gold', qty: 2 },
      { productId: 'LG-102', metal: 'Silver', qty: 1 },
    ],
    couponCode: 'LASTGROVE10',
  });
  const oPart = await call('POST', '/api/v1/orders', {
    quoteId: qPart.body.data.quoteId,
    email: 'apitest@example.com', firstName: 'Api', lastName: 'Partial',
    address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'United States' },
  }, { 'Idempotency-Key': IDEM + '-partial' });
  chk('建一张多件订单', oPart.status === 201, oPart.body.error && oPart.body.error.message);
  const po = oPart.body.data.order;
  const pEnc = encodeURIComponent(po.number);
  const sku101 = po.items.find(i => i.productId === 'LG-101').sku;
  const sku102 = po.items.find(i => i.productId === 'LG-102').sku;

  /* 期望值：退款按「这一行已退累计数量」算，折扣按金额占比分摊。
     单件退 = 单价 - 单价分摊的折扣。测试这边独立推一遍，不拿服务端结果反算。 */
  const subC = Math.round(qPart.body.data.subtotal * 100);
  const discC = Math.round((qPart.body.data.discount || 0) * 100);
  const unit101 = po.items.find(i => i.productId === 'LG-101').unitPrice;
  const gross101 = Math.round(unit101 * 2 * 100);
  const discShare101 = Math.round(discC * gross101 / subC);
  const EXP_ONE_101 = Math.round((gross101 / 2 - discShare101 / 2)) / 100;

  const pStock0 = (await call('GET', '/api/v1/products/foxtrot-pendant-necklace'))
    .body.data.product.variants.find(v => v.metal === 'Gold').stock;
  const r1 = await call('POST', '/api/v1/admin/orders/' + pEnc + '/refund',
    { items: [{ sku: sku101, qty: 1 }] }, AUTH);
  chk('退一件 200', r1.status === 200, r1.body.error && r1.body.error.message);
  chk('退一件 = 单价 − 该件分摊的折扣', r1.body.data.refunded === EXP_ONE_101,
    '$' + r1.body.data.refunded + '（应为 $' + EXP_ONE_101 + '）');
  chk('订单没被标成整单退款', r1.body.data.fullyRefunded === false &&
    r1.body.data.order.status !== 'refunded', r1.body.data.order.status);
  chk('部分退款留痕', (r1.body.data.order.refunds || []).length === 1 &&
    r1.body.data.order.partiallyRefunded === true);

  const pStock1 = (await call('GET', '/api/v1/products/foxtrot-pendant-necklace'))
    .body.data.product.variants.find(v => v.metal === 'Gold').stock;
  chk('按件回补库存（不是整行）', pStock1 === pStock0 + 1, pStock0 + ' → ' + pStock1);

  const over = await call('POST', '/api/v1/admin/orders/' + pEnc + '/refund',
    { items: [{ sku: sku101, qty: 5 }] }, AUTH);
  chk('超量退款被拒 400', over.status === 400, over.status);

  const r2 = await call('POST', '/api/v1/admin/orders/' + pEnc + '/refund',
    { items: [{ sku: sku101, qty: 1 }, { sku: sku102, qty: 1 }] }, AUTH);
  chk('一次退多行 200', r2.status === 200, r2.body.error && r2.body.error.message);
  chk('累计退款 = 整单金额', r2.body.data.refundedTotal === po.total,
    '$' + r2.body.data.refundedTotal + ' / 订单 $' + po.total);
  chk('退完自动转 refunded', r2.body.data.fullyRefunded === true &&
    r2.body.data.order.status === 'refunded', r2.body.data.order.status);
  chk('退款流水累计 2 条', (r2.body.data.order.refunds || []).length === 2,
    (r2.body.data.order.refunds || []).length + ' 条');

  /* 退最后一件时运费要一起退：否则客户只买一件、退货后自己承担了运费 */
  const qShip = await call('POST', '/api/v1/checkout/quote', {
    items: [{ productId: 'LG-102', metal: 'Silver', qty: 1 }],
  });
  chk('小额订单确实收了运费', qShip.body.data.shipping > 0, '$' + qShip.body.data.shipping);
  const oShip = await call('POST', '/api/v1/orders', {
    quoteId: qShip.body.data.quoteId,
    email: 'apitest@example.com', firstName: 'Api', lastName: 'Ship',
    address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'United States' },
  }, { 'Idempotency-Key': IDEM + '-ship' });
  const so = oShip.body.data.order;
  const refundShip = await call('POST', '/api/v1/admin/orders/' +
    encodeURIComponent(so.number) + '/refund',
    { items: [{ sku: so.items[0].sku, qty: 1 }] }, AUTH);
  chk('退最后一件把运费一并退掉', refundShip.body.data.refunded === so.total,
    '$' + refundShip.body.data.refunded + ' / 订单 $' + so.total);

  /* ---------- 8. 商品与库存 ---------- */
  section('8 商品编辑与补货');
  const prods = await call('GET', '/api/v1/admin/products', undefined, AUTH);
  chk('后台商品列表 200', prods.status === 200 && prods.body.data.length === TOTAL_PRODUCTS,
    prods.body.data.length + ' / 目录 ' + TOTAL_PRODUCTS);
  const p0 = prods.body.data[0];

  const badPrice = await call('PATCH', '/api/v1/admin/products/' + p0.id, { price: -5 }, AUTH);
  chk('负价格被拒', badPrice.status === 400, badPrice.status);

  const belowCost = await call('PATCH', '/api/v1/admin/products/' + p0.id, { price: 0.5 }, AUTH);
  chk('低于成本价被拒', belowCost.status === 422 &&
    belowCost.body.error.code === 'PRICE_BELOW_COST', belowCost.body.error && belowCost.body.error.code);

  const newPrice = p0.price + 3;
  const priced = await call('PATCH', '/api/v1/admin/products/' + p0.id,
    { price: newPrice, version: p0.version }, AUTH);
  chk('改价成功', priced.status === 200 && priced.body.data.product.price === newPrice,
    '$' + p0.price + ' → $' + newPrice);
  chk('变体价同步', priced.body.data.product.variants.every(v => v.price === newPrice));
  chk('版本号递增', priced.body.data.product.version === p0.version + 1);

  const stale = await call('PATCH', '/api/v1/admin/products/' + p0.id,
    { price: newPrice + 1, version: p0.version }, AUTH);
  chk('过期版本号触发 409', stale.status === 409 && stale.body.error.code === 'CONFLICT', stale.status);

  const pdpAfter = await call('GET', '/api/v1/products/' + p0.handle);
  chk('前台立即看到新价格', pdpAfter.body.data.product.price === newPrice, pdpAfter.body.data.product.price);

  const sku = p0.variants[0].sku;
  const skuBefore = p0.variants[0].stock;
  const restock = await call('POST', '/api/v1/admin/products/' + p0.id + '/variants/' + sku + '/restock',
    { qty: 20, reason: 'purchase-order' }, AUTH);
  chk('补货成功', restock.status === 200 && restock.body.data.stock === skuBefore + 20,
    skuBefore + ' → ' + restock.body.data.stock);
  const ledger2 = await call('GET', '/api/v1/admin/stock-ledger?sku=' + sku, undefined, AUTH);
  chk('补货写流水', ledger2.body.data.some(l => l.reason === 'purchase-order'));

  /* ---------- 9. 设置与优惠券 ---------- */
  section('9 设置与优惠券');
  const settings = await call('GET', '/api/v1/admin/settings', undefined, AUTH);
  chk('设置 200', settings.status === 200 && settings.body.data.freeShip === 95);

  const patched = await call('PATCH', '/api/v1/admin/settings', { freeShip: 120 }, AUTH);
  chk('改免邮门槛成功', patched.status === 200 && patched.body.data.settings.freeShip === 120);
  const boot2 = await call('GET', '/api/v1/bootstrap');
  chk('前台立即同步门槛', boot2.body.data.settings.freeShippingThreshold === 120);
  await call('PATCH', '/api/v1/admin/settings', { freeShip: 95 }, AUTH);

  const newCoupon = await call('POST', '/api/v1/admin/coupons',
    { code: 'APITEST20', type: 'percent', value: 20, minSubtotal: 50, limit: 10 }, AUTH);
  chk('新建优惠码 201', newCoupon.status === 201, newCoupon.body.error && newCoupon.body.error.message);
  const dupCoupon = await call('POST', '/api/v1/admin/coupons',
    { code: 'APITEST20', type: 'percent', value: 10 }, AUTH);
  chk('重复码 409', dupCoupon.status === 409, dupCoupon.status);
  const badCoupon = await call('POST', '/api/v1/admin/coupons',
    { code: 'X', type: 'percent', value: 500 }, AUTH);
  chk('非法码被拒', badCoupon.status === 400, badCoupon.status);
  const delCoupon = await call('DELETE', '/api/v1/admin/coupons/APITEST20', undefined, AUTH);
  chk('删除优惠码 200', delCoupon.status === 200);

  /* ---------- 9b. 集合（A-06） ---------- */
  section('9b 集合管理');
  const cols = await call('GET', '/api/v1/admin/collections', undefined, AUTH);
  chk('集合列表 200', cols.status === 200 && Array.isArray(cols.body.data), (cols.body.data || []).length + ' 条');
  // 商品数是现算的：必须和商品身上挂的 handle 数一致
  const neckCol = (cols.body.data || []).find(c => c.handle === 'necklaces');
  const allProds = await call('GET', '/api/v1/products?limit=200');
  const expectCount = (allProds.body.data || []).filter(p => (p.collections || []).indexOf('necklaces') >= 0).length;
  chk('商品数现算与商品一致', neckCol && neckCol.productCount === expectCount, expectCount + ' 件');

  const newCol = await call('POST', '/api/v1/admin/collections',
    { title: 'API Test Collection', order: 99 }, AUTH);
  chk('新建集合 200', newCol.status === 200 && newCol.body.data.collection.handle === 'api-test-collection');
  const dupCol = await call('POST', '/api/v1/admin/collections', { title: 'API Test Collection' }, AUTH);
  chk('重名集合 409', dupCol.status === 409, dupCol.status);

  const hideCol = await call('PATCH', '/api/v1/admin/collections/api-test-collection', { nav: false, title: 'Renamed' }, AUTH);
  chk('改集合成功', hideCol.status === 200 && hideCol.body.data.collection.title === 'Renamed');
  const bootNav = await call('GET', '/api/v1/bootstrap');
  chk('关闭导航后前台菜单不含它',
    !(bootNav.body.data.nav || []).some(n => n.handle === 'api-test-collection'));

  // 有商品的集合不能删：删掉会让那个入口在前台静默消失
  const delUsed = await call('DELETE', '/api/v1/admin/collections/necklaces', undefined, AUTH);
  chk('非空集合拒删 409', delUsed.status === 409 && delUsed.body.error.code === 'COLLECTION_NOT_EMPTY', delUsed.status);
  const delEmpty = await call('DELETE', '/api/v1/admin/collections/api-test-collection', undefined, AUTH);
  chk('空集合可删 200', delEmpty.status === 200);

  /* ---------- 9c. 内容（A-08） ---------- */
  section('9c 内容管理');
  const ctDoc = await call('GET', '/api/v1/admin/content', undefined, AUTH);
  chk('内容 200 且含页面', ctDoc.status === 200 && Object.keys(ctDoc.body.data.pages || {}).length >= 8,
    Object.keys(ctDoc.body.data.pages || {}).length + ' 个内容页');

  const setTitle = await call('PATCH', '/api/v1/admin/content',
    { pages: { about: { title: 'Our story (edited)', intro: 'Edited intro.' } } }, AUTH);
  chk('改内容页标题 200', setTitle.status === 200 &&
    setTitle.body.data.pages.about.title === 'Our story (edited)');
  const bootPages = await call('GET', '/api/v1/bootstrap');
  chk('前台 bootstrap 已同步', bootPages.body.data.pages.about.title === 'Our story (edited)');
  const setHero = await call('PATCH', '/api/v1/admin/content',
    { content: { bestSellersEyebrow: 'As seen on API test' } }, AUTH);
  chk('改首页眉标 200', setHero.status === 200);
  const bootHero = await call('GET', '/api/v1/bootstrap');
  chk('首页眉标已同步', bootHero.body.data.settings.bestSellersEyebrow === 'As seen on API test');

  /* ---------- 9d. 定制需求单（A-12） ---------- */
  section('9d 定制需求单');
  const badReq = await call('POST', '/api/v1/custom-requests', { email: 'nope', notes: 'x' });
  chk('非法邮箱被拒 400', badReq.status === 400, badReq.status);
  const shortReq = await call('POST', '/api/v1/custom-requests', { email: 'a@b.co', notes: 'hi' });
  chk('描述过短被拒 400', shortReq.status === 400, shortReq.status);

  const mkReq = await call('POST', '/api/v1/custom-requests', {
    name: 'API Test', email: 'API@Example.com', style: 'Signet ring',
    qty: 2, notes: 'Please make a signet ring with a wave motif, size 7.',
    refUrls: ['https://example.com/ref.jpg', 'javascript:alert(1)'],
  });
  chk('提交定制需求 201', mkReq.status === 201, mkReq.body.data && mkReq.body.data.request.id);
  const reqId = mkReq.body.data && mkReq.body.data.request.id;
  chk('邮箱归一化为小写并入库', mkReq.body.data.request.status === 'new');

  const reqList = await call('GET', '/api/v1/admin/custom-requests', undefined, AUTH);
  const mine = (reqList.body.data || []).find(r => r.id === reqId);
  chk('后台可见该需求', !!mine);
  chk('邮箱小写去重', mine && mine.email === 'api@example.com', mine && mine.email);
  chk('非 http 参考链接被丢弃', mine && mine.refUrls.length === 1, mine && mine.refUrls.length);

  const q = await call('PATCH', '/api/v1/admin/custom-requests/' + reqId, { status: 'quoted', quote: 180 }, AUTH);
  chk('状态流转 new → quoted', q.status === 200 && q.body.data.request.status === 'quoted');
  const back = await call('PATCH', '/api/v1/admin/custom-requests/' + reqId, { status: 'new' }, AUTH);
  chk('状态不可回退 409', back.status === 409 && back.body.error.code === 'BAD_TRANSITION', back.status);

  /* ---------- 9e. 销售税 ----------
     这块的核心风险不是"算错"，而是"错收"：多收一笔税，退款比收钱难十倍，
     还要给州里做修正申报。所以断言重点在两处：
       1) 只对已注册的州收税，别的州一分不能收；
       2) 报价用的州和下单地址的州不一致时必须拒单，而不是将错就错。 */
  section('9e 销售税');
  const taxOn = await call('PATCH', '/api/v1/admin/settings',
    { tax: { enabled: true, rates: { California: '7.25' } } }, AUTH);
  chk('配置加州 7.25%（填百分数）', taxOn.status === 200 &&
    taxOn.body.data.settings.tax.rates.CA === 0.0725,
    JSON.stringify(taxOn.body.data.settings.tax && taxOn.body.data.settings.tax.rates));

  const oneItem = [{ productId: 'LG-101', metal: 'Gold', qty: 1 }];
  const qBase = await call('POST', '/api/v1/checkout/quote', { items: oneItem, state: 'CA' });
  /* 应税基数由服务端算（含运费与否取决于 shipTaxable），测试这边按
     "小计 - 折扣 + 运费" 独立推一遍，两边对上才算真的对。 */
  const caBase = Math.round((qBase.body.data.subtotal - (qBase.body.data.discount || 0) +
    qBase.body.data.shipping) * 100) / 100;
  const expCaTax = Math.round(caBase * 0.0725 * 100) / 100;
  chk('加州税率回传 0.0725', qBase.body.data.taxRate === 0.0725 && qBase.body.data.taxState === 'CA',
    qBase.body.data.taxState + ' @ ' + qBase.body.data.taxRate);
  chk('加州税额 = 应税基数 × 7.25%', qBase.body.data.tax === expCaTax,
    '$' + qBase.body.data.tax + '（应为 $' + expCaTax + '，基数 $' + caBase + '）');
  chk('合计 = 小计 - 折扣 + 运费 + 税',
    qBase.body.data.total === Math.round((qBase.body.data.subtotal - (qBase.body.data.discount || 0) +
      qBase.body.data.shipping + qBase.body.data.tax) * 100) / 100, qBase.body.data.total);

  const qName = await call('POST', '/api/v1/checkout/quote', { items: oneItem, state: 'California' });
  chk('州名 California 归一到 CA', qName.body.data.taxState === 'CA' && qName.body.data.tax === expCaTax,
    qName.body.data.taxState + ' / $' + qName.body.data.tax);
  const qOr = await call('POST', '/api/v1/checkout/quote', { items: oneItem, state: 'Oregon' });
  chk('未注册州（OR）不收税', !qOr.body.data.tax && qOr.body.data.taxState === 'OR',
    '$' + (qOr.body.data.tax || 0));

  const qNowhere = await call('POST', '/api/v1/checkout/quote', { items: oneItem, state: 'Atlantis' });
  chk('看不懂的州名既不收税也不报错', !qNowhere.body.data.tax && qNowhere.body.data.taxState === '',
    qNowhere.status + ' / "' + qNowhere.body.data.taxState + '"');

  /* 报价按 CA、地址按 NY：税额会变，必须拒单让前端重报，
     而不是按报价那笔收钱、按 NY 记账。 */
  const mismatched = await call('POST', '/api/v1/orders', {
    quoteId: qBase.body.data.quoteId,
    email: 'apitest@example.com', firstName: 'Tax', lastName: 'Mismatch',
    address: { line1: '1 Broadway', city: 'New York', state: 'NY', zip: '10001', country: 'United States' },
  }, { 'Idempotency-Key': IDEM + '-tax' });
  chk('报价州与收货州不一致被拒', mismatched.status === 422 &&
    mismatched.body.error.code === 'PRICE_CHANGED',
    mismatched.status + ' / ' + (mismatched.body.error && mismatched.body.error.code));

  const taxReport = await call('GET', '/api/v1/admin/tax/report', undefined, AUTH);
  chk('申报报表 200 且按州汇总', taxReport.status === 200 &&
    Array.isArray(taxReport.body.data.byState) && Array.isArray(taxReport.body.data.byMonth));
  const taxCsv = await call('GET', '/api/v1/admin/export/tax.csv', undefined, AUTH);
  chk('申报 CSV 可导出', taxCsv.status === 200);

  /* 恢复：测试跑完把税关掉，否则后面的订单会莫名其妙多出一笔税 */
  const taxOff = await call('PATCH', '/api/v1/admin/settings',
    { tax: { enabled: false, rates: {} } }, AUTH);
  chk('测试后恢复为关闭', taxOff.status === 200 && taxOff.body.data.settings.tax.enabled === false &&
    Object.keys(taxOff.body.data.settings.tax.rates).length === 0);

  /* ---------- 10. 错误与安全 ---------- */
  section('10 错误处理与安全');
  const notFound = await call('GET', '/api/v1/nope');
  chk('未知端点 404', notFound.status === 404 && notFound.body.error.code === 'NOT_FOUND');

  const wrongMethod = await call('DELETE', '/api/v1/products');
  chk('错误方法 405', wrongMethod.status === 405, wrongMethod.status);

  const badJson = await fetch(BASE + '/api/v1/cart/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops',
  });
  chk('坏 JSON 返回 400', badJson.status === 400, badJson.status);

  const travel = await call('GET', '/api/v1/products/..%2f..%2fserver%2fdata%2fdb.json');
  chk('目录穿越被挡', travel.status === 404, travel.status);

  const logout = await call('POST', '/api/v1/admin/logout', {}, AUTH);
  chk('登出 200', logout.status === 200);
  const afterLogout = await call('GET', '/api/v1/admin/metrics', undefined, AUTH);
  chk('登出后令牌失效', afterLogout.status === 401, afterLogout.status);

  /* ---------- 汇总 ---------- */
  console.log('\n' + '='.repeat(52));
  console.log('接口测试：通过 ' + pass + ' / ' + (pass + fail));
  if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('测试中断：', e);
  process.exit(1);
});
