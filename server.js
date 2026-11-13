const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const core = require('./lib/core');
const { db, save, esc, money, summary, getProduct, r2 } = core;
const pagesStore = require('./lib/pages-store');
const pagesMisc = require('./lib/pages-misc');
const admin = require('./lib/admin');

const PORT = process.env.PORT || 4400;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/* ---------------- helpers ---------------- */
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });
}

function json(res, status, obj, extraHeaders = {}) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function html(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function getCart(req) {
  const c = parseCookies(req);
  if (!c.wk_cart) return [];
  try {
    const arr = JSON.parse(Buffer.from(c.wk_cart, 'base64').toString('utf8'));
    return arr.map((l) => {
      const p = getProduct(l.productId);
      if (!p) return null;
      return {
        productId: p.id, handle: p.handle, title: p.title, image: p.image,
        price: p.price, qty: Math.max(1, Math.min(20, l.qty || 1)),
        metal: l.metal || p.metals[0], size: l.size || (p.sizes ? p.sizes[0] : 'One size'),
        stock: p.stock,
      };
    }).filter(Boolean);
  } catch { return []; }
}

function setCart(res, cart) {
  const compact = cart.map((l) => ({ productId: l.productId, qty: l.qty, metal: l.metal, size: l.size }));
  const val = Buffer.from(JSON.stringify(compact)).toString('base64');
  return `wk_cart=${encodeURIComponent(val)}; Path=/; Max-Age=2592000; SameSite=Lax`;
}

const cartCount = (cart) => cart.reduce((s, l) => s + l.qty, 0);

function isAdmin(req) {
  const c = parseCookies(req);
  return c.wk_admin === '1';
}

/* ---------------- static ---------------- */
function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname.replace(/^\/assets\//, ''));
  const file = path.join(PUB, 'assets', rel);
  if (!file.startsWith(path.join(PUB, 'assets'))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(data);
  });
}

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const query = Object.fromEntries(url.searchParams.entries());
  const cart = getCart(req);
  const ctx = { cart, cartCount: cartCount(cart) };

  try {
    // ---- static ----
    if (pathname.startsWith('/assets/')) return serveStatic(req, res, pathname);

    // ---- API: cart ----
    if (pathname === '/api/cart' && method === 'GET') return json(res, 200, { cart, count: cartCount(cart) });

    if (pathname === '/api/cart/add' && method === 'POST') {
      const body = await readBody(req);
      const p = getProduct(body.productId);
      if (!p) return json(res, 404, { error: 'Product not found' });
      const next = [...cart];
      const key = (l) => l.productId === p.id && l.metal === (body.metal || p.metals[0]) && l.size === (body.size || '');
      const found = next.find(key);
      if (found) found.qty = Math.min(20, found.qty + (body.qty || 1));
      else next.push({
        productId: p.id, handle: p.handle, title: p.title, image: p.image, price: p.price,
        qty: Math.min(20, body.qty || 1), metal: body.metal || p.metals[0],
        size: body.size || (p.sizes ? p.sizes[0] : 'One size'), stock: p.stock,
      });
      return json(res, 200, { cart: next, count: cartCount(next) }, { 'Set-Cookie': setCart(res, next) });
    }

    if (pathname === '/api/cart/update' && method === 'POST') {
      const body = await readBody(req);
      let next = cart.map((l) => (l.productId === body.productId ? { ...l, qty: Math.max(0, l.qty + (body.delta || 0)) } : l));
      next = next.filter((l) => l.qty > 0);
      return json(res, 200, { cart: next, count: cartCount(next) }, { 'Set-Cookie': setCart(res, next) });
    }

    if (pathname === '/api/cart/remove' && method === 'POST') {
      const body = await readBody(req);
      const next = cart.filter((l) => l.productId !== body.productId);
      return json(res, 200, { cart: next, count: cartCount(next) }, { 'Set-Cookie': setCart(res, next) });
    }

    // ---- API: checkout ----
    if (pathname === '/api/checkout' && method === 'POST') {
      const body = await readBody(req);
      if (!cart.length) return json(res, 400, { error: 'Bag is empty' });
      const d = db();
      const subtotal = r2(cart.reduce((s, l) => s + l.price * l.qty, 0));
      const shipping = subtotal >= d.settings.freeShippingThreshold ? 0 : 6.9;
      const total = r2(subtotal + shipping);
      const seq = 1140 + d.orders.length;
      const order = {
        id: 'o_' + crypto.randomBytes(4).toString('hex'),
        number: '#WK' + seq,
        createdAt: new Date().toISOString(),
        status: 'paid',
        items: cart.map((l) => ({
          productId: l.productId, title: l.title, variant: l.metal, size: l.size,
          qty: l.qty, price: l.price, cost: (getProduct(l.productId) || {}).cost || 6,
        })),
        customer: {
          name: `${body.firstName || 'Guest'} ${body.lastName || ''}`.trim(),
          email: body.email || 'guest@example.com',
          city: body.city || '', state: body.state || '', country: body.country || 'United States',
        },
        subtotal, shipping, discount: 0, total,
        channel: 'Direct', tracking: null,
      };
      const next = JSON.parse(JSON.stringify(d));
      next.orders.unshift(order);
      // 扣库存
      for (const it of order.items) {
        const p = next.products.find((x) => x.id === it.productId);
        if (p) p.stock = Math.max(0, p.stock - it.qty);
      }
      save(next);
      return json(res, 200, { order, url: `/order/${order.number.replace('#', '')}` },
        { 'Set-Cookie': 'wk_cart=; Path=/; Max-Age=0' });
    }

    // ---- API: newsletter ----
    if (pathname === '/api/newsletter' && method === 'POST') {
      await readBody(req);
      return json(res, 200, { ok: true });
    }

    // ---- API: admin ----
    if (pathname === '/api/admin/login' && method === 'POST') {
      const body = await readBody(req);
      if (String(body.password || '') !== db().settings.adminPassword) {
        return json(res, 401, { error: 'Password incorrect' });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'wk_admin=1; Path=/; Max-Age=86400; SameSite=Lax' });
    }
    if (pathname === '/api/admin/logout' && method === 'POST') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'wk_admin=; Path=/; Max-Age=0' });
    }

    if (pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorised' });
      const rest = pathname.replace('/api/admin/', '');

      if (rest === 'summary') return json(res, 200, summary(Number(query.days) || 30));

      if (rest === 'products' && method === 'GET') {
        const d = db();
        return json(res, 200, { products: d.products, collections: d.collections });
      }

      if (rest.startsWith('products/') && method === 'PATCH') {
        const id = rest.replace('products/', '');
        const body = await readBody(req);
        const d = db();
        const idx = d.products.findIndex((p) => p.id === id);
        if (idx < 0) return json(res, 404, { error: 'Not found' });
        const allowed = ['title', 'price', 'compareAt', 'stock', 'badge', 'status', 'desc', 'featured'];
        for (const k of allowed) if (k in body) d.products[idx][k] = body[k];
        save(d);
        return json(res, 200, { product: d.products[idx] });
      }

      if (rest === 'orders' && method === 'GET') {
        const d = db();
        let list = d.orders;
        if (query.status && query.status !== 'all') list = list.filter((o) => o.status === query.status);
        if (query.q) {
          const q = query.q.toLowerCase();
          list = list.filter((o) => (o.number + o.customer.name + o.customer.email).toLowerCase().includes(q));
        }
        return json(res, 200, { orders: list });
      }

      if (rest.startsWith('orders/') && method === 'PATCH') {
        const id = rest.replace('orders/', '');
        const body = await readBody(req);
        const d = db();
        const o = d.orders.find((x) => x.id === id);
        if (!o) return json(res, 404, { error: 'Not found' });
        if (body.status) o.status = body.status;
        if (body.tracking !== undefined) o.tracking = body.tracking;
        save(d);
        return json(res, 200, { order: o });
      }

      if (rest === 'customers') {
        const d = db();
        return json(res, 200, { customers: d.customers.sort((a, b) => b.spent - a.spent) });
      }

      if (rest === 'collections' && method === 'GET') {
        const d = db();
        return json(res, 200, { collections: d.collections });
      }
      if (rest.startsWith('collections/') && method === 'PATCH') {
        const handle = rest.replace('collections/', '');
        const body = await readBody(req);
        const d = db();
        const c = d.collections.find((x) => x.handle === handle);
        if (!c) return json(res, 404, { error: 'Not found' });
        for (const k of ['title', 'intro', 'visible', 'order']) if (k in body) c[k] = body[k];
        save(d);
        return json(res, 200, { collection: c });
      }

      if (rest === 'content' && method === 'GET') return json(res, 200, { content: db().content });
      if (rest === 'content' && method === 'PATCH') {
        const body = await readBody(req);
        const d = db();
        d.content = { ...d.content, ...body };
        save(d);
        return json(res, 200, { content: d.content });
      }

      if (rest === 'settings' && method === 'GET') {
        const d = db();
        return json(res, 200, { settings: d.settings, meta: d.meta });
      }
      if (rest === 'settings' && method === 'PATCH') {
        const body = await readBody(req);
        const d = db();
        for (const k of ['freeShippingThreshold', 'monthlyTarget', 'adminPassword', 'tagline']) {
          if (k in body) d.settings[k] = body[k];
        }
        if (body.costs) d.settings.costs = { ...d.settings.costs, ...body.costs };
        save(d);
        return json(res, 200, { settings: d.settings });
      }

      if (rest === 'inventory') {
        const d = db();
        const s = summary(30);
        return json(res, 200, {
          products: d.products.map((p) => ({
            id: p.id, title: p.title, handle: p.handle, image: p.image,
            stock: p.stock, cost: p.cost, price: p.price, status: p.status,
            sold: (s.soldByProduct[p.id] || {}).units || 0,
          })),
          lowStock: s.lowStock, inventoryValue: s.inventoryValue,
          unitsOnHand: s.unitsOnHand, weeksOfCover: s.weeksOfCover,
        });
      }

      return json(res, 404, { error: 'Unknown endpoint' });
    }

    // ---- Admin panel ----
    if (pathname === '/admin' || pathname === '/admin/') {
      const demo = query.demo === '1';
      const authed = isAdmin(req) || demo;
      if (demo && !isAdmin(req)) {
        res.setHeader('Set-Cookie', 'wk_admin=1; Path=/; Max-Age=86400; SameSite=Lax');
      }
      return html(res, admin.panel({ authed }));
    }

    // ---- Prototype index ----
    if (pathname === '/prototype') {
      return html(res, admin.prototypeIndex());
    }

    // ---- Project documentation ----
    if (pathname === '/docs' || pathname === '/docs/') {
      const f = path.join(ROOT, 'docs', 'index.html');
      return fs.readFile(f, 'utf8', (err, data) => {
        if (err) { res.writeHead(404); return res.end('docs not found'); }
        html(res, data);
      });
    }

    // ---- Storefront routes ----
    if (method === 'GET') {
      if (pathname === '/') return html(res, pagesStore.home(ctx));

      if (pathname === '/cart') return html(res, pagesMisc.cartPage(ctx));
      if (pathname === '/checkout') return html(res, pagesMisc.checkout(ctx));
      if (pathname === '/search') return html(res, pagesStore.search(query.q || '', ctx));
      if (pathname === '/account') return html(res, pagesMisc.account(query, ctx));

      if (pathname.startsWith('/collections/')) {
        const handle = pathname.replace('/collections/', '');
        const body = pagesStore.collection(handle, query, ctx);
        if (body) return html(res, body);
      }

      if (pathname.startsWith('/products/')) {
        const handle = pathname.replace('/products/', '');
        const body = pagesStore.product(handle, ctx);
        if (body) return html(res, body);
      }

      if (pathname.startsWith('/pages/')) {
        const kind = pathname.replace('/pages/', '');
        const body = pagesMisc.contentPage(kind, ctx);
        if (body) return html(res, body);
      }

      if (pathname.startsWith('/order/')) {
        const num = pathname.replace('/order/', '');
        const order = db().orders.find((o) => o.number.replace('#', '') === num);
        const body = pagesMisc.orderConfirmation(order, ctx);
        if (body) return html(res, body);
      }

      return html(res, pagesMisc.notFound(ctx), 404);
    }

    res.writeHead(405); res.end('Method not allowed');
  } catch (err) {
    console.error('[error]', err);
    if (!res.headersSent) { res.writeHead(500); res.end('Server error: ' + err.message); }
  }
});

server.listen(PORT, () => {
  console.log(`\n  Wildkind storefront  →  http://localhost:${PORT}`);
  console.log(`  Admin panel          →  http://localhost:${PORT}/admin`);
  console.log(`  Prototype index      →  http://localhost:${PORT}/prototype\n`);
});
