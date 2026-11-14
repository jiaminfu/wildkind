#!/usr/bin/env node
/**
 * 从零建业务数据：上传商品图 → 建集合 → 建商品并上架 → 建优惠券
 * 用法：BASE=... ADMIN_PASS=... node tools/seed-demo.js
 * 说明：仅用于验收/演示环境，会写入真实数据。
 */
const zlib = require('zlib');

const BASE = process.env.BASE || 'http://127.0.0.1:4600';
const EMAIL = process.env.ADMIN_EMAIL || 'owner@tideglassjewelry.com';
const PASS = process.env.ADMIN_PASS;

/* ---------- 极简 PNG 编码（画“海玻璃”质感色块） ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function makePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const c = pixel(x / w, y / h);
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];

/** 主色 -> 一张“浅色背景 + 中心玻璃片”的图 */
function glassImage(hex, variant = 0) {
  const main = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const paper = [246, 242, 236];
  const shadow = [214, 206, 196];
  return makePng(900, 900, (u, v) => {
    // 背景：自上而下极轻渐变 + 斜向细纹
    let c = mix(paper, shadow, 0.18 + v * 0.16);
    const grain = ((Math.sin((u * 34 + v * 11) * 6.28) * 0.5 + 0.5) * 4) - 2;
    c = [clamp(c[0] + grain), clamp(c[1] + grain), clamp(c[2] + grain)];
    // 玻璃片：倾斜椭圆
    const cx = 0.5 + variant * 0.01, cy = 0.49;
    const dx = (u - cx) * 1.18, dy = (v - cy) * 1.46;
    const rot = 0.34;
    const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
    const d = Math.sqrt(rx * rx * 2.15 + ry * ry * 2.15);
    if (d < 0.42) {
      const k = d / 0.42;
      // 内层深浅过渡 + 左上高光
      const light = Math.max(0, 0.62 - Math.hypot(u - 0.36, v - 0.33) * 1.5);
      let body = mix(main, mix(main, [255, 255, 255], 0.45), light * 0.75);
      body = mix(body, mix(main, [0, 0, 0], 0.28), k * 0.55);
      // 边缘柔化
      const edge = Math.min(1, (0.42 - d) * 14);
      return mix(c, body, edge);
    }
    // 投影
    const sd = Math.hypot((u - 0.52) * 1.2, (v - 0.55) * 1.5);
    if (sd < 0.47) return mix(c, [190, 182, 172], (1 - sd / 0.47) * 0.20);
    return c;
  });
}
const dataUrl = buf => 'data:image/png;base64,' + buf.toString('base64');

/* ---------- HTTP ---------- */
let token = null;
async function req(path, opt = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opt.auth !== false && token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, {
    method: opt.method || 'GET',
    headers,
    body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: r.status, json, text };
}
const data = r => (r.json && r.json.data) || null;
const log = (...a) => console.log(...a);

/* ---------- 数据定义 ---------- */
const COLLECTIONS = [
  { handle: 'new', title: 'New in', sort: 1 },
  { handle: 'best-sellers', title: 'Best sellers', sort: 2 },
  { handle: 'sea-glass', title: 'Sea glass', sort: 3 },
  { handle: 'necklaces', title: 'Necklaces', sort: 4 },
  { handle: 'bracelets', title: 'Bracelets', sort: 5 },
  { handle: 'rings', title: 'Rings', sort: 6 },
];

const PRODUCTS = [
  { t: 'Tidepool Ring', cat: 'rings', price: 48, c1: '#9FBFB4', cls: ['rings', 'new', 'sea-glass'], desc: 'A single piece of sea glass, tumbled by the Atlantic for years before it reached us. Set in recycled sterling silver, no two stones are alike.', motif: 'sea glass', set: 'Tidepool', badge: 'New', sizes: ['5', '6', '7', '8', '9'] },
  { t: 'Golden Hour Necklace', cat: 'necklaces', price: 68, c1: '#D9B36C', cls: ['necklaces', 'best-sellers'], desc: 'Warm amber glass on a fine gold-filled chain. Catches light the way the last hour of sun does on wet sand.', motif: 'amber', set: 'Golden Hour', badge: 'Bestseller', sizes: [] },
  { t: 'Driftwood Bracelet', cat: 'bracelets', price: 52, c1: '#B7A48C', cls: ['bracelets', 'sea-glass'], desc: 'Matte frosted beads threaded on a waxed cord, finished with an adjustable slide knot. Waterproof, so it never has to come off.', motif: 'driftwood', set: 'Shoreline', badge: null, sizes: [] },
  { t: 'Salt & Sage Anklet', cat: 'anklets', price: 38, c1: '#93A98C', cls: ['sea-glass', 'new'], desc: 'Pale green glass on a 22 cm chain with a 3 cm extender. Made to be worn in the water and forgotten about.', motif: 'sage', set: 'Shoreline', badge: 'New', sizes: [] },
  { t: 'Harbour Studs', cat: 'hair', price: 35, c1: '#A9B6C4', cls: ['new'], desc: 'Two small glass cabochons, barely there. Our lightest piece at under 2 grams a side.', motif: 'harbour', set: 'Tidepool', badge: null, sizes: [] },
  { t: 'Low Tide Necklace', cat: 'necklaces', price: 74, c1: '#8FA6A0', cls: ['necklaces', 'best-sellers', 'sea-glass'], desc: 'Three stacked glass drops on a 45 cm chain. The height difference is deliberate: it moves like water finding its level.', motif: 'seafoam', set: 'Low Tide', badge: 'Bestseller', sizes: [] },
  { t: 'Pebble Stack Rings', cat: 'rings', price: 56, c1: '#C6BCAE', cls: ['rings', 'sea-glass'], desc: 'A set of three thin bands, meant to be worn together or split up. Each band is hammered by hand, so the surface stays slightly uneven.', motif: 'pebble', set: 'Tidepool', badge: null, sizes: ['6', '7', '8'] },
  { t: 'Moonstone Cuff', cat: 'bracelets', price: 78, c1: '#C3BCD6', cls: ['bracelets'], desc: 'An open cuff in brushed silver with a single moonstone cabochon. Adjustable by a few millimetres so it sits where you want it.', motif: 'moonstone', set: 'Night Water', badge: null, sizes: [] },
  { t: 'Sunbleached Hoops', cat: 'hair', price: 42, c1: '#E0D3C0', cls: ['new'], desc: 'Light 25 mm hoops with a frosted glass bead. The kind of thing you put on and stop thinking about.', motif: 'sunbleached', set: 'Shoreline', badge: 'New', sizes: [] },
  { t: 'Anchor Chain Bracelet', cat: 'bracelets', price: 64, c1: '#9AA3AC', cls: ['bracelets', 'best-sellers'], desc: 'A heavier link chain with a small glass charm at the clasp. Solid enough to stack with the Driftwood without competing.', motif: 'anchor', set: 'Shoreline', badge: 'Bestseller', sizes: [] },
  { t: 'Shoreline Anklet', cat: 'anklets', price: 44, c1: '#BFB49E', cls: ['sea-glass'], desc: 'Sand-toned glass chips on a fine chain. Sits close to the ankle, no dangling.', motif: 'sand', set: 'Shoreline', badge: null, sizes: [] },
  { t: 'Deep Water Ring', cat: 'rings', price: 85, c1: '#6E8290', cls: ['rings'], desc: 'Our darkest glass, almost navy until light hits it. A wide band with a flush setting so nothing catches on a sleeve.', motif: 'deep water', set: 'Night Water', badge: null, sizes: ['6', '7', '8', '9'] },
];

const COUPONS = [
  { code: 'WELCOME10', type: 'percent', value: 10, minSubtotal: 0, usageLimit: 500 },
  { code: 'SEA15', type: 'percent', value: 15, minSubtotal: 95, usageLimit: 200 },
];

/* ---------- 主流程 ---------- */
(async () => {
  if (!PASS) { console.error('缺少 ADMIN_PASS'); process.exit(2); }

  const lg = await req('/api/v1/admin/login', { auth: false, method: 'POST', body: { email: EMAIL, password: PASS } });
  token = data(lg) && data(lg).token;
  if (!token) { console.error('登录失败', lg.status, lg.text.slice(0, 200)); process.exit(1); }
  log('登录成功');

  /* 1. 图片 */
  const imgCache = {};
  for (const p of PRODUCTS) {
    if (imgCache[p.c1]) continue;
    const png = glassImage(p.c1, PRODUCTS.indexOf(p) % 3);
    const up = await req('/api/v1/admin/uploads', { method: 'POST', body: { dataUrl: dataUrl(png) } });
    const d = data(up);
    const rel = d && (d.path || d.url);
    if (!rel) { console.error('上传失败', p.t, up.status, up.text.slice(0, 160)); continue; }
    imgCache[p.c1] = rel;
  }
  log('图片已上传：' + Object.keys(imgCache).length + ' 张');

  /* 2. 集合 */
  const existCols = new Set(((await req('/api/v1/admin/collections').then(data)) || []).map(c => c.handle));
  for (const c of COLLECTIONS) {
    if (existCols.has(c.handle)) { log('集合已存在 ' + c.handle); continue; }
    const r = await req('/api/v1/admin/collections', { method: 'POST', body: c });
    log('建集合 ' + c.handle + ' → ' + r.status + (r.status >= 400 ? ' ' + r.text.slice(0, 120) : ''));
  }

  /* 3. 商品 */
  const made = [];
  for (const p of PRODUCTS) {
    const img = imgCache[p.c1];
    const body = {
      title: p.t, cat: p.cat, price: p.price, desc: p.desc,
      motif: p.motif, set: p.set, badge: p.badge,
      sizes: p.sizes,
      images: [img],
      collections: p.cls,
      details: [
        { k: 'Material', v: 'Recycled 925 sterling silver, sea glass' },
        { k: 'Chain', v: p.cat === 'necklaces' ? '45 cm with 5 cm extender' : 'Adjustable' },
        { k: 'Care', v: 'Waterproof. Rinse after salt water, dry with a soft cloth.' },
      ],
      variants: [
        { metal: 'Gold', stock: 8 },
        { metal: 'Silver', stock: 6 },
      ],
    };
    const r = await req('/api/v1/admin/products', { method: 'POST', body });
    if (r.status !== 201) { console.error('建商品失败 ' + p.t + ' → ' + r.status + ' ' + r.text.slice(0, 180)); continue; }
    const prod = data(r).product || data(r);
    // 上架
    const pub = await req('/api/v1/admin/products/' + prod.id, { method: 'PATCH', body: { active: true } });
    made.push({ id: prod.id, handle: prod.handle, title: prod.title, price: prod.price, pub: pub.status });
    log(`建商品 ${prod.id} ${p.t} $${p.price} → 上架 ${pub.status}${pub.status >= 400 ? ' ' + pub.text.slice(0, 140) : ''}`);
  }

  /* 4. 优惠券 */
  for (const c of COUPONS) {
    const r = await req('/api/v1/admin/coupons', { method: 'POST', body: c });
    log('建券 ' + c.code + ' → ' + r.status + (r.status >= 400 ? ' ' + r.text.slice(0, 120) : ''));
  }

  /* 校验 */
  const pub = await req('/api/v1/products?limit=50', { auth: false });
  const list = data(pub) || [];
  log('\n前台可见商品：' + list.length + ' 件');
  log('类目分布：' + JSON.stringify(list.reduce((a, x) => { a[x.category] = (a[x.category] || 0) + 1; return a; }, {})));
  const cols = await req('/api/v1/collections', { auth: false });
  log('前台集合：' + ((data(cols) || []).map(c => c.handle + '(' + c.count + ')').join(', ')));
  const boot = await req('/api/v1/bootstrap', { auth: false });
  log('导航项：' + ((data(boot) && data(boot).nav) || []).map(n => n.handle).join(', '));
  const h = await req('/api/v1/health', { auth: false });
  log('health：' + JSON.stringify(data(h)));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
