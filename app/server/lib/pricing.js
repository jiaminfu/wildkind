/* ============================================================
   TIDEGLASS · 定价引擎（纯函数，无副作用）
   前台的每一次金额显示、结算页的每一行、订单里存的每一个数字，
   都必须经过这里。前端只做展示，不参与定价——这是「前后台同一份数据」
   在金额上的落地方式（FR-S-090 / BR-14）。
   ============================================================ */
'use strict';
const { E } = require('./http');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function findProduct(db, idOrHandle) {
  return db.products.find(p => p.id === idOrHandle || p.handle === idOrHandle) || null;
}

function findVariant(product, metal) {
  if (!product) return null;
  const vs = product.variants || [];
  if (metal) return vs.find(v => v.metal === metal) || null;
  return vs[0] || null;
}

/* 目录价：商品基础价与变体价若有漂移，以变体为准（变体才是可售单元） */
function unitPrice(product, metal) {
  const v = findVariant(product, metal);
  return v ? v.price : product.price;
}

function totalStock(product) {
  return (product.variants || []).reduce((a, v) => a + (v.stock || 0), 0);
}

/* 把前端传来的购物车行校验成服务端认可的形态。
   前端所有价格字段一律丢弃，只采信 pid / metal / size / qty。 */
function normalizeItems(db, items) {
  if (!Array.isArray(items) || !items.length) {
    throw E.badRequest('Cart is empty.', [{ field: 'items', message: 'At least one line is required.' }]);
  }
  if (items.length > 30) {
    throw E.badRequest('Too many lines in one order.', [{ field: 'items', message: 'Max 30 lines.' }]);
  }
  const out = [];
  const problems = [];
  items.forEach((raw, i) => {
    const p = findProduct(db, raw.productId || raw.pid || raw.handle);
    if (!p || !p.active) {
      problems.push({ index: i, code: 'PRODUCT_UNAVAILABLE', message: 'This item is no longer available.' });
      return;
    }
    const v = findVariant(p, raw.metal || raw.variant);
    if (!v) {
      problems.push({ index: i, code: 'VARIANT_UNAVAILABLE', message: p.title + ' — that finish is unavailable.' });
      return;
    }
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      problems.push({ index: i, code: 'INVALID_QTY', message: 'Quantity must be 1 or more.' });
      return;
    }
    if (qty > 10) {
      problems.push({ index: i, code: 'QTY_LIMIT', message: 'Max 10 per line — email us for larger orders.' });
      return;
    }
    out.push({
      productId: p.id,
      handle: p.handle,
      title: p.title,
      metal: v.metal,
      size: raw.size || '',
      qty,
      unitPrice: v.price,
      stock: v.stock,
      image: (p.images || [])[0] || '',
      lineTotal: round2(v.price * qty),
    });
  });
  if (problems.length) throw E.unprocessable('CART_INVALID', 'Some items need attention.', problems);
  return out;
}

/* 库存校验：整单拒绝，不做部分成交。
   部分成交会让用户收到一个自己没确认过的金额（BR-19）。 */
function assertStock(lines) {
  const problems = [];
  lines.forEach(l => {
    if (l.stock < l.qty) {
      problems.push({
        productId: l.productId,
        metal: l.metal,
        title: l.title,
        requested: l.qty,
        available: l.stock,
        code: l.stock > 0 ? 'INSUFFICIENT_STOCK' : 'OUT_OF_STOCK',
        message: l.stock > 0
          ? 'Only ' + l.stock + ' left in ' + l.metal + ' for ' + l.title + '.'
          : l.title + ' in ' + l.metal + ' just sold out.',
      });
    }
  });
  if (problems.length) throw E.unprocessable('OUT_OF_STOCK', problems[0].message, problems);
}

/* 优惠券校验。返回 { coupon } 或抛 422，错误码细分到原因，
   前端不需要自己拼文案。 */
function resolveCoupon(db, code, subtotal) {
  if (!code) return null;
  const c = db.coupons.find(x => String(x.code).toUpperCase() === String(code).toUpperCase());
  if (!c) throw E.unprocessable('COUPON_NOT_FOUND', "That code isn't valid. Check the spelling and try again.");
  // 过期优先于「未启用」：用户看到 "expired" 比 "not active" 更知道下一步做什么
  const ends = c.endsAt || c.expiresAt;
  const endsAt = ends ? new Date(String(ends).length === 10 ? ends + 'T23:59:59Z' : ends).getTime() : null;
  if (c.status === 'expired' || (endsAt && endsAt < Date.now())) {
    throw E.unprocessable('COUPON_EXPIRED', 'This code has expired.');
  }
  if (c.status === 'disabled') {
    throw E.unprocessable('COUPON_INACTIVE', 'This code is no longer active.');
  }
  const startsAt = c.startsAt ? new Date(String(c.startsAt).length === 10 ? c.startsAt + 'T00:00:00Z' : c.startsAt).getTime() : null;
  if (startsAt && startsAt > Date.now()) {
    throw E.unprocessable('COUPON_NOT_STARTED', 'This code is not active yet.');
  }
  if (c.status === 'scheduled' && !startsAt) {
    throw E.unprocessable('COUPON_INACTIVE', 'This code is no longer active.');
  }
  if (typeof c.limit === 'number' && c.used >= c.limit) {
    throw E.unprocessable('COUPON_EXHAUSTED', 'This code has reached its limit.');
  }
  if (subtotal < (c.minSubtotal || 0)) {
    throw E.unprocessable('COUPON_MIN_SUBTOTAL',
      'Add $' + round2(c.minSubtotal - subtotal).toFixed(2) + ' more to use this code.',
      { required: c.minSubtotal, current: round2(subtotal) });
  }
  return c;
}

function discountFor(coupon, subtotal) {
  if (!coupon) return 0;
  if (coupon.type === 'percent') return round2(subtotal * coupon.value / 100);
  return round2(Math.min(coupon.value, subtotal));
}

function shippingFor(db, method, afterDiscount) {
  const s = db.settings;
  if (method === 'Express') return round2(s.expressShip);
  return afterDiscount >= s.freeShip ? 0 : round2(s.standardShip);
}

/* 赠品：满额才送，缺货则静默不送（不能因为赠品挡住主单） */
function giftFor(db, afterDiscount) {
  const rule = db.giftRule;
  if (!rule || afterDiscount < rule.threshold) return null;
  const p = findProduct(db, rule.sku);
  if (!p) return null;
  const v = (p.variants || [])[0];
  if (!v || v.stock < (rule.maxPerOrder || 1)) return null;
  return {
    productId: p.id,
    sku: v.sku,
    title: (rule.name || p.title) + ' — Free gift',
    metal: v.metal,
    size: '',
    qty: rule.maxPerOrder || 1,
    unitPrice: 0,
    value: rule.value || 0,
    image: (p.images || [])[0] || '',   // 摘要里要显示缩略图，别让前端猜路径
  };
}

/* 完整定价。options.shippingMethod 缺省 Standard。 */
function quote(db, items, options) {
  const opts = options || {};
  const lines = normalizeItems(db, items);
  assertStock(lines);

  const subtotal = round2(lines.reduce((a, l) => a + l.lineTotal, 0));
  const coupon = opts.couponCode ? resolveCoupon(db, opts.couponCode, subtotal) : null;
  const discount = discountFor(coupon, subtotal);
  const afterDiscount = round2(Math.max(0, subtotal - discount));
  const method = opts.shippingMethod === 'Express' ? 'Express' : 'Standard';
  const shipping = shippingFor(db, method, afterDiscount);
  const gift = giftFor(db, afterDiscount);
  const total = round2(afterDiscount + shipping);

  return {
    lines,
    coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value, label: coupon.label || '' } : null,
    gift,
    subtotal,
    discount,
    afterDiscount,
    shippingMethod: method,
    shipping,
    total,
    giftGap: Math.max(0, round2(db.giftRule.threshold - afterDiscount)),
    freeShipGap: Math.max(0, round2(db.settings.freeShip - afterDiscount)),
    freeShip: shipping === 0,
    currency: db.settings.currency,
    dutiesIncluded: true,
  };
}

module.exports = {
  round2, findProduct, findVariant, unitPrice, totalStock,
  normalizeItems, assertStock, resolveCoupon, discountFor, shippingFor, giftFor, quote,
};
