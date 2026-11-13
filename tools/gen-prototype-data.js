// 从 wildkind/data/db.json 生成原型用的数据文件
// 运行：node tools/gen-prototype-data.js
const fs = require('fs');
const path = require('path');
const core = require('../lib/core.js');

const db = core.db();
const OUT = path.join(__dirname, '..', 'prototype', 'assets', 'js', 'data.js');

const IMG = n => 'assets/img/opt/' + n + '.jpg';

const NECK = ['p-necklace-fox-gold', 'p-necklace-moon-silver', 'p-necklace-sun-gold', 'p-necklace-turtle-silver', 'p-necklace-pearl-gold'];
const RING = ['p-rings-stack-gold'];
const BRAC = ['p-bracelet-clover-silver', 'p-bracelet-beaded-gold'];
const ANKL = ['p-anklet-shell-gold'];
const EARR = ['p-earrings-hoop-gold'];

const OCEAN = ['turtle', 'coral', 'shell', 'seahorse', 'starfish', 'wave', 'pearl', 'cowrie', 'coral'];
const WOOD = ['fox', 'hare', 'fern', 'clover', 'leaf', 'flower', 'bee', 'hummingbird', 'letter', 'name'];
const SKY = ['sun', 'moon', 'star', 'gem'];

function motifSet(m) {
  if (OCEAN.includes(m)) return 'ocean';
  if (SKY.includes(m)) return 'celestial';
  return 'woodland';
}
const SET_IMG = { ocean: 'c-ocean', woodland: 'c-woodland', celestial: 'c-celestial' };

// 商品形态（决定配图）：先看 collections 里的形态类目，再按标题关键词兜底。
// 注意 pearls / gifts 是「主题集合」而非形态，不能用来选图。
const FORM_CATS = ['necklaces', 'rings', 'bracelets', 'anklets', 'earrings'];
const TITLE_CAT = [
  [/necklace|choker|pendant|locket/i, 'necklaces'],
  [/earring|hoop|huggie|stud/i, 'earrings'],
  [/bracelet/i, 'bracelets'],
  [/anklet/i, 'anklets'],
  [/\bring\b|signet/i, 'rings'],
  [/chain/i, 'necklaces'],
];
function catOf(p) {
  for (const c of FORM_CATS) if (p.collections.includes(c)) return c;
  for (const [re, c] of TITLE_CAT) if (re.test(p.title)) return c;
  return 'necklaces';
}

const POOL = {
  necklaces: NECK, rings: RING, bracelets: BRAC, anklets: ANKL,
  earrings: EARR, pearls: ['p-necklace-pearl-gold', 'p-bracelet-beaded-gold'], gifts: NECK
};

// 品类 → 兜底图。源数据里有个别商品图片跨品类错配（耳环挂了项链图），
// 这里按品类校正，并打印告警，避免原型里出现「名为耳环、图示项链」。
const CAT_FALLBACK = {
  necklaces: 'p-necklace-fox-gold', rings: 'p-rings-stack-gold',
  bracelets: 'p-bracelet-beaded-gold', anklets: 'p-anklet-shell-gold',
  earrings: 'p-earrings-hoop-gold', pearls: 'p-necklace-pearl-gold', gifts: 'p-necklace-sun-gold'
};
const IMG_CAT = {
  'p-necklace-fox-gold': 'necklaces', 'p-necklace-moon-silver': 'necklaces',
  'p-necklace-sun-gold': 'necklaces', 'p-necklace-turtle-silver': 'necklaces',
  'p-necklace-pearl-gold': 'necklaces', 'p-rings-stack-gold': 'rings',
  'p-bracelet-beaded-gold': 'bracelets', 'p-bracelet-clover-silver': 'bracelets',
  'p-anklet-shell-gold': 'anklets', 'p-earrings-hoop-gold': 'earrings'
};
const mismatched = [];

function gallery(p) {
  const cat = catOf(p);
  let own = p.image.split('/').pop().replace('.png', '');
  const ownCat = IMG_CAT[own];
  if (ownCat && ownCat !== cat) {
    mismatched.push(p.handle + ': ' + own + ' (' + ownCat + ') → ' + cat);
    own = CAT_FALLBACK[cat];
  }
  const pool = POOL[cat].filter(x => x !== own);
  const second = pool[0] || own;
  const third = cat === 'necklaces' || cat === 'pearls' ? 'hero-necklaces' : SET_IMG[motifSet(p.motif)];
  return [own, second, third].map(IMG);
}

const products = db.products.map(p => {
  const cat = catOf(p);
  const metals = p.metals || ['Gold'];
  const half = Math.max(1, Math.round(p.stock / metals.length));
  const variants = metals.map((m, i) => ({
    sku: p.id + '-' + m.replace(/\s/g, '').slice(0, 2).toUpperCase(),
    metal: m,
    stock: i === metals.length - 1 ? Math.max(0, p.stock - half * (metals.length - 1)) : half,
    price: Math.round(p.price * (m === 'Rose Gold' ? 1.05 : 1) * 100) / 100
  }));
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    price: p.price,
    compareAt: p.compareAt || null,
    cost: p.cost,
    stock: p.stock,
    images: gallery(p),
    motif: p.motif,
    set: motifSet(p.motif),
    cat,
    badge: p.badge || null,
    rating: p.rating,
    reviewCount: p.reviews,
    desc: p.desc,
    details: p.details,
    sizes: p.sizes || [],
    variants,
    collections: p.collections.slice(),
    active: p.status === 'active',
    createdAt: p.createdAt,
    sold30: 0
  };
});

// 30 天销量（后台库存页用）
const sold = {};
db.orders.forEach(o => {
  if (o.status === 'refunded' || o.status === 'cancelled') return;
  o.items.forEach(it => { sold[it.productId] = (sold[it.productId] || 0) + it.qty; });
});
products.forEach(p => { p.sold30 = sold[p.id] || 0; });

// ---------- 派生集合 New / SALE ----------
// 源数据没有显式 new/sale 标记，按业务口径派生：
//   new  = 最近上架的 8 款（按 createdAt 倒序）
//   sale = 有划线价（compareAt > price）的款
products
  .slice()
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  .slice(0, 8)
  .forEach(p => { if (!p.collections.includes("new")) p.collections.push("new"); });
products.forEach(p => {
  if (p.compareAt && p.compareAt > p.price && !p.collections.includes("sale")) p.collections.push("sale");
});

// ---------- 集合 ----------
const collections = db.collections.map(c => ({
  handle: c.handle,
  title: c.title,
  nav: !!c.nav,
  level: c.level,
  parent: c.parent || null,
  menuGroup: c.menuGroup || null,
  order: c.order || 0,
  desc: c.description || '',
  count: products.filter(p => p.collections.includes(c.handle)).length
}));

// ---------- 订单 ----------
const STATUS_LABEL = {
  pending: 'Awaiting payment', paid: 'Paid', fulfilling: 'Preparing',
  fulfilled: 'Shipped', completed: 'Delivered', refunded: 'Refunded', cancelled: 'Cancelled'
};
const orders = db.orders.slice(0, 90).map(o => ({
  number: o.number,
  email: (o.customer && o.customer.email) || '',
  name: (o.customer && o.customer.name) || '',
  status: o.status,
  statusLabel: STATUS_LABEL[o.status] || o.status,
  channel: o.channel || 'Organic',
  items: o.items.map(it => ({
    productId: it.productId,
    title: it.title,
    variant: it.variant || it.metal || 'Gold',
    size: it.size || '',
    unitPrice: it.price,
    qty: it.qty
  })),
  subtotal: o.subtotal,
  shipping: o.shipping,
  discount: o.discount || 0,
  total: o.total,
  address: o.customer ? { city: o.customer.city, state: o.customer.state, country: o.customer.country } : {},
  shippingMethod: o.shippingMethod || 'Standard',
  tracking: o.tracking || '',
  carrier: o.carrier || '',
  createdAt: o.createdAt,
  note: o.note || ''
}));

// ---------- 客户 ----------
// 客户口径与后台 GMV 保持一致：退款 / 取消的订单不计入 spent、订单数与复购率
const cmap = {};
orders.forEach(o => {
  if (o.status === 'refunded' || o.status === 'cancelled') return;
  const k = o.email;
  if (!cmap[k]) cmap[k] = { email: k, name: o.name, orders: 0, spent: 0, first: o.createdAt, last: o.createdAt };
  cmap[k].orders++;
  cmap[k].spent += o.total;
  if (o.createdAt < cmap[k].first) cmap[k].first = o.createdAt;
  if (o.createdAt > cmap[k].last) cmap[k].last = o.createdAt;
});
const customers = Object.values(cmap).map((c, i) => ({
  id: 'C' + String(i + 1).padStart(3, '0'),
  email: c.email,
  name: c.name,
  orders: c.orders,
  spent: Math.round(c.spent * 100) / 100,
  first: c.first,
  last: c.last,
  tier: c.orders >= 3 ? 'VIP' : c.orders >= 2 ? 'Repeat' : 'New'
}));

// ---------- 评价 ----------
const NAMES = ['Sarah M.', 'Emily R.', 'Jessica T.', 'Lauren K.', 'Megan H.', ' Rachel B.', 'Amanda C.', 'Katie S.', 'Nicole P.', 'Hannah W.', 'Olivia D.', 'Grace L.', 'Chloe A.', 'Maya N.', 'Sophie G.', 'Ella V.', 'Isabel F.', 'Nora J.', 'Ruby O.', 'Ivy Q.'];
const REVIEWS = [
  { r: 5, t: 'Wore it in the ocean for two weeks straight', b: 'I bought this for a trip to Maui and never took it off. Snorkeling, showers, sunscreen — it still looks brand new. The gold has not dulled at all.' },
  { r: 5, t: 'Finally something I do not have to think about', b: 'I have a toddler and shower twice a day. This is the first necklace that has survived both. Two months in, zero fading.' },
  { r: 5, t: 'Looks far more expensive than it is', b: 'Got compliments at work the first day. Nobody believes the price. The chain has real weight to it, not that flimsy feeling.' },
  { r: 4, t: 'Beautiful, slightly smaller than expected', b: 'The pendant is a bit smaller than the photos suggest, but honestly it sits better on my neck because of it. Clasp is sturdy.' },
  { r: 5, t: 'Bought three, one for each sister', b: 'Gifted these for my sisters and they all wear theirs daily. One has sensitive skin and had no reaction at all.' },
  { r: 5, t: 'The only jewelry I travel with now', b: 'Packed one bag for three weeks in Portugal. Swam in the Atlantic every day. Came home, rinsed it, good as new.' },
  { r: 4, t: 'Lovely, wish the clasp was easier', b: 'No complaints about the finish or the colour. The lobster clasp is a little fiddly with long nails — small thing.' },
  { r: 5, t: 'Eight months in and still gold', b: 'I am writing this eight months after buying specifically because I wanted to test the colour claim. It has not faded. Not once.' },
  { r: 5, t: 'No green wrists, no rash', b: 'I react to almost every cheap metal. This one, nothing. I have worn it every single day for six weeks.' },
  { r: 3, t: 'Pretty but the size chart confused me', b: 'Ended up exchanging for the longer length. The piece itself is beautiful and the exchange was painless, so I am not upset.' },
  { r: 5, t: 'My daughter has not taken it off', b: 'Bought for her 14th birthday. She swims competitively. Six weeks of chlorine and it is still perfect.' },
  { r: 5, t: 'Worth it for the lifetime promise alone', b: 'I have thrown away so many $20 necklaces that turned black. Paying more once makes more sense than replacing four times a year.' }
];
const reviews = [];
products.slice(0, 14).forEach((p, pi) => {
  const n = 3 + (pi % 3);
  for (let i = 0; i < n; i++) {
    const tpl = REVIEWS[(pi * 3 + i) % REVIEWS.length];
    const nm = NAMES[(pi * 4 + i) % NAMES.length].trim();
    const d = new Date(Date.UTC(2026, 10, 12) - (pi * 3 + i) * 86400000 * 6);
    reviews.push({
      id: 'R' + String(reviews.length + 1).padStart(3, '0'),
      productId: p.id,
      productHandle: p.handle,
      productTitle: p.title,
      name: nm,
      rating: tpl.r,
      title: tpl.t,
      body: tpl.b,
      createdAt: d.toISOString().slice(0, 10),
      status: ([0, 3, 6, 9].indexOf(pi) >= 0 && i === 1) ? 'pending' : 'approved',
      verified: reviews.length % 4 !== 3,
      monthsOwned: 1 + ((pi + i) % 9)
    });
  }
});
// 额外补 4 条待审
[
  { p: 'tidepool-choker', n: 'Tara W.', r: 5, t: 'Exactly the choker I wanted', b: 'Sits right at the collarbone. Wore it to a wedding and then in the pool the next morning.' },
  { p: 'sunburst-hoops', n: 'Dana L.', r: 2, t: 'One hoop arrived bent', b: 'The left hoop was slightly out of round. They sent a replacement quickly but it was frustrating.' },
  { p: 'cowrie-anklet', n: 'Priya S.', r: 5, t: 'Never coming off', b: 'Bought this for a beach trip and I am still wearing it four months later. No tarnish at the clasp.' },
  { p: 'moonphase-ring', n: 'Elena R.', r: 4, t: 'Subtle and stackable', b: 'Wear it between two thin bands. The moon detail is engraved, not printed, which matters.' }
].forEach((x, xi) => {
  const pr = products.find(p => p.handle === x.p) || products[0];
  reviews.push({
    id: 'R' + String(reviews.length + 1).padStart(3, '0'),
    productId: pr.id, productHandle: pr.handle, productTitle: pr.title,
    name: x.n, rating: x.r, title: x.t, body: x.b,
    createdAt: '2026-11-' + String(2 + xi).padStart(2, '0'),
    status: 'pending', verified: true, monthsOwned: 2 + reviews.length % 5
  });
});

// ---------- 营销 ----------
const coupons = [
  { code: 'TIDEGLASS10', type: 'percent', value: 10, minSubtotal: 0, used: 84, limit: 500, startsAt: '2026-10-01', endsAt: '2026-12-31', status: 'active', note: 'Welcome code, always on' },
  { code: 'WELCOME15', type: 'fixed', value: 15, minSubtotal: 95, used: 212, limit: 1000, startsAt: '2026-09-01', endsAt: '2026-12-31', status: 'active', note: 'Newsletter popup' },
  { code: 'BF30', type: 'percent', value: 30, minSubtotal: 120, used: 0, limit: 300, startsAt: '2026-11-25', endsAt: '2026-11-30', status: 'scheduled', note: 'Black Friday' },
  { code: 'SUMMER20', type: 'percent', value: 20, minSubtotal: 0, used: 640, limit: 640, startsAt: '2026-06-01', endsAt: '2026-08-31', status: 'expired', note: 'Summer campaign' }
];
const promotions = [
  { id: 'P1', name: 'SALE collection 20% off', scope: 'collection: sale', kind: 'percent', value: 20, startsAt: '2026-11-01', endsAt: '2026-11-30', status: 'active', priority: 1 },
  { id: 'P2', name: 'Free shipping over $95', scope: 'all', kind: 'freeship', value: 0, startsAt: '2026-01-01', endsAt: '', status: 'active', priority: 2 },
  { id: 'P3', name: 'Gift with $120+', scope: 'all', kind: 'gift', value: 0, startsAt: '2026-11-10', endsAt: '2026-12-25', status: 'active', priority: 3 }
];
const giftRule = { threshold: 120, sku: 'TG-601', name: 'Pearl Studs', value: 38, maxPerOrder: 1 };

// ---------- 定制单 ----------
const customRequests = [
  { id: 'CR-0007', name: 'Hannah Cole', email: 'hannah.cole@example.com', type: 'Initial necklace', qty: 2, due: '2026-12-05', status: 'new', note: 'Two letters, one for each daughter. Wants silver, 18 inch.', createdAt: '2026-11-12' },
  { id: 'CR-0006', name: 'Marco Diaz', email: 'marco.d@example.com', type: 'Name bracelet', qty: 1, due: '2026-12-18', status: 'quoted', note: 'Quoted $96 for 7 letters. Waiting on reply.', createdAt: '2026-11-10' },
  { id: 'CR-0005', name: 'Ivy Chen', email: 'ivy.chen@example.com', type: 'Wedding party set', qty: 6, due: '2027-01-20', status: 'in_progress', note: 'Six matching anklets, deposit paid 50%.', createdAt: '2026-11-04' }
];

const settings = {
  brand: 'TIDEGLASS',
  tagline: "Sea glass doesn't fade.",
  currency: 'USD',
  freeShip: 95,
  giftThreshold: 120,
  standardShip: 6.9,
  expressShip: 18,
  costs: { duty: 31, freight: 5.5, fulfillment: 9.8, payment: 3.2, paymentFixed: 0.3, packaging: 0.85, returns: 6, colourReserve: 2 },
  // 首页可编辑文案（后台 Content 页写入，前台直接读取）
  content: {
    announce: 'Free shipping over $95 · Lifetime colour guarantee · 30-day returns · Duties included',
    heroEyebrow: 'Sea glass · 316L steel',
    heroTitle: "Sea glass doesn't fade.|Neither do we.",
    heroBody: '316L stainless steel with a PVD colour layer that does not fade. Swim in it, shower in it, sleep in it — and if the colour ever goes, we replace it once.'
  }
};

const out = {
  products, collections, orders, customers, reviews, coupons, promotions, giftRule, customRequests, settings
};

const js = '/* 原型数据：由 tools/gen-prototype-data.js 从 db.json 生成，请勿手改 */\nwindow.SEED = ' + JSON.stringify(out, null, 0) + ';\n';
fs.writeFileSync(OUT, js, 'utf8');
console.log('written', OUT, (js.length / 1024).toFixed(1) + 'KB');
console.log('products', products.length, '| collections', collections.length, '| orders', orders.length,
  '| customers', customers.length, '| reviews', reviews.length,
  '| pending reviews', reviews.filter(r => r.status === 'pending').length);
if (mismatched.length) {
  console.log('⚠ 图片品类错配已校正 ' + mismatched.length + ' 条：');
  mismatched.forEach(m => console.log('  ' + m));
}
