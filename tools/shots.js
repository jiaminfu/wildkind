// 批量截屏：用 CDP 驱动无头 Edge，逐路由整页截图（零依赖）
// 用法: node tools/shots.js [outDir]
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const BASE = 'http://localhost:4500';
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'shots');
const ONLY = process.argv[3] || '';

const PROF = path.join(require('os').tmpdir(), 'edge_shots_prof');

const JOBS = [
  // [hash, 文件名, 宽, 高]
  ['/', 'home', 1440, 2400],
  ['/collections/necklaces', 'collection', 1440, 1600],
  ['/products/foxtrot-pendant-necklace', 'product', 1440, 1900],
  ['/checkout?demo=cart', 'checkout', 1440, 1400],
  ['/account', 'account', 1440, 900],
  ['/order/%23WK1041', 'order-done', 1440, 1100],
  ['/pages/about', 'page-story', 1440, 1200],
  ['/search', 'search', 1440, 900],
  ['/search?q=pearl', 'search-results', 1440, 1400],
  ['#/admin/login', 'admin-login', 1440, 900],
  ['#/admin?demo=1', 'admin-dash', 1440, 1500],
  ['#/admin/orders?demo=1', 'admin-orders', 1440, 1200],
  ['#/admin/orders/%23WK1041?demo=1', 'admin-order-detail', 1440, 1600],
  ['#/admin/products?demo=1', 'admin-products', 1440, 1200],
  ['#/admin/products/foxtrot-pendant-necklace?demo=1', 'admin-product-edit', 1440, 1600],
  ['#/admin/inventory?demo=1', 'admin-inventory', 1440, 1200],
  ['#/admin/collections?demo=1', 'admin-collections', 1440, 1200],
  ['#/admin/marketing?demo=1', 'admin-marketing', 1440, 1300],
  ['#/admin/reviews?demo=1', 'admin-reviews', 1440, 1300],
  ['#/admin/custom?demo=1', 'admin-custom', 1440, 1100],
  ['#/admin/customers?demo=1', 'admin-customers', 1440, 1100],
  ['#/admin/content?demo=1', 'admin-content', 1440, 1100],
  ['#/admin/settings?demo=1', 'admin-settings', 1440, 1100],
  ['/account/login?demo=guest', 'acc-login', 1440, 1000],
  ['/account/register?demo=guest', 'acc-register', 1440, 1100],
  ['/account?demo=account', 'acc-hub', 1440, 1200],
  ['/account/orders?demo=account', 'acc-orders', 1440, 1200],
  ['/account/orders/%23WK1045?demo=account', 'acc-order-detail', 1440, 1300],
  ['/account/addresses?demo=account', 'acc-addresses', 1440, 1000],
  ['/account/wishlist?demo=account', 'acc-wishlist', 1440, 900],
  ['/account/settings?demo=account', 'acc-settings', 1440, 1200],
  ['/checkout?demo=pay', 'co-pay', 1440, 1500],
  ['/collections/necklaces', 'm-collection', 520, 1400],
  ['/products/foxtrot-pendant-necklace', 'm-product', 520, 1700],
  ['/account?demo=account', 'm-account', 520, 1200],
  ['/account/login?demo=guest', 'm-login', 520, 1100],
];

// 只在后台路由后追加 query（前台 hash 里带 ? 会被当参数）
JOBS.forEach(j => { if (j[0].startsWith('#/admin') && j[0].indexOf('?') < 0) j[0] += '?demo=1'; });

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function findWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
      const t = list.filter(x => x.type === 'page' && (x.url || '').indexOf('4500') >= 0 || (x.url || '').indexOf('blank') >= 0);
      if (t.length) return t[0].webSocketDebuggerUrl;
    } catch (e) { }
    await wait(300);
  }
  throw new Error('no target');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF,
    '--window-size=1440,1200',
    'about:blank'
  ], { stdio: 'ignore' });

  const wsUrl = await findWs();
  const sock = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
  });
  await new Promise(r => sock.addEventListener('open', r));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });

  // 先登录后台会话，使 admin 页面可渲染
  await send('Page.navigate', { url: BASE + '/#/admin?demo=1' });
  await wait(1500);

  for (const [hash, name, w, h] of JOBS) {
    if (ONLY && name.indexOf(ONLY) < 0) continue;
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1,
      mobile: w < 700, screenWidth: w, screenHeight: h
    });
    const url = hash.startsWith('#') ? BASE + '/' + hash : BASE + '/#' + hash;
    await send('Page.navigate', { url });
    await wait(1100);
    let ch = h;
    try {
      const m = await send('Page.getLayoutMetrics');
      const cs = m.cssContentSize || m.contentSize;
      if (cs && cs.height) ch = Math.min(Math.ceil(cs.height), 6000);
    } catch (e) { }
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height: ch, scale: 1 }
    });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('shot', name, w + 'x' + h);
  }

  sock.close();
  child.kill();
  console.log('OUT=' + OUT);
  process.exit(0);
}

try { main(); } catch (e) { console.error(e); process.exit(1); }
