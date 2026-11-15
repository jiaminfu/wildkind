/* ============================================================
   LASTGROVE Web · 路由与交互
   每个视图先取数、再渲染；取数失败落到错误页而不是白屏。
   ============================================================ */
(function () {
  'use strict';

  var U = S.U, ui = window.UI, V = window.Views, A = window.AdminViews, Pages = window.PageViews;
  var root = document.getElementById('app');
  var cache = Object.create(null);     // productId → product（快捷加购要用）
  var renderSeq = 0;

  function setProducts(list) {
    (list || []).forEach(function (p) { cache[p.id] = p; });
  }

  /* 当前页面的 SEO 上下文。各 renderXxx 在取到数据后填，
     render() 结束前统一写进 <head>。
     直接读 cache 反查也可以，但集合页/搜索页没有商品对象可查，统一走这个变量更清楚。 */
  var seo = null;
  function setSeo(o) { seo = o; }

  /* ---------------- SEO ----------------
     原先全站 <title> 是 index.html 里写死的一句，集合页、商品页、内容页完全一样，
     也没有 og:*、canonical、JSON-LD。结果：Google 里每个商品页标题都相同，
     微信/Twitter 分享出去没有图没有摘要。这里按路由动态补。
     爬虫（含 Googlebot）会执行 JS，动态注入的标签能被抓到；
     接上 history 路由后可以改成服务端直出，效果更稳。 */
  function metaTag(name, content, isProp) {
    var sel = isProp ? 'meta[property="' + name + '"]' : 'meta[name="' + name + '"]';
    var el = document.head.querySelector(sel);
    if (content == null || content === '') { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('meta');
      if (isProp) el.setAttribute('property', name); else el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', String(content));
  }

  function linkTag(rel, href) {
    var el = document.head.querySelector('link[rel="' + rel + '"]');
    if (!href) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
  }

  var jsonLdEl = null;
  function jsonLd(obj) {
    if (!jsonLdEl) {
      jsonLdEl = document.createElement('script');
      jsonLdEl.type = 'application/ld+json';
      document.head.appendChild(jsonLdEl);
    }
    jsonLdEl.textContent = obj ? JSON.stringify(obj) : '';
  }

  function applySeo(seg, r) {
    var brand = 'LASTGROVE';
    var title, desc, image, canonical, ld = null;
    var origin = location.origin + location.pathname;

    if (seg[0] === 'admin') {
      /* 后台绝不能被收录 */
      document.title = 'Admin · ' + brand;
      var rb = document.head.querySelector('meta[name="robots"]');
      if (!rb) {
        rb = document.createElement('meta');
        rb.setAttribute('name', 'robots');
        document.head.appendChild(rb);
      }
      rb.setAttribute('content', 'noindex,nofollow');
      jsonLd(null);
      seo = null;
      return;
    }
    /* 离开后台回到前台时要把 noindex 撤掉 */
    var rbx = document.head.querySelector('meta[name="robots"]');
    if (rbx) rbx.remove();

    var s = seo || {};

    if (s.type === 'product' && s.product) {
      var p = s.product;
      var price = Number(p.price) || 0;
      title = p.title + ' — ' + brand;
      desc = String(p.description || '').trim().slice(0, 158) ||
        (p.title + ' in ' + (p.variants || []).map(function (v) { return v.metal; }).join(' / ') +
          '. 316L stainless steel with PVD colour. ' + S.U.money(price) + ', duties included.');
      image = p.images && p.images[0] ? origin + p.images[0] : '';
      canonical = origin + '#/products/' + p.handle;
      ld = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.title,
        description: desc,
        image: (p.images || []).map(function (i) { return origin + i; }),
        sku: (p.variants && p.variants[0] && p.variants[0].sku) || p.handle,
        brand: { '@type': 'Brand', name: brand },
        offers: {
          '@type': 'Offer',
          price: price.toFixed(2),
          priceCurrency: 'USD',
          availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: canonical,
        },
      };
      if (s.stats && s.stats.count > 0) {
        ld.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: s.stats.rating,
          reviewCount: s.stats.count,
        };
      }
    } else if (s.type === 'collection' && s.collection) {
      title = s.collection.title + ' — ' + brand;
      desc = s.collection.intro || ('Shop ' + s.collection.title + ' at ' + brand +
        '. 316L stainless steel with a PVD colour layer that does not fade.');
      canonical = origin + '#/collections/' + s.collection.handle;
      image = origin + 'assets/img/opt/c-ocean.jpg';
    } else if (s.type === 'search') {
      title = (s.q ? 'Search: ' + s.q : 'Search') + ' — ' + brand;
      desc = s.q
        ? (s.total + ' pieces matching “' + s.q + '” at ' + brand + '.')
        : ('Search every piece in stock at ' + brand + '.');
      canonical = origin + (s.q ? '#/search?q=' + encodeURIComponent(s.q) : '#/search');
    } else if (s.type === 'page' && s.title) {
      title = s.title + ' — ' + brand;
      desc = s.intro || (s.title + ' at ' + brand + '.');
      canonical = origin + '#/pages/' + s.key;
    } else if (s.type === 'wishlist') {
      title = 'Saved pieces — ' + brand;
      desc = 'Pieces you saved at ' + brand + '.';
      canonical = origin + '#/account/wishlist';
    } else {
      title = brand + ' — Grows on you.';
      desc = '316L stainless steel jewelry, made in short runs. Unplated silver, 18k gold PVD. ' +
        'Swim in it. Shower in it. Sleep in it. Duties included, 30-day returns.';
      canonical = origin;
      image = origin + 'assets/img/opt/hero-necklaces.jpg';
    }

    document.title = title;
    metaTag('description', desc);
    metaTag('og:title', title, true);
    metaTag('og:description', desc, true);
    metaTag('og:type', s.type === 'product' ? 'product' : 'website', true);
    metaTag('og:site_name', brand, true);
    metaTag('og:url', canonical, true);
    if (image) metaTag('og:image', image, true);
    else metaTag('og:image', '', true);
    metaTag('twitter:card', image ? 'summary_large_image' : 'summary');
    metaTag('twitter:title', title);
    metaTag('twitter:description', desc);
    if (image) metaTag('twitter:image', image);
    linkTag('canonical', canonical);

    /* BreadcrumbList 对商品页的富摘要很有用，顺手给一份 */
    if (s.type === 'product' && s.product) {
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          ld,
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
              {
                '@type': 'ListItem', position: 2, name: s.product.category || 'Shop',
                item: origin + '#/collections/' + (s.product.category || 'all'),
              },
              { '@type': 'ListItem', position: 3, name: s.product.title, item: canonical },
            ],
          },
        ],
      });
    } else {
      jsonLd(ld);
    }
    seo = null;
  }

  /* ---------------- 骨架 ---------------- */
  function storeShell(body, r) {
    return ui.shell(body, r) ;
  }

  function errorPage(err) {
    return '<div class="wrap" style="padding:80px 0;text-align:center;max-width:560px">' +
      '<div class="eyebrow">Something went wrong</div>' +
      '<h1 style="font-family:var(--serif);font-weight:400;font-size:34px;margin:10px 0">' +
      U.esc(err.message || 'Request failed') + '</h1>' +
      (err.code ? '<p class="small" style="color:var(--muted)">Error code: ' + U.esc(err.code) + '</p>' : '') +
      '<a class="btn" href="#/" style="margin-top:20px">Back home</a></div>';
  }

  /* ---------------- 渲染 ---------------- */

  /* 后台表格在窄屏会挤爆：6 列塞进 390px，金额和日期被裁到屏幕外，
     用户看到的是「页面坏了」。这里给每个单元格补上列名（data-l），
     窄屏由 CSS 把整行折成一张纵向卡片——不丢列，也不用左右划。
     只处理 ≥4 列的表；3 列的表本来就放得下，折成卡片反而更长。 */
  function labelTables(scope) {
    var tables = (scope || document).querySelectorAll('.adm__body table.atable');
    [].forEach.call(tables, function (t) {
      var ths = [].map.call(t.querySelectorAll('thead th'), function (th) {
        return (th.innerText || '').trim();
      });
      if (!ths.length) return;
      if (ths.length >= 4) t.classList.add('atable--wide');
      [].forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
        [].forEach.call(tr.children, function (td, i) {
          if (td.tagName !== 'TD') return;
          if (td.colSpan > 1) { td.classList.add('tdspan'); return; }   // 「无结果」行不列列名
          if (!td.getAttribute('data-l')) td.setAttribute('data-l', ths[i] || '');
          /* 把单元格原有内容整体包一层。
             不包的话，`<text>＋<br>＋<span>` 在 flex 布局里会变成三个并排的项，
             「姓名 / 换行 / 邮箱」被摊成一行，邮箱直接顶出屏幕右侧。 */
          if (!td.querySelector(':scope > .tdv')) {
            var v = document.createElement('span');
            v.className = 'tdv';
            while (td.firstChild) v.appendChild(td.firstChild);
            td.appendChild(v);
          }
        });
      });
    });
  }

  async function render() {
    var seq = ++renderSeq;
    var r = S.parseHash();
    var seg = r.seg;
    var html;

    seo = null;   // 每次渲染重置，避免上一页的 SEO 上下文串到这一页

    document.body.classList.remove('menu-open', 'search-open');
    if (seg[0] !== 'admin') document.body.classList.remove('filter-open');

    try {
      if (seg[0] === 'admin') {
        html = await renderAdmin(r);
      } else {
        var body;
        switch (seg[0]) {
          case undefined: case '': body = await renderHome(r); break;
          case 'collections': body = await renderCollection(r); break;
          case 'products': body = await renderProduct(r); break;
          case 'search': body = await renderSearch(r); break;
          case 'cart': body = V.cart(); break;
          case 'checkout': body = await renderCheckout(r); break;
          case 'order':
            body = seg[1] === 'confirm' ? await renderPayConfirm(r) : await renderOrder(r);
            break;
          case 'account': body = await renderAccount(r); break;
          case 'pages': {
            var pg = Pages.page(seg[1]);
            if (pg) {
              var pmeta = (S.DB.pages || {})[seg[1]] || {};
              setSeo({ type: 'page', key: seg[1], title: pmeta.title || seg[1], intro: pmeta.intro });
            }
            body = pg || V.notFound();
            break;
          }
          case 'custom': body = Pages.custom(r.query.sent || null); break;
          default: body = V.notFound();
        }
        if (seq !== renderSeq) return;
        html = storeShell(body, r);
      }
    } catch (e) {
      if (seq !== renderSeq) return;
      html = seg[0] === 'admin'
        ? A.login(e.status === 401 ? window.API.takeNotice() : e)
        : storeShell(errorPage(e), r);
    }

    root.innerHTML = html;
    if (seg[0] === 'admin') labelTables(root);
    var ck = document.getElementById('ckbar');
    document.body.classList.toggle('ck-open', !!ck);
    // Cookie 条高度两端不同（桌面单行 / 手机两行），写死 padding 必有一端错，
    // 所以每次渲染实测一次写进 --ckh，CSS 里的留白 calc 才准。
    if (ck) document.documentElement.style.setProperty('--ckh', Math.round(ck.getBoundingClientRect().height) + 'px');
    window.scrollTo(0, 0);
    if (seg[0] === 'admin') {
      var mb = document.getElementById('admMenuBtn');
      if (mb && window.innerWidth > 900) mb.style.display = 'none';
    }
    /* title / og / canonical / JSON-LD 在这里统一落地（见 applySeo） */
    try { applySeo(seg, r); } catch (e) { /* SEO 失败不该影响页面 */ }
  }

  /* ---------------- 首页 ---------------- */
  /* 首页所需的数据一次拿全（?with=home）。
     以前是 bootstrap → best-sellers → limit=1 → 详情 → limit=8 五个请求串起来，
     在 350 kbps 的跨境链路上光等待就 6 秒多。
     现在第一个请求就把 settings/nav/集合/首页商品/真实统计一起带回来。 */
  async function renderHome() {
    var boot = S.state.boot;
    if (!boot || !boot.home) boot = await bootLoad(true);
    var h = boot.home || {};
    var best = h.items || [];
    if (best.length) setProducts(best);
    return V.home(boot, best, h.reviews || [], h.stats || {});
  }

  async function bootLoad(withHome) {
    var res = await API.get('/bootstrap' + (withHome ? '?with=home' : ''));
    S.setBoot(res.data);
    return res.data;
  }

  /* ---------------- 搜索 ---------------- */
  /* 独立路由，不再借道集合。
     之前回车跳到 #/collections/best-sellers?q=ring，只在 best-sellers 里过滤，
     全站 3 件戒指搜出「0 pieces」——搜索是电商第二入口，断了等于没有。 */
  async function renderSearch(r) {
    var q = (r.query.q || '').trim();
    var qs = new URLSearchParams();
    if (q) qs.set('q', q);
    ['sort', 'page', 'cat', 'metal', 'price', 'stock'].forEach(function (k) {
      if (r.query[k]) qs.set(k, r.query[k]);
    });
    qs.set('limit', '24');

    /* 空关键词时给「全部在售」，让搜索页本身也是个可逛的页面 */
    var res = await API.get('/search?' + qs.toString());
    setProducts(res.data);
    setSeo({ type: 'search', q: q, total: res.meta.total });
    return V.search(q, res.data, res.meta, r);
  }

  /* ---------------- 收藏 ---------------- */
  async function renderWishlist() {
    setSeo({ type: 'wishlist' });
    var handles = (S.state.wish || []).slice();
    if (!handles.length) return V.wishlist([]);
    var res = await API.get('/products?handles=' + encodeURIComponent(handles.join(',')) + '&limit=48');
    setProducts(res.data);
    return V.wishlist(res.data);
  }

  /* ---------------- 商品页 ---------------- */
  async function renderProduct(r) {
    var handle = r.seg[1];
    if (!handle) return V.notFound();
    var d = await API.get('/products/' + encodeURIComponent(handle));
    setProducts([d.data.product].concat(d.data.related || []));
    setSeo({ type: 'product', product: d.data.product, stats: d.data.reviewStats });
    return V.product(d.data.product, d.data.reviews, d.data.related, r, d.data.reviewStats);
  }

  /* ---------------- 集合页 ---------------- */
  async function renderCollection(r) {
    var handle = r.seg[1] || 'best-sellers';
    var qs = new URLSearchParams();
    ['metal', 'price', 'stock', 'sort', 'page', 'q', 'cat', 'motif', 'set'].forEach(function (k) {
      if (r.query[k]) qs.set(k, r.query[k]);
    });
    qs.set('limit', '24');
    var res = await API.get('/collections/' + encodeURIComponent(handle) + '?' + qs.toString());
    setProducts(res.data);
    setSeo({ type: 'collection', collection: res.meta.collection });
    return V.collection(res.meta.collection, res.data, res.meta, r);
  }

  /* ---------------- 结算 ---------------- */
  function cartPayload() {
    return S.state.cart.map(function (l) {
      return { productId: l.productId, metal: l.metal, size: l.size, qty: l.qty };
    });
  }

  async function quoteNow() {
    if (!S.state.cart.length) return null;
    var res = await API.post('/checkout/quote', {
      items: cartPayload(),
      couponCode: S.state.coupon ? S.state.coupon.code : '',
      shippingMethod: S.state.checkout.shipping || 'Standard',
      /* 州决定销售税。结算页还没填州时传空，服务端按 0 税报价；
         客户填完州会再报一次（见 co-state 的 change 处理）。 */
      state: S.state.checkoutState || '',
    });
    S.state.quote = res.data;
    return res.data;
  }

  /* 州填完/改完之后重新报价，只更新摘要里的三行，不重渲染整页。
     重渲染会把客户已经填好的姓名、地址、邮箱全清空 —— 这是结算页最不能犯的错。
     报价变了还要更新 S.state.quote，否则提交时用的是旧金额，服务端会判 PRICE_CHANGED。 */
  S.onChange('co-state', async function (el) {
    var v = String(el.value || '').trim();
    if (v === (S.state.checkoutState || '')) return;
    S.state.checkoutState = v;
    if (!S.state.cart.length) return;
    try {
      var q = await quoteNow();
      var row = document.getElementById('sumTaxRow');
      var taxEl = document.getElementById('sumTax');
      var label = document.getElementById('sumTaxLabel');
      var totEl = document.getElementById('sumTotal');
      if (row && taxEl && totEl) {
        if (q.tax) {
          row.hidden = false;
          taxEl.textContent = S.U.money(q.tax);
          if (label) label.textContent = 'Tax' + (q.taxState ? ' (' + q.taxState + ')' : '');
        } else {
          row.hidden = true;
          taxEl.textContent = '';
        }
        totEl.textContent = S.U.money(q.total);
      }
      /* 按钮金额也要跟着改。只更新 Total 不更新按钮，等于告诉客户两个不同的价格。 */
      var cta = document.getElementById('payCta');
      if (cta) cta.textContent = V.payCta({ provider: cta.getAttribute('data-provider') }, q.total);
    } catch (e) {
      /* 报价失败（库存被买走、券失效）不该在这里弹错，
         客户可能只是改了个州。保持原金额，提交时会拿到明确错误。 */
    }
  });

  async function renderCheckout(r) {
    if (!S.state.cart.length) { S.go('/cart'); return '<div></div>'; }
    var quote = await quoteNow();
    // 把报价行补上图，摘要里要显示缩略图
    quote.lines.forEach(function (l) {
      var c = S.state.cart.filter(function (x) { return x.productId === l.productId && x.metal === l.metal; })[0];
      l.image = c ? c.image : '';
    });
    /* 支付方式问后端要，不猜。取不到就传 null，视图会退回中性文案，
       绝不能在页面上断言「走的是某个具体通道」——写死过一次，切通道后就对不上了。 */
    if (!S.state.payMethods) {
      try { S.state.payMethods = (await API.get('/payments/methods')).data; }
      catch (e) { S.state.payMethods = null; }
    }
    return V.checkout(quote, Object.assign({ shipping: S.state.checkout.shipping || 'Standard' }, S.state.checkoutForm || {}), S.state.checkoutErr, S.state.payMethods);
  }

  async function renderOrder(r) {
    var o = S.state.lastOrder;
    if (!o) {
      if (r.seg[1]) {
        var res = await API.get('/orders/lookup?number=' + encodeURIComponent(r.seg[1]) +
          '&email=' + encodeURIComponent(r.query.email || ''));
        o = res.data.order;
      } else return V.notFound();
    }
    return V.orderDone(o);
  }

  /* 支付通道回跳的落点：/#/order/confirm?token=<通道会话id>&PayerID=...
     PayPal 会把 token 追加到 return_url 后面，所以这里拿到的是通道的订单号，
     不是我们的单号。用它触发 capture（真正扣款），再换成我们的单号展示。
     这段不能省：PayPal 的钱在买家点「同意」时还没动，必须服务端再 capture 一次。 */
  async function renderPayConfirm(r) {
    var token = String(r.query.token || '').trim();

    function panel(title, msg, extra) {
      return '<div class="wrap" style="padding:80px 0 90px;text-align:center">' +
        '<h1 style="font-family:var(--serif);font-weight:400;font-size:38px">' + U.esc(title) + '</h1>' +
        '<p style="color:var(--muted);margin:14px 0 26px;max-width:520px;margin-left:auto;margin-right:auto">' +
        U.esc(msg) + '</p>' + (extra || '') + '</div>';
    }

    if (!token) {
      return panel('Payment link incomplete',
        'We did not receive a payment reference from the payment provider. ' +
        'If you were charged, contact us and we will find your order.',
        '<a class="btn" href="#/account/lookup">Track an order</a>');
    }

    try {
      var res = await API.post('/payments/capture', { sessionId: token });
      var o = res.data.order || null;

      if (o && o.status === 'paid') {
        S.state.lastOrder = o;
        try { localStorage.setItem('lastgrove_last_order', JSON.stringify(o)); } catch (e) { }
        S.go('/order/' + encodeURIComponent(o.number));
        return panel('Confirming your payment',
          'One moment — taking you to your order.');
      }

      /* 没付成：买家取消、卡被拒、余额不足都会到这里。
         订单仍在，可以回去重试，所以给一个回结算页的入口而不是死胡同。 */
      return panel('Payment not completed',
        'Nothing has been charged. Your order is still reserved — you can go back and try again.',
        '<a class="btn" href="#/cart">Back to bag</a>');
    } catch (e) {
      return panel('We could not confirm the payment',
        'If you see a PayPal receipt, your payment went through and we will email you shortly. ' +
        'Otherwise contact us and we will sort it out.',
        '<a class="btn" href="#/account/lookup">Track an order</a>');
    }
  }

  async function renderAccount(r) {
    var sub = r.seg[1] || '';
    /* #/account/wishlist 现在有真实视图了。
       之前所有非 lookup 的子路径都被强制重定向到查单页，
       于是头部心形图标（aria-label="Wishlist"）点进去看到的是「Track an order」。 */
    if (sub === 'wishlist') return renderWishlist();
    if (sub !== 'lookup') S.go('/account/lookup');
    var st = S.state.lookup || {};
    /* 确认页的「Track this order」是带 number + email 的深链接，
       但这里以前只读内存里的 state，点过去永远是一张空表单——
       客户刚付完钱点「追踪订单」，还得把单号和邮箱再手打一遍。
       带参数时补这一次查询，点一下就能看见自己的单。 */
    if (!st.order && r.query.number && r.query.email) {
      try {
        var lr = await API.get('/orders/lookup?number=' + encodeURIComponent(r.query.number) +
          '&email=' + encodeURIComponent(r.query.email));
        st = { order: lr.data.order };
      } catch (e) {
        st = { err: e };
      }
      S.state.lookup = st;
    }
    return V.lookup(st.order, st.err, st.form);
  }

  /* ---------------- 后台 ---------------- */
  function adminToken() {
    try {
      var a = JSON.parse(localStorage.getItem('lastgrove_admin') || 'null');
      return a && a.token ? a : null;
    } catch (e) { return null; }
  }

  async function renderAdmin(r) {
    var sess = adminToken();
    if (!sess) return A.login(window.API.takeNotice());
    var sec = r.seg[1] || '';
    var staff = sess.staff;
    try {
      if (sec === '' || sec === undefined) {
        var m = await API.get('/admin/metrics?days=30', { auth: true });
        return A.shell(A.dash(m.data), '', 'Dashboard', staff);
      }
      if (sec === 'orders') {
        if (r.seg[2]) {
          var od = await API.get('/admin/orders/' + encodeURIComponent(r.seg[2]), { auth: true });
          return A.shell(A.orderDetail(od.data.order, od.data.allowedTransitions), 'orders',
            'Order ' + od.data.order.number, staff);
        }
        var qs = new URLSearchParams();
        if (r.query.status) qs.set('status', r.query.status);
        if (r.query.q) qs.set('q', r.query.q);
        if (r.query.page) qs.set('page', r.query.page);
        var list = await API.get('/admin/orders?' + qs.toString(), { auth: true });
        return A.shell(A.orders(list.data, list.meta, r.query), 'orders', 'Orders', staff);
      }
      if (sec === 'products') {
        var pq = r.query.q ? '?q=' + encodeURIComponent(r.query.q) : '';
        var ps = await API.get('/admin/products' + pq, { auth: true });
        var cols = await API.get('/admin/collections', { auth: true });
        return A.shell(A.products(ps.data, r.query.q) + A.editorDrawer(cols.data, staff) + A.importModal(),
          'products', 'Products', staff);
      }
      if (sec === 'inventory') {
        var inv = await API.get('/admin/inventory', { auth: true });
        return A.shell(A.inventory(inv.data), 'inventory', 'Inventory', staff);
      }
      if (sec === 'coupons') {
        var cp = await API.get('/admin/coupons', { auth: true });
        return A.shell(A.coupons(cp.data), 'coupons', 'Coupons', staff);
      }
      if (sec === 'reviews') {
        var rv = await API.get('/admin/reviews' + (r.query.status ? '?status=' + encodeURIComponent(r.query.status) : ''), { auth: true });
        return A.shell(A.reviews(rv.data, r.query.status), 'reviews', 'Reviews', staff);
      }
      if (sec === 'customers') {
        var cu = await API.get('/admin/customers', { auth: true });
        return A.shell(A.customers(cu.data), 'customers', 'Customers', staff);
      }
      if (sec === 'ledger') {
        var lg = await API.get('/admin/stock-ledger' + (r.query.sku ? '?sku=' + encodeURIComponent(r.query.sku) : ''), { auth: true });
        return A.shell(A.ledger(lg.data, r.query), 'ledger', 'Stock ledger', staff);
      }
      if (sec === 'audit') {
        var al = await API.get('/admin/audit-log', { auth: true });
        return A.shell(A.audit(al.data), 'audit', 'Audit log', staff);
      }
      if (sec === 'collections') {
        var cols = await API.get('/admin/collections', { auth: true });
        if (r.seg[2]) {
          var one = cols.data.filter(function (c) { return c.handle === r.seg[2]; })[0];
          if (!one) return A.shell('<div class="panel"><div class="panel__bd">Collection not found.</div></div>',
            'collections', 'Collections', staff);
          return A.shell(A.collectionEdit(one), 'collections', 'Collections', staff);
        }
        return A.shell(A.collections(cols.data), 'collections', 'Collections', staff);
      }
      if (sec === 'custom') {
        var crs = await API.get('/admin/custom-requests' + (r.query.status ? '?status=' + encodeURIComponent(r.query.status) : ''), { auth: true });
        if (r.seg[2]) {
          var rec = crs.data.filter(function (x) { return x.id === r.seg[2]; })[0];
          if (!rec) return A.shell('<div class="panel"><div class="panel__bd">Request not found.</div></div>',
            'custom', 'Custom requests', staff);
          return A.shell(A.customDetail(rec), 'custom', 'Custom requests', staff);
        }
        return A.shell(A.custom(crs.data, r.query.status), 'custom', 'Custom requests', staff);
      }
      if (sec === 'content') {
        var ct = await API.get('/admin/content', { auth: true });
        return A.shell(A.content(ct.data), 'content', 'Content', staff);
      }
      if (sec === 'settings') {
        var st2 = await API.get('/admin/settings', { auth: true });
        return A.shell(A.settings(st2.data), 'settings', 'Settings', staff);
      }
      if (sec === 'tax') {
        var qsT = new URLSearchParams();
        if (r.query.from) qsT.set('from', r.query.from);
        if (r.query.to) qsT.set('to', r.query.to);
        var tx = await API.get('/admin/tax/report?' + qsT.toString(), { auth: true });
        return A.shell(A.tax(tx.data), 'tax', 'Sales tax', staff);
      }
      return A.shell('<div class="panel"><div class="panel__bd">Unknown section.</div></div>', sec, 'Admin', staff);
    } catch (e) {
      if (e.status === 401) return A.login(window.API.takeNotice());
      if (e.status === 403) return A.shell('<div class="panel"><div class="panel__bd">' +
        U.esc(e.message) + '</div></div>', sec, 'Not allowed', staff);
      throw e;
    }
  }

  /* ---------------- 交互 ---------------- */
  function bumpBag() {
    var n = S.cartCount();
    var el = document.getElementById('bagCount');
    if (el) { el.textContent = n; el.classList.toggle('is-zero', !n); }
  }

  S.onClick('open-cart', function () { document.body.classList.add('drawer-open'); });
  S.onClick('close-cart', function () { document.body.classList.remove('drawer-open'); });
  S.onClick('open-search', function () { document.body.classList.add('search-open'); });
  S.onClick('close-search', function () { document.body.classList.remove('search-open'); });
  S.onClick('open-menu', function () { document.body.classList.add('menu-open'); });
  S.onClick('close-menu', function () { document.body.classList.remove('menu-open'); });
  S.onClick('adm-menu', function () { document.body.classList.toggle('adm-open'); });

  S.onClick('open-filter', function () { document.body.classList.add('filter-open'); });
  S.onClick('close-filter', function () { document.body.classList.remove('filter-open'); });
  S.onClick('acc', function (el) { el.parentNode.classList.toggle('open'); });

  /* 收藏 / 取消收藏。
     只在本地更新，不发请求——收藏是浏览行为，不需要账号，也不该为它写库。 */
  S.onClick('wish', function (el) {
    var handle = el.dataset.handle;
    if (!handle) return;
    var added = S.wishToggle(handle);
    S.toast(added ? 'Saved to your wishlist' : 'Removed from your wishlist', 'ok');

    var n = S.wishCount();
    var wc = document.getElementById('wishCount');
    if (wc) { wc.textContent = n; wc.classList.toggle('is-zero', !n); }
    var wb = document.getElementById('wishBtn');
    if (wb) wb.setAttribute('aria-label', 'Wishlist' + (n ? ', ' + n + ' saved' : ''));

    var label = el.querySelector('span');
    el.classList.toggle('on', added);
    el.setAttribute('aria-pressed', added ? 'true' : 'false');
    if (label) el.innerHTML = ui.icon(added ? 'heartFull' : 'heart') + '<span>' + (added ? 'Saved' : 'Save for later') + '</span>';
    else el.innerHTML = ui.icon(added ? 'heartFull' : 'heart');

    /* 在收藏页里取消收藏，卡片得当场消失，否则用户以为没生效 */
    var r = S.parseHash();
    if (r.seg[0] === 'account' && r.seg[1] === 'wishlist') render();
  });

  /* 提交评价 → POST /api/v1/reviews，落 pending 等后台审核。
     成功后把表单换成一句话，不再重渲染整页——用户刚写完的东西不能突然消失。 */
  S.onSubmit('writereview', async function (form) {
    var fd = new FormData(form);
    var btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      await API.post('/reviews', {
        handle: form.dataset.handle,
        rating: Number(fd.get('rating')),
        name: String(fd.get('rname') || '').trim(),
        email: String(fd.get('remail') || '').trim(),
        title: String(fd.get('rtitle') || '').trim(),
        body: String(fd.get('rbody') || '').trim(),
        orderNumber: String(fd.get('rorder') || '').trim(),
      });
      form.innerHTML = '<div class="revy__done">' +
        '<b>Thank you — your review is in.</b>' +
        '<p>We check every review before it goes live, usually within a day. ' +
        'If you left an order number, it will carry a “Verified buyer” mark.</p></div>';
      S.toast('Review submitted', 'ok');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit review'; }
      /* 字段级错误逐条列出来，用户才知道改哪儿，而不是只看到 "Please check the fields" */
      if (e.details && e.details.length) {
        var box = form.querySelector('.falert');
        if (!box) {
          box = document.createElement('div');
          box.className = 'falert';
          form.insertBefore(box, form.firstChild);
        }
        box.innerHTML = e.details.map(function (d) { return '<div>· ' + S.U.esc(d.message) + '</div>'; }).join('');
      }
      S.toast(e.message, 'err');
    }
  });

  S.onClick('thumb', function (el) {
    var main = document.getElementById('galMain');
    if (main) {
      main.src = el.src;
      /* 大图现在是 <picture>，只改 img.src 不会生效——浏览器优先取 <source> 里的 WebP，
         画面会纹丝不动。必须把 source 的 srcset 一起换成同一张图的两档 WebP。 */
      var pic = main.parentNode;
      if (pic && pic.tagName === 'PICTURE') {
        var src = pic.querySelector('source');
        var parts = U.picParts(el.src);
        if (src && parts) src.setAttribute('srcset', parts.set);
      }
    }
    el.parentNode.querySelectorAll('img').forEach(function (i) { i.classList.remove('on'); });
    el.classList.add('on');
  });

  /* 把 U.pic(..., {defer:true}) 挂起的图真正取回来。
     data-srcset / data-src 换回 srcset / src，浏览器这才开始下载。 */
  function wakePic(img) {
    if (!img) return;
    var pic = img.parentNode;
    if (!pic || pic.tagName !== 'PICTURE' || pic.dataset.defer !== '1') return;
    var src = pic.querySelector('source');
    if (src && src.dataset.srcset) {
      src.setAttribute('srcset', src.dataset.srcset);
      src.removeAttribute('data-srcset');
    }
    if (img.dataset.src) {
      img.setAttribute('src', img.dataset.src);
      img.removeAttribute('data-src');
    }
    delete pic.dataset.defer;
  }

  S.onClick('slide', function (el) {
    var i = Number(el.dataset.i);
    var media = document.getElementById('heroMedia');
    if (!media) return;
    media.querySelectorAll('img').forEach(function (img, k) { img.classList.toggle('on', k === i); });
    media.querySelectorAll('.hero__dots i').forEach(function (d, k) { d.classList.toggle('on', k === i); });
    /* 切到哪一张再取哪一张——用户可能一个圆点都不点 */
    wakePic(media.querySelectorAll('img')[i]);
  });

  S.onClick('rail', function (el) {
    var rail = document.getElementById(el.dataset.target);
    if (rail) rail.scrollBy({ left: Number(el.dataset.d) * 320, behavior: 'smooth' });
  });

  S.onClick('metal', function (el) {
    var q = S.parseHash().query;
    q.metal = el.dataset.m;
    S.go('/products/' + el.dataset.handle + '?' + new URLSearchParams(q).toString());
  });

  S.onClick('size', function (el) {
    var q = S.parseHash().query;
    q.size = el.dataset.s;
    S.go('/products/' + el.dataset.handle + '?' + new URLSearchParams(q).toString());
  });

  S.onClick('pdpq', function (el) {
    var input = document.getElementById('pdpQty');
    if (!input) return;
    var v = Number(input.value) + Number(el.dataset.d);
    input.value = Math.max(1, Math.min(10, v));
  });

  S.onClick('add', async function (el) {
    var pid = el.dataset.pid || el.dataset.handle;
    var metal = el.dataset.metal;
    var size = el.dataset.size || (S.parseHash().query.size || '');
    var qty = 1;
    if (el.dataset.handle && document.getElementById('pdpQty')) {
      qty = Number(document.getElementById('pdpQty').value) || 1;
    }
    try {
      var p = cache[pid];
      if (!p) {
        var d = await API.get('/products/' + encodeURIComponent(pid));
        p = d.data.product;
        cache[p.id] = p;
      }
      if (!size && p.sizes && p.sizes.length) size = p.sizes[0];
      var res = S.addLine(p, metal || p.variants[0].metal, size, qty);
      if (!res.ok) { S.toast(res.msg, 'err'); return; }
      bumpBag();
      document.body.classList.add('drawer-open');
      // 抽屉内容是渲染时生成的，重渲染一次把新行显示出来
      var r = S.parseHash();
      if (r.seg[0] === 'products') {
        root.querySelector('.drawer').outerHTML = ui.cartDrawer();
      } else {
        root.querySelector('.drawer').outerHTML = ui.cartDrawer();
      }
      S.toast('Added to bag', 'ok');
    } catch (e) {
      S.toast(e.message, 'err');
    }
  });

  S.onClick('qty', function (el) {
    S.setQty(el.dataset.key, Number(el.dataset.d) > 0 ? currentQty(el.dataset.key) + 1 : currentQty(el.dataset.key) - 1);
    bumpBag();
    var r = S.parseHash();
    if (r.seg[0] === 'cart') render();
    else {
      root.querySelector('.drawer').outerHTML = ui.cartDrawer();
      if (S.state.quote) render();
    }
  });

  function currentQty(key) {
    var l = S.state.cart.filter(function (x) { return S.lineKey(x) === key; })[0];
    return l ? l.qty : 0;
  }

  S.onClick('rm', function (el) {
    S.removeLine(el.dataset.key);
    bumpBag();
    var r = S.parseHash();
    if (r.seg[0] === 'cart') render();
    else root.querySelector('.drawer').outerHTML = ui.cartDrawer();
  });

  S.onClick('rm-coupon', function () {
    S.state.coupon = null;
    S.persistCoupon();
    render();
  });

  S.onSubmit('coupon', async function (form) {
    var code = (form.code.value || '').trim();
    if (!code) return;
    try {
      var res = await API.post('/coupons/validate', { code: code, items: cartPayload() });
      S.state.coupon = {
        code: res.data.code, type: res.data.type, value: res.data.value,
      };
      S.persistCoupon();
      S.toast('Code applied', 'ok');
      render();
    } catch (e) {
      S.toast(e.message, 'err');
    }
  });

  S.onClick('ck-all', function () {
    try { localStorage.setItem('lastgrove_cookie', 'all'); } catch (e) { }
    render();
  });
  S.onClick('ck-essential', function () {
    try { localStorage.setItem('lastgrove_cookie', 'essential'); } catch (e) { }
    render();
  });

  S.onClick('go-checkout', function () {
    document.body.classList.remove('drawer-open');
  });

  S.onChange('ship', function (el) {
    S.state.checkout.shipping = el.value;
    render();
  });

  S.onChange('sort', function (el) {
    var q = S.parseHash().query;
    q.sort = el.value;
    var qs = new URLSearchParams(q).toString();
    S.go('/collections/' + S.parseHash().seg[1] + (qs ? '?' + qs : ''));
  });

  S.onChange('search-sort', function (el) {
    var q = S.parseHash().query;
    var p = [];
    if (q.q) p.push('q=' + encodeURIComponent(q.q));
    if (el.value && el.value !== 'featured') p.push('sort=' + el.value);
    S.go('/search' + (p.length ? '?' + p.join('&') : ''));
  });

  /* 结算提交：先重新报价，金额变化则让用户确认，不静默改价 */
  S.onSubmit('place', async function (form) {
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Placing order…';
    S.state.checkoutErr = null;
    S.state.checkoutForm = {
      email: form.email.value, firstName: form.firstName.value, lastName: form.lastName.value,
      line1: form.line1.value, city: form.city.value, state: form.state.value,
      zip: form.zip.value, country: form.country.value,
      shipping: (form.querySelector('input[name=shipping]:checked') || {}).value || 'Standard',
    };
    try {
      /* 用表单里此刻的州去报价，而不是上次 change 事件留下的缓存。
         浏览器自动填充、粘贴地址、回填草稿这几种情况下 change 事件可能没触发，
         缓存就会落后于表单，报价与服务端重算对不上，下单被 PRICE_CHANGED 拦下 ——
         客户看到的是"价格变了"，其实是他刚填的州没被算进去。 */
      S.state.checkoutState = String(S.state.checkoutForm.state || '').trim();
      var quote = await quoteNow();
      var body = Object.assign({}, S.state.checkoutForm, {
        quoteId: quote.quoteId,
        address: {
          line1: S.state.checkoutForm.line1, city: S.state.checkoutForm.city,
          state: S.state.checkoutForm.state, zip: S.state.checkoutForm.zip,
          country: S.state.checkoutForm.country,
        },
        payment: { last4: '4242' },
      });
      var res = await API.post('/orders', body, {
        idempotencyKey: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      });

      /* 异步支付通道返回 202：订单已建、钱还没到，必须先把买家送去付款。
         只有 mock 通道（mode: 'sync'）才会走到下面直接跳成功页的路径；
         接入真实收单后如果还无条件跳成功页，等于把未付款订单当已付展示给客户。 */
      var pay = res.data.payment || {};
      if (pay.mode && pay.mode !== 'sync') {
        S.state.lastOrder = res.data.order;
        try { localStorage.setItem('lastgrove_last_order', JSON.stringify(res.data.order)); } catch (e) { }
        S.emptyCart();

        if (pay.approveUrl) {
          window.location.href = pay.approveUrl;
          return;
        }

        /* TODO（拿到通道密钥后补）：在这里按 pay.mode 挂载支付组件 —
           embedded  → stripe.initEmbeddedCheckout({ clientSecret: pay.clientSecret })
           embed_sdk → paypal.Buttons({ createOrder: () => pay.sessionId })
           组件走完流程后由 webhook 把订单从 pending_payment 改成 paid，
           前端只需要轮询 #/order/<号> 或等回跳。 */
        S.go('/order/' + res.data.order.number);
        S.toast('This order is awaiting payment confirmation.', 'err');
        return;
      }

      S.state.lastOrder = res.data.order;
      try { localStorage.setItem('lastgrove_last_order', JSON.stringify(res.data.order)); } catch (e) { }
      S.emptyCart();
      S.state.checkoutForm = null;
      S.go('/order/' + res.data.order.number);
    } catch (e) {
      S.state.checkoutErr = e;
      render();
      S.toast(e.message, 'err');
    }
  });

  S.onSubmit('lookup', async function (form) {
    try {
      var res = await API.get('/orders/lookup?number=' + encodeURIComponent(form.number.value) +
        '&email=' + encodeURIComponent(form.email.value));
      S.state.lookup = { order: res.data.order, err: null, form: null };
    } catch (e) {
      S.state.lookup = {
        order: null, err: { message: e.message },
        form: { number: form.number.value, email: form.email.value },
      };
    }
    render();
  });

  /* ---------------- 后台交互 ---------------- */
  S.onSubmit('login', async function (form) {
    try {
      var res = await API.post('/admin/login', {
        email: form.email.value, password: form.password.value,
      });
      localStorage.setItem('lastgrove_admin', JSON.stringify({
        token: res.data.token, staff: res.data.staff,
      }));
      render();
      S.toast('Welcome back', 'ok');
    } catch (e) {
      root.innerHTML = A.login(e);
    }
  });

  S.onClick('logout', async function () {
    try { await API.post('/admin/logout', {}, { auth: true }); } catch (e) { }
    localStorage.removeItem('lastgrove_admin');
    S.go('/admin');
    render();
  });

  /* 导出 CSV。
     下载要带 Bearer 令牌，所以不能用 <a href> 直接点——走 fetch 取 blob 再触发下载。
     文件名从 Content-Disposition 里读，服务端已经按日期命名好了。 */
  S.onClick('export', async function (el) {
    var what = el.dataset.what || 'orders';
    /* data-qs 用于带上页面当前的选择（申报区间这类）。
       没有它就只能导出"默认区间"，而会计要的往往是某个季度。 */
    var qs = el.dataset.qs ? '?' + el.dataset.qs
      : (what === 'orders' && el.dataset.status) ? '?status=' + encodeURIComponent(el.dataset.status)
        : '';
    var label = el.textContent;
    el.disabled = true;
    el.textContent = 'Exporting…';
    try {
      var res = await fetch(API.base + '/admin/export/' + what + '.csv' + qs, {
        headers: { Authorization: 'Bearer ' + API.token() },
      });
      if (!res.ok) throw new Error('Export failed (' + res.status + ')');
      var blob = await res.blob();
      var cd = res.headers.get('content-disposition') || '';
      var m = /filename="([^"]+)"/.exec(cd);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m ? m[1] : what + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      S.toast('Exported ' + what + '.csv', 'ok');
    } catch (e) {
      S.toast(e.message, 'err');
    }
    el.disabled = false;
    el.textContent = label;
  });

  S.onClick('open-order', function (el) {
    S.go('/admin/orders/' + encodeURIComponent(el.dataset.num));
  });

  S.onClick('ostatus', async function (el) {
    try {
      await API.patch('/admin/orders/' + encodeURIComponent(el.dataset.num) + '/status',
        { status: el.dataset.to }, { auth: true });
      S.toast('Order updated', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onClick('refund', async function (el) {
    if (!confirm('Refund this order and return the items to stock?')) return;
    try {
      await API.post('/admin/orders/' + encodeURIComponent(el.dataset.num) + '/refund',
        { restock: true }, { auth: true });
      S.toast('Refunded · stock returned', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* 保存运单号：承运商和单号一起提交。
     老实现用 prompt 只问单号、承运商写死 USPS，
     结果发 UPS 的单子在系统里是 USPS，客户查不到。 */
  S.onClick('save-tracking', async function (el) {
    var row = el.closest ? el.closest('.shiprow') : null;
    if (!row) return;
    var cSel = row.querySelector('[name="carrier"]');
    var tInp = row.querySelector('[name="tracking"]');
    var no = String((tInp && tInp.value) || '').trim();
    if (!no) { S.toast('Paste the tracking number first', 'err'); if (tInp) tInp.focus(); return; }
    if (no.length > 64) { S.toast('That tracking number is too long', 'err'); return; }
    el.disabled = true;
    try {
      await API.post('/admin/orders/' + encodeURIComponent(el.dataset.num) + '/tracking',
        { tracking: no, carrier: (cSel && cSel.value) || 'Other' }, { auth: true });
      S.toast('Tracking saved', 'ok');
      render();
      /* 订阅 + 首次查询在服务端是异步做的（不让第三方拖慢保存），
         这里等它两三秒再刷一次，运营就不用自己再点一下 Refresh。 */
      setTimeout(function () {
        if ((location.hash || '').indexOf('/admin/order/') >= 0) render();
      }, 2600);
    } catch (e) {
      S.toast(e.message, 'err');
      el.disabled = false;
    }
  });

  /* 手动拉一次轨迹。客户催「怎么还没更新」时用；
     查询不消耗 17TRACK 额度（只有首次订阅计费），可以随便点。 */
  S.onClick('refresh-tracking', async function (el) {
    var label = el.textContent;
    el.disabled = true;
    el.textContent = 'Checking…';
    try {
      var r = await API.post('/admin/orders/' + encodeURIComponent(el.dataset.num) + '/tracking/refresh',
        {}, { auth: true });
      var s = (r && r.data && r.data.sync) || {};
      if (s.ok) {
        S.toast(s.events ? 'Tracking updated — ' + (s.label || s.status)
          : 'Subscribed. No carrier scan yet.', 'ok');
      } else {
        S.toast('Tracking: ' + (s.message || s.reason || 'unavailable'), 'err');
      }
      render();
    } catch (e) {
      S.toast(e.message, 'err');
      el.disabled = false;
      el.textContent = label;
    }
  });

  S.onClick('price', async function (el) {
    var v = prompt('New price', el.dataset.price);
    if (!v) return;
    try {
      await API.patch('/admin/products/' + encodeURIComponent(el.dataset.id),
        { price: Number(v), version: Number(el.dataset.version) }, { auth: true });
      S.toast('Price updated — storefront sees it now', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onClick('toggle', async function (el) {
    try {
      await API.patch('/admin/products/' + encodeURIComponent(el.dataset.id),
        { active: el.dataset.active !== '1' }, { auth: true });
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* ============================================================
     商品编辑抽屉
     抽屉是常驻 DOM、只切 class，不走路由——一重绘，填了半天的表单就没了。
     ============================================================ */
  var editing = null;
  var dragFrom = null;
  var METALS = ['Gold', 'Silver', 'Rose Gold'];

  function dEl(id) { return document.getElementById(id); }

  function renderDrawerImages() {
    if (!editing || !dEl('pImgs')) return;
    dEl('pImgs').innerHTML = A.imageCells(editing.images);
    if (dEl('pImgHint')) {
      dEl('pImgHint').textContent = editing.images.length
        ? editing.images.length + ' / 6 images · the first one is the main image'
        : 'No images yet. A product needs at least one before it can be published.';
    }
  }

  function renderDrawerVariants() {
    if (!editing || !dEl('pVars')) return;
    dEl('pVars').innerHTML = A.variantRows(editing.variants, METALS);
  }

  function fillEditor(p) {
    editing = p ? {
      mode: 'edit', id: p.id, version: p.version, active: !!p.active,
      images: (p.images || []).slice(),
      variants: (p.variants || []).map(function (v) {
        return { sku: v.sku, metal: v.metal, price: v.price, stock: v.stock };
      }),
    } : {
      mode: 'new', images: [],
      variants: [{ metal: 'Gold', sku: '', price: '', stock: 0 }],
    };

    dEl('pdrawerTitle').textContent = p ? 'Edit · ' + p.title : 'New product';
    dEl('pTitle').value = p ? p.title : '';
    dEl('pHandle').value = p ? p.handle : '';
    dEl('pCat').value = p ? p.cat : 'necklaces';
    dEl('pPrice').value = p ? p.price : '';
    dEl('pCost').value = p && p.cost != null ? p.cost : '';
    dEl('pCompare').value = p && p.compareAt != null ? p.compareAt : '';
    dEl('pBadge').value = p && p.badge ? p.badge : '';
    dEl('pMotif').value = p ? (p.motif || '') : '';
    dEl('pSet').value = p ? (p.set || '') : '';
    dEl('pDesc').value = p ? (p.desc || '') : '';
    dEl('pSizes').value = p && (p.sizes || []).length ? p.sizes.join('|') : '';

    var boxes = dEl('pCols') ? dEl('pCols').querySelectorAll('input') : [];
    [].forEach.call(boxes, function (b) {
      b.checked = !!(p && (p.collections || []).indexOf(b.value) >= 0);
    });

    dEl('pMeta').textContent = p
      ? p.id + ' · v' + p.version + (p.active ? ' · live on the storefront' : ' · draft, not visible')
      : 'Saved as a draft. Fill it in, add images, then Publish from the list.';
    dEl('pSave').textContent = p && p.active ? 'Save changes' : 'Save draft';
    dEl('pDup').hidden = !p;
    dEl('pDel').hidden = !p;

    renderDrawerImages();
    renderDrawerVariants();
    var bd = dEl('pdrawer') && dEl('pdrawer').querySelector('.pdrawer__bd');
    if (bd) bd.scrollTop = 0;
  }

  function openEditor(product) {
    fillEditor(product);
    document.body.classList.add('pedit-open');
    var t = dEl('pTitle');
    if (t && !product) setTimeout(function () { t.focus(); }, 120);
  }

  function closeEditor() {
    document.body.classList.remove('pedit-open');
    editing = null;
  }

  S.onClick('pnew', function () { openEditor(null); });

  S.onClick('pedit', async function (el) {
    try {
      var res = await API.get('/admin/products/' + encodeURIComponent(el.dataset.id), { auth: true });
      openEditor(res.data);
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onClick('pclose', closeEditor);

  /* ---------- 图片 ---------- */
  S.onClick('pimgpick', function () {
    var f = dEl('pFile');
    if (f) f.click();
  });

  S.onClick('pimgdel', function (el) {
    if (!editing) return;
    editing.images.splice(Number(el.dataset.idx), 1);
    renderDrawerImages();
  });

  S.onClick('pimgmain', function (el) {
    if (!editing) return;
    var i = Number(el.dataset.idx);
    var moved = editing.images.splice(i, 1)[0];
    editing.images.unshift(moved);
    renderDrawerImages();
  });

  /* 浏览器端压缩：一张手机原图 3~6 MB，直传既慢又占卷。
     压到 1600px / q0.82 后通常 200~400 KB，前台加载也快一截。 */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var max = 1600;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var sc = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * sc));
          var ch = Math.max(1, Math.round(h * sc));
          var cv = document.createElement('canvas');
          cv.width = cw;
          cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#ffffff';   // 透明 PNG 转 JPEG 会变黑底，先铺白
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          resolve(cv.toDataURL('image/jpeg', 0.82));
        } catch (err) { reject(err); }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file is not a readable image.'));
      };
      img.src = url;
    });
  }

  S.onChange('pimg', async function (input) {
    if (!editing || !input.files || !input.files.length) return;
    var room = 6 - editing.images.length;
    var files = [].slice.call(input.files).slice(0, Math.max(0, room));
    if (input.files.length > room) S.toast('Only ' + Math.max(0, room) + ' more image(s) fit', 'err');
    input.value = '';
    if (!files.length) return;

    S.toast('Uploading ' + files.length + ' image(s)…', '');
    var hint = dEl('pImgHint');
    var done = 0;
    for (var i = 0; i < files.length; i++) {
      /* 跨境线路下一张 100 KB 的图也可能要十几秒。
         没有进度的话，用户以为没反应，会重复点「Add image」。 */
      if (hint) hint.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '… please wait';
      try {
        var dataUrl = await compressImage(files[i]);
        var res = await API.post('/admin/uploads', { dataUrl: dataUrl }, { auth: true });
        editing.images.push(res.data.path);
        done++;
      } catch (e) {
        S.toast(e.message || 'Upload failed', 'err');
      }
    }
    renderDrawerImages();
    if (done) S.toast(done + ' image(s) ready', 'ok');
  });

  /* 拖拽换序：第一张就是前台主图 */
  document.addEventListener('dragstart', function (e) {
    var c = e.target.closest ? e.target.closest('#pImgs .imgcell[draggable="true"]') : null;
    if (!c) return;
    dragFrom = Number(c.dataset.idx);
  });
  document.addEventListener('dragover', function (e) {
    if (dragFrom == null) return;
    if (e.target.closest && e.target.closest('#pImgs')) e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    if (dragFrom == null || !editing) return;
    var cell = e.target.closest ? e.target.closest('#pImgs .imgcell') : null;
    if (!cell) { dragFrom = null; return; }
    e.preventDefault();
    var to = Number(cell.dataset.idx);
    if (to < editing.images.length && to !== dragFrom) {
      var moved = editing.images.splice(dragFrom, 1)[0];
      editing.images.splice(to, 0, moved);
      renderDrawerImages();
    }
    dragFrom = null;
  });

  /* ---------- 变体 ---------- */
  S.onChange('pvar', function (el) {
    if (!editing) return;
    var i = Number(el.dataset.idx);
    if (!editing.variants[i]) return;
    editing.variants[i][el.dataset.f] = el.value;
  });

  S.onClick('pvaradd', function () {
    if (!editing) return;
    if (editing.variants.length >= 12) { S.toast('Max 12 variants per product', 'err'); return; }
    editing.variants.push({ metal: 'Gold', sku: '', price: '', stock: 0 });
    renderDrawerVariants();
  });

  S.onClick('pvardel', function (el) {
    if (!editing || editing.variants.length <= 1) return;
    editing.variants.splice(Number(el.dataset.idx), 1);
    renderDrawerVariants();
  });

  /* ---------- 保存 ---------- */
  function readEditor() {
    var sizes = dEl('pSizes').value.split(/[|,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var cols = [];
    [].forEach.call(dEl('pCols').querySelectorAll('input:checked'), function (b) { cols.push(b.value); });

    var body = {
      title: dEl('pTitle').value.trim(),
      cat: dEl('pCat').value,
      price: Number(dEl('pPrice').value),
      desc: dEl('pDesc').value,
      motif: dEl('pMotif').value.trim(),
      set: dEl('pSet').value.trim(),
      badge: dEl('pBadge').value || null,
      compareAt: dEl('pCompare').value === '' ? null : Number(dEl('pCompare').value),
      sizes: sizes,
      collections: cols,
      images: editing.images.slice(),
      variants: editing.variants.map(function (v) {
        return {
          sku: String(v.sku || '').trim(),
          metal: v.metal,
          price: v.price === '' || v.price == null ? null : Number(v.price),
          stock: Number(v.stock) || 0,
        };
      }),
    };
    var h = dEl('pHandle').value.trim();
    if (h) body.handle = h;
    var costEl = dEl('pCost');
    if (costEl && !costEl.disabled && costEl.value !== '') body.cost = Number(costEl.value);
    return body;
  }

  S.onClick('psave', async function () {
    if (!editing) return;
    var body = readEditor();

    if (!body.title) { S.toast('Title is required', 'err'); dEl('pTitle').focus(); return; }
    if (!(body.price > 0)) { S.toast('Price must be greater than 0', 'err'); dEl('pPrice').focus(); return; }
    if (!body.variants.length) { S.toast('Add at least one variant', 'err'); return; }

    var btn = dEl('pSave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      if (editing.mode === 'new') {
        await API.post('/admin/products', body, { auth: true });
        S.toast('Draft created — add images, then Publish', 'ok');
      } else {
        body.version = editing.version;
        await API.patch('/admin/products/' + encodeURIComponent(editing.id), body, { auth: true });
        S.toast('Saved', 'ok');
      }
      closeEditor();
      render();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = editing && editing.active ? 'Save changes' : 'Save draft'; }
      S.toast(e.message || 'Save failed', 'err');
      /* 字段级错误直接标到那个输入框上，别让人对着 toast 找是哪一项 */
      var f = e.details && e.details[0] && e.details[0].field;
      var map = { title: 'pTitle', price: 'pPrice', cost: 'pCost', compareAt: 'pCompare', handle: 'pHandle', cat: 'pCat', images: 'pImgs', variants: 'pVars' };
      var target = f && dEl(map[String(f).split('.')[0]]);
      if (target) {
        target.classList.add('is-bad');
        if (target.focus) target.focus();
        setTimeout(function () { target.classList.remove('is-bad'); }, 2400);
      }
    }
  });

  S.onClick('pdup', async function () {
    if (!editing || editing.mode !== 'edit') return;
    try {
      var res = await API.post('/admin/products/' + encodeURIComponent(editing.id) + '/duplicate', {}, { auth: true });
      S.toast('Copied to ' + res.data.product.id + ' (stock reset to 0)', 'ok');
      closeEditor();
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onClick('pdel', async function () {
    if (!editing || editing.mode !== 'edit') return;
    if (!confirm('Delete ' + editing.id + '? This cannot be undone.')) return;
    try {
      await API.del('/admin/products/' + encodeURIComponent(editing.id), { auth: true });
      S.toast('Deleted', 'ok');
      closeEditor();
      render();
    } catch (e) {
      /* 有订单引用的商品删不掉，会返回 409 —— 把原因原样说出来，别只报 "失败" */
      S.toast(e.message, 'err');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (document.body.classList.contains('pedit-open')) closeEditor();
    if (document.body.classList.contains('pimp-open')) document.body.classList.remove('pimp-open');
  });

  /* ============================================================
     CSV 批量导入
     两段式：选文件先跑 preview（一行不写库），确认后才真写。
     ============================================================ */
  var impCsv = '';
  var impPreview = null;

  S.onClick('pimport', function () {
    impCsv = '';
    impPreview = null;
    if (dEl('pImpResult')) dEl('pImpResult').innerHTML = '';
    if (dEl('pImpGo')) { dEl('pImpGo').disabled = true; dEl('pImpGo').textContent = 'Import'; }
    if (dEl('pImpHint')) dEl('pImpHint').textContent = 'Nothing is saved until you confirm.';
    var f = dEl('pCsv');
    if (f) f.value = '';
    document.body.classList.add('pimp-open');
  });

  S.onClick('pimpclose', function () { document.body.classList.remove('pimp-open'); });

  function renderImportPreview(d) {
    var rows = (d.groups || []).slice(0, 40).map(function (g) {
      return '<tr' + (g.ok ? '' : ' class="is-bad"') + '>' +
        '<td>' + U.esc(g.title || g.key) + '</td>' +
        '<td>' + U.esc(g.category || '') + '</td>' +
        '<td class="num">' + U.money(g.price || 0) + '</td>' +
        '<td class="num">' + g.variants + '</td>' +
        '<td class="num">' + g.stock + '</td>' +
        '<td>' + (g.ok ? '<span class="pill completed">OK</span>' : '<span class="pill cancelled">Fix</span>') + '</td></tr>';
    }).join('');

    var errs = (d.errors || []).slice(0, 20).map(function (e) {
      return '<li>Line ' + e.line + ' · ' + U.esc(e.column) + ' — ' + U.esc(e.message) + '</li>';
    }).join('');

    var warn = (d.warnings || []).slice(0, 10).map(function (w) {
      return '<li>Line ' + w.line + ' — ' + U.esc(w.message) + '</li>';
    }).join('');

    dEl('pImpResult').innerHTML =
      '<div class="kpis kpis--tight">' +
      '<div class="kpi"><span>Rows</span><b>' + d.totalRows + '</b></div>' +
      '<div class="kpi"><span>Products</span><b>' + d.groupCount + '</b></div>' +
      '<div class="kpi"><span>Ready</span><b>' + d.validGroups + '</b></div>' +
      '<div class="kpi"><span>Errors</span><b>' + d.errorCount + '</b></div></div>' +
      (rows ? '<table class="atable"><thead><tr><th>Product</th><th>Category</th>' +
        '<th class="num">Price</th><th class="num">Variants</th><th class="num">Stock</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' : '') +
      (errs ? '<div class="falert falert--err"><b>Fix these rows</b><ul>' + errs + '</ul></div>' : '') +
      (warn ? '<div class="falert falert--note"><b>Notes</b><ul>' + warn + '</ul></div>' : '');

    var go = dEl('pImpGo');
    go.disabled = d.validGroups === 0;
    go.textContent = (d.errorCount ? 'Import ' + d.validGroups + ' valid' : 'Import ' + d.validGroups) + ' as drafts';
    dEl('pImpHint').textContent = d.errorCount
      ? d.errorCount + ' row(s) have problems — only the valid products get created.'
      : 'All rows look fine. Products are created as drafts, priced and stocked as listed.';
  }

  S.onChange('pcsv', function (input) {
    var f = input.files && input.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = async function () {
      impCsv = String(rd.result || '');
      dEl('pImpResult').innerHTML = '<p class="sub">Checking the file…</p>';
      try {
        var res = await API.post('/admin/products/import/preview', { csv: impCsv }, { auth: true });
        impPreview = res.data;
        renderImportPreview(res.data);
      } catch (e) {
        dEl('pImpResult').innerHTML = '<div class="falert falert--err">' + U.esc(e.message) + '</div>';
      }
    };
    rd.readAsText(f, 'utf-8');
  });

  S.onClick('pimpgo', async function () {
    if (!impCsv) return;
    var mode = impPreview && impPreview.errorCount ? 'valid-only' : 'abort';
    var btn = dEl('pImpGo');
    if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
    try {
      var res = await API.post('/admin/products/import', { csv: impCsv, mode: mode }, { auth: true });
      S.toast(res.data.created + ' product(s) imported as drafts', 'ok');
      document.body.classList.remove('pimp-open');
      render();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
      S.toast(e.message, 'err');
    }
  });

  S.onClick('ptpl', async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    try {
      var res = await fetch(API.base + '/admin/products/import/template', {
        headers: { Authorization: 'Bearer ' + API.token() },
      });
      if (!res.ok) throw new Error('Could not download the template.');
      var blob = await res.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lastgrove-products-template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    } catch (err) {
      S.toast(err.message || 'Download failed', 'err');
    }
  });

  S.onClick('restock', async function (el) {
    try {
      var res = await API.post('/admin/products/' + encodeURIComponent(el.dataset.id) +
        '/variants/' + encodeURIComponent(el.dataset.sku) + '/restock',
        { qty: 20, reason: 'manual-restock' }, { auth: true });
      S.toast('+20 → ' + res.data.stock + ' on hand', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onSubmit('osearch', function (form) {
    S.go('/admin/orders' + (form.q.value ? '?q=' + encodeURIComponent(form.q.value) : ''));
  });

  /* --- 优惠券 --- */
  S.onSubmit('newcoupon', async function (form) {
    try {
      await API.post('/admin/coupons', {
        code: form.code.value.trim().toUpperCase(),
        type: form.type.value,
        value: Number(form.value.value),
        minSubtotal: Number(form.minSubtotal.value) || 0,
        limit: form.limit.value ? Number(form.limit.value) : null,
        note: form.note.value,
      }, { auth: true });
      S.toast('Code created — live on the storefront', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onClick('del-coupon', async function (el) {
    if (!confirm('Delete code ' + el.dataset.code + '? Customers holding it will no longer be able to use it.')) return;
    try {
      await API.del('/admin/coupons/' + encodeURIComponent(el.dataset.code), { auth: true });
      S.toast('Code ' + el.dataset.code + ' deleted', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* --- 评价审核 --- */
  S.onClick('modreview', async function (el) {
    try {
      await API.patch('/admin/reviews/' + encodeURIComponent(el.dataset.id),
        { status: el.dataset.to }, { auth: true });
      S.toast('Review ' + el.dataset.to, 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* --- 定制需求提交（门店端） --- */
  S.onSubmit('custom-req', async function (form) {
    var btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      var res = await API.post('/custom-requests', {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        style: form.style.value.trim(),
        qty: Number(form.qty.value) || 1,
        dueDate: form.dueDate.value || null,
        notes: form.notes.value.trim(),
        refUrls: form.refUrls.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
      });
      S.go('/custom?sent=' + encodeURIComponent(res.data.request.id));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send request'; }
      S.toast(e.message, 'err');
    }
  });

  /* --- 集合 --- */
  S.onSubmit('newcol', async function (form) {
    try {
      await API.post('/admin/collections', {
        title: form.title.value.trim(),
        handle: form.handle.value.trim(),
        order: form.order.value ? Number(form.order.value) : undefined,
        desc: form.desc.value,
      }, { auth: true });
      S.toast('Collection created', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onSubmit('editcol', async function (form) {
    try {
      await API.patch('/admin/collections/' + encodeURIComponent(form.dataset.handle), {
        title: form.title.value.trim(),
        order: form.order.value ? Number(form.order.value) : 0,
        desc: form.desc.value,
        nav: form.nav.value === '1',
      }, { auth: true });
      S.toast('Collection saved — storefront updated', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* 导航开关：运营最常做的一件事，不该逼人进详情页再点保存 */
  S.onClick('col-nav', async function (el) {
    try {
      await API.patch('/admin/collections/' + encodeURIComponent(el.dataset.handle),
        { nav: el.dataset.nav === '1' }, { auth: true });
      S.toast(el.dataset.nav === '1' ? 'Shown in navigation' : 'Hidden from navigation', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onClick('col-del', async function (el) {
    if (!confirm('Delete collection "' + el.dataset.handle + '"?')) return;
    try {
      await API.del('/admin/collections/' + encodeURIComponent(el.dataset.handle), { auth: true });
      S.toast('Collection deleted', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* --- 定制需求单 --- */
  S.onClick('cr-status', async function (el) {
    try {
      await API.patch('/admin/custom-requests/' + encodeURIComponent(el.dataset.id),
        { status: el.dataset.to }, { auth: true });
      S.toast('Moved to ' + el.dataset.to, 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onSubmit('cr-edit', async function (form) {
    try {
      await API.patch('/admin/custom-requests/' + encodeURIComponent(form.dataset.id), {
        quote: form.quote.value ? Number(form.quote.value) : null,
        note: form.note.value,
      }, { auth: true });
      S.toast('Request updated', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* --- 内容 --- */
  S.onSubmit('content', async function (form) {
    try {
      await API.patch('/admin/content', {
        brand: form.brand.value,
        tagline: form.tagline.value,
        content: {
          announce: form.announce.value,
          heroEyebrow: form.heroEyebrow.value,
          heroTitle: form.heroTitle.value,
          heroBody: form.heroBody.value,
          bestSellersEyebrow: form.bestSellersEyebrow.value,
        },
      }, { auth: true });
      S.toast('Storefront copy saved', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  S.onSubmit('pages', async function (form) {
    var pages = {};
    [].forEach.call(form.elements, function (el) {
      if (!el.name) return;
      var m = /^p([ti])_(.+)$/.exec(el.name);
      if (!m) return;
      var slug = m[2];
      pages[slug] = pages[slug] || {};
      pages[slug][m[1] === 't' ? 'title' : 'intro'] = el.value;
    });
    try {
      await API.patch('/admin/content', { pages: pages }, { auth: true });
      S.toast('Page headings saved', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* --- 库存流水：从缺货行跳转 --- */
  S.onClick('open-ledger', function (el) {
    S.go('/admin/ledger?sku=' + encodeURIComponent(el.dataset.sku));
  });

  S.onSubmit('psearch', function (form) {
    S.go('/admin/products' + (form.q.value ? '?q=' + encodeURIComponent(form.q.value) : ''));
  });

  S.onSubmit('savesettings', async function (form) {
    try {
      await API.patch('/admin/settings', {
        freeShip: Number(form.freeShip.value),
        standardShip: Number(form.standardShip.value),
        expressShip: Number(form.expressShip.value),
        giftThreshold: Number(form.giftThreshold.value),
        lowStockThreshold: Number(form.lowStockThreshold.value),
        storeOpen: form.storeOpen.checked,
        content: { announce: form.announce.value },
      }, { auth: true });
      S.toast('Saved — storefront updated', 'ok');
      S.state.boot = null;
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* 销售税设置。税率用「一行一州」的文本输入，所以这里要负责解析。
     解析规则和界面上写的一致：两位州码 + 空格 + 百分数。
     容忍逗号/分号/竖线分隔（从 Excel 粘过来常常是这些），
     但看不懂的行不静默丢弃 —— 丢掉一行就等于少收一个州的税，
     而界面上看不出少了什么。 */
  S.onSubmit('savetax', async function (form) {
    var lines = String(form.rates.value || '').split(/\r?\n/);
    var rates = {};
    var bad = [];
    lines.forEach(function (ln) {
      var s = String(ln).trim();
      if (!s || s.charAt(0) === '#') return;
      var parts = s.split(/[\s,;|\t]+/).filter(Boolean);
      if (parts.length < 2) { bad.push(s); return; }
      rates[parts[0]] = parts[1];
    });
    if (bad.length) {
      S.toast('Cannot read: ' + bad.slice(0, 3).join(' / ') + ' — use "CA 7.25"', 'err');
      return;
    }
    try {
      await API.patch('/admin/settings', {
        tax: {
          enabled: form.enabled.checked,
          shipTaxable: form.shipTaxable.checked,
          note: form.note.value,
          rates: rates,
        },
      }, { auth: true });
      S.toast('Tax settings saved', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
  });

  /* 申报区间切换：走真路由 query，不留在内存里 ——
     这样刷新页面、或者把链接发给会计，看到的还是同一个区间。 */
  S.onSubmit('taxrange', function (form) {
    S.go('/admin/tax?from=' + encodeURIComponent(form.from.value) +
      '&to=' + encodeURIComponent(form.to.value));
  });
  /* 搜索层：输入回车跳独立搜索页。
     以前跳的是 #/collections/best-sellers?q=，只在 best-sellers 那几件里过滤，
     全站 3 件戒指搜出来是「0 pieces」——接口一直是好的，是前端把搜索当成了集合筛选。 */
  document.addEventListener('keydown', function (e) {
    var input = e.target;
    if (e.key === 'Enter' && input && input.id === 'searchInput') {
      var q = input.value.trim();
      if (q) { S.go('/search?q=' + encodeURIComponent(q)); document.body.classList.remove('search-open'); }
    }
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      document.body.classList.add('search-open');
      var si = document.getElementById('searchInput');
      if (si) setTimeout(function () { si.focus(); }, 40);
    }
  });

  /* 搜索浮层的实时建议：输入 2 个字以上开始查，节流 260 ms。
     以前这个浮层只有输入框和一句提示，下面 id=searchRes 的区域永远是空的。 */
  var searchTimer = null;
  document.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== 'searchInput') return;
    var q = e.target.value.trim();
    var box = document.getElementById('searchRes');
    if (!box) return;
    clearTimeout(searchTimer);
    if (q.length < 2) { box.innerHTML = ''; return; }
    searchTimer = setTimeout(async function () {
      try {
        var res = await API.get('/search?q=' + encodeURIComponent(q) + '&limit=5');
        if (!res.data.length) {
          box.innerHTML = '<p class="searchlayer__none">Nothing matched “' + S.U.esc(q) + '”.</p>';
          return;
        }
        box.innerHTML = res.data.map(function (p) {
          return '<a class="slres" href="#/products/' + p.handle + '" data-act="close-search">' +
            S.U.pic(p.images[0], { alt: '', w: 900, h: 900, sizes: '56px' }) +
            '<span><b>' + S.U.esc(p.title) + '</b><em>' + S.U.money(p.price) + '</em></span></a>';
        }).join('') +
          '<a class="slres__all" href="#/search?q=' + encodeURIComponent(q) + '" data-act="close-search">See all ' +
          res.meta.total + ' results →</a>';
      } catch (err) { box.innerHTML = ''; }
    }, 260);
  });
  /* 关闭搜索层时把结果清掉，下次打开不该看到上次的词 */
  S.onClick('close-search', function () {
    document.body.classList.remove('search-open');
    var box = document.getElementById('searchRes');
    if (box) box.innerHTML = '';
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
  });

  /* ---------------- 启动 ---------------- */
  async function boot() {
    try {
      await bootLoad();
    } catch (e) {
      root.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'font-family:Georgia,serif;color:#1B3A34;text-align:center;padding:40px">' +
        '<div><h1 style="font-weight:400">Cannot reach the API</h1>' +
        '<p style="font-size:14px;color:#8A7C64;margin-top:10px">' + U.esc(e.message) + '</p>' +
        '<p style="font-size:12px;color:#8A7C64;margin-top:16px">Start it with <code>node app/server/index.js</code></p></div></div>';
      return;
    }
    render();
  }

  window.addEventListener('hashchange', render);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
