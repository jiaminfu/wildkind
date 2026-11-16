/* ============================================================
   LASTGROVE · 结算与下单
   两条铁律：
   ① 金额只由服务端算，前端传来的任何价格字段一律丢弃；
   ② 报价（quote）锁定 15 分钟，超时或库存变动必须重新报价，
      避免「结算页 $214、实际扣 $238」。
   ============================================================ */
'use strict';
const crypto = require('crypto');
const store = require('../lib/store');
const pricing = require('../lib/pricing');
const { E, ok, rateLimit, clientIp } = require('../lib/http');
const payments = require('../lib/payments');
const notify = require('../lib/notify');

const QUOTE_TTL_MS = 15 * 60 * 1000;
const SUPPORTED_COUNTRIES = ['United States', 'Canada', 'United Kingdom'];

function nextOrderNumber(db) {
  db.sequences.order = (db.sequences.order || 1041);
  const n = db.sequences.order++;
  return '#LG' + n;
}

function ledger(db, entry) {
  db.stockLedger.push(Object.assign({
    id: 'L' + crypto.randomBytes(4).toString('hex'),
    createdAt: new Date().toISOString(),
  }, entry));
}

/* ------------------------------------------------------------
   落单：扣库存、写流水、记账、建客户档案、幂等登记，全部在单个事务里。
   抽成函数是因为支付通道有同步（mock）和异步（真实通道）两种收钱方式，
   但「怎么落一张订单」必须只有一份实现 —— 两份迟早会漂移。
   ctx: { fresh, customer, body, idem, quoteId, ref, status, statusLabel, payment }
   ------------------------------------------------------------ */
function buildOrder(d, ctx) {
  const fresh = ctx.fresh;
  const customer = ctx.customer;
  const b = ctx.body || {};
  const number = nextOrderNumber(d);

  // 扣库存 + 写流水（主单 + 赠品）
  const all = fresh.lines.concat(fresh.gift ? [fresh.gift] : []);
  all.forEach(l => {
    const p = pricing.findProduct(d, l.productId);
    const v = p && (p.variants || []).find(x => x.metal === l.metal);
    if (!v) return;
    v.stock = Math.max(0, v.stock - l.qty);
    p.stock = (p.variants || []).reduce((a, x) => a + x.stock, 0);
    if (!l.isGift) p.sold30 = (p.sold30 || 0) + l.qty;
    ledger(d, {
      sku: v.sku, productId: p.id, delta: -l.qty, reason: 'sale',
      refType: 'order', refId: number, balanceAfter: v.stock,
    });
  });

  if (fresh.coupon) {
    const cp = d.coupons.find(x => x.code.toUpperCase() === fresh.coupon.code.toUpperCase());
    if (cp) cp.used = (cp.used || 0) + 1;
  }

  /* 订单行必须带 sku：退款要按行退、库存流水要按 sku 记、仓库要按 sku 拣货。
     以前只存 productId + variant，退款时找不到具体是哪一件。 */
  const items = fresh.lines.map(l => ({
    productId: l.productId, sku: l.sku, title: l.title, variant: l.metal, size: l.size,
    unitPrice: l.unitPrice, qty: l.qty,
  }));
  if (fresh.gift) {
    items.push({
      productId: fresh.gift.productId, sku: fresh.gift.sku, title: fresh.gift.title,
      variant: fresh.gift.metal, size: '', unitPrice: 0, qty: fresh.gift.qty, isGift: true,
    });
  }

  const o = {
    number,
    email: customer.email,
    name: customer.first + ' ' + customer.last,
    status: ctx.status || 'paid',
    statusLabel: ctx.statusLabel || 'Paid',
    channel: 'Direct',
    orderType: 'sale',
    items,
    subtotal: fresh.subtotal,
    shipping: fresh.shipping,
    discount: fresh.discount,
    /* 销售税单独落三个字段，不要只把税混进 total。
       申报时要按州汇总，只有 total 的话以后一笔也算不出来。
       taxRate 存成交时的税率，不要读当前配置——税率改了之后，
       历史订单的税额必须还能对得上。 */
    tax: fresh.tax,
    taxRate: fresh.taxRate,
    taxState: fresh.taxState,
    total: fresh.total,
    address: customer.address,
    shippingMethod: fresh.shippingMethod,
    tracking: '',
    carrier: '',
    createdAt: new Date().toISOString(),
    note: String(b.note || '').slice(0, 500),
    couponCode: fresh.coupon ? fresh.coupon.code : '',
    gift: fresh.gift ? { sku: '', name: d.giftRule.name, value: d.giftRule.value || 0 } : null,
    payment: ctx.payment,
    /* ref 是支付通道与本地订单之间的关联键。真实通道的 webhook 回来时，
       订单号可能还没有（钱先到、单后落），所以两边都认这个值。 */
    payRef: ctx.ref || '',
    quoteId: ctx.quoteId,
  };
  d.orders.unshift(o);

  // 客户档案（邮箱小写比对）
  const exist = d.customers.find(x => String(x.email).toLowerCase() === customer.email);
  if (exist) {
    exist.orders = (exist.orders || 0) + 1;
    exist.spent = pricing.round2((exist.spent || 0) + o.total);
    exist.last = o.createdAt;
    exist.tier = exist.orders >= 3 ? 'VIP' : exist.orders >= 2 ? 'Repeat' : 'New';
  } else {
    d.customers.unshift({
      id: 'C' + String(d.customers.length + 1).padStart(3, '0'),
      email: customer.email,
      name: o.name,
      orders: 1, spent: o.total,
      first: o.createdAt, last: o.createdAt, tier: 'New',
    });
  }

  if (ctx.idem) {
    d.idempotency[ctx.idem] = { orderNumber: number, at: o.createdAt };
    const keys = Object.keys(d.idempotency);
    if (keys.length > 500) delete d.idempotency[keys[0]];
  }

  // 报价用掉即失效，防止同一报价被重复下单
  d.quotes = d.quotes.filter(x => x.id !== ctx.quoteId);
  return o;
}

function validateCustomerInfo(body) {
  const problems = [];
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    problems.push({ field: 'email', message: 'Enter a valid email address.' });
  }
  const first = String(body.firstName || body.first || '').trim();
  const last = String(body.lastName || body.last || '').trim();
  if (!first) problems.push({ field: 'firstName', message: 'First name is required.' });
  if (!last) problems.push({ field: 'lastName', message: 'Last name is required.' });
  const a = body.address || {};
  const line1 = String(a.line1 || '').trim();
  const city = String(a.city || '').trim();
  const state = String(a.state || '').trim();
  const zip = String(a.zip || '').trim();
  const country = String(a.country || 'United States').trim();
  if (!line1) problems.push({ field: 'address.line1', message: 'Street address is required.' });
  if (!city) problems.push({ field: 'address.city', message: 'City is required.' });
  if (!state) problems.push({ field: 'address.state', message: 'State / province is required.' });
  if (!zip) problems.push({ field: 'address.zip', message: 'ZIP / postcode is required.' });
  if (SUPPORTED_COUNTRIES.indexOf(country) < 0) {
    problems.push({ field: 'address.country', message: 'We currently ship to the US, Canada and the UK only.' });
  }
  if (problems.length) throw E.badRequest('Please check the highlighted fields.', problems);
  return { email, first, last, address: { line1, city, state, zip, country } };
}

function routes(router) {
  /* 购物车校验：加入购物车 / 打开购物车时都可以调，返回服务端价格 */
  router.post('/api/v1/cart/validate', (req, res) => {
    const db = store.get();
    const lines = pricing.normalizeItems(db, (req.body || {}).items);
    ok(res, {
      lines: lines.map(l => ({
        productId: l.productId, handle: l.handle, title: l.title,
        metal: l.metal, size: l.size, qty: l.qty,
        unitPrice: l.unitPrice, lineTotal: l.lineTotal, stock: l.stock,
      })),
      subtotal: pricing.round2(lines.reduce((a, l) => a + l.lineTotal, 0)),
      currency: db.settings.currency,
    });
  });

  router.post('/api/v1/coupons/validate', (req, res) => {
    const db = store.get();
    const b = req.body || {};
    const lines = pricing.normalizeItems(db, b.items || []);
    const subtotal = pricing.round2(lines.reduce((a, l) => a + l.lineTotal, 0));
    const c = pricing.resolveCoupon(db, b.code, subtotal);
    const discount = pricing.discountFor(c, subtotal);
    ok(res, {
      code: c.code, type: c.type, value: c.value,
      discount,
      subtotal,
      afterDiscount: pricing.round2(Math.max(0, subtotal - discount)),
    });
  });

  /* 报价：锁定价格、库存、运费、赠品。返回 quoteId 给前端。
     下单时必须带同一个 quoteId——这样「页面显示多少就收多少」。 */
  router.post('/api/v1/checkout/quote', (req, res) => {
    rateLimit('quote:' + clientIp(req), 60, 60 * 1000);
    const db = store.get();
    if (db.settings.storeOpen === false) {
      throw E.unprocessable('STORE_CLOSED', 'The store is not accepting orders right now.');
    }
    const b = req.body || {};
    const q = pricing.quote(db, b.items, {
      couponCode: b.couponCode || '',
      shippingMethod: b.shippingMethod || 'Standard',
      /* 收货州决定销售税。结算页在州填完后会带上来重新报价；
         没带就是 0 税（境外地址、或还没填），此时订单也不收税，两者一致。 */
      state: b.state || '',
    });
    const quote = {
      id: 'Q' + crypto.randomBytes(9).toString('hex'),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      shippingMethod: q.shippingMethod,
      couponCode: q.coupon ? q.coupon.code : '',
      lines: q.lines.map(l => ({
        productId: l.productId, title: l.title, metal: l.metal,
        size: l.size, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
      })),
      gift: q.gift,
      subtotal: q.subtotal,
      discount: q.discount,
      shipping: q.shipping,
      tax: q.tax,
      taxRate: q.taxRate,
      taxState: q.taxState,
      total: q.total,
    };
    db.quotes.push(quote);
    // 只保留最近 200 条报价，防止文件无限增长
    if (db.quotes.length > 200) db.quotes = db.quotes.slice(-200);
    store.flush();

    ok(res, {
      quoteId: quote.id,
      expiresAt: quote.expiresAt,
      lines: quote.lines,
      gift: quote.gift,
      subtotal: quote.subtotal,
      discount: quote.discount,
      shipping: quote.shipping,
      tax: quote.tax,
      taxRate: quote.taxRate,
      taxState: quote.taxState,
      total: quote.total,
      shippingMethod: quote.shippingMethod,
      couponCode: quote.couponCode,
      freeShipGap: q.freeShipGap,
      giftGap: q.giftGap,
      currency: q.currency,
      dutiesIncluded: true,
    });
  });

  /* 下单。幂等：同一个 Idempotency-Key 重复提交只产生一单。 */
  router.post('/api/v1/orders', async (req, res) => {
    rateLimit('order:' + clientIp(req), 20, 60 * 1000);
    const b = req.body || {};
    const idem = req.headers['idempotency-key'];
    const db = store.get();

    if (idem) {
      const hit = db.idempotency[idem];
      if (hit) {
        const prev = db.orders.find(o => o.number === hit.orderNumber);
        if (prev) return ok(res, { order: prev, replayed: true }, 200);
      }
    }

    const customer = validateCustomerInfo(b);
    const quote = db.quotes.find(q => q.id === b.quoteId);
    if (!quote) throw E.unprocessable('QUOTE_REQUIRED', 'Your cart needs to be priced again before checkout.');
    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      throw E.unprocessable('QUOTE_EXPIRED', 'Prices changed or the quote expired. Please review your bag.');
    }

    /* 重新校验库存与优惠券：报价是 15 分钟前的快照，这期间可能已被别人买走。
       不一致就要求重新报价，不静默改金额。

       税也在这里重算，而且**用订单上的收货州**，不信报价里那个：
       报价时的州是前端传的，可以被改；下单时的州来自地址表单，是要落库的那份。
       两者不一致（客户改过地址）就会触发下面的 PRICE_CHANGED，
       让他再确认一次金额 —— 这正是我们要的行为。 */
    const fresh = pricing.quote(db, quote.lines.map(l => ({
      productId: l.productId, metal: l.metal, size: l.size, qty: l.qty,
    })), {
      couponCode: quote.couponCode,
      shippingMethod: quote.shippingMethod,
      state: (customer.address || {}).state || '',
    });

    if (Math.abs(fresh.total - quote.total) > 0.005) {
      throw E.unprocessable('PRICE_CHANGED',
        'Your total changed since you last reviewed it. Please confirm the new total.',
        /* 把差额拆开告诉前端：是商品价变了、运费变了，还是刚加上税。
           只说「价格变了」，客户会以为涨价；明说是税，他知道这是按州代收。 */
        {
          quoted: quote.total, current: fresh.total, quoteId: quote.id,
          quotedTax: quote.tax || 0, currentTax: fresh.tax || 0,
          taxState: fresh.taxState || '',
        });
    }

    /* 支付会话。mock 通道同步返回「已付」；真实通道返回 clientSecret / 跳转链接，
       订单要等会话建好才落库。
       顺序不能反：先扣库存再建会话的话，会话创建失败（密钥错、金额低于卡组织门槛、
       通道超时）会留下「库存已扣减、订单挂着却永远收不到钱」的僵尸单，还得写回滚逻辑。 */
    const provider = payments.getProvider();
    if (!provider.isConfigured()) {
      throw E.unprocessable('PAYMENT_NOT_CONFIGURED',
        'Online payment is not available right now. Please contact us and we will take the order manually.');
    }

    const ref = 'RF' + crypto.randomBytes(8).toString('hex');
    const payCtx = {
      ref,
      amount: fresh.total,
      currency: 'USD',
      email: customer.email,
      last4: (b.payment || {}).last4,
      description: 'LASTGROVE \u00b7 ' + fresh.lines.reduce((n, l) => n + l.qty, 0) + ' item(s)',
      meta: { quoteId: quote.id },
    };

    if (provider.isAsync) {
      const session = await provider.createSession(payCtx);

      const order = store.tx(d => buildOrder(d, {
        fresh, customer, body: b, idem, quoteId: quote.id, ref,
        status: 'pending_payment', statusLabel: 'Awaiting payment',
        payment: session.payment,
      }));

      /* 202 而不是 201：订单已建、钱未到。客户端要拿 clientSecret 去挂支付组件，
         不能像 mock 那样直接跳成功页 —— 那等于把未付款订单当成已付。 */
      return ok(res, {
        order,
        payment: {
          provider: provider.id,
          mode: session.mode,
          clientSecret: session.clientSecret || '',
          approveUrl: session.approveUrl || '',
          sessionId: session.sessionId || '',
        },
      }, 202);
    }

    /* 同步通道（mock）：响应形状必须与接入支付抽象层之前逐字段一致，
       否则 200 多条接口用例会因为返回结构变化而集体失效。 */
    const session = await provider.createSession(payCtx);
    const order = store.tx(d => buildOrder(d, {
      fresh, customer, body: b, idem, quoteId: quote.id, ref,
      status: 'paid', statusLabel: 'Paid',
      payment: session.payment,
    }));

    /* 同步通道下单即到账，确认信在这里发。
       异步通道（PayPal 等）不走这里 —— 它的确认信在 capture 成功时才发，
       给「还没付钱」的客户发「付款成功」是比不发更糟的事。 */
    notify.orderConfirmed(order);

    ok(res, { order }, 201);
  });

  /* 访客查单：单号 + 邮箱，两者都对才返回（FR-S-141 / BR-20） */
  router.get('/api/v1/orders/lookup', (req, res) => {
    rateLimit('lookup:' + clientIp(req), 30, 60 * 1000);
    const db = store.get();
    const number = String(req.query.number || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!number || !email) {
      throw E.badRequest('Order number and email are both required.', [
        { field: 'number', message: !number ? 'Order number is required.' : undefined },
        { field: 'email', message: !email ? 'Email is required.' : undefined },
      ].filter(x => x.message));
    }
    const norm = number.charAt(0) === '#' ? number : '#' + number;
    const o = db.orders.find(x =>
      String(x.number).toUpperCase() === norm.toUpperCase() &&
      String(x.email).toLowerCase() === email);
    if (!o) throw E.notFound('We could not find an order with that number and email.');
    ok(res, { order: o });
  });

  router.get('/api/v1/orders/:number', (req, res) => {
    const db = store.get();
    const email = String(req.query.email || '').trim().toLowerCase();
    const o = db.orders.find(x => String(x.number).toUpperCase() === String(req.params.number).toUpperCase());
    if (!o) throw E.notFound('Order not found.');
    if (String(o.email).toLowerCase() !== email) throw E.notFound('Order not found.');
    ok(res, { order: o });
  });

  /* 访客取消：仅限未发货（paid / fulfilling），需邮箱验证 */
  router.post('/api/v1/orders/:number/cancel', (req, res) => {
    const db = store.get();
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const o = db.orders.find(x => String(x.number).toUpperCase() === String(req.params.number).toUpperCase());
    if (!o) throw E.notFound('Order not found.');
    if (String(o.email).toLowerCase() !== email) throw E.notFound('Order not found.');
    if (o.status !== 'paid' && o.status !== 'fulfilling') {
      throw E.conflict('This order has already shipped. Please use the return flow instead.');
    }
    const result = applyCancel(o);
    ok(res, { order: result });
  });
}

/* 取消/退款共用的状态回滚：库存回补 + 流水 + 释放券 + 冲减客户消费 */
function restockOrder(db, o, reason) {
  (o.items || []).forEach(it => {
    if (it.restocked) return;
    const p = pricing.findProduct(db, it.productId);
    if (!p) return;
    const v = (p.variants || []).find(x => x.metal === it.variant);
    if (v) {
      v.stock += it.qty;
      ledger(db, {
        sku: v.sku, productId: p.id, delta: it.qty, reason: reason,
        refType: 'order', refId: o.number, balanceAfter: v.stock,
      });
    }
    p.stock = (p.variants || []).reduce((a, x) => a + x.stock, 0);
    if (!it.isGift && p.sold30) p.sold30 = Math.max(0, p.sold30 - it.qty);
    it.restocked = true;
  });
}

function releaseCoupon(db, o) {
  if (!o.couponCode) return;
  const c = db.coupons.find(x => String(x.code).toUpperCase() === String(o.couponCode).toUpperCase());
  if (c) c.used = Math.max(0, (c.used || 0) - 1);
}

function adjustCustomer(db, o, sign) {
  const c = db.customers.find(x => String(x.email).toLowerCase() === String(o.email).toLowerCase());
  if (!c) return;
  c.orders = Math.max(0, (c.orders || 0) + sign);
  c.spent = Math.max(0, pricing.round2((c.spent || 0) + sign * o.total));
  c.tier = c.orders >= 3 ? 'VIP' : c.orders >= 2 ? 'Repeat' : 'New';
}

function applyCancel(o) {
  return store.tx(db => {
    restockOrder(db, o, 'cancelled');
    releaseCoupon(db, o);
    adjustCustomer(db, o, -1);
    o.status = 'cancelled';
    o.statusLabel = 'Cancelled';
    o.cancelledAt = new Date().toISOString();
    return o;
  });
}

/* ---------------- 部分退款 ----------------
   以前只能整单退。多件订单退一件，系统会把整单的钱退回去——这不是"体验差一点"，
   是直接亏钱，而且第一笔真实部分退货必然踩到。

   金额口径写死在这里，各处不许自己算：
     · 商品退款 = 该行成交金额（unitPrice × 退的数量，再扣掉这一行分摊的折扣）
     · 税退款   = 该行分摊的税额。退了货却不退税，等于替州里多吃了一笔
     · 运费     = 只有整单退完才退。部分退不退运费（这也是行业常规）

   分摊用「累计目标法」而不是「每次算增量」：
   按累计退掉的数量算出这一行"总共该退多少"，减去已经退过的，得到本次金额。
   同一行分三次退、每次 1 件，也不会有四舍五入攒出来的偏差。
   分摊永远用整数分算，最后一行吃余数——分毫不丢，也不多退一分。
*/
const toC = n => Math.round(Number(n || 0) * 100);
const toD = c => Math.round(c) / 100;

/* 把 totalC 按 weights 占比分到各行；余数给最后一个非零行 */
function splitByWeight(weights, totalC, weightSum) {
  const out = weights.map(() => 0);
  if (!totalC || !weightSum) return out;
  let lastIdx = -1;
  weights.forEach((w, i) => { if (w) lastIdx = i; });
  let acc = 0;
  weights.forEach((w, i) => {
    if (!w) return;
    if (i === lastIdx) { out[i] = totalC - acc; return; }
    out[i] = Math.round(totalC * w / weightSum);
    acc += out[i];
  });
  return out;
}

/* 每行的成交金额 / 折扣分摊 / 税分摊（全部以"分"为单位） */
function lineShares(o) {
  const items = o.items || [];
  const gross = items.map(it => toC(Number(it.unitPrice || 0) * Number(it.qty || 0)));
  const grossSum = gross.reduce((a, b) => a + b, 0);
  const discShare = splitByWeight(gross, toC(o.discount), grossSum);
  const net = gross.map((g, i) => g - discShare[i]);
  const netSum = net.reduce((a, b) => a + b, 0);
  const taxShare = splitByWeight(net, toC(o.tax), netSum);
  return { gross, discShare, taxShare };
}

function findLine(items, want) {
  if (want.sku) {
    const i = items.findIndex(it => String(it.sku) === String(want.sku));
    if (i >= 0) return i;
  }
  if (want.productId) {
    const i = items.findIndex(it => String(it.productId) === String(want.productId) &&
      (!want.variant || String(it.variant) === String(want.variant)));
    if (i >= 0) return i;
  }
  return -1;
}

/* 只回补指定数量。整单退用的是 restockOrder，这里按件退，两者不能混用：
   混用的后果是同一件货被回补两次，库存凭空多出来。 */
function restockLine(db, o, it, qty, reason) {
  const p = pricing.findProduct(db, it.productId);
  if (!p) return;
  const v = (p.variants || []).find(x => x.metal === it.variant);
  if (v) {
    v.stock += qty;
    ledger(db, {
      sku: v.sku, productId: p.id, delta: qty, reason: reason,
      refType: 'order', refId: o.number, balanceAfter: v.stock,
    });
    p.stock = (p.variants || []).reduce((a, x) => a + x.stock, 0);
  }
  if (!it.isGift && p.sold30) p.sold30 = Math.max(0, p.sold30 - qty);
}

function applyPartialRefund(o, opts) {
  const reqItems = (opts && opts.items) || [];
  if (!reqItems.length) throw E.badRequest('items[] is required for a partial refund.');
  const reason = String((opts && opts.reason) || '').slice(0, 200);
  const restock = !opts || opts.restock !== false;

  return store.tx(db => {
    const items = o.items || [];
    const shares = lineShares(o);
    o.refunds = Array.isArray(o.refunds) ? o.refunds : [];

    const picked = [];
    let amountC = 0, taxC = 0;

    reqItems.forEach(want => {
      const idx = findLine(items, want || {});
      if (idx < 0) {
        throw E.badRequest('Line not found: ' + ((want && (want.sku || want.productId)) || '?'),
          [{ field: 'items', message: 'No such line in this order.' }]);
      }
      const it = items[idx];
      const lineQty = Number(it.qty) || 0;
      const already = Number(it.refundedQty) || 0;
      const qty = Math.floor(Number(want.qty) || 0);
      if (qty <= 0) throw E.badRequest('qty must be a positive integer.');
      if (already + qty > lineQty) {
        throw E.badRequest('Only ' + (lineQty - already) + ' left to refund on "' +
          (it.title || it.sku) + '".',
          [{ field: 'items', message: 'qty exceeds remaining' }]);
      }

      /* 累计目标：这一行"一共该退多少" - "已经退过多少" = 本次 */
      const at = q => {
        if (!lineQty) return { net: 0, tax: 0 };
        const g = Math.round(shares.gross[idx] * q / lineQty);
        const d = Math.round(shares.discShare[idx] * q / lineQty);
        const t = Math.round(shares.taxShare[idx] * q / lineQty);
        return { net: g - d, tax: t };
      };
      const before = at(already);
      const after = at(already + qty);
      const thisNet = after.net - before.net;
      const thisTax = after.tax - before.tax;

      if (restock && !it.isGift) restockLine(db, o, it, qty, 'refund');
      it.refundedQty = already + qty;

      amountC += thisNet + thisTax;
      taxC += thisTax;
      picked.push({
        sku: it.sku, productId: it.productId, title: it.title,
        qty: qty, amount: toD(thisNet + thisTax), tax: toD(thisTax),
      });
    });

    /* 整单退完时把运费与尾差一起退掉：各行分摊之和 = 小计 - 折扣 + 税，
       差额正好是运费。这样"退最后一件"得到的总额与整单退完全一致。
       注意赠品行不参与判断——赠品是 0 元行，客户不会"退赠品"，
       把它算进来会导致货全退光了订单还挂在 paid 上。 */
    const paidLines = items.filter(it => !it.isGift);
    const allDone = paidLines.length > 0 &&
      paidLines.every(it => (Number(it.refundedQty) || 0) >= (Number(it.qty) || 0));
    if (allDone) {
      const remainderC = toC(o.total) - toC(o.refundedTotal) - amountC;
      if (remainderC > 0) amountC += remainderC;
    }

    const amount = toD(amountC);
    o.refundedTotal = toD(toC(o.refundedTotal) + amountC);
    o.refundedTax = toD(toC(o.refundedTax) + taxC);

    const refund = {
      id: 'R' + crypto.randomBytes(4).toString('hex'),
      at: new Date().toISOString(),
      amount: amount,
      restock: restock,
      reason: reason,
      items: picked,
    };

    if (allDone) {
      /* 整单退完：走完整回滚（释放券、客户单数 -1、状态改 refunded），
         与旧的整单退款行为保持一致，否则同一件事会有两种结果。 */
      o.refunds.push(refund);
      restockOrderLeftovers(db, o, 'refund');
      releaseCoupon(db, o);
      adjustCustomer(db, o, -1);
      o.status = 'refunded';
      o.statusLabel = 'Refunded';
      o.refundedAt = new Date().toISOString();
      o.refundAmount = toD(o.refundedTotal);
      o.restockDecision = restock ? 'returned' : 'written-off';
      o.partiallyRefunded = false;
    } else {
      /* 部分退：订单状态不动（货还在客户手里、单还没结束），只冲减消费额。
         注意不能 adjustCustomer(db,o,-1)——那会把"下过单"这件事也抹掉，
         客户的复购次数、VIP 分层会凭空掉一级。 */
      o.refunds.push(refund);
      adjustCustomerSpent(db, o, -amount);
      o.partiallyRefunded = true;
    }

    return {
      order: o,
      refunded: amount,
      refundedTotal: o.refundedTotal,
      fullyRefunded: allDone,
      restocked: restock,
    };
  });
}

/* 整单退完时，把还没回补的剩余件数补上（可能之前已经退过一部分）。
   赠品也一起补：下单时赠品是扣了库存的，整单退回来货也回来了，
   不补就会出现「库存少一件、账上找不到原因」。 */
function restockOrderLeftovers(db, o, reason) {
  (o.items || []).forEach(it => {
    const left = (Number(it.qty) || 0) - (Number(it.refundedQty) || 0);
    if (left > 0) {
      restockLine(db, o, it, left, reason);
      it.refundedQty = Number(it.qty) || 0;
    }
    it.restocked = true;
  });
}

function adjustCustomerSpent(db, o, delta) {
  const c = db.customers.find(x => String(x.email).toLowerCase() === String(o.email).toLowerCase());
  if (!c) return;
  c.spent = Math.max(0, pricing.round2((c.spent || 0) + delta));
}

function applyRefund(o, opts) {
  const b = opts || {};
  if (Array.isArray(b.items) && b.items.length) return applyPartialRefund(o, b);

  return store.tx(db => {
    const restock = b.restock !== false;
    /* 退款上限。不传 amount 时退「还没退的那部分」（部分退过之后整单退，只退剩下的）；
       传了 amount 就必须校验，否则运营手滑填 9999 会真的退 9999 —— 实测过，
       一张 $97.90 的单退 $9999 系统照收，refundedTotal 直接冲到 $10096.90。
       超过剩余额宁可报错也不静默截断：截断会让人以为退了 9999，实际退的是 remaining，
       月底对账时这笔差额没人认得出来。 */
    const remaining = toD(toC(o.total) - toC(o.refundedTotal));
    let amount;
    if (b.amount != null) {
      /* 传进来的是「元」，内部一律用「分」比较。这里踩过一次：直接 toD(9999) 得到 99.99，
         一笔 9999 元的退款被当成 99.99 元放过去了 —— 单位混用不会报错，只会算错。 */
      const want = toD(toC(b.amount));
      if (!Number.isFinite(want) || want <= 0) {
        throw E.badRequest('Refund amount must be greater than 0.');
      }
      if (toC(want) > toC(remaining)) {
        throw E.unprocessable('REFUND_EXCEEDS_REMAINING',
          'Refund cannot exceed the $' + remaining.toFixed(2) + ' still outstanding on this order.',
          { remaining: remaining, requested: want });
      }
      if (toC(want) < toC(remaining)) {
        /* 不带 items 的这条路径是「整单退」，只退一部分会让订单标成 refunded 但其实没收尾，
           客户、账、报表三处都会错。要退部分金额就明确传 items。 */
        throw E.unprocessable('REFUND_AMOUNT_MISMATCH',
          'This endpoint refunds the whole outstanding $' + remaining.toFixed(2) +
          '. To refund part of it, send items[].',
          { remaining: remaining, requested: want });
      }
      amount = want;
    } else {
      amount = remaining;
    }

    if (restock) restockOrder(db, o, 'refund');
    releaseCoupon(db, o);
    adjustCustomer(db, o, -1);
    o.status = 'refunded';
    o.statusLabel = 'Refunded';
    o.refundedAt = new Date().toISOString();
    o.refundAmount = amount;
    o.refundedTotal = toD(toC(o.refundedTotal) + toC(amount));
    o.restockDecision = restock ? 'returned' : 'written-off';
    o.partiallyRefunded = false;
    o.refunds = Array.isArray(o.refunds) ? o.refunds : [];
    o.refunds.push({
      id: 'R' + crypto.randomBytes(4).toString('hex'),
      at: o.refundedAt,
      amount: amount,
      restock: restock,
      reason: String(b.reason || '').slice(0, 200),
      items: (o.items || []).map(it => ({
        sku: it.sku, productId: it.productId, title: it.title,
        qty: Number(it.qty) || 0, amount: 0, tax: 0,
      })),
      full: true,
    });
    return {
      order: o, refunded: amount, refundedTotal: o.refundedTotal,
      fullyRefunded: true, restocked: restock,
    };
  });
}

module.exports = { routes, applyCancel, applyRefund, restockOrder, releaseCoupon, lineShares };
