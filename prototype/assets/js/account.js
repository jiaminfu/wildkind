/* 前台用户中心：注册 / 登录 / 概览 / 订单 / 地址簿 / 心愿单 / 设置
 *
 * 账号表存在 localStorage（原型用）。密码只存不可逆摘要，不落明文。
 * 订单归属按邮箱匹配 DB.orders[].email —— 所以结算页在已登录时会锁住邮箱，
 * 保证下单后订单一定出现在账户里，而不是「付完钱却查不到」。
 */
window.Account = (function () {
  var S = window.S, U = S.U, ui = window.UI;
  var UKEY = 'tideglass_proto_v4_users';
  var DEMO = { email: 'maya.patel@gmail.com', pw: 'tideglass2026' };

  /* ---------- 账号表 ---------- */
  function digest(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return 'd' + h.toString(36);
  }

  function seed() {
    return [{
      email: DEMO.email, pw: digest(DEMO.pw),
      first: 'Maya', last: 'Patel', since: '2026-03-14', marketing: true,
      addresses: [{
        id: 'A1', label: 'Home', first: 'Maya', last: 'Patel',
        line1: '1420 Fremont Ave N', line2: 'Apt 3', city: 'Seattle', state: 'WA',
        zip: '98103', country: 'United States', phone: '(206) 555-0147', isDefault: true
      }],
      wishlist: []
    }];
  }

  function allUsers() {
    try {
      var raw = localStorage.getItem(UKEY);
      if (raw === null) { var s = seed(); localStorage.setItem(UKEY, JSON.stringify(s)); return s; }
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) { return seed(); }
  }
  function saveUsers(list) {
    try { localStorage.setItem(UKEY, JSON.stringify(list)); } catch (e) { }
  }
  function me() { return S.state.user; }
  function findUser(email) {
    var k = String(email || '').toLowerCase();
    return allUsers().filter(function (x) { return x.email.toLowerCase() === k; })[0] || null;
  }
  function persist(u) {
    var list = allUsers(), k = u.email.toLowerCase(), hit = false;
    list = list.map(function (x) {
      if (x.email.toLowerCase() === k) { hit = true; return u; }
      return x;
    });
    if (!hit) list.push(u);
    saveUsers(list);
    S.state.user = u;
    S.saveState();
  }
  function signOut() {
    S.state.user = null;
    S.state.authErr = '';
    S.saveState();
  }
  function ordersOf(u) {
    if (!u) return [];
    var k = u.email.toLowerCase();
    return S.DB.orders.filter(function (o) { return String(o.email || '').toLowerCase() === k; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }
  function wishCount(u) { return (u && u.wishlist ? u.wishlist.length : 0); }
  function remove(email) {
    var k = String(email || '').toLowerCase();
    saveUsers(allUsers().filter(function (x) { return x.email.toLowerCase() !== k; }));
    signOut();
  }

  /* ---------- 通用小组件 ---------- */
  function field(name, label, value, extra) {
    return '<div class="fld"><label>' + label + '</label>' +
      '<input name="' + name + '" value="' + U.esc(value || '') + '" ' + (extra || '') + '></div>';
  }

  function statusPill(o) {
    return '<span class="pill ' + o.status + '">' + U.esc(o.statusLabel || o.status) + '</span>';
  }

  function timeline(o) {
    var steps = ['paid', 'fulfilling', 'fulfilled', 'completed'];
    var idx = steps.indexOf(o.status);
    if (o.status === 'refunded' || o.status === 'cancelled') idx = -1;
    return '<div class="tl">' + ['Paid', 'Preparing', 'Shipped', 'Delivered'].map(function (lbl, i) {
      var on = i <= idx;
      return '<div class="tl__step' + (on ? ' on' : '') + '"><i></i><span>' + lbl + '</span></div>';
    }).join('') + '</div>';
  }

  /* ---------- 登录 / 注册 ---------- */
  // 登录/注册后回到用户原本要去的页面（例如从购物车点 Sign in → 回结算）
  function nx() {
    var q = (S.parseHash() || {}).query || {};
    return q.next ? '?next=' + encodeURIComponent(q.next) : '';
  }
  function authWrap(title, sub, body, foot) {
    return '<div class="wrap"><div class="authcard">' +
      '<div class="authcard__mk">' + ui.mark() + '</div>' +
      '<h1>' + title + '</h1><p class="authcard__sub">' + sub + '</p>' +
      (S.state.authErr ? '<div class="formerr">' + U.esc(S.state.authErr) + '</div>' : '') +
      body +
      '<div class="authcard__foot">' + foot + '</div></div></div>';
  }

  function loginPage() {
    return authWrap('Welcome back', 'Sign in to see your orders and saved addresses.',
      '<form data-act="acc-signin" autocomplete="on">' +
      field('email', 'Email', '', 'type="email" placeholder="you@email.com" required') +
      '<div class="fld"><label>Password</label>' +
      '<input name="pw" type="password" placeholder="••••••••" required></div>' +
      '<div class="authcard__row"><label class="chk"><input type="checkbox" name="remember" checked> Keep me signed in</label>' +
      '<a href="#/pages/contact" class="link-u">Forgot password?</a></div>' +
      '<button class="btn btn--full" type="submit">Sign in</button></form>' +
      '<div class="demo-tip"><b>Demo account</b><span>' + DEMO.email + ' / ' + DEMO.pw + '</span>' +
      '<button data-act="acc-fill" type="button">Fill it in</button></div>',
      'New here? <a href="#/account/register' + nx() + '" class="link-u">Create an account</a> · ' +
      '<a href="#/account/lookup" class="link-u">Track an order as guest</a>');
  }

  function registerPage() {
    return authWrap('Create your account', 'Save addresses, track orders, and keep a wishlist.',
      '<form data-act="acc-signup" autocomplete="on">' +
      '<div class="row2">' + field('first', 'First name', '', 'required') + field('last', 'Last name', '', 'required') + '</div>' +
      field('email', 'Email', '', 'type="email" placeholder="you@email.com" required') +
      '<div class="fld"><label>Password</label><input name="pw" type="password" placeholder="At least 8 characters" minlength="8" required></div>' +
      '<label class="chk" style="margin:4px 0 16px"><input type="checkbox" name="marketing" checked> Email me new drops and a 10% welcome code</label>' +
      '<button class="btn btn--full" type="submit">Create account</button></form>',
      'Already have one? <a href="#/account/login' + nx() + '" class="link-u">Sign in</a>');
  }

  function gatePage() {
    return authWrap('Your account', 'Sign in to see orders, addresses and your wishlist.',
      '<div class="gate">' +
      '<a class="btn btn--full" href="#/account/login' + nx() + '">Sign in</a>' +
      '<a class="btn btn--ghost btn--full" href="#/account/register' + nx() + '">Create an account</a></div>' +
      '<div class="demo-tip"><b>Demo account</b><span>' + DEMO.email + ' / ' + DEMO.pw + '</span>' +
      '<button data-act="acc-fill" type="button">Use it</button></div>',
      'Just need to track a parcel? <a href="#/account/lookup" class="link-u">Guest order lookup</a>');
  }

  /* ---------- 账户壳 ---------- */
  function shell(active, title, body) {
    var u = me();
    var nav = [['', 'Overview'], ['orders', 'Orders'], ['addresses', 'Addresses'],
    ['wishlist', 'Wishlist'], ['settings', 'Settings']];
    return '<div class="wrap"><div class="acct2">' +
      '<aside class="acct2__side">' +
      '<div class="acct2__hi"><span>Signed in as</span><b>' + U.esc(u.email) + '</b></div>' +
      '<nav class="acct2__nav">' + nav.map(function (n) {
        var href = '#/account' + (n[0] ? '/' + n[0] : '');
        return '<a href="' + href + '"' + (active === n[0] ? ' class="on"' : '') + '>' + n[1] + '</a>';
      }).join('') + '</nav>' +
      '<button class="acct2__out" data-act="acc-signout">Sign out</button>' +
      '</aside>' +
      '<section class="acct2__main"><h1>' + title + '</h1>' + body + '</section>' +
      '</div></div>';
  }

  /* ---------- 概览 ---------- */
  function hub() {
    var u = me();
    var os = ordersOf(u);
    var live = os.filter(function (o) { return ['paid', 'fulfilling', 'fulfilled'].indexOf(o.status) >= 0; });
    var spent = os.filter(function (o) { return o.status !== 'refunded' && o.status !== 'cancelled'; })
      .reduce(function (a, o) { return a + o.total; }, 0);
    var latest = os[0];

    return shell('', 'Hello, ' + U.esc(u.first),
      '<p class="acct2__lead">Member since ' + U.fmtDate(u.since) + ' · ' + os.length + ' order' + (os.length === 1 ? '' : 's') + ' placed</p>' +
      '<div class="stat3">' +
      '<a class="stat3__c" href="#/account/orders"><span>Orders</span><b>' + os.length + '</b><i>View all →</i></a>' +
      '<a class="stat3__c" href="#/account/orders"><span>In transit</span><b>' + live.length + '</b><i>' + (live.length ? 'Track a parcel →' : 'Nothing on the way') + '</i></a>' +
      '<a class="stat3__c" href="#/account/wishlist"><span>Wishlist</span><b>' + wishCount(u) + '</b><i>Saved pieces →</i></a>' +
      '</div>' +
      (latest ? '<div class="panel-lite"><div class="panel-lite__hd"><h3>Most recent order</h3>' +
        '<a href="#/account/orders/' + encodeURIComponent(latest.number) + '" class="link-u">Details →</a></div>' +
        '<div class="ol__top"><b class="mono">' + U.esc(latest.number) + '</b>' + statusPill(latest) +
        '<span class="mono">' + U.money(latest.total) + '</span></div>' +
        timeline(latest) +
        '<p class="panel-lite__meta">Placed ' + U.fmtDate(latest.createdAt) +
        (latest.tracking ? ' · Tracking <span class="mono">' + U.esc(latest.tracking) + '</span>' : ' · Not shipped yet') + '</p>' +
        '</div>'
        : '<div class="empty" style="padding:52px 0"><h3>No orders yet</h3><p>Your orders will appear here the moment you check out.</p>' +
        '<a class="btn" href="#/collections/best-sellers">Shop best sellers</a></div>') +
      '<div class="panel-lite"><div class="panel-lite__hd"><h3>Lifetime colour guarantee</h3><span class="pill paid">Active</span></div>' +
      '<p class="panel-lite__meta">Registered to ' + U.esc(u.email) + ' · covers every steel piece you own. If a PVD layer ever fades, we replace the item once, free. ' +
      'Total spent ' + U.money(spent) + '.</p></div>');
  }

  /* ---------- 订单 ---------- */
  function ordersPage() {
    var os = ordersOf(me());
    if (!os.length) {
      return shell('orders', 'Orders',
        '<div class="empty" style="padding:60px 0"><h3>No orders yet</h3>' +
        '<p>When you place an order it shows up here with tracking.</p>' +
        '<a class="btn" href="#/collections/new">Shop new arrivals</a></div>');
    }
    return shell('orders', 'Orders',
      '<p class="acct2__lead">' + os.length + ' order' + (os.length === 1 ? '' : 's') + ' · newest first</p>' +
      '<div class="olist">' + os.map(function (o) {
        return '<a class="ol" href="#/account/orders/' + encodeURIComponent(o.number) + '">' +
          '<div class="ol__top"><b class="mono">' + U.esc(o.number) + '</b>' + statusPill(o) +
          '<span class="ol__date">' + U.fmtDate(o.createdAt) + '</span></div>' +
          '<div class="ol__body">' +
          '<div class="ol__thumbs">' + o.items.slice(0, 3).map(function (it) {
            var p = S.product(it.productId);
            return '<img src="' + (p && p.images ? p.images[0] : 'assets/img/p-necklace-fox-gold.png') + '" alt="">';
          }).join('') + '</div>' +
          '<div class="ol__meta">' + o.items.map(function (it) {
            return U.esc(it.title) + ' <span>×' + it.qty + '</span>';
          }).join('<br>') + '</div>' +
          '<div class="ol__tot mono">' + U.money(o.total) + '</div>' +
          '</div></a>';
      }).join('') + '</div>');
  }

  function orderDetail(r, raw) {
    var num = raw;
    try { num = decodeURIComponent(raw); } catch (e) { }
    var bare = num.replace(/^#/, '');
    var o = ordersOf(me()).filter(function (x) {
      return x.number === num || x.number === '#' + bare;
    })[0];
    if (!o) {
      return shell('orders', 'Order not found',
        '<div class="empty" style="padding:56px 0"><h3>We can\'t find that order</h3>' +
        '<p>It may belong to a different email address.</p>' +
        '<a class="btn" href="#/account/orders">Back to orders</a></div>');
    }
    return shell('orders', 'Order ' + U.esc(o.number),
      '<div class="odtop"><div>' + statusPill(o) + '<span class="odtop__d">Placed ' + U.fmtDate(o.createdAt) + '</span></div>' +
      '<button class="btn btn--ghost btn--sm" data-act="acc-buy-again" data-num="' + U.esc(o.number) + '">Buy it again</button></div>' +
      timeline(o) +
      (o.tracking ? '<div class="shipbar">' + ui.icon('truck') +
        '<div><b>' + U.esc(o.shippingMethod || 'Standard') + ' shipping</b>' +
        '<span>' + U.esc(o.carrier || 'USPS') + ' · <span class="mono">' + U.esc(o.tracking) + '</span></span></div>' +
        '<a class="link-u" href="#/account/lookup">Track</a></div>' : '') +
      '<div class="odgrid">' +
      '<div class="panel-lite"><h3>Items</h3>' + o.items.map(function (it) {
        var p = S.product(it.productId);
        return '<div class="oditem">' +
          '<img src="' + (p && p.images ? p.images[0] : 'assets/img/p-necklace-fox-gold.png') + '" alt="">' +
          '<div><a href="#/products/' + U.esc(it.productId) + '">' + U.esc(it.title) + '</a>' +
          '<span>' + U.esc(it.variant || '') + (it.size ? ' / ' + U.esc(it.size) : '') + ' · ×' + it.qty + '</span></div>' +
          '<div class="mono">' + U.money(it.unitPrice * it.qty) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="panel-lite"><h3>Summary</h3><div class="sum">' +
      '<div class="sum__row"><span>Subtotal</span><span>' + U.money(o.subtotal) + '</span></div>' +
      (o.discount ? '<div class="sum__row disc"><span>Discount</span><span>−' + U.money(o.discount) + '</span></div>' : '') +
      '<div class="sum__row"><span>Shipping</span><span>' + (o.shipping ? U.money(o.shipping) : 'Free') + '</span></div>' +
      '<div class="sum__row tot"><span>Total paid</span><span>' + U.money(o.total) + '</span></div></div>' +
      '<h3 style="margin-top:22px">Shipping to</h3>' +
      '<p class="odaddr">' + U.esc(o.name || '') + '<br>' +
      U.esc((o.address && o.address.line1) || '') + '<br>' +
      U.esc([(o.address && o.address.city) || '', (o.address && o.address.state) || '', (o.address && o.address.zip) || ''].filter(Boolean).join(', ')) +
      '<br>' + U.esc((o.address && o.address.country) || 'United States') + '</p>' +
      (o.note ? '<h3 style="margin-top:18px">Note</h3><p class="odaddr">' + U.esc(o.note) + '</p>' : '') +
      '</div></div>' +
      '<div class="odfoot"><a class="btn btn--ghost btn--sm" href="#/account/orders">← All orders</a>' +
      '<a class="btn btn--ghost btn--sm" href="#/pages/returns">Return or exchange</a></div>');
  }

  /* ---------- 地址簿 ---------- */
  function addressesPage() {
    var u = me();
    var list = u.addresses || [];
    var editing = S.state.addrEditing;
    var form = '';
    if (editing !== null) {
      var a = editing === 'new' ? { country: 'United States', id: '' } : list.filter(function (x) { return x.id === editing; })[0] || {};
      form = '<div class="panel-lite"><div class="panel-lite__hd"><h3>' + (editing === 'new' ? 'New address' : 'Edit address') + '</h3>' +
        '<button class="link-u" data-act="addr-cancel">Cancel</button></div>' +
        '<form data-act="addr-save" data-id="' + U.esc(a.id || '') + '">' +
        '<div class="row2">' + field('first', 'First name', a.first, 'required') + field('last', 'Last name', a.last, 'required') + '</div>' +
        field('line1', 'Address', a.line1, 'required') +
        field('line2', 'Apartment, suite (optional)', a.line2) +
        '<div class="row3">' + field('city', 'City', a.city, 'required') + field('state', 'State', a.state, 'required') + field('zip', 'ZIP', a.zip, 'required') + '</div>' +
        '<div class="fld"><label>Country</label><select name="country">' +
        ['United States', 'Canada', 'United Kingdom'].map(function (c) {
          return '<option' + ((a.country || 'United States') === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('') + '</select></div>' +
        field('phone', 'Phone (for delivery updates)', a.phone, 'type="tel"') +
        '<label class="chk" style="margin:2px 0 16px"><input type="checkbox" name="isDefault"' + (a.isDefault ? ' checked' : '') + '> Use as my default address</label>' +
        '<button class="btn" type="submit">Save address</button></form></div>';
    }

    return shell('addresses', 'Addresses',
      '<p class="acct2__lead">Saved addresses are pre-filled at checkout.</p>' +
      (form || '') +
      (!form ? '<button class="btn btn--sm" data-act="addr-new">+ Add an address</button>' : '') +
      '<div class="addrgrid">' + (list.length ? list.map(function (a) {
        return '<div class="addrc' + (a.isDefault ? ' def' : '') + '">' +
          '<div class="addrc__hd"><b>' + U.esc(a.label || 'Address') + '</b>' +
          (a.isDefault ? '<span class="pill paid">Default</span>' : '') + '</div>' +
          '<p>' + U.esc(a.first + ' ' + a.last) + '<br>' + U.esc(a.line1) +
          (a.line2 ? '<br>' + U.esc(a.line2) : '') + '<br>' +
          U.esc(a.city + ', ' + a.state + ' ' + a.zip) + '<br>' + U.esc(a.country) +
          (a.phone ? '<br>' + U.esc(a.phone) : '') + '</p>' +
          '<div class="addrc__ft">' +
          '<button class="link-u" data-act="addr-edit" data-id="' + U.esc(a.id) + '">Edit</button>' +
          (a.isDefault ? '' : '<button class="link-u" data-act="addr-default" data-id="' + U.esc(a.id) + '">Make default</button>') +
          '<button class="link-u danger" data-act="addr-del" data-id="' + U.esc(a.id) + '">Delete</button>' +
          '</div></div>';
      }).join('') : '<div class="empty" style="padding:44px 0;grid-column:1/-1"><h3>No saved addresses</h3>' +
        '<p>Add one and checkout gets one step shorter.</p></div>') + '</div>');
  }

  /* ---------- 心愿单 ---------- */
  function wishlistPage() {
    var u = me();
    var ids = u.wishlist || [];
    var items = ids.map(function (id) { return S.product(id); }).filter(Boolean);
    return shell('wishlist', 'Wishlist',
      '<p class="acct2__lead">' + items.length + ' saved piece' + (items.length === 1 ? '' : 's') + '. We email you if one comes back in stock.</p>' +
      (items.length
        ? '<div class="grid">' + items.map(function (p) {
          return '<div class="wishwrap">' + ui.productCard(p) +
            '<button class="wishrm" data-act="wish" data-pid="' + U.esc(p.id) + '" aria-label="Remove">' + ui.icon('heart') + '</button></div>';
        }).join('') + '</div>'
        : '<div class="empty" style="padding:60px 0"><h3>Nothing saved yet</h3>' +
        '<p>Tap the heart on any piece to keep it here.</p>' +
        '<a class="btn" href="#/collections/best-sellers">Browse best sellers</a></div>'));
  }

  /* ---------- 设置 ---------- */
  function settingsPage() {
    var u = me();
    return shell('settings', 'Settings',
      '<div class="panel-lite"><div class="panel-lite__hd"><h3>Profile</h3><span class="sub">Shown on invoices and parcels</span></div>' +
      '<form data-act="acc-profile">' +
      '<div class="row2">' + field('first', 'First name', u.first, 'required') + field('last', 'Last name', u.last, 'required') + '</div>' +
      field('email', 'Email', u.email, 'type="email" required') +
      '<label class="chk" style="margin:6px 0 16px"><input type="checkbox" name="marketing"' + (u.marketing ? ' checked' : '') + '> Email me new drops and restock alerts</label>' +
      '<button class="btn btn--sm" type="submit">Save changes</button></form></div>' +

      '<div class="panel-lite"><div class="panel-lite__hd"><h3>Password</h3><span class="sub">Last changed never</span></div>' +
      '<form data-act="acc-password">' +
      '<div class="fld"><label>Current password</label><input name="old" type="password" required placeholder="••••••••"></div>' +
      '<div class="row2">' +
      '<div class="fld"><label>New password</label><input name="pw" type="password" minlength="8" required placeholder="At least 8 characters"></div>' +
      '<div class="fld"><label>Confirm</label><input name="pw2" type="password" minlength="8" required></div></div>' +
      '<button class="btn btn--sm" type="submit">Update password</button></form></div>' +

      '<div class="panel-lite danger-zone"><div class="panel-lite__hd"><h3>Close account</h3></div>' +
      '<p class="panel-lite__meta">Deletes your saved addresses and wishlist. Order records are kept for tax purposes for seven years, as required.</p>' +
      '<button class="btn btn--ghost btn--sm" data-act="acc-close">Close my account</button></div>');
  }

  /* ---------- 访客查单（不需要登录） ---------- */
  function lookupPage() {
    var res = S.state.lookup;
    var box = '';
    if (res) {
      if (res.ok) {
        var o = res.order;
        box = '<div class="panel-lite" style="margin-top:24px">' +
          '<div class="ol__top"><b class="mono">' + U.esc(o.number) + '</b>' + statusPill(o) +
          '<span class="mono">' + U.money(o.total) + '</span></div>' +
          timeline(o) +
          '<dl style="margin-top:16px"><dt>Placed</dt><dd>' + U.fmtDate(o.createdAt) + '</dd>' +
          '<dt>Items</dt><dd>' + o.items.map(function (i) { return U.esc(i.title) + ' ×' + i.qty; }).join('<br>') + '</dd>' +
          '<dt>Total</dt><dd>' + U.money(o.total) + '</dd>' +
          '<dt>Tracking</dt><dd>' + (o.tracking ? '<span class="mono">' + U.esc(o.tracking) + '</span>' : 'Not shipped yet') + '</dd></dl></div>';
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
      '<p>Have an account? <a href="#/account/login" class="link-u">Sign in</a> to see every order at once.</p></div>' +
      '</div></div>';
  }

  /* ---------- 路由 ---------- */
  function page(r) {
    var sub = r.seg[1] || '';
    var m = me();
    if (sub === 'lookup') return lookupPage();
    if (sub === 'login') return m ? hub() : loginPage();
    if (sub === 'register') return m ? hub() : registerPage();
    if (!m) return gatePage();
    switch (sub) {
      case '': return hub();
      case 'orders': return r.seg[2] ? orderDetail(r, r.seg[2]) : ordersPage();
      case 'addresses': return addressesPage();
      case 'wishlist': return wishlistPage();
      case 'settings': return settingsPage();
      default: return hub();
    }
  }

  /* ---------- 对外 ---------- */
  return {
    page: page, me: me, ordersOf: ordersOf, signOut: signOut, remove: remove,
    findUser: findUser, persist: persist, digest: digest,
    hasWish: function (pid) { var u = me(); return !!(u && u.wishlist && u.wishlist.indexOf(pid) >= 0); },
    toggleWish: function (pid) {
      var u = me();
      if (!u) return { ok: false, msg: 'Sign in to save pieces', needAuth: true };
      u.wishlist = u.wishlist || [];
      var i = u.wishlist.indexOf(pid);
      if (i >= 0) { u.wishlist.splice(i, 1); persist(u); return { ok: true, on: false }; }
      u.wishlist.push(pid); persist(u); return { ok: true, on: true };
    },
    DEMO: DEMO
  };
})();
