/* ============================================================
   LASTGROVE Web · 视图层
   每个函数只接收「已经从 API 取到的数据」，不自己发请求，
   也不读 localStorage —— 渲染与取数分离，便于单测与替换。
   ============================================================ */
(function () {
  'use strict';

  var U = S.U, ui = window.UI;

  function money(n) { return U.money(n); }
  function esc(s) { return U.esc(s); }

  /* ---------------- 首页 ---------------- */
  function home(boot, best, reviews, stats) {
    var c = boot.settings;
    /* 三张轮播图原始比例并不相同：首图 1100×1375 是竖构图，另两张是 1:1。
       宽高按各自的真实尺寸给，别统一抄 1100×1375——否则第二、三张在
       图还没下完时占位框比例是错的，切换轮播会看到一次轻微跳动。 */
    var heroImgs = [
      { s: 'assets/img/opt/hero-necklaces.jpg', w: 1100, h: 1375 },
      { s: 'assets/img/opt/c-ocean.jpg', w: 820, h: 820 },
      { s: 'assets/img/opt/p-necklace-moon-silver.jpg', w: 900, h: 900 }
    ];
    var slides = heroImgs.map(function (it, i) {
      return U.pic(it.s, {
        alt: '', w: it.w, h: it.h, cls: (i === 0 ? 'on' : ''),
        sizes: '100vw', priority: i === 0,
        /* 只有第一张是首屏必须的。这个轮播没有自动播放，第 2、3 张
           只有用户点圆点才会露出来，先挂起，点的时候再取。 */
        defer: i > 0
      });
    }).join('');
    var parts = String(c.heroTitle || 'Made for|salt water.').split('|');
    var heroTitle = '<h1>' + esc(parts[0] || '') + (parts[1] ? '<br><em>' + esc(parts[1]) + '</em>' : '') + '</h1>';

    /* 「三个世界」的入口图片和链接只指向真实存在的集合。
       原来写死 best-sellers / woodland / celestial 三个 handle，
       后两个库里没有，点进去就是 404。 */
    var worldDefs = [
      { h: 'best-sellers', t: 'Best sellers', s: 'The pieces everyone reorders.', i: 'assets/img/opt/c-ocean.jpg' },
      { h: 'new', t: 'New in', s: 'Fresh from the bench this month.', i: 'assets/img/opt/c-woodland.jpg' },
      { h: 'ocean', t: 'Ocean', s: 'Deep water tones, salt-worn edges.', i: 'assets/img/opt/c-celestial.jpg' },
    ];
    var have = (S.DB.collections || []).map(function (x) { return x.handle; });
    var worlds = worldDefs.filter(function (w) { return have.indexOf(w.h) >= 0; });
    if (worlds.length < 3) {
      /* 集合不够三个时，用「按金属 / 按价格 / 全部」这类永远可用的筛选入口补位 */
      var extra = [
        { h: 'all', t: 'Shop all', s: 'Every piece currently in stock.', i: 'assets/img/opt/c-ocean.jpg' },
        { h: 'sale', t: 'Sale', s: 'Last few of each.', i: 'assets/img/opt/c-woodland.jpg' },
      ];
      extra.forEach(function (e) {
        if (worlds.length < 3 && !worlds.some(function (w) { return w.h === e.h; })) {
          if (e.h === 'all' || have.indexOf(e.h) >= 0) worlds.push(e);
        }
      });
    }
    var worldHtml = worlds.slice(0, 3).map(function (w) {
      return '<a class="tile" href="#/collections/' + w.h + '">' +
        U.pic(w.i, { alt: '', w: 820, h: 820, sizes: '(max-width:900px) 46vw, 30vw' }) +
        '<div class="tile__body"><h3>' + w.t + '</h3><p>' + w.s + '</p></div></a>';
    }).join('');

    var revs = (reviews || []).slice(0, 6).map(function (r) {
      return '<div class="rev"><div class="st">' + U.stars(r.rating) + '</div>' +
        '<b>' + esc(r.title || r.name) + '</b><p>' + esc((r.body || '').slice(0, 150)) + '</p>' +
        '<span>' + esc(r.name) + (r.verified ? ' · Verified buyer' : '') + '</span></div>';
    }).join('');

    /* 「7M+ pieces worn / 1.6M customers / 4.7 rating」原先写死在模板里，
       站里 0 客户 0 评价也照显示——这是虚假宣传，真站上是能告的。
       现在只显示库里的真实数字；一条评价都没有时，退回到可验证的产品事实。 */
    var st = stats || {};
    var proofCells = [];
    if (st.rating && st.reviewCount) {
      proofCells.push({ b: Number(st.rating).toFixed(1), s: 'Average rating' });
      proofCells.push({ b: st.reviewCount, s: st.reviewCount === 1 ? 'Verified review' : 'Verified reviews' });
    }
    if (st.productCount) proofCells.push({ b: st.productCount, s: 'Pieces in stock' });
    if (st.soldCount) proofCells.push({ b: st.soldCount, s: 'Pieces shipped' });

    var proof;
    if (proofCells.length >= 2) {
      proof = '<div class="proof">' + proofCells.slice(0, 3).map(function (x) {
        return '<div><b>' + esc(x.b) + '</b><span>' + esc(x.s) + '</span></div>';
      }).join('') + '</div>';
    } else {
      /* 没有任何交易数据时，只讲产品事实——这些每一句都能在详情页对上 */
      proof = '<div class="proof">' +
        '<div><b>0.8 µm</b><span>PVD colour layer</span></div>' +
        '<div><b>316L</b><span>Surgical steel</span></div>' +
        '<div><b>1–2 days</b><span>Dispatch, tracked</span></div></div>';
    }

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
      '<div><b>1 free</b>colour replacement</div>' +
      '<div><b>30 days</b>free returns</div>' +
      '</div></div>' +
      '<div class="hero__media" id="heroMedia">' + slides +
      '<div class="hero__dots">' + heroImgs.map(function (_, i) {
        return '<i class="' + (i === 0 ? 'on' : '') + '" data-act="slide" data-i="' + i + '"></i>';
      }).join('') + '</div></div></section>' +

      proof +

      '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">' +
      esc((S.DB.settings || {}).bestSellersEyebrow || 'Customer favorites') + '</div><h2>Best sellers</h2></div>' +
      '<div class="sec-head__arrow">' +
      '<button class="arrow-btn" data-act="rail" data-d="-1" data-target="railBest" aria-label="Scroll left">' + ui.icon('left') + '</button>' +
      '<button class="arrow-btn" data-act="rail" data-d="1" data-target="railBest" aria-label="Scroll right">' + ui.icon('right') + '</button>' +
      '</div></div>' +
      '<div class="rail" id="railBest">' + best.map(function (p) { return ui.productCard(p); }).join('') + '</div></div>' +

      (worldHtml ? '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">Shop by mood</div><h2>Three worlds</h2></div>' +
        '<a href="#/collections/all" class="link-u" style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase">All collections</a></div>' +
        '<div class="tiles">' + worldHtml + '</div></div>' : '') +

      '<section class="birth"><div class="wrap birth__in">' +
      '<div><div class="eyebrow">Made to be worn daily</div>' +
      '<h2>A colour that<br>doesn\'t wash off.</h2>' +
      '<p>Every piece starts as 316L surgical steel, then gets a 0.8 micron PVD layer bonded at 400°C. Salt water, sunscreen, shampoo — none of it gets through.</p>' +
      '<a href="#/pages/care" class="btn btn--ghost">How to care for it</a></div>' +
      '<div class="birth__tags"><span>Salt water</span><span>Sunscreen</span><span>Showers</span><span>Gym</span><span>Sleep</span></div>' +
      '</div></section>' +

      (revs ? '<div class="wrap"><div class="sec-head"><div><div class="eyebrow">' +
        (st.rating ? Number(st.rating).toFixed(1) + ' average · ' + st.reviewCount + ' reviews' : 'Reviews') +
        '</div><h2>What people say</h2></div></div>' +
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

  /* ---------------- 搜索结果页 ----------------
     这是一条独立路由（#/search?q=），不再借道某个集合。
     以前搜索被硬编码跳到 #/collections/best-sellers?q=ring，
     于是在 best-sellers 那几件里过滤——全站明明有 3 件戒指，
     用户看到的是「0 pieces」。搜索是电商第二入口，这条链断了等于没搜索。 */
  function search(q, items, meta, r) {
    var query = r.query || {};
    var sorts = [
      { v: 'featured', l: 'Featured' }, { v: 'new', l: 'Newest' }, { v: 'best', l: 'Best selling' },
      { v: 'price-asc', l: 'Price: low to high' }, { v: 'price-desc', l: 'Price: high to low' },
    ];
    function sortLink(v) {
      var p = [];
      if (q) p.push('q=' + encodeURIComponent(q));
      if (v && v !== 'featured') p.push('sort=' + v);
      return '#/search' + (p.length ? '?' + p.join('&') : '');
    }
    var sortSel = '<select class="sortsel" data-act="search-sort">' +
      sorts.map(function (s) {
        return '<option value="' + s.v + '"' + ((query.sort || 'featured') === s.v ? ' selected' : '') + '>' + s.l + '</option>';
      }).join('') + '</select>';

    var grid = items.length
      ? '<div class="grid">' + items.map(function (p) { return ui.productCard(p); }).join('') + '</div>'
      : '<div class="empty" style="padding:72px 0;text-align:center">' +
        '<h3>No pieces matched “' + esc(q) + '”</h3>' +
        '<p style="color:var(--muted);margin:10px 0 22px">Try a shorter word, or browse everything we have.</p>' +
        '<a class="btn" href="#/collections/all">Shop all</a></div>';

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/">Home</a><span>/</span>Search</div>' +
      '<div class="collhead"><h1>' + (q ? 'Results for “' + esc(q) + '”' : 'Search') + '</h1>' +
      '<p>' + meta.total + ' ' + (meta.total === 1 ? 'piece' : 'pieces') + (q ? '' : ' — tell us what you are after') + '</p></div>' +
      '<div class="fbar"><span class="fbar__count">' + meta.total + ' pieces</span>' +
      '<div class="fbar__sort"><span>Sort</span>' + sortSel + '</div></div>' +
      grid +
      (meta.hasMore ? '<div style="text-align:center;padding:36px 0"><a class="btn btn--ghost" href="#/search?q=' +
        encodeURIComponent(q) + '&page=' + (meta.page + 1) + '">Load more</a></div>' : '') +
      '</div>';
  }

  /* ---------------- 收藏 ----------------
     头部心形图标以前链到 #/account/wishlist，那条路由从没实现过，
     点进去落到「订单查询」——图标说 Wishlist、页面是查单。
     现在存 localStorage，访客可用，不做账号也能收藏。 */
  function wishlist(items) {
    if (!items.length) {
      return '<div class="wrap"><div class="collhead"><h1>Saved pieces</h1></div>' +
        '<div class="empty" style="padding:80px 0;text-align:center">' +
        '<h3>Nothing saved yet</h3>' +
        '<p style="color:var(--muted);margin:10px 0 22px">Tap the heart on any piece to keep it here.</p>' +
        '<a class="btn" href="#/collections/all">Browse the shop</a></div></div>';
    }
    return '<div class="wrap">' +
      '<div class="collhead"><h1>Saved pieces</h1>' +
      '<p>' + items.length + ' ' + (items.length === 1 ? 'piece' : 'pieces') + ' · kept on this device</p></div>' +
      '<div class="grid">' + items.map(function (p) { return ui.productCard(p); }).join('') + '</div></div>';
  }

  /* ---------------- 商品详情 ---------------- */
  function product(p, reviews, related, r, reviewStats) {
    var q = r.query || {};
    var vlist = p.variants;
    var sel = vlist.filter(function (v) { return v.metal === (q.metal || '') && v.inStock; })[0]
      || vlist.filter(function (v) { return v.inStock; })[0] || vlist[0];
    var selSize = q.size || (p.sizes[0] || '');
    var stock = sel.stock;
    var save = p.compareAt ? p.compareAt - p.price : 0;
    var rs = reviewStats || { count: 0, rating: 0, buckets: [] };
    var rated = rs.count > 0;

    var thumbs = (p.images || []).map(function (src, i) {
      return U.pic(src, {
        alt: '', w: 900, h: 900, cls: (i === 0 ? 'on' : ''), sizes: '76px',
        extra: 'data-act="thumb" data-i="' + i + '"'
      });
    }).join('');

    var metalBtns = vlist.map(function (v) {
      var cls = v.metal === 'Gold' ? 'gold' : v.metal === 'Silver' ? 'silver' : 'rose';
      return '<button class="sw-opt ' + cls + (v.metal === sel.metal ? ' on' : '') + '" ' +
        'data-act="metal" data-handle="' + esc(p.handle) + '" data-m="' + esc(v.metal) + '" ' +
        (v.stock ? '' : 'disabled ') + 'aria-label="' + esc(v.metal) + (v.stock ? '' : ' — sold out') + '" ' +
        'title="' + esc(v.metal) + (v.stock ? '' : ' — sold out') + '"></button>';
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
        (x.title ? '<b>' + esc(x.title) + '</b>' : '') +
        '<p>' + esc(x.body) + '</p>' +
        '<span>' + esc(x.name) + (x.verified ? ' · Verified buyer' : '') +
        (x.createdAt ? ' · ' + U.fmtShort(x.createdAt) : '') + '</span></div>';
    }).join('');

    /* 评分分布：5→1 每档一根条。
       没有分布数据时用户只看到「4.7」这个数字，无法判断是 100 个五星 + 1 个一星，
       还是刚好全是四星半——分布条是对评分最有效的佐证。 */
    var dist = rated ? '<div class="revdist">' + (rs.buckets || []).map(function (b) {
      var pct = rs.count ? Math.round(b.count / rs.count * 100) : 0;
      return '<div class="revdist__row"><span>' + b.star + ' star</span>' +
        '<i><em style="width:' + pct + '%"></em></i><b>' + b.count + '</b></div>';
    }).join('') + '</div>' : '';

    /* 评价提交表单。
       这条链路以前整个不存在：POST /api/v1/reviews 返 404，后台只有「审核」没有「新建」，
       从零开卖时评价区永远是空的。现在顾客能写，写完进待审核队列，后台通过后出现在这里。 */
    var writeForm = '<form class="revy" data-act="writereview" data-handle="' + esc(p.handle) + '">' +
      '<div class="revy__hd"><h4>' + (rated ? 'Write a review' : 'Be the first to review') + '</h4>' +
      '<p>' + (rated ? 'Bought this piece? Tell the next person what it is like.' : 'No reviews yet — yours would be the first.') + '</p></div>' +
      '<div class="revstars" role="radiogroup" aria-label="Your rating">' +
      [5, 4, 3, 2, 1].map(function (n) {
        return '<label><input type="radio" name="rating" value="' + n + '"' + (n === 5 ? ' checked' : '') + '>' +
          '<span>' + n + '★</span></label>';
      }).join('') + '</div>' +
      '<div class="fld"><label>Your name</label><input name="rname" required maxlength="60" placeholder="Alex" autocomplete="name"></div>' +
      '<div class="fld"><label>Email <span class="small">(not shown)</span></label>' +
      '<input name="remail" type="email" maxlength="120" placeholder="you@email.com" autocomplete="email"></div>' +
      '<div class="fld"><label>Headline <span class="small">(optional)</span></label>' +
      '<input name="rtitle" maxlength="120" placeholder="Wear it every day"></div>' +
      '<div class="fld"><label>Your review</label>' +
      '<textarea name="rbody" rows="4" required minlength="10" maxlength="2000" placeholder="How does it wear? Does the colour hold?"></textarea></div>' +
      '<div class="fld"><label>Order number <span class="small">(optional — marks it Verified)</span></label>' +
      '<input name="rorder" placeholder="#TG1041"></div>' +
      '<button class="btn" type="submit">Submit review</button>' +
      '<p class="small" style="color:var(--muted);margin:10px 0 0">Reviews appear once we have checked them — usually within a day.</p>' +
      '</form>';

    var rel = (related || []).map(function (x) {
      return '<a class="card card--mini" href="#/products/' + esc(x.handle) + '">' +
        '<div class="card__media">' + U.pic(x.image, { alt: '', w: 900, h: 900 }) + '</div>' +
        '<div class="card__body"><span class="card__title">' + esc(x.title) + '</span>' +
        '<span class="card__price">' + money(x.price) + '</span></div></a>';
    }).join('');

    /* 后台「Description」是 textarea（可多行，最多 2000 字），接口以 description 返回。
       这里原样转义输出，靠 CSS 的 pre-line 保留换行；没有描述时整块不渲染，
       避免详情页留一段空div。 */
    var descText = String(p.description || '').trim();
    var saved = S.wishHas(p.handle);

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/collections/' + esc(p.category) + '">' + esc(p.category) + '</a><span>/</span>' + esc(p.title) + '</div>' +
      '<div class="pdp">' +
      '<div class="gal"><div class="gal__thumbs">' + thumbs + '</div>' +
      '<div class="gal__main">' +
      U.pic(p.images[0] || '', {
        alt: p.title, w: 900, h: 900, priority: true,
        sizes: '(max-width:900px) 100vw, 560px',
        extra: 'id="galMain"'
      }) + '</div></div>' +

      '<div class="pdp__info">' +
      (p.badge ? '<div class="eyebrow" style="margin-bottom:8px">' + esc(p.badge) + '</div>' : '') +
      '<h1 style="font-family:var(--serif);font-size:clamp(26px,2.6vw,34px);font-weight:400">' + esc(p.title) + '</h1>' +
      (rated
        ? '<a class="pdp__rate" href="#reviews"><span class="st">' + U.stars(rs.rating) + '</span>' +
          '<span>' + rs.rating + ' · ' + rs.count + ' ' + (rs.count === 1 ? 'review' : 'reviews') + '</span></a>'
        : '<div class="pdp__rate pdp__rate--none"><span>No reviews yet</span>' +
          '<a href="#reviews" class="link-u">Be the first</a></div>') +
      '<div class="pdp__price"><b>' + money(sel.price || p.price) + '</b>' +
      (p.compareAt ? '<s>' + money(p.compareAt) + '</s><em>Save ' + U.money0(save) + '</em>' : '') + '</div>' +
      '<div class="pdp__tax">Duties included</div>' +
      '<div class="eta">' + ui.icon('truck') + '<span>' + ui.etaText(7, 12) + '</span></div>' +
      (descText ? '<div class="pdp__desc">' + esc(descText) + '</div>' : '') +
      '<ul class="usp-list">' +
      '<li>' + ui.icon('shield') + '<span><b>Colour guarantee.</b> If it fades, we replace it once.</span></li>' +
      '<li>' + ui.icon('shield') + '<span><b>Waterproof &amp; tarnish-free.</b> 0.8 micron PVD — swim, shower, sleep in it.</span></li>' +
      '<li>' + ui.icon('shield') + '<span><b>Hypoallergenic 316L steel.</b> Nickel-safe, no green wrists.</span></li>' +
      '<li>' + ui.icon('truck') + '<span><b>Free shipping over $' + S.DB.settings.freeShip + '.</b> Tracked, no surprise fees.</span></li>' +
      '</ul>' +
      '<div class="opt"><div class="opt__hd"><span>Finish</span><b>' + esc(sel.metal) + '</b></div>' +
      '<div class="swatches">' + metalBtns + '</div></div>' +
      ((p.sizes || []).length ? '<div class="opt"><div class="opt__hd"><span>Length</span><b>' + esc(selSize) + '</b></div>' +
        '<div class="sizes">' + sizeBtns + '</div></div>' : '') +
      '<div class="qtyrow">' +
      '<span class="stepper"><button data-act="pdpq" data-d="-1" aria-label="Decrease quantity">' + ui.icon('minus') + '</button>' +
      '<input id="pdpQty" value="1" readonly aria-label="Quantity"><button data-act="pdpq" data-d="1" aria-label="Increase quantity">' + ui.icon('plus') + '</button></span>' +
      '<button class="btn" data-act="add" data-handle="' + esc(p.handle) + '" data-metal="' + esc(sel.metal) + '" data-size="' + esc(selSize) + '"' +
      (stock <= 0 ? ' disabled' : '') + '>' + (stock <= 0 ? 'Sold out' : 'Add to bag') + '</button></div>' +
      '<button class="pdp__wish' + (saved ? ' on' : '') + '" data-act="wish" data-handle="' + esc(p.handle) + '"' +
      ' aria-pressed="' + (saved ? 'true' : 'false') + '">' + ui.icon(saved ? 'heartFull' : 'heart') +
      '<span>' + (saved ? 'Saved' : 'Save for later') + '</span></button>' +
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

      '<div class="wrap" id="reviews"><div class="revwrap">' +
      '<div class="revwrap__sum"><div class="eyebrow">Reviews</div>' +
      (rated
        ? '<div class="revavg"><b>' + rs.rating + '</b><div><span class="st">' + U.stars(rs.rating) + '</span>' +
          '<small>' + rs.count + ' ' + (rs.count === 1 ? 'review' : 'reviews') + '</small></div></div>' + dist
        : '<p style="color:var(--muted);margin:8px 0 0">No reviews yet.</p>') +
      '</div>' +
      '<div class="revwrap__list">' + (revs || '') + writeForm + '</div>' +
      '</div></div>' +
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
        '<a class="cline__img" href="#/products/' + esc(l.handle) + '">' + U.pic(l.image, { alt: '', w: 900, h: 900, sizes: '90px' }) + '</a>' +
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

  /* 支付区内容必须由后端 /payments/methods 决定，不能写死。
     这里原来是一张假卡（4242 4242 4242 4242）加一句
     「Test mode — Stripe keys are not connected yet」：
     切到 PayPal 之后，页面既没有 PayPal 入口，也没说会整页跳转，
     买家点 Pay 直接被送到 sandbox.paypal.com，体感就是「支付没调起来」。
     现在的原则是「页面上写的 = 点下去真的会发生」。 */
  function payOption(pay, total) {
    var p = pay || {};
    var id = String(p.provider || '');
    var warn = (p.configured === false)
      ? '<p class="drawer__note" style="color:var(--clay)">Online payment is temporarily unavailable. ' +
        'Please contact us and we will take your order manually.</p>'
      : '';

    if (id === 'paypal') {
      return '<div class="payopt">' +
        '<span class="payopt__mark">' + ui.payMark('paypal') + '</span>' +
        /* 描述不要再以 PayPal 开头：左边的品牌卡和标题已经各写了一次 PayPal，
           第三句再写一次，整块看起来像没填完的占位符。 */
        '<div class="payopt__body"><b>PayPal</b>' +
        '<span>Pay from your balance, bank, or any card.</span></div>' +
        '<span class="payopt__tick" aria-hidden="true">' + ui.icon('check') + '</span></div>' +
        '<p class="drawer__note">You will be redirected to PayPal to approve the payment, then brought back here ' +
        'to your order. Card details are entered on PayPal only — we never see or store them.</p>' + warn;
    }

    if (id === 'stripe') {
      return '<div class="cardfield"><div class="cardfield__row">' +
        '<input value="Card details are collected on the next step" readonly>' +
        '<span class="cardbrand">' + ui.icon('lock') + '</span></div>' +
        '<p class="small" style="color:var(--muted);margin:0">You will confirm the payment on Stripe\'s secure form.</p></div>' + warn;
    }

    if (id === 'mock' || !id) {
      return '<div class="payopt"><span class="payopt__mark">' + ui.icon('card') + '</span>' +
        '<div class="payopt__body"><b>Test gateway</b>' +
        '<span>No real money moves. Orders are marked paid straight away.</span></div></div>' + warn;
    }

    return '<div class="payopt"><span class="payopt__mark">' + ui.icon('lock') + '</span>' +
      '<div class="payopt__body"><b>' + esc(p.label || 'Secure payment') + '</b>' +
      '<span>You will be taken to the payment provider to finish.</span></div></div>' + warn;
  }

  /* 按钮文字说清「下一步会发生什么」，别让「Pay」被误解成一键扣款 */
  function payCta(pay, total) {
    var id = String((pay || {}).provider || '');
    if (id === 'paypal') return 'Continue to PayPal — ' + money(total);
    if (id === 'stripe') return 'Continue to payment — ' + money(total);
    if (id === 'mock' || !id) return 'Place order — ' + money(total);
    return 'Pay ' + money(total);
  }

  function checkout(quote, form, err, pay) {
    form = form || {};
    var lines = (quote ? quote.lines : S.cartLines()).map(function (l) {
      return '<div class="paysum__line">' + U.pic(l.image || '', { alt: '', w: 900, h: 900, sizes: '56px' }) +
        '<div>' + esc(l.title) + '<span>' + esc(l.metal) + (l.size ? ' / ' + esc(l.size) : '') + ' · ×' + l.qty + '</span></div>' +
        '<div class="mono" style="font-size:11.5px">' + money(l.lineTotal || l.unitPrice * l.qty) + '</div></div>';
    }).join('');
    if (quote && quote.gift) {
      /* 兜底图原来写的是 p-earring-pearl-gold.jpg，这个文件不存在（实际叫 p-earrings-hoop-gold），
         礼品没有配图时结算页会显示一个裂图。 */
      lines += '<div class="paysum__line">' + U.pic(quote.gift.image || 'assets/img/opt/p-earrings-hoop-gold.jpg', { alt: '', w: 900, h: 900, sizes: '56px' }) +
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

      '<div class="co__block"><h3>Payment</h3>' + payOption(pay, quote ? quote.total : S.totals().total) + '</div>' +
      (err ? '<div class="falert">' + esc(err.message) + '</div>' : '') + detailList +
      '<button class="btn btn--full" type="submit">' + payCta(pay, quote ? quote.total : S.totals().total) + '</button>' +
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

  /* ---------------- 物流时间线 ----------------
     数据来自 17TRACK 的 webhook 推送（服务端验签后落在 order.trackingState）。

     三种状态必须分开渲染，否则客户看到的信息会自相矛盾：
     ① 有轨迹        → 时间线（最新的在上）
     ② 已订阅没扫件  → 一句「等承运商首扫」，这是正常等待，不是错误
     ③ 订阅被拒/没配 → 如实说自动追踪不可用，把承运商官网链接给足
     第③种是真实会发生的：USPS 在试用额度下会被 17TRACK 策略挡住，
     如果我们假装一切正常，客户就会对着一个永远空着的框刷新。 */
  function trackPanel(o) {
    if (!o || !o.tracking) return '';
    var st = o.trackingState || {};
    var carrier = o.carrier || '';
    var href = U.carrierUrl(carrier, o.tracking);
    var h = '<div class="trk">';

    if (st.events && st.events.length) {
      var shown = st.events.slice(0, 6);
      h += '<div class="trk__hd">' +
        '<span class="trk__st' + (st.status === 'Delivered' ? ' is-done' : '') + '">' +
        esc(st.label || 'In transit') + '</span>' +
        '<span class="trk__meta">' + esc(st.provider || carrier) +
        (st.lastEventAt ? ' · updated ' + esc(U.fmtDateTime(st.lastEventAt)) : '') + '</span></div>' +
        '<ol class="trk__list">' + shown.map(function (e, i) {
          return '<li class="' + (i === 0 ? 'on' : '') + '">' +
            '<time>' + esc(U.fmtDateTime(e.at)) + '</time>' +
            '<p>' + esc(e.text) + '</p>' +
            (e.place ? '<span>' + esc(e.place) + '</span>' : '') + '</li>';
        }).join('') + '</ol>';
      if (st.events.length > shown.length) {
        h += '<p class="trk__more">' + (st.events.length - shown.length) + ' earlier scans · ' +
          '<a class="link-u" target="_blank" rel="noopener noreferrer" href="' + esc(href) + '">' +
          'see all on ' + esc(carrier || 'the carrier') + '</a></p>';
      }
    } else if (st.error) {
      h += '<div class="trk__hd"><span class="trk__st">Tracking link</span></div>' +
        '<p class="trk__note">Live updates aren\'t available for this shipment here. ' +
        'The carrier has the current status: ' +
        '<a class="link-u" target="_blank" rel="noopener noreferrer" href="' + esc(href) + '">' +
        'track ' + esc(o.tracking) + '</a>.</p>';
    } else {
      h += '<div class="trk__hd"><span class="trk__st">Label created</span>' +
        (carrier ? '<span class="trk__meta">' + esc(carrier) + '</span>' : '') + '</div>' +
        '<p class="trk__note">Waiting for the carrier\'s first scan — usually the same day it\'s dropped off.</p>';
    }
    return h + '</div>';
  }

  /* ---------------- 订单完成 ---------------- */
  function orderDone(o) {
    var rows = o.items.map(function (i) {
      return '<div class="paysum__line paysum__line--ni"><div>' + esc(i.title) + (i.isGift ? ' <span class="gift-tag">Gift</span>' : '') +
        '<span>' + esc(i.variant) + (i.size ? ' / ' + esc(i.size) : '') + ' · ×' + i.qty + '</span></div>' +
        '<div class="mono" style="font-size:11.5px">' + money(i.unitPrice * i.qty) + '</div></div>';
    }).join('');
    return '<div class="wrap" style="max-width:720px">' +
      '<div class="donebox"><div class="eyebrow">Order confirmed</div>' +
      '<h1>Thank you — it ships in 1–2 days.</h1>' +
      '<p class="lede">A confirmation is on its way to <b>' + esc(o.email) + '</b>. Keep the order number to track it.</p>' +
      '<div class="ordernum"><span>Order number</span><b>' + esc(o.number) + '</b></div>' +
      /* 已发货的单子从支付回跳或订单链接进来，同样落在这个确认页。
         以前这里只写「1–2 天发货」，客户看不到运单号，还得绕去 Track My Order 再查一遍。 */
      (o.tracking ? '<div class="ordernum" style="margin-top:10px"><span>Tracking</span>' +
        '<b><a class="link-u" target="_blank" rel="noopener noreferrer" href="' +
        esc(U.carrierUrl(o.carrier, o.tracking)) + '">' + esc(o.tracking) + '</a></b>' +
        (o.carrier ? ' <span class="small">· ' + esc(o.carrier) + '</span>' : '') + '</div>' : '') +
      trackPanel(o) +
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
        return '<div class="paysum__line paysum__line--ni"><div>' + esc(i.title) +
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
        /* 单号必须可点：客户拿到纯文本只能自己复制去别处搜，
           而承运商官网的查询页是唯一一定能查到真实轨迹的地方。 */
        (order.tracking ? '<p class="small" style="margin:18px 0">Tracking ' +
          '<a class="link-u" target="_blank" rel="noopener noreferrer" href="' +
          esc(U.carrierUrl(order.carrier, order.tracking)) + '"><b>' + esc(order.tracking) + '</b></a>' +
          (order.carrier ? ' · ' + esc(order.carrier) : '') + '</p>' : '') +
        trackPanel(order) +
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
    search: search, wishlist: wishlist,
    METALS: METALS, PRICES: PRICES, SORTS: SORTS,
  };
})();
