/* ============================================================
   TIDEGLASS API · 接口自动化测试
   覆盖：健康检查 / 目录 / 筛选 / 详情 / 报价 / 下单 / 幂等 /
        查单 / 库存扣减 / 赠品 / 后台登录 / 权限 / 状态机 / 退款回补
   用法：node tools/api-test.js [baseUrl]
   ============================================================ */
'use strict';
const BASE = process.argv[2] || 'http://localhost:4600';

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
  chk('返回商品总数', health.body && health.body.data.products === 36, health.body && health.body.data.products);

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
  chk('商品详情 200', pdp.status === 200 && pdp.body.data.product.id === 'TG-101');
  chk('详情含评价', Array.isArray(pdp.body.data.reviews));
  chk('详情含关联推荐', pdp.body.data.related.length > 0, pdp.body.data.related.length + ' 款');

  const missing = await call('GET', '/api/v1/products/does-not-exist');
  chk('不存在的商品返回 404', missing.status === 404 && missing.body.error.code === 'NOT_FOUND');

  /* ---------- 2. 报价 ---------- */
  section('2 报价与定价规则');
  const items = [
    { productId: 'TG-101', metal: 'Gold', qty: 1 },
    { productId: 'TG-102', metal: 'Silver', qty: 1 },
  ];
  const q1 = await call('POST', '/api/v1/checkout/quote', { items });
  chk('报价 200', q1.status === 200, q1.body.error && q1.body.error.message);
  chk('返回 quoteId', /^Q[a-f0-9]{18}$/.test(q1.body.data.quoteId), q1.body.data.quoteId);
  chk('小计 = 82 + 76', q1.body.data.subtotal === 158, q1.body.data.subtotal);
  chk('满 $95 免标准运费', q1.body.data.shipping === 0, q1.body.data.shipping);
  chk('满 $120 带赠品', !!q1.body.data.gift, q1.body.data.gift && q1.body.data.gift.title);
  chk('合计 = 小计', q1.body.data.total === 158, q1.body.data.total);

  const qx = await call('POST', '/api/v1/checkout/quote', { items, shippingMethod: 'Express' });
  chk('Express 运费 $18', qx.body.data.shipping === 18, qx.body.data.shipping);

  const bogusPrice = await call('POST', '/api/v1/checkout/quote', {
    items: [{ productId: 'TG-101', metal: 'Gold', qty: 1, unitPrice: 1, lineTotal: 1 }],
  });
  chk('前端伪造价格被忽略', bogusPrice.body.data.subtotal === 82, bogusPrice.body.data.subtotal);

  const oos = await call('POST', '/api/v1/checkout/quote', {
    items: [{ productId: 'TG-101', metal: 'Gold', qty: 99 }],
  });
  chk('超量数量被拒（>10 限购）', oos.status === 422 && oos.body.error.code === 'CART_INVALID',
    oos.body.error && oos.body.error.code);

  const couponOk = await call('POST', '/api/v1/coupons/validate', { code: 'TIDEGLASS10', items });
  chk('优惠码校验 200', couponOk.status === 200);
  chk('10% 折扣 = 15.8', couponOk.body.data.discount === 15.8, couponOk.body.data.discount);

  const couponMin = await call('POST', '/api/v1/coupons/validate', {
    code: 'WELCOME15', items: [{ productId: 'TG-101', metal: 'Gold', qty: 1 }],
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
    items: [{ productId: 'TG-101', metal: 'Gold', qty: 2 }],
    couponCode: 'TIDEGLASS10',
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
  const created = await call('POST', '/api/v1/orders', payload, { 'Idempotency-Key': 'test-key-1' });
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

  const replay = await call('POST', '/api/v1/orders', payload, { 'Idempotency-Key': 'test-key-1' });
  chk('同幂等键重放不再建单', replay.status === 200 && replay.body.data.replayed === true &&
    replay.body.data.order.number === order.number, replay.body.data.order.number);

  const reuseQuote = await call('POST', '/api/v1/orders', payload, { 'Idempotency-Key': 'test-key-2' });
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
    email: 'owner@tideglassjewelry.com', password: 'wrong',
  });
  chk('错误密码 401', wrongPw.status === 401);

  const login = await call('POST', '/api/v1/admin/login', {
    email: 'owner@tideglassjewelry.com', password: 'tideglass2026',
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
    email: 'ops@tideglassjewelry.com', password: 'tideglass-ops',
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

  const ledger = await call('GET', '/api/v1/admin/stock-ledger?sku=TG-101-GO', undefined, AUTH);
  chk('库存流水有记录', ledger.body.data.length > 0, ledger.body.data.length + ' 条');
  chk('流水含 sale 与 refund', ledger.body.data.some(l => l.reason === 'sale') &&
    ledger.body.data.some(l => l.reason === 'refund'));

  /* ---------- 8. 商品与库存 ---------- */
  section('8 商品编辑与补货');
  const prods = await call('GET', '/api/v1/admin/products', undefined, AUTH);
  chk('后台商品列表 200', prods.status === 200 && prods.body.data.length === 36);
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
