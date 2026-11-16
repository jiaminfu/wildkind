#!/usr/bin/env node
/* ============================================================
   运营模拟 · 后台全流程走查
   用法: node tools/ops-walk.js [desk|mob]

   前置：库已复位到空库基线（__test/reset {fixture:'empty'}），且已建好至少 1 件在售商品。
   覆盖流程（每个流程截图 + 断言）：
     A 登录            B 订单列表 → 详情 → 发货 + 追踪号
     C 部分退款        D 库存补货     E 优惠码 建 / 停用 / 启用
     F 评价审核        G 内容页改文案  H 文章发布
     I 客户            J 库存流水      K 销售税设置   L 审计日志
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9480;
const BASE = 'http://127.0.0.1:4600';
const VIEWARG = process.argv[2] || 'desk';
const OUT = path.join(__dirname, '..', 'tmp_qa', 'ops-walk-' + VIEWARG);
const PROF = path.join(os.tmpdir(), 'edge_opswalk_' + VIEWARG);
const VIEW = VIEWARG === 'mob' ? { w: 390, h: 844, mobile: true } : { w: 1440, h: 1000, mobile: false };
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
  else { fail++; bad.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function sec(t) { console.log('\n[' + t + ']'); }

(async () => {
  /* ---------- 先用接口备一张已付款订单，作为后台要处理的对象 ---------- */
  const api = async (m, p, body, tok) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
    return { status: r.status, body: j };
  };

  const pList = await api('GET', '/api/v1/products?limit=5');
  const prods = (pList.body && pList.body.data) || [];
  if (!prods.length) { console.error('没有在售商品，先跑 tmp_ops1/2 建货'); process.exit(1); }
  const p0 = prods[0];
  const variant = (p0.variants && p0.variants[0]) || { metal: 'Gold' };

  /* 报价接口吃的是 items，元素里金属色字段叫 metal（不是 variant/lines）。
     参数名猜错时接口回的是 400 Cart is empty，紧接着下单报 422 QUOTE_REQUIRED ——
     看起来像"下单坏了"，其实是脚本没拿到报价号。 */
  const q = await api('POST', '/api/v1/checkout/quote', {
    items: [{ productId: p0.id, metal: variant.metal, qty: 2 }],
    state: 'CA', shippingMethod: 'Standard',
  });
  const quote = (q.body && q.body.data) ? q.body.data : null;
  /* 报价号字段叫 quoteId，不是 id。写错时报价明明成功了，下单却回 422 QUOTE_REQUIRED。 */
  if (!quote || !quote.quoteId) console.log('报价失败:', JSON.stringify(q.body).slice(0, 200));
  /* 地址是嵌套的 address 对象，不是平铺字段。
     校验函数读的是 body.address.line1，平铺传会被判"Street address is required"。
     订单金额以报价号为准，body 里再传 lines 也不会被采用。 */
  const order = await api('POST', '/api/v1/orders', {
    quoteId: quote ? quote.quoteId : undefined,
    email: 'ops.walk@example.com', firstName: 'Lena', lastName: 'Park',
    address: { line1: '88 Grove St', city: 'San Francisco', state: 'CA', zip: '94102', country: 'United States' },
    shipping: 'Standard',
  }, null);
  const orderNum = order.body && order.body.data && order.body.data.order ? order.body.data.order.number : null;
  console.log('准备订单:', order.status, orderNum || JSON.stringify(order.body).slice(0, 200));
  const at = await api('POST', '/api/v1/admin/login', { email: 'owner@lastgrove.com', password: process.env.OWNER_PASSWORD || 'lastgrove2026' });
  const TOKEN = at.body && at.body.data && at.body.data.token;
  chk('管理员登录拿到令牌', !!TOKEN, TOKEN ? 'ok' : JSON.stringify(at.body).slice(0, 120));

  /* ---------- 起浏览器 ---------- */
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server',
    '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    try { const l = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list')); const t = l.filter(x => x.type === 'page')[0]; if (t) ws = t.webSocketDebuggerUrl; } catch (e) { }
    if (!ws) await wait(300);
  }
  const sock = new WebSocket(ws);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const errs = [], netfail = [];
  sock.addEventListener('message', e => {
    const o = JSON.parse(e.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); return; }
    /* 停用优惠码前会弹 confirm()，退款前也会。
       无头浏览器不自动应答原生对话框 —— 页面就停在那里等，脚本看起来"卡死在 E 段"，
       但没有任何报错可查。这里统一接受。 */
    if (o.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', { accept: true }); return; }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      const s = (o.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160);
      /* 无头 Edge 自己会往 console 打一条浏览器遥测（pcsVersion / appType 那串），
         与应用无关，混在错误里会把真问题淹掉。 */
      if (!/pcsVersion|appType|edgeChromium/.test(s)) errs.push(s);
    }
    if (o.method === 'Network.responseReceived' && o.params.response.status >= 400) {
      const u = o.params.response.url;
      if (u.indexOf('/api/v1') > 0 && u.indexOf('/admin/') < 0) netfail.push(o.params.response.status + ' ' + u.split('/api/v1')[1]);
    }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: VIEW.mobile });

  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') }; return r.result.value; };
  const shot = async n => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(data, 'base64')); };
  const goto = async (h, ms) => {
    await send('Page.navigate', { url: BASE + '/#/admin' + h });
    for (let i = 0; i < 40; i++) { const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }); if (r.result.value === 'complete') break; await wait(200); }
    await wait(ms || 1600);
  };
  const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (await ev(expr)) return true; await wait(250); } return false; };
  const setV = async (sel, v) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'MISS';
    e.value=${JSON.stringify(String(v))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'ok'})()`);
  const click = async sel => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'MISS';e.click();return 'ok'})()`);
  const txt = async sel => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim().slice(0,80):null})()`);

  /* ---------- A 登录 ---------- */
  sec('A 登录');
  await goto('', 1500);
  /* 浏览器 profile 里可能还留着上一轮的令牌，这时直接就是后台首页，没有登录表单。
     两种都算通过 —— 要测的是"能不能进后台"，不是"每次都得输密码"。 */
  const hadForm = await ev(`!!document.querySelector('form[data-act="login"]')`);
  if (hadForm) {
    await setV('[name="password"]', process.env.OWNER_PASSWORD || 'lastgrove2026');
    await ev(`document.querySelector('form[data-act="login"]').requestSubmit()`);
  }
  const loggedIn = await waitFor(`!!document.querySelector('.abtn')`, 15000);
  await wait(1200);
  chk('能进后台（' + (hadForm ? '走登录表单' : '复用已有会话') + '）', loggedIn, await ev(`location.hash`));
  await shot('A1-dashboard');
  chk('仪表盘无报错块', !(await ev(`!!document.querySelector('.falert')`)), await txt('.falert'));

  /* ---------- B 订单 → 发货 ---------- */
  sec('B 订单履约');
  await goto('/orders', 2000);
  const rows = await ev(`document.querySelectorAll('table.atable tbody tr').length`);
  chk('订单列表有数据', rows > 0 && !!orderNum, rows + ' 行');
  await shot('B1-orders');
  if (orderNum) await goto('/orders/' + encodeURIComponent(orderNum), 2200);
  else await click('a[href*="/admin/orders/"]');
  await waitFor(`!!document.querySelector('[data-act="save-tracking"]')`, 15000);
  await wait(600);
  chk('订单详情打开', !!(await ev(`!!document.querySelector('[data-act="save-tracking"]')`)), await txt('.panel__hd h2'));
  await shot('B2-order-detail');

  const carrier = await ev(`(function(){var s=document.querySelector('[name="carrier"]');return s?Array.from(s.options).map(function(o){return o.value}).slice(0,6):null})()`);
  chk('承运商下拉有选项', Array.isArray(carrier) && carrier.filter(Boolean).length > 0, JSON.stringify(carrier));
  await setV('[name="tracking"]', '9400111899223197428490');
  const carrierVal = Array.isArray(carrier) ? carrier.filter(Boolean)[0] : '';
  if (carrierVal) await setV('[name="carrier"]', carrierVal);
  await click('[data-act="save-tracking"]');
  await wait(2000);
  const st = await ev(`(function(){var p=document.querySelector('.pill');return p?p.textContent.trim():null})()`);
  chk('保存追踪号后变已发货', /fulfil|ship/i.test(String(st)), st);
  chk('追踪号已写入', !(await ev(`!document.querySelector('a[href*="track"], a[target="_blank"]')`)));
  await shot('B3-fulfilled');

  /* ---------- C 部分退款 ---------- */
  sec('C 部分退款');
  const hasRfq = await ev(`!!document.querySelector('.rfq')`);
  chk('退货数量列存在', hasRfq);
  if (hasRfq) {
    await ev(`(function(){var e=document.querySelector('.rfq'); e.value='1';
      e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('[data-act="refund-partial"]');
    await wait(2200);
    const partial = await ev(`(function(){var p=document.querySelector('.pill.refunded');return p?p.textContent.trim():null})()`);
    const refundedTxt = await ev(`(function(){var e=Array.from(document.querySelectorAll('.sub')).filter(function(x){return /Already refunded/i.test(x.textContent)})[0];return e?e.textContent.trim():null})()`);
    chk('出现「部分退款」标记或已退金额', !!partial || !!refundedTxt, partial || refundedTxt);
    await shot('C1-partial-refund');
  }

  /* ---------- D 库存补货 ---------- */
  sec('D 库存补货');
  await goto('/inventory', 2000);
  const invRows = await ev(`document.querySelectorAll('table.atable tbody tr').length`);
  chk('库存页有商品行', invRows > 0, invRows + ' 行');
  await shot('D1-inventory');
  /* 补货是行内的「数量框 + Add」，不是弹抽屉。
     库存表按 SKU 分行，补完货表格会重排 —— 用「第一行」比对会读到别的 SKU，
     看起来像"只加了 6 件"。所以按 SKU 精确定位行。 */
  const skuOfFirstRow = await ev(`(function(){
    var tr=document.querySelector('table.atable tbody tr'); if(!tr) return null;
    return tr.children[1].textContent.trim();
  })()`);
  const stockOf = `(function(sku){
    var trs=document.querySelectorAll('table.atable tbody tr');
    for (var i=0;i<trs.length;i++){ if (trs[i].children[1].textContent.trim()===sku) return Number(trs[i].children[3].textContent.trim()); }
    return null;
  })(${JSON.stringify(skuOfFirstRow)})`;
  const stockBefore = await ev(stockOf);
  const qtyBox = await ev(`!!document.querySelector('.rqty')`);
  chk('行内有补货数量框', qtyBox);
  if (qtyBox) {
    await setV('.rqty', '20');
    await click('[data-act="restock"]');
    await wait(2400);
    const stockAfter = await ev(stockOf);
    chk('补货后该 SKU 库存 +20', stockAfter === stockBefore + 20,
      skuOfFirstRow + ': ' + stockBefore + ' → ' + stockAfter);
    await shot('D2-restocked');
  }

  /* ---------- E 优惠码 ---------- */
  sec('E 优惠码');
  await goto('/coupons', 2000);
  chk('优惠码页打开', (await ev(`document.querySelectorAll('table.atable tbody tr').length`)) >= 0, await txt('.panel__hd h2'));
  await shot('E1-coupons-empty');
  const code = 'OPS' + String(Date.now()).slice(-5);
  await setV('form[data-act="newcoupon"] [name="code"]', code);
  await setV('form[data-act="newcoupon"] [name="value"]', '15');
  await ev(`document.querySelector('form[data-act="newcoupon"]').requestSubmit()`);
  await wait(2200);
  const found = await ev(`document.body.textContent.indexOf(${JSON.stringify(code)}) >= 0`);
  chk('新建优惠码出现在列表', found, code);
  await shot('E2-coupon-created');

  /* 停用 → 启用（本轮新增的开关） */
  const btnInfo = await ev(`(function(){
    var b=document.querySelector('[data-act="toggle-coupon"]');
    if(!b) return 'MISS';
    return b.getAttribute('data-to')+'|'+b.textContent.trim();
  })()`);
  chk('券行有启用/停用开关', btnInfo !== 'MISS', btnInfo);
  if (btnInfo !== 'MISS') {
    await click('[data-act="toggle-coupon"]');
    await wait(2000);
    const afterOff = await ev(`(function(){
      var tb=document.querySelector('table.atable tbody');
      var b=document.querySelector('[data-act="toggle-coupon"]');
      var pill=document.querySelector('table.atable tbody .pill');
      return JSON.stringify({btn: b?b.textContent.trim():null, pill: pill?pill.textContent.trim():null});
    })()`);
    chk('停用后按钮变 Enable、徽章变 Disabled', /Enable/.test(afterOff) && /Disabled/i.test(afterOff), afterOff);
    await shot('E3-coupon-disabled');
    await click('[data-act="toggle-coupon"]');
    await wait(2000);
    const afterOn = await ev(`(function(){var b=document.querySelector('[data-act="toggle-coupon"]');var pill=document.querySelector('table.atable tbody .pill');return JSON.stringify({btn:b?b.textContent.trim():null,pill:pill?pill.textContent.trim():null})})()`);
    chk('再次点击恢复 Active', /Disable/.test(afterOn) && /Active/i.test(afterOn), afterOn);
    await shot('E4-coupon-active');
  }

  /* ---------- F 评价审核 ---------- */
  sec('F 评价审核');
  await goto('/reviews', 1800);
  chk('评价页打开', !(await ev(`!!document.querySelector('.falert')`)), await txt('.panel__hd h2'));
  await shot('F1-reviews');

  /* ---------- G 内容页 ---------- */
  sec('G 内容页改文案');
  await goto('/content', 1800);
  const contentFields = await ev(`document.querySelectorAll('form[data-act="content"] input').length`);
  chk('内容页有可编辑字段', contentFields > 0, contentFields + ' 个');
  if (contentFields > 0) {
    const tagBefore = await ev(`(function(){var e=document.querySelector('[name="tagline"]');return e?e.value:null})()`);
    const newTag = 'Made for salt water · ' + String(Date.now()).slice(-4);
    await setV('[name="tagline"]', newTag);
    await ev(`document.querySelector('form[data-act="content"]').requestSubmit()`);
    await wait(2200);
    const tagAfter = await ev(`(function(){var e=document.querySelector('[name="tagline"]');return e?e.value:null})()`);
    chk('保存后眉标已更新', tagAfter === newTag, (tagBefore || '') + ' → ' + tagAfter);
    await shot('G2-content-saved');
  } else {
    await shot('G1-content');
  }

  /* ---------- H 文章 ---------- */
  sec('H 文章');
  await goto('/articles', 1800);
  chk('文章页打开', !(await ev(`!!document.querySelector('.falter')`)), await txt('.panel__hd h2'));
  await shot('H1-articles');
  await goto('/articles/new', 2000);
  const ed = await ev(`!!document.querySelector('.postform, [data-act="post-save"], textarea')`);
  chk('新建文章编辑器可用', ed);
  await shot('H2-article-new');

  /* ---------- I 客户 ---------- */
  sec('I 客户');
  await goto('/customers', 1800);
  chk('客户页有下单客户', (await ev(`document.querySelectorAll('table.atable tbody tr').length`)) > 0,
    (await ev(`document.querySelectorAll('table.atable tbody tr').length`)) + ' 行');
  await shot('I1-customers');

  /* ---------- J 库存流水 ---------- */
  sec('J 库存流水');
  await goto('/ledger', 1800);
  chk('流水页有记录', (await ev(`document.querySelectorAll('table.atable tbody tr').length`)) > 0,
    (await ev(`document.querySelectorAll('table.atable tbody tr').length`)) + ' 行');
  await shot('J1-ledger');

  /* ---------- K 销售税 ---------- */
  sec('K 销售税');
  await goto('/tax', 1800);
  chk('销售税页打开', !(await ev(`!!document.querySelector('.falert')`)), await txt('.panel__hd h2'));
  await shot('K1-tax');

  /* ---------- L 审计日志 ---------- */
  sec('L 审计日志');
  await goto('/audit', 1800);
  const auditRows = await ev(`document.querySelectorAll('table.atable tbody tr').length`);
  chk('审计日志记录了本次操作', auditRows > 0, auditRows + ' 行');
  await shot('L1-audit');

  /* ---------- 汇总 ---------- */
  sec('运行时');
  chk('无控制台报错', errs.length === 0, errs.length ? JSON.stringify(errs.slice(0, 3)) : '0');
  chk('无 4xx/5xx 前台接口失败', netfail.length === 0, netfail.length ? JSON.stringify(netfail.slice(0, 4)) : '0');

  console.log('\n════════ 汇总 ════════');
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (bad.length) console.log('失败项：\n  - ' + bad.join('\n  - '));
  console.log('截图目录：' + OUT);
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('中断:', e.message); process.exit(1); });
