/* ============================================================
   TIDEGLASS 可交互原型 · 核心状态与业务逻辑
   数据存在 localStorage，刷新不丢；后台「设置」可一键重置
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'tideglass_proto_v4';

  var U = {
    money: function (n) {
      var v = Number(n) || 0;
      return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    money0: function (n) {
      var v = Number(n) || 0;
      return '$' + (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
    },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    fmtDate: function (iso) {
      var d = new Date(iso);
      if (isNaN(d)) return iso || '';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    fmtShort: function (iso) {
      var d = new Date(iso);
      if (isNaN(d)) return '';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    daysAgo: function (iso) {
      var d = new Date(iso);
      return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
    },
    stars: function (n) {
      var full = Math.floor(n), out = '';
      for (var i = 0; i < 5; i++) out += '<span class="' + (i < full ? 'on' : '') + '">★</span>';
      return out;
    },
    mo: function (n) { return n + (n === 1 ? ' month' : ' months'); },
    rnd: function (seed) {
      var s = seed;
      return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    }
  };

  /* ---------- 数据库 ---------- */
  var DB;
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function loadDB() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.products && d.products.length) return d;
      }
    } catch (e) { }
    return deepClone(window.SEED);
  }
  function saveDB() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { }
  }
  function resetDB() {
    DB = deepClone(window.SEED);
    saveDB();
    state.cart = [];
    state.coupon = null;
    state.lastOrder = null;
    state.admFilter = null;
    state.admProdQ = '';
    saveState();
  }

  DB = loadDB();

  /* ---------- 会话状态（购物车 / 优惠码 / 会话） ---------- */
  var state = {
    cart: [],      // {pid, sku, metal, size, qty}
    coupon: null,  // {code, type, value, minSubtotal}
    admin: false,
    checkoutStep: 1,
    checkoutData: {},
    checkoutPay: { method: 'card', cardNumber: '', expiry: '', cvc: '', err: '', state: 'idle' },
    lastOrder: null,
    toast: null,
    user: null,    // 已登录的用户对象；null 表示访客
    authErr: '',   // 登录/注册的即时错误文案
    addrEditing: null // 地址簿正在编辑的条目 id
  };

  function saveState() {
    try {
      localStorage.setItem(KEY + '_s', JSON.stringify({
        cart: state.cart, coupon: state.coupon, admin: state.admin,
        lastOrder: state.lastOrder, user: state.user
      }));
    } catch (e) { }
  }
  (function loadState() {
    try {
      var raw = localStorage.getItem(KEY + '_s');
      if (!raw) return;
      var s = JSON.parse(raw);
      state.cart = s.cart || [];
      state.coupon = s.coupon || null;
      state.admin = !!s.admin;
      state.lastOrder = s.lastOrder || null;
      state.user = s.user || null;
    } catch (e) { }
  })();

  /* ---------- 查询 ---------- */
  function product(id) { return DB.products.filter(function (p) { return p.id === id || p.handle === id; })[0]; }
  function coll(handle) { return DB.collections.filter(function (c) { return c.handle === handle; })[0]; }
  function navCollections() { return DB.collections.filter(function (c) { return c.nav && c.level === 1; }); }
  function productsIn(handle) {
    return DB.products.filter(function (p) { return p.active && p.collections.indexOf(handle) >= 0; });
  }
  function allProducts() { return DB.products.filter(function (p) { return p.active; }); }
  function variantsOf(p) { return p.variants || []; }
  function totalStock(p) { return (p.variants || []).reduce(function (a, v) { return a + v.stock; }, 0); }
  function reviewsOf(pid, onlyApproved) {
    return DB.reviews.filter(function (r) {
      return r.productId === pid && (!onlyApproved || r.status === 'approved');
    });
  }

  /* ---------- 购物车 ---------- */
  function lineKey(l) { return l.pid + '|' + l.metal + '|' + (l.size || ''); }

  function cartLines() {
    var out = [];
    state.cart.forEach(function (l) {
      var p = product(l.pid);
      if (!p) return;
      var v = (p.variants || []).filter(function (x) { return x.metal === l.metal; })[0] || p.variants[0];
      out.push({
        key: lineKey(l), pid: l.pid, handle: p.handle, title: p.title,
        metal: l.metal, size: l.size || '', qty: l.qty,
        image: p.images[0],
        unitPrice: v ? v.price : p.price,
        stock: v ? v.stock : p.stock,
        isGift: false
      });
    });
    // 赠品
    var t = totals();
    if (t.giftUnlocked) {
      var gl = giftLine();
      if (gl) out.push(gl);
    }
    return out;
  }

  /* 满额赠品行。原来这里把 stock 写死 99，等于赠品不占库存、可以无限送；
     且 placeOrder 用 filter(!isGift) 把赠品行整个丢掉，赠品从未真正进过订单。
     现在统一走这个函数：库存取真实值，下单时按同一份数据扣减。 */
  function giftLine() {
    if (!DB.giftRule) return null;
    var g = product(DB.giftRule.sku) || DB.products.filter(function (p) { return p.cat === 'earrings'; })[0];
    if (!g) return null;
    var v = (g.variants || [])[0] || null;
    return {
      key: 'gift', pid: g.id, handle: g.handle,
      title: (DB.giftRule.name || g.title) + ' — Free gift',
      metal: v ? v.metal : 'Silver', size: '', qty: 1,
      image: g.images[0], unitPrice: 0,
      stock: v ? v.stock : 0, isGift: true
    };
  }

  function cartCount() {
    return state.cart.reduce(function (a, l) { return a + l.qty; }, 0);
  }

  function couponError(code) {
    var c = DB.coupons.filter(function (x) { return x.code.toUpperCase() === String(code).toUpperCase(); })[0];
    if (!c) return { ok: false, msg: "That code isn't valid. Check the spelling and try again." };
    if (c.status === 'expired') return { ok: false, msg: 'This code has expired.' };
    if (c.used >= c.limit) return { ok: false, msg: 'This code has reached its limit.' };
    var sub = rawSubtotal();
    if (sub < c.minSubtotal) return { ok: false, msg: 'Add ' + U.money(c.minSubtotal - sub) + ' more to use this code.' };
    return { ok: true, coupon: c };
  }

  function lineUnit(l) {
    var p = product(l.pid);
    if (!p) return 0;
    var v = (p.variants || []).filter(function (x) { return x.metal === l.metal; })[0] || p.variants[0];
    return v ? v.price : p.price;
  }

  function rawSubtotal() {
    var sub = 0;
    state.cart.forEach(function (l) { sub += lineUnit(l) * l.qty; });
    return sub;
  }

  function totals() {
    var sub = rawSubtotal();
    var disc = 0;
    if (state.coupon) {
      if (state.coupon.type === 'percent') disc = sub * state.coupon.value / 100;
      else disc = Math.min(state.coupon.value, sub);
    }
    var afterDisc = Math.max(0, sub - disc);
    var method = state.checkoutData.shipping || 'Standard';
    var freeShip = afterDisc >= DB.settings.freeShip;
    var ship = 0;
    if (method === 'Express') ship = DB.settings.expressShip;
    else ship = freeShip ? 0 : DB.settings.standardShip;
    return {
      subtotal: sub, discount: disc, shipping: ship,
      total: afterDisc + ship,
      afterDiscount: afterDisc,
      freeShip: freeShip,
      freeShipGap: Math.max(0, DB.settings.freeShip - afterDisc),
      giftUnlocked: afterDisc >= (DB.giftRule.threshold || 120),
      giftGap: Math.max(0, (DB.giftRule.threshold || 120) - afterDisc)
    };
  }

  function addToCart(pid, metal, size, qty) {
    var p = product(pid);
    if (!p) return { ok: false, msg: 'Product not found' };
    var v = (p.variants || []).filter(function (x) { return x.metal === metal; })[0];
    if (!v || v.stock < 1) return { ok: false, msg: 'That finish is out of stock.' };
    var ex = state.cart.filter(function (l) {
      return l.pid === pid && l.metal === metal && (l.size || '') === (size || '');
    })[0];
    var want = (ex ? ex.qty : 0) + (qty || 1);
    if (want > v.stock) {
      return { ok: false, msg: 'Only ' + v.stock + ' left in ' + metal + '.' };
    }
    if (ex) ex.qty = want;
    else state.cart.push({ pid: pid, metal: metal, size: size || '', qty: qty || 1 });
    saveState();
    return { ok: true };
  }

  function setQty(key, qty) {
    var line = null;
    state.cart.forEach(function (l) { if (lineKey(l) === key) line = l; });
    if (!line) return;
    if (qty <= 0) {
      state.cart = state.cart.filter(function (l) { return lineKey(l) !== key; });
    } else {
      var p = product(line.pid);
      var v = (p.variants || []).filter(function (x) { return x.metal === line.metal; })[0];
      line.qty = Math.min(qty, v ? v.stock : 99, 10);
    }
    saveState();
  }

  function removeLine(key) {
    state.cart = state.cart.filter(function (l) { return lineKey(l) !== key; });
    saveState();
  }

  function emptyCart() {
    state.cart = [];
    state.coupon = null;
    saveState();
  }

  /* ---------- 下单 ---------- */
  /* 单号必须唯一且单调。
     原来写 1041 + DB.orders.length：① 下单后长度+1 只在本页有效，刷新又从长度算起，
     删一单再下一单会直接撞号；② 取消订单不删记录但历史数据被重置时同样撞号。
     改为每次从现有单号里解析最大数字再 +1，与订单数量无关。 */
  function nextOrderNumber() {
    var max = 1040;
    DB.orders.forEach(function (o) {
      var m = /(\d+)\s*$/.exec(String(o.number || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return '#TG' + (max + 1);
  }

  function placeOrder(info) {
    var lines = cartLines().filter(function (l) { return !l.isGift; });
    if (!lines.length) return { ok: false, msg: 'Your bag is empty.' };

    /* ① 库存二次校验。
       加入购物车时校验过库存，但结算可能隔了几分钟乃至换设备重新打开，
       期间库存已被别人买走。原实现直接 Math.max(0, stock - qty)，
       结果是超卖成 0 库存但订单照收。这里整单拒绝，不做部分成交——
       部分成交会让用户收到一个自己没确认过的金额。 */
    var short = null;
    lines.forEach(function (l) {
      var p = product(l.pid);
      var v = p && (p.variants || []).filter(function (x) { return x.metal === l.metal; })[0];
      if (!v || v.stock < l.qty) {
        var have = v ? v.stock : 0;
        if (!short || have < short.have) {
          short = { title: p ? p.title : l.title, metal: l.metal, want: l.qty, have: have };
        }
      }
    });
    if (short) {
      return {
        ok: false,
        code: 'OUT_OF_STOCK',
        msg: short.have > 0
          ? 'Only ' + short.have + ' left in ' + short.metal + ' for ' + short.title + '. Please update your bag.'
          : short.title + ' in ' + short.metal + ' just sold out. Please update your bag.'
      };
    }

    /* ② 优惠券二次校验。
       门槛与用量是在「应用优惠码」那一刻校验的；之后用户可能减了数量、
       或者别人刚好用完了最后一张。原实现下单时不再检查，
       等于减到 $30 还能继续享受满 $60 的折扣。 */
    if (state.coupon) {
      var chk = couponError(state.coupon.code);
      if (!chk.ok) {
        state.coupon = null;
        saveState();
        return {
          ok: false,
          code: 'COUPON_INVALID',
          msg: chk.msg + ' The code has been removed — please review your total.'
        };
      }
    }

    /* ③ 配送方式与运费必须同源。
       原实现运费读 state.checkoutData.shipping，订单字段读 info.shipping，
       两处若不一致，会出现「订单写 Standard、运费按 Express 收」。 */
    var method = info.shipping || state.checkoutData.shipping || 'Standard';
    state.checkoutData.shipping = method;
    var t = totals();

    /* ④ 赠品作为 0 元行真正写入订单，并扣它的库存。 */
    var gift = null;
    if (t.giftUnlocked && DB.giftRule) {
      var gl = giftLine();
      if (gl && gl.stock >= (DB.giftRule.maxPerOrder || 1)) {
        gift = gl;
      } else if (gl) {
        gift = null;  // 赠品缺货就静默不送，不能因此挡住主单
      }
    }

    var items = lines.map(function (l) {
      return {
        productId: l.pid, title: l.title, variant: l.metal, size: l.size,
        unitPrice: l.unitPrice, qty: l.qty
      };
    });
    if (gift) {
      items.push({
        productId: gift.pid, title: gift.title, variant: gift.metal, size: '',
        unitPrice: 0, qty: 1, isGift: true
      });
    }

    var order = {
      number: nextOrderNumber(),
      email: String(info.email || '').trim().toLowerCase(),
      name: ((info.first || '') + ' ' + (info.last || '')).trim(),
      status: 'paid',
      statusLabel: 'Paid',
      channel: 'Direct',
      items: items,
      subtotal: Math.round(t.subtotal * 100) / 100,
      shipping: Math.round(t.shipping * 100) / 100,
      discount: Math.round(t.discount * 100) / 100,
      total: Math.round(t.total * 100) / 100,
      address: {
        line1: info.line1, city: info.city, state: info.state,
        zip: info.zip, country: info.country || 'United States'
      },
      shippingMethod: method,
      tracking: '',
      carrier: '',
      createdAt: new Date().toISOString(),
      note: info.note || '',
      couponCode: state.coupon ? state.coupon.code : '',
      gift: gift ? { sku: (product(gift.pid).variants[0] || {}).sku || '', name: DB.giftRule.name, value: DB.giftRule.value || 0 } : null
    };

    // 扣库存（主单 + 赠品）
    items.forEach(function (it) {
      var p = product(it.productId);
      if (!p) return;
      var v = (p.variants || []).filter(function (x) { return x.metal === it.variant; })[0];
      if (v) v.stock = Math.max(0, v.stock - it.qty);
      p.stock = (p.variants || []).reduce(function (a, x) { return a + x.stock; }, 0);
      if (!it.isGift) p.sold30 = (p.sold30 || 0) + it.qty;
    });

    DB.orders.unshift(order);

    // 客户档案：邮箱统一小写比对，避免 A@x.com 与 a@x.com 记成两个人
    var key = order.email;
    var c = DB.customers.filter(function (x) { return String(x.email || '').toLowerCase() === key; })[0];
    if (c) {
      c.orders++; c.spent = Math.round((c.spent + order.total) * 100) / 100;
      c.last = order.createdAt;
      c.tier = c.orders >= 3 ? 'VIP' : c.orders >= 2 ? 'Repeat' : 'New';
    } else {
      DB.customers.unshift({
        id: 'C' + String(DB.customers.length + 1).padStart(3, '0'),
        email: order.email,
        name: order.name,
        orders: 1, spent: order.total,
        first: order.createdAt, last: order.createdAt, tier: 'New'
      });
    }

    if (state.coupon) {
      DB.coupons.forEach(function (x) {
        if (x.code.toUpperCase() === state.coupon.code.toUpperCase()) x.used++;
      });
    }

    saveDB();
    state.lastOrder = order;
    emptyCart();
    return { ok: true, order: order };
  }

  /* ---------- 退款 / 取消（统一出口） ---------- */
  /* 原实现只把 status 改成 refunded，四件事都没做：
     ① 库存不回补 → 退回来的货变成不存在；② 优惠码用量不释放 → 券越用越少；
     ③ 客户消费额不减 → LTV 与复购率虚高；④ 没有退款时间与入库决策记录。
     这里收成一个函数，后台所有「退款 / 取消」都走它。 */
  function restockItems(o) {
    (o.items || []).forEach(function (it) {
      if (it.restocked) return;
      var p = product(it.productId);
      if (!p) return;
      var v = (p.variants || []).filter(function (x) { return x.metal === it.variant; })[0];
      if (v) v.stock += it.qty;
      p.stock = (p.variants || []).reduce(function (a, x) { return a + x.stock; }, 0);
      if (!it.isGift && p.sold30) p.sold30 = Math.max(0, p.sold30 - it.qty);
      it.restocked = true;
    });
  }

  function releaseCoupon(o) {
    if (!o.couponCode) return;
    DB.coupons.forEach(function (c) {
      if (String(c.code).toUpperCase() === String(o.couponCode).toUpperCase()) {
        c.used = Math.max(0, (c.used || 0) - 1);
      }
    });
  }

  function adjustCustomer(o, sign) {
    var key = String(o.email || '').toLowerCase();
    var c = DB.customers.filter(function (x) { return String(x.email || '').toLowerCase() === key; })[0];
    if (!c) return;
    c.orders = Math.max(0, c.orders + sign);
    c.spent = Math.max(0, Math.round((c.spent + sign * o.total) * 100) / 100);
    c.tier = c.orders >= 3 ? 'VIP' : c.orders >= 2 ? 'Repeat' : 'New';
  }

  function refundOrder(number, opts) {
    var o = DB.orders.filter(function (x) { return x.number === number; })[0];
    if (!o) return { ok: false, msg: 'Order not found' };
    if (o.status === 'refunded') return { ok: false, msg: 'Already refunded' };
    opts = opts || {};
    var restock = opts.restock !== false;     // 默认入库；写损则传 false
    if (restock) restockItems(o);
    releaseCoupon(o);
    adjustCustomer(o, -1);
    o.status = 'refunded';
    o.statusLabel = 'Refunded';
    o.refundedAt = new Date().toISOString();
    o.restockDecision = restock ? 'returned' : 'written-off';
    o.refundAmount = opts.amount != null ? opts.amount : o.total;
    saveDB();
    return { ok: true, order: o };
  }

  function cancelOrder(number) {
    var o = DB.orders.filter(function (x) { return x.number === number; })[0];
    if (!o) return { ok: false, msg: 'Order not found' };
    if (o.status === 'cancelled') return { ok: false, msg: 'Already cancelled' };
    if (o.status === 'refunded') return { ok: false, msg: 'Refunded orders cannot be cancelled' };
    restockItems(o);
    releaseCoupon(o);
    adjustCustomer(o, -1);
    o.status = 'cancelled';
    o.statusLabel = 'Cancelled';
    o.cancelledAt = new Date().toISOString();
    saveDB();
    return { ok: true, order: o };
  }

  /* ---------- 路由 ---------- */
  function parseHash() {
    var h = (location.hash || '#/').replace(/^#/, '');
    if (!h) h = '/';
    var qi = h.indexOf('?');
    var qs = {};
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        qs[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      h = h.slice(0, qi);
    }
    var seg = h.split('/').filter(Boolean);
    return { seg: seg, query: qs, path: h };
  }

  function go(path) { location.hash = '#' + path; }

  /* ---------- 全局事件委托 ---------- */
  var HANDLERS = { click: {}, submit: {} };
  function onClick(sel, fn) { HANDLERS.click[sel] = fn; }
  function onSubmit(sel, fn) { HANDLERS.submit[sel] = fn; }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (el) {
      var act = el.getAttribute('data-act');
      var fn = HANDLERS.click[act];
      if (fn) {
        // 带 data-act 的 <a href="#/..."> 必须放行浏览器默认行为。
        // 否则 hash 不会变、不会触发 hashchange，页面停在原地 —— 抽屉里的
        // Checkout 按钮就是这样「点了没反应」的。
        var href = el.getAttribute('href');
        var isHashLink = el.tagName === 'A' && href && href.charAt(0) === '#';
        if (!isHashLink) e.preventDefault();
        fn(el, e);
        return;
      }
    }
    // 关闭遮罩
    if (e.target.matches('[data-close-overlay]')) {
      document.body.classList.remove('drawer-open', 'search-open');
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    var act = form.getAttribute('data-act');
    if (act && HANDLERS.submit[act]) {
      e.preventDefault();
      HANDLERS.submit[act](form, e);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.body.classList.remove('drawer-open', 'search-open');
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      openSearch();
    }
  });

  function openSearch() {
    document.body.classList.add('search-open');
    var i = document.getElementById('searchInput');
    if (i) setTimeout(function () { i.focus(); }, 40);
  }

  /* ---------- 提示 ---------- */
  var toastTimer;
  function toast(msg, kind) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = msg;
    box.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 2600);
  }

  window.S = {
    U: U, get DB() { return DB; }, state: state,
    product: product, coll: coll, productsIn: productsIn, allProducts: allProducts,
    navCollections: navCollections, variantsOf: variantsOf, totalStock: totalStock,
    reviewsOf: reviewsOf, cartLines: cartLines, cartCount: cartCount, totals: totals,
    addToCart: addToCart, setQty: setQty, removeLine: removeLine, emptyCart: emptyCart,
    couponError: couponError, placeOrder: placeOrder, saveDB: saveDB, saveState: saveState,
    refundOrder: refundOrder, cancelOrder: cancelOrder, giftLine: giftLine,
    resetDB: resetDB, parseHash: parseHash, go: go, onClick: onClick, onSubmit: onSubmit,
    toast: toast, openSearch: openSearch
  };
})();
