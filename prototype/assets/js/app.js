/* ============================================================
   TIDEGLASS · 路由与交互
   ============================================================ */
(function () {
  'use strict';
  var U = S.U;
  var root = document.getElementById('app');
  var heroTimer = null;
  var lastPath = '';

  /* ---------------- 渲染 ---------------- */
  function render() {
    var r = S.parseHash();
    var isAdmin = r.seg[0] === 'admin';
    // 离开账户页就清掉上一次的登录错误，避免回到登录页还挂着旧提示
    if (r.seg[0] !== 'account') S.state.authErr = '';

    // 演示开关：?demo=cart 预置购物车并展开抽屉；后台 ?demo=1 自动登录
    if (r.query.demo === 'cart' && S.cartCount() === 0) {
      S.addToCart('foxtrot-pendant-necklace', 'Gold', '18"', 1);
      S.addToCart('tidepool-choker', 'Gold', '16"', 1);
    }
    if (isAdmin && r.query.demo === '1') S.state.admin = true;

    // 账户相关演示开关（截图与人工验收用）
    //   ?demo=account 以 demo 账号自动登录   ?demo=guest 强制登出
    //   ?demo=pay     预置地址并直接进支付步骤
    if (r.query.demo === 'account' && !S.state.user && window.Account) {
      var du = window.Account.findUser(window.Account.DEMO.email);
      if (du) { S.state.user = du; S.saveState(); }
    }
    if (r.query.demo === 'guest' && S.state.user) {
      S.state.user = null;
      S.saveState();
    }
    if (r.query.demo === 'pay') {
      if (S.cartCount() === 0) S.addToCart('foxtrot-pendant-necklace', 'Gold', '18"', 1);
      var cd = S.state.checkoutData;
      if (!cd.email) {
        var who = S.state.user;
        cd.email = who ? who.email : 'ada@example.com';
        cd.first = who ? who.first : 'Ada';
        cd.last = who ? who.last : 'Lovelace';
        cd.line1 = '12 Ocean Ave'; cd.city = 'Santa Monica'; cd.state = 'CA'; cd.zip = '90401';
      }
      if (r.seg[0] === 'checkout') S.state.checkoutStep = 2;
    }

    var html;
    if (isAdmin) {
      html = window.Admin.render(r);
    } else {
      var body;
      switch (r.seg[0]) {
        case undefined:
        case '': body = window.Store.home(); break;
        case 'collections': body = window.Store.collection(r); break;
        case 'products': body = window.Store.product(r); break;
        case 'search': body = window.Store.search(r); break;
        case 'checkout': body = window.Store.checkout(); break;
        case 'order': body = window.Store.orderDone(r); break;
        case 'account': body = window.Account.page(r); break;
        case 'pages': body = window.Store.content(r); break;
        default: body = window.Store.notFound();
      }
      html = window.UI.shell(body, r);
    }

    root.innerHTML = html;
    document.body.classList.remove('drawer-open', 'search-open', 'menu-open', 'filter-open');
    if (r.query.demo === 'cart') document.body.classList.add('drawer-open');
    if (r.seg[0] === 'checkout') document.body.classList.remove('drawer-open');
    afterRender(r, isAdmin);
  }

  function afterRender(r, isAdmin) {
    // Cookie 条存在时给 body 留出底部空间，避免压住页脚最后一行。
    // 高度按实测值写进 --ckh：桌面单行、手机两行，高度不一样，写死一个数必然有一端错。
    var ckb = document.getElementById('ckbar');
    document.body.classList.toggle('ck-open', !!ckb);
    if (ckb) document.body.style.setProperty('--ckh', ckb.offsetHeight + 'px');
    // hero 轮播
    clearInterval(heroTimer);
    var media = document.getElementById('heroMedia');
    if (media) {
      var imgs = media.querySelectorAll('img');
      var dots = media.querySelectorAll('.hero__dots i');
      var idx = 0;
      heroTimer = setInterval(function () {
        idx = (idx + 1) % imgs.length;
        imgs.forEach(function (im, i) { im.classList.toggle('on', i === idx); });
        dots.forEach(function (d, i) { d.classList.toggle('on', i === idx); });
      }, 5200);
    }
    // 搜索框自动聚焦
    if (document.body.classList.contains('search-open')) {
      var si = document.getElementById('searchInput');
      if (si) si.focus();
    }
    // 后台移动端菜单按钮
    var mb = document.getElementById('admMenuBtn');
    if (mb) {
      if (window.innerWidth <= 900) mb.style.display = 'inline-flex';
      else mb.style.display = 'none';
    }
    // 滚动位置
    if (S.state._scroll !== null && S.state._scroll !== undefined) {
      window.scrollTo(0, S.state._scroll);
      S.state._scroll = null;
    } else if (r.path !== lastPath) {
      window.scrollTo(0, 0);
    }
    lastPath = r.path;
  }

  /* ---------------- 购物车局部刷新 ---------------- */
  function paintCart() {
    var c = document.getElementById('bagCount');
    if (c) { var n = S.cartCount(); c.textContent = n; c.classList.toggle('is-zero', !n); }
    var drawer = document.getElementById('cartDrawer');
    if (drawer) {
      var tmp = document.createElement('div');
      tmp.innerHTML = window.UI.cartDrawer();
      var nd = tmp.querySelector('#cartDrawer');
      drawer.parentNode.replaceChild(nd, drawer);
    }
    // 结算页需要整体刷新（金额变了）
    if (S.parseHash().seg[0] === 'checkout') render();
  }

  function openCart() {
    document.body.classList.add('drawer-open');
  }

  /* ---------------- 前台事件 ---------------- */
  S.onClick('open-cart', openCart);
  S.onClick('close-cart', function () { document.body.classList.remove('drawer-open'); });
  S.onClick('open-search', function () { S.openSearch(); });
  S.onClick('close-search', function () { document.body.classList.remove('search-open'); });
  S.onClick('open-menu', function () { document.body.classList.add('menu-open'); });
  S.onClick('close-menu', function () { document.body.classList.remove('menu-open'); });
  S.onClick('open-filter', function () { document.body.classList.add('filter-open'); });
  S.onClick('close-filter', function () { document.body.classList.remove('filter-open'); });

  // Cookie 同意（FR-S-095）：选择写入 localStorage，之后不再弹出。
  // 只有选了 all 才允许加载分析类脚本——这是归因采集的前提（BR 见 SDD 7.8）。
  S.onClick('ck-all', function () {
    try { localStorage.setItem('tideglass_cookie', 'all'); } catch (e) { }
    var el = document.getElementById('ckbar'); if (el) el.remove();
    document.body.classList.remove('ck-open');
    if (S.toast) S.toast('Cookies accepted — analytics on');
  });
  S.onClick('ck-essential', function () {
    try { localStorage.setItem('tideglass_cookie', 'essential'); } catch (e) { }
    var el = document.getElementById('ckbar'); if (el) el.remove();
    document.body.classList.remove('ck-open');
    if (S.toast) S.toast('Only necessary cookies');
  });

  S.onClick('add', function (el) {
    var res = S.addToCart(el.dataset.pid, el.dataset.metal, el.dataset.size || '', 1);
    if (!res.ok) { S.toast(res.msg, 'err'); return; }
    paintCart();
    el.classList.add('done');
    var old = el.textContent;
    el.textContent = 'Added ✓';
    setTimeout(function () { el.classList.remove('done'); el.textContent = old; }, 1600);
    S.toast('Added to your bag');
  });

  S.onClick('add-open', function (el) {
    var qty = Number((document.getElementById('pdpQty') || {}).value || 1);
    var res = S.addToCart(el.dataset.pid, el.dataset.metal, el.dataset.size || '', qty);
    if (!res.ok) { S.toast(res.msg, 'err'); return; }
    paintCart();
    openCart();
  });

  S.onClick('qty', function (el) {
    var key = el.dataset.key, d = Number(el.dataset.d);
    var line = S.cartLines().filter(function (l) { return l.key === key; })[0];
    if (!line) return;
    S.setQty(key, line.qty + d);
    paintCart();
  });

  S.onClick('rm', function (el) {
    S.removeLine(el.dataset.key);
    paintCart();
    S.toast('Removed');
  });

  S.onClick('rm-coupon', function () {
    S.state.coupon = null; S.saveState(); paintCart(); S.toast('Code removed');
  });

  S.onClick('go-checkout', function () {
    document.body.classList.remove('drawer-open');
  });

  S.onClick('rail', function (el) {
    var rail = document.getElementById(el.dataset.target);
    if (!rail) return;
    var w = rail.clientWidth * 0.8;
    rail.scrollBy({ left: Number(el.dataset.d) * w, behavior: 'smooth' });
  });

  S.onClick('slide', function (el) {
    var media = document.getElementById('heroMedia');
    if (!media) return;
    var imgs = media.querySelectorAll('img'), dots = media.querySelectorAll('.hero__dots i');
    var i = Number(el.dataset.i);
    imgs.forEach(function (im, k) { im.classList.toggle('on', k === i); });
    dots.forEach(function (d, k) { d.classList.toggle('on', k === i); });
  });

  S.onClick('thumb', function (el) {
    var i = Number(el.dataset.i);
    document.querySelectorAll('.gal__thumbs img').forEach(function (t, k) { t.classList.toggle('on', k === i); });
    var p = S.product(S.parseHash().seg[1]);
    if (p) document.getElementById('galMain').src = p.images[i];
  });

  S.onClick('metal', function (el) {
    var r = S.parseHash();
    var o = { metal: el.dataset.m, size: r.query.size || '' };
    S.go('/products/' + el.dataset.handle + '?metal=' + encodeURIComponent(o.metal) + (o.size ? '&size=' + encodeURIComponent(o.size) : ''));
  });

  S.onClick('size', function (el) {
    var r = S.parseHash();
    S.go('/products/' + el.dataset.handle + '?metal=' + encodeURIComponent(r.query.metal || '') + '&size=' + encodeURIComponent(el.dataset.s));
  });

  S.onClick('pdpq', function (el) {
    var inp = document.getElementById('pdpQty');
    var v = Math.max(1, Math.min(10, Number(inp.value) + Number(el.dataset.d)));
    inp.value = v;
  });

  S.onClick('acc', function (el) {
    var item = el.parentNode;
    item.classList.toggle('open');
    var ic = el.querySelector('i');
    if (ic) ic.textContent = item.classList.contains('open') ? '−' : '+';
  });

  S.onClick('more', function () {
    var r = S.parseHash();
    var cur = Number(r.query.limit || 12);
    var o = {};
    Object.keys(r.query).forEach(function (k) { o[k] = r.query[k]; });
    o.limit = cur + 12;
    S.state._scroll = window.scrollY;
    var qs = Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
    S.go('/collections/' + r.seg[1] + '?' + qs);
  });

  S.onClick('to-pay', function () {
    var d = S.state.checkoutData;
    var errs = 0;
    ['email', 'first', 'last', 'line1', 'city', 'state', 'zip'].forEach(function (k) {
      delete d['_err_' + k];
      if (!String(d[k] || '').trim()) { d['_err_' + k] = 'Required'; errs++; }
    });
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) { d['_err_email'] = 'Enter a valid email'; errs++; }
    if (errs) { render(); S.toast('Please complete the highlighted fields', 'err'); return; }
    S.state.checkoutStep = 2;
    render();
    window.scrollTo(0, 0);
  });

  S.onClick('back-info', function () {
    S.state.checkoutStep = 1;
    // 如果是从 ?demo=pay 进来的，去掉这个开关，否则会被再次强制拉回支付步骤
    if (S.parseHash().query.demo === 'pay') { S.go('/checkout'); return; }
    render();
  });

  S.onClick('pay-method', function (el) {
    var pay = S.state.checkoutPay || (S.state.checkoutPay = { method: 'card' });
    pay.method = el.dataset.m || 'card';
    pay.err = '';
    render();
  });

  S.onClick('testcard', function (el) {
    var d = S.state.checkoutData;
    d.cardNumber = window.Store.groupCard(el.dataset.num);
    d.expiry = '04 / 28';
    d.cvc = '123';
    if (S.state.checkoutPay) S.state.checkoutPay.err = '';
    render();
    S.toast('Test card ending ' + el.dataset.num.slice(-4) + ' filled in', 'ok');
  });

  S.onClick('place', function (el) {
    if (el.dataset.busy === '1') return;
    var d = S.state.checkoutData;
    var pay = S.state.checkoutPay || (S.state.checkoutPay = { method: 'card' });
    var method = pay.method || 'card';
    pay.err = '';

    // 卡支付先做本地校验，像真实网关一样在提交前拦下明显错误的输入
    if (method === 'card') {
      var num = String(d.cardNumber || '').replace(/\D/g, '');
      if (num.length < 13) { pay.err = 'Enter your card number.'; render(); return; }
      if (!window.Store.luhn(num)) {
        pay.err = "That card number isn't valid — check the digits and try again.";
        render(); return;
      }
      if (!window.Store.expiryOk(d.expiry)) {
        pay.err = 'Check the expiry date — it looks incomplete or already past.';
        render(); return;
      }
      if (!/^\d{3,4}$/.test(String(d.cvc || ''))) {
        pay.err = 'Enter the 3-digit security code from the back of your card.';
        render(); return;
      }
      if (num === '4000000000000002') {
        pay.err = 'Your bank declined the payment (card_declined). Try another card — the 4242 test card always succeeds.';
        render(); return;
      }
      if (num === '4000000000009995') {
        pay.err = 'Not enough funds on this card (insufficient_funds). Try the 4242 test card.';
        render(); return;
      }
    }

    // 处理中：按钮文案分阶段推进，让人看得出在跟银行通信，而不是卡住
    el.dataset.busy = '1';
    el.disabled = true;
    el.textContent = method === 'card' ? 'Contacting your bank…' : 'Confirming…';
    setTimeout(function () {
      if (document.body.contains(el)) el.textContent = method === 'card' ? 'Authorising…' : 'Almost there…';
    }, 750);
    setTimeout(function () {
      if (document.body.contains(el)) el.textContent = 'Capturing payment…';
    }, 1350);

    setTimeout(function () {
      var res = S.placeOrder(d);
      if (!res.ok) {
        pay.err = res.msg;
        render();
        return;
      }
      S.state.checkoutStep = 1;
      S.state.checkoutData = {};
      S.state.checkoutPay = { method: 'card', err: '' };
      S.go('/order/' + encodeURIComponent(res.order.number));
      setTimeout(function () { S.toast('Payment captured · ' + res.order.number, 'ok'); }, 320);
    }, 1900);
  });

  /* 表单提交 */
  S.onSubmit('coupon', function (form) {
    var code = form.code.value.trim();
    var res = S.couponError(code);
    var msg = document.getElementById('couponMsg');
    if (!res.ok) {
      if (msg) { msg.className = 'coupon-msg err'; msg.textContent = res.msg; }
      return;
    }
    S.state.coupon = { code: res.coupon.code, type: res.coupon.type, value: res.coupon.value, minSubtotal: res.coupon.minSubtotal };
    S.saveState();
    paintCart();
    S.toast('Code applied — ' + (res.coupon.type === 'percent' ? res.coupon.value + '% off' : U.money0(res.coupon.value) + ' off'), 'ok');
  });

  S.onSubmit('newsletter', function (form) {
    var email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.toast('Enter a valid email', 'err'); return; }
    S.toast('You are in. Check your inbox for 10% off.', 'ok');
    form.reset();
  });

  S.onSubmit('searchpage', function (form) {
    var q = form.q.value.trim();
    if (!q) { S.toast('Type something to search', 'err'); return; }
    S.go('#/search?q=' + encodeURIComponent(q));
  });

  S.onSubmit('lookup', function (form) {
    var num = form.number.value.trim();
    var email = form.email.value.trim().toLowerCase();
    var norm = num.indexOf('#') === 0 ? num : '#' + num.replace(/^TG/i, 'TG');
    var o = S.DB.orders.filter(function (x) {
      return (x.number.toLowerCase() === num.toLowerCase() || x.number.toLowerCase() === norm.toLowerCase()) &&
        x.email.toLowerCase() === email;
    })[0];
    S.state.lookup = o ? { ok: true, order: o } : { ok: false };
    render();
  });

  /* ---------------- 用户中心 ---------------- */
  function authErr(msg) { S.state.authErr = msg; render(); }

  // 登录/注册成功后去哪：优先回到 next 指定的站内页面，否则进账户中心
  function afterAuth() {
    var nx = (S.parseHash().query || {}).next;
    if (nx && /^\/?(checkout|cart)$/.test(nx)) {
      S.go(nx.charAt(0) === '/' ? nx : '/' + nx);
      return;
    }
    S.go('/account');
  }
  function repaintKeepScroll() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  S.onSubmit('acc-signin', function (form) {
    var email = String(form.email.value || '').trim().toLowerCase();
    var pw = String(form.pw.value || '');
    var u = window.Account.findUser(email);
    if (!u || u.pw !== window.Account.digest(pw)) {
      authErr("That email and password don't match. Try again, or create an account.");
      return;
    }
    S.state.authErr = '';
    window.Account.persist(u);
    S.toast('Welcome back, ' + u.first, 'ok');
    afterAuth();
  });

  S.onClick('acc-fill', function () {
    var e = document.querySelector('.authcard input[name="email"]');
    var p = document.querySelector('.authcard input[name="pw"]');
    if (e) e.value = window.Account.DEMO.email;
    if (p) p.value = window.Account.DEMO.pw;
    if (e) e.focus();
    S.toast('Demo details filled in — hit Sign in', 'ok');
  });

  S.onSubmit('acc-signup', function (form) {
    var first = String(form.first.value || '').trim();
    var last = String(form.last.value || '').trim();
    var email = String(form.email.value || '').trim().toLowerCase();
    var pw = String(form.pw.value || '');
    if (!first || !last) { authErr('Please fill in your first and last name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authErr('Enter a valid email address.'); return; }
    if (pw.length < 8) { authErr('Use at least 8 characters for your password.'); return; }
    if (window.Account.findUser(email)) { authErr('An account with that email already exists. Sign in instead.'); return; }
    var u = {
      email: email, pw: window.Account.digest(pw), first: first, last: last,
      since: new Date().toISOString().slice(0, 10),
      marketing: !!(form.marketing && form.marketing.checked),
      addresses: [], wishlist: []
    };
    S.state.authErr = '';
    window.Account.persist(u);
    S.toast('Account created — welcome, ' + first, 'ok');
    afterAuth();
  });

  S.onClick('acc-signout', function () {
    window.Account.signOut();
    S.toast('Signed out');
    S.go('/account/login');
  });

  S.onSubmit('acc-profile', function (form) {
    var u = window.Account.me();
    if (!u) return;
    var email = String(form.email.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.toast('Enter a valid email address', 'err'); return; }
    var clash = window.Account.findUser(email);
    if (clash && clash.email.toLowerCase() !== u.email.toLowerCase()) {
      S.toast('That email is already used by another account', 'err');
      return;
    }
    var oldEmail = u.email;
    u.first = String(form.first.value || '').trim();
    u.last = String(form.last.value || '').trim();
    u.email = email;
    u.marketing = !!(form.marketing && form.marketing.checked);
    // 换邮箱后必须把历史订单一起迁过来，否则「我的订单」会瞬间清空
    if (oldEmail.toLowerCase() !== email) {
      S.DB.orders.forEach(function (o) {
        if (String(o.email).toLowerCase() === oldEmail.toLowerCase()) o.email = email;
      });
      S.saveDB();
    }
    window.Account.persist(u);
    render();
    S.toast('Profile updated', 'ok');
  });

  S.onSubmit('acc-password', function (form) {
    var u = window.Account.me();
    if (!u) return;
    if (window.Account.digest(String(form.old.value || '')) !== u.pw) { S.toast('Current password is incorrect', 'err'); return; }
    if (String(form.pw.value || '').length < 8) { S.toast('Use at least 8 characters', 'err'); return; }
    if (form.pw.value !== form.pw2.value) { S.toast("The two passwords don't match", 'err'); return; }
    u.pw = window.Account.digest(form.pw.value);
    window.Account.persist(u);
    form.reset();
    S.toast('Password updated', 'ok');
  });

  var closeArmed = false;
  S.onClick('acc-close', function (el) {
    if (!closeArmed) {
      closeArmed = true;
      el.textContent = 'Tap again to confirm — this cannot be undone';
      return;
    }
    closeArmed = false;
    window.Account.remove(window.Account.me().email);
    S.toast('Account closed');
    S.go('/');
  });

  /* 地址簿 */
  S.onClick('addr-new', function () { S.state.addrEditing = 'new'; render(); });
  S.onClick('addr-edit', function (el) { S.state.addrEditing = el.dataset.id; render(); });
  S.onClick('addr-cancel', function () { S.state.addrEditing = null; render(); });

  S.onClick('addr-default', function (el) {
    var u = window.Account.me();
    u.addresses.forEach(function (a) { a.isDefault = a.id === el.dataset.id; });
    window.Account.persist(u);
    render();
    S.toast('Default address updated', 'ok');
  });

  var addrArmed = '';
  S.onClick('addr-del', function (el) {
    if (addrArmed !== el.dataset.id) {
      addrArmed = el.dataset.id;
      el.textContent = 'Tap to confirm';
      return;
    }
    addrArmed = '';
    var u = window.Account.me();
    u.addresses = u.addresses.filter(function (a) { return a.id !== el.dataset.id; });
    if (u.addresses.length && !u.addresses.some(function (a) { return a.isDefault; })) u.addresses[0].isDefault = true;
    window.Account.persist(u);
    render();
    S.toast('Address removed', 'ok');
  });

  S.onSubmit('addr-save', function (form) {
    var u = window.Account.me();
    if (!u) return;
    var id = form.getAttribute('data-id') || '';
    var a = {
      id: id || 'A' + Date.now().toString(36),
      label: 'Address',
      first: String(form.first.value || '').trim(),
      last: String(form.last.value || '').trim(),
      line1: String(form.line1.value || '').trim(),
      line2: String(form.line2.value || '').trim(),
      city: String(form.city.value || '').trim(),
      state: String(form.state.value || '').trim(),
      zip: String(form.zip.value || '').trim(),
      country: form.country.value,
      phone: String(form.phone.value || '').trim(),
      isDefault: !!(form.isDefault && form.isDefault.checked)
    };
    u.addresses = u.addresses || [];
    if (id) u.addresses = u.addresses.map(function (x) { return x.id === id ? a : x; });
    else u.addresses.push(a);
    if (a.isDefault) u.addresses.forEach(function (x) { if (x.id !== a.id) x.isDefault = false; });
    if (!u.addresses.some(function (x) { return x.isDefault; })) u.addresses[0].isDefault = true;
    window.Account.persist(u);
    S.state.addrEditing = null;
    render();
    S.toast('Address saved', 'ok');
  });

  /* 心愿单 */
  S.onClick('wish', function (el) {
    var res = window.Account.toggleWish(el.dataset.pid);
    if (!res.ok) {
      S.toast(res.msg, 'err');
      if (res.needAuth) setTimeout(function () { S.go('/account/login'); }, 900);
      return;
    }
    repaintKeepScroll();
    S.toast(res.on ? 'Saved to your wishlist' : 'Removed from wishlist');
  });

  S.onClick('acc-buy-again', function (el) {
    var o = S.DB.orders.filter(function (x) { return x.number === el.dataset.num; })[0];
    if (!o) return;
    o.items.forEach(function (it) {
      var p = S.product(it.productId);
      if (!p) return;
      var v = (p.variants || []).filter(function (x) { return x.metal === it.variant; })[0] || (p.variants || [])[0];
      S.addToCart(p.id, v ? v.metal : '', it.size || '', it.qty);
    });
    S.toast('Added to your bag');
    setTimeout(function () { S.go('/checkout'); }, 500);
  });

  /* 结算表单输入同步 */
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.closest('.co') && t.name && !/ship/.test(t.name)) {
      S.state.checkoutData[t.name] = t.value;
      if (t.classList.contains('err')) {
        t.classList.remove('err');
        var f = t.closest('.fld'); if (f) f.classList.remove('bad');
      }
    }
    // 搜索联想
    if (t.id === 'searchInput') {
      var q = t.value.trim().toLowerCase();
      var box = document.getElementById('searchRes');
      if (!box) return;
      if (!q) { box.innerHTML = ''; return; }
      var list = S.allProducts().filter(function (p) {
        return (p.title + ' ' + p.motif + ' ' + p.collections.join(' ')).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 4);
      box.innerHTML = list.length ? list.map(function (p) { return window.UI.productCard(p, { noAdd: true }); }).join('')
        : '<p style="font-size:12px;color:var(--muted)">No matches — try “turtle”, “moon”, or “pearl”.</p>';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.id !== 'searchInput') return;
    if (e.key === 'Enter') {
      var q = e.target.value.trim();
      document.body.classList.remove('search-open');
      S.go('/search?q=' + encodeURIComponent(q));
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.act === 'sort') {
      var r = S.parseHash();
      var o = {};
      Object.keys(r.query).forEach(function (k) { if (k !== 'sort' && k !== 'limit') o[k] = r.query[k]; });
      if (t.value !== 'featured') o.sort = t.value;
      var qs = Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
      S.state._scroll = 0;
      S.go('/collections/' + t.dataset.handle + (qs ? '?' + qs : ''));
    }
    if (t.dataset.act === 'ship') {
      S.state.checkoutData.shipping = t.value;
      render();
    }
    if (t.name === 'country' && t.dataset.act === 'country') {
      S.state.checkoutData.country = t.value;
    }
    // 后台库存行内编辑
    if (t.dataset.inv !== undefined && t.dataset.inv) {
      var parts = t.dataset.inv.split('|');
      var p = S.product(parts[0]);
      var v = p && p.variants.filter(function (x) { return x.sku === parts[1]; })[0];
      if (v) {
        v.stock = Math.max(0, Number(t.value) || 0);
        p.stock = p.variants.reduce(function (a, x) { return a + x.stock; }, 0);
        S.saveDB();
        S.toast(parts[1] + ' → ' + v.stock + ' units', 'ok');
      }
    }
    // 后台设置里的费率
    if (t.dataset.set) {
      S.DB.settings[t.dataset.set] = Number(t.value);
      S.saveDB();
      S.toast('Saved', 'ok');
    }
    if (t.dataset.cost) {
      S.DB.settings.costs[t.dataset.cost] = Number(t.value);
      S.saveDB();
      S.toast('Cost model updated', 'ok');
    }
  });

  /* 滚动吸顶 */
  window.addEventListener('scroll', function () {
    var h = document.getElementById('hdr');
    if (h) h.classList.toggle('stuck', window.scrollY > 40);
  }, { passive: true });

  window.addEventListener('resize', function () {
    var mb = document.getElementById('admMenuBtn');
    if (mb) mb.style.display = window.innerWidth <= 900 ? 'inline-flex' : 'none';
  });

  /* ---------------- 后台事件 ---------------- */
  S.onClick('adm-menu', function () {
    var s = document.getElementById('admSide');
    if (s) s.classList.toggle('open');
  });

  S.onClick('logout', function () {
    S.state.admin = false; S.saveState();
    S.go('/admin');
    render();
    S.toast('Signed out');
  });

  S.onSubmit('login', function (form) {
    var pw = form.password.value;
    if (pw === 'tideglass2026' || pw === '') {
      S.state.admin = true; S.saveState();
      render();
      S.toast('Welcome back', 'ok');
    } else {
      S.toast('Wrong password — try tideglass2026', 'err');
      form.password.value = '';
    }
  });

  S.onClick('ofilter', function (el) {
    S.state.admFilter = { status: el.dataset.s, q: (S.state.admFilter || {}).q || '' };
    render();
  });

  document.addEventListener('input', function (e) {
    if (e.target.dataset.act === 'osearch') {
      S.state.admFilter = { status: (S.state.admFilter || {}).status || '', q: e.target.value };
      var pos = e.target.selectionStart;
      render();
      var el = document.querySelector('[data-act="osearch"]');
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }
    if (e.target.dataset.act === 'psearch') {
      S.state.admProdQ = e.target.value;
      var p2 = e.target.selectionStart;
      render();
      var el2 = document.querySelector('[data-act="psearch"]');
      if (el2) { el2.focus(); el2.setSelectionRange(p2, p2); }
    }
  });

  S.onClick('ostatus', function (el) {
    var o = S.DB.orders.filter(function (x) { return x.number === el.dataset.num; })[0];
    if (!o) return;
    var to = el.dataset.to;
    // 退款与取消有连带副作用（回补库存 / 释放优惠码 / 冲减客户消费），
    // 必须走统一出口，不能只改状态字段。
    if (to === 'refunded') { doRefund(o.number); return; }
    if (to === 'cancelled') {
      var rc = S.cancelOrder(o.number);
      if (!rc.ok) { S.toast(rc.msg, 'err'); return; }
      render(); S.toast('Order ' + o.number + ' cancelled · stock returned', 'ok');
      return;
    }
    var LABEL = { paid: 'Paid', fulfilling: 'Preparing', fulfilled: 'Shipped', completed: 'Delivered' };
    o.status = to;
    o.statusLabel = LABEL[to] || to;
    if (to === 'fulfilled' && !o.tracking) o.tracking = '9400' + Math.floor(Math.random() * 1e10);
    S.saveDB();
    render();
    S.toast('Order ' + o.number + ' → ' + o.statusLabel, 'ok');
  });

  S.onClick('ship', function (el) {
    var o = S.DB.orders.filter(function (x) { return x.number === el.dataset.num; })[0];
    if (!o) return;
    o.tracking = '9400' + Math.floor(Math.random() * 1e10);
    o.carrier = 'USPS';
    S.saveDB();
    render();
    S.toast('Tracking added: ' + o.tracking, 'ok');
  });

  function doRefund(number) {
    var r = S.refundOrder(number);
    if (!r.ok) { S.toast(r.msg, 'err'); return; }
    render();
    S.toast('Refunded ' + r.order.number + ' · stock returned, coupon released', 'ok');
  }

  S.onClick('refund', function (el) { doRefund(el.dataset.num); });

  S.onClick('newprod', function () {
    S.toast('In the real build this opens a blank product form');
  });

  S.onClick('saveprod', function (el) {
    var p = S.product(el.dataset.id);
    if (!p) return;
    var oldPrice = p.price;
    var newPrice = p.price;
    document.querySelectorAll('[data-pf]').forEach(function (inp) {
      var k = inp.dataset.pf;
      if (k === 'price') { newPrice = Number(inp.value) || 0; p.price = newPrice; return; }
      p[k] = (k === 'cost' || k === 'compareAt') ? Number(inp.value) || 0 : inp.value;
    });
    // 变体价格跟随商品基础价，保留各自溢价系数（如 Rose Gold +5%）
    if (oldPrice > 0 && newPrice !== oldPrice) {
      p.variants.forEach(function (v) {
        v.price = Math.round(newPrice * (v.price / oldPrice) * 100) / 100;
      });
    }
    document.querySelectorAll('[data-vstock]').forEach(function (inp) {
      var i = Number(inp.dataset.vstock);
      if (p.variants[i]) p.variants[i].stock = Math.max(0, Number(inp.value) || 0);
    });
    p.stock = p.variants.reduce(function (a, x) { return a + x.stock; }, 0);
    S.saveDB();
    render();
    S.toast('Saved — storefront updated', 'ok');
  });

  S.onClick('togactive', function (el) {
    var p = S.product(el.dataset.id);
    if (!p) return;
    p.active = !p.active;
    S.saveDB();
    render();
    S.toast(p.title + (p.active ? ' is live' : ' is now a draft'), 'ok');
  });

  S.onClick('restock', function (el) {
    var p = S.product(el.dataset.id);
    var v = p && p.variants.filter(function (x) { return x.sku === el.dataset.sku; })[0];
    if (!v) return;
    v.stock += 20;
    p.stock = p.variants.reduce(function (a, x) { return a + x.stock; }, 0);
    S.saveDB();
    render();
    S.toast('+20 units on ' + v.sku, 'ok');
  });

  S.onClick('delcoupon', function (el) {
    S.DB.coupons = S.DB.coupons.filter(function (c) { return c.code !== el.dataset.code; });
    S.saveDB();
    render();
    S.toast('Code deleted');
  });

  S.onSubmit('newcoupon', function (form) {
    var code = (form.code.value || '').trim().toUpperCase();
    if (!code) { S.toast('Enter a code', 'err'); return; }
    if (S.DB.coupons.some(function (c) { return c.code === code; })) {
      S.toast('That code already exists', 'err'); return;
    }
    S.DB.coupons.unshift({
      code: code,
      type: form.type.value,
      value: Number(form.value.value) || 0,
      minSubtotal: Number(form.min.value) || 0,
      used: 0,
      limit: Number(form.limit.value) || 100,
      startsAt: new Date().toISOString().slice(0, 10),
      endsAt: '2026-12-31',
      status: 'active',
      note: 'Created in prototype'
    });
    S.saveDB();
    render();
    S.toast('Code ' + code + ' created', 'ok');
  });

  S.onClick('rev-reveal', function (el) {
    var f = document.querySelector('[data-del="' + el.dataset.id + '"]');
    if (f) f.hidden = false;
  });
  S.onClick('rev-cancel', function (el) {
    var f = document.querySelector('[data-del="' + el.dataset.id + '"]');
    if (f) f.hidden = true;
  });
  S.onClick('rev-pick', function (el) {
    S.state._revReason = S.state._revReason || {};
    S.state._revReason[el.dataset.id] = el.dataset.rs;
    document.querySelectorAll('[data-act="rev-pick"][data-id="' + el.dataset.id + '"]').forEach(function (c) {
      c.classList.toggle('on', c.dataset.rs === el.dataset.rs);
    });
    var n = document.querySelector('[data-revnote="' + el.dataset.id + '"]');
    if (n) n.textContent = 'Reason: ' + el.dataset.rs;
  });
  S.onClick('rev-del', function (el) {
    var id = el.dataset.id;
    var r = S.DB.reviews.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (r.rating <= 2 && !(S.state._revReason && S.state._revReason[id])) {
      S.toast('A reason is required to delete a 1–2 star review', 'err');
      return;
    }
    r.status = 'deleted';
    r.deletedReason = (S.state._revReason || {})[id] || 'policy';
    S.saveDB();
    render();
    S.toast('Review removed from storefront', 'ok');
  });
  S.onClick('rev-ok', function (el) {
    var r = S.DB.reviews.filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!r) return;
    r.status = 'approved';
    var p = S.product(r.productId);
    if (p) {
      var all = S.DB.reviews.filter(function (x) { return x.productId === p.id && x.status === 'approved'; });
      p.rating = Number((all.reduce(function (a, x) { return a + x.rating; }, 0) / all.length).toFixed(1));
    }
    S.saveDB();
    render();
    S.toast('Published to product page', 'ok');
  });
  S.onClick('rev-rm', function (el) {
    var r = S.DB.reviews.filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!r) return;
    r.status = 'deleted';
    r.deletedReason = 'removed from published list';
    S.saveDB();
    render();
    S.toast('Deleted');
  });

  S.onClick('cr-next', function (el) {
    var c = S.DB.customRequests.filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!c) return;
    var flow = ['new', 'quoted', 'in_progress', 'done'];
    c.status = flow[Math.min(flow.indexOf(c.status) + 1, 3)];
    S.saveDB();
    render();
    S.toast(c.id + ' → ' + c.status.replace('_', ' '), 'ok');
  });

  S.onClick('savetext', function () {
    var c = S.DB.settings.content || (S.DB.settings.content = {});
    document.querySelectorAll('[data-ck]').forEach(function (el) {
      c[el.dataset.ck] = el.value;
    });
    S.saveDB();
    S.toast('Content saved — reload the storefront to see it', 'ok');
  });
  S.onClick('saveset', function () { S.toast('Settings saved — new orders use these rates', 'ok'); });
  S.onClick('reset', function () {
    S.resetDB();
    S.state.lookup = null;
    render();
    S.toast('Prototype data restored', 'ok');
  });

  /* ---------------- 原型导航（右下角） ---------------- */
  var navBtn = document.getElementById('protoNavBtn');
  var navPanel = document.getElementById('protoNavPanel');
  if (navBtn) {
    navBtn.addEventListener('click', function () {
      navPanel.classList.toggle('open');
    });
  }

  /* ---------------- 启动 ---------------- */
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/';
  render();
})();
