#!/usr/bin/env node
/* 空态验收：0 商品 / 0 集合 / 0 订单时，前台与后台是否还能正常展示 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9491;
const BASE = (process.env.BASE || 'http://194.36.85.20:8080').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'owner@tideglassjewelry.com';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const SHOTS = path.join(__dirname, '..', 'tmp_qa', 'empty');
const PROF = path.join(require('os').tmpdir(), 'edge_empty_prof');
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

const RUN = []; let seq = 0;
function ok(k, name, cond, extra) {
  const id = 'EM-' + String(++seq).padStart(3, '0');
  RUN.push({ id, k, name, ok: !!cond, detail: extra === undefined ? '' : String(extra).slice(0, 240) });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${id} ${k} · ${name}${cond || !extra ? '' : '  ↳ ' + String(extra).slice(0, 240)}`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server',
    '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { const l = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list')); const t = l.filter(x => x.type === 'page')[0]; if (t) wsUrl = t.webSocketDebuggerUrl; } catch (e) {}
    if (!wsUrl) await wait(300);
  }
  const sock = new WebSocket(wsUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  sock.addEventListener('message', e => {
    const o = JSON.parse(e.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); return; }
    if (o.method === 'Runtime.exceptionThrown') errs.push(String(o.params.exceptionDetails.text || '').slice(0, 140));
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') errs.push((o.params.args || []).map(a => a.value || '').join(' ').slice(0, 140));
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'ERR:' + (r.exceptionDetails.text || ''); return r.result.value; };
  const waitFor = async (x, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(x)) return true; await wait(300); } return false; };
  const shot = async n => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, n + '.png'), Buffer.from(data, 'base64')); };
  const mainTxt = () => ev(`(function(){var m=document.querySelector('main')||document.body;return m.innerText.replace(/\\s+/g,' ').trim().slice(0,200)})()`);

  /* 首页 */
  const t0 = Date.now();
  await send('Page.navigate', { url: BASE + '/' });
  const heroUp = await waitFor(`!!document.querySelector('.hero')`, 40000);
  const bootMs = Date.now() - t0;
  await wait(2000);
  ok('空-前台', '首页能打开且不白屏', heroUp, '首屏渲染 ' + bootMs + 'ms');
  ok('空-前台', '首屏渲染在 3 秒内', bootMs < 3000, bootMs + 'ms');
  ok('空-前台', '首页有主视觉文案', await ev(`!!document.querySelector('.hero h1')`));
  ok('空-前台', '首页无 JS 异常', errs.length === 0, errs.join(' | '));
  ok('空-前台', '0 商品时首页不出现空白网格或 NaN', !/NaN|undefined/.test(String(await ev(`document.querySelector('main,.main,#app').innerText.slice(0,600)`))), String(await ev(`document.querySelector('main,.main,#app').innerText.replace(/\\s+/g,' ').slice(0,180)`)));
  await shot('e1-home');

  /* 集合页：无集合时导航为空，直接访问一个集合 */
  await send('Page.navigate', { url: BASE + '/#/collections/necklaces' });
  await waitFor(`!document.body.innerText.includes('Loading')`, 25000); await wait(1500);
  ok('空-前台', '空集合页给可读空态（不是白屏/报错）', /no|empty|0|not found|nothing|sold out|does not exist/i.test(String(await mainTxt())), await mainTxt());
  await shot('e2-collection');

  /* 详情页：不存在的商品 */
  await send('Page.navigate', { url: BASE + '/#/products/tidepool-ring' });
  await wait(3500);
  ok('空-前台', '不存在的商品页给可读提示', /not available|not found|sold out|404/i.test(String(await mainTxt())), await mainTxt());
  await shot('e3-pdp-missing');

  /* 购物袋空态 */
  await send('Page.navigate', { url: BASE + '/#/cart' });
  await wait(2500);
  const bagTxt = String(await mainTxt());
  ok('空-前台', '空购物袋有引导（不是空白）', bagTxt.length > 40 && /empty|nothing|start|shop|browse|bag/i.test(bagTxt), bagTxt.slice(0, 160));
  await shot('e4-bag-empty');

  /* 结算页空袋直访 */
  await send('Page.navigate', { url: BASE + '/#/checkout' });
  await wait(2500);
  ok('空-前台', '空袋直访结算页被挡回（不出现可提交表单）', !(await ev(`!!document.querySelector('form[data-act=place]')`)), String(await mainTxt()).slice(0, 140));
  await shot('e5-checkout-empty');

  /* 查单页 */
  await send('Page.navigate', { url: BASE + '/#/account/lookup' });
  await wait(2500);
  ok('空-前台', '查单页表单可用', await ev(`!!document.querySelector('form[data-act=lookup]')`));
  await shot('e6-lookup');

  /* 后台看板 0 数据 */
  await send('Page.navigate', { url: BASE + '/#/admin' });
  await waitFor(`!!document.querySelector('form[data-act=login]')`, 20000);
  await ev(`(function(){var s=function(n,v){var e=document.querySelector('[name='+n+']');if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('email','${ADMIN_EMAIL}');s('password','${ADMIN_PASS}');return true})()`);
  await ev(`(function(){document.querySelector('form[data-act=login]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
  await waitFor(`!document.querySelector('form[data-act=login]')`, 20000); await wait(2500);
  const dash = String(await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,400)`));
  ok('空-后台', '0 数据看板正常渲染（无 NaN/undefined）', !/NaN|undefined|Infinity/.test(dash), dash.slice(0, 200));
  await shot('e7-admin-dashboard');

  for (const [p, n] of [['/#/admin/orders', 'e8-admin-orders'], ['/#/admin/products', 'e9-admin-products'], ['/#/admin/customers', 'e10-admin-customers'], ['/#/admin/reviews', 'e11-admin-reviews']]) {
    await send('Page.navigate', { url: BASE + p });
    await wait(3000);
    const t = String(await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,200)`));
    ok('空-后台', p + ' 空列表可读', !/NaN|undefined/.test(t), t.slice(0, 120));
    await shot(n);
  }

  ok('空-全局', '全程无 console 报错', errs.length === 0, [...new Set(errs)].slice(0, 3).join(' | '));

  const pass = RUN.filter(r => r.ok).length;
  console.log(`\n合计 ${RUN.length} 条：通过 ${pass}，失败 ${RUN.length - pass}`);
  fs.writeFileSync(path.join(__dirname, '..', 'tmp_qa', 'empty-accept.json'), JSON.stringify({ at: new Date().toISOString(), total: RUN.length, pass, items: RUN }, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
