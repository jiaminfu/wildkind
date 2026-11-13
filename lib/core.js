const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

let cache = null;
let mtime = 0;

function db() {
  const st = fs.statSync(DB_PATH);
  if (!cache || st.mtimeMs !== mtime) {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    mtime = st.mtimeMs;
  }
  return cache;
}

function save(next) {
  fs.writeFileSync(DB_PATH, JSON.stringify(next, null, 2));
  cache = next;
  mtime = fs.statSync(DB_PATH).mtimeMs;
  return cache;
}

function mutate(fn) {
  const d = JSON.parse(JSON.stringify(db()));
  const r = fn(d);
  return save(d) && r;
}

// ---------- 格式化 ----------
const money = (n, opts = {}) =>
  '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: opts.decimals ?? (Number.isInteger(n) ? 0 : 2),
    maximumFractionDigits: 2,
  });

const pct = (n, d = 1) => (n == null ? '—' : `${Number(n).toFixed(d)}%`);

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const fmtShort = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ---------- 查询 ----------
const found = (arr, pred) => arr.find(pred) || null;

function getProduct(handle) {
  return db().products.find((p) => p.handle === handle || p.id === handle) || null;
}

function getCollection(handle) {
  return db().collections.find((c) => c.handle === handle) || null;
}

function productsIn(handle) {
  const c = getCollection(handle);
  const all = db().products.filter((p) => p.status === 'active');
  if (!c) return all;
  let list = all.filter((p) => p.collections.includes(handle));
  if (c.filter && c.filter.metal) list = all.filter((p) => p.metals.includes(c.filter.metal));
  return list;
}

function navCollections() {
  return db().collections
    .filter((c) => c.level === 1 && c.nav && c.visible)
    .sort((a, b) => a.order - b.order);
}

function menuFor(handle) {
  const d = db();
  const kids = d.collections.filter((c) => c.parent === handle && c.visible);
  const groups = [];
  for (const k of kids.sort((a, b) => a.order - b.order)) {
    const g = k.menuGroup || 'Shop';
    let grp = groups.find((x) => x.title === g);
    if (!grp) groups.push((grp = { title: g, items: [] }));
    grp.items.push(k);
  }
  return groups;
}

// ---------- 财务 ----------
function orderFinance(order, costs) {
  const c = costs || db().settings.costs;
  const cogs = order.items.reduce((s, i) => s + i.cost * i.qty, 0);
  const duty = cogs * c.dutyRate;
  const freight = cogs * c.freightRate;
  const fulfillment = c.fulfillment;
  const fees = order.total * c.paymentRate + c.paymentFixed;
  const packaging = c.packaging;
  const returns = order.total * c.returnsRate;
  const cost = cogs + duty + freight + fulfillment + fees + packaging + returns;
  const profit = order.total - cost;
  return {
    revenue: order.total,
    cogs: r2(cogs), duty: r2(duty), freight: r2(freight), fulfillment: r2(fulfillment),
    fees: r2(fees), packaging: r2(packaging), returns: r2(returns),
    cost: r2(cost), profit: r2(profit),
    margin: order.total ? r2((profit / order.total) * 100) : 0,
  };
}

const r2 = (n) => Math.round(n * 100) / 100;

function withinDays(iso, days, now = new Date('2026-11-12T23:59:59Z')) {
  const t = new Date(iso).getTime();
  return now.getTime() - t <= days * 86400000 && t <= now.getTime();
}

function summary(days = 30) {
  const d = db();
  const orders = d.orders.filter((o) => withinDays(o.createdAt, days));
  const paid = orders.filter((o) => ['paid', 'fulfilled'].includes(o.status));
  const refunded = orders.filter((o) => o.status === 'refunded');

  const revenue = r2(paid.reduce((s, o) => s + o.total, 0));
  const fin = paid.map((o) => orderFinance(o, d.settings.costs));
  const sum = (k) => r2(fin.reduce((s, f) => s + f[k], 0));
  const profit = sum('profit');
  const units = paid.reduce((s, o) => s + o.items.reduce((n, i) => n + i.qty, 0), 0);

  // 每日序列
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date('2026-11-12T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - i);
    const key = day.toISOString().slice(0, 10);
    const dayOrders = paid.filter((o) => o.createdAt.slice(0, 10) === key);
    series.push({
      date: key,
      revenue: r2(dayOrders.reduce((s, o) => s + o.total, 0)),
      orders: dayOrders.length,
    });
  }

  // 分类销售
  const byCollection = {};
  for (const o of paid) {
    for (const it of o.items) {
      const p = d.products.find((x) => x.id === it.productId);
      if (!p) continue;
      const main = p.collections.find((h) => ['necklaces', 'rings', 'bracelets', 'anklets', 'earrings', 'pearls', 'custom', 'gifts'].includes(h)) || 'other';
      byCollection[main] = byCollection[main] || { revenue: 0, units: 0 };
      byCollection[main].revenue = r2(byCollection[main].revenue + it.price * it.qty);
      byCollection[main].units += it.qty;
    }
  }

  // Top 商品
  const byProduct = {};
  for (const o of paid) for (const it of o.items) {
    byProduct[it.productId] = byProduct[it.productId] || { units: 0, revenue: 0 };
    byProduct[it.productId].units += it.qty;
    byProduct[it.productId].revenue = r2(byProduct[it.productId].revenue + it.price * it.qty);
  }
  const topProducts = Object.entries(byProduct)
    .map(([id, v]) => ({ ...d.products.find((p) => p.id === id), ...v }))
    .filter((p) => p.id)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  // 库存
  const inventoryValue = r2(d.products.reduce((s, p) => s + p.cost * p.stock, 0));
  const unitsOnHand = d.products.reduce((s, p) => s + p.stock, 0);
  const lowStock = d.products.filter((p) => p.stock <= 20).sort((a, b) => a.stock - b.stock);
  const soldPerDay = units / days;
  const weeksOfCover = soldPerDay > 0 ? r2(unitsOnHand / soldPerDay / 7) : null;

  const customers = new Set(paid.map((o) => o.customer.email));
  const repeat = (() => {
    const counts = {};
    for (const o of paid) counts[o.customer.email] = (counts[o.customer.email] || 0) + 1;
    const multi = Object.values(counts).filter((n) => n > 1).length;
    return customers.size ? r2((multi / customers.size) * 100) : 0;
  })();

  const sessions = Math.round(units * 34 + days * 26);

  return {
    days,
    revenue,
    orders: paid.length,
    units,
    aov: paid.length ? r2(revenue / paid.length) : 0,
    profit,
    margin: revenue ? r2((profit / revenue) * 100) : 0,
    cogs: sum('cogs'), duty: sum('duty'), freight: sum('freight'),
    fulfillment: sum('fulfillment'), fees: sum('fees'), packaging: sum('packaging'), returns: sum('returns'),
    refunds: refunded.length,
    refundRate: orders.length ? r2((refunded.length / orders.length) * 100) : 0,
    conversion: sessions ? r2((paid.length / sessions) * 100) : 0,
    sessions,
    customers: customers.size,
    repeatRate: repeat,
    openOrders: d.orders.filter((o) => ['paid', 'fulfilling'].includes(o.status)).length,
    series,
    byCollection,
    topProducts,
    soldByProduct: byProduct,
    inventoryValue, unitsOnHand, weeksOfCover,
    lowStock: lowStock.slice(0, 8),
    monthlyTarget: d.settings.monthlyTarget,
  };
}

module.exports = {
  db, save, mutate, money, pct, esc, fmtDate, fmtShort,
  getProduct, getCollection, productsIn, navCollections, menuFor,
  orderFinance, summary, r2, withinDays,
};
