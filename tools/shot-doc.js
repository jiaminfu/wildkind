/* 交付文档用截图：一次启动浏览器，登录后循环截取「前台 + 后台」全部页面。
   与 shot-state.js 的区别：整页截图（captureBeyondViewport），一个会话内批量跑，适合归档。
   用法：node tools/shot-doc.js <outDir> [--only=admin] [--w=1440]
*/
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 200);
const BASE = process.env.BASE || 'http://127.0.0.1:4600';
const OUT = process.argv[2] || path.join(__dirname, '..', 'handover', '06-原型', 'screenshots');
const onlyArg = (process.argv.find(a => a.indexOf('--only=') === 0) || '').split('=')[1] || 'all';
const W = Number((process.argv.find(a => a.indexOf('--w=') === 0) || '').split('=')[1] || 1440);

const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

// 每项：[文件名, hash 路由, 出现即视为渲染完成的等待选择器, 分组]
const ADMIN = [
  ['admin-01-dashboard', '#/admin', '.adm__body', 'admin'],
  ['admin-02-orders', '#/admin/orders', '.adm__body', 'admin'],
  ['admin-03-products', '#/admin/products', '.adm__body', 'admin'],
  ['admin-04-inventory', '#/admin/inventory', '.adm__body', 'admin'],
  ['admin-05-coupons', '#/admin/coupons', '.adm__body', 'admin'],
  ['admin-06-reviews', '#/admin/reviews', '.adm__body', 'admin'],
  ['admin-07-customers', '#/admin/customers', '.adm__body', 'admin'],
  ['admin-08-ledger', '#/admin/ledger', '.adm__body', 'admin'],
  ['admin-09-audit', '#/admin/audit', '.adm__body', 'admin'],
  ['admin-10-settings', '#/admin/settings', '.adm__body', 'admin'],
];
const STORE = [
  ['store-01-home', '#/', '.hdr', 'store'],
  ['store-02-collection', '#/collections/best-sellers', '.grid', 'store'],
  ['store-03-product', '#/products/moonlit-hare-necklace', '.pdp', 'store'],
  ['store-04-cart', '#/cart', '#main', 'store'],
  ['store-05-checkout', '#/checkout', '#main', 'store'],
  ['store-06-account', '#/account', '#main', 'store'],
  ['store-07-lookup', '#/account/lookup', '#main', 'store'],
  ['store-08-about', '#/pages/about', '.prose', 'store'],
  ['store-09-faq', '#/pages/faq', '.faq-item', 'store'],
  ['store-10-returns', '#/pages/returns', '.prose', 'store'],
  ['store-11-custom', '#/custom', 'form[data-act=custom-req]', 'store'],
];

const JOBS = onlyArg === 'admin' ? ADMIN : onlyArg === 'store' ? STORE : ADMIN.concat(STORE);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PROF = path.join(os.tmpdir(), 'edge_doc_prof_' + PORT);
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, '--window-size=' + W + ',900', 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { list = v; break; } } catch (e) { }
    await wait(250);
  }
  if (!list) { console.error('无法连接 CDP'); proc.kill(); process.exit(1); }
  const page = list.filter(x => x.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description) : r.result.value;
  };

  if (W < 700) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: true });
  }

  // 先落地首页并在同源上下文里登录后台，把令牌写进 localStorage
  await send('Page.navigate', { url: BASE + '/#/admin' });
  await wait(1800);
  // 后台登录页：未登录访问 #/admin 的第一屏，是「后端原型」的入口，必须留一张。
  // 新 profile 天然没有令牌，不用清 localStorage；但要等 .loginwrap 出现 ——
  // /bootstrap 是异步的，早截只会拿到 "Loading..." 骨架屏。
  if (onlyArg !== 'store') {
    for (let i = 0; i < 40; i++) {
      if (await ev(`!!document.querySelector('.loginwrap')`) === true) break;
      await wait(200);
    }
    await wait(500);
    const lh = Math.min(Number(await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')) || 900, 4000);
    const lw = Number(await ev('document.documentElement.clientWidth')) || W;
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: lw, height: lh, scale: 1 }
    });
    fs.writeFileSync(path.join(OUT, 'admin-00-login.png'), Buffer.from(shot.data, 'base64'));
    console.log('  ✓ admin-00-login  (' + lh + 'px)');
  }

  const login = await ev(`(async()=>{
    try{
      const r = await fetch('/api/v1/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:'owner@tideglassjewelry.com',password:'tideglass2026'})});
      const j = await r.json();
      if(!j.data||!j.data.token) return 'login-fail:'+JSON.stringify(j).slice(0,120);
      localStorage.setItem('tideglass_admin', JSON.stringify({token:j.data.token, staff:j.data.staff}));
      return 'ok';
    }catch(e){ return 'ERR '+e.message; }
  })()`);
  console.log('后台登录：' + login);

  // 关掉 Cookie 同意条：它是 position:fixed，整页截图时会浮在页面中段挡住正文。
  // 该条只在 tideglass_cookie 为空时渲染，所以要先写值再重载。
  await ev(`localStorage.setItem('tideglass_cookie','all')`);
  await send('Page.reload', { ignoreCache: false });
  await wait(1500);

  // 购物车/结算页在空车时只渲染空态，截图就失去意义：先灌两条真实行项目（价格与库存取自接口实测值）
  const CART_SEED = [
    { productId: 'TG-102', handle: 'moonlit-hare-necklace', title: 'Moonlit Hare Necklace', image: 'assets/img/opt/p-necklace-moon-silver.jpg', metal: 'Silver', size: '16"', qty: 1, unitPrice: 76, stock: 10 },
    { productId: 'TG-101', handle: 'foxtrot-pendant-necklace', title: 'Foxtrot Pendant Necklace', image: 'assets/img/opt/p-necklace-fox-gold.jpg', metal: 'Gold', size: '18"', qty: 1, unitPrice: 85, stock: 37 }
  ];

  let ok = 0, bad = 0, cartSeeded = false;
  for (const [name, hash, sel] of JOBS) {
    // 注入后必须整页重载：内存里的 state.cart 是在首屏加载时读的，改 hash 不会重新读取
    // 注意 hash 以 '#' 开头，'/cart' 的索引是 1 而不是 0
    if (!cartSeeded && (hash.indexOf('/cart') > -1 || hash.indexOf('/checkout') > -1)) {
      await ev(`localStorage.setItem('tideglass_cart_v1', ${JSON.stringify(JSON.stringify(CART_SEED))})`);
      await send('Page.reload', { ignoreCache: false });
      await wait(1800);
      cartSeeded = true;
    }
    // hash 改动必须让渲染器重新跑一次：先回落到中性路由，再跳目标，避免同 hash 不触发
    await ev(`location.hash='#/_reset'`);
    await wait(120);
    await ev(`location.hash=${JSON.stringify(hash)}`);
    let hit = false;
    for (let i = 0; i < 40; i++) {
      if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`) === true) { hit = true; break; }
      await wait(200);
    }
    await wait(500);
    // 整页高度：取滚动高度，避免长表格被截断
    const h = Math.min(Number(await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')) || 900, 4000);
    // 宽度必须取 clientWidth 而不是命令行给的 W：有垂直滚动条时视口实际窄 15px，
    // 按 1440 截会多截 15px 视口外区域，而 .drawer 是 translateX(100%) 藏在右边缘外侧的，
    // 正好被这 15px 切出半截文字，看起来像页面右侧有溢出。
    const cw = Number(await ev('document.documentElement.clientWidth')) || W;
    await ev('window.scrollTo(0,0)');
    await wait(200);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: cw, height: h, scale: 1 }
    });
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    if (hit) { ok++; console.log('  ✓ ' + name + '  (' + h + 'px)'); }
    else { bad++; console.log('  ! ' + name + '  选择器未命中 ' + sel); }
  }

  console.log('\n完成 ' + ok + ' 张，异常 ' + bad + ' 张 → ' + OUT);
  sock.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
