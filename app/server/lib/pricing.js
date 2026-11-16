/* ============================================================
   LASTGROVE · 定价引擎（纯函数，无副作用）
   前台的每一次金额显示、结算页的每一行、订单里存的每一个数字，
   都必须经过这里。前端只做展示，不参与定价——这是「前后台同一份数据」
   在金额上的落地方式（FR-S-090 / BR-14）。
   ============================================================ */
'use strict';
const { E } = require('./http');
const { normalizeState } = require('./us-states');

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
      sku: v.sku,
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
  /* 顶层错误码跟随首条问题。原来一律抛 OUT_OF_STOCK，把「库存不够」说成「卖光了」，
     前端只看 error.message 时用户无感，但任何按 code 分支的调用方（含测试）都会走错。 */
  if (problems.length) throw E.unprocessable(problems[0].code, problems[0].message, problems);
}

/* 券的「真实状态」由事实推导，不信任存储的 status 字段。
   存储字段是人工写的快照：运营想停用会写 disabled，但「过期」和「发满」是随时间与用量
   自己发生的，没有人会回去把 status 改成 expired / exhausted。于是列表上会出现一张
   写着 active 的券，其实早就死了 —— 运营照着它做投放，客户拿到手却用不了。

   优先级（与客户视角一致）：
     expired  > disabled > exhausted > scheduled > active
   expired 排第一是有意的：客户看到 "expired" 知道是自己来晚了，
   看到 "not active" 会以为自己拿错了码，而实际上两者都可能成立。

   reasons 记录全部成立的原因，不丢信息：一张券可以既过期又发满，
   后台必须能同时看到这两件事，否则对不上账。 */
function couponState(c, now) {
  const t = now == null ? Date.now() : now;
  const reasons = [];

  /* status 只剩一个人工取值：disabled —— 运营手动关掉这张券。
     原来的 expired / scheduled 两个取值已废除：它们分别等价于
     "endsAt 已过" 与 "startsAt 未到"，人工再标一遍只会跟时间打架
     （改了日期忘改 status，两个字段互相打脸）。这两个状态一律由时间派生。

     这也是为什么不再有 PATCH 改 status 之外字段的必要：
     要停就 disabled，要改档期就改日期，各自只有一个入口。 */
  if (c.status === 'disabled') reasons.push('disabled');

  const ends = c.endsAt || c.expiresAt;
  const endsAt = ends
    ? new Date(String(ends).length === 10 ? ends + 'T23:59:59Z' : ends).getTime()
    : null;
  if (endsAt && endsAt < t) reasons.push('expired');

  if (typeof c.limit === 'number' && (c.used || 0) >= c.limit) reasons.push('exhausted');

  const startsAt = c.startsAt
    ? new Date(String(c.startsAt).length === 10 ? c.startsAt + 'T00:00:00Z' : c.startsAt).getTime()
    : null;
  if (startsAt && startsAt > t) reasons.push('scheduled');

  const order = ['expired', 'disabled', 'exhausted', 'scheduled'];
  let state = 'active';
  for (let i = 0; i < order.length; i++) {
    if (reasons.indexOf(order[i]) >= 0) { state = order[i]; break; }
  }
  return { state, reasons };
}

/* 优惠券校验。返回 { coupon } 或抛 422，错误码细分到原因，
   前端不需要自己拼文案。
   判定顺序与 couponState 完全一致 —— 两处各写一套是这套代码最容易走偏的地方：
   校验按 A 规则拒绝、列表按 B 规则展示，客户和运营看到的就是两个事实。 */
function resolveCoupon(db, code, subtotal) {
  if (!code) return null;
  const c = db.coupons.find(x => String(x.code).toUpperCase() === String(code).toUpperCase());
  if (!c) throw E.unprocessable('COUPON_NOT_FOUND', "That code isn't valid. Check the spelling and try again.");

  const st = couponState(c).state;
  if (st === 'expired') throw E.unprocessable('COUPON_EXPIRED', 'This code has expired.');
  /* disabled 有两种来源：运营主动停用，或提前作废（还没到期就不发了）。
     对客户来说都是"这个码不能用了"，所以文案用 available 而不是 active ——
     "no longer active" 会让昨天还用过的客户怀疑自己拿错了码。 */
  if (st === 'disabled') throw E.unprocessable('COUPON_INACTIVE', 'This code is no longer available.');
  if (st === 'exhausted') throw E.unprocessable('COUPON_EXHAUSTED', 'This code has reached its limit.');
  if (st === 'scheduled') throw E.unprocessable('COUPON_NOT_STARTED', 'This code is not active yet.');

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

/* 销售税。
   美国销售税是 destination-based：按**收货州**的税率代收。
   跨州卖家只有在某州达到经济门槛（nexus，各州 $100k~$500k 不等）后才有代收义务，
   所以这里不是"全州都收"，而是"rates 里配了税率的州才收"。
   没配的州一律 0 —— 宁可少收（可以事后补申报），不可错收（错收要退款，退比收难十倍）。

   税率由后台维护，因为州+地方的合并税率每年都变，写死在代码里等于半年后全是错的。
   没有按 ZIP 精确到地方税（那需要第三方税务服务），所以后台填的应当是
   该州的**加权平均合并税率**，并在申报时以实际税率为准。 */
function taxFor(db, taxableBase, state) {
  const t = (db.settings && db.settings.tax) || {};
  const base = round2(taxableBase || 0);
  if (!t.enabled) return { amount: 0, rate: 0, state: '', base };
  const code = normalizeState(state);
  if (!code) return { amount: 0, rate: 0, state: '', base };
  const rate = Number((t.rates || {})[code]) || 0;
  if (rate <= 0) return { amount: 0, rate: 0, state: code, base };
  return { amount: round2(base * rate), rate, state: code, base };
}

/* 完整定价。options.shippingMethod 缺省 Standard；options.state 是收货州。 */
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

  /* 运费是否计税各州不同（有的州计、有的不计），后台可切。
     缺省计税（多数州如此），漏收的风险大于多收 —— 多收的部分退给客户即可。 */
  const taxShip = !((db.settings.tax || {}).shipTaxable === false);
  const tax = taxFor(db, round2(afterDiscount + (taxShip ? shipping : 0)), opts.state);

  const total = round2(afterDiscount + shipping + tax.amount);

  return {
    lines,
    coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value, label: coupon.label || '' } : null,
    gift,
    subtotal,
    discount,
    afterDiscount,
    shippingMethod: method,
    shipping,
    tax: tax.amount,
    taxRate: tax.rate,
    taxState: tax.state,
    taxableBase: tax.base,
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
  normalizeItems, assertStock, couponState, resolveCoupon, discountFor, shippingFor, giftFor, taxFor, quote,
};
