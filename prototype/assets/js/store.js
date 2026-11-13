/* ============================================================
   TIDEGLASS · 前台视图
   ============================================================ */
(function () {
  'use strict';
  var U = S.U, ui = window.UI;

  /* ---------------- 首页 ---------------- */
  function home() {
    var best = S.productsIn('best-sellers').slice(0, 8);
    if (best.length < 4) best = S.allProducts().slice(0, 8);
    var news = S.allProducts().slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }).slice(0, 4);
    var revs = S.DB.reviews.filter(function (r) { return r.status === 'approved'; }).slice(0, 6);

    var heroImgs = ['assets/img/opt/hero-necklaces.jpg', 'assets/img/opt/c-ocean.jpg', 'assets/img/opt/p-necklace-moon-silver.jpg'];
    var slides = heroImgs.map(function (src, i) {
      return '<img src="' + src + '" alt="" class="' + (i === 0 ? 'on' : '') + '">';
    }).join('');

    var c = (S.DB.settings && S.DB.settings.content) || {};
    var titleParts = String(c.heroTitle || 'Made for|salt water.').split('|');
    var heroTitle = '<h1>' + U.esc(titleParts[0] || '') +
      (titleParts[1] ? '<br><em>' + U.esc(titleParts[1]) + '</em>' : '') + '</h1>';
    return '' +
      '<section class="hero">' +
      '<div class="hero__copy">' +
      '<div class="eyebrow">' + U.esc(c.heroEyebrow || 'Salt & Steel') + '</div>' +
      heroTitle +
      '<p class="hero__desc">' + U.esc(c.heroBody || '316L stainless steel with a PVD colour layer that does not fade.') + '</p>' +
      '<div class="hero__actions">' +
      '<a href="#/collections/best-sellers" class="btn">Shop best sellers</a>' +
      '<a href="#/collections/new" class="btn btn--ghost">See what\'s new</a></div>' +
      '<div class="hero__meta">' +
      '<div><b>316L</b>surgical steel</div>' +
      '<div><b>PVD</b>colour lock</div>' +
      '<div><b>Lifetime</b>colour guarantee</div>' +
      '<div><b>30 days</b>free returns</div>' +
      '</div></div>' +
      '<div class="hero__media" id="heroMedia">' + slides +
      '<div class="hero__dots">' + heroImgs.map(function (_, i) {
        return '<i class="' + (i === 0 ? 'on' : '') + '" data-act="slide" data-i="' + i + '"></i>';
      }).join('') + '</div></div>' +
      '</section>' +

      '<div class="proof"><div><b>7M+</b><span>Pieces worn</span></div>' +
      '<div><b>1.6M</b><span>Customers</span></div>' +
      '<div><b>4.7</b><span>Average rating</span></div></div>' +

      '<div class="wrap">' +
      '<div class="sec-head"><div><div class="eyebrow">As seen on TikTok</div><h2>Best sellers</h2></div>' +
      '<div class="sec-head__arrow"><button class="arrow-btn" data-act="rail" data-d="-1" data-target="railBest">' + ui.icon('left') + '</button>' +
      '<button class="arrow-btn" data-act="rail" data-d="1" data-target="railBest">' + ui.icon('right') + '</button></div></div>' +
      '<div class="rail" id="railBest">' + best.map(function (p) { return ui.productCard(p); }).join('') + '</div>' +
      '</div>' +

      '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">Shop by mood</div><h2>Three worlds</h2></div>' +
      '<a href="#/collections/gifts" class="link-u" style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase">All collections</a></div>' +
      '<div class="tiles">' +
      '<a class="tile" href="#/collections/ocean"><img src="assets/img/opt/c-ocean.jpg" alt="Ocean"><span class="tile__cap"><span>34 pieces</span><b>Ocean</b></span></a>' +
      '<a class="tile" href="#/collections/woodland"><img src="assets/img/opt/c-woodland.jpg" alt="Woodland"><span class="tile__cap"><span>28 pieces</span><b>Woodland</b></span></a>' +
      '<a class="tile" href="#/collections/celestial"><img src="assets/img/opt/c-celestial.jpg" alt="Celestial"><span class="tile__cap"><span>19 pieces</span><b>Celestial</b></span></a>' +
      '</div></div>' +

      '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">Just landed</div><h2>New arrivals</h2></div>' +
      '<a href="#/collections/new" class="link-u" style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase">View all</a></div>' +
      '<div class="grid">' + news.map(function (p) { return ui.productCard(p); }).join('') + '</div></div>' +

      '<div class="wrap"><div class="story">' +
      '<img src="assets/img/opt/c-woodland.jpg" alt="TIDEGLASS workshop">' +
      '<div class="story__copy"><div class="eyebrow">Why steel</div>' +
      '<h2>Gold fades.<br>Steel tells the truth.</h2>' +
      '<p>We started TIDEGLASS because every “waterproof” necklace we owned turned our wrists green by August. So we stopped buying coatings that pretend to be gold, and started with the metal that does not need to pretend: 316L surgical steel, finished with a PVD layer measured in microns.</p>' +
      '<p>It will pick up fine scratches. That is steel being honest. What it will not do is turn your skin green, or lose its colour in the sea.</p>' +
      '<div class="story__sig">— The TIDEGLASS workshop, Portugal &amp; Guangzhou</div>' +
      '<a href="#/pages/materials" class="btn btn--ghost" style="margin-top:20px">How it is made</a></div>' +
      '</div>' +

      '<div class="birth"><div><div class="eyebrow" style="color:#C9A876">November · Citrine</div>' +
      '<h3>The birthstone edit</h3>' +
      '<p>One stone a month, set in steel. A reason to come back every thirty days — and a gift that always fits.</p></div>' +
      '<div class="birth__stones">' +
      '<a href="#/collections/birthstones"><i style="background:#E8B44A"></i>Citrine</a>' +
      '<a href="#/collections/pearls"><i style="background:#F0EAE0"></i>Pearl</a>' +
      '<a href="#/collections/birthstones"><i style="background:#7A9E7E"></i>Emerald</a>' +
      '<a href="#/collections/birthstones"><i style="background:#8C6A8E"></i>Amethyst</a>' +
      '</div></div>' +

      '</div>' +
      '<section class="revs"><div class="wrap"><div class="revs__hd"><div class="eyebrow">4.7 average · 12,480 reviews</div>' +
      '<h2>What they say after a few months</h2></div><div class="revs__grid">' +
      revs.map(function (r) {
        var p = S.product(r.productId);
        return '<div class="rev"><div class="st">' + U.stars(r.rating) + '</div>' +
          '<h4>' + U.esc(r.title) + '</h4><p>“' + U.esc(r.body) + '”</p>' +
          '<div class="rev__foot"><b>' + U.esc(r.name) + '</b><span>·</span><span>' + U.mo(r.monthsOwned) + ' in</span>' +
          (r.verified ? '<span class="verified" style="margin-left:auto">✓ Verified</span>' : '') + '</div></div>';
      }).join('') +
      '</div></div></section>' +

      '<section class="news"><div class="wrap"><h2>Get first access</h2>' +
      '<p>New drops, restocks, and one honest email a month. No daily sales noise.</p>' +
      '<form data-act="newsletter"><input type="email" name="email" placeholder="your@email.com" required aria-label="Email">' +
      '<button class="btn" type="submit">Subscribe</button></form>' +
      '<p style="font-size:10px;margin-top:14px;opacity:.7">10% off your first order. Unsubscribe in one click.</p></div></section>';
  }

  /* ---------------- 集合页 ---------------- */
  var METALS = [{ v: '', l: 'All' }, { v: 'Gold', l: 'Gold' }, { v: 'Silver', l: 'Silver' }];
  var PRICES = [{ v: '', l: 'All prices' }, { v: 'under-70', l: 'Under $70' }, { v: '70-100', l: '$70–$100' }, { v: 'over-100', l: 'Over $100' }];
  var SORTS = [
    { v: 'featured', l: 'Featured' }, { v: 'new', l: 'Newest' },
    { v: 'best', l: 'Best selling' }, { v: 'price-asc', l: 'Price: low to high' },
    { v: 'price-desc', l: 'Price: high to low' }
  ];

  function collection(r) {
    var handle = r.seg[1] || 'best-sellers';
    var c = S.coll(handle);
    if (!c) return notFound();
    var list = S.productsIn(handle);
    var q = r.query;
    var metal = q.metal || '', price = q.price || '', stock = q.stock || '', sort = q.sort || 'featured';

    if (metal) list = list.filter(function (p) { return p.variants.some(function (v) { return v.metal === metal; }); });
    if (price === 'under-70') list = list.filter(function (p) { return p.price < 70; });
    if (price === '70-100') list = list.filter(function (p) { return p.price >= 70 && p.price <= 100; });
    if (price === 'over-100') list = list.filter(function (p) { return p.price > 100; });
    if (stock === 'in') list = list.filter(function (p) { return S.totalStock(p) > 0; });

    list = list.slice();
    if (sort === 'price-asc') list.sort(function (a, b) { return a.price - b.price; });
    else if (sort === 'price-desc') list.sort(function (a, b) { return b.price - a.price; });
    else if (sort === 'new') list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    else if (sort === 'best') list.sort(function (a, b) { return b.sold30 - a.sold30; });

    var limit = Number(q.limit || 12);
    var shown = list.slice(0, limit);

    function chipQ(key, val) {
      var o = {};
      ['metal', 'price', 'stock', 'sort', 'limit'].forEach(function (k) { if (q[k]) o[k] = q[k]; });
      if (val) o[key] = val; else delete o[key];
      delete o.limit;
      var s = Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
      return '#/collections/' + handle + (s ? '?' + s : '');
    }

    // 筛选控件：原来把 8 个条件全部铺成一排方块按钮，字小、块多、还把排序挤到第二行，
    // 视觉上比商品本身还响。改成"一个 Filter 入口 + 已选条件可逐个摘掉 + 一个 Sort 下拉"，
    // 条件本身收进右侧抽屉分组展示（Atolea 也是这套结构）。
    var metalLabel = (METALS.filter(function (m) { return m.v === metal; })[0] || {}).l;
    var priceLabel = (PRICES.filter(function (m) { return m.v === price; })[0] || {}).l;
    var activeN = (metal ? 1 : 0) + (price ? 1 : 0) + (stock === 'in' ? 1 : 0);

    var tags = '';
    if (metal) tags += '<a class="fchip" href="' + chipQ('metal', '') + '">' + U.esc(metalLabel) + '<i>' + ui.icon('close') + '</i></a>';
    if (price) tags += '<a class="fchip" href="' + chipQ('price', '') + '">' + U.esc(priceLabel) + '<i>' + ui.icon('close') + '</i></a>';
    if (stock === 'in') tags += '<a class="fchip" href="' + chipQ('stock', '') + '">In stock<i>' + ui.icon('close') + '</i></a>';
    tags = tags ? '<div class="fbartags">' + tags + '</div>' : '';

    function fopts(key, arr, cur) {
      return arr.map(function (m) {
        return '<a class="fopt' + (cur === m.v ? ' on' : '') + '" href="' + chipQ(key, m.v) + '">' + m.l + '</a>';
      }).join('');
    }

    var sortSel = '<select class="sortsel" data-act="sort" data-handle="' + handle + '">' +
      SORTS.map(function (s) { return '<option value="' + s.v + '"' + (sort === s.v ? ' selected' : '') + '>' + s.l + '</option>'; }).join('') +
      '</select>';

    var fbar = '<div class="fbar">' +
      '<button class="fbar__open' + (activeN ? ' has' : '') + '" data-act="open-filter">' +
      ui.icon('filter') + '<span>Filter</span>' + (activeN ? '<em>' + activeN + '</em>' : '') + '</button>' +
      tags +
      '<span class="fbar__count">' + list.length + ' pieces</span>' +
      '<div class="fbar__sort"><span>Sort</span>' + sortSel + '</div>' +
      '</div>' +
      '<div class="fscrim" data-act="close-filter"></div>' +
      '<aside class="fdrawer" id="filterDrawer" aria-labelledby="fdrawerTitle">' +
      '<div class="fdrawer__hd"><b id="fdrawerTitle">Filter</b>' +
      '<button class="fdrawer__x" data-act="close-filter" aria-label="Close filter">' + ui.icon('close') + '</button></div>' +
      '<div class="fdrawer__body">' +
      '<div class="fgroup"><h5>Metal</h5><div class="fopts">' + fopts('metal', METALS, metal) + '</div></div>' +
      '<div class="fgroup"><h5>Price</h5><div class="fopts">' + fopts('price', PRICES, price) + '</div></div>' +
      '<div class="fgroup"><h5>Availability</h5><div class="fopts">' +
      '<a class="fopt' + (stock === 'in' ? ' on' : '') + '" href="' + chipQ('stock', stock === 'in' ? '' : 'in') + '">In stock only</a>' +
      '</div></div>' +
      '</div>' +
      '<div class="fdrawer__ft">' +
      '<a class="fdrawer__clear" href="#/collections/' + handle + '">Clear all</a>' +
      '<button class="btn" data-act="close-filter">Show ' + list.length + ' pieces</button>' +
      '</div></aside>';

    var body = shown.length
      ? '<div class="grid">' + shown.map(function (p) { return ui.productCard(p); }).join('') + '</div>'
      : '<div class="empty"><h3>Nothing matches those filters</h3><p>Try removing one filter — or browse the full collection.</p>' +
      '<a class="btn btn--ghost" href="#/collections/' + handle + '">Clear filters</a></div>';

    var more = list.length > limit
      ? '<div class="loadmore"><button class="btn btn--ghost" data-act="more">Load more (' + (list.length - limit) + ')</button></div>'
      : '<div style="height:36px"></div>';

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/">Home</a><span>/</span>' + U.esc(c.title) + '</div>' +
      '<div class="coll-head"><h1>' + U.esc(c.title) + '</h1>' +
      '<p>' + U.esc(c.desc || 'Steel pieces built to be worn in the water, not taken off before it.') + '</p></div>' +
      fbar +
      '<div style="padding-top:24px">' + body + '</div>' + more + '</div>';
  }

  /* ---------------- 商品详情 ---------------- */
  function productPage(r) {
    var p = S.product(r.seg[1] || '');
    if (!p) return notFound();

    var vlist = p.variants;
    var selMetal = r.query.metal || (vlist.filter(function (v) { return v.stock > 0; })[0] || vlist[0]);
    if (typeof selMetal === 'string') selMetal = vlist.filter(function (v) { return v.metal === selMetal; })[0] || vlist[0];
    var selSize = r.query.size || (p.sizes[0] || '');
    var stock = selMetal.stock;
    var save = p.compareAt ? p.compareAt - p.price : 0;
    var revs = S.reviewsOf(p.id, true);
    var avg = revs.length ? (revs.reduce(function (a, x) { return a + x.rating; }, 0) / revs.length).toFixed(1) : p.rating;

    var thumbs = p.images.map(function (src, i) {
      return '<img src="' + src + '" class="' + (i === 0 ? 'on' : '') + '" data-act="thumb" data-i="' + i + '" alt="">';
    }).join('');

    var metalBtns = vlist.map(function (v) {
      var cls = v.metal === 'Gold' ? 'gold' : v.metal === 'Silver' ? 'silver' : 'rose';
      return '<button class="sw-opt ' + cls + (v.metal === selMetal.metal ? ' on' : '') + '" data-act="metal" data-handle="' + p.handle + '" data-m="' + v.metal + '" title="' + v.metal + (v.stock ? '' : ' — sold out') + '"></button>';
    }).join('');

    var sizeBtns = p.sizes.length ? p.sizes.map(function (s) {
      return '<button class="size ' + (s === selSize ? 'on' : '') + '" data-act="size" data-handle="' + p.handle + '" data-s="' + s + '">' + s + '</button>';
    }).join('') : '<button class="size on">One size</button>';

    var stockNote = stock <= 0
      ? '<div class="stock-note out">Sold out — join the restock list</div>'
      : stock <= 5 ? '<div class="stock-note low">Only ' + stock + ' left in ' + selMetal.metal + '</div>'
        : '<div class="stock-note">In stock · ships in 1–2 business days</div>';

    var related = S.allProducts().filter(function (x) {
      return x.id !== p.id && (x.set === p.set || x.cat === p.cat);
    }).slice(0, 4);

    var details = p.details || {};
    var dt = Object.keys(details).map(function (k) {
      return '<dt>' + k.charAt(0).toUpperCase() + k.slice(1) + '</dt><dd>' + U.esc(details[k]) + '</dd>';
    }).join('');

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/collections/' + p.cat + '">' + U.esc(p.cat) + '</a><span>/</span>' + U.esc(p.title) + '</div>' +
      '<div class="pdp">' +
      '<div class="gal"><div class="gal__thumbs">' + thumbs + '</div>' +
      '<div class="gal__main"><img src="' + p.images[0] + '" id="galMain" alt="' + U.esc(p.title) + '"></div></div>' +

      '<div class="pdp__info">' +
      (p.badge ? '<div class="eyebrow" style="margin-bottom:8px">' + U.esc(p.badge) + '</div>' : '') +
      '<div class="pdp__title">' +
      '<h1>' + U.esc(p.title) + '</h1>' +
      '<button class="wishbtn' + (window.Account && window.Account.hasWish(p.id) ? ' on' : '') + '" data-act="wish" data-pid="' + p.id + '" ' +
      'aria-label="Save to wishlist" title="Save to wishlist">' +
      ui.icon(window.Account && window.Account.hasWish(p.id) ? 'heartFull' : 'heart') + '</button>' +
      '</div>' +
      '<div class="pdp__rate"><span class="st">' + U.stars(Number(avg)) + '</span>' +
      '<span>' + avg + ' · ' + (revs.length || p.reviewCount) + ' reviews</span></div>' +
      '<div class="pdp__price"><b>' + U.money(selMetal.price) + '</b>' +
      (p.compareAt ? '<s>' + U.money(p.compareAt) + '</s><em>Save ' + U.money0(save) + '</em>' : '') + '</div>' +
      '<div class="pdp__tax">Duties included</div>' +
      '<div class="eta">' + ui.icon('truck') + '<span>' + ui.etaText(7, 12) + '</span></div>' +

      '<ul class="usp-list">' +
      '<li>' + ui.icon('shield') + '<span><b>Lifetime colour guarantee.</b> If it fades, we replace it once.</span></li>' +
      '<li>' + ui.icon('shield') + '<span><b>Waterproof &amp; tarnish-free.</b> 0.8 micron PVD — swim, shower, sleep in it.</span></li>' +
      '<li>' + ui.icon('shield') + '<span><b>Hypoallergenic 316L steel.</b> Nickel-safe, no green wrists.</span></li>' +
      '<li>' + ui.icon('truck') + '<span><b>Free shipping over $' + S.DB.settings.freeShip + '.</b> Tracked, no surprise fees.</span></li>' +
      '</ul>' +

      '<div class="opt"><div class="opt__hd"><span>Finish</span><b>' + selMetal.metal + '</b></div>' +
      '<div class="swatches">' + metalBtns + '</div></div>' +

      (p.sizes.length ? '<div class="opt"><div class="opt__hd"><span>Length</span><b>' + selSize + '</b></div>' +
        '<div class="sizes">' + sizeBtns + '</div></div>' : '') +

      '<div class="qtyrow">' +
      '<span class="stepper"><button data-act="pdpq" data-d="-1">' + ui.icon('minus') + '</button>' +
      '<input id="pdpQty" value="1" readonly><button data-act="pdpq" data-d="1">' + ui.icon('plus') + '</button></span>' +
      '<button class="btn" data-act="add-open" data-pid="' + p.id + '" data-metal="' + selMetal.metal + '" data-size="' + selSize + '"' +
      (stock <= 0 ? ' disabled' : '') + '>' + (stock <= 0 ? 'Sold out' : 'Add to bag') + '</button></div>' +
      stockNote +

      '<div class="acc">' +
      '<div class="acc__item open"><button class="acc__hd" data-act="acc">Materials &amp; care <i>−</i></button>' +
      '<div class="acc__body"><dl>' + dt + '</dl>' +
      '<p style="margin-top:10px">Rinse with fresh water after salt or chlorine. Dry with a soft cloth. No polish needed.</p></div></div>' +
      '<div class="acc__item"><button class="acc__hd" data-act="acc">Shipping &amp; duties <i>+</i></button>' +
      '<div class="acc__body">Free standard shipping over $' + S.DB.settings.freeShip + ', otherwise $' + S.DB.settings.standardShip + '. Express $' + S.DB.settings.expressShip + ' (3–5 days). All duties and taxes are included in the price — nothing to pay on delivery.</div></div>' +
      '<div class="acc__item"><button class="acc__hd" data-act="acc">Returns <i>+</i></button>' +
      '<div class="acc__body">30 days from delivery, unworn, in original packaging. Made-to-order and engraved pieces are final sale. Return shipping is on us for US orders.</div></div>' +
      '<div class="acc__item"><button class="acc__hd" data-act="acc">Lifetime colour guarantee <i>+</i></button>' +
      '<div class="acc__body">If the colour fades at any point, we replace the piece once. You cover half the return shipping. No receipt needed — we can find your order by email.</div></div>' +
      '</div></div></div>' +

      '<div class="pdp-sec"><h2>Reviews (' + (revs.length || p.reviewCount) + ')</h2>' +
      '<div style="display:flex;gap:30px;align-items:center;margin-bottom:22px;flex-wrap:wrap">' +
      '<div style="font-family:var(--serif);font-size:46px;line-height:1">' + avg + '</div>' +
      '<div><div style="color:var(--brass);letter-spacing:3px;font-size:13px">' + U.stars(Number(avg)) + '</div>' +
      '<div style="font-size:11px;color:var(--muted)">Based on ' + (revs.length || p.reviewCount) + ' verified purchases</div></div></div>' +
      '<div class="rev-list">' + (revs.length ? revs.map(function (x) {
        return '<div class="rev-row"><div class="rev-row__meta"><b>' + U.esc(x.name) + '</b>' +
          '<span class="st">' + U.stars(x.rating) + '</span>' +
          '<div>' + U.mo(x.monthsOwned) + ' in</div>' +
          (x.verified ? '<div class="verified">✓ Verified</div>' : '') + '</div>' +
          '<div><b style="font-size:12.5px;color:var(--ink)">' + U.esc(x.title) + '</b>' +
          '<p style="font-size:12.5px;color:var(--muted);margin:5px 0 0">' + U.esc(x.body) + '</p></div></div>';
      }).join('') : '<p style="color:var(--muted);font-size:12.5px">No reviews yet — be the first.</p>') + '</div></div>' +

      (related.length ? '<div class="pdp-sec"><h2>You may also like</h2><div class="grid">' +
        related.map(function (x) { return ui.productCard(x); }).join('') + '</div></div>' : '') +
      '</div>';
  }

  /* ---------------- 搜索 ---------------- */
  function searchPage(r) {
    var q = (r.query.q || '').trim();
    var list = [];
    if (q) {
      var k = q.toLowerCase();
      list = S.allProducts().filter(function (p) {
        return (p.title + ' ' + p.motif + ' ' + p.desc + ' ' + p.collections.join(' ')).toLowerCase().indexOf(k) >= 0;
      });
    }
    return '<div class="wrap"><div class="coll-head"><h1>' +
      (q ? 'Results for “' + U.esc(q) + '”' : 'Search') + '</h1>' +
      '<p>' + (q ? list.length + ' pieces found' : 'Try a motif, a metal, or a mood.') + '</p></div>' +
      '<form class="sform" data-act="searchpage" style="max-width:520px;margin:-18px 0 34px">' +
      '<div class="sform__row">' +
      '<input name="q" type="search" value="' + U.esc(q) + '" placeholder="Search a motif, metal or collection" aria-label="Search products">' +
      '<button class="btn" type="submit">Search</button>' +
      '</div>' +
      '<div class="sform__hint">Popular: ' +
      ['turtle', 'moon', 'pearl', 'hoop', 'anklet'].map(function (w) {
        return '<a href="#/search?q=' + w + '" class="link-u">' + w + '</a>';
      }).join(' · ') +
      '</div></form>' +
      (list.length ? '<div class="grid" style="padding-bottom:50px">' +
        list.map(function (p) { return ui.productCard(p); }).join('') + '</div>'
        : '<div class="empty"><h3>No matches</h3><p>We could not find anything for that. Try “turtle”, “moon”, or “pearl”.</p>' +
        '<a class="btn btn--ghost" href="#/collections/best-sellers">Browse best sellers</a></div>') + '</div>';
  }

  /* ---------------- 结算 ---------------- */
  /* ---------------- 支付（卡 / Apple Pay / Google Pay） ---------------- */
  function luhn(num) {
    var s = String(num).replace(/\D/g, '');
    if (s.length < 13 || s.length > 19) return false;
    var sum = 0, alt = false;
    for (var i = s.length - 1; i >= 0; i--) {
      var n = Number(s.charAt(i));
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }
  function groupCard(v) {
    return String(v).replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }
  function expiryOk(v) {
    var m = String(v).replace(/\s/g, '').match(/^(\d{1,2})\/?(\d{2})$/);
    if (!m) return false;
    var mm = Number(m[1]), yy = 2000 + Number(m[2]);
    if (mm < 1 || mm > 12) return false;
    var now = new Date();
    return yy > now.getFullYear() || (yy === now.getFullYear() && mm >= now.getMonth() + 1);
  }
  function payMethod() { return (S.state.checkoutPay || {}).method || 'card'; }

  function payPanel() {
    var d = S.state.checkoutData || (S.state.checkoutData = {});
    // 默认值必须同时写进 state。否则输入框里明明显示着 4242 / 04 / 28，
    // 点 Pay 却报「日期不完整」—— 因为校验读的是 state，而 state 是空的。
    if (!d.cardNumber) d.cardNumber = '4242 4242 4242 4242';
    if (!d.expiry) d.expiry = '04 / 28';
    if (!d.cvc) d.cvc = '123';
    if (!d.cardZip) d.cardZip = d.zip || '';
    var method = payMethod();
    var chips = [['card', 'Card'], ['apple', 'Apple Pay'], ['google', 'Google Pay']].map(function (m) {
      return '<button type="button" class="paytab' + (method === m[0] ? ' on' : '') + '" data-act="pay-method" data-m="' + m[0] + '">' + m[1] + '</button>';
    }).join('');

    var inner;
    if (method === 'card') {
      inner = '<div class="cardfield"><div class="cardfield__row">' +
        '<input name="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="Card number" value="' + U.esc(d.cardNumber || '4242 4242 4242 4242') + '">' +
        '<span class="cardbrand"><i class="v">VISA</i><i class="m">MC</i></span></div>' +
        '<div style="display:flex;gap:8px">' +
        '<input name="expiry" inputmode="numeric" placeholder="MM / YY" style="width:112px" value="' + U.esc(d.expiry || '04 / 28') + '">' +
        '<input name="cvc" inputmode="numeric" maxlength="4" placeholder="CVC" style="width:82px" value="' + U.esc(d.cvc || '123') + '">' +
        '<input name="cardZip" inputmode="numeric" placeholder="ZIP" style="width:92px" value="' + U.esc(d.cardZip || d.zip || '') + '">' +
        '</div>' +
        '<div class="testrow"><span>Test cards</span>' +
        [['4242424242424242', 'succeeds'], ['4000000000000002', 'declined'], ['4000000000009995', 'no funds']].map(function (c) {
          return '<button type="button" data-act="testcard" data-num="' + c[0] + '">' +
            c[0].replace(/(\d{4})(?=\d)/g, '$1 ') + ' · ' + c[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="cardnote">' + ui.icon('lock') + ' Prototype only — no real charge is made.</div></div>';
    } else {
      inner = '<div class="walletbox">' +
        '<div class="walletbox__lg">' + (method === 'apple' ? 'Apple Pay' : 'Google Pay') + '</div>' +
        '<p>' + (method === 'apple'
          ? 'Confirm with Face ID or Touch ID.'
          : 'Confirm with your Google account.') +
        ' We never see your card number, and nothing is shared with the merchant.</p>' +
        '</div>';
    }

    return chips ? '<div class="paytabs">' + chips + '</div>' + inner : inner;
  }

  function payBtnLabel(t) {
    var amt = U.money(t.total), m = payMethod();
    if (m === 'apple') return 'Pay ' + amt + ' with Apple Pay';
    if (m === 'google') return 'Pay ' + amt + ' with Google Pay';
    return 'Pay ' + amt;
  }

  function checkout() {
    var lines = S.cartLines().filter(function (l) { return !l.isGift; });
    if (!lines.length) {
      return '<div class="wrap"><div class="empty" style="padding:100px 0"><h3>Your bag is empty</h3>' +
        '<p>Add a piece before checking out.</p><a class="btn" href="#/collections/best-sellers">Shop best sellers</a></div></div>';
    }
    var t = S.totals();
    var step = S.state.checkoutStep;
    var d = S.state.checkoutData || (S.state.checkoutData = {});

    // 已登录：首次进入结算时带出邮箱与默认地址，并把邮箱锁住。
    // 锁住的原因很实际 —— 订单靠邮箱归属用户，如果这里能改成别的邮箱，
    // 付完钱在「我的账户」里就查不到了。
    if (S.state.user && !d.email) {
      var u = S.state.user;
      d.email = u.email;
      d.first = d.first || u.first || '';
      d.last = d.last || u.last || '';
      var da = (u.addresses || []).filter(function (x) { return x.isDefault; })[0] || (u.addresses || [])[0];
      if (da && !d.line1) {
        d.line1 = da.line1; d.line2 = da.line2 || '';
        d.city = da.city; d.state = da.state; d.zip = da.zip;
        d.country = da.country || 'United States';
      }
    }
    var f = function (n, label, extra) {
      var val = d[n] || '';
      var cls = d['_err_' + n] ? ' err' : '';
      return '<div class="fld' + (d['_err_' + n] ? ' bad' : '') + '"><label>' + label + '</label>' +
        '<input name="' + n + '" value="' + U.esc(val) + '" class="' + cls + '" ' + (extra || '') + '>' +
        '<div class="fld__err">' + (d['_err_' + n] || '') + '</div></div>';
    };

    var summary = '<div class="paysum"><h4>Order summary</h4>' +
      lines.map(function (l) {
        return '<div class="paysum__line"><img src="' + l.image + '" alt="">' +
          '<div>' + U.esc(l.title) + '<span>' + U.esc(l.metal) + (l.size ? ' / ' + l.size : '') + ' · ×' + l.qty + '</span></div>' +
          '<div class="mono" style="font-size:11.5px">' + U.money(l.unitPrice * l.qty) + '</div></div>';
      }).join('') +
      (t.giftUnlocked ? '<div class="paysum__line"><img src="assets/img/opt/p-necklace-pearl-gold.jpg" alt="">' +
        '<div>Pearl Studs<span>Free gift</span></div><div class="mono" style="font-size:11.5px;color:var(--brass)">$0.00</div></div>' : '') +
      '<div class="sum" style="margin-top:14px">' +
      '<div class="sum__row"><span>Subtotal</span><span>' + U.money(t.subtotal) + '</span></div>' +
      (t.discount > 0 ? '<div class="sum__row disc"><span>Discount (' + S.state.coupon.code + ')</span><span>−' + U.money(t.discount) + '</span></div>' : '') +
      '<div class="sum__row"><span>Shipping</span><span>' + (t.shipping ? U.money(t.shipping) : 'Free') + '</span></div>' +
      '<div class="sum__row"><span>Duties &amp; tax</span><span>Included</span></div>' +
      '<div class="sum__row tot"><span>Total</span><span>' + U.money(t.total) + '</span></div></div>' +
      '<div class="secure">' + ui.icon('lock') + ' Encrypted checkout · powered by Stripe</div></div>';

    var steps = '<div class="co__steps">' +
      '<div class="co__step ' + (step === 1 ? 'on' : 'is-done') + '"><span>Information</span></div>' +
      '<div class="co__step ' + (step === 2 ? 'on' : '') + '"><span>Payment</span></div></div>';

    var left;
    if (step === 1) {
      left = steps +
        '<div class="co__block"><h3>Contact</h3>' +
        (S.state.user
          ? '<div class="locked"><span>' + ui.icon('user') + ' Signed in as <b>' + U.esc(S.state.user.email) + '</b></span>' +
          '<a class="link-u" href="#/account/settings">Change</a></div>'
          : f('email', 'Email', 'type="email" placeholder="you@email.com"')) +
        '<label style="display:flex;gap:8px;align-items:center;font-size:11.5px;color:var(--muted);margin-top:6px">' +
        '<input type="checkbox" checked style="width:auto;accent-color:#1B3A34"> Email me order updates</label></div>' +
        '<div class="co__block"><h3>Shipping address</h3>' +
        '<div class="row2">' + f('first', 'First name') + f('last', 'Last name') + '</div>' +
        f('line1', 'Address') +
        '<div class="row3">' + f('city', 'City') + f('state', 'State') + f('zip', 'ZIP') + '</div>' +
        '<div class="fld"><label>Country</label><select name="country" data-act="country">' +
        ['United States', 'Canada', 'United Kingdom'].map(function (c) {
          return '<option' + ((d.country || 'United States') === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('') + '</select></div>' +
        '</div>' +
        '<div class="co__block"><h3>Shipping method</h3>' +
        '<label class="shipopt ' + ((d.shipping || 'Standard') === 'Standard' ? 'on' : '') + '">' +
        '<input type="radio" name="ship" value="Standard" data-act="ship" ' + ((d.shipping || 'Standard') === 'Standard' ? 'checked' : '') + '>' +
        '<div><b>Standard · 7–12 days</b><span>Tracked, duties included</span>' +
        '<span class="co__eta">' + ui.etaText(7, 12, 'Arrives ') + '</span></div>' +
        '<span class="pr">' + (t.freeShip ? 'Free' : U.money(S.DB.settings.standardShip)) + '</span></label>' +
        '<label class="shipopt ' + (d.shipping === 'Express' ? 'on' : '') + '">' +
        '<input type="radio" name="ship" value="Express" data-act="ship" ' + (d.shipping === 'Express' ? 'checked' : '') + '>' +
        '<div><b>Express · 3–5 days</b><span>Priority handling</span>' +
        '<span class="co__eta">' + ui.etaText(2, 4, 'Arrives ') + '</span></div>' +
        '<span class="pr">' + U.money(S.DB.settings.expressShip) + '</span></label></div>' +
        '<button class="btn btn--full" data-act="to-pay">Continue to payment</button>' +
        '<p style="font-size:10px;text-align:center;margin-top:12px;color:var(--muted)">No account needed. Track your order with the link we email you.</p>';
    } else {
      var pay = S.state.checkoutPay || (S.state.checkoutPay = { method: 'card' });
      left = steps +
        '<div class="co__block co__block--pay">' +
        payPanel() +
        (pay.err ? '<div class="payerr">' + ui.icon('close') + '<span>' + U.esc(pay.err) + '</span></div>' : '') +
        f('note', 'Order note (optional)', 'placeholder="Gift message, delivery instructions…"') +
        '</div>' +
        '<div class="co__block co__block--slim">' +
        '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:7px"><span style="color:var(--muted)">Ship to</span>' +
        '<span>' + U.esc((d.first || '') + ' ' + (d.last || '')) + ', ' + U.esc(d.city || '') + ' ' + U.esc(d.zip || '') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--muted)">Email</span>' +
        '<span>' + U.esc(d.email || '') + '</span></div></div>' +
        '<button class="btn btn--full" data-act="place" id="placeBtn">' + payBtnLabel(t) + '</button>' +
        '<div style="display:flex;justify-content:space-between;margin-top:14px;font-size:10.5px;color:var(--muted)">' +
        '<button data-act="back-info" style="text-decoration:underline">← Back to information</button>' +
        '<span>30-day returns on every order</span></div>';
    }

    return '<div class="wrap"><div class="crumbs"><a href="#/">Home</a><span>/</span>Checkout</div>' +
      '<div class="co"><div>' + left + '</div>' + summary + '</div></div>';
  }

  /* ---------------- 订单完成 ---------------- */
  function orderDone(r) {
    // 订单号形如 #TG1132，URL 里需转义成 %23；这里兼容三种写法：
    // %23TG1132 / TG1132 / #TG1132
    var key = String(r.seg[1] || '');
    try { key = decodeURIComponent(key); } catch (e) { }
    var bare = key.replace(/^#/, '');
    // 以 URL 为准；只有当 URL 里没带订单号时，才回退到刚下的那一单
    var order = key ? S.DB.orders.filter(function (o) {
      return o.number === key || o.number === '#' + bare;
    })[0] : S.state.lastOrder;
    if (!order) return notFound();
    return '<div class="wrap"><div class="orderdone">' +
      '<div class="done__ic">' + ui.icon('check') + '</div>' +
      '<h1>Thank you — it\'s on its way</h1>' +
      '<p>We sent a confirmation to <b>' + U.esc(order.email) + '</b>. Your order ships within 1–2 business days.</p>' +
      '<div class="done__box"><dl>' +
      '<dt>Order number</dt><dd class="mono" style="font-weight:600">' + U.esc(order.number) + '</dd>' +
      '<dt>Total paid</dt><dd>' + U.money(order.total) + '</dd>' +
      '<dt>Shipping to</dt><dd>' + U.esc((order.address && order.address.city) || '') + ', ' + U.esc((order.address && order.address.country) || 'United States') + '</dd>' +
      '<dt>Method</dt><dd>' + U.esc(order.shippingMethod) + '</dd>' +
      '<dt>Items</dt><dd>' + order.items.map(function (i) { return U.esc(i.title) + ' ×' + i.qty; }).join('<br>') + '</dd>' +
      '</dl></div>' +
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
      (function () {
        // 登录用户直接进账户里的订单详情；访客才走订单号 + 邮箱查单
        var mine = S.state.user && String(order.email || '').toLowerCase() === S.state.user.email.toLowerCase();
        return '<a class="btn" href="' + (mine
          ? '#/account/orders/' + encodeURIComponent(order.number)
          : '#/account/lookup') + '">Track this order</a>';
      })() +
      '<a class="btn btn--ghost" href="#/collections/best-sellers">Keep shopping</a></div>' +
      '<p style="font-size:10.5px;margin-top:20px;color:var(--muted)">' +
      (S.state.user && String(order.email || '').toLowerCase() === S.state.user.email.toLowerCase()
        ? 'This order is saved to your account — no need to keep the number.'
        : 'Save your order number — you\'ll need it plus your email to track.') + '</p>' +
      '</div></div>';
  }

  /* ---------------- 订单查询 ---------------- */
  function account(r) {
    var res = S.state.lookup;
    var box = '';
    if (res) {
      if (res.ok) {
        var o = res.order;
        var steps = ['paid', 'fulfilling', 'fulfilled', 'completed'];
        var idx = steps.indexOf(o.status);
        var timeline = ['Paid', 'Preparing', 'Shipped', 'Delivered'].map(function (lbl, i) {
          var cls = i <= idx ? 'on' : '';
          return '<div style="flex:1;text-align:center;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:' +
            (i <= idx ? 'var(--sea)' : 'var(--muted-2)') + '"><div style="height:2px;background:' +
            (i <= idx ? 'var(--sea)' : 'var(--line)') + ';margin-bottom:8px"></div>' + lbl + '</div>';
        }).join('');
        box = '<div class="done__box" style="margin-top:24px">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">' +
          '<b class="mono">' + U.esc(o.number) + '</b><span class="pill ' + o.status + '">' + U.esc(o.statusLabel) + '</span></div>' +
          '<div style="display:flex;gap:0;margin-bottom:20px">' + timeline + '</div>' +
          '<dl>' +
          '<dt>Placed</dt><dd>' + U.fmtDate(o.createdAt) + '</dd>' +
          '<dt>Items</dt><dd>' + o.items.map(function (i) { return U.esc(i.title) + ' ×' + i.qty; }).join('<br>') + '</dd>' +
          '<dt>Total</dt><dd>' + U.money(o.total) + '</dd>' +
          '<dt>Tracking</dt><dd>' + (o.tracking ? '<span class="mono">' + U.esc(o.tracking) + '</span>' : 'Not shipped yet') + '</dd>' +
          '</dl></div>';
      } else {
        box = '<div class="warn" style="margin-top:24px;border-left:3px solid var(--clay);background:#FBF0EC;padding:14px 18px;font-size:12.5px">' +
          'No order found with that combination. Check the order number and the email you used at checkout.</div>';
      }
    }

    return '<div class="wrap"><div class="acct">' +
      '<h1>Track your order</h1>' +
      '<p>Enter your order number and the email you checked out with. No account needed.</p>' +
      '<form data-act="lookup">' +
      '<div class="fld"><label>Order number</label><input name="number" placeholder="#TG1041"></div>' +
      '<div class="fld"><label>Email</label><input name="email" type="email" placeholder="you@email.com"></div>' +
      '<button class="btn btn--full" type="submit" style="margin-top:8px">Find my order</button></form>' +
      box +
      '<div style="margin-top:34px;padding-top:20px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted)">' +
      '<p style="margin-bottom:6px">Just placed an order? Your number starts with <b>#TG</b> and was emailed to you.</p>' +
      '<p>Need help? <a href="#/pages/contact" class="link-u">Contact us</a> — we answer within one business day.</p></div>' +
      '</div></div>';
  }

  /* ---------------- 内容页 ---------------- */
  var PAGES = {
    about: {
      title: 'Our story', body:
        '<p>TIDEGLASS started with a green wrist.</p>' +
        '<p>Every summer, a new “waterproof” necklace; every September, a green mark where it used to be. The coatings were pretending to be gold, and the metal underneath was pretending to be jewellery.</p>' +
        '<p>So we stopped pretending. We use 316L surgical stainless steel — the same alloy used in surgical implants, because it does not react with skin — and finish it with a PVD layer measured in microns, applied in a vacuum chamber rather than a bath.</p>' +
        '<h3>What that means in practice</h3>' +
        '<p>You can swim in it. You can shower in it. You can sleep in it for a year and the colour will still be there. It will pick up fine scratches, because steel is honest about being touched. What it will not do is turn your skin green.</p>' +
        '<h3>And if it does fade</h3>' +
        '<p>We replace it once, free. You cover half the return shipping. No receipt needed — we can find your order by email. That promise is the reason we only use suppliers we have audited, and the reason we keep a sample from every production batch.</p>'
    },
    materials: {
      title: 'Materials', body:
        '<p>Three materials, chosen for one reason: they survive salt water.</p>' +
        '<h3>316L surgical steel</h3>' +
        '<p>A low-carbon stainless alloy with molybdenum, which is what gives it resistance to chlorides — salt. It is nickel-safe for most sensitive skin, and it does not pit or turn green.</p>' +
        '<h3>PVD colour layer</h3>' +
        '<p>Physical Vapour Deposition: the colour layer is deposited atom by atom in a vacuum chamber at around 400°C. It bonds to the steel rather than sitting on top of it. Our standard is 0.8 micron, roughly four times the thickness of decorative plating.</p>' +
        '<table><tr><th>Finish</th><th>Layer</th><th>Wear test</th></tr>' +
        '<tr><td>18k gold tone</td><td>TiN + Au alloy, 0.8 µm</td><td>200 h salt spray, no colour shift</td></tr>' +
        '<tr><td>Silver tone</td><td>ZrN, 0.6 µm</td><td>200 h salt spray, no colour shift</td></tr>' +
        '<tr><td>Rose tone</td><td>TiCN + Au, 0.7 µm</td><td>180 h salt spray, no colour shift</td></tr></table>' +
        '<h3>Freshwater pearls</h3>' +
        '<p>Cultured, not dyed, graded AA for lustre. Set on steel posts so the pearl is the only thing touching your ear.</p>'
    },
    care: {
      title: 'Care guide', body:
        '<p>Short version: wear it, rinse it, forget it.</p>' +
        '<h3>Everyday</h3>' +
        '<ul><li>Rinse with fresh water after swimming in the sea or a pool.</li>' +
        '<li>Dry with a soft cloth — do not let salt water dry on the surface.</li>' +
        '<li>No polish, no ultrasonic cleaner, no toothpaste.</li></ul>' +
        '<h3>What to avoid</h3>' +
        '<ul><li>Chlorine for long periods (a shower is fine, a two-hour pool session is fine, a week in a hot tub is not).</li>' +
        '<li>Perfume sprayed directly on the piece — alcohol slowly dulls the PVD layer.</li>' +
        '<li>Storing two pieces loose in a bag; they will scratch each other.</li></ul>' +
        '<h3>Scratches</h3>' +
        '<p>Fine scratches are normal and part of the material ageing. They read as patina, not damage. Deep gouges are covered by our colour guarantee if they come from a manufacturing fault.'
    },
    shipping: {
      title: 'Shipping & duties', body:
        '<p>Everything ships from our warehouse in the United States. Prices include duties — there is nothing to pay on delivery.</p>' +
        '<table><tr><th>Method</th><th>Cost</th><th>Time</th></tr>' +
        '<tr><td>Standard (US)</td><td>Free over $95, otherwise $6.90</td><td>7–12 business days</td></tr>' +
        '<tr><td>Express (US)</td><td>$18</td><td>3–5 business days</td></tr>' +
        '<tr><td>Canada &amp; UK</td><td>Calculated at checkout</td><td>8–14 business days</td></tr></table>' +
        '<h3>Tracking</h3>' +
        '<p>You get a tracking link by email the moment your parcel leaves the warehouse. You can also track with your order number on the <a href="#/account/lookup" class="link-u">order lookup page</a>.</p>' +
        '<h3>Customs</h3>' +
        '<p>Duties and import taxes are prepaid at checkout for the US, Canada and the UK. If a carrier ever asks you for payment, send us the receipt and we refund it in full.'
    },
    returns: {
      title: 'Returns & exchanges', body:
        '<p>30 days from delivery, unworn, in the original packaging. Return shipping is on us for US orders.</p>' +
        '<h3>How</h3>' +
        '<ol style="padding-left:18px"><li>Find your order on the <a href="#/account/lookup" class="link-u">lookup page</a>.</li>' +
        '<li>Reply to your confirmation email with the piece you want to send back.</li>' +
        '<li>We email a prepaid label within one business day.</li>' +
        '<li>Refund lands 3–5 days after the parcel is scanned.</li></ol>' +
        '<h3>Exceptions</h3>' +
        '<ul><li>Engraved and made-to-order pieces are final sale.</li>' +
        '<li>Earrings can be returned only if the hygiene seal is unbroken.</li>' +
        '<li>Items bought during a final sale event are exchange-only.</li></ul>' +
        '<h3>Colour guarantee claims</h3>' +
        '<p>These are not returns — they are replacements, and the 30-day window does not apply. Send a photo of the faded area and we ship a replacement once, at any point in the piece\'s life.'
    },
    faq: {
      title: 'FAQ', body:
        '<h3>Will it turn my skin green?</h3><p>No. 316L steel does not contain the copper or nickel that causes green marks. If you have reacted to costume jewellery before, this is usually the safe option.</p>' +
        '<h3>Can I wear it in the sea?</h3><p>Yes — that is the whole point. Rinse with fresh water afterwards.</p>' +
        '<h3>Does it work for sensitive ears?</h3><p>Our earrings use steel posts. Most people with nickel sensitivity are fine; if you react to steel jewellery generally, talk to us before ordering.</p>' +
        '<h3>How long does the gold colour last?</h3><p>With normal wear, years. The PVD layer is 0.8 micron, and it is covered by the lifetime colour guarantee.</p>' +
        '<h3>Do you ship to Canada and the UK?</h3><p>Yes, with duties prepaid.</p>' +
        '<h3>Can I order without an account?</h3><p>Yes. Checkout is guest-only — you track orders with your order number and email.</p>' +
        '<h3>Gift wrapping?</h3><p>Every order ships in a cotton pouch inside a recycled box with a card. Add a message at checkout.</p>'
    },
    'size-guide': {
      title: 'Size guide', body:
        '<p>Necklace lengths are measured end to end, including the clasp.</p>' +
        '<table><tr><th>Length</th><th>Sits</th><th>Best for</th></tr>' +
        '<tr><td>14 in / 36 cm</td><td>At the throat</td><td>Chokers, layering close</td></tr>' +
        '<tr><td>16 in / 41 cm</td><td>Base of the neck</td><td>Most pendants</td></tr>' +
        '<tr><td>18 in / 46 cm</td><td>Below the collarbone</td><td>Everyday, layering</td></tr>' +
        '<tr><td>20 in / 51 cm</td><td>Upper chest</td><td>Longer pendants, over knits</td></tr></table>' +
        '<h3>Rings</h3>' +
        '<p>Wrap a strip of paper around your finger, mark where it meets, and measure the length in millimetres. That number is your circumference — match it to the chart below.</p>' +
        '<table><tr><th>US</th><th>Circumference</th></tr><tr><td>6</td><td>51.9 mm</td></tr>' +
        '<tr><td>7</td><td>54.4 mm</td></tr><tr><td>8</td><td>57.0 mm</td></tr><tr><td>9</td><td>59.5 mm</td></tr></table>' +
        '<h3>Anklets</h3><p>Add 1.5 cm to your ankle circumference for a comfortable fit. All our anklets have a 3 cm extender.</p>'
    },
    contact: {
      title: 'Contact', body:
        '<p>We answer every email within one business day, usually faster.</p>' +
        '<h3>Customer care</h3><p><b>hello@tideglass.co</b><br>Monday–Friday, 9am–6pm EST</p>' +
        '<h3>Colour guarantee claims</h3><p>Include a photo of the piece and the email you ordered with. No receipt needed.</p>' +
        '<h3>Wholesale &amp; press</h3><p><b>trade@tideglass.co</b></p>' +
        '<h3>Workshop</h3><p>TIDEGLASS<br>Rua do Mar 42, Porto, Portugal<br>and Guangzhou, China</p>'
    }
  };

  function contentPage(r) {
    var slug = r.seg[1] || 'about';
    var p = PAGES[slug];
    if (!p) return notFound();
    var keys = Object.keys(PAGES);
    return '<div class="wrap"><div class="page">' +
      '<nav class="page__toc">' + keys.map(function (k) {
        return '<a href="#/pages/' + k + '"' + (k === slug ? ' style="color:var(--sea);border-left-color:var(--brass)"' : '') + '>' + PAGES[k].title + '</a>';
      }).join('') + '</nav>' +
      '<div class="page__body"><h1>' + p.title + '</h1>' + p.body + '</div>' +
      '</div></div>';
  }

  function notFound() {
    return '<div class="wrap"><div class="nf"><h1>404</h1>' +
      '<p>This page slipped off the boat.</p>' +
      '<a class="btn" href="#/">Back to home</a></div></div>';
  }

  window.Store = {
    home: home, collection: collection, product: productPage, search: searchPage,
    checkout: checkout, orderDone: orderDone, account: account,
    content: contentPage, notFound: notFound, PAGES: PAGES,
    luhn: luhn, expiryOk: expiryOk, groupCard: groupCard
  };
})();
