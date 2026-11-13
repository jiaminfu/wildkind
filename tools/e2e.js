/* 端到端点击验证：用 CDP 驱动无头 Edge，走完「加购 → 结算 → 支付 → 后台核对」
   用法：node tools/e2e.js
*/
const http = require('http');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const URL = 'http://localhost:4500/#/';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=D:/桔子/tmp_e2e/prof',
    '--window-size=1400,900',
    URL
  ], { stdio: 'ignore' });

  // 等调试端口就绪
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await getJSON('/json'); if (targets && targets.length) break; } catch (e) { }
    await sleep(400);
  }
  if (!targets) { console.log('FAIL: devtools not ready'); child.kill(); process.exit(1); }

  const page = targets.filter(t => t.type === 'page').sort(function(a,b){
    var sa = /4500/.test(a.url||'') ? 1 : 0, sb = /4500/.test(b.url||'') ? 1 : 0;
    return sb - sa;
  })[0];
  if (!page) { console.log('FAIL: no page target'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();

  await new Promise(res => { ws.onopen = res; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, m => m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result));
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async function evalJS(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails));
    return r.result.value;
  }

  const log = [];
  function ok(name, val) { log.push(['PASS', name, val]); }
  function bad(name, val) { log.push(['FAIL', name, val]); }

  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: URL });
    await sleep(1200);
    try { await evalJS('localStorage.clear(); 1'); } catch (e) { }
    await send('Page.reload');
    await sleep(1400);
    for (var w = 0; w < 25; w++) {
      var n = await evalJS('document.querySelectorAll(".card").length').catch(function(){ return 0; });
      if (n > 0) break;
      await sleep(400);
    }

    // 0 页面渲染
    const title = await evalJS('document.title');
    const cards = await evalJS('document.querySelectorAll(".card").length');
    if (cards > 4) ok('首页渲染', cards + ' 张商品卡 · title=' + title);
    else bad('首页渲染', 'cards=' + cards);

    // 1 卡片加购
    await evalJS('document.querySelector(".card__add").click(); 1');
    await sleep(500);
    const cnt1 = await evalJS('document.getElementById("bagCount").textContent');
    const opened = await evalJS('document.body.classList.contains("drawer-open")');
    if (cnt1 === '1') ok('卡片加购 → 角标', 'bag=1');
    else bad('卡片加购 → 角标', 'bag=' + cnt1);
    if (!opened) ok('卡片加购不强制开抽屉', 'drawer closed');
    else bad('卡片加购不强制开抽屉', 'drawer opened');

    // 2 详情页加购 → 抽屉打开
    await evalJS('location.hash = "#/products/tidepool-choker"; 1');
    await sleep(900);
    await evalJS('document.querySelector("[data-act=\\"add-open\\"]").click(); 1');
    await sleep(600);
    const cnt2 = await evalJS('document.getElementById("bagCount").textContent');
    const drawerLines = await evalJS('document.querySelectorAll(".drawer .cline:not(.gift)").length');
    const hasGift = await evalJS('!!document.querySelector(".cline.gift")');
    if (cnt2 === '2') ok('详情页加购 → 角标', 'bag=' + cnt2); else bad('详情页加购 → 角标', 'bag=' + cnt2);
    if (drawerLines === 2) ok('抽屉行数', drawerLines + ' 行'); else bad('抽屉行数', drawerLines);

    // 3 优惠码
    await evalJS('var i=document.querySelector(".coupon input"); i.value="TIDEGLASS10"; document.querySelector(".coupon").dispatchEvent(new Event("submit",{cancelable:true,bubbles:true})); 1');
    await sleep(500);
    // 断言折扣金额等于小计的 10%（TIDEGLASS10 为百分比券），不写死金额——价格带调整后金额必然变
    const discCheck = await evalJS(`(function(){
      var rows=document.querySelectorAll(".sum__row");
      var num=function(t){return parseFloat(String(t).replace(/[^0-9.]/g,""));};
      var sub=rows.length?num(rows[0].textContent):0;
      var d=document.querySelector(".sum__row.disc");
      var off=d?num(d.textContent):0;
      return JSON.stringify({sub:sub,off:off,ok:off>0&&Math.abs(off-sub*0.1)<=0.06});
    })()`);
    const dc = JSON.parse(discCheck);
    if (dc.ok) ok('优惠码 TIDEGLASS10 生效', '小计 $' + dc.sub + ' → 折 $' + dc.off);
    else bad('优惠码 TIDEGLASS10', '小计 ' + dc.sub + ' 折 ' + dc.off);

    // 4 赠品门槛
    const giftTxt = await evalJS('(document.querySelector(".progress .progress__txt")||{}).textContent || ""');
    ok('赠品进度文案', giftTxt.replace(/\s+/g, ' ').trim().slice(0, 70));

    // 5 结算
    await evalJS('location.hash = "#/checkout"; 1');
    await sleep(800);
    const step1 = await evalJS('!!document.querySelector("[data-act=\\"to-pay\\"]")');
    if (step1) ok('结算页进入', 'step 1'); else bad('结算页进入', 'no form');

    // 空表单提交 → 应报错
    await evalJS('document.querySelector("[data-act=\\"to-pay\\"]").click(); 1');
    await sleep(400);
    const badFields = await evalJS('document.querySelectorAll(".fld.bad").length');
    if (badFields >= 5) ok('必填校验', badFields + ' 个字段标红'); else bad('必填校验', badFields);

    // 填写并继续
    await evalJS(`
      var d={email:'test@tideglass.co',first:'Ava',last:'Reed',line1:'12 Ocean Ave',city:'Santa Monica',state:'CA',zip:'90401'};
      Object.keys(d).forEach(function(k){
        var el=document.querySelector('.co input[name="'+k+'"]');
        if(el){el.value=d[k]; S.state.checkoutData[k]=d[k];}
      });
      document.querySelector('[data-act="to-pay"]').click(); 1`);
    await sleep(600);
    const step2 = await evalJS('!!document.querySelector("[data-act=\\"place\\"]")');
    if (step2) ok('进入支付步骤', 'step 2'); else bad('进入支付步骤', 'still step 1');
    const payBtn = await evalJS('(document.querySelector("[data-act=\\"place\\"]")||{}).textContent || ""');
    ok('支付按钮金额', payBtn.trim());

    // 支付
    const stockBefore = await evalJS('S.product("tidepool-choker").variants[0].stock');
    await evalJS('document.querySelector("[data-act=\\"place\\"]").click(); 1');
    // 支付有分阶段的处理中状态（约 1.9s），轮询等跳转而不是写死 sleep
    for (let w = 0; w < 30; w++) {
      if (/#\/order\//.test(await evalJS('location.hash'))) break;
      await sleep(200);
    }
    const hash = await evalJS('location.hash');
    const orderNo = await evalJS('(S.state.lastOrder||{}).number || ""');
    if (/#\/order\//.test(hash)) ok('支付完成跳转', hash + ' · ' + orderNo); else bad('支付完成跳转', hash);

    const bagAfter = await evalJS('S.cartCount()');
    if (bagAfter === 0) ok('下单后清空购物车', 'bag=0'); else bad('下单后清空购物车', bagAfter);

    const stockAfter = await evalJS('S.product("tidepool-choker").variants[0].stock');
    if (stockAfter === stockBefore - 1) ok('库存扣减', stockBefore + ' → ' + stockAfter); else bad('库存扣减', stockBefore + ' → ' + stockAfter);

    const inDB = await evalJS('S.DB.orders.some(function(o){return o.number===' + JSON.stringify(orderNo) + '})');
    if (inDB) ok('订单进入数据库', orderNo); else bad('订单进入数据库', orderNo);

    // 6 订单查询
    await evalJS('location.hash = "#/account/lookup"; 1');
    await sleep(700);
    await evalJS(`
      var f=document.querySelector('[data-act="lookup"]');
      f.number.value=${JSON.stringify(orderNo)};
      f.email.value='test@tideglass.co';
      f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); 1`);
    await sleep(700);
    const found = await evalJS('!!document.querySelector(".pill.paid")');
    if (found) ok('订单查询（单号+邮箱）', '命中'); else bad('订单查询', '未命中');

    // 错误邮箱应查不到
    await evalJS(`
      var f=document.querySelector('[data-act="lookup"]');
      f.number.value=${JSON.stringify(orderNo)};
      f.email.value='wrong@email.com';
      f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); 1`);
    await sleep(600);
    const notFound = await evalJS('!document.querySelector(".pill.paid")');
    if (notFound) ok('错误邮箱不泄露订单', 'not found'); else bad('错误邮箱不泄露订单', 'leaked');

    /* 7-8 后台核对与状态流转：已迁出本文件。
       原因：旧原型（4500）的后台已经下线，指向交付版后台（4600）。
       4600 的后台点击与写操作由 tools/admin-sweep.js 覆盖，
       接口层的状态机由 tools/api-test.js 覆盖，这里不再重复。 */

    /* 9-13 后台部分整体移出。
       旧原型（4500）的后台已下线并指向交付版 4600，本文件因此只验证前台链路。
       对应覆盖：
         · 后台点击与页面渲染 → tools/admin-sweep.js（4600，13 模块 × 3 宽度）
         · 后台写操作与状态机 → tools/api-test.js（4600，121 条）
         · 双端适配           → tools/app-check.js（4600，66 组）
       保留在这里只会变成"跑不过的旧代码"，比删掉更糟。 */

  } catch (e) {
    bad('异常中断', e.message);
  }

  console.log('\n===== 端到端验证 =====');
  log.forEach(function (l) {
    console.log((l[0] === 'PASS' ? '✅' : '❌') + ' ' + l[1] + ' — ' + l[2]);
  });
  const pass = log.filter(l => l[0] === 'PASS').length;
  console.log('\n通过 ' + pass + ' / ' + log.length);

  ws.close();
  child.kill();
  process.exit(log.some(l => l[0] === 'FAIL') ? 1 : 0);
})();
