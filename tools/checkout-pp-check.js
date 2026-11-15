/* ============================================================
   LASTGROVE · 结算「点 Place order 之后到底发生了什么」诊断
   ------------------------------------------------------------
   起因：用户反馈「前端没有调起 PayPal」，而服务端日志里根本没有
   POST /api/v1/orders 的痕迹 —— 说明请求压根没发出去，问题在前端。

   这个脚本用真浏览器把整条路走一遍（不绕过任何校验）：
     localStorage 塞一条真实购物车 → #/checkout → 逐字段填表 →
     点 Place order → 抓 12 秒内的 console 报错 / 网络请求 / 页面去向。

   为什么用 localStorage 塞购物车而不是点「加入购物袋」：
   点击路径依赖 DOM 细节（尺寸弹层、颜色选择），这里要定位的是「提交那一步」，
   前置步骤越少变量越少。购物车行结构与 core.js 的 state.cart 一致。

   用法：node tools/checkout-pp-check.js
   ============================================================ */
'use strict';
const http = require('http');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const BASE = process.env.BASE_URL || 'https://lastgrove.com';
const PROF = 'D:/桔子/tmp_e2e/prof_co';

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
    '--user-data-dir=' + PROF,
    '--window-size=1440,960',
    'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await getJSON('/json'); if (targets && targets.length) break; } catch (e) { }
    await sleep(400);
  }
  if (!targets) { console.log('FAIL: devtools 未就绪'); child.kill(); process.exit(1); }
  const page = targets.filter(t => t.type === 'page')[0];

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const errors = [];
  const reqs = [];
  await new Promise(res => { ws.onopen = res; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXCEPTION: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 300));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map(a => a.value || a.description || a.type).join(' ').slice(0, 300));
    }
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (/\/api\/v1\//.test(u)) reqs.push({ url: u.replace(BASE, ''), id: m.params.requestId, method: m.params.request.method, status: null });
    }
    if (m.method === 'Network.responseReceived') {
      const hit = reqs.filter(r => r.id === m.params.requestId).pop();
      if (hit) hit.status = m.params.response.status;
    }
  };
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, m => m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result));
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async function js(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '') };
    return r.result.value;
  }

  try {
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');

    /* 1. 先落地一次首页拿到域名下的 localStorage 权限 */
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 20; i++) { await sleep(600); if (await js('!!window.S && !!window.S.state')) break; }

    /* 2. 取一件真实商品，构造购物车行 */
    const cart = await js(`(async () => {
      const r = await fetch('/api/v1/products?limit=5');
      const d = await r.json();
      const p = (d.data || [])[0];
      const v = (p.variants || [])[0];
      const line = { productId: p.id, handle: p.handle, title: p.title,
        image: (p.images || [])[0] || '', metal: v.metal, size: '', qty: 1,
        unitPrice: v.price, stock: v.stock };
      localStorage.setItem('lastgrove_cart_v1', JSON.stringify([line]));
      localStorage.removeItem('lastgrove_admin');
      return line;
    })()`);
    if (!cart || cart.__err) throw new Error('取商品失败：' + JSON.stringify(cart));
    console.log('购物车：%s / %s / $%s', cart.title, cart.metal, cart.unitPrice);

    /* 3. 进结算页并填表 */
    await send('Page.navigate', { url: BASE + '/#/checkout' });
    await sleep(2600);
    const filled = await js(`(() => {
      const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); if (!el) return false;
        el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; };
      const out = {};
      out.email = set('email', 'pay-smoke+' + Date.now().toString(36) + '@lastgrove.com');
      out.firstName = set('firstName', 'Sandbox');
      out.lastName = set('lastName', 'Buyer');
      out.line1 = set('line1', '1 Test Street');
      out.city = set('city', 'Austin');
      out.state = set('state', 'TX');
      out.zip = set('zip', '78701');
      out.country = set('country', 'United States');
      out.form = !!document.querySelector('form[data-form="place"], form[data-act="place"]');
      out.btn = !!document.querySelector('form button[type=submit]');
      out.btnText = (document.querySelector('form button[type=submit]')||{}).textContent || '';
      return out;
    })()`);
    console.log('填表：', JSON.stringify(filled));
    if (!filled || filled.__err) throw new Error('填表脚本异常');

    /* 4. 提交 */
    const before = await js('location.href');
    await js(`(() => { const f = document.querySelector('form[data-form="place"], form[data-act="place"]') || document.querySelector('form');
      const b = f && f.querySelector('button[type=submit]'); if (b) { b.click(); return 'clicked'; } 
      if (f && f.requestSubmit) { f.requestSubmit(); return 'requestSubmit'; } return 'no-button'; })()`);

    /* 5. 等到跳转或报错（跨境链路慢，给 15 秒） */
    let href = before, toast = '';
    for (let i = 0; i < 25; i++) {
      await sleep(600);
      href = await js('location.href');
      toast = await js('(document.querySelector(".toast")||{}).textContent||""');
      if (href !== before) break;
      if (toast) break;
    }

    console.log('\n--- 结果 ---');
    console.log('URL 变化：', before === href ? '未离开结算页' : href.slice(0, 140));
    console.log('页面提示：', String(toast || '').trim().slice(0, 160) || '(无)');
    console.log('接口调用：');
    reqs.filter(r => /orders|payment|quote/.test(r.url)).forEach(r =>
      console.log('   %s %s → %s', r.method, r.url.slice(0, 90), r.status == null ? '(无响应)' : r.status));
    if (errors.length) {
      console.log('前端报错：');
      errors.slice(0, 8).forEach(e => console.log('   ' + e));
    } else {
      console.log('前端报错：(无)');
    }
    const saved = await js(`(() => { try { const o = JSON.parse(localStorage.getItem('lastgrove_last_order')||'null'); return o ? (o.number + ' / ' + o.status) : ''; } catch(e){ return ''; } })()`);
    console.log('本地记住的订单：', saved || '(无)');
  } catch (e) {
    console.log('异常：', e.message);
  } finally {
    try { ws.close(); } catch (e) { }
    child.kill();
  }
})();
