/* ============================================================
   TIDEGLASS Admin · 后台视图（独立 SPA，只通过 API 读写）
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
    { g: 'System', items: [['content', 'Content'], ['ledger', 'Stock ledger'], ['audit', 'Audit log'], ['settings', 'Settings']] },
  ];

  function shell(body, active, title, staff) {
    var nav = NAV.map(function (grp) {
      return '<div class="adm__grp">' + grp.g + '</div>' + grp.items.map(function (it) {
        var href = '#/admin' + (it[0] ? '/' + it[0] : '');
        var on = (active || '') === it[0] ? ' class="on"' : '';
        return '<a href="' + href + '"' + on + '>' + it[1] + '</a>';
      }).join('');
    }).join('');

    var who = staff ? (staff.name || staff.email).split(' ')[0] : '—';
    return '<div class="adm">' +
      '<aside class="adm__side"><div class="adm__brand"><span>TIDEGLASS<em>Admin</em></span></div>' +
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
      '<div class="cap"><b>Sea glass doesn\'t fade.</b><span>TIDEGLASS admin</span></div></div>' +
      '<div class="loginwrap__form">' +
      '<a href="#/" class="brand" style="margin-bottom:26px"><span class="brand__mark">' + window.UI.MARK + '</span>' +
      '<span class="brand__word">TIDEGLASS</span></a>' +
      '<h1>Sign in</h1><p>Manage orders, stock and storefront settings.</p>' +
      (msg ? '<div class="falert falert--note">' + U.esc(msg) + '</div>' : '') +
      '<form data-act="login">' +
      '<div class="afld"><label>Email</label><input name="email" value="owner@tideglassjewelry.com" autocomplete="username" required></div>' +
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
    var tabs = [['', 'All'], ['paid', 'Paid'], ['fulfilling', 'Preparing'], ['fulfilled', 'Shipped'], ['refunded', 'Refunded']]
      .map(function (t) {
        var on = (q.status || '') === t[0] ? ' solid' : '';
        return '<a class="abtn' + on + '" href="#/admin/orders' + (t[0] ? '?status=' + t[0] : '') + '">' + t[1] + '</a>';
      }).join('');

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
      '<form class="admsearch" data-act="osearch"><input name="q" placeholder="Search number, email or name" value="' + U.esc(q.q || '') + '"></form></div>' +
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

  function orderDetail(o, transitions) {
    var rows = o.items.map(function (i) {
      return '<tr><td>' + U.esc(i.title) + (i.isGift ? ' <span class="tag">Gift</span>' : '') + '</td>' +
        '<td>' + U.esc(i.variant) + '</td><td>' + U.esc(i.size || '—') + '</td>' +
        '<td class="num">' + i.qty + '</td><td class="num">' + U.money(i.unitPrice) + '</td>' +
        '<td class="num">' + U.money(i.unitPrice * i.qty) + '</td></tr>';
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
      (transitions.indexOf('refunded') >= 0
        ? '<button class="abtn danger" data-act="refund" data-num="' + U.esc(o.number) + '">Refund</button>' : '') +
      '<button class="abtn" data-act="tracking" data-num="' + U.esc(o.number) + '">Add tracking</button>' +
      '</div>' +
      '<div class="panel__bd flush"><table class="atable"><thead><tr><th>Item</th><th>Finish</th><th>Size</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="panel__bd"><div class="srow"><span>Subtotal</span><b>' + U.money(o.subtotal) + '</b></div>' +
      (o.discount ? '<div class="srow"><span>Discount ' + U.esc(o.couponCode || '') + '</span><b>−' + U.money(o.discount) + '</b></div>' : '') +
      '<div class="srow"><span>Shipping · ' + U.esc(o.shippingMethod) + '</span><b>' + U.money(o.shipping) + '</b></div>' +
      '<div class="srow srow--total"><span>Total</span><b>' + U.money(o.total) + '</b></div>' +
      '<p class="sub" style="margin-top:14px">' + U.esc(o.name) + ' · ' + U.esc(o.email) +
      (addrText(o.address) ? '<br>' + U.esc(addrText(o.address)) : '') +
      (o.tracking ? '<br>Tracking ' + U.esc(o.tracking) + (o.carrier ? ' · ' + U.esc(o.carrier) : '') : '') +
      (o.refundedAt ? '<br>Refunded ' + U.fmtDate(o.refundedAt) + ' · stock ' + U.esc(o.restockDecision || '—') : '') +
      (o.payment ? '<br>Payment ' + U.esc(o.payment.provider) + ' · ' + U.esc(o.payment.mode) + ' · •••• ' + U.esc(o.payment.last4 || '') : '') +
      '</p></div></div>';
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
          '<img src="' + U.esc(src) + '" alt="">' +
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

  function settings(s) {
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
      '</form></div></div>';
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
      '<span class="sub">Grouped by lowercased email — no duplicate records</span></div>' +
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
    products: products, inventory: inventory, settings: settings,
    coupons: coupons, reviews: reviews, customers: customers, ledger: ledger, audit: audit,
    collections: collections, collectionEdit: collectionEdit,
    custom: custom, customDetail: customDetail, content: content,
    editorDrawer: editorDrawer, importModal: importModal,
    imageCells: imageCells, variantRows: variantRows, pcatOptions: pcatOptions,
  };
})();
