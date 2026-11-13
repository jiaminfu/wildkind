/* ============================================================
   TIDEGLASS Web · 前端核心
   职责边界：
     · 只做展示与交互，不做定价决策（金额以 /checkout/quote 返回为准）
     · 购物车存 localStorage（访客可用），下单时提交给服务端复核
     · ui.js 复用原型的渲染层，这里提供它需要的 S 接口
   ============================================================ */
(function () {
  'use strict';

  var CART_KEY = 'tideglass_cart_v1';
  var COUPON_KEY = 'tideglass_coupon_v1';

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
    }
  };

  /* ---------------- 状态 ---------------- */
  var state = {
    boot: null,               // /bootstrap 结果
    cart: loadCart(),
    coupon: loadCoupon(),
    quote: null,              // 服务端最近一次报价
    lastOrder: loadJSON('tideglass_last_order', null),
    admin: loadJSON('tideglass_admin', null),
    checkout: {},
    toast: null
  };

  function loadJSON(k, dflt) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; }
    catch (e) { return dflt; }
  }
  function saveJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { }
  }
  function loadCart() { return loadJSON(CART_KEY, []) || []; }
  function loadCoupon() { return loadJSON(COUPON_KEY, null); }
  function persistCart() { saveJSON(CART_KEY, state.cart); }
  function persistCoupon() { saveJSON(COUPON_KEY, state.coupon); }

  /* ui.js 需要 S.DB 提供 settings / collections / giftRule；
     订单与评价只在后台外壳里用来显示角标，登录后再填。 */
  var DB = {
    settings: { content: {} },
    collections: [],
    products: [],
    giftRule: { threshold: 120, name: 'gift', value: 0 },
    orders: [],
    reviews: [],
  };

  function setBoot(boot) {
    state.boot = boot;
    DB.settings = Object.assign({
      content: {
        announce: boot.settings.announce,
        heroEyebrow: boot.settings.heroEyebrow,
        heroTitle: boot.settings.heroTitle,
        heroBody: boot.settings.heroBody,
      },
      freeShip: boot.settings.freeShippingThreshold,
      standardShip: boot.settings.standardShipping,
      expressShip: boot.settings.expressShipping,
    }, boot.settings);
    DB.collections = boot.collections;
    DB.pages = boot.pages || {};      // 内容页标题/导语的后台覆盖值（A-08）
    DB.giftRule = boot.giftRule || DB.giftRule;
  }

  /* ---------------- 购物车 ---------------- */
  function lineKey(l) { return l.productId + '|' + l.metal + '|' + (l.size || ''); }

  function addLine(p, metal, size, qty) {
    var v = (p.variants || []).filter(function (x) { return x.metal === metal; })[0];
    if (!v) return { ok: false, msg: 'That finish is unavailable.' };
    if (!v.inStock) return { ok: false, msg: 'That finish is out of stock.' };
    var key = lineKey({ productId: p.id, metal: metal, size: size });
    var ex = state.cart.filter(function (l) { return lineKey(l) === key; })[0];
    var want = (ex ? ex.qty : 0) + (qty || 1);
    if (want > v.stock) return { ok: false, msg: 'Only ' + v.stock + ' left in ' + metal + '.' };
    if (want > 10) return { ok: false, msg: 'Max 10 per item — email us for larger orders.' };
    if (ex) {
      ex.qty = want;
      ex.unitPrice = v.price;
      ex.stock = v.stock;
    } else {
      state.cart.push({
        productId: p.id, handle: p.handle, title: p.title,
        image: (p.images || [])[0] || '', metal: metal, size: size || '',
        qty: qty || 1, unitPrice: v.price, stock: v.stock,
      });
    }
    persistCart();
    return { ok: true };
  }

  function setQty(key, qty) {
    var line = state.cart.filter(function (l) { return lineKey(l) === key; })[0];
    if (!line) return;
    if (qty <= 0) {
      state.cart = state.cart.filter(function (l) { return lineKey(l) !== key; });
    } else {
      line.qty = Math.min(qty, line.stock || 99, 10);
    }
    persistCart();
  }

  function removeLine(key) {
    state.cart = state.cart.filter(function (l) { return lineKey(l) !== key; });
    persistCart();
  }

  function cartCount() { return state.cart.reduce(function (a, l) { return a + l.qty; }, 0); }

  function rawSubtotal() {
    return state.cart.reduce(function (a, l) { return a + l.unitPrice * l.qty; }, 0);
  }

  /* 本地估算：只用于抽屉和页头。
     结算页与订单金额一律取服务端报价，避免两套算法漂移。 */
  function totals() {
    var sub = rawSubtotal();
    var disc = 0;
    if (state.coupon) {
      disc = state.coupon.type === 'percent'
        ? sub * state.coupon.value / 100
        : Math.min(state.coupon.value, sub);
    }
    var after = Math.max(0, sub - disc);
    var s = DB.settings;
    var method = state.checkout.shipping || 'Standard';
    var ship = method === 'Express' ? (s.expressShip || 18)
      : (after >= (s.freeShip || 95) ? 0 : (s.standardShip || 6.9));
    var giftThreshold = (DB.giftRule && DB.giftRule.threshold) || 120;
    return {
      subtotal: sub, discount: disc, shipping: ship, total: after + ship,
      afterDiscount: after,
      freeShip: ship === 0,
      freeShipGap: Math.max(0, (s.freeShip || 95) - after),
      giftUnlocked: after >= giftThreshold,
      giftGap: Math.max(0, giftThreshold - after),
    };
  }

  function cartLines() {
    return state.cart.map(function (l) {
      return Object.assign({}, l, {
        key: lineKey(l), pid: l.productId,
        title: l.title, metal: l.metal, size: l.size,
        qty: l.qty, image: l.image, unitPrice: l.unitPrice,
        stock: l.stock, isGift: false,
      });
    });
  }

  function emptyCart() {
    state.cart = [];
    state.coupon = null;
    state.quote = null;
    persistCart();
    persistCoupon();
  }

  /* ---------------- 路由 ---------------- */
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
    /* 每段都要解码一次。
       路由参数是 encodeURIComponent 出来的（订单号含 #，不编码会把 hash 截断），
       这里不解码的话，下游再编码一次就成了 %2523TG1041，接口收到 %23TG1041，
       直接报 "Order not found" —— 表现是「点开订单详情打不开」。
       单段解码失败（有人手输了 %）不能连累整页，所以逐段兜底。 */
    var seg = h.split('/').filter(Boolean).map(function (x) {
      try { return decodeURIComponent(x); } catch (e) { return x; }
    });
    return { seg: seg, query: qs, path: h };
  }
  function go(path) { location.hash = '#' + path; }

  /* ---------------- 事件委托 ---------------- */
  var HANDLERS = { click: {}, submit: {}, change: {} };
  function onClick(sel, fn) { HANDLERS.click[sel] = fn; }
  function onSubmit(sel, fn) { HANDLERS.submit[sel] = fn; }
  function onChange(sel, fn) { HANDLERS.change[sel] = fn; }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (el) {
      var fn = HANDLERS.click[el.getAttribute('data-act')];
      if (fn) {
        var href = el.getAttribute('href');
        var isHashLink = el.tagName === 'A' && href && href.charAt(0) === '#';
        if (!isHashLink) e.preventDefault();
        fn(el, e);
        return;
      }
    }
    if (e.target.matches('[data-close-overlay]')) {
      document.body.classList.remove('drawer-open', 'search-open', 'menu-open');
    }
  });
  document.addEventListener('submit', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act && HANDLERS.submit[act]) {
      e.preventDefault();
      HANDLERS.submit[act](e.target, e);
    }
  });
  document.addEventListener('change', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act && HANDLERS.change[act]) HANDLERS.change[act](e.target, e);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.body.classList.remove('drawer-open', 'search-open', 'menu-open', 'filter-open');
  });

  /* ---------------- 提示 ---------------- */
  var toastTimer;
  function toast(msg, kind) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = msg;
    box.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 2600);
  }

  function navCollections() {
    return (state.boot && state.boot.nav) || [];
  }

  window.S = {
    U: U,
    get DB() { return DB; },
    state: state,
    setBoot: setBoot,
    navCollections: navCollections,
    cartLines: cartLines,
    cartCount: cartCount,
    totals: totals,
    lineKey: lineKey,
    addLine: addLine,
    setQty: setQty,
    removeLine: removeLine,
    emptyCart: emptyCart,
    rawSubtotal: rawSubtotal,
    persistCoupon: persistCoupon,
    parseHash: parseHash,
    go: go,
    onClick: onClick, onSubmit: onSubmit, onChange: onChange,
    toast: toast,
  };
})();
