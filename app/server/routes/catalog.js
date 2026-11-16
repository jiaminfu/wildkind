/* ============================================================
   LASTGROVE · 公开目录接口（无需登录）
   ============================================================ */
'use strict';
const store = require('../lib/store');
const { E, ok, rateLimit, clientIp } = require('../lib/http');
const pricing = require('../lib/pricing');

const PRICE_BANDS = {
  'under-70': p => p.price < 70,
  '70-100': p => p.price >= 70 && p.price <= 100,
  'over-100': p => p.price > 100,
};

const SORTS = {
  featured: (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0) || b.rating - a.rating,
  new: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  best: (a, b) => (b.sold30 || 0) - (a.sold30 || 0),
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price,
  rating: (a, b) => b.rating - a.rating,
};

/* 评分与评价数只认「已审核通过」的评价。
   商品上原先存着 rating / reviewCount 两个静态字段，是导入演示数据时写死的，
   清库后既不归零也不随新评价变化——详情页会出现「4.7 · 59 条评价」但实际一条都打不开。
   这里改成每次按 reviews 表实算，没有评价就是 0 分 0 条，前端据此不渲染星级。 */
function ratingIndex(db) {
  const m = Object.create(null);
  for (const r of db.reviews) {
    if (r.status !== 'approved') continue;
    const x = m[r.productId] || (m[r.productId] = { sum: 0, n: 0 });
    x.sum += Number(r.rating) || 0;
    x.n += 1;
  }
  return m;
}

/* 对外只暴露可售字段；成本、供应商、内部备注不出门 */
function publicProduct(p, rm) {
  const rate = rm && rm[p.id];
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    price: p.price,
    compareAt: p.compareAt || null,
    currency: 'USD',
    images: p.images || [],
    motif: p.motif || '',
    set: p.set || '',
    category: p.cat || '',
    badge: p.badge || null,
    rating: rate ? Math.round(rate.sum / rate.n * 10) / 10 : 0,
    reviewCount: rate ? rate.n : 0,
    description: p.desc || '',
    details: p.details || {},
    sizes: p.sizes || [],
    collections: p.collections || [],
    inStock: pricing.totalStock(p) > 0,
    totalStock: pricing.totalStock(p),
    variants: (p.variants || []).map(v => ({
      sku: v.sku,
      metal: v.metal,
      price: v.price,
      inStock: v.stock > 0,
      stock: v.stock,          // 前端显示「仅剩 N 件」需要精确值
    })),
    createdAt: p.createdAt || null,
  };
}

function publicCollection(c, db) {
  const count = db.products.filter(p => p.active && (p.collections || []).indexOf(c.handle) >= 0).length;
  return {
    handle: c.handle, title: c.title, level: c.level || 1,
    parent: c.parent || null, menuGroup: c.menuGroup || null,
    nav: !!c.nav, visible: c.visible !== false,
    order: c.order || 0, intro: c.intro || '', count,
  };
}

function listProducts(q) {
  const db = store.get();
  let list = db.products.filter(p => p.active);

  if (q.collection) list = list.filter(p => (p.collections || []).indexOf(q.collection) >= 0);
  /* 按 handle 批量取：收藏页把 localStorage 里的 handle 一次发过来，
     逐个请求商品详情在弱网下是灾难（10 件收藏 = 10 个来回）。 */
  if (q.handles) {
    const want = String(q.handles).split(',').map(s => s.trim()).filter(Boolean);
    if (want.length) list = list.filter(p => want.indexOf(p.handle) >= 0);
  }
  /* 类目（category）与集合（collection）是两个独立维度：
     类目是商品自身的分类字段，集合是运营手工编排的货架。
     早先只认集合，后台把 Category 从 rings 改成 earrings 前台毫无反应，
     看起来像「改了没保存」——这里必须认。 */
  if (q.cat) list = list.filter(p => p.cat === q.cat);
  if (q.metal) list = list.filter(p => (p.variants || []).some(v => v.metal === q.metal && v.stock > 0));
  if (q.price && PRICE_BANDS[q.price]) list = list.filter(PRICE_BANDS[q.price]);
  if (q.stock === 'in') list = list.filter(p => pricing.totalStock(p) > 0);
  if (q.motif) list = list.filter(p => p.motif === q.motif);
  if (q.set) list = list.filter(p => p.set === q.set);
  if (q.q) {
    /* 多词搜索：把 "gold ring" 拆成两个词，要求每个词都命中任一字段。
       单词语句用 indexOf 就够，但用户输两个词时整串匹配必然 0 结果。 */
    const words = String(q.q).toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(p => {
      const hay = (p.title + ' ' + (p.desc || '') + ' ' + (p.motif || '') + ' ' +
        (p.set || '') + ' ' + (p.cat || '') + ' ' + (p.collections || []).join(' ') + ' ' +
        (p.variants || []).map(v => v.metal + ' ' + (v.sku || '')).join(' ')).toLowerCase();
      return words.every(w => hay.indexOf(w) >= 0);
    });
  }

  const sortFn = SORTS[q.sort] || SORTS.featured;
  list = list.slice().sort(sortFn);

  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(q.limit, 10) || 24));
  const total = list.length;
  const rm = ratingIndex(db);
  const items = list.slice((page - 1) * limit, page * limit).map(p => publicProduct(p, rm));

  return { items, page, limit, total, hasMore: page * limit < total };
}

function routes(router) {
  router.get('/api/v1/health', (req, res) => {
    const db = store.get();
    ok(res, {
      status: 'ok',
      version: db.meta.version,
      products: db.products.length,
      orders: db.orders.length,
      time: new Date().toISOString(),
    });
  });

  /* 首屏一次性拿全：设置 + 导航 + 集合 + 赠品规则。
     单次请求换掉 4 个串行请求，弱网下首屏快一档。

     带 ?with=home 时再加首页专用的商品与真实统计：
     首页原先要连发 4 个请求（bootstrap → best-sellers → limit=1 → 详情 → limit=8），
     在 350 kbps 的跨境链路上就是 4 个来回、近 1 秒纯等待。
     合并进来后首页只剩 1 个数据请求。 */
  router.get('/api/v1/bootstrap', (req, res) => {
    const db = store.get();
    const payload = {
      settings: {
        brand: db.settings.brand,
        tagline: db.settings.tagline,
        currency: db.settings.currency,
        freeShippingThreshold: db.settings.freeShip,
        standardShipping: db.settings.standardShip,
        expressShipping: db.settings.expressShip,
        giftThreshold: db.giftRule ? db.giftRule.threshold : null,
        giftName: db.giftRule ? db.giftRule.name : null,
        announce: (db.settings.content || {}).announce || '',
        heroEyebrow: (db.settings.content || {}).heroEyebrow || '',
        heroTitle: (db.settings.content || {}).heroTitle || '',
        heroBody: (db.settings.content || {}).heroBody || '',
        bestSellersEyebrow: (db.settings.content || {}).bestSellersEyebrow || 'As seen on TikTok',
        storeOpen: db.settings.storeOpen !== false,
        returnWindowDays: db.settings.returnWindowDays || 30,
        /* 页脚社交账号。没配就不给前端任何东西 —— 前端据此整块不渲染，
           而不是渲染一个点得开、却跳到「关于我们」的假链接。 */
        socials: db.settings.socials || {},
      },
      /* 内容页标题与导语：后台 A-08 改完这里立刻变，正文仍在 pages.js */
      pages: db.pages || {},
      collections: db.collections.filter(c => c.visible !== false).map(c => publicCollection(c, db)),
      nav: db.collections
        .filter(c => c.nav && c.level === 1 && c.visible !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(c => ({ handle: c.handle, title: c.title })),
      giftRule: db.giftRule,
    };

    if (String(req.query.with || '') === 'home') {
      const best = listProducts({ collection: 'best-sellers', limit: 8, sort: 'featured' });
      let items = best.items;
      if (items.length < 4) items = listProducts({ limit: 8, sort: 'featured' }).items;

      const approved = db.reviews.filter(r => r.status === 'approved');
      const avg = approved.length
        ? Math.round(approved.reduce((a, r) => a + (Number(r.rating) || 0), 0) / approved.length * 10) / 10
        : null;
      const sold = db.orders
        .filter(o => ['paid', 'fulfilling', 'fulfilled', 'completed'].indexOf(o.status) >= 0)
        .reduce((a, o) => a + (o.items || []).reduce((x, i) => x + (i.qty || 0), 0), 0);

      payload.home = {
        items,
        reviews: approved.slice(0, 6).map(r => ({
          id: r.id, name: r.name, rating: r.rating, title: r.title, body: r.body, verified: !!r.verified,
        })),
        /* 首页那三个数字以前是写死的 7M+ / 1.6M / 4.7，站里 0 客户 0 评价也照显示，
           属于虚假宣传。这里改成从库里实算，没有就返回 null，前端按有无决定渲不渲染。 */
        stats: {
          rating: avg,
          reviewCount: approved.length,
          productCount: db.products.filter(p => p.active).length,
          soldCount: sold,
        },
      };
    }

    ok(res, payload);
  });

  router.get('/api/v1/products', (req, res) => {
    const out = listProducts(req.query);
    ok(res, out.items, 200);
  });

  /* 带分页元信息的版本，后台与管理台用 */
  router.get('/api/v1/products/search', (req, res) => {
    const out = listProducts(req.query);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: out.items, meta: { page: out.page, limit: out.limit, total: out.total, hasMore: out.hasMore } }));
  });

  router.get('/api/v1/products/:handle', (req, res) => {
    const db = store.get();
    const p = pricing.findProduct(db, req.params.handle);
    if (!p || !p.active) throw E.notFound('That product is not available.');
    const rm = ratingIndex(db);
    const related = db.products
      .filter(x => x.active && x.id !== p.id && (x.collections || []).some(c => (p.collections || []).includes(c)))
      .slice(0, 4)
      .map(x => ({ id: x.id, handle: x.handle, title: x.title, price: x.price, image: (x.images || [])[0] }));
    const mine = db.reviews.filter(r => r.productId === p.id && r.status === 'approved');
    ok(res, {
      product: publicProduct(p, rm),
      reviewStats: {
        count: mine.length,
        rating: mine.length
          ? Math.round(mine.reduce((a, r) => a + (Number(r.rating) || 0), 0) / mine.length * 10) / 10
          : 0,
        /* 评分分布：详情页画 5→1 星的柱状条需要，缺了只能编 */
        buckets: [5, 4, 3, 2, 1].map(n => ({ star: n, count: mine.filter(r => Number(r.rating) === n).length })),
      },
      reviews: mine
        .slice(0, 8)
        .map(r => ({
          id: r.id, name: r.name, rating: r.rating, title: r.title,
          body: r.body, createdAt: r.createdAt, verified: !!r.verified,
        })),
      related,
    });
  });

  router.get('/api/v1/collections', (req, res) => {
    const db = store.get();
    ok(res, db.collections.filter(c => c.visible !== false).map(c => publicCollection(c, db)));
  });

  router.get('/api/v1/collections/:handle', (req, res) => {
    const db = store.get();
    const c = db.collections.find(x => x.handle === req.params.handle);

    /* /collections/all 是虚拟集合，永远可用：返回全部在售。
       导航、页脚、「查看全部」这类入口都靠它兜底——
       新站还没建集合时，总得有个地方能点进去看货。 */
    if (!c && req.params.handle === 'all') {
      const out = listProducts(Object.assign({}, req.query));
      const virtual = {
        handle: 'all', title: 'Shop all', level: 1, parent: null, menuGroup: null,
        nav: false, visible: true, order: 0,
        intro: 'Every piece currently in stock.', count: out.total,
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        data: out.items,
        meta: { collection: virtual, page: out.page, limit: out.limit, total: out.total, hasMore: out.hasMore },
      }));
    }

    if (!c) throw E.notFound('That collection does not exist.');
    const out = listProducts(Object.assign({}, req.query, { collection: c.handle }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      data: out.items,
      meta: { collection: publicCollection(c, db), page: out.page, limit: out.limit, total: out.total, hasMore: out.hasMore },
    }));
  });

  /* 搜索：独立入口，不再借道某个集合。
     以前前端把搜索硬编码跳到 /collections/best-sellers?q=，
     于是「搜 ring」只在 best-sellers 那 3 件里过滤，必然 0 结果。
     全站搜索必须扫全部在售商品——这个端点本来就是对的，问题在前端没调它。 */
  router.get('/api/v1/search', (req, res) => {
    const out = listProducts({
      q: req.query.q, cat: req.query.cat, metal: req.query.metal,
      price: req.query.price, stock: req.query.stock,
      sort: req.query.sort, page: req.query.page, limit: req.query.limit || 24,
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      data: out.items,
      meta: {
        q: String(req.query.q || ''), page: out.page, limit: out.limit,
        total: out.total, hasMore: out.hasMore,
      },
    }));
  });

  /* ---------------- 顾客提交评价（FR-S-071） ----------------
     之前整条链路是断的：前台没有提交入口，接口也不存在（POST 返 404），
     评价只能靠 CSV 导入，从零开卖时评价区永远是空的。

     默认落 pending 而不是 approved：这是唯一一个匿名就能往页面上写文字的入口，
     直接放行等于给垃圾外链开了后门。后台审核通过后才计入评分、才在前台露出。
     买家如果带上订单号 + 邮箱，且订单里确实有这件商品，标记 verified（已验证购买）。 */
  router.post('/api/v1/reviews', (req, res) => {
    /* 两道限流，含义不同：
       外面这道只管「别拿垃圾请求轰我」，按 IP、阈值松；
       里面那道才是业务配额（同一个邮箱 24 小时能发几条评价），只在真正写入时扣。
       早先只有一道 6 次/小时的硬限流，在校验之前就扣——
       用户填错一次、权重试一次、重复提交一次，三次就把额度用光了，
       真正想写评价的时候反而被拦。 */
    rateLimit('review-raw:' + clientIp(req), 40, 60 * 60 * 1000);
    const db = store.get();
    const b = req.body || {};

    const product = b.productId
      ? db.products.find(p => p.id === b.productId)
      : db.products.find(p => p.handle === String(b.handle || ''));
    if (!product || !product.active) {
      throw E.badRequest('Product not found.', [{ field: 'productId', message: 'Unknown product.' }]);
    }

    const rating = Number(b.rating);
    const name = String(b.name || '').trim();
    const body = String(b.body || '').trim();
    const title = String(b.title || '').trim();
    const email = String(b.email || '').trim().toLowerCase();

    const details = [];
    if (!(rating >= 1 && rating <= 5) || Math.round(rating) !== rating) {
      details.push({ field: 'rating', message: 'Pick 1 to 5 stars.' });
    }
    if (name.length < 2) details.push({ field: 'name', message: 'Your name, at least 2 characters.' });
    if (body.length < 10) details.push({ field: 'body', message: 'At least 10 characters, please.' });
    if (body.length > 2000) details.push({ field: 'body', message: 'Keep it under 2000 characters.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      details.push({ field: 'email', message: 'That email looks wrong.' });
    }
    /* 一次性报全部问题，而不是逐个弹——用户改一个再提交又被拦，体验很差 */
    if (details.length) throw E.badRequest('Please check the highlighted fields.', details);

    /* 同一邮箱 + 同一商品 24 小时内只收一条，避免刷屏 */
    const dup = db.reviews.find(r =>
      r.productId === product.id && email &&
      r.email === email && (Date.now() - new Date(r.createdAt).getTime()) < 864e5);
    if (dup) {
      throw E.conflict('You already reviewed this piece today. Thanks — it will show once approved.');
    }

    let verified = false;
    if (b.orderNumber && email) {
      const o = db.orders.find(x => String(x.number).toUpperCase() === String(b.orderNumber).toUpperCase());
      verified = !!(o && o.email === email && (o.items || []).some(i => i.productId === product.id));
    }

    /* 业务配额在这里扣：只有一条真正要落库的评价才消耗额度 */
    /* 业务配额按「邮箱」计，不按 IP 计。
       按 IP 计有个隐蔽的副作用：同一出口 IP 后面是一个咖啡馆、一栋写字楼、
       或者一台跑回归的机器时，所有人和所有轮次共用一个桶。
       实测里一小时跑三轮验收就把额度打满，接下来真实顾客提交也被 429。
       防轰本来就是外面那层 review-raw（40/h/IP）的职责；
       这一层只管「同一个人别把评价区刷屏」，所以按 24 小时、按邮箱算。
       没填邮箱时（可选字段）退回按 IP，不让它成为绕过配额的缺口。 */
    rateLimit('review-mail:' + (email || clientIp(req)), 6, 24 * 60 * 60 * 1000);

    db.reviews = db.reviews || [];
    db.sequences = db.sequences || {};
    db.sequences.review = (db.sequences.review || 1000) + 1;

    const rec = {
      id: 'RV' + db.sequences.review,
      productId: product.id,
      productTitle: product.title,
      name: name.slice(0, 60),
      email: email || null,
      rating,
      title: title.slice(0, 120) || null,
      body: body.slice(0, 2000),
      status: 'pending',
      verified,
      helpful: 0,
      createdAt: new Date().toISOString(),
      moderatedAt: null,
      moderatedBy: null,
    };
    db.reviews.unshift(rec);
    store.flush();

    ok(res, {
      review: { id: rec.id, status: rec.status, verified: rec.verified },
      message: 'Thanks — your review is with us for a quick check and will appear shortly.',
    }, 201);
  });

  /* ---------------- 定制需求单（前台 FR-S-092 → 后台 A-12） ----------------
     公开端点，不需要登录，所以必须限流：这是唯一一个可以把内容写进库的匿名入口。
     必填只留邮箱和需求描述——定制单的价值在于线索，字段越少交得越多；
     款式、数量、期望交期都可以后补。 */
  router.post('/api/v1/custom-requests', (req, res) => {
    rateLimit('custom:' + clientIp(req), 6, 10 * 60 * 1000);
    const db = store.get();
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const notes = String(b.notes || '').trim();

    /* 一次报全所有字段问题。
       原先两个 if 各自 throw，邮箱错了就看不到「描述太短」，
       用户改完邮箱再提交又被拦一次。 */
    const details = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      details.push({ field: 'email', message: 'A valid email is required.' });
    }
    if (notes.length < 10) {
      details.push({ field: 'notes', message: 'At least 10 characters, so we know what you have in mind.' });
    }
    if (details.length) throw E.badRequest('Please check the highlighted fields.', details);

    db.customRequests = db.customRequests || [];
    db.sequences = db.sequences || {};
    db.sequences.custom = (db.sequences.custom || 1000) + 1;

    const refs = Array.isArray(b.refUrls)
      ? b.refUrls.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 5)
      : [];

    const rec = {
      id: 'CR' + db.sequences.custom,
      name: String(b.name || '').trim().slice(0, 80),
      email,
      style: String(b.style || '').trim().slice(0, 120),
      qty: Math.max(1, Math.min(500, Number(b.qty) || 1)),
      dueDate: b.dueDate ? String(b.dueDate).slice(0, 10) : null,
      notes: notes.slice(0, 1200),
      refUrls: refs,
      status: 'new',
      note: null,
      quote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.customRequests.unshift(rec);
    store.flush();
    ok(res, { request: { id: rec.id, status: rec.status, createdAt: rec.createdAt } }, 201);
  });
}

module.exports = { routes, publicProduct, publicCollection, listProducts };
