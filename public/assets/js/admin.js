/* ============================================================
   Wildkind Studio — admin client
   ============================================================ */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');
  const crumb = $('#crumb');
  const TITLES = {
    overview: 'Overview', orders: 'Orders', products: 'Products', inventory: 'Inventory',
    collections: 'Collections', customers: 'Customers', content: 'Storefront', settings: 'Settings',
  };

  const state = { days: 30, route: 'overview', data: {} };

  const money = (n, d) => '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: d ?? (Number.isInteger(n) ? 0 : 2), maximumFractionDigits: 2,
  });
  const pct = (n, d = 1) => (n == null ? '—' : Number(n).toFixed(d) + '%');
  const dt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const dtFull = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  async function api(path, opts = {}) {
    const r = await fetch('/api/admin/' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) { location.href = '/admin'; throw new Error('unauthorised'); }
    return r.json();
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('is-on'), 2200);
  }

  /* ---------------- charts ---------------- */
  function areaChart(series, key, opts = {}) {
    const W = 860, H = opts.height || 220;
    const padL = 54, padR = 14, padT = 16, padB = 28;
    const vals = series.map((d) => d[key]);
    const rawMax = Math.max(1, ...vals);
    const max = rawMax * 1.1;
    const n = series.length;
    const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
    const y = (v) => H - padB - (v / max) * (H - padT - padB);
    const pts = series.map((d, i) => [x(i), y(d[key])]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L${x(n - 1).toFixed(1)} ${H - padB} L${padL} ${H - padB} Z`;
    const ticks = [0, 1, 2, 3, 4].map((i) => Math.round((max / 4) * i));
    const idxs = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="g-${key}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#171512" stop-opacity=".16"/>
        <stop offset="100%" stop-color="#171512" stop-opacity="0"/>
      </linearGradient></defs>
      ${ticks.map((t) => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>
        <text x="${padL - 9}" y="${y(t) + 3}" text-anchor="end">${opts.money ? money(t) : t}</text>`).join('')}
      <path d="${area}" fill="url(#g-${key})"/>
      <path d="${line}" fill="none" stroke="#171512" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.filter((_, i) => i === n - 1).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#171512"/>`).join('')}
      ${idxs.map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${dt(series[i].date)}</text>`).join('')}
    </svg>`;
  }

  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
    const norm = raw / pow;
    const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return Math.max(1, mult * pow);
  }

  function barChart(series, key, opts = {}) {
    const W = 860, H = opts.height || 130;
    const padB = 22, padT = 6;
    const max = Math.max(1, ...series.map((d) => d[key]));
    const bw = (W - 8) / series.length;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${series.map((d, i) => {
        const h = ((H - padB - padT) * d[key]) / max;
        return `<rect x="${(i * bw + bw * .26).toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw * .48).toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" fill="${d[key] ? '#171512' : '#ece5db'}"/>`;
      }).join('')}
      <text x="0" y="${H - 4}">${series.length} days</text>
      <text x="${W}" y="${H - 4}" text-anchor="end">peak ${max} orders</text>
    </svg>`;
  }

  function hbars(items, valueKey, labelKey, opts = {}) {
    const max = Math.max(1, ...items.map((i) => i[valueKey]));
    return items.map((it) => `
      <div style="margin-bottom:11px">
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px">
          <span>${esc(it[labelKey])}</span>
          <span style="color:var(--muted);font-variant-numeric:tabular-nums">${opts.money ? money(it[valueKey]) : it[valueKey]}</span>
        </div>
        <div class="prog"><i style="width:${Math.max(2, (it[valueKey] / max) * 100)}%;background:${opts.color || '#171512'}"></i></div>
      </div>`).join('');
  }

  /* ---------------- views ---------------- */
  async function renderOverview() {
    const s = await api('summary?days=' + state.days);
    state.data.summary = s;
    const targetPct = Math.min(100, (s.revenue / s.monthlyTarget) * 100);
    const coll = Object.entries(s.byCollection).sort((a, b) => b[1].revenue - a[1].revenue);
    const labels = { necklaces: 'Necklaces', rings: 'Rings', bracelets: 'Bracelets', anklets: 'Anklets', earrings: 'Earrings', pearls: 'Pearls', custom: 'Custom', gifts: 'Gifts', other: 'Other' };

    view.innerHTML = `
      <div class="phead">
        <div><h1>Good evening, studio.</h1><p>Last ${s.days} days · live from the production database</p></div>
        <div class="phead__actions">
          <a class="abtn" href="/" target="_blank">View store ↗</a>
          <button class="abtn abtn--primary" data-go="orders">Process orders</button>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi">
          <div class="kpi__label">Revenue</div>
          <div class="kpi__val">${money(s.revenue)}</div>
          <div class="kpi__sub">${s.orders} orders · AOV ${money(s.aov)}</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Contribution profit</div>
          <div class="kpi__val">${money(s.profit)}</div>
          <div class="kpi__sub">margin <b>${pct(s.margin)}</b> after duty, 3PL, fees</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Units sold</div>
          <div class="kpi__val">${s.units}</div>
          <div class="kpi__sub">${s.customers} customers · repeat ${pct(s.repeatRate)}</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Conversion</div>
          <div class="kpi__val">${pct(s.conversion, 2)}</div>
          <div class="kpi__sub">${s.sessions.toLocaleString()} sessions</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Inventory</div>
          <div class="kpi__val">${money(s.inventoryValue)}</div>
          <div class="kpi__sub">${s.unitsOnHand} units · <b>${s.weeksOfCover} wk</b> cover</div>
        </div>
      </div>

      <div class="g2">
        <div class="card">
          <div class="card__head"><h3>Revenue</h3><span class="sub">daily, ${s.days} days</span></div>
          <div class="card__body" style="padding-bottom:10px">${areaChart(s.series, 'revenue', { money: true })}</div>
          <div class="card__body" style="padding-top:0">
            <p style="font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted-2);margin-bottom:9px">Cost breakdown</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 26px;font-size:11.5px">
              ${[
                ['Duty (31%)', s.duty], ['Inbound freight', s.freight],
                ['3PL + last mile', s.fulfillment], ['Payment fees', s.fees],
                ['Packaging', s.packaging], ['Return provision', s.returns],
              ].map(([l, v]) => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #f2ece3;padding:4px 0">
                <span style="color:var(--muted)">${l}</span><span style="font-variant-numeric:tabular-nums">${money(v)}</span>
              </div>`).join('')}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Monthly target</h3><span class="sub">${money(s.monthlyTarget)}</span></div>
          <div class="card__body">
            <div style="display:flex;align-items:baseline;gap:8px">
              <span style="font-family:var(--serif);font-size:30px;letter-spacing:-.02em">${money(s.revenue)}</span>
              <span style="font-size:11.5px;color:var(--muted)">${targetPct.toFixed(1)}%</span>
            </div>
            <div class="prog" style="margin-top:10px"><i style="width:${targetPct}%"></i></div>
            <p style="font-size:11.5px;color:var(--muted);margin-top:10px">${money(Math.max(0, s.monthlyTarget - s.revenue))} to go · ${Math.ceil((s.monthlyTarget - s.revenue) / Math.max(1, s.aov))} orders at current AOV</p>
            <div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px">
              <p style="font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted-2);margin-bottom:10px">Open work</p>
              <div class="rows">
                <div class="row" style="padding:7px 0"><div class="row__main"><div class="row__title">Awaiting fulfilment</div></div><span class="row__val">${s.openOrders}</span></div>
                <div class="row" style="padding:7px 0"><div class="row__main"><div class="row__title">Refunds</div><div class="row__meta">${pct(s.refundRate)} of orders</div></div><span class="row__val">${s.refunds}</span></div>
                <div class="row" style="padding:7px 0"><div class="row__main"><div class="row__title">SKUs below 20 units</div></div><span class="row__val">${s.lowStock.length}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="g2even">
        <div class="card">
          <div class="card__head"><h3>Sales by category</h3><span class="sub">last ${s.days}d</span></div>
          <div class="card__body">${hbars(coll.map(([k, v]) => ({ label: labels[k] || k, revenue: v.revenue })), 'revenue', 'label', { money: true })}</div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Top products</h3><span class="sub">by revenue</span></div>
          <div class="card__body" style="padding-top:6px">
            <div class="rows">
              ${s.topProducts.map((p) => `
                <div class="row">
                  <img class="thumb" src="${p.image}" alt="">
                  <div class="row__main"><div class="row__title">${esc(p.title)}</div><div class="row__meta">${p.units} units · ${p.id}</div></div>
                  <span class="row__val">${money(p.revenue)}</span>
                </div>`).join('') || '<div class="aempty">No sales yet</div>'}
            </div>
          </div>
        </div>
      </div>

      <div class="g2even">
        <div class="card">
          <div class="card__head"><h3>Orders per day</h3><span class="sub">${s.days}d</span></div>
          <div class="card__body">${barChart(s.series, 'orders')}</div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Restock alerts</h3><span class="sub">below 20 units</span></div>
          <div class="card__body" style="padding-top:6px">
            <div class="rows">
              ${s.lowStock.slice(0, 5).map((p) => `
                <div class="row">
                  <img class="thumb" src="${p.image}" alt="">
                  <div class="row__main"><div class="row__title">${esc(p.title)}</div><div class="row__meta">${p.id} · ${esc(p.collections[0])}</div></div>
                  <span class="badge ${p.stock === 0 ? 'badge--out' : 'badge--low'}">${p.stock} left</span>
                </div>`).join('') || '<div class="aempty">Stock is healthy</div>'}
            </div>
          </div>
        </div>
      </div>`;
  }

  async function renderOrders() {
    const { orders } = await api('orders');
    state.data.orders = orders;
    const filter = state.orderFilter || 'all';
    const list = (filter === 'all' ? orders : orders.filter((o) => o.status === filter))
      .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const counts = ['all', 'paid', 'fulfilling', 'fulfilled', 'refunded'].map((k) => ({
      k, n: k === 'all' ? orders.length : orders.filter((o) => o.status === k).length,
    }));

    view.innerHTML = `
      <div class="phead">
        <div><h1>Orders</h1><p>${orders.length} orders · ${money(orders.filter((o) => ['paid', 'fulfilled'].includes(o.status)).reduce((s, o) => s + o.total, 0))} lifetime</p></div>
        <div class="phead__actions"><button class="abtn" onclick="window.print()">Export</button></div>
      </div>
      <div class="toolbar2">
        <div class="seg">
          ${counts.map((c) => `<button data-ofilter="${c.k}" class="${filter === c.k ? 'is-on' : ''}">${c.k === 'all' ? 'All' : c.k[0].toUpperCase() + c.k.slice(1)} ${c.n}</button>`).join('')}
        </div>
        <div class="searchbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>
          <input placeholder="Search order, name or email" data-ordersearch value="${esc(state.orderQ || '')}">
        </div>
      </div>
      <div class="card">
        <table class="tbl">
          <thead><tr>
            <th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Channel</th>
            <th class="num">Total</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${list.filter((o) => !state.orderQ || (o.number + o.customer.name + o.customer.email).toLowerCase().includes(state.orderQ.toLowerCase()))
              .slice(0, 60).map((o) => `
              <tr data-order="${o.id}">
                <td class="mono"><a class="link" href="#" data-order="${o.id}">${esc(o.number)}</a></td>
                <td style="color:var(--muted)">${dtFull(o.createdAt)}</td>
                <td><div>${esc(o.customer.name)}</div><div style="font-size:11px;color:var(--muted-2)">${esc(o.customer.city)}, ${esc(o.customer.country)}</div></td>
                <td style="color:var(--muted)">${o.items.reduce((s, i) => s + i.qty, 0)}</td>
                <td style="color:var(--muted)">${esc(o.channel)}</td>
                <td class="num mono">${money(o.total)}</td>
                <td><span class="badge badge--${esc(o.status)}">${esc(o.status)}</span></td>
                <td style="text-align:right"><button class="abtn abtn--sm" data-order="${o.id}">View</button></td>
              </tr>`).join('') || '<tr><td colspan="8" class="aempty">No orders match</td></tr>'}
          </tbody>
        </table>
      </div>
      <p style="font-size:11px;color:var(--muted-2);margin-top:10px">Showing first 60 of ${list.length}. Data is written to <code>data/db.json</code>.</p>`;
  }

  function orderModal(id) {
    const o = (state.data.orders || []).find((x) => x.id === id);
    if (!o) return;
    const flows = { paid: ['fulfilling', 'refunded'], fulfilling: ['fulfilled', 'refunded'], fulfilled: ['refunded'], refunded: ['paid'] };
    const nexts = flows[o.status] || [];
    $('#modal-box').innerHTML = `
      <div class="modal__head">
        <div><h3>${esc(o.number)}</h3><div style="font-size:11.5px;color:var(--muted);margin-top:2px">${dtFull(o.createdAt)} · ${esc(o.channel)}</div></div>
        <button class="abtn abtn--sm" data-close>Close</button>
      </div>
      <div class="modal__body">
        <div class="g2even" style="margin-bottom:16px">
          <div>
            <p style="font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted-2);margin-bottom:6px">Customer</p>
            <p style="font-size:13px">${esc(o.customer.name)}</p>
            <p style="font-size:12px;color:var(--muted)">${esc(o.customer.email)}</p>
            <p style="font-size:12px;color:var(--muted)">${esc(o.customer.city)}, ${esc(o.customer.state)} ${esc(o.customer.country)}</p>
          </div>
          <div>
            <p style="font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted-2);margin-bottom:6px">Status</p>
            <span class="badge badge--${esc(o.status)}">${esc(o.status)}</span>
            ${o.tracking ? `<p style="font-size:11.5px;color:var(--muted);margin-top:6px">Tracking ${esc(o.tracking)}</p>` : ''}
          </div>
        </div>
        <table class="tbl" style="border:1px solid var(--line)">
          <thead><tr><th>Item</th><th>Variant</th><th class="num">Qty</th><th class="num">Price</th></tr></thead>
          <tbody>
            ${o.items.map((i) => `<tr><td>${esc(i.title)}</td><td style="color:var(--muted)">${esc(i.variant)} · ${esc(i.size)}</td><td class="num">${i.qty}</td><td class="num mono">${money(i.price * i.qty)}</td></tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:14px;font-size:12.5px">
          <div style="display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)"><span>Shipping</span><span>${o.shipping ? money(o.shipping) : 'Free'}</span></div>
          ${o.discount ? `<div style="display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)"><span>Discount</span><span>−${money(o.discount)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:9px 0 0;margin-top:6px;border-top:1px solid var(--line);font-size:15px"><span>Total</span><strong>${money(o.total)}</strong></div>
        </div>
      </div>
      <div class="modal__foot">
        ${nexts.map((n) => `<button class="abtn ${n === 'refunded' ? 'abtn--danger' : 'abtn--primary'}" data-flow="${o.id}:${n}">Mark ${n}</button>`).join('')}
      </div>`;
    $('#modal').hidden = false;
  }

  async function renderProducts() {
    const { products, collections } = await api('products');
    state.data.products = products;
    state.data.collections = collections;
    const q = (state.productQ || '').toLowerCase();
    const list = products.filter((p) => !q || (p.title + p.id).toLowerCase().includes(q));

    view.innerHTML = `
      <div class="phead">
        <div><h1>Products</h1><p>${products.length} SKUs · ${products.filter((p) => p.stock === 0).length} out of stock</p></div>
        <div class="phead__actions"><button class="abtn abtn--primary" data-newproduct>New product</button></div>
      </div>
      <div class="toolbar2">
        <div class="searchbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>
          <input placeholder="Search title or SKU" data-productsearch value="${esc(state.productQ || '')}">
        </div>
        <span style="font-size:11.5px;color:var(--muted-2)">${list.length} shown</span>
      </div>
      <div class="card">
        <table class="tbl">
          <thead><tr><th style="width:52px"></th><th>Product</th><th>SKU</th><th>Collections</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${list.map((p) => `
              <tr>
                <td><img class="thumb" src="${p.image}" alt=""></td>
                <td><div style="font-weight:500">${esc(p.title)}</div><div style="font-size:11px;color:var(--muted-2)">${esc(p.motif)} · ${p.metals.join(' / ')}</div></td>
                <td class="mono" style="color:var(--muted)">${esc(p.id)}</td>
                <td style="color:var(--muted);font-size:11.5px">${p.collections.slice(0, 2).map(esc).join(', ')}${p.collections.length > 2 ? ' +' + (p.collections.length - 2) : ''}</td>
                <td class="num mono">${money(p.price)}${p.compareAt ? `<br><s style="color:var(--muted-2);font-size:10.5px">${money(p.compareAt)}</s>` : ''}</td>
                <td class="num"><span class="badge ${p.stock === 0 ? 'badge--out' : p.stock <= 20 ? 'badge--low' : ''}">${p.stock}</span></td>
                <td><span class="badge badge--${p.status === 'active' ? 'active' : 'draft'}">${p.status}</span></td>
                <td style="text-align:right"><button class="abtn abtn--sm" data-edit="${p.id}">Edit</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function productModal(id) {
    const p = (state.data.products || []).find((x) => x.id === id);
    if (!p) return;
    $('#modal-box').innerHTML = `
      <div class="modal__head"><h3>${esc(p.title)}</h3><button class="abtn abtn--sm" data-close>Close</button></div>
      <div class="modal__body">
        <div style="display:flex;gap:14px;margin-bottom:16px">
          <img src="${p.image}" alt="" style="width:92px;height:92px;object-fit:cover;border:1px solid var(--line)">
          <div style="font-size:11.5px;color:var(--muted);line-height:1.7">
            <div>SKU <b style="color:var(--ink)">${esc(p.id)}</b></div>
            <div>Handle <code>${esc(p.handle)}</code></div>
            <div>Cost ${money(p.cost)} · margin at list ${pct(((p.price - p.cost) / p.price) * 100)}</div>
            <div>Created ${dtFull(p.createdAt)}</div>
          </div>
        </div>
        <form data-pform data-id="${p.id}">
          <div class="f"><label>Title</label><input name="title" value="${esc(p.title)}"></div>
          <div class="frow">
            <div class="f"><label>Price</label><input name="price" type="number" step="1" value="${p.price}"></div>
            <div class="f"><label>Compare at</label><input name="compareAt" type="number" step="1" value="${p.compareAt || ''}"></div>
          </div>
          <div class="frow">
            <div class="f"><label>Stock</label><input name="stock" type="number" value="${p.stock}"></div>
            <div class="f"><label>Badge</label><input name="badge" value="${esc(p.badge || '')}" placeholder="e.g. Best Seller"></div>
          </div>
          <div class="frow">
            <div class="f"><label>Status</label>
              <select name="status"><option value="active"${p.status === 'active' ? ' selected' : ''}>Active</option><option value="draft"${p.status === 'draft' ? ' selected' : ''}>Draft</option></select>
            </div>
            <div class="f"><label>Featured on home</label>
              <select name="featured"><option value="1"${p.featured ? ' selected' : ''}>Yes</option><option value="0"${!p.featured ? ' selected' : ''}>No</option></select>
            </div>
          </div>
          <div class="f"><label>Description</label><textarea name="desc">${esc(p.desc)}</textarea></div>
        </form>
      </div>
      <div class="modal__foot">
        <a class="abtn" href="/products/${p.handle}" target="_blank">View on site ↗</a>
        <button class="abtn abtn--primary" data-saveproduct="${p.id}">Save changes</button>
      </div>`;
    $('#modal').hidden = false;
  }

  async function renderInventory() {
    const d = await api('inventory');
    state.data.inv = d;
    view.innerHTML = `
      <div class="phead"><div><h1>Inventory</h1><p>Portland 3PL · restock lead time 3 weeks from Shenzhen</p></div>
        <div class="phead__actions"><button class="abtn" data-go="products">Edit stock</button></div></div>
      <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi"><div class="kpi__label">Stock value at cost</div><div class="kpi__val">${money(d.inventoryValue)}</div><div class="kpi__sub">${d.unitsOnHand} units on hand</div></div>
        <div class="kpi"><div class="kpi__label">Weeks of cover</div><div class="kpi__val">${d.weeksOfCover}</div><div class="kpi__sub">at current sell-through</div></div>
        <div class="kpi"><div class="kpi__label">Below threshold</div><div class="kpi__val">${d.lowStock.length}</div><div class="kpi__sub">SKUs under 20 units</div></div>
        <div class="kpi"><div class="kpi__label">Out of stock</div><div class="kpi__val">${d.products.filter((p) => p.stock === 0).length}</div><div class="kpi__sub">losing sessions daily</div></div>
      </div>
      <div class="card">
        <div class="card__head"><h3>Stock by SKU</h3><span class="sub">sorted by risk</span></div>
        <table class="tbl">
          <thead><tr><th style="width:52px"></th><th>Product</th><th class="num">On hand</th><th class="num">Sold 30d</th><th class="num">Value</th><th>Cover</th><th>Signal</th></tr></thead>
          <tbody>
            ${[...d.products].sort((a, b) => a.stock - b.stock).map((p) => {
              const wk = p.sold ? (p.stock / (p.sold / 4.3)) : 0;
              const sig = p.stock === 0 ? 'Out' : !p.sold ? 'No sales' : wk < 3 ? 'Reorder' : wk < 6 ? 'Watch' : 'Healthy';
              const tone = sig === 'Out' || sig === 'Reorder' ? 'badge--low' : '';
              return `<tr>
                <td><img class="thumb" src="${p.image}" alt=""></td>
                <td><div style="font-weight:500">${esc(p.title)}</div><div style="font-size:11px;color:var(--muted-2)">${esc(p.id)}</div></td>
                <td class="num mono">${p.stock}</td>
                <td class="num mono" style="color:var(--muted)">${p.sold || '—'}</td>
                <td class="num mono">${money(p.stock * p.cost)}</td>
                <td class="mono" style="color:${wk && wk < 3 ? 'var(--danger)' : wk && wk < 6 ? 'var(--warn)' : 'var(--muted)'}">${wk ? wk.toFixed(1) + ' wk' : '—'}</td>
                <td><span class="badge ${tone}">${sig}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function renderCollections() {
    const { collections } = await api('collections');
    state.data.collections = collections;
    const top = collections.filter((c) => c.level === 1).sort((a, b) => a.order - b.order);
    view.innerHTML = `
      <div class="phead"><div><h1>Collections</h1><p>${top.length} top-level · ${collections.length - top.length} nested</p></div>
        <div class="phead__actions"><button class="abtn">Add collection</button></div></div>
      <div class="card" style="max-width:900px">
        <div class="card__head"><h3>Navigation structure</h3><span class="sub">mirrors atoleajewelry.com</span></div>
        <div class="card__body">
          <div class="tree">
            ${top.map((c) => {
              const kids = collections.filter((k) => k.parent === c.handle);
              return `<div class="tree__group">
                <div class="tree__top">
                  <input type="checkbox" ${c.visible ? 'checked' : ''} data-collvis="${c.handle}" style="accent-color:#171512">
                  <span style="font-weight:500;min-width:130px">${esc(c.title)}</span>
                  <code style="font-size:10.5px">/collections/${esc(c.handle)}</code>
                  <span style="margin-left:auto;font-size:11px;color:var(--muted-2)">${kids.length} sub</span>
                </div>
                ${kids.length ? `<div class="tree__kids">${kids.map((k) => `<span class="tree__kid ${k.visible ? '' : 'is-hidden'}">${esc(k.title)}</span>`).join('')}</div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  async function renderCustomers() {
    const { customers } = await api('customers');
    state.data.customers = customers;
    const total = customers.reduce((s, c) => s + c.spent, 0);
    const repeat = customers.filter((c) => c.orders > 1).length;
    view.innerHTML = `
      <div class="phead"><div><h1>Customers</h1><p>${customers.length} buyers · ${money(total)} lifetime revenue</p></div></div>
      <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi"><div class="kpi__label">Customers</div><div class="kpi__val">${customers.length}</div><div class="kpi__sub">with a paid order</div></div>
        <div class="kpi"><div class="kpi__label">Repeat rate</div><div class="kpi__val">${pct((repeat / Math.max(1, customers.length)) * 100)}</div><div class="kpi__sub">${repeat} bought twice or more</div></div>
        <div class="kpi"><div class="kpi__label">Avg lifetime value</div><div class="kpi__val">${money(total / Math.max(1, customers.length))}</div><div class="kpi__sub">across all buyers</div></div>
        <div class="kpi"><div class="kpi__label">Top spender</div><div class="kpi__val">${money(customers[0] ? customers[0].spent : 0)}</div><div class="kpi__sub">${customers[0] ? esc(customers[0].name) : '—'}</div></div>
      </div>
      <div class="card">
        <div class="card__head"><h3>Customer list</h3><span class="sub">sorted by lifetime value</span></div>
        <table class="tbl">
          <thead><tr><th>Customer</th><th>Location</th><th class="num">Orders</th><th class="num">Lifetime</th><th class="num">AOV</th><th>Segment</th><th>Last order</th></tr></thead>
          <tbody>
            ${customers.slice(0, 40).map((c) => {
              const seg = c.spent > 220 ? 'VIP' : c.orders > 1 ? 'Repeat' : 'New';
              return `<tr>
                <td><div style="font-weight:500">${esc(c.name)}</div><div style="font-size:11px;color:var(--muted-2)">${esc(c.email)}</div></td>
                <td style="color:var(--muted)">${esc(c.city)}${c.country ? ', ' + esc(c.country) : ''}</td>
                <td class="num mono">${c.orders}</td>
                <td class="num mono">${money(c.spent)}</td>
                <td class="num mono" style="color:var(--muted)">${money(c.spent / Math.max(1, c.orders))}</td>
                <td><span class="badge ${seg === 'VIP' ? 'badge--fulfilled' : seg === 'Repeat' ? 'badge--paid' : ''}">${seg}</span></td>
                <td style="color:var(--muted)">${dtFull(c.last)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function renderContent() {
    const { content } = await api('content');
    state.data.content = content;
    view.innerHTML = `
      <div class="phead"><div><h1>Storefront</h1><p>Copy and imagery that drive the homepage — changes go live immediately</p></div>
        <div class="phead__actions"><a class="abtn" href="/" target="_blank">Preview ↗</a></div></div>
      <div class="g2even">
        <div class="card">
          <div class="card__head"><h3>Hero</h3><span class="sub">above the fold</span></div>
          <div class="card__body">
            <div class="f"><label>Eyebrow</label><input name="heroEyebrow" value="${esc(content.hero.eyebrow)}"></div>
            <div class="f"><label>Headline</label><input name="heroTitle" value="${esc(content.hero.title)}"></div>
            <div class="f"><label>Body</label><textarea name="heroBody">${esc(content.hero.body)}</textarea></div>
            <div class="frow">
              <div class="f"><label>Button label</label><input name="heroCta" value="${esc(content.hero.cta)}"></div>
              <div class="f"><label>Button link</label><input name="heroCtaHref" value="${esc(content.hero.ctaHref)}"></div>
            </div>
            <button class="abtn abtn--primary" data-savecontent>Save hero</button>
          </div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Announcement bar</h3><span class="sub">${content.announcement.length} messages, rotates</span></div>
          <div class="card__body">
            ${content.announcement.map((a, i) => `<div class="f"><label>Message ${i + 1}</label><input name="ann${i}" value="${esc(a)}"></div>`).join('')}
            <div class="f"><label>Value props (4)</label>
              ${content.usps.map((u, i) => `<input name="usp${i}" value="${esc(u.title)}" style="margin-bottom:6px">`).join('')}
            </div>
            <button class="abtn abtn--primary" data-savecontent>Save messages</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__head"><h3>Live preview</h3><span class="sub">hero block</span></div>
        <div class="card__body" style="padding:0">
          <div style="display:grid;grid-template-columns:46% 54%;border:1px solid var(--line);margin:16px">
            <div style="padding:34px 28px;background:#f8f7f2">
              <p style="font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#736b63">${esc(content.hero.eyebrow)}</p>
              <p style="font-family:var(--serif);font-size:30px;line-height:1.02;letter-spacing:-.03em;margin-top:10px">${esc(content.hero.title)}</p>
              <p style="font-size:12px;color:#736b63;margin-top:10px;line-height:1.6">${esc(content.hero.body)}</p>
              <span class="abtn abtn--primary" style="margin-top:16px;pointer-events:none">${esc(content.hero.cta)}</span>
            </div>
            <img src="${content.hero.image}" alt="" style="width:100%;height:100%;object-fit:cover;min-height:230px">
          </div>
        </div>
      </div>`;
  }

  async function renderSettings() {
    const { settings, meta } = await api('settings');
    state.data.settings = settings;
    const c = settings.costs;
    view.innerHTML = `
      <div class="phead"><div><h1>Settings</h1><p>Cost model drives every margin number in this panel</p></div>
        <div class="phead__actions"><button class="abtn abtn--primary" data-savesettings>Save settings</button></div></div>
      <div class="g2even">
        <div class="card">
          <div class="card__head"><h3>Unit economics</h3><span class="sub">per order</span></div>
          <div class="card__body">
            <div class="f"><label>Duty rate on landed cost</label><input name="c_dutyRate" type="number" step="0.01" value="${c.dutyRate}"><p class="fhint">China-origin imitation jewellery, Section 301 + IEEPA stacked ≈ 31%</p></div>
            <div class="f"><label>Inbound freight (share of cost)</label><input name="c_freightRate" type="number" step="0.001" value="${c.freightRate}"></div>
            <div class="f"><label>Fulfilment + last mile (USD/order)</label><input name="c_fulfillment" type="number" step="0.1" value="${c.fulfillment}"></div>
            <div class="frow">
              <div class="f"><label>Payment fee %</label><input name="c_paymentRate" type="number" step="0.001" value="${c.paymentRate}"></div>
              <div class="f"><label>Payment fixed</label><input name="c_paymentFixed" type="number" step="0.01" value="${c.paymentFixed}"></div>
            </div>
            <div class="frow">
              <div class="f"><label>Return provision %</label><input name="c_returnsRate" type="number" step="0.01" value="${c.returnsRate}"></div>
              <div class="f"><label>Packaging</label><input name="c_packaging" type="number" step="0.01" value="${c.packaging}"></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Store</h3><span class="sub">operational</span></div>
          <div class="card__body">
            <div class="f"><label>Free shipping threshold</label><input name="freeShippingThreshold" type="number" value="${settings.freeShippingThreshold}"></div>
            <div class="f"><label>Monthly revenue target</label><input name="monthlyTarget" type="number" value="${settings.monthlyTarget}"></div>
            <div class="f"><label>Tagline</label><input name="tagline" value="${esc(settings.tagline)}"></div>
            <div class="f"><label>Admin password</label><input name="adminPassword" value="${esc(settings.adminPassword)}"><p class="fhint">Prototype only — production uses hashed credentials.</p></div>
            <div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px;font-size:11.5px;color:var(--muted)">
              <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Currency</span><span>${settings.currency}</span></div>
              <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Data file</span><span>data/db.json</span></div>
              <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Products / orders</span><span>${meta.productCount} / ${meta.orderCount}</span></div>
              <div style="display:flex;justify-content:space-between;padding:3px 0"><span>Seed version</span><span>${esc(meta.version)}</span></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- router ---------------- */
  const RENDER = {
    overview: renderOverview, orders: renderOrders, products: renderProducts,
    inventory: renderInventory, collections: renderCollections,
    customers: renderCustomers, content: renderContent, settings: renderSettings,
  };

  async function go(route) {
    const r = RENDER[route] ? route : 'overview';
    state.route = r;
    crumb.textContent = TITLES[r];
    $$('.adm__nav a').forEach((a) => a.classList.toggle('is-on', a.dataset.nav === r));
    view.innerHTML = '<div class="adm__loading">Loading…</div>';
    try { await RENDER[r](); } catch (e) { view.innerHTML = `<div class="aempty">Could not load: ${esc(e.message)}</div>`; }
  }

  function routeFromHash() {
    const h = location.hash.replace(/^#\/?/, '');
    return h || 'overview';
  }

  window.addEventListener('hashchange', () => go(routeFromHash()));

  /* ---------------- events ---------------- */
  document.addEventListener('click', async (e) => {
    const t = e.target;

    const nav = t.closest('[data-go]');
    if (nav) { location.hash = '#/' + nav.dataset.go; return; }

    if (t.closest('[data-days]')) {
      const b = t.closest('[data-days]');
      state.days = Number(b.dataset.days);
      $$('[data-days]').forEach((x) => x.classList.toggle('is-on', x === b));
      go(state.route);
      return;
    }

    if (t.closest('[data-logout]')) {
      await fetch('/api/admin/logout', { method: 'POST' });
      location.href = '/admin';
      return;
    }

    if (t.closest('[data-ofilter]')) {
      state.orderFilter = t.closest('[data-ofilter]').dataset.ofilter;
      renderOrders();
      return;
    }

    const openO = t.closest('[data-order]');
    if (openO) { orderModal(openO.dataset.order); return; }

    if (t.closest('[data-close]') || t.id === 'modal') { $('#modal').hidden = true; return; }

    const flow = t.closest('[data-flow]');
    if (flow) {
      const [id, status] = flow.dataset.flow.split(':');
      await api('orders/' + id, { method: 'PATCH', body: { status } });
      $('#modal').hidden = true;
      toast('Order marked ' + status);
      renderOrders();
      return;
    }

    const edit = t.closest('[data-edit]');
    if (edit) { productModal(edit.dataset.edit); return; }

    const save = t.closest('[data-saveproduct]');
    if (save) {
      const form = $('[data-pform]');
      const body = {};
      new FormData(form).forEach((v, k) => { body[k] = k === 'price' || k === 'compareAt' || k === 'stock' || k === 'featured' ? Number(v) || 0 : v; });
      if (!body.compareAt) body.compareAt = null;
      await api('products/' + save.dataset.saveproduct, { method: 'PATCH', body });
      $('#modal').hidden = true;
      toast('Saved — storefront updated');
      renderProducts();
      return;
    }

    const sc = t.closest('[data-savecontent]');
    if (sc) {
      const c = state.data.content;
      const val = (n) => { const el = $(`[name="${n}"]`); return el ? el.value : undefined; };
      const next = {
        ...c,
        hero: {
          ...c.hero,
          eyebrow: val('heroEyebrow') ?? c.hero.eyebrow,
          title: val('heroTitle') ?? c.hero.title,
          body: val('heroBody') ?? c.hero.body,
          cta: val('heroCta') ?? c.hero.cta,
          ctaHref: val('heroCtaHref') ?? c.hero.ctaHref,
        },
        announcement: c.announcement.map((a, i) => val('ann' + i) ?? a),
        usps: c.usps.map((u, i) => ({ ...u, title: val('usp' + i) ?? u.title })),
      };
      await api('content', { method: 'PATCH', body: next });
      toast('Storefront copy updated');
      renderContent();
      return;
    }

    const ss = t.closest('[data-savesettings]');
    if (ss) {
      const g = (n) => Number(($(`[name="${n}"]`) || {}).value);
      await api('settings', {
        method: 'PATCH',
        body: {
          freeShippingThreshold: g('freeShippingThreshold'),
          monthlyTarget: g('monthlyTarget'),
          adminPassword: ($('[name=adminPassword]') || {}).value,
          costs: {
            dutyRate: g('c_dutyRate'), freightRate: g('c_freightRate'), fulfillment: g('c_fulfillment'),
            paymentRate: g('c_paymentRate'), paymentFixed: g('c_paymentFixed'),
            returnsRate: g('c_returnsRate'), packaging: g('c_packaging'),
          },
        },
      });
      toast('Cost model saved — margins recalculated');
      go('settings');
      return;
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.collvis) {
      await api('collections/' + t.dataset.collvis, { method: 'PATCH', body: { visible: t.checked } });
      toast('Visibility updated');
      renderCollections();
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.ordersearch !== undefined) {
      state.orderQ = t.value;
      clearTimeout(t._d);
      t._d = setTimeout(() => { renderOrders(); }, 260);
    }
    if (t.dataset.productsearch !== undefined) {
      state.productQ = t.value;
      clearTimeout(t._d);
      t._d = setTimeout(() => { renderProducts(); }, 260);
    }
  });

  go(routeFromHash());
})();
