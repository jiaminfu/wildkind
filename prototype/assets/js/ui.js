/* ============================================================
   TIDEGLASS · 共用 UI 组件
   ============================================================ */
(function () {
  'use strict';
  var U = S.U;

  var ICON = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    bag: '<path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    left: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
    shield: '<path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    leaf: '<path d="M5 19c0-8 6-13 14-14 1 8-4 15-13 15H5z"/><path d="M5 19l7-7"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    filter: '<path d="M3 6.5h18M6.5 12h11M10 17.5h4"/>',
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".9" fill="currentColor"/>',
    pinterest: '<circle cx="12" cy="12" r="9"/><path d="M9.5 21l2.2-8"/><path d="M9 11c0-2.2 1.6-3.6 3.5-3.6 2 0 3.3 1.2 3.3 3.2 0 2.4-1.3 4.2-3 4.2-.9 0-1.6-.7-1.4-1.6"/>',
    tiktok: '<path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 4c.4 2.4 1.9 3.9 4.2 4.2"/>',
    star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z"/>',
    box: '<path d="M3 8l9-4 9 4v8l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v8"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16v4z"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    filter: '<path d="M3 6h18M7 12h10M10 18h4"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.2A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>',
    heartFull: '<path d="M12 20s-7-4.4-7-9.2A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.8C19 15.6 12 20 12 20z" fill="currentColor"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/>',
    logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h9"/>'
  };

  function icon(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || '') + '</svg>';
  }

  var MARK = '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">' +
    '<circle cx="60" cy="60" r="51" stroke="currentColor" stroke-width="3"/>' +
    '<circle cx="60" cy="35" r="3.2" fill="currentColor"/>' +
    '<path d="M25 70C35 54 47 54 57 62C67 70 81 70 95 53" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>' +
    '<path d="M25 86C35 70 47 70 57 78C67 86 81 86 95 69" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/>' +
    '</svg>';

  var NAV_ORDER = ['best-sellers', 'custom', 'sale', 'new', 'necklaces', 'rings', 'pearls', 'earrings', 'bracelets', 'anklets', 'gifts'];

  function navItems() {
    var list = S.navCollections().slice();
    list.sort(function (a, b) {
      var ia = NAV_ORDER.indexOf(a.handle), ib = NAV_ORDER.indexOf(b.handle);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib;
    });
    return list;
  }

  // 公告栏文案来自后台 Content 页（settings.content.announce），按 · 切段
  function announcement() {
    var s = (S.DB.settings && S.DB.settings.content) || {};
    var txt = s.announce || 'Free shipping over $95';
    return txt.split('·').map(function (t) {
      t = t.trim();
      return t ? '<span>' + U.esc(t) + '</span>' : '';
    }).join('<span>·</span>') + '<span>·</span>';
  }

  // 品类项带 mega menu（FR-S-002）。面板按集合的 parent 关系动态生成，不写死清单
  var MEGA = { necklaces: 1, rings: 1, pearls: 1, earrings: 1, bracelets: 1, anklets: 1 };
  var MOTIFS = ['ocean', 'woodland', 'celestial', 'floral'];
  var GIFT_SETS = ['for-her', 'for-him', 'gifts-for-mom', 'birthday-gifts', 'gift-sets'];

  function collTitle(h) {
    var c = (S.DB.collections || []).filter(function (x) { return x.handle === h; })[0];
    return c ? c.title : h.replace(/-/g, ' ');
  }

  function megaPanel(handle, right) {
    var kids = (S.DB.collections || []).filter(function (c) { return c.parent === handle; });
    var col1 = kids.length ? kids.map(function (c) {
      return '<a href="#/collections/' + c.handle + '">' + U.esc(c.title) + '</a>';
    }).join('') : '<a href="#/collections/' + handle + '">All ' + U.esc(collTitle(handle)) + '</a>';
    var col2 = MOTIFS.map(function (m) {
      return '<a href="#/collections/' + m + '">' + U.esc(collTitle(m)) + '</a>';
    }).join('');
    var col3 = GIFT_SETS.map(function (h) {
      return '<a href="#/collections/' + h + '">' + U.esc(collTitle(h)) + '</a>';
    }).join('');
    return '<div class="mega' + (right ? ' mega--right' : '') + '">' +
      '<div class="mega__col"><h6>Shop by style</h6>' + col1 + '</div>' +
      '<div class="mega__col"><h6>Shop by motif</h6>' + col2 + '</div>' +
      '<div class="mega__col"><h6>Gifts</h6>' + col3 + '</div>' +
      '<a class="mega__feat" href="#/collections/' + handle + '">' +
      '<img src="assets/img/opt/hero-necklaces.jpg" alt="">' +
      '<span>Shop all ' + U.esc(collTitle(handle)) + '</span></a>' +
      '</div>';
  }

  function header(r) {
    // 当前所在的集合（#/collections/<handle>）用于给导航项加选中态
    var seg = (r && r.seg) || [];
    var cur = seg[0] === 'collections' ? (seg[1] || '') : '';
    var nav = navItems().map(function (c, i) {
      var k = [];
      if (c.handle === 'sale') k.push('hot');
      if (c.handle === cur) k.push('is-active');
      var cls = k.length ? ' class="' + k.join(' ') + '"' : '';
      var label = c.handle === 'new' ? 'New in' : c.title;
      var link = '<a href="#/collections/' + c.handle + '"' + cls +
        (c.handle === cur ? ' aria-current="page"' : '') + '>' + U.esc(label) + '</a>';
      if (!MEGA[c.handle]) return link;
      return '<div class="navitem">' + link + megaPanel(c.handle, i >= 7) + '</div>';
    }).join('');

    return '' +
      '<div class="annbar"><div class="annbar__track">' +
      announcement() +
      announcement() +
      '</div></div>' +
      '<header class="hdr" id="hdr"><div class="wrap"><div class="hdr__inner">' +
      '<button class="mob-menu-btn" data-act="open-menu" aria-label="Menu">' + icon('menu') + '</button>' +
      '<nav class="hdr__nav">' + nav + '</nav>' +
      '<a href="#/" class="brand" aria-label="TIDEGLASS home"><span class="brand__mark" aria-hidden="true">' + MARK + '</span><span class="brand__word">TIDEGLASS</span></a>' +
      '<div class="hdr__tools">' +
      '<button class="icon-btn" data-act="open-search" aria-label="Search">' + icon('search') + '</button>' +
      '<a class="icon-btn hdr__acct" href="#/account" aria-label="Account">' + icon('user') + '</a>' +
      '<a class="icon-btn" href="#/account/wishlist" aria-label="Wishlist" id="wishBtn">' + icon('heart') + '</a>' +
      (function () {
        var u = S.state.user;
        if (u) {
          return '<a class="hdr__me" href="#/account">Hello, <b>' + U.esc(u.first) + '</b></a>';
        }
        return '<a class="hdr__signin" href="#/account/login">Sign in</a>';
      })() +
      '<button class="icon-btn" data-act="open-cart" aria-label="Bag">' + icon('bag') + '<span class="bag-count' + (S.cartCount() ? '' : ' is-zero') + '" id="bagCount">' + S.cartCount() + '</span></button>' +
      '</div></div></div></header>';
  }

  function footer() {
    return '<footer class="ftr"><div class="wrap">' +
      '<div class="ftr__top">' +
      '<div class="ftr__brand"><a href="#/" class="brand" aria-label="TIDEGLASS home"><span class="brand__mark" aria-hidden="true">' + MARK + '</span><span class="brand__word">TIDEGLASS</span></a>' +
      '<p>316L stainless steel with PVD colour. Sea glass doesn\'t fade — and neither do we.</p>' +
      '<div style="display:flex;gap:14px;margin-top:18px">' +
      '<a href="#/pages/about" aria-label="Instagram">' + icon('instagram') + '</a>' +
      '<a href="#/pages/about" aria-label="Pinterest">' + icon('pinterest') + '</a>' +
      '<a href="#/pages/about" aria-label="TikTok">' + icon('tiktok') + '</a>' +
      '</div></div>' +
      '<div><h5>Shop</h5><ul>' +
      '<li><a href="#/collections/best-sellers">Best Sellers</a></li>' +
      '<li><a href="#/collections/new">New Arrivals</a></li>' +
      '<li><a href="#/collections/necklaces">Necklaces</a></li>' +
      '<li><a href="#/collections/bracelets">Bracelets</a></li>' +
      '<li><a href="#/collections/anklets">Anklets</a></li>' +
      '<li><a href="#/collections/sale">Sale</a></li></ul></div>' +
      '<div><h5>Help</h5><ul>' +
      '<li><a href="#/pages/shipping">Shipping &amp; Duties</a></li>' +
      '<li><a href="#/pages/returns">Returns</a></li>' +
      '<li><a href="#/pages/care">Care Guide</a></li>' +
      '<li><a href="#/pages/size-guide">Size Guide</a></li>' +
      '<li><a href="#/account/lookup">Track My Order</a></li>' +
      '<li><a href="#/pages/faq">FAQ</a></li></ul></div>' +
      '<div><h5>About</h5><ul>' +
      '<li><a href="#/pages/about">Our Story</a></li>' +
      '<li><a href="#/pages/materials">Materials</a></li>' +
      '<li><a href="#/pages/contact">Contact</a></li>' +
      '<li><a href="#/admin">Admin</a></li></ul></div>' +
      '</div>' +
      '<div class="ftr__bot"><span>© 2026 TIDEGLASS. All rights reserved.</span>' +
      '<div class="ftr__pay"><span>VISA</span><span>MC</span><span>AMEX</span><span>APPLE PAY</span><span>G PAY</span><span>SHOP PAY</span></div>' +
      '<span>Privacy · Terms · Accessibility</span></div>' +
      '</div></footer>';
  }

  function productCard(p, opts) {
    opts = opts || {};
    var v = p.variants[0] || { price: p.price, metal: 'Gold' };
    var save = p.compareAt ? (p.compareAt - p.price) : 0;
    var badge = '';
    if (p.badge === 'Best Seller') badge = '<span class="card__badge">Best Seller</span>';
    else if (save > 0) badge = '<span class="card__badge sale">Save ' + U.money0(save) + '</span>';
    else if (p.createdAt && U.daysAgo(p.createdAt) < 40) badge = '<span class="card__badge new">New</span>';

    var sw = p.variants.map(function (x) {
      var cls = x.metal === 'Gold' ? 'gold' : x.metal === 'Silver' ? 'silver' : 'rose';
      return '<i class="' + cls + '" title="' + x.metal + '"></i>';
    }).join('');
    // 色点从图片右上角挪到标题下：压在图上既挡商品，又和左上角角标抢位置；
    // 单色商品不显示这一行（只有一个点等于没信息，纯占位）。
    var swRow = p.variants.length > 1
      ? '<div class="card__swrow">' + sw + '<span>' + p.variants.map(function (x) { return U.esc(x.metal); }).join(' / ') + '</span></div>'
      : '';

    return '<article class="card">' +
      '<a class="card__media" href="#/products/' + p.handle + '">' +
      '<img src="' + p.images[0] + '" alt="' + U.esc(p.title) + '" loading="lazy">' +
      (p.images[1] ? '<img class="alt" src="' + p.images[1] + '" alt="" loading="lazy">' : '') +
      badge + '</a>' +
      '<div class="card__body">' +
      '<a class="card__title" href="#/products/' + p.handle + '">' + U.esc(p.title) + '</a>' +
      swRow +
      '<div class="card__rate"><span class="st">' + U.stars(p.rating) + '</span>' + p.rating + ' (' + p.reviewCount + ')</div>' +
      '<div class="card__price"><b>' + U.money(v.price) + '</b>' +
      (p.compareAt ? '<s>' + U.money(p.compareAt) + '</s><em>SAVE ' + U.money0(save) + '</em>' : '') +
      '</div>' +
      (opts.noAdd ? '' :
        '<button class="card__add" data-act="add" data-pid="' + p.id + '" data-metal="' + v.metal + '">Add to bag</button>') +
      '</div></article>';
  }

  function cartDrawer() {
    var lines = S.cartLines();
    var t = S.totals();
    var body;
    if (!lines.length) {
      body = '<div style="text-align:center;padding:70px 0;color:var(--muted)">' +
        '<p style="font-family:var(--serif);font-size:22px;color:var(--ink);margin-bottom:8px">Your bag is empty</p>' +
        '<p style="font-size:12px;margin-bottom:20px">Steel that stays gold. Start with a best seller.</p>' +
        '<a href="#/collections/best-sellers" class="btn" data-act="close-cart">Shop best sellers</a></div>';
    } else {
      body = lines.map(function (l) {
        if (l.isGift) {
          return '<div class="cline gift"><div class="cline__img"><img src="' + l.image + '" alt=""></div>' +
            '<div class="cline__info"><span class="gift-tag">Free gift</span>' +
            '<span class="cline__title">' + U.esc(l.title) + '</span>' +
            '<span class="cline__var">Auto-added · limit 1 per order</span>' +
            '<div class="cline__row"><span class="cline__price" style="color:var(--brass)">$0.00</span></div></div></div>';
        }
        return '<div class="cline"><a class="cline__img" href="#/products/' + l.handle + '"><img src="' + l.image + '" alt=""></a>' +
          '<div class="cline__info"><a class="cline__title" href="#/products/' + l.handle + '">' + U.esc(l.title) + '</a>' +
          '<span class="cline__var">' + U.esc(l.metal) + (l.size ? ' / ' + U.esc(l.size) : '') + '</span>' +
          '<div class="cline__row"><span class="stepper">' +
          '<button data-act="qty" data-key="' + l.key + '" data-d="-1">' + icon('minus') + '</button>' +
          '<input value="' + l.qty + '" readonly>' +
          '<button data-act="qty" data-key="' + l.key + '" data-d="1">' + icon('plus') + '</button>' +
          '</span><span class="cline__price">' + U.money(l.unitPrice * l.qty) + '</span></div>' +
          '<button class="cline__rm" data-act="rm" data-key="' + l.key + '">Remove</button>' +
          '</div></div>';
      }).join('');
    }

    var prog = '';
    if (lines.length) {
      prog += '<div class="progress"><div class="progress__bar"><i style="width:' +
        Math.min(100, (t.afterDiscount / S.DB.giftRule.threshold) * 100) + '%"></i></div>' +
        '<div class="progress__txt">' + (t.giftUnlocked
          ? '<b>Free gift unlocked</b> — ' + U.esc(S.DB.giftRule.name) + ' added'
          : 'Spend <b>' + U.money(t.giftGap) + '</b> more for a free ' + U.esc(S.DB.giftRule.name) + ' (' + U.money0(S.DB.giftRule.value) + ' value)') +
        '</div></div>';
      prog += '<div class="progress"><div class="progress__bar"><i style="width:' +
        Math.min(100, (t.afterDiscount / S.DB.settings.freeShip) * 100) + '%"></i></div>' +
        '<div class="progress__txt">' + (t.freeShip
          ? '<b>Free standard shipping</b> unlocked'
          : 'Spend <b>' + U.money(t.freeShipGap) + '</b> more for free shipping') +
        '</div></div>';
    }

    var couponBox = S.state.coupon
      ? '<div class="coupon-applied"><span>Code <b>' + U.esc(S.state.coupon.code) + '</b> applied</span>' +
      '<button data-act="rm-coupon">Remove</button></div>'
      : '<form class="coupon" data-act="coupon"><input name="code" placeholder="Discount code" aria-label="Discount code">' +
      '<button type="submit">Apply</button></form>' +
      '<div class="coupon-msg" id="couponMsg"></div>';

    var sum = '<div class="sum">' +
      '<div class="sum__row"><span>Subtotal</span><span>' + U.money(t.subtotal) + '</span></div>' +
      (t.discount > 0 ? '<div class="sum__row disc"><span>Discount</span><span>−' + U.money(t.discount) + '</span></div>' : '') +
      '<div class="sum__row"><span>Shipping <small>' + (t.freeShip ? 'free' : 'standard') + '</small></span><span>' + (t.shipping ? U.money(t.shipping) : 'Free') + '</span></div>' +
      '<div class="sum__row tot"><span>Total</span><span>' + U.money(t.total) + '</span></div>' +
      '</div>';

    return '<div class="overlay" data-close-overlay></div>' +
      '<aside class="drawer" id="cartDrawer">' +
      '<div class="drawer__hd"><b>Your bag (' + S.cartCount() + ')</b>' +
      '<button class="icon-btn" data-act="close-cart" aria-label="Close">' + icon('close') + '</button></div>' +
      '<div class="drawer__body" id="drawerBody">' + body + (lines.length ? couponBox : '') + '</div>' +
      (lines.length ? '<div class="drawer__ft" id="drawerFoot">' + prog + sum +
        '<a href="#/checkout" class="btn btn--full" data-act="go-checkout">Checkout</a>' +
        '<div class="drawer__who">' + (S.state.user
          ? icon('user') + '<span>Signed in as <b>' + U.esc(S.state.user.email) + '</b> — this order saves to your account</span>'
          : icon('user') + '<span><a href="#/account/login?next=/checkout">Sign in</a> to save your details, or check out as guest</span>') + '</div>' +
        '<div class="drawer__note">Duties included · Taxes calculated at checkout</div></div>' : '') +
      '</aside>';
  }

  function searchLayer() {
    return '<div class="searchlayer" id="searchLayer"><div class="searchlayer__in">' +
      '<div class="searchlayer__box">' + icon('search') +
      '<input id="searchInput" placeholder="Search pieces, motifs, collections" autocomplete="off">' +
      '<button class="icon-btn" data-act="close-search">' + icon('close') + '</button></div>' +
      '<div class="searchlayer__hint">Try “turtle”, “moon”, “everyday” — or press Enter for all results.</div>' +
      '<div class="searchlayer__res" id="searchRes"></div></div></div>';
  }

  function mobileMenu() {
    var nav = navItems().map(function (c) {
      return '<a href="#/collections/' + c.handle + '">' + U.esc(c.title) + '</a>';
    }).join('');
    return '<div class="mob-drawer" id="mobDrawer"><div class="mob-drawer__close">' +
      '<button class="icon-btn" data-act="close-menu">' + icon('close') + '</button></div>' +
      nav + '<a href="#/account/lookup">Track order</a><a href="#/pages/about">Our story</a></div>';
  }

  // Cookie 同意条（FR-S-095）。合规上必须先于分析类脚本执行，所以它由本层统一渲染，
  // 而不是放在某个页面里——任何入口进来都要能看到。
  function cookieBar() {
    var v = null;
    try { v = localStorage.getItem('tideglass_cookie'); } catch (e) { }
    if (v) return '';
    return '<div class="ckbar" id="ckbar" role="dialog" aria-label="Cookie preferences">' +
      '<p>We use cookies to run the store and, with your permission, to understand how it is used. ' +
      '<a href="#/pages/about">Learn more</a></p>' +
      '<div class="ckbar__act">' +
      '<button class="btn btn--sm btn--ghost" data-act="ck-essential">Only necessary</button>' +
      '<button class="btn btn--sm" data-act="ck-all">Accept all</button>' +
      '</div></div>';
  }

  function shell(body, r) {
    return header(r) + '<main id="main">' + body + '</main>' + footer() +
      cartDrawer() + searchLayer() + mobileMenu() + cookieBar() +
      '<div class="toast" id="toast"></div>';
  }

  function adminShell(content, active, title) {
    var groups = [
      { g: 'Overview', items: [['', 'Dashboard', ''], ['orders', 'Orders', S.DB.orders.filter(function (o) { return o.status === 'paid' || o.status === 'fulfilling'; }).length], ['products', 'Products', ''], ['inventory', 'Inventory', '']] },
      { g: 'Merchandising', items: [['collections', 'Collections', ''], ['marketing', 'Marketing', ''], ['reviews', 'Reviews', S.DB.reviews.filter(function (x) { return x.status === 'pending'; }).length], ['custom', 'Custom requests', '']] },
      { g: 'People & site', items: [['customers', 'Customers', ''], ['content', 'Content', ''], ['settings', 'Settings', '']] }
    ];
    var nav = groups.map(function (grp) {
      return '<div class="adm__grp">' + grp.g + '</div>' + grp.items.map(function (it) {
        var href = '#/admin' + (it[0] ? '/' + it[0] : '');
        var on = (active || '') === it[0] ? ' class="on"' : '';
        return '<a href="' + href + '"' + on + '>' + it[1] +
          (it[2] ? '<span class="badge">' + it[2] + '</span>' : '') + '</a>';
      }).join('');
    }).join('');

    return '<div class="adm">' +
      '<aside class="adm__side" id="admSide">' +
      '<div class="adm__brand"><span>TIDEGLASS<em>Admin</em></span></div>' +
      '<nav class="adm__nav">' + nav + '</nav>' +
      '<div class="adm__foot">Prototype build v1.0<br>Signed in as owner@tideglass.co</div>' +
      '</aside>' +
      '<div class="adm__main">' +
      '<div class="adm__top"><div style="display:flex;align-items:center;gap:12px">' +
      '<button class="abtn sm" data-act="adm-menu" style="display:none" id="admMenuBtn">' + icon('menu') + '</button>' +
      '<h1>' + title + '</h1></div>' +
      '<div class="adm__top-r"><a href="#/" class="abtn sm" target="_self">View store</a>' +
      '<span class="who"><i>TG</i>Owner</span>' +
      '<button class="abtn sm" data-act="logout">Sign out</button></div></div>' +
      '<div class="adm__body">' + content + '</div></div></div>' +
      '<div class="toast" id="toast"></div>';
  }

  // 预计送达（FR-S-167）：处理时长 1–2 个工作日 + 运输天数，跳过周末。
  // 跨度超过 14 天时不给死日期——跨境物流尾部波动大，承诺越具体越容易招投诉。
  function workdayAdd(from, n) {
    var d = new Date(from.getTime()), c = 0;
    while (c < n) { d.setDate(d.getDate() + 1); var w = d.getDay(); if (w !== 0 && w !== 6) c++; }
    return d;
  }
  function md(d) {
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return m[d.getMonth()] + ' ' + d.getDate();
  }
  function etaText(minDays, maxDays, prefix) {
    var now = new Date();
    var a = workdayAdd(now, 1); a.setDate(a.getDate() + minDays);
    var b = workdayAdd(now, 2); b.setDate(b.getDate() + maxDays);
    var span = Math.round((b - now) / 86400000);
    /* 返回整句，调用方不再硬拼前缀；跨度过大（节假日/旺季）时退化为相对表述 */
    if (span > 21) return 'Ships within <b>1–2 business days</b>';
    return (prefix || 'Order today, arrives ') + '<b>' + md(a) + ' – ' + md(b) + '</b>';
  }

  window.UI = {
    icon: icon, MARK: MARK, header: header, footer: footer, shell: shell,
    productCard: productCard, cartDrawer: cartDrawer, searchLayer: searchLayer,
    adminShell: adminShell, navItems: navItems, etaText: etaText,
    mark: function () { return MARK; }
  };
})();
