/* ============================================================
   TIDEGLASS · 后台视图
   ============================================================ */
(function () {
  'use strict';
  var U = S.U, ui = window.UI, DB = null;

  function db() { return S.DB; }

  /* ---------------- 统计 ---------------- */
  function inRange(o, days) {
    return (Date.now() - new Date(o.createdAt).getTime()) < days * 864e5;
  }
  var LIVE = ['paid', 'fulfilling', 'fulfilled', 'completed'];

  function summary(days) {
    var list = db().orders.filter(function (o) { return inRange(o, days) && o.status !== 'cancelled'; });
    var paid = list.filter(function (o) { return LIVE.indexOf(o.status) >= 0; });
    var gmv = paid.reduce(function (a, o) { return a + o.total; }, 0);
    var refunded = list.filter(function (o) { return o.status === 'refunded'; });
    return {
      gmv: gmv,
      orders: paid.length,
      aov: paid.length ? gmv / paid.length : 0,
      refundRate: list.length ? refunded.length / list.length * 100 : 0,
      units: paid.reduce(function (a, o) { return a + o.items.reduce(function (b, i) { return b + i.qty; }, 0); }, 0)
    };
  }

  function series(days) {
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var day = new Date(Date.now() - i * 864e5);
      var key = day.toISOString().slice(0, 10);
      var v = db().orders.filter(function (o) {
        return o.createdAt.slice(0, 10) === key && LIVE.indexOf(o.status) >= 0;
      }).reduce(function (a, o) { return a + o.total; }, 0);
      out.push({ key: key, d: day, v: v });
    }
    return out;
  }

  function topProducts() {
    var m = {};
    db().orders.forEach(function (o) {
      if (LIVE.indexOf(o.status) < 0) return;
      o.items.forEach(function (i) {
        if (!m[i.productId]) m[i.productId] = { id: i.productId, title: i.title, qty: 0, rev: 0 };
        m[i.productId].qty += i.qty;
        m[i.productId].rev += i.unitPrice * i.qty;
      });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.rev - a.rev; }).slice(0, 6);
  }

  function prevSummary(days) {
    var list = db().orders.filter(function (o) {
      var age = (Date.now() - new Date(o.createdAt).getTime()) / 864e5;
      return age >= days && age < days * 2 && o.status !== 'cancelled' && LIVE.indexOf(o.status) >= 0;
    });
    var gmv = list.reduce(function (a, o) { return a + o.total; }, 0);
    return { gmv: gmv, orders: list.length, aov: list.length ? gmv / list.length : 0 };
  }

  function channels() {
    var m = {};
    db().orders.forEach(function (o) {
      if (LIVE.indexOf(o.status) < 0) return;
      var c = o.channel || 'Direct';
      m[c] = (m[c] || 0) + o.total;
    });
    var colors = ['var(--sea)', 'var(--brass)', 'var(--sea-l)', 'var(--olive)', 'var(--sand-d)'];
    return Object.keys(m).map(function (k) { return { l: k, v: m[k] }; })
      .sort(function (a, b) { return b.v - a.v; })
      .slice(0, 5)
      .map(function (d, i) { d.c = colors[i]; return d; });
  }

  function lowStock() {
    return db().products.slice()
      .sort(function (a, b) { return S.totalStock(a) - S.totalStock(b); })
      .slice(0, 6);
  }

  /* ---------------- 图表 ---------------- */
  function lineChart(data, opt) {
    opt = opt || {};
    var W = 640, H = 200, PL = 44, PR = 10, PT = 12, PB = 24;
    var rawMax = Math.max.apply(null, data.map(function (d) { return d.v; }).concat([1]));
    // 取「整」的刻度：每格落在 1/1.5/2/2.5/3/4/5/6/8/10 × 10^n 上
    function niceStep(t) {
      var mag = Math.pow(10, Math.floor(Math.log10(t)));
      var n = t / mag;
      var cand = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
      for (var i = 0; i < cand.length; i++) if (n <= cand[i]) return cand[i] * mag;
      return 10 * mag;
    }
    var step = niceStep(rawMax * 1.1 / 4);
    var max = step * 4;
    var iw = W - PL - PR, ih = H - PT - PB;
    var pts = data.map(function (d, i) {
      return [PL + (iw / (data.length - 1)) * i, PT + ih - (d.v / max) * ih];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (PT + ih) + ' L' + pts[0][0].toFixed(1) + ' ' + (PT + ih) + ' Z';
    var grid = '', ticks = '';
    for (var g = 0; g <= 4; g++) {
      var y = PT + ih - (ih / 4) * g;
      grid += '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="#E2DCD2" stroke-width="1"/>';
      ticks += '<text x="' + (PL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" fill="#948C81">$' +
        Math.round(step * g) + '</text>';
    }
    var xlab = '';
    data.forEach(function (d, i) {
      if (i % 5 !== 0 && i !== data.length - 1) return;
      var isLast = i === data.length - 1;
      xlab += '<text x="' + (pts[i][0] + (isLast ? 2 : 0)).toFixed(1) + '" y="' + (H - 6) +
        '" text-anchor="' + (isLast ? 'end' : 'middle') + '" font-size="9" fill="#948C81">' +
        d.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</text>';
    });
    var dots = opt.noDots ? '' : pts.map(function (p) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.4" fill="#1B3A34"/>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      grid + '<path d="' + area + '" fill="rgba(27,58,52,.07)"/>' +
      '<path d="' + line + '" fill="none" stroke="#1B3A34" stroke-width="1.6"/>' +
      dots + ticks + xlab + '</svg>';
  }

  function hbars(data, opt) {
    opt = opt || {};
    var max = Math.max.apply(null, data.map(function (d) { return d.v; }).concat([1]));
    return '<div style="display:grid;gap:11px">' + data.map(function (d) {
      return '<div><div style="display:flex;justify-content:space-between;font-size:10.5px;margin-bottom:4px">' +
        '<span style="color:var(--ink-2)">' + U.esc(d.l) + '</span>' +
        '<span style="color:var(--muted)">' + (opt.fmt ? opt.fmt(d) : d.v) + '</span></div>' +
        '<div style="height:5px;background:var(--line)"><div style="height:100%;width:' + (d.v / max * 100) + '%;background:' + (d.c || 'var(--sea)') + '"></div></div></div>';
    }).join('') + '</div>';
  }

  /* ---------------- 登录 ---------------- */
  function login() {
    return '<div class="loginwrap">' +
      '<div class="loginwrap__img"><img src="assets/img/c-ocean.png" alt="">' +
      '<div class="cap"><b>Sea glass doesn\'t fade.</b><span>TIDEGLASS admin · prototype</span></div></div>' +
      '<div class="loginwrap__form">' +
      '<div class="brand">' + ui.MARK + '<span class="brand__word">TIDEGLASS</span></div>' +
      '<h1>Sign in</h1><p>Manage orders, stock and storefront content.</p>' +
      '<form data-act="login">' +
      '<div class="afld"><label>Email</label><input name="email" value="owner@tideglass.co" autocomplete="username"></div>' +
      '<div class="afld"><label>Password</label><input name="password" type="password" value="" placeholder="••••••••" autocomplete="current-password"></div>' +
      '<button class="btn btn--full" type="submit" style="margin-top:6px">Sign in</button></form>' +
      '<div class="loginwrap__hint">Prototype access — no real account. The password is <code>tideglass2026</code>.<br>' +
      '<a href="#/" style="text-decoration:underline">← Back to store</a></div>' +
      '</div></div>';
  }

  /* ---------------- Dashboard ---------------- */
  function dashboard() {
    var s = summary(30), prev = prevSummary(30);
    var data = series(30);
    var tp = topProducts(), ls = lowStock();
    var pending = db().reviews.filter(function (r) { return r.status === 'pending'; }).length;
    var paidOrders = db().orders.filter(function (o) { return o.status === 'paid' || o.status === 'fulfilling'; }).length;

    function delta(cur, pre, invert) {
      if (!pre) return '<em>No prior period</em>';
      var d = (cur - pre) / pre * 100;
      var good = invert ? d < 0 : d > 0;
      return '<em class="' + (good ? '' : 'dn') + '">' + (d >= 0 ? '↑ ' : '↓ ') +
        Math.abs(d).toFixed(1) + '% vs prev. 30d</em>';
    }

    return '' +
      '<div class="kpis">' +
      '<div class="kpi"><span>Revenue · 30d</span><b>' + U.money(s.gmv) + '</b>' + delta(s.gmv, prev.gmv) + '</div>' +
      '<div class="kpi"><span>Orders · 30d</span><b>' + s.orders + '</b>' + delta(s.orders, prev.orders) + '</div>' +
      '<div class="kpi"><span>Average order</span><b>' + U.money(s.aov) + '</b>' + delta(s.aov, prev.aov) + '</div>' +
      '<div class="kpi"><span>Refund rate</span><b>' + s.refundRate.toFixed(1) + '%</b>' +
      '<em class="' + (s.refundRate > 8 ? 'dn' : '') + '">' + (s.refundRate > 8 ? 'Above 8% target' : 'On target (&lt;8%)') + '</em></div>' +
      '</div>' +

      '<div class="two">' +
      '<div class="panel"><div class="panel__hd"><h2>Revenue, last 30 days</h2>' +
      '<span class="sub">' + s.units + ' units · ' + U.money(s.gmv / 30) + '/day avg</span></div>' +
      '<div class="panel__bd">' + lineChart(data) + '</div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Needs your attention</h2></div>' +
      '<div class="panel__bd" style="display:grid;gap:9px">' +
      attn(paidOrders, 'Orders waiting to ship', '#/admin/orders', 'paid + preparing') +
      attn(pending, 'Reviews to moderate', '#/admin/reviews', 'pending approval') +
      attn(ls.length, 'SKUs low on stock', '#/admin/inventory', 'at or below 8 units') +
      attn(db().customRequests.filter(function (c) { return c.status === 'new'; }).length, 'New custom requests', '#/admin/custom', 'unanswered') +
      '</div></div></div>' +

      '<div class="two-eq">' +
      '<div class="panel"><div class="panel__hd"><h2>Top products</h2><a href="#/admin/products" class="sub" style="text-decoration:underline">All products</a></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Product</th><th class="num">Units</th><th class="num">Revenue</th></tr></thead><tbody>' +
      tp.map(function (t) {
        return '<tr><td>' + U.esc(t.title) + '</td><td class="num">' + t.qty + '</td><td class="num">' + U.money(t.rev) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Lowest stock</h2><a href="#/admin/inventory" class="sub" style="text-decoration:underline">Inventory</a></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Product</th><th class="num">On hand</th></tr></thead><tbody>' +
      (ls.length ? ls.map(function (p) {
        var st = S.totalStock(p);
        return '<tr><td>' + U.esc(p.title) + '</td><td class="num"><span class="stockbar"><i class="' +
          (st === 0 ? 'out' : st <= 8 ? 'low' : '') + '" style="width:' + Math.min(100, st / 40 * 100) + '%"></i></span>' + st + '</td></tr>';
      }).join('') : '<tr><td colspan="2" style="color:var(--muted)">No products yet.</td></tr>') +
      '</tbody></table></div></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Revenue by channel</h2>' +
      '<span class="sub">All-time, paid orders only</span></div><div class="panel__bd">' +
      hbars(channels(), { fmt: function (d) { return U.money(d.v); } }) +
      '</div></div>';
  }

  function attn(n, label, href, sub) {
    return '<a href="' + href + '" style="display:flex;align-items:center;gap:12px;padding:11px 13px;border:1px solid var(--line);background:' +
      (n ? 'rgba(192,138,46,.06)' : 'transparent') + '">' +
      '<span style="font-family:var(--serif);font-size:20px;line-height:1;width:26px;color:' + (n ? 'var(--amber)' : 'var(--muted-2)') + '">' + n + '</span>' +
      '<span style="flex:1"><b style="display:block;font-size:11.5px;font-weight:500">' + label + '</b>' +
      '<span style="font-size:10px;color:var(--muted)">' + sub + '</span></span>' +
      '<span style="color:var(--muted)">›</span></a>';
  }

  /* ---------------- Orders ---------------- */
  function orders(r) {
    if (r.seg[2]) return orderDetail(r.seg[2]);
    var f = S.state.admFilter || { status: '', q: '' };
    var list = db().orders.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    if (f.status) list = list.filter(function (o) { return o.status === f.status; });
    if (f.q) {
      var k = f.q.toLowerCase();
      list = list.filter(function (o) {
        return (o.number + ' ' + o.email + ' ' + o.name).toLowerCase().indexOf(k) >= 0;
      });
    }
    var counts = {};
    db().orders.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });

    return '<div class="atoolbar">' +
      '<button class="abtn ' + (!f.status ? 'solid' : '') + '" data-act="ofilter" data-s="">All (' + db().orders.length + ')</button>' +
      ['paid', 'fulfilling', 'fulfilled', 'refunded'].map(function (st) {
        return '<button class="abtn ' + (f.status === st ? 'solid' : '') + '" data-act="ofilter" data-s="' + st + '">' +
          (st.charAt(0).toUpperCase() + st.slice(1)) + ' (' + (counts[st] || 0) + ')</button>';
      }).join('') +
      '<span class="sp"></span>' +
      '<input placeholder="Search order, email, name" value="' + U.esc(f.q) + '" data-act="osearch" style="min-width:230px">' +
      '</div>' +

      '<div class="panel"><div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Order</th><th>Date</th><th>Customer</th><th>Status</th><th class="num">Items</th><th class="num">Total</th><th></th>' +
      '</tr></thead><tbody>' +
      (list.length ? list.map(function (o) {
        return '<tr><td class="mono" style="font-weight:600">' + U.esc(o.number) + '</td>' +
          '<td style="color:var(--muted);font-size:11px">' + U.fmtShort(o.createdAt) + '</td>' +
          '<td><b style="font-weight:500;font-size:11.5px">' + U.esc(o.name) + '</b>' +
          '<div class="mono">' + U.esc(o.email) + '</div></td>' +
          '<td><span class="pill ' + o.status + '">' + U.esc(o.statusLabel) + '</span></td>' +
          '<td class="num">' + o.items.reduce(function (a, i) { return a + i.qty; }, 0) + '</td>' +
          '<td class="num" style="font-weight:600">' + U.money(o.total) + '</td>' +
          '<td style="text-align:right"><a class="abtn sm" href="#/admin/orders/' + encodeURIComponent(o.number) + '">Open</a></td></tr>';
      }).join('') : '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:26px">No orders match.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function orderDetail(number) {
    number = decodeURIComponent(number);
    var o = db().orders.filter(function (x) { return x.number === number; })[0];
    if (!o) return '<div class="panel"><div class="panel__bd">Order not found. <a href="#/admin/orders" style="text-decoration:underline">Back to orders</a></div></div>';

    var costs = db().settings.costs;
    var goods = o.items.reduce(function (a, i) {
      var p = S.product(i.productId);
      return a + (p ? p.cost * i.qty : i.unitPrice * 0.12 * i.qty);
    }, 0);
    var duty = o.subtotal * costs.duty / 100;
    var freight = o.subtotal * costs.freight / 100;
    var fulfil = costs.fulfillment;
    var pay = o.total * costs.payment / 100 + costs.paymentFixed;
    var pack = costs.packaging;
    var ret = o.subtotal * costs.returns / 100;
    var colour = o.subtotal * costs.colourReserve / 100;
    var totalCost = goods + duty + freight + fulfil + pay + pack + ret + colour;
    var gross = o.subtotal - o.discount - totalCost;
    var margin = (o.subtotal - o.discount) ? gross / (o.subtotal - o.discount) * 100 : 0;

    var next = { paid: 'fulfilling', fulfilling: 'fulfilled', fulfilled: 'completed' };

    // 时间轴节点状态（付款 / 备货 / 发货 / 签收）
    var paid = ['pending'].indexOf(o.status) < 0;
    var prep = ['fulfilling', 'fulfilled', 'completed'].indexOf(o.status) >= 0;
    var shipped = ['fulfilled', 'completed'].indexOf(o.status) >= 0;
    var done = o.status === 'completed';

    return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">' +
      '<a href="#/admin/orders" class="abtn sm">← Orders</a>' +
      '<h2 style="font-size:16px;font-family:var(--sans);font-weight:600">' + U.esc(o.number) + '</h2>' +
      '<span class="pill ' + o.status + '">' + U.esc(o.statusLabel) + '</span>' +
      '<span class="sp" style="flex:1"></span>' +
      (next[o.status] ? '<button class="abtn solid" data-act="ostatus" data-num="' + U.esc(o.number) + '" data-to="' + next[o.status] + '">Mark as ' + next[o.status] + '</button>' : '') +
      (o.status === 'fulfilled' && !o.tracking ? '<button class="abtn solid" data-act="ship" data-num="' + U.esc(o.number) + '">Add tracking</button>' : '') +
      (o.status !== 'refunded' && o.status !== 'cancelled' ? '<button class="abtn danger" data-act="refund" data-num="' + U.esc(o.number) + '">Refund</button>' : '') +
      '</div>' +

      '<div class="two">' +
      '<div>' +
      '<div class="panel"><div class="panel__hd"><h2>Items</h2><span class="sub">' + U.fmtDate(o.createdAt) + '</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Product</th><th>Variant</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>' +
      o.items.map(function (i) {
        return '<tr><td>' + U.esc(i.title) + '</td><td style="font-size:11px;color:var(--muted)">' + U.esc(i.variant) + (i.size ? ' / ' + U.esc(i.size) : '') + '</td>' +
          '<td class="num">' + i.qty + '</td><td class="num">' + U.money(i.unitPrice) + '</td><td class="num">' + U.money(i.unitPrice * i.qty) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="panel__bd" style="border-top:1px solid var(--line)">' +
      '<div class="sum" style="max-width:280px;margin-left:auto">' +
      '<div class="sum__row"><span>Subtotal</span><span>' + U.money(o.subtotal) + '</span></div>' +
      (o.discount ? '<div class="sum__row disc"><span>Discount' + (o.couponCode ? ' (' + o.couponCode + ')' : '') + '</span><span>−' + U.money(o.discount) + '</span></div>' : '') +
      '<div class="sum__row"><span>Shipping</span><span>' + (o.shipping ? U.money(o.shipping) : 'Free') + '</span></div>' +
      '<div class="sum__row tot"><span>Total</span><span>' + U.money(o.total) + '</span></div></div></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Timeline</h2></div><div class="panel__bd">' +
      '<div style="display:grid;gap:12px;font-size:11.5px">' +
      tline('Order placed', U.fmtDate(o.createdAt), true) +
      tline('Payment captured', paid ? U.fmtDate(o.createdAt) : '—', paid) +
      tline('Preparing', prep ? stageDate(o, 1) : '—', prep) +
      tline('Shipped' + (o.tracking ? ' · ' + o.tracking : ''), shipped ? stageDate(o, 2) : '—', shipped) +
      tline('Delivered', done ? stageDate(o, 4) : '—', done) +
      '</div></div></div></div>' +

      '<div>' +
      '<div class="panel"><div class="panel__hd"><h2>Customer</h2></div><div class="panel__bd" style="font-size:11.5px;line-height:1.9">' +
      '<div><b>' + U.esc(o.name) + '</b></div>' +
      '<div class="mono">' + U.esc(o.email) + '</div>' +
      '<hr style="border:0;border-top:1px solid var(--line);margin:10px 0">' +
      '<div>' + U.esc(o.address.line1 || '') + '</div>' +
      '<div>' + U.esc(o.address.city || '') + ', ' + U.esc(o.address.state || '') + ' ' + U.esc(o.address.zip || '') + '</div>' +
      '<div>' + U.esc(o.address.country || 'United States') + '</div>' +
      '<hr style="border:0;border-top:1px solid var(--line);margin:10px 0">' +
      '<div style="color:var(--muted)">Shipping method</div><div>' + U.esc(o.shippingMethod) + '</div>' +
      (o.tracking ? '<div style="color:var(--muted);margin-top:8px">Tracking</div><div class="mono">' + U.esc(o.tracking) + '</div>' : '') +
      '</div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Margin breakdown</h2>' +
      '<span class="sub">' + margin.toFixed(1) + '% margin</span></div>' +
      '<div class="panel__bd"><div class="costgrid">' +
      '<div><span>Goods</span><b>' + U.money(goods) + '</b></div>' +
      '<div><span>Duty (' + costs.duty + '%)</span><b>' + U.money(duty) + '</b></div>' +
      '<div><span>Freight (' + costs.freight + '%)</span><b>' + U.money(freight) + '</b></div>' +
      '<div><span>Fulfilment</span><b>' + U.money(fulfil) + '</b></div>' +
      '<div><span>Payment</span><b>' + U.money(pay) + '</b></div>' +
      '<div><span>Packaging</span><b>' + U.money(pack) + '</b></div>' +
      '<div><span>Returns (' + costs.returns + '%)</span><b>' + U.money(ret) + '</b></div>' +
      '<div><span>Colour reserve</span><b>' + U.money(colour) + '</b></div>' +
      '<div class="sum" style="grid-column:1/-1"><span>Contribution</span><b>' + U.money(gross) + '</b></div>' +
      '</div><p style="font-size:10px;color:var(--muted-2);margin:10px 0 0">Rates snapshot stored on the order. Changing settings will not alter this order.</p></div></div>' +
      '</div></div>';
  }

  // 节点日期：下单日 + 偏移，且不晚于今天（避免出现未来时间）
  function stageDate(o, plus) {
    var d = new Date(o.createdAt);
    if (isNaN(d.getTime())) return '—';
    d.setDate(d.getDate() + plus);
    var now = new Date();
    if (d > now) d = now;
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return U.fmtDate(d.getFullYear() + '-' + m + '-' + dd);
  }

  function tline(label, date, on) {
    // 防御：任何布尔/空值都不应直接渲染到界面上
    if (typeof date !== 'string' || !date) date = '—';
    return '<div style="display:flex;gap:10px;align-items:flex-start;opacity:' + (on ? 1 : .42) + '">' +
      '<span style="width:7px;height:7px;border-radius:50%;margin-top:5px;background:' + (on ? 'var(--olive)' : 'var(--line-2)') + '"></span>' +
      '<span style="flex:1">' + label + '<span style="display:block;color:var(--muted);font-size:10px">' + date + '</span></span></div>';
  }

  /* ---------------- Products ---------------- */
  function products(r) {
    if (r.seg[2]) return productEdit(r.seg[2]);
    var q = (S.state.admProdQ || '').toLowerCase();
    var list = db().products.slice();
    if (q) list = list.filter(function (p) { return (p.title + ' ' + p.id).toLowerCase().indexOf(q) >= 0; });

    return '<div class="atoolbar">' +
      '<input placeholder="Search products" value="' + U.esc(S.state.admProdQ || '') + '" data-act="psearch" style="min-width:240px">' +
      '<span class="sp"></span>' +
      '<span style="font-size:11px;color:var(--muted)">' + list.length + ' products</span>' +
      '<button class="abtn solid" data-act="newprod">+ New product</button></div>' +

      '<div class="panel"><div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th style="width:46px"></th><th>Product</th><th>SKU</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Stock</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' +
      list.map(function (p) {
        var st = S.totalStock(p);
        return '<tr><td><img src="' + p.images[0] + '" style="width:34px;aspect-ratio:4/5;object-fit:cover" alt=""></td>' +
          '<td><b style="font-weight:500;font-size:11.5px">' + U.esc(p.title) + '</b>' +
          '<div style="font-size:10px;color:var(--muted)">' + U.esc(p.cat) + ' · ' + U.esc(p.motif) + '</div></td>' +
          '<td class="mono">' + U.esc(p.id) + '</td>' +
          '<td class="num">' + U.money(p.price) + '</td><td class="num" style="color:var(--muted)">' + U.money(p.cost) + '</td>' +
          '<td class="num"><span class="stockbar"><i class="' + (st === 0 ? 'out' : st <= 8 ? 'low' : '') +
          '" style="width:' + Math.min(100, st / 40 * 100) + '%"></i></span>' + st + '</td>' +
          '<td><span class="pill ' + (p.active ? 'active' : 'expired') + '">' + (p.active ? 'Active' : 'Draft') + '</span></td>' +
          '<td style="text-align:right"><a class="abtn sm" href="#/admin/products/' + p.id + '">Edit</a></td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  function productEdit(id) {
    var p = S.product(id);
    if (!p) return '<div class="panel"><div class="panel__bd">Product not found.</div></div>';
    var cat = S.coll(p.cat);

    return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">' +
      '<a href="#/admin/products" class="abtn sm">← Products</a>' +
      '<h2 style="font-size:16px;font-family:var(--sans);font-weight:600">' + U.esc(p.title) + '</h2>' +
      '<span class="pill ' + (p.active ? 'active' : 'expired') + '">' + (p.active ? 'Active' : 'Draft') + '</span>' +
      '<span style="flex:1"></span>' +
      '<a class="abtn" href="#/products/' + p.handle + '">View in store ↗</a>' +
      '<button class="abtn solid" data-act="saveprod" data-id="' + p.id + '">Save changes</button></div>' +

      '<div class="two">' +
      '<div>' +
      '<div class="panel"><div class="panel__hd"><h2>Basics</h2></div><div class="panel__bd">' +
      '<div class="afld"><label>Title</label><input data-pf="title" value="' + U.esc(p.title) + '"></div>' +
      '<div class="afld"><label>Description</label><textarea data-pf="desc" rows="4">' + U.esc(p.desc) + '</textarea></div>' +
      '<div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div class="afld"><label>Price (USD)</label><input data-pf="price" type="number" step="1" value="' + p.price + '"></div>' +
      '<div class="afld"><label>Compare at</label><input data-pf="compareAt" type="number" step="1" value="' + (p.compareAt || '') + '"></div>' +
      '</div>' +
      '<div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div class="afld"><label>Unit cost</label><input data-pf="cost" type="number" step="0.1" value="' + p.cost + '"><small>Used for margin on every order</small></div>' +
      '<div class="afld"><label>Primary collection</label><select data-pf="cat">' +
      ['necklaces', 'rings', 'bracelets', 'anklets', 'earrings', 'pearls'].map(function (c) {
        return '<option value="' + c + '"' + (p.cat === c ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="afld"><label>Also in collections</label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      p.collections.map(function (c) {
        var cc = S.coll(c);
        return cc ? '<span class="pill active">' + U.esc(cc.title) + '</span>' : '';
      }).join('') + '</div><small>Collection membership is managed from the Collections screen.</small></div>' +
      '</div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Variants &amp; stock</h2></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>SKU</th><th>Finish</th><th class="num">Price</th><th class="num">On hand</th><th></th></tr></thead><tbody>' +
      p.variants.map(function (v, i) {
        return '<tr><td class="mono">' + U.esc(v.sku) + '</td><td>' + U.esc(v.metal) + '</td>' +
          '<td class="num">' + U.money(v.price) + '</td>' +
          '<td class="num"><input data-vstock="' + i + '" type="number" value="' + v.stock + '" style="width:66px;padding:4px 7px;border:1px solid var(--line-2);text-align:right;font-size:11.5px"></td>' +
          '<td style="text-align:right;color:var(--muted);font-size:10px">' + (v.stock <= 8 ? 'Low' : 'OK') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>' +

      '<div>' +
      '<div class="panel"><div class="panel__hd"><h2>Images</h2><span class="sub">' + p.images.length + ' of 6</span></div>' +
      '<div class="panel__bd"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
      p.images.map(function (src, i) {
        return '<div style="position:relative"><img src="' + src + '" style="aspect-ratio:4/5;object-fit:cover;width:100%" alt="">' +
          '<span style="position:absolute;top:4px;left:4px;background:var(--cream);font-size:8px;padding:1px 4px">' + (i === 0 ? 'Main' : i + 1) + '</span></div>';
      }).join('') +
      '<div style="aspect-ratio:4/5;border:1px dashed var(--line-2);display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--muted-2)">+</div>' +
      '</div></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Visibility</h2></div><div class="panel__bd">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0">' +
      '<span style="font-size:11.5px">Active on storefront</span>' +
      '<span class="toggle ' + (p.active ? 'on' : '') + '" data-act="togactive" data-id="' + p.id + '"></span></div>' +
      '<div style="font-size:10.5px;color:var(--muted);margin-top:6px">Draft products are hidden from collections, search and the sitemap.</div></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>30-day performance</h2></div><div class="panel__bd">' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:5px 0"><span style="color:var(--muted)">Units sold</span><b>' + p.sold30 + '</b></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:5px 0"><span style="color:var(--muted)">Reviews</span><b>' + p.reviewCount + ' · ' + p.rating + '★</b></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:5px 0"><span style="color:var(--muted)">Gross margin</span><b>' + ((1 - p.cost / p.price) * 100).toFixed(0) + '%</b></div>' +
      '</div></div></div></div>';
  }

  /* ---------------- Inventory ---------------- */
  function inventory() {
    var list = db().products.slice().sort(function (a, b) { return S.totalStock(a) - S.totalStock(b); });
    var total = list.reduce(function (a, p) { return a + S.totalStock(p); }, 0);
    var low = list.reduce(function (a, p) {
      return a + p.variants.filter(function (v) { return v.stock > 0 && v.stock <= 8; }).length;
    }, 0);
    var out = list.reduce(function (a, p) {
      return a + p.variants.filter(function (v) { return v.stock === 0; }).length;
    }, 0);

    return '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi"><span>Units on hand</span><b>' + total + '</b><em>Across ' + list.length + ' products</em></div>' +
      '<div class="kpi"><span>Low stock SKUs</span><b>' + low + '</b><em class="dn">1–8 units left</em></div>' +
      '<div class="kpi"><span>Sold out SKUs</span><b>' + out + '</b><em class="dn">Needs restock</em></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Stock by SKU</h2>' +
      '<span class="sub">Edit a number and press Enter to save</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Product</th><th>SKU</th><th>Finish</th><th class="num">On hand</th><th class="num">Sold 30d</th><th>Cover</th><th></th></tr></thead><tbody>' +
      list.map(function (p) {
        return p.variants.map(function (v, vi) {
          var days = p.sold30 > 0 ? Math.round(v.stock / (p.sold30 / p.variants.length / 30)) : 999;
          return '<tr><td>' + (vi === 0 ? '<b style="font-weight:500;font-size:11.5px">' + U.esc(p.title) + '</b>' : '') + '</td>' +
            '<td class="mono">' + U.esc(v.sku) + '</td><td style="font-size:11px">' + U.esc(v.metal) + '</td>' +
            '<td class="num"><input data-inv="' + p.id + '|' + v.sku + '" type="number" value="' + v.stock +
            '" style="width:64px;padding:4px 6px;border:1px solid ' + (v.stock <= 8 ? 'var(--amber)' : 'var(--line-2)') + ';text-align:right;font-size:11.5px"></td>' +
            '<td class="num" style="color:var(--muted)">' + p.sold30 + '</td>' +
            '<td style="font-size:10.5px;color:' + (days < 14 ? 'var(--clay)' : 'var(--muted)') + '">' +
            (days === 999 ? '—' : days + ' days') + '</td>' +
            '<td style="text-align:right"><button class="abtn sm" data-act="restock" data-id="' + p.id + '" data-sku="' + v.sku + '">Restock +20</button></td></tr>';
        }).join('');
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------------- Collections ---------------- */
  function collections() {
    var nav = db().collections.filter(function (c) { return c.nav && c.level === 1; });
    var sub = db().collections.filter(function (c) { return c.level === 2; });

    return '<div class="panel"><div class="panel__hd"><h2>Navigation collections</h2>' +
      '<span class="sub">These 11 items build the storefront header, in this order</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th style="width:40px">#</th><th>Collection</th><th>Handle</th><th class="num">Products</th><th>In nav</th><th></th></tr></thead><tbody>' +
      ui.navItems().map(function (c, i) {
        return '<tr><td style="color:var(--muted)">' + String(i + 1).padStart(2, '0') + '</td>' +
          '<td><b style="font-weight:500;font-size:11.5px">' + U.esc(c.title) + '</b></td>' +
          '<td class="mono">/collections/' + U.esc(c.handle) + '</td>' +
          '<td class="num">' + S.productsIn(c.handle).length + '</td>' +
          '<td><span class="toggle on"></span></td>' +
          '<td style="text-align:right"><button class="abtn sm">Edit</button></td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Sub-collections</h2>' +
      '<span class="sub">' + sub.length + ' nested collections used inside mega menu and filters</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Collection</th><th>Parent</th><th>Menu group</th><th class="num">Products</th></tr></thead><tbody>' +
      sub.slice(0, 18).map(function (c) {
        return '<tr><td>' + U.esc(c.title) + '</td><td class="mono">' + U.esc(c.parent || '—') + '</td>' +
          '<td style="font-size:11px;color:var(--muted)">' + U.esc(c.menuGroup || '—') + '</td>' +
          '<td class="num">' + S.productsIn(c.handle).length + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------------- Marketing ---------------- */
  function marketing() {
    var cs = db().coupons;
    var active = cs.filter(function (c) { return c.status === 'active'; }).length;
    var used = cs.reduce(function (a, c) { return a + c.used; }, 0);

    return '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi"><span>Active codes</span><b>' + active + '</b><em>of ' + cs.length + ' total</em></div>' +
      '<div class="kpi"><span>Redemptions</span><b>' + used + '</b><em>All time</em></div>' +
      '<div class="kpi"><span>Gift threshold</span><b>' + U.money0(db().giftRule.threshold) + '</b><em>' + U.esc(db().giftRule.name) + '</em></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Discount codes</h2>' +
      '<span class="sub">Percent, fixed amount, or free shipping</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Code</th><th>Type</th><th class="num">Value</th><th class="num">Min spend</th><th>Window</th><th class="num">Used</th><th>Status</th><th></th></tr></thead><tbody>' +
      cs.map(function (c) {
        return '<tr><td><b class="mono" style="font-size:11.5px;color:var(--ink)">' + U.esc(c.code) + '</b>' +
          '<div style="font-size:10px;color:var(--muted)">' + U.esc(c.note) + '</div></td>' +
          '<td style="font-size:11px">' + (c.type === 'percent' ? 'Percent off' : 'Fixed amount') + '</td>' +
          '<td class="num">' + (c.type === 'percent' ? c.value + '%' : U.money0(c.value)) + '</td>' +
          '<td class="num">' + (c.minSubtotal ? U.money0(c.minSubtotal) : '—') + '</td>' +
          '<td style="font-size:10.5px;color:var(--muted)">' + c.startsAt.slice(5) + ' → ' + c.endsAt.slice(5) + '</td>' +
          '<td class="num">' + c.used + ' / ' + c.limit + '</td>' +
          '<td><span class="pill ' + c.status + '">' + c.status + '</span></td>' +
          '<td style="text-align:right"><button class="abtn sm danger" data-act="delcoupon" data-code="' + U.esc(c.code) + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="panel__bd" style="border-top:1px solid var(--line)">' +
      '<form data-act="newcoupon" style="display:flex;gap:9px;align-items:flex-end;flex-wrap:wrap">' +
      '<div class="afld" style="margin:0;width:150px"><label>Code</label><input name="code" placeholder="NEWYEAR" style="text-transform:uppercase"></div>' +
      '<div class="afld" style="margin:0;width:110px"><label>Type</label><select name="type"><option value="percent">Percent</option><option value="fixed">Fixed $</option></select></div>' +
      '<div class="afld" style="margin:0;width:90px"><label>Value</label><input name="value" type="number" value="10" style="text-align:right"></div>' +
      '<div class="afld" style="margin:0;width:110px"><label>Min spend</label><input name="min" type="number" value="0" style="text-align:right"></div>' +
      '<div class="afld" style="margin:0;width:110px"><label>Limit</label><input name="limit" type="number" value="200" style="text-align:right"></div>' +
      '<button class="abtn solid" type="submit">Create code</button></form></div></div>' +

      '<div class="two-eq">' +
      '<div class="panel"><div class="panel__hd"><h2>Automatic promotions</h2></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Rule</th><th>Scope</th><th>Status</th></tr></thead><tbody>' +
      db().promotions.map(function (p) {
        return '<tr><td><b style="font-weight:500;font-size:11.5px">' + U.esc(p.name) + '</b>' +
          '<div style="font-size:10px;color:var(--muted)">' + (p.startsAt || '—') + ' → ' + (p.endsAt || 'always') + ' · priority ' + p.priority + '</div></td>' +
          '<td style="font-size:10.5px;color:var(--muted)">' + U.esc(p.scope) + '</td>' +
          '<td><span class="pill ' + p.status + '">' + p.status + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Gift with purchase</h2></div><div class="panel__bd">' +
      '<div class="afld"><label>Threshold</label><input value="' + U.money0(db().giftRule.threshold) + '" readonly></div>' +
      '<div class="afld"><label>Gift product</label><input value="' + U.esc(db().giftRule.name) + ' (' + db().giftRule.sku + ')" readonly></div>' +
      '<div class="afld"><label>Retail value shown in cart</label><input value="' + U.money0(db().giftRule.value) + '" readonly></div>' +
      '<p style="font-size:10.5px;color:var(--muted);margin:0">Added automatically to the cart as a $0 line. Hidden when the threshold is not met, and capped at 1 per order.</p>' +
      '</div></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Stacking rules</h2><span class="sub">Applied in this order at checkout</span></div>' +
      '<div class="panel__bd"><div style="display:grid;gap:8px;font-size:11.5px">' +
      ['Automatic discount (collection sale)', 'Discount code', 'Free shipping threshold', 'Gift threshold'].map(function (t, i) {
        return '<div style="display:flex;gap:11px;align-items:center"><span style="width:19px;height:19px;background:var(--sea);color:var(--cream);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9.5px">' + (i + 1) + '</span>' +
          '<span style="flex:1">' + t + '</span><span style="font-size:10px;color:var(--muted)">' + (i === 1 ? 'one code per order' : 'always evaluated') + '</span></div>';
      }).join('') + '</div></div></div>';
  }

  /* ---------------- Reviews ---------------- */
  function reviews() {
    var pending = db().reviews.filter(function (r) { return r.status === 'pending'; });
    var approved = db().reviews.filter(function (r) { return r.status === 'approved'; });
    var avg = approved.length ? (approved.reduce(function (a, r) { return a + r.rating; }, 0) / approved.length).toFixed(2) : '0';

    var pCard = pending.length ? pending.map(function (r) {
      var p = S.product(r.productId);
      return '<div class="panel" style="margin-bottom:12px" data-revcard="' + r.id + '">' +
        '<div class="panel__hd"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<b style="font-size:11.5px">' + U.esc(r.name) + '</b>' +
        '<span class="st" style="color:var(--brass);letter-spacing:2px;font-size:10px">' + U.stars(r.rating) + '</span>' +
        '<span class="sub">' + U.mo(r.monthsOwned) + ' owned</span>' +
        (r.verified ? '<span class="pill active">Verified</span>' : '<span class="pill pending">Unverified</span>') + '</div>' +
        '<span class="sub">' + U.fmtDate(r.createdAt) + '</span></div>' +
        '<div class="panel__bd">' +
        '<div style="display:flex;gap:12px"><img src="' + (p ? p.images[0] : '') + '" style="width:44px;aspect-ratio:4/5;object-fit:cover" alt="">' +
        '<div style="flex:1"><div style="font-size:10.5px;color:var(--muted)">' + U.esc(r.productTitle) + '</div>' +
        '<b style="font-size:12px;display:block;margin:3px 0 5px">' + U.esc(r.title) + '</b>' +
        '<p style="font-size:11.5px;color:var(--ink-2);margin:0">' + U.esc(r.body) + '</p></div></div>' +
        '<div style="display:flex;gap:8px;margin-top:13px">' +
        '<button class="abtn solid" data-act="rev-ok" data-id="' + r.id + '">Approve</button>' +
        '<button class="abtn danger" data-act="rev-reveal" data-id="' + r.id + '">Reject &amp; delete</button>' +
        '<span style="flex:1"></span><span style="font-size:10px;color:var(--muted);align-self:center">Moderation SLA: 24h</span></div>' +
        '<div class="delflow" data-del="' + r.id + '" hidden style="margin-top:12px;padding:13px;background:rgba(180,71,47,.05);border:1px solid rgba(180,71,47,.2)">' +
        '<div style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--clay);margin-bottom:8px">Reason required for 1–2 star removals</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px">' +
        ['Spam or advertising', 'Off-topic / not about the product', 'Abusive language', 'Duplicate review', 'Order not found']
          .map(function (rs, i) {
            return '<span class="chip" style="cursor:pointer;font-size:9.5px" data-act="rev-pick" data-id="' + r.id + '" data-rs="' + rs + '">' + rs + '</span>';
          }).join('') + '</div>' +
        '<div style="display:flex;gap:8px"><button class="abtn danger" data-act="rev-del" data-id="' + r.id + '">Confirm delete</button>' +
        '<button class="abtn" data-act="rev-cancel" data-id="' + r.id + '">Cancel</button>' +
        '<span style="font-size:10px;color:var(--muted);align-self:center" data-revnote="' + r.id + '">No reason selected</span></div></div>' +
        '</div></div>';
    }).join('') : '<div class="panel"><div class="panel__bd" style="color:var(--muted);padding:30px;text-align:center">Nothing to moderate. Nice.</div></div>';

    return '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi"><span>Pending</span><b>' + pending.length + '</b><em class="dn">Needs a decision</em></div>' +
      '<div class="kpi"><span>Published</span><b>' + approved.length + '</b><em>Live on product pages</em></div>' +
      '<div class="kpi"><span>Average rating</span><b>' + avg + '</b><em>Published only</em></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Awaiting moderation</h2>' +
      '<span class="sub">Nothing appears on the storefront until approved</span></div></div>' +
      pCard +

      '<div class="panel"><div class="panel__hd"><h2>Published</h2>' +
      '<span class="sub">Deleting here removes it from the storefront immediately</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Rating</th><th>Review</th><th>Product</th><th>Date</th><th></th></tr></thead><tbody>' +
      approved.slice(0, 12).map(function (r) {
        return '<tr><td style="color:var(--brass);letter-spacing:1.5px;font-size:9.5px;white-space:nowrap">' + U.stars(r.rating) + '</td>' +
          '<td><b style="font-weight:500;font-size:11.5px">' + U.esc(r.title) + '</b>' +
          '<div style="font-size:10.5px;color:var(--muted)">' + U.esc(r.name) + ' · ' + U.esc(r.body.slice(0, 62)) + '…</div></td>' +
          '<td style="font-size:10.5px;color:var(--muted)">' + U.esc(r.productTitle) + '</td>' +
          '<td style="font-size:10.5px;color:var(--muted)">' + U.fmtShort(r.createdAt) + '</td>' +
          '<td style="text-align:right"><button class="abtn sm danger" data-act="rev-rm" data-id="' + r.id + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------------- Custom requests ---------------- */
  function custom() {
    var list = db().customRequests;
    var ST = { new: 'New', quoted: 'Quoted', in_progress: 'In progress', done: 'Done' };

    return '<div class="panel"><div class="panel__hd"><h2>Custom requests</h2>' +
      '<span class="sub">' + list.filter(function (c) { return c.status === 'new'; }).length + ' unanswered</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Ref</th><th>Customer</th><th>Request</th><th class="num">Qty</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.map(function (c) {
        return '<tr><td class="mono">' + U.esc(c.id) + '</td>' +
          '<td><b style="font-weight:500;font-size:11.5px">' + U.esc(c.name) + '</b><div class="mono">' + U.esc(c.email) + '</div></td>' +
          '<td style="font-size:11px">' + U.esc(c.type) + '<div style="font-size:10px;color:var(--muted)">' + U.esc(c.note) + '</div></td>' +
          '<td class="num">' + c.qty + '</td><td style="font-size:10.5px;color:var(--muted)">' + c.due + '</td>' +
          '<td><span class="pill ' + (c.status === 'new' ? 'paid' : c.status === 'done' ? 'completed' : 'fulfilling') + '">' + ST[c.status] + '</span></td>' +
          '<td style="text-align:right"><button class="abtn sm" data-act="cr-next" data-id="' + c.id + '">Advance</button></td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="two-eq"><div class="panel"><div class="panel__hd"><h2>How a request flows</h2></div><div class="panel__bd">' +
      '<div style="display:grid;gap:9px;font-size:11.5px">' +
      ['New — customer submitted from the storefront', 'Quoted — you replied with price and lead time', 'In progress — deposit paid, production started', 'Done — converted to an order and shipped']
        .map(function (t, i) {
          return '<div style="display:flex;gap:11px;align-items:center"><span style="width:19px;height:19px;background:var(--sea);color:var(--cream);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9.5px">' + (i + 1) + '</span><span>' + t + '</span></div>';
        }).join('') + '</div></div></div>' +
      '<div class="panel"><div class="panel__hd"><h2>Capacity</h2></div><div class="panel__bd">' +
      hbars([{ l: 'Open requests', v: list.filter(function (c) { return c.status !== 'done'; }).length, c: 'var(--brass)' },
      { l: 'Units committed', v: list.reduce(function (a, c) { return a + c.qty; }, 0), c: 'var(--sea)' },
      { l: 'Monthly capacity', v: 40, c: 'var(--sand-d)' }]) +
      '<p style="font-size:10.5px;color:var(--muted);margin:12px 0 0">Custom work is capped at 40 units a month so it never delays stock orders.</p>' +
      '</div></div></div>';
  }

  /* ---------------- Customers ---------------- */
  function customers() {
    var list = db().customers.slice().sort(function (a, b) { return b.spent - a.spent; });
    var repeat = list.filter(function (c) { return c.orders > 1; }).length;
    var rate = list.length ? repeat / list.length * 100 : 0;

    return '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi"><span>Customers</span><b>' + list.length + '</b><em>Identified by email</em></div>' +
      '<div class="kpi"><span>Repeat rate</span><b>' + rate.toFixed(1) + '%</b><em>' + repeat + ' bought twice or more</em></div>' +
      '<div class="kpi"><span>Lifetime value</span><b>' + U.money(list.reduce(function (a, c) { return a + c.spent; }, 0) / (list.length || 1)) + '</b><em>Average per customer</em></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Customer list</h2><span class="sub">Aggregated from orders — no account system</span></div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr>' +
      '<th>Customer</th><th>Tier</th><th class="num">Orders</th><th class="num">Spent</th><th>First order</th><th>Last order</th></tr></thead><tbody>' +
      list.map(function (c) {
        return '<tr><td><b style="font-weight:500;font-size:11.5px">' + U.esc(c.name) + '</b><div class="mono">' + U.esc(c.email) + '</div></td>' +
          '<td><span class="pill ' + c.tier.toLowerCase() + '">' + c.tier + '</span></td>' +
          '<td class="num">' + c.orders + '</td><td class="num" style="font-weight:600">' + U.money(c.spent) + '</td>' +
          '<td style="font-size:10.5px;color:var(--muted)">' + U.fmtShort(c.first) + '</td>' +
          '<td style="font-size:10.5px;color:var(--muted)">' + U.fmtShort(c.last) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------------- Content ---------------- */
  function content() {
    var c = (db().settings.content) || {};
    var blocks = [
      { k: 'announce', l: 'Announcement bar', v: c.announce || '', hint: 'Separate items with · — the storefront loops through each one' },
      { k: 'heroEyebrow', l: 'Hero eyebrow', v: c.heroEyebrow || '' },
      { k: 'heroTitle', l: 'Hero headline', v: c.heroTitle || '', hint: 'Use | to split into two lines — the second line renders in italic' },
      { k: 'heroBody', l: 'Hero paragraph', v: c.heroBody || '', multiline: true }
    ];
    return '<div class="two">' +
      '<div class="panel"><div class="panel__hd"><h2>Homepage blocks</h2><span class="sub">Changes apply on next page load</span></div>' +
      '<div class="panel__bd">' + blocks.map(function (b) {
        var ctrl = b.multiline
          ? '<textarea data-ck="' + b.k + '" rows="3" style="width:100%;padding:9px 11px;border:1px solid var(--line);background:#fff;font:inherit;font-size:12px;line-height:1.5;color:var(--ink);resize:vertical">' + U.esc(b.v) + '</textarea>'
          : '<input data-ck="' + b.k + '" value="' + U.esc(b.v) + '">';
        return '<div class="afld"><label>' + b.l + '</label>' + ctrl +
          (b.hint ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">' + b.hint + '</div>' : '') + '</div>';
      }).join('') +
      '<button class="abtn solid" data-act="savetext">Save content</button></div></div>' +

      '<div><div class="panel"><div class="panel__hd"><h2>Content pages</h2></div><div class="panel__bd flush">' +
      '<table class="atable"><tbody>' +
      Object.keys(window.Store.PAGES).map(function (k) {
        return '<tr><td><b style="font-weight:500;font-size:11.5px">' + window.Store.PAGES[k].title + '</b>' +
          '<div class="mono">/pages/' + k + '</div></td>' +
          '<td style="text-align:right"><a class="abtn sm" href="#/pages/' + k + '">View</a></td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Subscription list</h2></div><div class="panel__bd">' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:5px 0"><span style="color:var(--muted)">Total subscribers</span><b>1,284</b></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:5px 0"><span style="color:var(--muted)">Last 30 days</span><b>+96</b></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:5px 0"><span style="color:var(--muted)">Welcome flow</span><b>Active</b></div>' +
      '<button class="abtn" style="margin-top:10px">Export CSV</button></div></div></div></div>';
  }

  /* ---------------- Settings ---------------- */
  function settings() {
    var s = db().settings;
    return '<div class="two">' +
      '<div><div class="panel"><div class="panel__hd"><h2>Store</h2></div><div class="panel__bd">' +
      '<div class="afld"><label>Brand name</label><input value="' + U.esc(s.brand) + '"></div>' +
      '<div class="afld"><label>Tagline</label><input value="' + U.esc(s.tagline) + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div class="afld"><label>Currency</label><input value="' + s.currency + '" readonly></div>' +
      '<div class="afld"><label>Free shipping over</label><input data-set="freeShip" type="number" value="' + s.freeShip + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div class="afld"><label>Standard shipping</label><input data-set="standardShip" type="number" step="0.1" value="' + s.standardShip + '"></div>' +
      '<div class="afld"><label>Express shipping</label><input data-set="expressShip" type="number" step="0.1" value="' + s.expressShip + '"></div>' +
      '</div></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Cost model</h2><span class="sub">Drives every margin number</span></div>' +
      '<div class="panel__bd">' +
      '<div class="afld inline"><label>Import duty %</label><input data-cost="duty" type="number" step="0.1" value="' + s.costs.duty + '"></div>' +
      '<div class="afld inline"><label>First-leg freight %</label><input data-cost="freight" type="number" step="0.1" value="' + s.costs.freight + '"></div>' +
      '<div class="afld inline"><label>Fulfilment per order $</label><input data-cost="fulfillment" type="number" step="0.1" value="' + s.costs.fulfillment + '"></div>' +
      '<div class="afld inline"><label>Payment %</label><input data-cost="payment" type="number" step="0.1" value="' + s.costs.payment + '"></div>' +
      '<div class="afld inline"><label>Payment fixed $</label><input data-cost="paymentFixed" type="number" step="0.05" value="' + s.costs.paymentFixed + '"></div>' +
      '<div class="afld inline"><label>Packaging $</label><input data-cost="packaging" type="number" step="0.05" value="' + s.costs.packaging + '"></div>' +
      '<div class="afld inline"><label>Returns reserve %</label><input data-cost="returns" type="number" step="0.1" value="' + s.costs.returns + '"></div>' +
      '<div class="afld inline"><label>Colour guarantee reserve %</label><input data-cost="colourReserve" type="number" step="0.1" value="' + s.costs.colourReserve + '"></div>' +
      '<button class="abtn solid" data-act="saveset" style="margin-top:8px">Save settings</button>' +
      '<p style="font-size:10px;color:var(--muted);margin:10px 0 0">New orders use these rates. Existing orders keep the snapshot taken at checkout.</p>' +
      '</div></div></div>' +

      '<div><div class="panel"><div class="panel__hd"><h2>Margin at three price points</h2></div><div class="panel__bd">' +
      [58, 88, 143].map(function (pr) {
        var c = s.costs;
        var goods = pr * 0.12;
        var cost = goods + pr * c.duty / 100 + pr * c.freight / 100 + c.fulfillment + pr * c.payment / 100 + c.paymentFixed + c.packaging + pr * c.returns / 100 + pr * c.colourReserve / 100;
        var m = (pr - cost) / pr * 100;
        return '<div style="padding:9px 0;border-bottom:1px dotted var(--line)">' +
          '<div style="display:flex;justify-content:space-between;font-size:11.5px"><span>' + U.money0(pr) + ' piece</span>' +
          '<b>' + m.toFixed(1) + '%</b></div>' +
          '<div style="height:4px;background:var(--line);margin-top:5px"><div style="height:100%;width:' + m + '%;background:' + (m > 45 ? 'var(--olive)' : 'var(--amber)') + '"></div></div></div>';
      }).join('') + '</div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Danger zone</h2></div><div class="panel__bd">' +
      '<p style="font-size:11px;color:var(--muted);margin-bottom:12px">This prototype keeps its data in your browser. Resetting restores the original seed data — every order you placed and every edit you made is discarded.</p>' +
      '<button class="abtn danger" data-act="reset">Reset prototype data</button></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Session</h2></div><div class="panel__bd">' +
      '<div style="font-size:11.5px;color:var(--muted);line-height:1.9">Signed in as <b style="color:var(--ink)">owner@tideglass.co</b><br>' +
      'Role: owner (full access)<br>Session: 24 hours</div>' +
      '<button class="abtn" style="margin-top:12px" data-act="logout">Sign out</button></div></div></div></div>';
  }

  /* ---------------- 路由分发 ---------------- */
  var TITLES = {
    '': 'Dashboard', orders: 'Orders', products: 'Products', inventory: 'Inventory',
    collections: 'Collections', marketing: 'Marketing', reviews: 'Reviews',
    custom: 'Custom requests', customers: 'Customers', content: 'Content', settings: 'Settings'
  };

  function render(r) {
    if (!S.state.admin) return login();
    var sec = r.seg[1] || '';
    var body, title = TITLES[sec] || 'Dashboard';
    switch (sec) {
      case '': body = dashboard(); break;
      case 'orders': body = orders(r); if (r.seg[2]) title = 'Order ' + decodeURIComponent(r.seg[2]); break;
      case 'products': body = products(r); if (r.seg[2]) title = 'Edit product'; break;
      case 'inventory': body = inventory(); break;
      case 'collections': body = collections(); break;
      case 'marketing': body = marketing(); break;
      case 'reviews': body = reviews(); break;
      case 'custom': body = custom(); break;
      case 'customers': body = customers(); break;
      case 'content': body = content(); break;
      case 'settings': body = settings(); break;
      default: body = '<div class="panel"><div class="panel__bd">Unknown section.</div></div>';
    }
    return ui.adminShell(body, sec, title);
  }

  window.Admin = { render: render, summary: summary, series: series };
})();
