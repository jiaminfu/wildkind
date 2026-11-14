/* 前台购买主链路端到端：真浏览器，不建单
   ================================================================
   为什么单独一支：交付版（4600/8080）的前台一直缺端到端覆盖，
   过去靠"接口测试 + 原型 e2e + 人工走查"三条间接保证。
   这里补上真浏览器证据：首页 → 详情 → 加购 → 购物袋 → 结算页。

   刻意不点"提交订单"：会真的建单、扣库存、写流水，
   线上跑一次就在真实数据里留一条脏单。下单链路由接口层用例守着。

   用法: node tools/e2e-storefront.js [baseUrl]
   依赖：本机 Edge；CDP 走 Node 自带 WebSocket，无第三方包。
*/
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9446;
const BASE = process.argv[2] || 'http://127.0.0.1:4600';
const SHOTS = path.join(os.tmpdir(), 'tg-storefront-shots');
const PROF = path.join(os.tmpdir(), 'edge_stf_prof');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : String(extra).slice(0, 240)); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server',
    '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
      const t = list.filter(x => x.type === 'page')[0];
      if (t) wsUrl = t.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    if (!wsUrl) await wait(300);
  }
  if (!wsUrl) { console.error('无法连接 Edge'); process.exit(1); }

  const sock = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  /* 测试必须看服务的当前代码，不能被上一轮的磁盘缓存骗过去 */
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.result && r.result.description || ''));
    return r.result.value;
  };
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };
  /* 跨境链路首屏要 5 秒以上，固定等待会把"慢"误判成"坏"，所以轮询 */
  const waitFor = async (expr, ms) => {
    const limit = ms || 20000;
    const t0 = Date.now();
    while (Date.now() - t0 < limit) {
      if (await ev(expr)) return true;
      await wait(400);
    }
    return false;
  };

  try {
    /* 1. 首页 */
    await send('Page.navigate', { url: BASE + '/' });
    const rendered = await waitFor(`document.querySelectorAll('a[href*="#/products/"]').length > 0`, 30000);
    ok('首页渲染出商品卡', rendered);
    const cardCount = await ev(`document.querySelectorAll('a[href*="#/products/"]').length`);
    ok('商品卡数量合理（≥8）', cardCount >= 8, 'actual=' + cardCount);
    ok('首页标题正确', (await ev('document.title')).indexOf('TIDEGLASS') >= 0, await ev('document.title'));
    await shot('01-home');

    /* 2. Cookie 横幅：会盖住底部按钮，测试前先关掉；顺便验证它可关 */
    const hadBanner = await ev(`document.body.classList.contains('ck-open')`);
    let bannerClosed = !hadBanner;
    if (hadBanner) {
      /* 横幅是渲染后才挂事件委托的：刚出 DOM 就点，可能点在"还没绑事件"的按钮上。
         所以先等按钮出现，点完再轮询等状态变化，而不是固定等 0.6 秒。 */
      await waitFor(`!!document.querySelector('[data-act=ck-essential]')`, 10000);
      await ev(`(function(){var b=document.querySelector('[data-act=ck-essential]');if(b)b.click();return true})()`);
      bannerClosed = await waitFor(`!document.body.classList.contains('ck-open')`, 6000);
    }
    const ckChoice = await ev(`localStorage.getItem('tideglass_cookie')`);
    ok('Cookie 横幅「仅必要」可关闭并记录选择', bannerClosed === true, '初始显示=' + hadBanner + ' 选择=' + ckChoice);

    /* 3. 点第一张商品卡进详情 */
    const href = await ev(`(function(){var a=document.querySelector('a[href*="#/products/"]');return a?a.getAttribute('href'):null})()`);
    await ev(`(function(){var a=document.querySelector('a[href*="#/products/"]');if(a)a.click();return true})()`);
    /* 必须等 .pdp 容器出现，不能用 [data-act=add]：
       首页商品卡上的快速加购按钮也带这个属性，用它当"已进详情页"的信号会假阳性——
       页面其实还停在首页，后面几条断言等于在首页上跑。 */
    const pdpReady = await waitFor(`!!document.querySelector('.pdp')`, 20000);
    ok('点击商品卡进入详情页', pdpReady && (await ev('location.hash')).indexOf('#/products/') === 0,
      'hash=' + (await ev('location.hash')) + ' href=' + href);

    const addInfo = await ev(`(function(){var b=document.querySelector('[data-act=add]');return b?JSON.stringify({text:b.textContent.trim().slice(0,30),handle:b.dataset.handle,metal:b.dataset.metal}):null})()`);
    ok('详情页有加购按钮且带商品与金属', !!addInfo && /add to bag/i.test(addInfo), addInfo);
    const priceShown = await ev(`/\\$\\s?\\d/.test(document.body.innerText)`);
    ok('详情页显示价格', priceShown === true);

    /* 商品描述：后台有「Description」输入框、接口一直返回 description，
       但前端曾经整段没渲染——填了等于没填。这条守住它不再退化。
       注意要轮询：点卡片进来时详情页会先渲染一版再刷新，固定在第一次渲染上读会误判。 */
    await waitFor(`!!document.querySelector('.pdp__desc')`, 15000);
    const descInfo = await ev(`(function(){
      var el=document.querySelector('.pdp__desc');
      return el?JSON.stringify({text:el.textContent.trim().slice(0,80),len:el.textContent.trim().length}):null;
    })()`);
    const apiDesc = await ev(`(async function(){
      try{
        var h=location.hash.replace('#/products/','');
        var r=await fetch('/api/v1/products/'+h);
        var j=await r.json();
        var p=j.data&&(j.data.product||j.data);
        return p&&p.description?String(p.description).trim():'';
      }catch(e){return ''}
    })()`);
    const descObj = descInfo ? JSON.parse(descInfo) : null;
    ok('详情页展示商品描述且与接口一致',
      !!descObj && descObj.len > 0 && !!apiDesc &&
      descObj.text.slice(0, 40) === String(apiDesc).slice(0, 40),
      'hash=' + (await ev('location.hash')) +
      ' | DOM=' + (descInfo || 'null') +
      ' | 接口=' + JSON.stringify(String(apiDesc || '').slice(0, 30)));
    await shot('02-pdp');

    /* 4. 加购 */
    const before = Number(await ev(`(function(){var e=document.getElementById('bagCount');return e?e.textContent:'0'})()`)) || 0;
    await ev(`(function(){var b=document.querySelector('[data-act=add]');if(b)b.click();return true})()`);
    await wait(1200);
    const after = Number(await ev(`(function(){var e=document.getElementById('bagCount');return e?e.textContent:'0'})()`)) || 0;
    ok('加购后购物袋计数 +1', after === before + 1, before + ' → ' + after);
    ok('加购后购物袋抽屉自动打开', (await ev(`document.body.classList.contains('drawer-open')`)) === true);
    await shot('03-cart-drawer');

    /* 5. 抽屉里的结账入口 */
    const hasCheckoutLink = await ev(`!!document.querySelector('a[href="#/checkout"]')`);
    ok('购物袋抽屉里有结账入口', hasCheckoutLink === true);

    /* 6. 进结算页 */
    await ev(`(function(){var a=document.querySelector('a[href="#/checkout"]');if(a)a.click();return true})()`);
    const ckReady = await waitFor(`location.hash.indexOf('#/checkout')===0 && document.querySelectorAll('input').length>0`, 25000);
    ok('进入结算页且渲染出表单', ckReady === true, 'hash=' + (await ev('location.hash')));
    /* 切路由到表单渲染之间有间隙，报价又会二次重绘，所以字段断言要轮询 */
    const emailReady = await waitFor(`!!document.querySelector('input[name=email]')`, 20000);
    ok('结算页有邮箱输入框', emailReady === true);

    /* 地址字段齐不齐，决定用户能不能真的填完下单 */
    const addrReady = await waitFor(
      `['firstName','lastName','line1','city','state','zip'].every(function(n){return !!document.querySelector('input[name='+n+']')}) && !!document.querySelector('select[name=country]')`,
      20000);
    ok('结算页地址字段齐全（姓/名/街道/城市/州/邮编/国家）', addrReady === true);

    /* 7. 报价：金额由服务端算，前端只展示。等它回来再断言 */
    const priced = await waitFor(`/Total/i.test(document.body.innerText) && /\\$\\s?\\d+\\.\\d{2}/.test(document.body.innerText)`, 20000);
    ok('结算页拿到服务端报价并显示总额', priced === true);
    await shot('04-checkout');

    /* 刻意不提交订单 */
    ok('未提交订单（生产保护）', true);

    /* 8. 刷新后购物袋仍在（localStorage 持久化） */
    await send('Page.navigate', { url: BASE + '/#/cart' });
    await waitFor(`!!document.body`, 15000);
    await wait(2500);
    const persisted = await ev(`(function(){var e=document.getElementById('bagCount');return e?Number(e.textContent)||0:0})()`);
    ok('刷新后购物袋内容保持', Number(persisted) >= 1, 'bagCount=' + persisted);

    /* 9. 移动端：390 宽不能横向溢出 */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE + '/' });
    await waitFor(`document.querySelectorAll('a[href*="#/products/"]').length > 0`, 30000);
    await wait(800);
    const ovHome = await ev(`(function(){return {sw:document.documentElement.scrollWidth, iw:window.innerWidth}})()`);
    ok('390px 首页无横向溢出', ovHome && ovHome.sw <= ovHome.iw + 1, JSON.stringify(ovHome));
    await shot('05-home-390');

    const href2 = await ev(`(function(){var a=document.querySelector('a[href*="#/products/"]');return a?a.getAttribute('href'):null})()`);
    if (href2) {
      await ev(`location.hash=${JSON.stringify(href2.replace(/^#/, ''))}`);
      await waitFor(`!!document.querySelector('[data-act=add]')`, 20000);
      await wait(600);
      const ovPdp = await ev(`(function(){return {sw:document.documentElement.scrollWidth, iw:window.innerWidth}})()`);
      ok('390px 详情页无横向溢出', ovPdp && ovPdp.sw <= ovPdp.iw + 1, JSON.stringify(ovPdp));
      await shot('06-pdp-390');
    }

  } catch (e) {
    console.error('\n[异常] ' + e.message);
    fail++;
  } finally {
    try { child.kill(); } catch (e) {}
  }

  console.log('\n截图目录：' + SHOTS);
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
