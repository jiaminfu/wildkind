/* ============================================================
   LASTGROVE Admin · 后台视图（独立 SPA，只通过 API 读写）
   模块（12）：Dashboard / Orders / Products / Collections / Inventory /
         Coupons / Reviews / Custom requests / Customers /
         Stock ledger / Audit log / Settings
   ============================================================ */
(function () {
  'use strict';

  var U = S.U;

  var NAV = [
    { g: 'Overview', items: [['', 'Dashboard'], ['orders', 'Orders']] },
    { g: 'Catalog', items: [['products', 'Products'], ['collections', 'Collections'], ['inventory', 'Inventory']] },
    { g: 'Growth', items: [['coupons', 'Coupons'], ['reviews', 'Reviews'], ['custom', 'Custom requests'], ['customers', 'Customers']] },
    { g: 'System', items: [['content', 'Content'], ['ledger', 'Stock ledger'], ['tax', 'Sales tax'], ['staff', 'Staff', 'staff:read'], ['audit', 'Audit log'], ['settings', 'Settings']] },
  ];

  function shell(body, active, title, staff) {
    /* 第三项是可选的权限位：没权限的入口直接不渲染，而不是让人点进去吃 403。
       文档一直这么写（§5.5），但实现里从来没做过——加员工管理时才发现：
       support 登录后侧栏照样挂着 Staff，点一下才知道自己没权限。 */
    var perms = (staff && staff.permissions) || [];
    var nav = NAV.map(function (grp) {
      var items = grp.items.filter(function (it) {
        return !it[2] || perms.indexOf(it[2]) >= 0;
      });
      if (!items.length) return '';
      return '<div class="adm__grp">' + grp.g + '</div>' + items.map(function (it) {
        var href = '#/admin' + (it[0] ? '/' + it[0] : '');
        var on = (active || '') === it[0] ? ' class="on"' : '';
        return '<a href="' + href + '"' + on + '>' + it[1] + '</a>';
      }).join('');
    }).join('');

    var who = staff ? (staff.name || staff.email).split(' ')[0] : '—';
    return '<div class="adm">' +
      '<aside class="adm__side"><div class="adm__brand"><span>LASTGROVE<em>Admin</em></span></div>' +
      '<nav class="adm__nav">' + nav + '</nav>' +
      '<div class="adm__foot">Connected to /api/v1<br>' +
      (staff ? U.esc(staff.email) + '<br>' + U.esc((staff.permissions || []).length + ' permissions') : '') +
      '</div></aside>' +
      '<div class="adm__main"><div class="adm__top">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<button class="abtn sm" data-act="adm-menu" id="admMenuBtn">' + window.UI.icon('menu') + '</button>' +
      '<h1>' + U.esc(title) + '</h1></div>' +
      '<div class="adm__top-r"><a href="#/" class="abtn sm">View store</a>' +
      '<span class="who"><i>TG</i><span class="who__n">' + U.esc(who) + '</span></span>' +
      '<button class="abtn sm" data-act="logout">Sign out</button></div></div>' +
      '<div class="adm__body">' + body + '</div></div></div>' +
      '<div class="toast" id="toast"></div>';
  }

  function login(err) {
    var msg = err ? (typeof err === 'string' ? err : (err.message || '')) : '';
    return '<div class="loginwrap">' +
      '<div class="loginwrap__img"><img src="assets/img/opt/c-ocean.jpg" alt="">' +
      '<div class="cap"><b>Grows on you.</b><span>LASTGROVE admin</span></div></div>' +
      '<div class="loginwrap__form">' +
      '<a href="#/" class="brand" style="margin-bottom:26px"><span class="brand__mark">' + window.UI.MARK + '</span>' +
      '<span class="brand__word">LASTGROVE</span></a>' +
      '<h1>Sign in</h1><p>Manage orders, stock and storefront settings.</p>' +
      (msg ? '<div class="falert falert--note">' + U.esc(msg) + '</div>' : '') +
      '<form data-act="login">' +
      '<div class="afld"><label>Email</label><input name="email" value="owner@lastgrove.com" autocomplete="username" required></div>' +
      '<div class="afld"><label>Password</label><input name="password" type="password" placeholder="••••••••" autocomplete="current-password" required></div>' +
      '<button class="btn btn--full" type="submit" style="margin-top:6px">Sign in</button></form>' +
      // 这里绝对不能再写默认口令：这一页挂在公网上，等于把账号密码挂牌公示。
      // 需要看演示账号的，看 handover/README.md 或服务器上的 deploy/.env。
      '<div class="loginwrap__hint">Forgot the password? The store owner resets it on the server.<br>' +
      '<a href="#/" style="text-decoration:underline">← Back to store</a></div>' +
      '</div></div>';
  }

  function dash(m) {
    var max = Math.max.apply(null, m.series.map(function (s) { return s.revenue; }).concat([1]));
    var bars = m.series.map(function (s) {
      var h = Math.round(s.revenue / max * 100);
      return '<i style="height:' + Math.max(1, h) + '%" title="' + s.date + ' · $' + s.revenue + '"></i>';
    }).join('');
    var top = m.topProducts.map(function (t) {
      return '<tr><td>' + U.esc(t.title) + '</td><td class="num">' + t.units + '</td><td class="num">' + U.money(t.revenue) + '</td></tr>';
    }).join('');
    var low = m.lowStock.slice(0, 8).map(function (x) {
      return '<tr><td>' + U.esc(x.title) + '</td><td>' + U.esc(x.metal) + '</td><td class="num">' + x.stock + '</td></tr>';
    }).join('');

    return '<div class="kpis">' +
      '<div class="kpi"><span>Revenue · ' + m.window + 'd</span><b>' + U.money(m.gmv) + '</b>' +
      (m.gmvDelta != null ? '<em class="' + (m.gmvDelta >= 0 ? '' : 'dn') + '">' + (m.gmvDelta >= 0 ? '↑ ' : '↓ ') + Math.abs(m.gmvDelta) + '% vs prev</em>' : '') + '</div>' +
      '<div class="kpi"><span>Orders</span><b>' + m.orders + '</b><em>' + m.units + ' units</em></div>' +
      '<div class="kpi"><span>Average order</span><b>' + U.money(m.aov) + '</b></div>' +
      '<div class="kpi"><span>Refund rate</span><b>' + m.refundRate + '%</b>' +
      '<em class="' + (m.refundRate > 8 ? 'dn' : '') + '">' + (m.refundRate > 8 ? 'Above 8% target' : 'On target') + '</em></div>' +
      '</div>' +
      '<div class="two">' +
      '<div class="panel"><div class="panel__hd"><h2>Revenue, last ' + m.window + ' days</h2>' +
      '<span class="sub">' + U.money(m.gmv / m.window) + '/day avg</span></div>' +
      '<div class="panel__bd"><div class="barchart">' + bars + '</div></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Needs attention</h2></div><div class="panel__bd" style="display:grid;gap:9px">' +
      attn(m.awaitingShipment, 'Orders waiting to ship', '#/admin/orders') +
      attn(m.pendingReviews, 'Reviews to moderate', '#/admin/reviews') +
      attn(m.lowStock.length, 'SKUs at or below threshold', '#/admin/inventory') +
      '</div></div></div>' +
      '<div class="two-eq">' +
      '<div class="panel"><div class="panel__hd"><h2>Top products</h2></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Product</th><th class="num">Units</th><th class="num">Revenue</th></tr></thead>' +
      '<tbody>' + (top || '<tr><td colspan="3">No sales in this window.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Restock soon</h2><a href="#/admin/inventory" class="sub" style="text-decoration:underline">All stock</a></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Product</th><th>Finish</th><th class="num">Left</th></tr></thead>' +
      '<tbody>' + (low || '<tr><td colspan="3">Everything is healthy.</td></tr>') + '</tbody></table></div></div>' +
      '</div>';
  }

  function attn(n, label, href) {
    return '<a class="attn" href="' + href + '"><b>' + n + '</b><span>' + label + '</span></a>';
  }

  function orders(list, meta, q) {
    /* Tab 覆盖全部状态。
       原先只有 All/Paid/Preparing/Shipped/Refunded，但列表里会出现 Cancelled 和
       Delivered 的单——能看到却筛不出来，想找「哪些被取消了」只能一页页翻。
       pending_payment 是接入异步支付通道后新增的：钱还没到账的单必须能单独捞出来，
       否则客服分不清「待付款」和「已付款待发货」。 */
    var tabs = [['', 'All'], ['paid', 'Paid'], ['pending_payment', 'Awaiting payment'],
      ['fulfilling', 'Preparing'],
      ['fulfilled', 'Shipped'], ['completed', 'Delivered'],
      ['cancelled', 'Cancelled'], ['refunded', 'Refunded']]
      .map(function (t) {
        var on = (q.status || '') === t[0] ? ' solid' : '';
        return '<a class="abtn' + on + '" href="#/admin/orders' + (t[0] ? '?status=' + t[0] : '') + '">' + t[1] + '</a>';
      }).join('');

    /* 导出：以前一个都没有，对账、打发货单、丢给 ERP 全得手工抄。
       走 fetch + blob，因为下载要带 Bearer 令牌，<a href> 带不了。 */
    var exportBtn = '<button class="abtn sm" data-act="export" data-what="orders"' +
      (q.status ? ' data-status="' + U.esc(q.status) + '"' : '') + '>Export CSV</button>';

    var rows = list.map(function (o) {
      return '<tr data-act="open-order" data-num="' + U.esc(o.number) + '">' +
        '<td><b>' + U.esc(o.number) + '</b></td>' +
        '<td>' + U.esc(o.name || '') + '<br><span class="sub">' + U.esc(o.email) + '</span></td>' +
        '<td><span class="pill ' + o.status + '">' + U.esc(o.statusLabel) + '</span></td>' +
        '<td class="num">' + o.items + '</td>' +
        '<td class="num">' + U.money(o.total) + '</td>' +
        '<td>' + U.fmtDate(o.createdAt) + '</td></tr>';
    }).join('');

    // 分页：接口本来就支持 page/limit 并返回 hasMore，之前只是前端没画按钮，
    // 导致 90 单只能看到前 25 单（第 26 单在界面上根本够不到）。
    var per = Number(meta.limit) || 25;
    var total = Number(meta.total) || 0;
    var page = Number(meta.page) || 1;
    var pages = Math.max(1, Math.ceil(total / per));
    function pgLink(p) {
      var s = [];
      if (q.status) s.push('status=' + encodeURIComponent(q.status));
      if (q.q) s.push('q=' + encodeURIComponent(q.q));
      if (p > 1) s.push('page=' + p);
      return '#/admin/orders' + (s.length ? '?' + s.join('&') : '');
    }
    var pager = '<div class="panel__bd pager">' +
      (page > 1
        ? '<a class="abtn sm" href="' + pgLink(page - 1) + '">← Prev</a>'
        : '<span class="abtn sm is-off">← Prev</span>') +
      '<span class="sub">' + total + ' orders · page ' + page + ' of ' + pages + '</span>' +
      (page < pages
        ? '<a class="abtn sm" href="' + pgLink(page + 1) + '">Next →</a>'
        : '<span class="abtn sm is-off">Next →</span>') +
      '</div>';

    return '<div class="panel"><div class="panel__hd"><h2>Orders</h2>' +
      '<div style="display:flex;gap:8px;align-items:center">' + exportBtn +
      '<form class="admsearch" data-act="osearch"><input name="q" placeholder="Search number, email or name" value="' + U.esc(q.q || '') + '"></form></div></div>' +
      '<div class="panel__bd" style="display:flex;gap:8px;flex-wrap:wrap">' + tabs + '</div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Order</th><th>Customer</th><th>Status</th><th class="num">Items</th><th class="num">Total</th><th>Date</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6">No orders match.</td></tr>') + '</tbody></table></div>' +
      pager + '</div>';
  }

  /* 地址拼装：空字段要跳过，不能留下「, Portland OR , United States」这种孤零零的逗号。
     用 join(' · ') 而不是固定模板，因为海外地址的字段数本来就不固定。 */
  function addrText(a) {
    a = a || {};
    var parts = [
      a.line1, a.line2,
      [a.city, a.state].filter(Boolean).join(' '),
      a.zip, a.country,
    ].filter(function (x) { return x && String(x).trim(); });
    return parts.join(', ');
  }

  /* 承运商下拉：选项来自 U.carriers，与前台「点单号去哪查」共用同一张表。
     以前这里只有一句 prompt  + 硬编码 'USPS'，发 UPS 也会存成 USPS，
     客户拿着单号去 USPS 查不到，直接开投诉。 */
  function carrierOpts(cur) {
    var now = String(cur || 'USPS');
    return U.carriers.map(function (c) {
      return '<option value="' + U.esc(c.code) + '"' + (c.code === now ? ' selected' : '') + '>' +
        U.esc(c.label) + '</option>';
    }).join('');
  }

  /* 物流面板：后台要能一眼看出「订上了没、承运商扫到哪了、上次同步是什么时候」。
     三种状态在这里必须都看得见，因为运营要做判断：
     有轨迹 → 看最新一条；订上了没扫件 → 正常等待，别去催；
     订阅被拒（USPS 在试用额度下会被 17TRACK 策略挡住）→ 要看到原因，
     否则运营会以为「系统坏了」而反复点刷新。 */
  function trackBox(o) {
    if (!o.tracking) return '';
    var st = o.trackingState || {};
    var rows = (st.events || []).slice(0, 5).map(function (e) {
      return '<li style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' +
        '<span style="flex:none;width:108px;font-size:11px;color:var(--muted)">' + U.esc(U.fmtDateTime(e.at)) + '</span>' +
        '<span style="flex:1;min-width:0"><b style="font-weight:500">' + U.esc(e.text) + '</b>' +
        (e.place ? '<br><span style="font-size:11px;color:var(--muted)">' + U.esc(e.place) + '</span>' : '') +
        '</span></li>';
    }).join('');

    var badge = st.status
      ? '<span class="pill ' + (st.status === 'Delivered' ? 'completed' : 'fulfilled') + '">' +
        U.esc(st.label || st.status) + '</span>'
      : (st.error ? '<span class="pill refunded">Not subscribed</span>' : '<span class="pill">Waiting</span>');

    return '<div class="panel__bd">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' + badge +
      '<span style="font-size:11.5px;color:var(--muted)">' + U.esc(st.provider || o.carrier || '17TRACK') +
      (st.lastEventAt ? ' · last scan ' + U.esc(U.fmtDateTime(st.lastEventAt)) : '') +
      (st.updatedAt ? ' · checked ' + U.esc(U.fmtDateTime(st.updatedAt)) : ' · never checked') + '</span>' +
      '<button class="abtn sm" style="margin-left:auto" data-act="refresh-tracking" data-num="' +
      U.esc(o.number) + '">Refresh tracking</button></div>' +
      (st.error ? '<p style="margin:9px 0 0;font-size:11.5px;color:var(--clay)">Auto-tracking unavailable — ' +
        U.esc(st.error) + '</p>' : '') +
      (rows ? '<ul style="margin:8px 0 0;padding:0;list-style:none">' + rows + '</ul>' : '') +
      '</div>';
  }

  function orderDetail(o, transitions) {
    var rows = o.items.map(function (i) {
      var left = Math.max(0, i.qty - (i.refundedQty || 0));
      return '<tr><td>' + U.esc(i.title) + (i.isGift ? ' <span class="tag">Gift</span>' : '') + '</td>' +
        '<td>' + U.esc(i.variant) + '</td><td>' + U.esc(i.size || '—') + '</td>' +
        '<td class="num">' + i.qty + '</td><td class="num">' + U.money(i.unitPrice) + '</td>' +
        '<td class="num">' + U.money(i.unitPrice * i.qty) + '</td>' +
        '<td class="num">' + (left > 0 && !i.isGift
          ? '<input class="rfq" type="number" min="0" max="' + left + '" value="0" ' +
            'data-sku="' + U.esc(i.sku || '') + '" data-pid="' + U.esc(i.productId || '') + '" ' +
            'data-var="' + U.esc(i.variant || '') + '" style="width:58px;text-align:right" ' +
            'aria-label="Quantity to refund">'
          : '<span class="sub">' + (i.isGift ? 'gift' : '—') + '</span>') + '</td></tr>';
    }).join('');

    var acts = transitions.map(function (t) {
      if (t === 'refunded') return '';
      return '<button class="abtn" data-act="ostatus" data-num="' + U.esc(o.number) + '" data-to="' + t + '">' +
        t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
    }).join('');

    return '<div class="panel"><div class="panel__hd"><h2>' + U.esc(o.number) + '</h2>' +
      '<a class="abtn sm" href="#/admin/orders">← All orders</a></div>' +
      '<div class="panel__bd" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span class="pill ' + o.status + '">' + U.esc(o.statusLabel) + '</span>' + acts +
      (o.partiallyRefunded ? '<span class="pill refunded">Partially refunded</span>' : '') +
      '</div>' +
      '<div class="panel__bd">' +
      '<div class="shiprow" data-num="' + U.esc(o.number) + '" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
      '<div class="afld" style="min-width:150px;margin:0"><label>Carrier</label>' +
      '<select name="carrier">' + carrierOpts(o.carrier) + '</select></div>' +
      '<div class="afld" style="flex:1;min-width:210px;margin:0"><label>Tracking number</label>' +
      '<input name="tracking" value="' + U.esc(o.tracking || '') + '" autocomplete="off" spellcheck="false" ' +
      'placeholder="Paste what the carrier gave you"></div>' +
      '<button class="abtn" data-act="save-tracking" data-num="' + U.esc(o.number) + '">Save tracking</button>' +
      (o.tracking ? '<a class="abtn sm" target="_blank" rel="noopener noreferrer" href="' +
        U.esc(U.carrierUrl(o.carrier, o.tracking)) + '">Open on ' + U.esc(o.carrier || 'carrier') + ' ↗</a>' : '') +
      '</div>' +
      '<p class="sub" style="margin:9px 0 0">Saving a number moves the order to fulfilled. ' +
      'Nothing is generated automatically — the customer sees exactly the number you paste here.</p>' +
      '</div>' +
      trackBox(o) +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Item</th><th>Finish</th><th>Size</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line</th><th class="num">Refund</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="panel__bd"><div class="srow"><span>Subtotal</span><b>' + U.money(o.subtotal) + '</b></div>' +
      (o.discount ? '<div class="srow"><span>Discount ' + U.esc(o.couponCode || '') + '</span><b>−' + U.money(o.discount) + '</b></div>' : '') +
      '<div class="srow"><span>Shipping · ' + U.esc(o.shippingMethod) + '</span><b>' + U.money(o.shipping) + '</b></div>' +
      (o.tax ? '<div class="srow"><span>Tax' + (o.taxState ? ' · ' + U.esc(o.taxState) : '') +
        '</span><b>' + U.money(o.tax) + '</b></div>' : '') +
      '<div class="srow srow--total"><span>Total</span><b>' + U.money(o.total) + '</b></div>' +
      (o.refundedTotal ? '<div class="srow"><span>Refunded so far</span><b>−' + U.money(o.refundedTotal) + '</b></div>' : '') +
      '<p class="sub" style="margin-top:14px">' + U.esc(o.name) + ' · ' + U.esc(o.email) +
      (addrText(o.address) ? '<br>' + U.esc(addrText(o.address)) : '') +
      (o.tracking ? '<br>Tracking ' + U.esc(o.tracking) + (o.carrier ? ' · ' + U.esc(o.carrier) : '') : '') +
      (o.refundedAt ? '<br>Refunded ' + U.fmtDate(o.refundedAt) + ' · stock ' + U.esc(o.restockDecision || '—') : '') +
      (o.payment ? '<br>Payment ' + U.esc(o.payment.provider) + ' · ' + U.esc(o.payment.mode) + ' · •••• ' + U.esc(o.payment.last4 || '') : '') +
      '</p></div>' + refundBox(o) + '</div>';
  }

  /* 退款面板。整单退是"一把清"，但真实退货九成是退一件——
     只给一个 Refund 按钮，结果是多件订单退一件时把整单的钱退回去。 */
  function refundBox(o) {
    var hist = refundHistory(o);
    if (o.status === 'refunded') {
      return '<div class="panel__bd"><h3 style="margin:0 0 6px;font-size:13px">Refunded</h3>' +
        '<p class="sub" style="margin:0">Fully refunded ' + U.fmtDate(o.refundedAt) + ' · ' +
        U.money(o.refundedTotal || o.total) + ' · stock ' + U.esc(o.restockDecision || '—') + '</p>' + hist + '</div>';
    }
    if (o.status === 'cancelled') return hist ? '<div class="panel__bd">' + hist + '</div>' : '';
    if (o.status === 'pending_payment') return '';

    return '<div class="panel__bd">' +
      '<h3 style="margin:0 0 6px;font-size:13px">Refund</h3>' +
      '<p class="sub" style="margin:0 0 10px">Put a quantity in the <b>Refund</b> column for the lines coming back, ' +
      'then press <b>Refund selected</b>. The amount is line price − that line&rsquo;s share of the coupon ' +
      '+ its share of the tax. Shipping comes back only with the last paid item.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<button class="abtn" data-act="refund-partial" data-num="' + U.esc(o.number) + '">Refund selected</button>' +
      '<button class="abtn danger" data-act="refund" data-num="' + U.esc(o.number) + '">Refund whole order</button>' +
      (o.refundedTotal ? '<span class="sub">Already refunded ' + U.money(o.refundedTotal) + ' of ' +
        U.money(o.total) + '</span>' : '') +
      '</div>' + hist + '</div>';
  }

  function refundHistory(o) {
    var list = o.refunds || [];
    if (!list.length) return '';
    return '<table class="atable" style="margin-top:12px"><thead><tr><th>When</th><th>What</th>' +
      '<th class="num">Amount</th></tr></thead><tbody>' +
      list.map(function (r) {
        var what = (r.items || []).filter(function (x) { return x.qty; })
          .map(function (x) { return x.qty + '× ' + (x.title || x.sku); }).join(', ');
        return '<tr><td>' + U.fmtDate(r.at) + '</td>' +
          '<td>' + U.esc(what || 'whole order') + (r.reason ? ' <span class="sub">· ' + U.esc(r.reason) + '</span>' : '') + '</td>' +
          '<td class="num">' + U.money(r.amount) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function products(list, q) {
    var rows = list.map(function (p) {
      return '<tr><td><b>' + U.esc(p.title) + '</b><br><span class="sub">' + U.esc(p.id) + ' · ' + U.esc(p.handle) + '</span></td>' +
        '<td class="num">' + U.money(p.price) + '</td>' +
        '<td class="num">' + (p.cost === null ? '<span class="sub">—</span>' : U.money(p.cost || 0)) + '</td>' +
        '<td class="num">' + p.stock + '</td>' +
        '<td>' + (p.active ? '<span class="pill completed">Live</span>' : '<span class="pill cancelled">Draft</span>') + '</td>' +
        '<td style="white-space:nowrap">' +
        '<button class="abtn sm" data-act="pedit" data-id="' + U.esc(p.id) + '">Edit</button> ' +
        '<button class="abtn sm" data-act="toggle" data-id="' + U.esc(p.id) + '" data-active="' + (p.active ? 1 : 0) + '">' + (p.active ? 'Unlist' : 'Publish') + '</button>' +
        '</td></tr>';
    }).join('');

    var live = list.filter(function (p) { return p.active; }).length;
    var drafts = list.length - live;

    return '<div class="panel"><div class="panel__hd"><h2>Products</h2>' +
      '<div class="phd-r">' +
      '<span class="sub">' + live + ' live · ' + drafts + ' draft</span>' +
      '<form class="admsearch" data-act="psearch"><input name="q" placeholder="Search title or ID" value="' + U.esc(q || '') + '"></form>' +
      '<button class="abtn sm" data-act="export" data-what="products">Export CSV</button>' +
      '<button class="abtn sm" data-act="pimport">Import CSV</button>' +
      '<button class="btn btn--sm" data-act="pnew">New product</button>' +
      '</div></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Product</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Stock</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="sub" style="padding:20px">No products yet. Click “New product” to add the first one.</td></tr>') +
      '</tbody></table></div></div>';
  }

  /* ---------------- 商品编辑抽屉 ----------------
     不放在路由里：抽屉一开就要连续填十几项，路由重绘会把已填内容清空。
     所以它是一块常驻 DOM，打开时由 app.js 填内容。 */
  function pcatOptions(cur) {
    var cats = [['necklaces', 'Necklaces'], ['bracelets', 'Bracelets'], ['anklets', 'Anklets'],
      ['rings', 'Rings'], ['hair', 'Hair accessories']];
    return cats.map(function (c) {
      return '<option value="' + c[0] + '"' + (cur === c[0] ? ' selected' : '') + '>' + c[1] + '</option>';
    }).join('');
  }

  function imageCells(images) {
    var out = '';
    for (var i = 0; i < 6; i++) {
      var src = images[i];
      if (src) {
        out += '<div class="imgcell on" draggable="true" data-idx="' + i + '">' +
          U.pic(src, { alt: '', w: 900, h: 900, sizes: '96px' }) +
          (i === 0 ? '<span class="imgcell__main">Main</span>' : '') +
          '<button type="button" class="imgcell__x" data-act="pimgdel" data-idx="' + i + '" title="Remove">×</button>' +
          (i > 0 ? '<button type="button" class="imgcell__set" data-act="pimgmain" data-idx="' + i + '">Set main</button>' : '') +
          '</div>';
      } else {
        out += '<button type="button" class="imgcell" data-act="pimgpick">' +
          '<span>+</span><em>Add image</em></button>';
      }
    }
    return out;
  }

  function variantRows(vs, metals) {
    return vs.map(function (v, i) {
      var opts = metals.map(function (m) {
        return '<option value="' + U.esc(m) + '"' + (v.metal === m ? ' selected' : '') + '>' + U.esc(m) + '</option>';
      }).join('');
      return '<tr>' +
        '<td><select class="ain" data-act="pvar" data-idx="' + i + '" data-f="metal">' + opts + '</select></td>' +
        '<td><input class="ain" data-act="pvar" data-idx="' + i + '" data-f="sku" value="' + U.esc(v.sku || '') + '" placeholder="auto"></td>' +
        '<td><input class="ain num" type="number" min="0" step="0.01" data-act="pvar" data-idx="' + i + '" data-f="price" value="' + (v.price == null ? '' : v.price) + '" placeholder="main"></td>' +
        '<td><input class="ain num" type="number" min="0" step="1" data-act="pvar" data-idx="' + i + '" data-f="stock" value="' + (v.stock == null ? 0 : v.stock) + '"></td>' +
        '<td><button type="button" class="abtn sm" data-act="pvardel" data-idx="' + i + '"' + (vs.length <= 1 ? ' disabled' : '') + '>×</button></td>' +
        '</tr>';
    }).join('');
  }

  function editorDrawer(collections, staff) {
    return '<div class="pdrawer" id="pdrawer">' +
      '<div class="pdrawer__ov" data-act="pclose"></div>' +
      '<div class="pdrawer__panel">' +
      '<div class="pdrawer__hd"><h2 id="pdrawerTitle">New product</h2>' +
      '<button type="button" class="abtn sm" data-act="pclose">Close</button></div>' +
      '<div class="pdrawer__bd">' +

      '<section class="psec" data-sec="basic"><h3>Basics</h3>' +
      '<div class="cform cform--2">' +
      '<label class="afld" style="grid-column:1/-1"><span>Title *</span><input id="pTitle" maxlength="120" placeholder="Moonlit Hare Necklace"></label>' +
      '<label class="afld"><span>Handle (URL)</span><input id="pHandle" placeholder="auto from title"></label>' +
      '<label class="afld"><span>Category *</span><select id="pCat">' + pcatOptions('') + '</select></label>' +
      '<label class="afld"><span>Price *</span><input id="pPrice" type="number" min="0" step="0.01" placeholder="76"></label>' +
      '<label class="afld"><span>Cost <em class="sub">owner only</em></span><input id="pCost" type="number" min="0" step="0.01" placeholder="19.5"' +
      (staff && staff.role !== 'owner' ? ' disabled' : '') + '></label>' +
      '<label class="afld"><span>Compare at</span><input id="pCompare" type="number" min="0" step="0.01" placeholder="leave empty"></label>' +
      '<label class="afld"><span>Badge</span><select id="pBadge"><option value="">None</option><option>New</option><option>Bestseller</option></select></label>' +
      '<label class="afld"><span>Motif</span><input id="pMotif" placeholder="hare"></label>' +
      '<label class="afld"><span>Set / series</span><input id="pSet" placeholder="woodland"></label>' +
      '<label class="afld" style="grid-column:1/-1"><span>Description</span><textarea id="pDesc" rows="3" maxlength="2000"></textarea></label>' +
      '<label class="afld" style="grid-column:1/-1"><span>Sizes (separate with | or comma, e.g. 16in|18in)</span><input id="pSizes" placeholder="16in|18in"></label>' +
      '</div>' +
      '<div class="afld" style="margin-top:10px"><span>Collections</span>' +
      '<div class="chips" id="pCols">' + (collections || []).map(function (c) {
        return '<label class="chip"><input type="checkbox" value="' + U.esc(c.handle) + '">' + U.esc(c.title) + '</label>';
      }).join('') + '</div></div>' +
      '</section>' +

      '<section class="psec" data-sec="images"><h3>Images <em class="sub">first image is the main one · max 6 · JPG/PNG/WebP</em></h3>' +
      '<div class="imggrid" id="pImgs">' + imageCells([]) + '</div>' +
      '<input type="file" id="pFile" accept="image/jpeg,image/png,image/webp" multiple hidden data-act="pimg">' +
      '<p class="sub" id="pImgHint">Up to 6 photos. Drag to reorder.</p>' +
      '</section>' +

      '<section class="psec" data-sec="variants"><h3>Variants &amp; stock</h3>' +
      '<table class="atable atable--in"><thead><tr><th>Metal</th><th>SKU</th><th class="num">Price</th><th class="num">Stock</th><th></th></tr></thead>' +
      '<tbody id="pVars">' + variantRows([], ['Gold', 'Silver', 'Rose Gold']) + '</tbody></table>' +
      '<button type="button" class="abtn sm" data-act="pvaradd" style="margin-top:10px">+ Add variant</button>' +
      '<p class="sub">Stock total is the sum of variants — it updates itself.</p>' +
      '</section>' +

      '</div>' +
      '<div class="pdrawer__ft">' +
      '<div class="pdrawer__meta" id="pMeta"></div>' +
      '<div class="pdrawer__act">' +
      '<button type="button" class="abtn sm danger" data-act="pdel" id="pDel" hidden>Delete</button>' +
      '<button type="button" class="abtn sm" data-act="pdup" id="pDup" hidden>Duplicate</button>' +
      '<button type="button" class="abtn" data-act="pclose">Cancel</button>' +
      '<button type="button" class="btn btn--sm" data-act="psave" id="pSave">Save draft</button>' +
      '</div></div>' +
      '</div></div>';
  }

  /* ---------------- CSV 导入弹窗 ---------------- */
  function importModal() {
    return '<div class="pmodal" id="pmodal">' +
      '<div class="pmodal__ov" data-act="pimpclose"></div>' +
      '<div class="pmodal__box">' +
      '<div class="pmodal__hd"><h2>Import products from CSV</h2>' +
      '<a class="abtn sm" href="#" data-act="ptpl">Download template</a>' +
      '<button type="button" class="abtn sm" data-act="pimpclose">Close</button></div>' +
      '<div class="pmodal__bd">' +
      '<div class="impdrop" id="pImpDrop"><b>Choose a CSV file</b><span>or drop it here · one row = one variant</span>' +
      '<input type="file" id="pCsv" accept=".csv,text/csv" hidden data-act="pcsv"></div>' +
      '<div id="pImpResult"></div>' +
      '</div>' +
      '<div class="pmodal__ft">' +
      '<span class="sub" id="pImpHint">Nothing is saved until you confirm.</span>' +
      '<button type="button" class="btn btn--sm" data-act="pimpgo" id="pImpGo" disabled>Import</button>' +
      '</div></div></div>';
  }

  function inventory(rows) {
    var body = rows.map(function (r) {
      var label = { out: 'Out', reorder: 'Reorder', healthy: 'Healthy' }[r.risk];
      return '<tr><td>' + U.esc(r.title) + '</td><td>' + U.esc(r.sku) + '</td><td>' + U.esc(r.metal) + '</td>' +
        '<td class="num">' + r.stock + '</td>' +
        '<td><span class="pill ' + (r.risk === 'out' ? 'cancelled' : r.risk === 'reorder' ? 'paid' : 'completed') + '">' + label + '</span></td>' +
        '<td style="text-align:right;white-space:nowrap">' +
        '<button class="abtn sm" data-act="open-ledger" data-sku="' + U.esc(r.sku) + '">History</button> ' +
        '<button class="abtn sm" data-act="restock" data-id="' + U.esc(r.productId) + '" data-sku="' + U.esc(r.sku) + '">+20</button></td></tr>';
    }).join('');
    var out = rows.filter(function (r) { return r.risk === 'out'; }).length;
    var low = rows.filter(function (r) { return r.risk === 'reorder'; }).length;
    return '<div class="kpis">' +
      '<div class="kpi"><span>SKUs tracked</span><b>' + rows.length + '</b></div>' +
      '<div class="kpi"><span>Sold out</span><b>' + out + '</b><em class="dn">Needs restock</em></div>' +
      '<div class="kpi"><span>At or below threshold</span><b>' + low + '</b></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Stock by SKU</h2><span class="sub">Every change is written to the stock ledger</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Product</th><th>SKU</th><th>Finish</th><th class="num">On hand</th><th>Risk</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function settings(s, tq) {
    var c = s.content || {};
    return '<div class="panel"><div class="panel__hd"><h2>Store settings</h2><span class="sub">Changes go live on the storefront immediately</span></div>' +
      '<div class="panel__bd"><form data-act="savesettings" style="max-width:520px;display:grid;gap:14px">' +
      '<label class="afld"><span>Free shipping threshold</span><input name="freeShip" type="number" step="1" value="' + s.freeShip + '"></label>' +
      '<label class="afld"><span>Standard shipping</span><input name="standardShip" type="number" step="0.01" value="' + s.standardShip + '"></label>' +
      '<label class="afld"><span>Express shipping</span><input name="expressShip" type="number" step="0.01" value="' + s.expressShip + '"></label>' +
      '<label class="afld"><span>Free gift threshold</span><input name="giftThreshold" type="number" step="1" value="' + (s.giftThreshold || 0) + '"></label>' +
      '<label class="afld"><span>Low stock threshold</span><input name="lowStockThreshold" type="number" step="1" value="' + s.lowStockThreshold + '"></label>' +
      '<label class="afld"><span>Announcement bar</span><input name="announce" value="' + U.esc(c.announce || '') + '"></label>' +
      '<label class="afld" style="flex-direction:row;align-items:center;gap:10px">' +
      '<input type="checkbox" name="storeOpen"' + (s.storeOpen ? ' checked' : '') + ' style="width:auto"> <span>Store is accepting orders</span></label>' +
      '<button class="btn" type="submit">Save settings</button>' +
      '</form></div></div>' +
      taxPanel(s.tax || {} ) +
      trackingPanel(tq);
  }

  /* ---------------- 物流订阅额度 ----------------
     免费账户每月 100 个订阅额度（官方口径：月底清零、不累积，
     只有 register 扣，查详情与 webhook 推送都不扣）。
     这个面板存在的唯一理由：额度会在月中悄悄用完。
     等发货时看到「怎么没有轨迹」才去查，已经晚了一批单。 */
  function trackingPanel(tq) {
    var q = (tq && tq.quota) || null;
    var body;

    if (!tq || tq.configured === false) {
      body = '<p class="sub" style="margin:0">17TRACK is not configured yet. ' +
        'Tracking numbers can still be saved and shown to the customer — ' +
        'there is just no automatic scan history until a key is added.</p>';
    } else if (tq.error || !q) {
      body = '<p class="sub" style="margin:0;color:var(--clay)">Could not read the quota — ' +
        U.esc(tq.error || 'no data returned') + '</p>';
    } else {
      var total = Number(q.total) || 0;
      var used = Number(q.used) || 0;
      var remain = Number(q.remain) || 0;
      /* quota_total 是「这个月一共能用多少」还是「还剩多少」，两家口径不一样。
         用 remain 有值就算 remain，否则用 total - used 兜底，不猜。 */
      if (!remain && total) remain = Math.max(0, total - used);
      var pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
      var low = total > 0 && remain <= 20;

      body = '<div style="display:flex;gap:28px;flex-wrap:wrap;align-items:baseline;margin-bottom:10px">' +
        '<div><div style="font-size:26px;font-weight:600;letter-spacing:-.02em;color:' +
        (low ? 'var(--clay)' : 'inherit') + '">' + remain + '</div>' +
        '<div class="sub" style="margin:0">shipments left this month</div></div>' +
        '<div><div style="font-size:26px;font-weight:600;letter-spacing:-.02em">' + used + '</div>' +
        '<div class="sub" style="margin:0">used</div></div>' +
        '<div><div style="font-size:26px;font-weight:600;letter-spacing:-.02em">' + total + '</div>' +
        '<div class="sub" style="margin:0">monthly allowance</div></div>' +
        '</div>' +
        '<div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden">' +
        '<div style="width:' + pct + '%;height:100%;background:' +
        (low ? 'var(--clay)' : 'var(--ink)') + ';border-radius:3px"></div></div>' +
        (low ? '<p style="margin:10px 0 0;font-size:11.5px;color:var(--clay)">' +
          'Running low. New shipments stop auto-subscribing when this hits zero — ' +
          'they still ship, they just have no scan history until the 1st.</p>' : '') +
        '<p class="hint" style="margin-top:10px">One quota is spent the first time a tracking number is registered. ' +
        'Reading it afterwards, refreshing it, and the carrier webhook pushes are all free. ' +
        'The allowance resets on the 1st and does not carry over.</p>';
    }

    return '<div class="panel"><div class="panel__hd"><h2>Tracking quota</h2>' +
      '<span class="sub">17TRACK · free tier</span></div>' +
      '<div class="panel__bd">' + body + '</div></div>';
  }


  /* ---------------- 销售税配置 ----------------
     税率用 textarea 一行一州，而不是动态增删行：
     ① 运营可以直接从别处粘一列进来；② 少一套 DOM 增删逻辑就少一类 bug；
     ③ 哪一行写错，报错能指到具体那一行。 */
  function taxPanel(t) {
    var rates = t.rates || {};
    var lines = Object.keys(rates).sort().map(function (k) {
      return k + ' ' + (Math.round(rates[k] * 1000000) / 10000);
    }).join('\n');

    return '<div class="panel"><div class="panel__hd"><h2>Sales tax</h2>' +
      '<span class="sub">Collected by shipping state — only the states listed below</span></div>' +
      '<div class="panel__bd">' +
      '<div class="acallout">' +
      '<b>Only list states where you are registered.</b> US sales tax is collected by destination state, ' +
      'and you only have to collect once you pass that state\u2019s economic nexus threshold. ' +
      'Collecting in a state where you are not registered means you owe the money to nobody and refund it to the customer — ' +
      'which is worse than collecting nothing.' +
      '</div>' +
      '<form data-act="savetax" class="cform cform--2">' +
      '<label class="afld" style="flex-direction:row;align-items:center;gap:10px">' +
      '<input type="checkbox" name="enabled"' + (t.enabled ? ' checked' : '') + ' style="width:auto"> ' +
      '<span>Collect sales tax at checkout</span></label>' +
      '<label class="afld" style="flex-direction:row;align-items:center;gap:10px">' +
      '<input type="checkbox" name="shipTaxable"' + (t.shipTaxable !== false ? ' checked' : '') + ' style="width:auto"> ' +
      '<span>Shipping is taxable in these states</span></label>' +
      '<label class="afld afld--full"><span>Rates — one state per line</span>' +
      '<textarea name="rates" rows="7" spellcheck="false" placeholder="CA 7.25&#10;NY 8.00&#10;TX 8.25">' + U.esc(lines) + '</textarea></label>' +
      '<p class="hint hint--full">Two-letter code, then the rate in percent. ' +
      'Use the combined state + local average rate for that state — we do not calculate county or city tax separately.</p>' +
      '<label class="afld afld--full"><span>Internal note</span><input name="note" value="' + U.esc(t.note || '') + '"></label>' +
      '<button class="btn afld--full" type="submit" style="justify-self:start">Save tax settings</button>' +
      '</form></div></div>';
  }

  /* ---------------- 销售税申报 ----------------
     这一页的目标很具体：把报税这件事从「翻订单」变成「打开一页、点导出」。 */
  function tax(d) {
    var t = d.totals || {};
    var cfg = d.config || {};
    var on = !!cfg.enabled;

    function row(r) {
      return '<tr><td><b>' + U.esc(r.state) + '</b></td>' +
        '<td class="num">' + r.orders + '</td>' +
        '<td class="num">' + U.money(r.sales) + '</td>' +
        '<td class="num"><b>' + U.money(r.tax) + '</b></td></tr>';
    }

    var stateRows = (d.byState || []).map(row).join('');
    var monthRows = (d.byMonth || []).map(function (r) {
      return '<tr><td>' + U.esc(r.period) + '</td><td><b>' + U.esc(r.state) + '</b></td>' +
        '<td class="num">' + r.orders + '</td>' +
        '<td class="num">' + U.money(r.sales) + '</td>' +
        '<td class="num">' + U.money(r.tax) + '</td></tr>';
    }).join('');

    var empty = !(d.byState || []).length;
    var qs = 'from=' + encodeURIComponent(d.from) + '&to=' + encodeURIComponent(d.to);

    return (on ? '' :
      '<div class="panel"><div class="panel__bd"><div class="acallout acallout--warn">' +
      '<b>Tax collection is off.</b> Nothing is being added at checkout, so this report is empty by design. ' +
      'Turn it on in <a href="#/admin/settings">Settings → Sales tax</a> once you are registered in at least one state.' +
      '</div></div></div>') +

      '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi"><span>Orders in period</span><b>' + (t.orders || 0) + '</b>' +
        '<em>' + (t.untaxed || 0) + ' with no tax</em></div>' +
      '<div class="kpi"><span>Taxable sales</span><b>' + U.money(t.sales || 0) + '</b></div>' +
      '<div class="kpi"><span>Tax collected</span><b>' + U.money(t.tax || 0) + '</b></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Filing period</h2>' +
      '<span class="sub">' + U.esc(d.from) + ' → ' + U.esc(d.to) + '</span></div>' +
      '<div class="panel__bd"><form data-act="taxrange" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">' +
      '<label class="afld" style="margin:0"><span>From</span><input name="from" type="date" value="' + U.esc(d.from) + '"></label>' +
      '<label class="afld" style="margin:0"><span>To</span><input name="to" type="date" value="' + U.esc(d.to) + '"></label>' +
      '<button class="btn" type="submit">Apply</button>' +
      '<button class="abtn" type="button" data-act="export" data-what="tax" data-qs="' + U.esc(qs) + '">Export CSV</button>' +
      '</form></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>By state</h2>' +
      '<span class="sub">Declare these numbers on each state\u2019s return</span></div>' +
      '<div class="panel__bd flush"><table class="atable">' +
      /* 四列的表按内容自动分宽会把 STATE 撑满、把数字挤到两端。
         报税看的是「州 → 数字」，所以州列窄、数字列右对齐且够宽。 */
      '<colgroup><col style="width:22%"><col style="width:16%"><col style="width:31%"><col style="width:31%"></colgroup>' +
      '<thead><tr>' +
      '<th>State</th><th class="num">Orders</th><th class="num">Taxable sales</th><th class="num">Tax</th>' +
      '</tr></thead><tbody>' +
      (empty ? '<tr><td colspan="4">No taxed orders in this period.' +
        (on ? '' : ' Tax collection is currently off.') + '</td></tr>' : stateRows) +
      '</tbody></table></div></div>' +

      (empty ? '' :
        '<div class="panel"><div class="panel__hd"><h2>By month × state</h2>' +
        '<span class="sub">Most states file monthly or quarterly — pick the rows for your period</span></div>' +
        '<div class="panel__bd flush"><table class="atable">' +
        '<colgroup><col style="width:16%"><col style="width:14%"><col style="width:14%"><col style="width:28%"><col style="width:28%"></colgroup>' +
        '<thead><tr>' +
        '<th>Period</th><th>State</th><th class="num">Orders</th><th class="num">Taxable sales</th><th class="num">Tax</th>' +
        '</tr></thead><tbody>' + monthRows + '</tbody></table></div></div>') +

      '<div class="panel"><div class="panel__hd"><h2>What this report does not do</h2></div>' +
      '<div class="panel__bd"><ul class="abullets">' +
      '<li><b>No county / city tax.</b> The rate you enter is one number per state. If you need per-ZIP accuracy, ' +
      'that requires a tax engine (TaxJar, Avalara) — this report then becomes the cross-check.</li>' +
      '<li><b>No automatic refund netting.</b> Partially refunded orders stay at their original amount here. ' +
      'Deduct the refunded tax manually using the order list in <a href="#/admin/orders">Orders</a>.</li>' +
      '<li><b>No filing.</b> This only tells you what to file. Filing itself happens on the state\u2019s portal.</li>' +
      '</ul></div></div>';
  }

  /* ---------------- 员工账号 ---------------- */
  var PERM_LABEL = {
    'metrics:read': 'See dashboard numbers',
    'orders:read': 'See orders',
    'orders:write': 'Change order status / tracking',
    'orders:refund': 'Issue refunds',
    'products:read': 'See products',
    'products:write': 'Create and edit products',
    'inventory:write': 'Adjust stock',
    'customers:read': 'See customers',
    'coupons:write': 'Create and edit coupons',
    'settings:write': 'Change store settings',
    'staff:read': 'See staff accounts',
    'staff:write': 'Add / edit / delete staff',
  };

  function permBoxes(all, checked, disabled) {
    return (all || []).map(function (p) {
      var on = (checked || []).indexOf(p) >= 0;
      return '<label class="permbox"><input type="checkbox" name="perms" value="' + U.esc(p) + '"' +
        (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
        '<span><b>' + U.esc(p) + '</b><i>' + U.esc(PERM_LABEL[p] || '') + '</i></span></label>';
    }).join('');
  }

  function roleOpts(roles, cur) {
    return (roles || []).map(function (r) {
      var name = r.role.charAt(0).toUpperCase() + r.role.slice(1);
      return '<option value="' + U.esc(r.role) + '"' + (r.role === cur ? ' selected' : '') + '>' + U.esc(name) + '</option>';
    }).join('');
  }

  function staffPage(d, selectedId) {
    var list = d.staff || [];
    var roles = d.roles || [];
    var all = d.allPermissions || [];
    var presets = {};
    roles.forEach(function (r) { presets[r.role] = r.permissions; });

    var owners = list.filter(function (s) { return s.role === 'owner' && s.status === 'active'; }).length;
    var activeN = list.filter(function (s) { return s.status === 'active'; }).length;

    /* ---------- 单个账号：编辑 ---------- */
    if (selectedId) {
      var one = list.filter(function (s) { return s.id === selectedId; })[0];
      if (!one) {
        return '<div class="panel"><div class="panel__bd">Staff account not found. ' +
          '<a href="#/admin/staff">Back to staff</a></div></div>';
      }
      var isMe = one.id === d.me;
      var onlyOwner = one.role === 'owner' && owners <= 1;

      return '<div class="panel"><div class="panel__hd"><h2>' + U.esc(one.name) + '</h2>' +
        '<a class="abtn sm" href="#/admin/staff">← All staff</a></div>' +
        '<div class="panel__bd"><form data-act="staff-save" data-id="' + U.esc(one.id) + '" class="cform">' +
        '<label class="afld"><span>Name</span><input name="name" value="' + U.esc(one.name) + '" required></label>' +
        '<label class="afld"><span>Email (cannot be changed)</span>' +
        '<input value="' + U.esc(one.email) + '" disabled></label>' +
        '<label class="afld"><span>Role</span>' +
        '<select name="role" data-act="staff-role" data-presets=\'' + U.esc(JSON.stringify(presets)) + '\'>' +
        roleOpts(roles, one.role) + '</select></label>' +
        '<label class="afld"><span>Status</span>' +
        '<select name="status"' + (isMe || onlyOwner ? ' disabled' : '') + '>' +
        '<option value="active"' + (one.status === 'active' ? ' selected' : '') + '>Active</option>' +
        '<option value="disabled"' + (one.status === 'disabled' ? ' selected' : '') + '>Disabled</option>' +
        '</select></label>' +
        (isMe || onlyOwner
          ? '<p class="sub" style="grid-column:1/-1">' +
            (isMe ? 'This is your own account — you cannot disable it.' :
              'This is the only owner account — disable it and nobody can change settings again.') +
            '</p>' : '') +
        '<div class="afld afld--full"><span>Permissions</span>' +
        '<div class="permgrid">' + permBoxes(all, one.permissions) + '</div></div>' +
        '<button class="btn" type="submit">Save changes</button>' +
        '</form></div>' +
        '<div class="panel__bd sub">Role only picks a starting set of permissions — what actually applies is the ' +
        'boxes above. Owner always has everything.</div></div>' +

        '<div class="panel"><div class="panel__hd"><h2>Reset password</h2>' +
        '<span class="sub">Signs this account out everywhere</span></div>' +
        '<div class="panel__bd"><form data-act="staff-pw" data-id="' + U.esc(one.id) + '" class="cform">' +
        (isMe ? '<label class="afld afld--full"><span>Current password</span>' +
          '<input name="currentPassword" type="password" autocomplete="current-password" required></label>' : '') +
        '<label class="afld afld--full"><span>New password (at least ' + (d.minPassword || 8) + ' characters)</span>' +
        '<input name="password" type="password" autocomplete="new-password" required></label>' +
        '<button class="btn" type="submit">' + (isMe ? 'Change my password' : 'Reset their password') + '</button>' +
        '</form></div>' +
        (isMe ? '<div class="panel__bd sub">Changing your own password asks for the current one — a stolen ' +
          'sign-in token alone is not enough to take the account over.</div>' : '') + '</div>' +

        (isMe ? '' :
          '<div class="panel"><div class="panel__hd"><h2>Danger zone</h2></div>' +
          '<div class="panel__bd" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<button class="abtn" data-act="staff-toggle" data-id="' + U.esc(one.id) + '" data-status="' +
          (one.status === 'active' ? 'disabled' : 'active') + '">' +
          (one.status === 'active' ? 'Disable account' : 'Re-enable account') + '</button>' +
          '<button class="abtn danger" data-act="staff-del" data-id="' + U.esc(one.id) + '" data-email="' +
          U.esc(one.email) + '"' + (onlyOwner ? ' disabled' : '') + '>Delete account</button>' +
          '<span class="sub">Disabling keeps the history and the audit trail. Deleting removes the account — ' +
          'their audit entries stay.</span></div></div>');

      /* 上面 danger zone 的 disabled 只挡按钮，服务端还有一道闸，见 DELETE 路由 */
    }

    /* ---------- 列表 ---------- */
    var rows = list.map(function (s) {
      var pill = s.status === 'active' ? 'active' : 'cancelled';
      var rolePill = s.role === 'owner' ? 'paid' : 'new';
      return '<tr><td><a href="#/admin/staff/' + U.esc(s.id) + '"><b>' + U.esc(s.name) + '</b></a>' +
        (s.id === d.me ? ' <span class="tag">you</span>' : '') + '</td>' +
        '<td>' + U.esc(s.email) + '</td>' +
        '<td><span class="pill ' + rolePill + '">' + U.esc(s.role) + '</span></td>' +
        '<td><span class="pill ' + pill + '">' + U.esc(s.status) + '</span></td>' +
        '<td class="num">' + (s.permissions || []).length + '</td>' +
        '<td>' + (s.lastLoginAt ? U.fmtDate(s.lastLoginAt) : '—') + '</td>' +
        '<td><a class="abtn sm" href="#/admin/staff/' + U.esc(s.id) + '">Manage</a></td></tr>';
    }).join('');

    return '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi"><span>Accounts</span><b>' + list.length + '</b></div>' +
      '<div class="kpi"><span>Active</span><b>' + activeN + '</b>' +
        '<em>' + (list.length - activeN) + ' disabled</em></div>' +
      '<div class="kpi"><span>Owners</span><b>' + owners + '</b>' +
        '<em>' + (owners <= 1 ? 'add a second one before you need it' : 'at least two — safe') + '</em></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Staff</h2>' +
      '<span class="sub">Who can sign in to this admin, and what they can do</span></div>' +
      '<div class="panel__bd flush"><table class="atable">' +
      '<colgroup><col style="width:20%"><col style="width:26%"><col style="width:11%"><col style="width:11%">' +
      '<col style="width:10%"><col style="width:14%"><col style="width:8%"></colgroup>' +
      '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>' +
      '<th class="num">Perms</th><th>Last sign-in</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="7">No staff accounts.</td></tr>') + '</tbody></table></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Add someone</h2>' +
      '<span class="sub">They can sign in as soon as you save</span></div>' +
      '<div class="panel__bd"><form data-act="staff-create" data-presets=\'' + U.esc(JSON.stringify(presets)) + '\' class="cform cform--2">' +
      '<label class="afld"><span>Name</span><input name="name" placeholder="Who is this" required></label>' +
      '<label class="afld"><span>Email</span><input name="email" type="email" placeholder="name@example.com" required></label>' +
      '<label class="afld"><span>Role</span>' +
      '<select name="role" data-act="staff-role" data-presets=\'' + U.esc(JSON.stringify(presets)) + '\'>' +
      roleOpts(roles, 'support') + '</select></label>' +
      '<label class="afld"><span>Initial password (at least ' + (d.minPassword || 8) + ' characters)</span>' +
      '<input name="password" type="text" autocomplete="off" ' +
      'placeholder="Tell them to change it after first sign-in" required></label>' +
      '<div class="afld afld--full"><span>Permissions</span>' +
      '<div class="permgrid" id="permGrid">' + permBoxes(all, presets.support || []) + '</div></div>' +
      '<button class="btn" type="submit" style="grid-column:1/-1">Create account</button>' +
      '</form></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Two things this page will not let you do</h2></div>' +
      '<div class="panel__bd"><ul class="abullets">' +
      '<li><b>Delete or disable your own account.</b> One wrong click and you are locked out of your own store, ' +
      'with no password reset to fall back on — there is no “forgot password” email on this admin.</li>' +
      '<li><b>Remove the last owner.</b> If no active owner is left, nobody can change settings, refund, or add ' +
      'staff again. Add a second owner first, confirm it can sign in, then downgrade the first.</li>' +
      '</ul></div></div>';
  }

  /* ---------------- 优惠券 / 营销 ---------------- */
  function coupons(list) {
    var live = list.filter(function (c) { return c.status === 'active'; }).length;
    var sched = list.filter(function (c) { return c.status === 'scheduled'; }).length;
    var redeemed = list.reduce(function (a, c) { return a + (c.used || 0); }, 0);

    function money(c) {
      return c.type === 'percent' ? c.value + '%' : U.money(c.value);
    }

    var rows = list.map(function (c) {
      var cap = c.limit == null ? '∞' : c.limit;
      var pct = c.limit ? Math.min(100, Math.round((c.used || 0) / c.limit * 100)) : null;
      var klass = c.status === 'active' ? 'completed' : c.status === 'scheduled' ? 'paid' : 'cancelled';
      return '<tr><td><b>' + U.esc(c.code) + '</b>' + (c.note ? '<br><span class="sub">' + U.esc(c.note) + '</span>' : '') + '</td>' +
        '<td class="num">' + U.esc(money(c)) + '</td>' +
        '<td class="num">' + (c.minSubtotal ? U.money(c.minSubtotal) : '—') + '</td>' +
        '<td class="num">' + (c.used || 0) + ' / ' + cap + (pct != null ? ' <span class="sub">' + pct + '%</span>' : '') + '</td>' +
        '<td><span class="sub">' + U.esc(c.startsAt || '—') + ' → ' + U.esc(c.endsAt || '—') + '</span></td>' +
        '<td><span class="pill ' + klass + '">' + U.esc(c.status) + '</span></td>' +
        '<td style="text-align:right"><button class="abtn sm danger" data-act="del-coupon" data-code="' + U.esc(c.code) + '">Delete</button></td></tr>';
    }).join('');

    return '<div class="kpis">' +
      '<div class="kpi"><span>Codes total</span><b>' + list.length + '</b></div>' +
      '<div class="kpi"><span>Live now</span><b>' + live + '</b><em>' + sched + ' scheduled</em></div>' +
      '<div class="kpi"><span>Redemptions</span><b>' + redeemed + '</b></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Discount codes</h2>' +
      '<span class="sub">Checked server-side on every quote and order</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Code</th><th class="num">Value</th><th class="num">Min spend</th><th class="num">Used</th>' +
      '<th>Window</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="7">No codes yet.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Create a code</h2>' +
      '<span class="sub">Takes effect immediately on the storefront</span></div>' +
      '<div class="panel__bd"><form data-act="newcoupon" class="cform">' +
      '<label class="afld"><span>Code</span><input name="code" placeholder="SPRING15" required></label>' +
      '<label class="afld"><span>Type</span><select name="type">' +
      '<option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></label>' +
      '<label class="afld"><span>Value</span><input name="value" type="number" step="0.01" min="0.01" placeholder="15" required></label>' +
      '<label class="afld"><span>Min spend (0 = none)</span><input name="minSubtotal" type="number" step="1" min="0" value="0"></label>' +
      '<label class="afld"><span>Usage limit (blank = ∞)</span><input name="limit" type="number" step="1" min="1" placeholder=""></label>' +
      '<label class="afld"><span>Note</span><input name="note" placeholder="Where this code runs"></label>' +
      '<button class="btn" type="submit">Create code</button></form></div></div>';
  }

  /* ---------------- 评价审核 ---------------- */
  function stars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<i class="' + (i <= n ? 'on' : '') + '">★</i>';
    return '<span class="stars">' + out + '</span>';
  }

  function reviews(list, filter) {
    var tabs = [['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']]
      .map(function (t) {
        return '<a class="abtn' + ((filter || '') === t[0] ? ' solid' : '') + '" href="#/admin/reviews' +
          (t[0] ? '?status=' + t[0] : '') + '">' + t[1] + '</a>';
      }).join('');

    var cards = list.map(function (r) {
      var klass = r.status === 'approved' ? 'completed' : r.status === 'pending' ? 'paid' : 'cancelled';
      var acts = r.status === 'pending'
        ? '<button class="abtn sm" data-act="modreview" data-id="' + U.esc(r.id) + '" data-to="approved">Approve</button> ' +
          '<button class="abtn sm danger" data-act="modreview" data-id="' + U.esc(r.id) + '" data-to="rejected">Reject</button>'
        : '<button class="abtn sm" data-act="modreview" data-id="' + U.esc(r.id) + '" data-to="pending">Send back to pending</button>';
      return '<div class="revcard">' +
        '<div class="revcard__hd">' + stars(r.rating) +
        '<span class="pill ' + klass + '">' + U.esc(r.status) + '</span></div>' +
        '<h3>' + U.esc(r.title || '(no title)') + '</h3>' +
        '<p>' + U.esc(r.body || '') + '</p>' +
        '<div class="revcard__ft"><span>' + U.esc(r.name || 'Anonymous') +
        (r.verified ? ' <span class="tag">Verified</span>' : '') +
        '<br><span class="sub">' + U.esc(r.productTitle || r.productId || '') + ' · ' + U.fmtDate(r.createdAt) + '</span></span>' +
        '<span style="white-space:nowrap">' + acts + '</span></div></div>';
    }).join('');

    return '<div class="kpis">' +
      '<div class="kpi"><span>In this view</span><b>' + list.length + '</b></div>' +
      '<div class="kpi"><span>Waiting</span><b>' + list.filter(function (r) { return r.status === 'pending'; }).length + '</b>' +
      '<em>Moderate before it shows on site</em></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Product reviews</h2></div>' +
      '<div class="panel__bd" style="display:flex;gap:8px;flex-wrap:wrap">' + tabs + '</div>' +
      '<div class="panel__bd"><div class="revlist">' +
      (cards || '<p class="sub">Nothing here.</p>') + '</div></div></div>';
  }

  /* ---------------- 客户 ---------------- */
  function customers(list) {
    var rows = list.map(function (c) {
      var klass = String(c.tier || 'New').toLowerCase().replace(/[^a-z]/g, '');
      return '<tr><td><b>' + U.esc(c.name || c.email) + '</b><br><span class="sub">' + U.esc(c.email) + '</span></td>' +
        '<td class="num">' + (c.orders || 0) + '</td>' +
        '<td class="num">' + U.money(c.spent || 0) + '</td>' +
        '<td><span class="pill ' + klass + '">' + U.esc(c.tier || 'New') + '</span></td>' +
        '<td><span class="sub">' + (c.last ? U.fmtDate(c.last) : '—') + '</span></td></tr>';
    }).join('');
    var total = list.reduce(function (a, c) { return a + (c.spent || 0); }, 0);
    var repeat = list.filter(function (c) { return (c.orders || 0) > 1; }).length;

    return '<div class="kpis">' +
      '<div class="kpi"><span>Customers</span><b>' + list.length + '</b></div>' +
      '<div class="kpi"><span>Repeat buyers</span><b>' + repeat + '</b>' +
      '<em>' + (list.length ? Math.round(repeat / list.length * 100) : 0) + '% of base</em></div>' +
      '<div class="kpi"><span>Lifetime value</span><b>' + U.money(total) + '</b></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Customer book</h2>' +
      '<div class="phd-r"><span class="sub">Grouped by lowercased email — no duplicate records</span>' +
      '<button class="abtn sm" data-act="export" data-what="customers">Export CSV</button></div></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Customer</th><th class="num">Orders</th><th class="num">Spent</th><th>Tier</th><th>Last order</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="5">No customers yet.</td></tr>') + '</tbody></table></div></div>';
  }

  /* ---------------- 库存流水 ---------------- */
  var REASON_LABEL = {
    seed: 'Opening balance', sale: 'Sale', refund: 'Refund returned',
    cancelled: 'Order cancelled', restock: 'Manual restock', 'purchase-order': 'Purchase order',
  };

  function ledger(list, opts) {
    var rows = list.map(function (l) {
      var up = (l.delta || 0) > 0;
      return '<tr><td><span class="sub">' + U.fmtDate(l.createdAt) + '</span></td>' +
        '<td><b>' + U.esc(l.sku) + '</b></td>' +
        '<td>' + U.esc(REASON_LABEL[l.reason] || l.reason) + '</td>' +
        '<td class="num ' + (up ? 'delta-up' : 'delta-dn') + '">' + (up ? '+' : '') + l.delta + '</td>' +
        '<td class="num">' + l.balanceAfter + '</td>' +
        '<td><span class="sub">' + U.esc(l.refType || '—') + (l.refId ? ' · ' + U.esc(l.refId) : '') + '</span></td></tr>';
    }).join('');

    var totalIn = list.filter(function (l) { return l.delta > 0; }).reduce(function (a, l) { return a + l.delta; }, 0);
    var totalOut = list.filter(function (l) { return l.delta < 0; }).reduce(function (a, l) { return a + l.delta; }, 0);

    return '<div class="kpis">' +
      '<div class="kpi"><span>Entries shown</span><b>' + list.length + '</b></div>' +
      '<div class="kpi"><span>Units in</span><b>' + totalIn + '</b></div>' +
      '<div class="kpi"><span>Units out</span><b>' + Math.abs(totalOut) + '</b></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Stock ledger</h2>' +
      '<span class="sub">Append-only — every movement, with the balance after it</span></div>' +
      (opts && opts.sku ? '<div class="panel__bd"><span class="pill paid">Filtered: ' + U.esc(opts.sku) + '</span> ' +
        '<a class="abtn sm" href="#/admin/ledger">Clear filter</a></div>' : '') +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>When</th><th>SKU</th><th>Reason</th><th class="num">Change</th><th class="num">Balance</th><th>Source</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6">No movements yet.</td></tr>') + '</tbody></table></div></div>';
  }

  /* ---------------- 审计日志 ---------------- */
  var ACTION_GROUP = function (a) {
    if (/^login|^logout/.test(a)) return 'Auth';
    if (/^order/.test(a)) return 'Orders';
    if (/^product|^inventory/.test(a)) return 'Catalog';
    if (/^coupon/.test(a)) return 'Marketing';
    if (/^review/.test(a)) return 'Reviews';
    if (/^settings/.test(a)) return 'Settings';
    return 'Other';
  };

  function audit(list) {
    var AREA_PILL = {
      Auth: 'pending', Orders: 'paid', Catalog: 'completed',
      Marketing: 'scheduled', Reviews: 'fulfilled', Settings: 'refunded', Other: 'cancelled',
    };
    var rows = list.map(function (l) {
      var area = ACTION_GROUP(l.action);
      return '<tr><td><span class="sub">' + U.fmtDate(l.at) + '</span></td>' +
        '<td><b>' + U.esc(l.email || l.staffId || '—') + '</b></td>' +
        '<td><span class="pill ' + (AREA_PILL[area] || 'pending') + '">' + U.esc(area) + '</span></td>' +
        '<td>' + U.esc(l.action) + '</td>' +
        '<td><span class="sub">' + U.esc(l.target || '—') + '</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="panel__hd"><h2>Audit log</h2>' +
      '<span class="sub">Last ' + list.length + ' privileged actions · who did what, when</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>When</th><th>Staff</th><th>Area</th><th>Action</th><th>Target</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="5">Nothing recorded yet.</td></tr>') + '</tbody></table></div></div>';
  }

  /* ---------------- 集合（A-06） ----------------
     集合就是商品身上的标签，所以这里的「商品数」永远从商品现算，
     不读 collection.count —— 存一份冗余计数，迟早和商品对不上。 */
  function collections(list) {
    var inNav = list.filter(function (c) { return c.nav; }).length;
    var empty = list.filter(function (c) { return !c.productCount; }).length;

    var rows = list.map(function (c) {
      return '<tr><td><b>' + U.esc(c.title) + '</b><br><span class="sub">' + U.esc(c.handle) + '</span></td>' +
        '<td class="num">' + c.productCount + '</td>' +
        '<td>' + (c.nav ? '<span class="pill completed">in nav</span>' : '<span class="pill cancelled">hidden</span>') + '</td>' +
        '<td class="num">' + (c.order || 0) + '</td>' +
        '<td class="num">' + (c.level || 1) + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' +
        '<a class="abtn sm" href="#/admin/collections/' + encodeURIComponent(c.handle) + '">Edit</a> ' +
        '<button class="abtn sm" data-act="col-nav" data-handle="' + U.esc(c.handle) + '" data-nav="' + (c.nav ? '0' : '1') + '">' +
        (c.nav ? 'Hide' : 'Show') + '</button>' +
        (c.productCount ? '' : ' <button class="abtn sm danger" data-act="col-del" data-handle="' + U.esc(c.handle) + '">Delete</button>') +
        '</td></tr>';
    }).join('');

    return '<div class="kpis">' +
      '<div class="kpi"><span>Collections</span><b>' + list.length + '</b></div>' +
      '<div class="kpi"><span>In navigation</span><b>' + inNav + '</b><em>' + (list.length - inNav) + ' hidden</em></div>' +
      '<div class="kpi"><span>Empty</span><b>' + empty + '</b><em>No products attached</em></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Collections</h2>' +
      '<span class="sub">Navigation switch takes effect on the storefront immediately</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Collection</th><th class="num">Products</th><th>Nav</th><th class="num">Order</th><th class="num">Level</th><th></th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6">No collections yet.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>New collection</h2>' +
      '<span class="sub">Handle is generated from the title if left blank</span></div>' +
      '<div class="panel__bd"><form data-act="newcol" class="cform">' +
      '<label class="afld"><span>Title</span><input name="title" placeholder="Gifts under $80" required></label>' +
      '<label class="afld"><span>Handle</span><input name="handle" placeholder="gifts-under-80"></label>' +
      '<label class="afld"><span>Order</span><input name="order" type="number" step="1" min="0" placeholder="auto"></label>' +
      '<label class="afld"><span>Description</span><input name="desc" placeholder="One line shown at the top of the collection"></label>' +
      '<button class="btn" type="submit">Create collection</button></form></div></div>';
  }

  function collectionEdit(c) {
    return '<div class="panel"><div class="panel__hd"><h2>' + U.esc(c.title) + '</h2>' +
      '<a class="abtn sm" href="#/admin/collections">← All collections</a></div>' +
      '<div class="panel__bd"><form data-act="editcol" data-handle="' + U.esc(c.handle) + '" class="cform">' +
      '<label class="afld"><span>Title</span><input name="title" value="' + U.esc(c.title) + '" required></label>' +
      '<label class="afld"><span>Handle (fixed)</span><input value="' + U.esc(c.handle) + '" disabled></label>' +
      '<label class="afld"><span>Order in nav</span><input name="order" type="number" step="1" min="0" value="' + (c.order || 0) + '"></label>' +
      '<label class="afld" style="grid-column:1/-1"><span>Description</span>' +
      '<input name="desc" value="' + U.esc(c.desc || '') + '" placeholder="Shown under the collection title"></label>' +
      '<label class="afld" style="grid-column:1/-1"><span>Navigation</span>' +
      '<select name="nav"><option value="1"' + (c.nav ? ' selected' : '') + '>Show in header navigation</option>' +
      '<option value="0"' + (c.nav ? '' : ' selected') + '>Hidden from navigation</option></select></label>' +
      '<button class="btn" type="submit">Save collection</button></form></div>' +
      '<div class="panel__bd sub">' + c.productCount + ' products in this collection. ' +
      'Attach or remove products from each product page (Edit price → Collections).</div></div>';
  }

  /* ---------------- 定制需求单（A-12） ---------------- */
  var CR_LABEL = { new: 'New', quoted: 'Quoted', ordered: 'Ordered', closed: 'Closed' };
  var CR_PILL = { new: 'paid', quoted: 'fulfilling', ordered: 'completed', closed: 'cancelled' };

  function custom(list, filter) {
    var count = function (s) { return list.filter(function (r) { return r.status === s; }).length; };
    var tabs = [['', 'All'], ['new', 'New'], ['quoted', 'Quoted'], ['ordered', 'Ordered'], ['closed', 'Closed']]
      .map(function (t) {
        return '<a class="abtn' + ((filter || '') === t[0] ? ' solid' : '') + '" href="#/admin/custom' +
          (t[0] ? '?status=' + t[0] : '') + '">' + t[1] + '</a>';
      }).join('');

    var rows = list.map(function (r) {
      return '<tr><td><b>' + U.esc(r.id) + '</b><br><span class="sub">' + U.fmtDate(r.createdAt) + '</span></td>' +
        '<td>' + U.esc(r.name || '—') + '<br><span class="sub">' + U.esc(r.email) + '</span></td>' +
        '<td>' + U.esc(r.style || '—') + '</td>' +
        '<td class="num">' + (r.qty || 1) + '</td>' +
        '<td>' + U.esc(r.dueDate || '—') + '</td>' +
        '<td><span class="pill ' + (CR_PILL[r.status] || 'paid') + '">' + U.esc(CR_LABEL[r.status] || r.status) + '</span></td>' +
        '<td style="text-align:right"><a class="abtn sm" href="#/admin/custom/' + encodeURIComponent(r.id) + '">Open</a></td></tr>';
    }).join('');

    return '<div class="kpis">' +
      '<div class="kpi"><span>Awaiting quote</span><b>' + count('new') + '</b><em>From the storefront form</em></div>' +
      '<div class="kpi"><span>Quoted</span><b>' + count('quoted') + '</b></div>' +
      '<div class="kpi"><span>Ordered</span><b>' + count('ordered') + '</b></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Custom requests</h2>' +
      '<span class="sub">Written by the storefront custom page (FR-S-092)</span></div>' +
      '<div class="panel__bd" style="display:flex;gap:8px;flex-wrap:wrap">' + tabs + '</div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Request</th><th>Customer</th><th>Style</th><th class="num">Qty</th><th>Wanted by</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="7">No requests yet. Submit one from #/custom on the storefront.</td></tr>') + '</tbody></table></div></div>';
  }

  function customDetail(r) {
    var next = { new: ['quoted', 'closed'], quoted: ['ordered', 'closed'], ordered: ['closed'], closed: [] }[r.status] || [];
    var acts = next.map(function (s) {
      return '<button class="abtn" data-act="cr-status" data-id="' + U.esc(r.id) + '" data-to="' + s + '">' +
        (s === 'quoted' ? 'Mark quoted' : s === 'ordered' ? 'Mark ordered' : 'Close') + '</button>';
    }).join('');

    return '<div class="panel"><div class="panel__hd"><h2>' + U.esc(r.id) + '</h2>' +
      '<a class="abtn sm" href="#/admin/custom">← All requests</a></div>' +
      '<div class="panel__bd" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span class="pill ' + (CR_PILL[r.status] || 'paid') + '">' + U.esc(CR_LABEL[r.status] || r.status) + '</span>' + acts + '</div>' +
      '<div class="panel__bd"><div class="srow"><span>Customer</span><b>' + U.esc(r.name || '—') + '</b></div>' +
      '<div class="srow"><span>Email</span><b>' + U.esc(r.email) + '</b></div>' +
      '<div class="srow"><span>Style</span><b>' + U.esc(r.style || '—') + '</b></div>' +
      '<div class="srow"><span>Quantity</span><b>' + (r.qty || 1) + '</b></div>' +
      '<div class="srow"><span>Wanted by</span><b>' + U.esc(r.dueDate || '—') + '</b></div>' +
      '<div class="srow"><span>Quote</span><b>' + (r.quote != null ? U.money(r.quote) : '—') + '</b></div>' +
      '<p class="sub" style="margin-top:16px;white-space:pre-wrap">' + U.esc(r.notes || '') + '</p>' +
      (r.refUrls && r.refUrls.length
        ? '<p class="sub" style="margin-top:10px">Reference links<br>' +
          r.refUrls.map(function (u) { return '<a href="' + U.esc(u) + '" target="_blank" rel="noopener">' + U.esc(u) + '</a>'; }).join('<br>') + '</p>'
        : '') +
      '</div>' +
      '<div class="panel__bd"><form data-act="cr-edit" data-id="' + U.esc(r.id) + '" class="cform">' +
      '<label class="afld"><span>Quote (USD)</span><input name="quote" type="number" step="0.01" min="0" value="' + (r.quote != null ? r.quote : '') + '" placeholder="0.00"></label>' +
      '<label class="afld" style="grid-column:1/-1"><span>Internal note</span><input name="note" value="' + U.esc(r.note || '') + '" placeholder="Factory, lead time, anything the next person needs"></label>' +
      '<button class="btn" type="submit">Save</button></form></div></div>';
  }

  /* ---------------- 内容（A-08） ----------------
     只开放「首页区块文案 + 内容页标题与导语」。正文段落仍在 pages.js，
     这一节末尾明说了边界，避免运营改完以为没生效。 */
  function content(d) {
    var c = d.content || {};
    var pages = d.pages || {};
    var keys = Object.keys(pages);

    var pageFields = keys.map(function (k) {
      var p = pages[k] || {};
      return '<label class="afld"><span>' + U.esc(k) + ' · title</span>' +
        '<input name="pt_' + U.esc(k) + '" value="' + U.esc(p.title || '') + '"></label>' +
        '<label class="afld"><span>' + U.esc(k) + ' · intro</span>' +
        '<input name="pi_' + U.esc(k) + '" value="' + U.esc(p.intro || '') + '"></label>';
    }).join('');

    return '<div class="panel"><div class="panel__hd"><h2>Home page copy</h2>' +
      '<span class="sub">Saves straight to the storefront — reload the store to see it</span></div>' +
      '<div class="panel__bd"><form data-act="content" class="cform">' +
      '<label class="afld"><span>Brand</span><input name="brand" value="' + U.esc(d.brand || '') + '"></label>' +
      '<label class="afld"><span>Tagline</span><input name="tagline" value="' + U.esc(d.tagline || '') + '"></label>' +
      '<label class="afld"><span>Best sellers eyebrow</span><input name="bestSellersEyebrow" value="' + U.esc(c.bestSellersEyebrow || 'As seen on TikTok') + '"></label>' +
      '<label class="afld" style="grid-column:1/-1"><span>Announcement bar (separate multiple lines with |)</span>' +
      '<input name="announce" value="' + U.esc(c.announce || '') + '"></label>' +
      '<label class="afld"><span>Hero eyebrow</span><input name="heroEyebrow" value="' + U.esc(c.heroEyebrow || '') + '"></label>' +
      '<label class="afld"><span>Hero title (use | to break the line)</span><input name="heroTitle" value="' + U.esc(c.heroTitle || '') + '"></label>' +
      '<label class="afld" style="grid-column:1/-1"><span>Hero body</span>' +
      '<input name="heroBody" value="' + U.esc(c.heroBody || '') + '"></label>' +
      '<button class="btn" type="submit" style="grid-column:1/-1">Save storefront copy</button></form></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Content pages</h2>' +
      '<span class="sub">Title and intro only — body paragraphs live in pages.js</span></div>' +
      '<div class="panel__bd"><form data-act="pages" class="cform cform--2">' + (pageFields || '<p class="sub">No pages.</p>') +
      (pageFields ? '<button class="btn" type="submit" style="grid-column:1/-1">Save page headings</button>' : '') +
      '</form></div>' +
      '<div class="panel__bd sub">正文段落不在这个模块里。改正文请改 <code>app/web/assets/js/pages.js</code>，' +
      '这一版刻意不做富文本编辑：没有版本对比与预览的富文本，改坏了只能靠回滚代码。</div></div>';
  }

  window.AdminViews = {
    shell: shell, login: login, dash: dash, orders: orders, orderDetail: orderDetail,
    products: products, inventory: inventory, settings: settings, tax: tax, staff: staffPage,
    coupons: coupons, reviews: reviews, customers: customers, ledger: ledger, audit: audit,
    collections: collections, collectionEdit: collectionEdit,
    custom: custom, customDetail: customDetail, content: content,
    editorDrawer: editorDrawer, importModal: importModal,
    imageCells: imageCells, variantRows: variantRows, pcatOptions: pcatOptions,
  };
})();
