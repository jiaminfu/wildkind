/* ============================================================
   LASTGROVE · 支付相关 UI 回归（真浏览器 + 截图）
   ------------------------------------------------------------
   一次跑完四件事，避免来回肉眼点：
     ① 页头账号入口是不是图标（不再是一行 SIGN IN 文字）
     ② 页脚支付品牌是不是真 logo（且不再出现 Apple Pay / G Pay）
     ③ 结算页支付区有没有 PayPal 入口、按钮文案是否说清「会跳转」
     ④ 点提交到底会不会真的跳到 PayPal
   截图存 tmp_pp/ 下，方便直接看。

   用法：
     BASE_URL=http://localhost:4607 node tools/pp-ui-check.js
     node tools/pp-ui-check.js            # 默认线上
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9347;
const BASE = process.env.BASE_URL || 'https://lastgrove.com';
const PROF = 'D:/桔子/tmp_e2e/prof_ui';
const OUT = path.resolve(__dirname, '..', 'tmp_pp');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  /* 本机测试必须绕开系统代理（否则连 localhost 都被代理吃掉）；
     打线上时反而要走代理，直连会被墙。所以按目标地址决定。 */
  const isLocal = /localhost|127\.0\.0\.1/.test(BASE);
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,900', '--force-device-scale-factor=2'];
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
    return r.exceptionDetails ? ('ERR ' + String((r.exceptionDetails.exception || {}).description || '').slice(0, 160)) : r.result.value;
  };
  async function shot(name, clip) {
    const r = await send('Page.captureScreenshot', clip
      ? { format: 'png', captureBeyondViewport: true, clip: Object.assign({ x: 0, y: 0, scale: 1 }, clip) }
      : { format: 'png' });
    const fp = path.join(OUT, name);
    fs.writeFileSync(fp, Buffer.from(r.data, 'base64'));
    return fp;
  }
  async function waitFor(fn, tries, ms) {
    for (let i = 0; i < tries; i++) { const v = await js(fn); if (v) return v; await sleep(ms); }
    return null;
  }

  const rows = [];
  const ok = (n, v, extra) => rows.push({ 检查: n, 结果: v ? 'PASS' : 'FAIL', 说明: extra || '' });

  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    await waitFor('!!document.querySelector(".hdr__tools")', 30, 500);

    /* ① 页头 */
    const hdr = await js(`(() => {
      const t = document.querySelector('.hdr__tools');
      const kids = Array.from(t.children).map(e => e.className + '|' + (e.tagName||'').toLowerCase() + '|' + e.getAttribute('aria-label'));
      return { kids: kids, hasSigninText: /SIGN IN/i.test(t.innerText), acctVisible: !!document.querySelector('.hdr__acct') &&
        getComputedStyle(document.querySelector('.hdr__acct')).display !== 'none',
        iconCount: t.querySelectorAll('svg').length };
    })()`);
    ok('页头账号是人形图标（无 SIGN IN 文字）', hdr && !hdr.hasSigninText && hdr.acctVisible, JSON.stringify(hdr));
    await shot('01-header.png', { x: 0, y: 0, width: 1440, height: 110 });

    /* ② 页脚 */
    await js('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(1200);
    const ftr = await js(`(() => {
      const p = document.querySelector('.ftr__pay');
      if (!p) return null;
      return { text: p.innerText.trim(), svgs: p.querySelectorAll('svg').length,
        labels: Array.from(p.querySelectorAll('svg')).map(s => s.getAttribute('aria-label')),
        hasApple: /APPLE PAY/i.test(p.innerText), hasG: /G PAY/i.test(p.innerText) };
    })()`);
    ok('页脚支付品牌是 SVG logo 且无 Apple/G Pay',
      ftr && ftr.svgs >= 4 && !ftr.hasApple && !ftr.hasG, JSON.stringify(ftr));
    /* getBoundingClientRect 给的是视口坐标，而 CDP 的 clip 用的是整页坐标，
       两差一个 scrollY —— 少加这一项截出来就是一片空白。 */
    const ftrRect = await js(`(() => { const r = document.querySelector('.ftr__pay').getBoundingClientRect();
      return {x:r.x, y:r.y + window.scrollY, width:r.width, height:r.height}; })()`);
    await shot('02-footer-pay.png', { x: Math.max(0, Math.round(ftrRect.x) - 10), y: Math.max(0, Math.round(ftrRect.y) - 10), width: Math.round(Math.min(700, ftrRect.width + 40)), height: Math.round(ftrRect.height) + 24 });

    /* ③ 结算页：塞购物车 → 重载 → 进结算 */
    await js(`(async () => {
      const r = await fetch('/api/v1/products?limit=3'); const d = await r.json();
      const p = (d.data || [])[0]; const v = (p.variants || [])[0];
      localStorage.setItem('lastgrove_cart_v1', JSON.stringify([{ productId: p.id, handle: p.handle, title: p.title,
        image: (p.images || [])[0] || '', metal: v.metal, size: '', qty: 1, unitPrice: v.price, stock: v.stock }]));
      return p.id;
    })()`);
    /* 顺序很关键：先 reload 让 boot 读到刚写入的购物车，再切 hash 进结算。
       反过来（先切 hash 再 reload）会因为内存里的购物车还是空的，
       路由立刻把 #/checkout 重定向到 #/cart，reload 之后就停在购物车页了。 */
    await send('Page.reload');
    await sleep(2500);
    await send('Page.navigate', { url: BASE + '/#/checkout' });
    await waitFor('!!document.querySelector(".payopt, .cardfield")', 40, 500);

    const pay = await js(`(() => {
      const b = document.querySelector('.co__block:nth-of-type(4)') || document.body;
      const opt = document.querySelector('.payopt');
      const btn = document.querySelector('form.co button[type=submit]');
      return {
        hasPayopt: !!opt,
        optText: opt ? opt.innerText.replace(/\\s+/g, ' ').trim() : '',
        hasPaypalMark: !!document.querySelector('.payopt .paymark svg[aria-label="PayPal"]'),
        hasFakeCard: /4242/.test(document.body.innerText),
        hasTestMode: /Test mode|Stripe keys are not connected/.test(document.body.innerText),
        cta: btn ? btn.textContent.trim() : '',
      };
    })()`);
    ok('结算页有 PayPal 入口，无假卡号/Test mode 文案',
      pay && pay.hasPayopt && pay.hasPaypalMark && !pay.hasFakeCard && !pay.hasTestMode, JSON.stringify(pay));
    ok('按钮文案说明会跳转 PayPal', pay && /Continue to PayPal/i.test(pay.cta), pay && pay.cta);
    await shot('03-checkout.png', { x: 0, y: 0, width: 1440, height: 900 });

    /* 支付区单独来一张：这是本次改动的核心，整页截图里它在首屏之下 */
    const payRect = await js(`(() => { const b = document.querySelector('.co__block:last-of-type').getBoundingClientRect();
      return {x:b.x, y:b.y + window.scrollY, width:b.width, height:b.height}; })()`);
    await shot('03b-payment-block.png', {
      x: Math.max(0, Math.round(payRect.x) - 12), y: Math.max(0, Math.round(payRect.y) - 12),
      width: Math.round(payRect.width) + 24, height: Math.round(payRect.height) + 24,
    });

    /* ④ 点提交，看会不会真的跳走。
       先填表：字段都带 required，空着点提交会被浏览器原生校验拦住，
       看起来就像「点了没反应」—— 这恰好是用户报的现象之一。 */
    await js(`(function(){
      function set(n, v){ var el = document.querySelector('[name="' + n + '"]'); if (!el) return false;
        el.value = v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }
      set('email','pay-smoke@lastgrove.com'); set('firstName','Sandbox'); set('lastName','Buyer');
      set('line1','1 Test Street'); set('city','Austin'); set('state','TX'); set('zip','78701');
      set('country','United States'); return 'filled';
    })()`);
    await sleep(500);

    const before = await js('location.href');
    await js(`(() => { const f = document.querySelector('form[data-act="place"]'); const b = f && f.querySelector('button[type=submit]');
      if (!b) return 'no-btn'; b.click(); return 'clicked'; })()`);
    let href = before;
    for (let i = 0; i < 30; i++) { await sleep(600); href = await js('location.href'); if (href !== before) break; }
    const jumped = String(href).indexOf('paypal.com') >= 0;
    ok('点按钮真的跳到 PayPal（不再静默停留）', jumped, String(href).slice(0, 110));

    /* ⑤ 窄屏页头 */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE + '/' });
    await waitFor('!!document.querySelector(".hdr__tools")', 30, 500);
    const nar = await js(`(() => { const t = document.querySelector('.hdr__tools');
      return { kids: t.children.length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
               icons: t.querySelectorAll('svg').length }; })()`);
    ok('390px 页头无横向溢出', nar && !nar.overflow, JSON.stringify(nar));
    await shot('04-header-390.png', { x: 0, y: 0, width: 390, height: 100 });
  } catch (e) {
    console.log('异常：', e.message);
    rows.push({ 检查: '脚本', 结果: 'FAIL', 说明: e.message });
  } finally {
    try { ws.close(); } catch (e) { }
    child.kill();
  }

  console.table(rows);
  console.log('截图目录：%s', OUT);
  process.exit(rows.some(r => r.结果 === 'FAIL') ? 1 : 0);
})();
