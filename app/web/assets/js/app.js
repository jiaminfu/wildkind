/* ============================================================
   TIDEGLASS Web · 路由与交互
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
          case 'cart': body = V.cart(); break;
          case 'checkout': body = await renderCheckout(r); break;
          case 'order': body = await renderOrder(r); break;
          case 'account': body = await renderAccount(r); break;
          case 'pages': body = Pages.page(seg[1]) || V.notFound(); break;
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
  }

  /* ---------------- 首页 ---------------- */
  async function renderHome() {
    var boot = S.state.boot || (await bootLoad());
    var best = (await API.get('/products?collection=best-sellers&limit=8')).data;
    setProducts(best);
    var reviews = [];
    try {
      var first = best[0] || (await API.get('/products?limit=1')).data[0];
      if (first) {
        var d = await API.get('/products/' + first.handle);
        setProducts([d.data.product]);
        reviews = d.data.reviews;
      }
    } catch (e) { /* 评价取不到不影响首屏 */ }
    if (best.length < 4) best = (await API.get('/products?limit=8')).data;
    return V.home(boot, best, reviews);
  }

  async function bootLoad() {
    var res = await API.get('/bootstrap');
    S.setBoot(res.data);
    return res.data;
  }

  /* ---------------- 集合页 ---------------- */
  async function renderCollection(r) {
    var handle = r.seg[1] || 'best-sellers';
    var qs = new URLSearchParams();
    ['metal', 'price', 'stock', 'sort', 'page', 'q'].forEach(function (k) {
      if (r.query[k]) qs.set(k, r.query[k]);
    });
    qs.set('limit', '24');
    var res = await API.get('/collections/' + encodeURIComponent(handle) + '?' + qs.toString());
    setProducts(res.data);
    return V.collection(res.meta.collection, res.data, res.meta, r);
  }

  /* ---------------- 商品页 ---------------- */
  async function renderProduct(r) {
    var handle = r.seg[1];
    if (!handle) return V.notFound();
    var d = await API.get('/products/' + encodeURIComponent(handle));
    setProducts([d.data.product].concat(d.data.related || []));
    return V.product(d.data.product, d.data.reviews, d.data.related, r);
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
    });
    S.state.quote = res.data;
    return res.data;
  }

  async function renderCheckout(r) {
    if (!S.state.cart.length) { S.go('/cart'); return '<div></div>'; }
    var quote = await quoteNow();
    // 把报价行补上图，摘要里要显示缩略图
    quote.lines.forEach(function (l) {
      var c = S.state.cart.filter(function (x) { return x.productId === l.productId && x.metal === l.metal; })[0];
      l.image = c ? c.image : '';
    });
    return V.checkout(quote, Object.assign({ shipping: S.state.checkout.shipping || 'Standard' }, S.state.checkoutForm || {}), S.state.checkoutErr);
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

  async function renderAccount(r) {
    if ((r.seg[1] || '') !== 'lookup') S.go('/account/lookup');
    var st = S.state.lookup || {};
    return V.lookup(st.order, st.err, st.form);
  }

  /* ---------------- 后台 ---------------- */
  function adminToken() {
    try {
      var a = JSON.parse(localStorage.getItem('tideglass_admin') || 'null');
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
        var list = await API.get('/admin/orders?' + qs.toString(), { auth: true });
        return A.shell(A.orders(list.data, list.meta, r.query), 'orders', 'Orders', staff);
      }
      if (sec === 'products') {
        var pq = r.query.q ? '?q=' + encodeURIComponent(r.query.q) : '';
        var ps = await API.get('/admin/products' + pq, { auth: true });
        return A.shell(A.products(ps.data, r.query.q), 'products', 'Products', staff);
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

  S.onClick('thumb', function (el) {
    var main = document.getElementById('galMain');
    if (main) main.src = el.src;
    el.parentNode.querySelectorAll('img').forEach(function (i) { i.classList.remove('on'); });
    el.classList.add('on');
  });

  S.onClick('slide', function (el) {
    var i = Number(el.dataset.i);
    var media = document.getElementById('heroMedia');
    if (!media) return;
    media.querySelectorAll('img').forEach(function (img, k) { img.classList.toggle('on', k === i); });
    media.querySelectorAll('.hero__dots i').forEach(function (d, k) { d.classList.toggle('on', k === i); });
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
    try { localStorage.setItem('tideglass_cookie', 'all'); } catch (e) { }
    render();
  });
  S.onClick('ck-essential', function () {
    try { localStorage.setItem('tideglass_cookie', 'essential'); } catch (e) { }
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
      S.state.lastOrder = res.data.order;
      try { localStorage.setItem('tideglass_last_order', JSON.stringify(res.data.order)); } catch (e) { }
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
      localStorage.setItem('tideglass_admin', JSON.stringify({
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
    localStorage.removeItem('tideglass_admin');
    S.go('/admin');
    render();
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

  S.onClick('tracking', async function (el) {
    var t = prompt('Tracking number');
    if (!t) return;
    try {
      await API.post('/admin/orders/' + encodeURIComponent(el.dataset.num) + '/tracking',
        { tracking: t, carrier: 'USPS' }, { auth: true });
      S.toast('Tracking saved', 'ok');
      render();
    } catch (e) { S.toast(e.message, 'err'); }
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

  /* 搜索层：输入回车跳集合页搜索 */
  document.addEventListener('keydown', function (e) {
    var input = e.target;
    if (e.key === 'Enter' && input && input.id === 'searchInput') {
      var q = input.value.trim();
      if (q) { S.go('/collections/best-sellers?q=' + encodeURIComponent(q)); document.body.classList.remove('search-open'); }
    }
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      document.body.classList.add('search-open');
      var si = document.getElementById('searchInput');
      if (si) setTimeout(function () { si.focus(); }, 40);
    }
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
