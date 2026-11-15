/* ============================================================
   LASTGROVE · 部分退款 UI 验收（真浏览器）
   ------------------------------------------------------------
   为什么必须真浏览器跑：部分退款的入口是「商品行里的一个小输入框」，
   它能不能出现、填了数字点按钮会不会真的只退那一件，curl 测不出来。
   接口层的算法由 api-test.js 7b 节盯着，这份只盯界面。

   用法：
     node tools/refund-ui-check.js
     BASE_URL=... ADMIN_EMAIL=... ADMIN_PASS=... node tools/refund-ui-check.js
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9352;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4600';
const EMAIL = process.env.ADMIN_EMAIL || 'owner@lastgrove.com';
const PASS = process.env.ADMIN_PASS || 'lastgrove2026';
const OUT = path.resolve(__dirname, '..', 'tmp_refund');
const PROF = path.join(OUT, 'prof');
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const isLocal = /localhost|127\.0\.0\.1/.test(BASE);
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1100', '--force-device-scale-factor=2'];
  if (isLocal) args.push('--no-proxy-server', '--proxy-bypass-list=*');
  args.push('about:blank');
  const child = spawn(EDGE, args, { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 60; i++) { try { t = await getJSON('/json'); if (t && t.length) break; } catch (e) { } await sleep(400); }
  const page = t.filter(x => x.type === 'page')[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, x => x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result));
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  const js = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? ('ERR ' + String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)) : r.result.value;
  };
  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  }
  async function waitFor(expr, tries, ms) {
    for (let i = 0; i < tries; i++) { const v = await js(expr); if (v) return v; await sleep(ms); }
    return null;
  }

  const rows = [];
  const ok = (n, v, extra) => { rows.push({ 检查: n, 结果: v ? 'PASS' : 'FAIL', 说明: String(extra == null ? '' : extra).slice(0, 120) }); };

  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 2, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    await waitFor('!!document.querySelector(".hdr")', 30, 500);

    const login = await js(`(async () => {
      const r = await fetch('/api/v1/admin/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASS)} }) });
      const d = await r.json();
      if (!d.data || !d.data.token) return 'LOGIN_FAIL ' + JSON.stringify(d).slice(0, 160);
      localStorage.setItem('lastgrove_admin', JSON.stringify({ token: d.data.token, staff: d.data.staff }));
      window.__TOK = d.data.token;
      return 'OK';
    })()`);
    ok('后台登录', login === 'OK', login);

    /* 造一张两行订单：第一行 2 件，这样"退 1 件"与"退 2 件"是两种不同结果 */
    const order = await js(`(async () => {
      const H = { 'Content-Type': 'application/json' };
      const q = await (await fetch('/api/v1/checkout/quote', { method: 'POST', headers: H,
        body: JSON.stringify({ items: [
          { productId: 'LG-101', metal: 'Gold', qty: 2 },
          { productId: 'LG-102', metal: 'Silver', qty: 1 } ] }) })).json();
      const o = await (await fetch('/api/v1/orders', { method: 'POST',
        headers: Object.assign({}, H, { 'Idempotency-Key': 'refund-ui-' + Date.now() }),
        body: JSON.stringify({ quoteId: q.data.quoteId, email: 'ui.refund@example.com',
          firstName: 'Ui', lastName: 'Refund',
          address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'United States' } }) })).json();
      return JSON.stringify({ number: o.data.order.number, total: o.data.order.total,
        items: o.data.order.items.length });
    })()`);
    let made;
    try { made = JSON.parse(order); } catch (e) { made = {}; }
    ok('造一张待退订单', !!made.number, made.number + ' · ' + made.items + ' 行 · $' + made.total);

    await send('Page.navigate', { url: BASE + '/#/admin/orders/' + encodeURIComponent(made.number) });
    const ready = await waitFor('!!document.querySelector(".rfq")', 40, 400);
    ok('订单详情页出现行内退款输入框', !!ready);

    /* 只在还有剩余可退件数的行上出现输入框；赠品行不给输入框 */
    const shape = await js(`JSON.stringify({
      heads: Array.from(document.querySelectorAll('.atable th')).map(function(h){return h.textContent.trim();}),
      inputs: document.querySelectorAll('.rfq').length,
      maxes: Array.from(document.querySelectorAll('.rfq')).map(function(i){return i.max;}),
      btn: !!document.querySelector('[data-act="refund-partial"]'),
      whole: !!document.querySelector('[data-act="refund"]'),
      text: (document.querySelector('.panel__bd:last-child')||{}).textContent || ''
    })`);
    let sh = {}; try { sh = JSON.parse(shape); } catch (e) { }
    ok('表头有 Refund 列', (sh.heads || []).indexOf('Refund') >= 0, (sh.heads || []).join('|'));
    ok('两行商品各一个输入框', sh.inputs === 2, sh.inputs + ' 个');
    ok('最大可退数 = 该行件数', (sh.maxes || []).join(',') === '2,1', (sh.maxes || []).join(','));
    ok('有「Refund selected」按钮', sh.btn === true);
    ok('保留「Refund whole order」', sh.whole === true);

    await shot('01-order-detail.png');

    /* 填 1 件 → 点 Refund selected。confirm 会被自动化挡住，先替换成直接返回 true */
    await js(`(async () => {
      const inp = document.querySelectorAll('.rfq')[0];
      inp.value = '1';
      window.confirm = function () { return true; };
      document.querySelector('[data-act="refund-partial"]').click();
      await new Promise(r => setTimeout(r, 1200));
      return 'clicked';
    })()`);

    await sleep(600);
    await shot('02-after-partial.png');

    const check = await js(`(async () => {
      const r = await fetch('/api/v1/admin/orders/' + encodeURIComponent(${JSON.stringify(made.number)}),
        { headers: { Authorization: 'Bearer ' + window.__TOK } });
      const d = await r.json();
      const o = d.data.order;
      return JSON.stringify({
        status: o.status, refundedTotal: o.refundedTotal, total: o.total,
        partial: !!o.partiallyRefunded, refunds: (o.refunds || []).length,
        qty: o.items.map(function(i){ return (i.refundedQty||0) + '/' + i.qty; }).join(',')
      });
    })()`);
    let c = {}; try { c = JSON.parse(check); } catch (e) { }
    ok('只退掉 1 件（不是整行）', (c.qty || '').split(',')[0] === '1/2', c.qty);
    ok('订单未关闭', c.status !== 'refunded', c.status);
    ok('标记为部分退款', c.partial === true);
    ok('退款金额小于订单总额', Number(c.refundedTotal) > 0 && Number(c.refundedTotal) < Number(c.total),
      '$' + c.refundedTotal + ' / $' + c.total);
    ok('退款记录留痕', c.refunds === 1, c.refunds + ' 条');

    /* 退完之后那一行的可退上限必须从 2 变成 1。
       上限不刷新的话，页面上还能再点一次退 2 件，服务端虽然会拦，
       但人会以为"按钮能点就说明能退"。 */
    const maxAfter = await js("JSON.stringify(Array.from(document.querySelectorAll('.rfq')).map(function(i){return i.max;}))");
    ok('可退上限随退款递减', String(maxAfter) === '["1","1"]', String(maxAfter));

    /* 界面上要能看见"已退多少"，否则下次退款靠人脑记 */
    const shown = await js(`(function(){
      const b = document.body.textContent;
      return JSON.stringify({ hasRefundedLine: /Refunded so far/.test(b),
        hasHistory: Array.from(document.querySelectorAll('th')).some(function(h){return h.textContent.trim()==='What';}),
        partialPill: /Partially refunded/.test(b) });
    })()`);
    let s2 = {}; try { s2 = JSON.parse(shown); } catch (e) { }
    ok('显示「已退金额」', s2.hasRefundedLine === true);
    ok('显示退款历史表', s2.hasHistory === true);
    ok('状态区有 Partially refunded 标记', s2.partialPill === true);

    await shot('03-refund-history.png');

    /* 收尾：把这单退干净，别把半开的单留在库里 */
    await js(`fetch('/api/v1/admin/orders/' + encodeURIComponent(${JSON.stringify(made.number)}) + '/refund',
      { method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: 'Bearer ' + window.__TOK }, body: JSON.stringify({ restock: true }) })`);
  } finally {
    try { ws.close(); } catch (e) { }
    child.kill();
  }

  const pass = rows.filter(r => r.结果 === 'PASS').length;
  console.log('\n部分退款 UI 验收');
  console.log('─'.repeat(78));
  rows.forEach(r => console.log('  ' + r.结果.padEnd(5) + ' ' + r.检查 + (r.说明 ? '\n         ' + r.说明 : '')));
  console.log('─'.repeat(78));
  console.log('  ' + pass + ' 通过 / ' + (rows.length - pass) + ' 失败 · 截图在 tmp_refund/');
  process.exit(pass === rows.length ? 0 : 1);
})().catch(e => { console.error('中断：', e); process.exit(1); });
