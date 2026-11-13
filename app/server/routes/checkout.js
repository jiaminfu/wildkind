/* ============================================================
   TIDEGLASS · 结算与下单
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

const QUOTE_TTL_MS = 15 * 60 * 1000;
const SUPPORTED_COUNTRIES = ['United States', 'Canada', 'United Kingdom'];

function nextOrderNumber(db) {
  db.sequences.order = (db.sequences.order || 1041);
  const n = db.sequences.order++;
  return '#TG' + n;
}

function ledger(db, entry) {
  db.stockLedger.push(Object.assign({
    id: 'L' + crypto.randomBytes(4).toString('hex'),
    createdAt: new Date().toISOString(),
  }, entry));
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
  router.post('/api/v1/orders', (req, res) => {
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
       不一致就要求重新报价，不静默改金额。 */
    const fresh = pricing.quote(db, quote.lines.map(l => ({
      productId: l.productId, metal: l.metal, size: l.size, qty: l.qty,
    })), { couponCode: quote.couponCode, shippingMethod: quote.shippingMethod });

    if (Math.abs(fresh.total - quote.total) > 0.005) {
      throw E.unprocessable('PRICE_CHANGED',
        'Your total changed since you last reviewed it. Please confirm the new total.',
        { quoted: quote.total, current: fresh.total, quoteId: quote.id });
    }

    const order = store.tx(d => {
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
        const c = d.coupons.find(x => x.code.toUpperCase() === fresh.coupon.code.toUpperCase());
        if (c) c.used = (c.used || 0) + 1;
      }

      const items = fresh.lines.map(l => ({
        productId: l.productId, title: l.title, variant: l.metal, size: l.size,
        unitPrice: l.unitPrice, qty: l.qty,
      }));
      if (fresh.gift) {
        items.push({
          productId: fresh.gift.productId, title: fresh.gift.title,
          variant: fresh.gift.metal, size: '', unitPrice: 0, qty: fresh.gift.qty, isGift: true,
        });
      }

      const o = {
        number,
        email: customer.email,
        name: customer.first + ' ' + customer.last,
        status: 'paid',
        statusLabel: 'Paid',
        channel: 'Direct',
        orderType: 'sale',
        items,
        subtotal: fresh.subtotal,
        shipping: fresh.shipping,
        discount: fresh.discount,
        total: fresh.total,
        address: customer.address,
        shippingMethod: fresh.shippingMethod,
        tracking: '',
        carrier: '',
        createdAt: new Date().toISOString(),
        note: String(b.note || '').slice(0, 500),
        couponCode: fresh.coupon ? fresh.coupon.code : '',
        gift: fresh.gift ? { sku: '', name: d.giftRule.name, value: d.giftRule.value || 0 } : null,
        payment: {
          provider: 'stripe',
          mode: 'simulated',
          reference: 'sim_' + crypto.randomBytes(6).toString('hex'),
          last4: String((b.payment || {}).last4 || '4242').slice(-4),
        },
        quoteId: quote.id,
      };
      d.orders.unshift(o);

      // 客户档案（邮箱小写比对）
      const c = d.customers.find(x => String(x.email).toLowerCase() === customer.email);
      if (c) {
        c.orders = (c.orders || 0) + 1;
        c.spent = pricing.round2((c.spent || 0) + o.total);
        c.last = o.createdAt;
        c.tier = c.orders >= 3 ? 'VIP' : c.orders >= 2 ? 'Repeat' : 'New';
      } else {
        d.customers.unshift({
          id: 'C' + String(d.customers.length + 1).padStart(3, '0'),
          email: customer.email,
          name: o.name,
          orders: 1, spent: o.total,
          first: o.createdAt, last: o.createdAt, tier: 'New',
        });
      }

      if (idem) {
        d.idempotency[idem] = { orderNumber: number, at: o.createdAt };
        const keys = Object.keys(d.idempotency);
        if (keys.length > 500) delete d.idempotency[keys[0]];
      }

      // 报价用掉即失效，防止同一报价被重复下单
      d.quotes = d.quotes.filter(x => x.id !== quote.id);
      return o;
    });

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

function applyRefund(o, opts) {
  return store.tx(db => {
    const restock = !opts || opts.restock !== false;
    if (restock) restockOrder(db, o, 'refund');
    releaseCoupon(db, o);
    adjustCustomer(db, o, -1);
    o.status = 'refunded';
    o.statusLabel = 'Refunded';
    o.refundedAt = new Date().toISOString();
    o.refundAmount = opts && opts.amount != null ? opts.amount : o.total;
    o.restockDecision = restock ? 'returned' : 'written-off';
    return o;
  });
}

module.exports = { routes, applyCancel, applyRefund, restockOrder, releaseCoupon };
