/* ============================================================
   TIDEGLASS Web · 视图层
   每个函数只接收「已经从 API 取到的数据」，不自己发请求，
   也不读 localStorage —— 渲染与取数分离，便于单测与替换。
   ============================================================ */
(function () {
  'use strict';

  var U = S.U, ui = window.UI;

  function money(n) { return U.money(n); }
  function esc(s) { return U.esc(s); }

  /* ---------------- 首页 ---------------- */
  function home(boot, best, reviews) {
    var c = boot.settings;
    var heroImgs = ['assets/img/opt/hero-necklaces.jpg', 'assets/img/opt/c-ocean.jpg', 'assets/img/opt/p-necklace-moon-silver.jpg'];
    var slides = heroImgs.map(function (src, i) {
      return '<img src="' + src + '" alt="" class="' + (i === 0 ? 'on' : '') + '">';
    }).join('');
    var parts = String(c.heroTitle || 'Made for|salt water.').split('|');
    var heroTitle = '<h1>' + esc(parts[0] || '') + (parts[1] ? '<br><em>' + esc(parts[1]) + '</em>' : '') + '</h1>';

    var worlds = [
      { h: 'best-sellers', t: 'Ocean', s: 'Salt, sand, and the things that survive both.', i: 'assets/img/opt/c-ocean.jpg' },
      { h: 'woodland', t: 'Woodland', s: 'Foxes, hares and ferns, cut small.', i: 'assets/img/opt/c-woodland.jpg' },
      { h: 'celestial', t: 'Celestial', s: 'Moons, stars and quiet night skies.', i: 'assets/img/opt/c-celestial.jpg' },
    ].map(function (w) {
      return '<a class="tile" href="#/collections/' + w.h + '">' +
        '<img src="' + w.i + '" alt="" loading="lazy">' +
        '<div class="tile__body"><h3>' + w.t + '</h3><p>' + w.s + '</p></div></a>';
    }).join('');

    var revs = (reviews || []).slice(0, 6).map(function (r) {
      return '<div class="rev"><div class="st">' + U.stars(r.rating) + '</div>' +
        '<b>' + esc(r.title) + '</b><p>' + esc((r.body || '').slice(0, 150)) + '</p>' +
        '<span>' + esc(r.name) + (r.verified ? ' · Verified buyer' : '') + '</span></div>';
    }).join('');

    return '<section class="hero">' +
      '<div class="hero__copy">' +
      '<div class="eyebrow">' + esc(c.heroEyebrow || 'Salt & Steel') + '</div>' +
      heroTitle +
      '<p class="hero__desc">' + esc(c.heroBody || '') + '</p>' +
      '<div class="hero__actions">' +
      '<a href="#/collections/best-sellers" class="btn">Shop best sellers</a>' +
      '<a href="#/collections/new" class="btn btn--ghost">What\'s new</a></div>' +
      '<div class="hero__meta">' +
      '<div><b>316L</b>surgical steel</div>' +
      '<div><b>PVD</b>colour lock</div>' +
      '<div><b>Lifetime</b>colour guarantee</div>' +
      '<div><b>30 days</b>free returns</div>' +
      '</div></div>' +
      '<div class="hero__media" id="heroMedia">' + slides +
      '<div class="hero__dots">' + heroImgs.map(function (_, i) {
        return '<i class="' + (i === 0 ? 'on' : '') + '" data-act="slide" data-i="' + i + '"></i>';
      }).join('') + '</div></div></section>' +

      '<div class="proof"><div><b>7M+</b><span>Pieces worn</span></div>' +
      '<div><b>1.6M</b><span>Customers</span></div>' +
      '<div><b>4.7</b><span>Average rating</span></div></div>' +

      '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">' +
      esc((S.DB.settings || {}).bestSellersEyebrow || 'As seen on TikTok') + '</div><h2>Best sellers</h2></div>' +
      '<div class="sec-head__arrow">' +
      '<button class="arrow-btn" data-act="rail" data-d="-1" data-target="railBest">' + ui.icon('left') + '</button>' +
      '<button class="arrow-btn" data-act="rail" data-d="1" data-target="railBest">' + ui.icon('right') + '</button>' +
      '</div></div>' +
      '<div class="rail" id="railBest">' + best.map(function (p) { return ui.productCard(p); }).join('') + '</div></div>' +

      '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">Shop by mood</div><h2>Three worlds</h2></div>' +
      '<a href="#/collections/gifts" class="link-u" style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase">All collections</a></div>' +
      '<div class="tiles">' + worlds + '</div></div>' +

      '<section class="birth"><div class="wrap birth__in">' +
      '<div><div class="eyebrow">Made to be worn daily</div>' +
      '<h2>A colour that<br>doesn\'t wash off.</h2>' +
      '<p>Every piece starts as 316L surgical steel, then gets a 0.8 micron PVD layer bonded at 400°C. Salt water, sunscreen, shampoo — none of it gets through.</p>' +
      '<a href="#/pages/care" class="btn btn--ghost">How to care for it</a></div>' +
      '<div class="birth__tags"><span>Salt water</span><span>Sunscreen</span><span>Showers</span><span>Gym</span><span>Sleep</span></div>' +
      '</div></section>' +

      (revs ? '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">4.7 average · 12,400 reviews</div><h2>What people say</h2></div></div>' +
        '<div class="revs">' + revs + '</div></div>' : '');
  }

  /* ---------------- 集合页 ---------------- */
  var METALS = [{ v: '', l: 'All metals' }, { v: 'Gold', l: 'Gold' }, { v: 'Silver', l: 'Silver' }];
  var PRICES = [{ v: '', l: 'All prices' }, { v: 'under-70', l: 'Under $70' }, { v: '70-100', l: '$70–$100' }, { v: 'over-100', l: 'Over $100' }];
  var SORTS = [
    { v: 'featured', l: 'Featured' }, { v: 'new', l: 'Newest' }, { v: 'best', l: 'Best selling' },
    { v: 'price-asc', l: 'Price: low to high' }, { v: 'price-desc', l: 'Price: high to low' },
  ];

  function collection(c, items, meta, r) {
    var q = r.query || {};
    var handle = c.handle;
    function chipQ(k, v) {
      var p = [];
      Object.keys(q).forEach(function (key) {
        if (key === k || key === 'page') return;
        if (q[key]) p.push(encodeURIComponent(key) + '=' + encodeURIComponent(q[key]));
      });
      if (v) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      return '#/collections/' + handle + (p.length ? '?' + p.join('&') : '');
    }
    var activeN = (q.metal ? 1 : 0) + (q.price ? 1 : 0) + (q.stock === 'in' ? 1 : 0);
    var tags = '';
    if (q.metal) tags += '<a class="fchip" href="' + chipQ('metal', '') + '">' + esc(q.metal) + '<i>' + ui.icon('close') + '</i></a>';
    if (q.price) {
      var pl = (PRICES.filter(function (x) { return x.v === q.price; })[0] || {}).l || q.price;
      tags += '<a class="fchip" href="' + chipQ('price', '') + '">' + esc(pl) + '<i>' + ui.icon('close') + '</i></a>';
    }
    if (q.stock === 'in') tags += '<a class="fchip" href="' + chipQ('stock', '') + '">In stock<i>' + ui.icon('close') + '</i></a>';

    function opts(k, arr, cur) {
      return arr.map(function (m) {
        return '<a class="fopt' + (cur === m.v ? ' on' : '') + '" href="' + chipQ(k, m.v) + '">' + m.l + '</a>';
      }).join('');
    }

    var sortSel = '<select class="sortsel" data-act="sort">' +
      SORTS.map(function (s) { return '<option value="' + s.v + '"' + ((q.sort || 'featured') === s.v ? ' selected' : '') + '>' + s.l + '</option>'; }).join('') +
      '</select>';

    var fbar = '<div class="fbar">' +
      '<button class="fbar__open' + (activeN ? ' has' : '') + '" data-act="open-filter">' +
      ui.icon('filter') + '<span>Filter</span>' + (activeN ? '<em>' + activeN + '</em>' : '') + '</button>' +
      (tags ? '<div class="fbartags">' + tags + '</div>' : '') +
      '<span class="fbar__count">' + meta.total + ' pieces</span>' +
      '<div class="fbar__sort"><span>Sort</span>' + sortSel + '</div></div>' +
      '<div class="fscrim" data-act="close-filter"></div>' +
      '<aside class="fdrawer" id="filterDrawer">' +
      '<div class="fdrawer__hd"><b>Filter</b><button class="fdrawer__x" data-act="close-filter" aria-label="Close">' + ui.icon('close') + '</button></div>' +
      '<div class="fdrawer__body">' +
      '<div class="fgroup"><h5>Metal</h5><div class="fopts">' + opts('metal', METALS, q.metal || '') + '</div></div>' +
      '<div class="fgroup"><h5>Price</h5><div class="fopts">' + opts('price', PRICES, q.price || '') + '</div></div>' +
      '<div class="fgroup"><h5>Availability</h5><div class="fopts">' +
      '<a class="fopt' + (q.stock === 'in' ? ' on' : '') + '" href="' + chipQ('stock', q.stock === 'in' ? '' : 'in') + '">In stock only</a>' +
      '</div></div></div>' +
      '<div class="fdrawer__ft"><a class="fdrawer__clear" href="#/collections/' + handle + '">Clear all</a>' +
      '<button class="btn" data-act="close-filter">Show ' + meta.total + ' pieces</button></div></aside>';

    var grid = items.length
      ? '<div class="grid">' + items.map(function (p) { return ui.productCard(p); }).join('') + '</div>'
      : '<div class="empty" style="padding:80px 0"><h3>Nothing here yet</h3><p>Try removing a filter.</p></div>';

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/">Home</a><span>/</span>' + esc(c.title) + '</div>' +
      '<div class="collhead"><h1>' + esc(c.title) + '</h1>' +
      (c.intro ? '<p>' + esc(c.intro) + '</p>' : '') + '</div>' +
      fbar + grid +
      (meta.hasMore ? '<div style="text-align:center;padding:36px 0"><a class="btn btn--ghost" href="' + chipQ('page', String(meta.page + 1)) + '">Load more</a></div>' : '') +
      '</div>';
  }

  /* ---------------- 商品详情 ---------------- */
  function product(p, reviews, related, r) {
    var q = r.query || {};
    var vlist = p.variants;
    var sel = vlist.filter(function (v) { return v.metal === (q.metal || '') && v.inStock; })[0]
      || vlist.filter(function (v) { return v.inStock; })[0] || vlist[0];
    var selSize = q.size || (p.sizes[0] || '');
    var stock = sel.stock;
    var save = p.compareAt ? p.compareAt - p.price : 0;

    var thumbs = (p.images || []).map(function (src, i) {
      return '<img src="' + src + '" class="' + (i === 0 ? 'on' : '') + '" data-act="thumb" data-i="' + i + '" alt="" loading="lazy">';
    }).join('');

    var metalBtns = vlist.map(function (v) {
      var cls = v.metal === 'Gold' ? 'gold' : v.metal === 'Silver' ? 'silver' : 'rose';
      return '<button class="sw-opt ' + cls + (v.metal === sel.metal ? ' on' : '') + '" ' +
        'data-act="metal" data-handle="' + esc(p.handle) + '" data-m="' + esc(v.metal) + '" ' +
        (v.stock ? '' : 'disabled ') + 'title="' + esc(v.metal) + (v.stock ? '' : ' — sold out') + '"></button>';
    }).join('');

    var sizeBtns = (p.sizes || []).length ? p.sizes.map(function (s) {
      return '<button class="size ' + (s === selSize ? 'on' : '') + '" data-act="size" data-handle="' + esc(p.handle) + '" data-s="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('') : '<button class="size on">One size</button>';

    var stockNote = stock <= 0
      ? '<div class="stock-note out">Sold out — join the restock list</div>'
      : stock <= 5
        ? '<div class="stock-note low">Only ' + stock + ' left in ' + esc(sel.metal) + '</div>'
        : '<div class="stock-note">In stock · ships in 1–2 business days</div>';

    var dt = Object.keys(p.details || {}).map(function (k) {
      return '<dt>' + esc(k.charAt(0).toUpperCase() + k.slice(1)) + '</dt><dd>' + esc(p.details[k]) + '</dd>';
    }).join('');

    var revs = (reviews || []).map(function (x) {
      return '<div class="rev"><div class="st">' + U.stars(x.rating) + '</div>' +
        '<b>' + esc(x.title) + '</b><p>' + esc(x.body) + '</p>' +
        '<span>' + esc(x.name) + (x.verified ? ' · Verified buyer' : '') + '</span></div>';
    }).join('');

    var rel = (related || []).map(function (x) {
      return '<a class="card card--mini" href="#/products/' + esc(x.handle) + '">' +
        '<div class="card__media"><img src="' + esc(x.image) + '" alt="" loading="lazy"></div>' +
        '<div class="card__body"><span class="card__title">' + esc(x.title) + '</span>' +
        '<span class="card__price">' + money(x.price) + '</span></div></a>';
    }).join('');

    /* 后台「Description」是 textarea（可多行，最多 2000 字），接口以 description 返回。
       这里原样转义输出，靠 CSS 的 pre-line 保留换行；没有描述时整块不渲染，
       避免详情页留一段空div。 */
    var descText = String(p.description || '').trim();

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/collections/' + esc(p.category) + '">' + esc(p.category) + '</a><span>/</span>' + esc(p.title) + '</div>' +
      '<div class="pdp">' +
      '<div class="gal"><div class="gal__thumbs">' + thumbs + '</div>' +
      '<div class="gal__main"><img src="' + esc(p.images[0] || '') + '" id="galMain" alt="' + esc(p.title) + '"></div></div>' +

      '<div class="pdp__info">' +
      (p.badge ? '<div class="eyebrow" style="margin-bottom:8px">' + esc(p.badge) + '</div>' : '') +
      '<h1 style="font-family:var(--serif);font-size:clamp(26px,2.6vw,34px);font-weight:400">' + esc(p.title) + '</h1>' +
      '<div class="pdp__rate"><span class="st">' + U.stars(Number(p.rating)) + '</span>' +
      '<span>' + p.rating + ' · ' + p.reviewCount + ' reviews</span></div>' +
      '<div class="pdp__price"><b>' + money(sel.price || p.price) + '</b>' +
      (p.compareAt ? '<s>' + money(p.compareAt) + '</s><em>Save ' + U.money0(save) + '</em>' : '') + '</div>' +
      '<div class="pdp__tax">Duties included</div>' +
      '<div class="eta">' + ui.icon('truck') + '<span>' + ui.etaText(7, 12) + '</span></div>' +
      (descText ? '<div class="pdp__desc">' + esc(descText) + '</div>' : '') +
      '<ul class="usp-list">' +
      '<li>' + ui.icon('shield') + '<span><b>Lifetime colour guarantee.</b> If it fades, we replace it once.</span></li>' +
      '<li>' + ui.icon('shield') + '<span><b>Waterproof &amp; tarnish-free.</b> 0.8 micron PVD — swim, shower, sleep in it.</span></li>' +
      '<li>' + ui.icon('shield') + '<span><b>Hypoallergenic 316L steel.</b> Nickel-safe, no green wrists.</span></li>' +
      '<li>' + ui.icon('truck') + '<span><b>Free shipping over $' + S.DB.settings.freeShip + '.</b> Tracked, no surprise fees.</span></li>' +
      '</ul>' +
      '<div class="opt"><div class="opt__hd"><span>Finish</span><b>' + esc(sel.metal) + '</b></div>' +
      '<div class="swatches">' + metalBtns + '</div></div>' +
      ((p.sizes || []).length ? '<div class="opt"><div class="opt__hd"><span>Length</span><b>' + esc(selSize) + '</b></div>' +
        '<div class="sizes">' + sizeBtns + '</div></div>' : '') +
      '<div class="qtyrow">' +
      '<span class="stepper"><button data-act="pdpq" data-d="-1">' + ui.icon('minus') + '</button>' +
      '<input id="pdpQty" value="1" readonly><button data-act="pdpq" data-d="1">' + ui.icon('plus') + '</button></span>' +
      '<button class="btn" data-act="add" data-handle="' + esc(p.handle) + '" data-metal="' + esc(sel.metal) + '" data-size="' + esc(selSize) + '"' +
      (stock <= 0 ? ' disabled' : '') + '>' + (stock <= 0 ? 'Sold out' : 'Add to bag') + '</button></div>' +
      stockNote +
      '<div class="acc">' +
      '<div class="acc__item open"><button class="acc__hd" data-act="acc">Materials &amp; care <i>−</i></button>' +
      '<div class="acc__body"><dl>' + dt + '</dl><p style="margin-top:10px">Rinse with fresh water after salt or chlorine. Dry with a soft cloth. No polish needed.</p></div></div>' +
      '<div class="acc__item"><button class="acc__hd" data-act="acc">Shipping &amp; duties <i>+</i></button>' +
      '<div class="acc__body">Free standard shipping over $' + S.DB.settings.freeShip + ', otherwise $' + S.DB.settings.standardShip + '. Express $' + S.DB.settings.expressShip + ' (3–5 days). All duties and taxes are included — nothing to pay on delivery.</div></div>' +
      '<div class="acc__item"><button class="acc__hd" data-act="acc">Returns <i>+</i></button>' +
      '<div class="acc__body">30 days, no questions. We email a prepaid label. Refunds land back on the original card within 5 business days.</div></div>' +
      '</div></div></div>' +

      '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">From the same world</div><h2>You may also like</h2></div></div>' +
      '<div class="grid grid--4">' + rel + '</div></div>' +
      (revs ? '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">' + p.reviewCount + ' reviews</div><h2>What buyers say</h2></div></div>' +
        '<div class="revs">' + revs + '</div></div>' : '') +
      '</div>';
  }

  /* ---------------- 购物车页 ---------------- */
  function cart() {
    var lines = S.cartLines();
    var t = S.totals();
    if (!lines.length) {
      return '<div class="wrap"><div class="collhead"><h1>Your bag</h1></div>' +
        '<div class="empty" style="padding:80px 0;text-align:center"><h3>Your bag is empty</h3>' +
        '<p style="color:var(--muted);margin:10px 0 22px">Start with the pieces everyone reorders.</p>' +
        '<a class="btn" href="#/collections/best-sellers">Shop best sellers</a></div></div>';
    }
    var rows = lines.map(function (l) {
      return '<div class="cline">' +
        '<a class="cline__img" href="#/products/' + esc(l.handle) + '"><img src="' + esc(l.image) + '" alt=""></a>' +
        '<div class="cline__info"><a class="cline__title" href="#/products/' + esc(l.handle) + '">' + esc(l.title) + '</a>' +
        '<span class="cline__var">' + esc(l.metal) + (l.size ? ' / ' + esc(l.size) : '') + '</span>' +
        '<div class="cline__row"><span class="stepper">' +
        '<button data-act="qty" data-key="' + esc(l.key) + '" data-d="-1">' + ui.icon('minus') + '</button>' +
        '<input value="' + l.qty + '" readonly>' +
        '<button data-act="qty" data-key="' + esc(l.key) + '" data-d="1">' + ui.icon('plus') + '</button></span>' +
        '<span class="cline__price">' + money(l.unitPrice * l.qty) + '</span></div>' +
        '<button class="cline__rm" data-act="rm" data-key="' + esc(l.key) + '">Remove</button></div></div>';
    }).join('');

    return '<div class="wrap"><div class="collhead"><h1>Your bag</h1>' +
      '<p>' + S.cartCount() + ' ' + (S.cartCount() === 1 ? 'piece' : 'pieces') + ' · duties included</p></div>' +
      '<div class="co"><div><div class="cartlines">' + rows + '</div>' +
      '<a class="link-u" href="#/collections/best-sellers">← Keep shopping</a></div>' +
      '<div class="paysum"><h4>Summary</h4>' +
      '<div class="sum">' +
      '<div class="sum__row"><span>Subtotal</span><span>' + money(t.subtotal) + '</span></div>' +
      (t.discount ? '<div class="sum__row disc"><span>Discount</span><span>−' + money(t.discount) + '</span></div>' : '') +
      '<div class="sum__row"><span>Shipping</span><span>' + (t.shipping ? money(t.shipping) : 'Free') + '</span></div>' +
      '<div class="sum__row tot"><span>Total</span><span>' + money(t.total) + '</span></div>' +
      '</div>' +
      '<a class="btn btn--full" href="#/checkout">Checkout</a>' +
      '<p class="drawer__note">Taxes and duties included · 30-day free returns</p>' +
      '</div></div></div>';
  }

  /* ---------------- 结算页 ---------------- */
  function checkout(quote, form, err) {
    form = form || {};
    var lines = (quote ? quote.lines : S.cartLines()).map(function (l) {
      return '<div class="paysum__line"><img src="' + esc(l.image || '') + '" alt="">' +
        '<div>' + esc(l.title) + '<span>' + esc(l.metal) + (l.size ? ' / ' + esc(l.size) : '') + ' · ×' + l.qty + '</span></div>' +
        '<div class="mono" style="font-size:11.5px">' + money(l.lineTotal || l.unitPrice * l.qty) + '</div></div>';
    }).join('');
    if (quote && quote.gift) {
      lines += '<div class="paysum__line"><img src="' + esc(quote.gift.image || 'assets/img/opt/p-earring-pearl-gold.jpg') + '" alt="">' +
        '<div>' + esc(quote.gift.title) + '<span>Free gift</span></div>' +
        '<div class="mono" style="font-size:11.5px;color:var(--brass)">$0.00</div></div>';
    }

    var f = function (k, d) { return esc(form[k] != null ? form[k] : (d || '')); };
    var detailList = err && err.details ? '<div class="falert">' +
      err.details.map(function (d) { return '<div>· ' + esc(d.message) + '</div>'; }).join('') + '</div>' : '';

    function field(name, label, extra) {
      return '<div class="fld' + (err && (err.details || []).some(function (d) { return d.field === name; }) ? ' bad' : '') + '">' +
        '<label>' + label + '</label><input name="' + name + '" value="' + f(name) + '" ' + (extra || '') + '></div>';
    }

    var left = '<div class="co__block"><h3>Contact</h3>' +
      field('email', 'Email', 'type="email" autocomplete="email" placeholder="you@email.com" required') + '</div>' +

      '<div class="co__block"><h3>Delivery address</h3>' +
      field('firstName', 'First name', 'required') + field('lastName', 'Last name', 'required') +
      field('line1', 'Address', 'required placeholder="Street and number"') +
      field('city', 'City', 'required') + field('state', 'State / Province', 'required') +
      field('zip', 'ZIP / Postcode', 'required') +
      '<div class="fld"><label>Country</label><select name="country">' +
      ['United States', 'Canada', 'United Kingdom'].map(function (c) {
        return '<option' + ((form.country || 'United States') === c ? ' selected' : '') + '>' + c + '</option>';
      }).join('') + '</select></div></div>' +

      '<div class="co__block"><h3>Shipping method</h3>' +
      shipOption('Standard', 'Tracked · duties included', form.shipping) +
      shipOption('Express', 'Priority handling · 3–5 days', form.shipping) + '</div>' +

      '<div class="co__block"><h3>Payment</h3>' +
      '<div class="cardfield"><div class="cardfield__row"><input value="4242 4242 4242 4242" readonly><span class="cardbrand">Test</span></div>' +
      '<p class="small" style="color:var(--muted);margin:0">Test mode — Stripe keys are not connected yet, so nothing is charged. See the integration checklist.</p></div></div>' +
      (err ? '<div class="falert">' + esc(err.message) + '</div>' : '') + detailList +
      '<button class="btn btn--full" type="submit">Pay ' + money(quote ? quote.total : S.totals().total) + '</button>' +
      '<p class="drawer__note" style="margin-top:12px">Free returns within 30 days · Duties included</p>';

    var summary = '<div class="paysum"><h4>Order summary</h4>' + lines +
      '<div class="sum" style="margin-top:14px">' +
      '<div class="sum__row"><span>Subtotal</span><span>' + money(quote ? quote.subtotal : S.totals().subtotal) + '</span></div>' +
      (quote && quote.discount ? '<div class="sum__row disc"><span>Discount</span><span>−' + money(quote.discount) + '</span></div>' : '') +
      '<div class="sum__row"><span>Shipping</span><span>' + (quote && quote.shipping ? money(quote.shipping) : 'Free') + '</span></div>' +
      '<div class="sum__row tot"><span>Total</span><span>' + money(quote ? quote.total : S.totals().total) + '</span></div>' +
      '</div>' +
      (S.state.coupon
        ? '<div class="coupon-applied"><span>Code <b>' + esc(S.state.coupon.code) + '</b> applied</span><button data-act="rm-coupon">Remove</button></div>'
        : '<form class="coupon" data-act="coupon"><input name="code" placeholder="Discount code" aria-label="Discount code"><button type="submit">Apply</button></form>') +
      '</div>';

    return '<div class="wrap"><div class="collhead"><h1>Checkout</h1></div>' +
      '<form class="co" data-act="place"><div>' + left + '</div>' + summary + '</form></div>';
  }

  function shipOption(name, sub, current) {
    var sel = (current || 'Standard') === name;
    var price = name === 'Express' ? money(S.DB.settings.expressShip) : 'Free over $' + S.DB.settings.freeShip;
    return '<label class="shipopt' + (sel ? ' on' : '') + '">' +
      '<input type="radio" name="shipping" value="' + name + '" data-act="ship"' + (sel ? ' checked' : '') + '>' +
      '<div><b>' + name + '</b><span>' + sub + '</span></div>' +
      '<span class="pr">' + price + '</span></label>';
  }

  /* ---------------- 订单完成 ---------------- */
  function orderDone(o) {
    var rows = o.items.map(function (i) {
      return '<div class="paysum__line"><div>' + esc(i.title) + (i.isGift ? ' <span class="gift-tag">Gift</span>' : '') +
        '<span>' + esc(i.variant) + (i.size ? ' / ' + esc(i.size) : '') + ' · ×' + i.qty + '</span></div>' +
        '<div class="mono" style="font-size:11.5px">' + money(i.unitPrice * i.qty) + '</div></div>';
    }).join('');
    return '<div class="wrap" style="max-width:720px">' +
      '<div class="donebox"><div class="eyebrow">Order confirmed</div>' +
      '<h1>Thank you — it ships in 1–2 days.</h1>' +
      '<p class="lede">A confirmation is on its way to <b>' + esc(o.email) + '</b>. Keep the order number to track it.</p>' +
      '<div class="ordernum"><span>Order number</span><b>' + esc(o.number) + '</b></div>' +
      '<div class="paysum" style="position:static;margin-top:22px"><h4>What you ordered</h4>' + rows +
      '<div class="sum" style="margin-top:12px">' +
      '<div class="sum__row"><span>Subtotal</span><span>' + money(o.subtotal) + '</span></div>' +
      (o.discount ? '<div class="sum__row disc"><span>Discount</span><span>−' + money(o.discount) + '</span></div>' : '') +
      '<div class="sum__row"><span>Shipping</span><span>' + (o.shipping ? money(o.shipping) : 'Free') + '</span></div>' +
      '<div class="sum__row tot"><span>Total paid</span><span>' + money(o.total) + '</span></div></div></div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:22px">' +
      '<a class="btn" href="#/account/lookup?number=' + encodeURIComponent(o.number) + '&email=' + encodeURIComponent(o.email) + '">Track this order</a>' +
      '<a class="btn btn--ghost" href="#/collections/best-sellers">Keep shopping</a></div>' +
      '</div></div>';
  }

  /* ---------------- 查单 ---------------- */
  function lookup(order, err, form) {
    var f = form || {};
    if (order) {
      var rows = order.items.map(function (i) {
        return '<div class="paysum__line"><div>' + esc(i.title) +
          '<span>' + esc(i.variant) + (i.size ? ' / ' + esc(i.size) : '') + ' · ×' + i.qty + '</span></div>' +
          '<div class="mono" style="font-size:11.5px">' + money(i.unitPrice * i.qty) + '</div></div>';
      }).join('');
      var steps = ['paid', 'fulfilling', 'fulfilled', 'completed'];
      var idx = steps.indexOf(order.status);
      return '<div class="wrap" style="max-width:760px"><div class="collhead"><h1>Order ' + esc(order.number) + '</h1>' +
        '<p>' + esc(order.statusLabel || order.status) + ' · placed ' + U.fmtDate(order.createdAt) + '</p></div>' +
        '<div class="trackbar">' + steps.map(function (s, i) {
          return '<i class="' + (idx >= i ? 'on' : '') + '"><span></span>' + s + '</i>';
        }).join('') + '</div>' +
        (order.tracking ? '<p class="small" style="margin:18px 0">Tracking <b>' + esc(order.tracking) + '</b> · ' + esc(order.carrier || '') + '</p>' : '') +
        '<div class="paysum"><h4>Items</h4>' + rows +
        '<div class="sum" style="margin-top:12px">' +
        '<div class="sum__row"><span>Subtotal</span><span>' + money(order.subtotal) + '</span></div>' +
        '<div class="sum__row"><span>Shipping</span><span>' + (order.shipping ? money(order.shipping) : 'Free') + '</span></div>' +
        '<div class="sum__row tot"><span>Total</span><span>' + money(order.total) + '</span></div></div></div>' +
        '<a class="link-u" href="#/account/lookup" style="display:inline-block;margin-top:20px">Look up another order</a></div>';
    }
    return '<div class="wrap" style="max-width:520px"><div class="collhead"><h1>Track an order</h1>' +
      '<p>Order number and email, both needed — that\'s how we keep other people out of your order.</p></div>' +
      '<form data-act="lookup">' +
      '<div class="fld"><label>Order number</label><input name="number" value="' + esc(f.number || '') + '" placeholder="#TG1041" required></div>' +
      '<div class="fld"><label>Email</label><input name="email" type="email" value="' + esc(f.email || '') + '" placeholder="you@email.com" required></div>' +
      (err ? '<div class="falert">' + esc(err.message) + '</div>' : '') +
      '<button class="btn btn--full" type="submit">Find my order</button></form></div>';
  }

  function notFound() {
    return '<div class="wrap" style="padding:90px 0;text-align:center">' +
      '<h1 style="font-family:var(--serif);font-weight:400;font-size:40px">Page not found</h1>' +
      '<p style="color:var(--muted);margin:12px 0 26px">That link may be old, or the piece sold out.</p>' +
      '<a class="btn" href="#/">Back home</a></div>';
  }

  window.Views = {
    home: home, collection: collection, product: product, cart: cart,
    checkout: checkout, orderDone: orderDone, lookup: lookup, notFound: notFound,
    METALS: METALS, PRICES: PRICES, SORTS: SORTS,
  };
})();
