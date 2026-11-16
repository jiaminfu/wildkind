/* ============================================================
   LASTGROVE Web · 前端核心
   职责边界：
     · 只做展示与交互，不做定价决策（金额以 /checkout/quote 返回为准）
     · 购物车存 localStorage（访客可用），下单时提交给服务端复核
     · ui.js 复用原型的渲染层，这里提供它需要的 S 接口
   ============================================================ */
(function () {
  'use strict';

  var CART_KEY = 'lastgrove_cart_v1';
  var COUPON_KEY = 'lastgrove_coupon_v1';
  var WISH_KEY = 'lastgrove_wish_v1';

  var U = {
    /* 价格显示遵循 DTC 惯例：整数不带小数（$48），有零头才显示两位（$48.50）。
       全线 $48.00 看起来像淘宝后台截图，和页面其他部分的气质不搭。 */
    money: function (n) {
      var v = Number(n) || 0;
      var s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
      return '$' + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
    /* 物流时间线用：同一天多条扫描记录，只给日期分不出先后，
       但加上年份又太啰嗦（包裹一般几天内就到）。 */
    fmtDateTime: function (iso) {
      var d = new Date(iso);
      if (isNaN(d)) return iso || '';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
        d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    },
    daysAgo: function (iso) {
      var d = new Date(iso);
      return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
    },
    /* 星级：半边星按 0.25 为界。
       以前只区分 on / 未加 on，而 CSS 里 .st 一律金色，空心和实心长得一模一样——
       0 条评价的商品照样显示五颗满星，等于骗人。现在由 CSS 区分空心与实心。 */
    stars: function (n) {
      var v = Math.max(0, Math.min(5, Number(n) || 0));
      var out = '';
      for (var i = 0; i < 5; i++) {
        var cls = (v - i) >= 0.75 ? 'on' : ((v - i) >= 0.25 ? 'half' : '');
        out += '<span class="' + cls + '">★</span>';
      }
      return out;
    },
    /* ---------------- 承运商与官方查询链接 ----------------
       本站没有自建轨迹页，客户点出去查是当前阶段唯一诚实的做法：
       单号真实存在，点进承运商官网一定查得到结果。
       兜底走 17TRACK 通用查询页，覆盖国际专线、以及承运商字段认不出的历史数据。
       URL 前缀都以 = 结尾，单号拼在最后并做 encodeURIComponent。 */
    carriers: [
      { code: 'USPS', label: 'USPS', url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' },
      { code: 'UPS', label: 'UPS', url: 'https://www.ups.com/track?tracknum=' },
      { code: 'FedEx', label: 'FedEx', url: 'https://www.fedex.com/fedextrack/?trknbr=' },
      { code: 'DHL', label: 'DHL Express', url: 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=' },
      { code: 'Canada Post', label: 'Canada Post', url: 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=' },
      { code: 'Royal Mail', label: 'Royal Mail', url: 'https://www.royalmail.com/track-your-item#/tracking-results/' },
      { code: 'Other', label: 'Other carrier', url: 'https://t.17track.net/en#nums=' }
    ],
    carrierUrl: function (carrier, no) {
      var n = String(no == null ? '' : no).trim();
      if (!n) return '';
      var want = String(carrier == null ? '' : carrier).trim().toLowerCase();
      var hit = null;
      for (var i = 0; i < U.carriers.length; i++) {
        if (U.carriers[i].code.toLowerCase() === want) { hit = U.carriers[i]; break; }
      }
      /* 认不出承运商就走通用查询，不拼一个必死的链接出来 */
      if (!hit) hit = U.carriers[U.carriers.length - 1];
      return hit.url + encodeURIComponent(n);
    },
    /* 把一个 opt 目录下的图片路径拆成 srcset 所需的信息。
       不是 opt 里的图（外链、运营临时填的地址）返回 null，调用方退回普通 img。
       两档宽度必须和 tools/opt-img2.js 里的 widthsFor() 保持一致。 */
    picParts: function (src) {
      var s = String(src == null ? '' : src);
      /* img.src 读出来永远是带 origin 的绝对地址（详情页换图时会走到这里），
         先剥掉同源前缀，否则下面认不出 assets/img/opt/ 这个特征。 */
      try {
        if (window.location && s.indexOf(window.location.origin) === 0) {
          s = s.slice(window.location.origin.length);
        }
      } catch (e) { }
      var m = /^(.*\/)?img\/opt\/([A-Za-z0-9_.-]+)\.(?:jpg|jpeg|png|webp)$/i.exec(s);
      if (!m) return null;
      var dir = (m[1] || '') + 'img/opt/';
      var base = m[2];
      var widths = /^hero-/.test(base) ? [700, 1100] : (/^c-/.test(base) ? [400, 820] : [440, 900]);
      return {
        dir: dir,
        base: base,
        widths: widths,
        set: widths.map(function (w) { return dir + base + '-' + w + '.webp ' + w + 'w'; }).join(', ')
      };
    },
    /* 响应式图片（D-111 / D-112）。
       库里存的是 assets/img/opt/<name>.jpg 这个「兜底档」（约 70–190KB），
       真正下发给浏览器的是同名两档 WebP + sizes 提示：手机上只下 440w 那档（12–30KB），
       桌面才取 900w。原始 PNG 是 1.2–3.3MB，一个商品列表页就能吃掉几十兆流量。 */
    pic: function (src, o) {
      o = o || {};
      var s = String(src == null ? '' : src);
      var alt = o.alt == null ? '' : o.alt;
      var cls = o.cls ? ' class="' + o.cls + '"' : '';
      var wh = (o.w && o.h) ? ' width="' + o.w + '" height="' + o.h + '"' : '';
      var load = o.priority ? ' fetchpriority="high"' : ' loading="lazy"';
      var extra = o.extra ? ' ' + o.extra : '';
      var p = U.picParts(s);
      if (!p) {
        return '<img src="' + U.esc(s) + '" alt="' + U.esc(alt) + '"' + wh + load +
          ' decoding="async"' + cls + extra + '>';
      }
      var sizes = o.sizes || '(max-width:640px) 46vw, (max-width:1024px) 31vw, 320px';
      var html = '<picture' + (o.defer ? ' data-defer="1"' : '') + '>' +
        '<source type="image/webp" srcset="' + p.set + '" sizes="' + sizes + '">' +
        '<img src="' + U.esc(s) + '" alt="' + U.esc(alt) + '"' + wh + load +
        ' decoding="async"' + cls + extra + '></picture>';
      /* defer：把真实地址降级成 data-*，浏览器不会去下载。
         首图之外的轮播图用它——用户不点圆点就永远用不上，白下 100 多 KB。 */
      if (o.defer) {
        html = html.replace(' srcset="', ' data-srcset="').replace('<img src="', '<img data-src="');
      }
      return html;
    }
  };

  /* ---------------- 状态 ---------------- */
  var state = {
    boot: null,               // /bootstrap 结果
    cart: loadCart(),
    coupon: loadCoupon(),
    wish: loadJSON(WISH_KEY, []) || [],   // 收藏的 handle 列表，访客也能用
    quote: null,              // 服务端最近一次报价
    lastOrder: loadJSON('lastgrove_last_order', null),
    admin: loadJSON('lastgrove_admin', null),
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
    function absorb(str) {
      str.split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        try { qs[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } catch (e) { }
      });
    }
    /* 支付通道回跳时常把参数挂在 hash 之前：
         https://site/?token=7AB123&PayerID=XYZ#/order/confirm
       （PayPal 就是把 token / PayerID 追加到 return_url 的问号段）
       只看 hash 的话回跳页读不到 token，会显示「Payment link incomplete」，
       而钱其实已经扣了 —— 所以先铺 location.search，再用 hash 上的覆盖。 */
    if (location.search) absorb(String(location.search).replace(/^\?/, ''));
    if (qi >= 0) {
      absorb(h.slice(qi + 1));
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
  /* ---------------- 跳转 ----------------
     加购后跳结算、登录后跳账户，都走这里。

     为什么不能一律 `location.hash = '#/x'`：
     博客是真路径页面（/journal/<slug>）。在那种页面上设置 hash 只会得到
     /journal/<slug>#/x —— 页面没有换，SPA 却以为已经在目标路由，
     表现为「点了跳转，什么都没发生」，刷新一次才对。
     所以先看当前 pathname：不在站点根目录就整页导航到 /#x。
     根目录下的行为与原来逐字节一致，不影响现有 hash 路由。 */
  function go(path) {
    var p = '';
    try { p = location.pathname; } catch (e) { }
    if (p && p !== '/' && p !== '/index.html') { location.href = '/#' + path; return; }
    location.hash = '#' + path;
  }

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
        /* 站内链接现在有两种写法，都要让浏览器自己处理默认行为：
             `#/x`    —— hash 页面里的常规写法
             `/#/x`   —— 带前导斜杠，在 /journal 这类真路径页面上点击才会整页导航，
                         否则会变成 /journal/x#/x，页面不换而 SPA 以为已经跳了
           这里原来只认 `#` 开头，改完 href 格式后，那个「关抽屉 + 靠 href 导航」
           的结账按钮被 preventDefault 拦掉，点了毫无反应。 */
        var isHashLink = el.tagName === 'A' && href &&
          (href.charAt(0) === '#' || href.indexOf('/#') === 0);
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

  /* ---------------- 收藏 ----------------
     头部心形图标原先链到 #/account/wishlist，但那条路由从未实现，
     点进去落到了「订单查询」页——图标说 Wishlist、页面是查单，很突兀。
     现在是真的能用了：存 localStorage，访客无需登录；商品从 /products?handles= 批量取。 */
  function wishHas(handle) {
    return state.wish.indexOf(handle) >= 0;
  }
  function wishToggle(handle) {
    var i = state.wish.indexOf(handle);
    if (i >= 0) state.wish.splice(i, 1);
    else state.wish.push(handle);
    saveJSON(WISH_KEY, state.wish);
    return i < 0;   // true = 刚加入
  }
  function wishCount() { return state.wish.length; }

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
    wishHas: wishHas, wishToggle: wishToggle, wishCount: wishCount,
    parseHash: parseHash,
    go: go,
    onClick: onClick, onSubmit: onSubmit, onChange: onChange,
    toast: toast,
  };
})();
