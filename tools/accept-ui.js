#!/usr/bin/env node
/* ============================================================
   LASTGROVE · 前台 + 后台 UI 验收（AU 系列）
   真浏览器（headless Edge + CDP），真点真填，会把订单走完。
   与 accept-zero.js 的分工：那边验接口语义，这边验"人能不能用"。

   用法:
     BASE=http://194.36.85.20:8080 ADMIN_PASS=*** node tools/accept-ui.js
   产出：tmp_qa/ui/*.png + tmp_qa/accept-ui-<批次>.json
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9451;
const BASE = (process.env.BASE || 'http://127.0.0.1:4600').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'owner@lastgrove.com';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const SUF = Date.now().toString(36).slice(-5).toUpperCase();
const SHOTS = path.join(__dirname, '..', 'tmp_qa', 'ui');
const PROF = path.join(require('os').tmpdir(), 'edge_accept_prof');
const UPLOAD_IMG = path.join(__dirname, '..', 'app', 'web', 'assets', 'img', 'opt', 'p-necklace-sun-gold.jpg');

const RUN = [];
let seq = 0;
function ok(mod, name, cond, extra) {
  const id = 'AU-' + String(++seq).padStart(3, '0');
  RUN.push({ id, mod, name, ok: !!cond, detail: extra === undefined ? '' : String(extra).slice(0, 300) });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${id} ${mod} · ${name}${cond || !extra ? '' : `\n         ↳ ${String(extra).slice(0, 300)}`}`);
  return !!cond;
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

  const consoleErrors = [];
  const dialogs = [];
  sock.addEventListener('message', ev2 => {
    const o = JSON.parse(ev2.data);
    if (o.id && pend.has(o.id)) {
      const p = pend.get(o.id); pend.delete(o.id);
      o.error ? p.rej(new Error(o.error.message)) : p.res(o.result);
      return;
    }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      consoleErrors.push((o.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
    }
    if (o.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION ' + String(o.params.exceptionDetails.text || '').slice(0, 160));
    }
    if (o.method === 'Page.javascriptDialogOpening') {
      dialogs.push(String(o.params.message || '').slice(0, 120));
      send('Page.handleJavaScriptDialog', { accept: true });
    }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.result && r.result.description || ''));
    return r.result.value;
  };
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };
  const waitFor = async (expr, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) { if (await ev(expr)) return true; await wait(350); }
    return false;
  };
  const goto = async (url, readyExpr, ms) => {
    await send('Page.navigate', { url });
    return waitFor(readyExpr, ms || 30000);
  };
  const closeCookie = async () => {
    if (await ev(`document.body.classList.contains('ck-open')`)) {
      await waitFor(`!!document.querySelector('[data-act=ck-essential]')`, 8000);
      await ev(`(function(){var b=document.querySelector('[data-act=ck-essential]');if(b)b.click();return true})()`);
      await waitFor(`!document.body.classList.contains('ck-open')`, 6000);
    }
  };

  let orderNumber = null, buyerEmail = 'ui.buyer.' + SUF.toLowerCase() + '@example.com';

  try {
    /* ═══ U1 首页 ═══ */
    console.log('\n─── U1 首页 ───');
    const homeOk = await goto(BASE + '/', `document.querySelectorAll('a[href*="#/products/"]').length>0`, 35000);
    ok('U1', '首页渲染出商品卡', homeOk);
    await closeCookie();
    const cards = await ev(`document.querySelectorAll('a[href*="#/products/"]').length`);
    ok('U1', '首页商品卡数量 ≥ 4', cards >= 4, 'actual=' + cards);
    ok('U1', '标题含品牌名', /LASTGROVE/i.test(await ev('document.title')), await ev('document.title'));
    const navLinks = await ev(`document.querySelectorAll('header a[href*="#/collections/"], nav a[href*="#/collections/"]').length`);
    ok('U1', '顶部导航有集合入口', navLinks >= 2, 'actual=' + navLinks);
    const annText = await ev(`(function(){var e=document.querySelector('.annbar');return e?e.innerText.trim().replace(/\\s+/g,' ').slice(0,60):''})()`);
    ok('U1', '顶部公告条有文案', annText.length > 0, annText);
    ok('U1', '首屏无 JS 报错', consoleErrors.length === 0, consoleErrors.join(' | '));
    await shot('01-home');

    /* ═══ U2 集合页筛选与排序 ═══ */
    console.log('\n─── U2 集合页 ───');
    const navHref = await ev(`(function(){var a=document.querySelector('header a[href*="#/collections/"]')||document.querySelector('a[href*="#/collections/"][class*=nav]');return a?a.getAttribute('href'):null})()`);
    const colUrl = navHref ? BASE + '/' + navHref : BASE + '/#/collections/all';
    const colOk = await goto(colUrl, `document.querySelectorAll('a[href*="#/products/"]').length>0`, 30000);
    ok('U2', '集合页能打开并有商品', colOk, colUrl);
    await closeCookie();
    const beforeFilter = await ev(`document.querySelectorAll('a[href*="#/products/"]').length`);
    const hasFilter = await waitFor(`!!document.querySelector('[data-act=open-filter]')`, 12000);
    ok('U2', '有筛选入口', hasFilter);
    if (hasFilter) {
      await ev(`(function(){document.querySelector('[data-act=open-filter]').click();return true})()`);
      const open = await waitFor(`document.body.classList.contains('filter-open')`, 6000);
      ok('U2', '筛选抽屉能打开', open);
      const metalBtn = await ev(`(function(){var b=document.querySelector('[data-act=metal]');return b?b.getAttribute('data-m'):null})()`);
      if (metalBtn) {
        await ev(`(function(){document.querySelector('[data-act=metal]').click();return true})()`);
        await wait(1500);
        const afterFilter = await ev(`document.querySelectorAll('a[href*="#/products/"]').length`);
        ok('U2', '选择金属筛选后结果变化或保持合理', afterFilter > 0 && afterFilter <= beforeFilter, beforeFilter + ' → ' + afterFilter);
      }
      await ev(`(function(){var b=document.querySelector('[data-act=close-filter]');if(b)b.click();return true})()`);
      await wait(600);
    }
    const sortReady = await waitFor(`!!document.querySelector('[data-act=sort]')`, 12000);
    const sortOk = sortReady && await ev(`(function(){var s=document.querySelector('[data-act=sort]');s.value='price-asc';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    ok('U2', '排序控件可用', sortOk);
    await wait(2500);
    let pricesAsc = [];
    for (let i = 0; i < 10; i++) {
      pricesAsc = await ev(`(function(){
        var out=[];document.querySelectorAll('.card__price b').forEach(function(b){
          var m=(b.innerText||'').match(/(\\d+(?:\\.\\d+)?)/); if(m) out.push(Number(m[1]));
        }); return out;
      })()`);
      if (pricesAsc.length > 1 && pricesAsc.every((v, k) => k === 0 || pricesAsc[k - 1] <= v)) break;
      await wait(900);
    }
    ok('U2', '价格升序结果单调不降', pricesAsc.length > 1 && pricesAsc.every((v, i) => i === 0 || pricesAsc[i - 1] <= v), JSON.stringify(pricesAsc.slice(0, 8)));
    await shot('02-collection');

    /* ═══ U3 详情页 ═══ */
    console.log('\n─── U3 商品详情 ───');
    await ev(`(function(){document.querySelector('a[href*="#/products/"]').click();return true})()`);
    const pdpOk = await waitFor(`!!document.querySelector('.pdp')`, 25000);
    ok('U3', '点卡片进入详情页', pdpOk && (await ev('location.hash')).indexOf('#/products/') === 0, await ev('location.hash'));
    await closeCookie();
    const pdp = await ev(`(function(){
      var t=document.querySelector('.pdp h1'); return t?t.innerText.trim():'';
    })()`);
    ok('U3', '详情页有商品标题', pdp.length > 0, pdp);
    const priceTxt = await ev(`(function(){var m=document.body.innerText.match(/\\$\\s?(\\d+(?:\\.\\d{2})?)/);return m?m[0]:''})()`);
    ok('U3', '详情页显示价格', /\$\s?\d/.test(priceTxt), priceTxt);
    const descLen = await ev(`(function(){var e=document.querySelector('.pdp__desc');return e?e.innerText.trim().length:0})()`);
    ok('U3', '详情页展示商品描述', descLen > 0, 'len=' + descLen);
    const metals = await ev(`document.querySelectorAll('[data-act=metal]').length`);
    ok('U3', '有金属（变体）可选', metals >= 1, 'metals=' + metals);
    const addBtn = await ev(`(function(){var b=document.querySelector('[data-act=add]');return b?{t:b.innerText.trim(),dis:b.disabled}:null})()`);
    ok('U3', '有加购按钮', !!addBtn, JSON.stringify(addBtn));
    const th = await ev(`document.querySelectorAll('[data-act=thumb]').length`);
    ok('U3', '有商品图（可切换缩略图）', th >= 1, 'thumbs=' + th);
    await shot('03-pdp');

    /* 数量步进 */
    const q1 = Number(await ev(`(function(){var e=document.getElementById('pdpQty');return e?e.value:'1'})()`));
    await ev(`(function(){var b=document.querySelector('[data-act=pdpq][data-d="1"]');if(b)b.click();return true})()`);
    await wait(300);
    const q2 = Number(await ev(`(function(){var e=document.getElementById('pdpQty');return e?e.value:'1'})()`));
    ok('U3', '数量步进器可用', q2 === q1 + 1, q1 + ' → ' + q2);
    await ev(`(function(){var b=document.querySelector('[data-act=pdpq][data-d="-1"]');if(b)b.click();return true})()`);
    await wait(300);

    /* ═══ U4 购物袋 ═══ */
    console.log('\n─── U4 购物袋 ───');
    await ev(`(function(){var b=document.querySelector('[data-act=add]');if(b)b.click();return true})()`);
    const bagOpen = await waitFor(`document.body.classList.contains('drawer-open')`, 10000);
    ok('U4', '加购后购物袋自动打开', bagOpen);
    const bagN = await ev(`(function(){var e=document.getElementById('bagCount');return e?Number(e.innerText)||0:0})()`);
    ok('U4', '购物袋计数 ≥1', bagN >= 1, 'bagCount=' + bagN);
    const lineN = await ev(`document.querySelectorAll('.cline').length`);
    ok('U4', '购物袋里有商品行', lineN >= 1, 'lines=' + lineN);
    await shot('04-bag');
    if (lineN >= 1) {
      const subBefore = await ev(`(function(){var e=document.querySelector('.drawer__sum, .sum');return e?e.innerText.replace(/\\s+/g,' ').slice(0,80):''})()`);
      await ev(`(function(){var b=document.querySelector('[data-act=qty][data-d="1"]');if(b)b.click();return true})()`);
      /* 改数量会走一次服务端重新报价，线上跨境链路要 1~3 秒，必须轮询等结果 */
      let subAfter = subBefore;
      for (let i = 0; i < 12; i++) {
        await wait(700);
        subAfter = await ev(`(function(){var e=document.querySelector('.drawer__sum, .sum');return e?e.innerText.replace(/\\s+/g,' ').slice(0,80):''})()`);
        if (subAfter !== subBefore) break;
      }
      ok('U4', '调整数量后合计随之变化', subBefore !== subAfter, subBefore + ' → ' + subAfter);
      await ev(`(function(){var b=document.querySelector('[data-act=qty][data-d="-1"]');if(b)b.click();return true})()`);
      await wait(1500);
    }

    /* ═══ U5 结算并下单 ═══ */
    console.log('\n─── U5 结算与下单 ───');
    await ev(`(function(){var a=document.querySelector('a[href="#/checkout"]');if(a)a.click();return true})()`);
    const ckOk = await waitFor(`location.hash.indexOf('#/checkout')===0 && !!document.querySelector('input[name=email]')`, 30000);
    ok('U5', '进入结算页并渲染表单', ckOk, await ev('location.hash'));
    const fields = await ev(`(function(){
      var need=['email','firstName','lastName','line1','city','state','zip'];
      return need.filter(function(n){return !document.querySelector('input[name='+n+']')});
    })()`);
    ok('U5', '地址字段齐全', fields.length === 0, '缺少 ' + JSON.stringify(fields));
    ok('U5', '国家下拉只有 US/CA/UK', (await ev(`(function(){var s=document.querySelector('select[name=country]');return s?Array.from(s.options).map(function(o){return o.text}) : []})()`)).join(',') === 'United States,Canada,United Kingdom');
    const totalTxt = await ev(`(function(){var m=document.body.innerText.match(/Total[^$]*\\$\\s?([\\d.]+)/);return m?m[1]:''})()`);
    ok('U5', '结算页显示服务端报价总额', totalTxt.length > 0, 'total=' + totalTxt);

    /* 优惠码：先试一个不存在的，应给出可读错误 */
    const hasCoupon = await ev(`!!document.querySelector('input[name=code]')`);
    if (hasCoupon) {
      await ev(`(function(){var i=document.querySelector('input[name=code]');i.value='NOPE'+'${SUF}';i.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
      await wait(1800);
      const errTxt = await ev(`(function(){var e=document.querySelector('.falert,.coupon__err,.err');return e?e.innerText.trim().slice(0,80):''})()`);
      ok('U5', '无效优惠码给出可读提示', errTxt.length > 0, 'err="' + errTxt + '"');
    }

    await ev(`(function(){
      var set=function(n,v){var e=document.querySelector('[name='+n+']');if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
      set('email','${buyerEmail}'); set('firstName','Ada'); set('lastName','Zephyr'); set('line1','12 Sea Glass Way');
      set('city','Portland'); set('state','OR'); set('zip','97201');
      return true;
    })()`);
    await shot('05-checkout');
    await ev(`(function(){var f=document.querySelector('form[data-act=place]');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
    const orderOk = await waitFor(`location.hash.indexOf('#/order')===0`, 30000);
    const hashNow = await ev('location.hash');
    ok('U5', '提交订单后跳到订单页', orderOk, hashNow);
    orderNumber = await ev(`(function(){
      var m=(location.hash||'').match(/order\\/([^\\/?]+)/); if(m) return decodeURIComponent(m[1]);
      var t=document.body.innerText.match(/#TG\\d+/); return t?t[0]:null;
    })()`);
    ok('U5', '订单页显示订单号', !!orderNumber && /TG/.test(orderNumber), String(orderNumber));
    await shot('06-order');
    const orderBody = await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,400)`);
    ok('U5', '订单页显示金额与状态', /\$\s?\d/.test(orderBody) && /paid|preparing|confirmed/i.test(orderBody), orderBody.slice(0, 160));

    /* ═══ U6 访客查单 ═══ */
    console.log('\n─── U6 订单查询 ───');
    await goto(BASE + '/#/account/lookup', `!!document.querySelector('form[data-act=lookup]')`, 25000);
    ok('U6', '查单页可打开', await ev(`!!document.querySelector('form[data-act=lookup]')`));
    if (orderNumber) {
      await ev(`(function(){
        var s=function(n,v){var e=document.querySelector('[name='+n+']');if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
        s('number','${orderNumber}'); s('email','${buyerEmail}'); return true;
      })()`);
      await ev(`(function(){document.querySelector('form[data-act=lookup]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
      await wait(2500);
      const lookupBody = await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,500)`);
      ok('U6', '单号 + 邮箱能查到订单', lookupBody.toUpperCase().indexOf(String(orderNumber).replace('#', '').toUpperCase()) >= 0, lookupBody.slice(0, 160));
      /* 错误邮箱：先整页重载，清掉内存里"刚查到的订单"，否则会直接复用结果视图 */
      await send('Page.navigate', { url: BASE + '/?r=' + Date.now() + '#/account/lookup' });
      const formBack = await waitFor(`!!document.querySelector('form[data-act=lookup]')`, 25000);
      ok('U6', '重新进入查单页（表单可用）', formBack);
      await ev(`(function(){
        var s=function(n,v){var e=document.querySelector('[name='+n+']');if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
        s('number','${orderNumber}'); s('email','wrong-${SUF}@example.com'); return true;
      })()`);
      await ev(`(function(){var f=document.querySelector('form[data-act=lookup]');if(f)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
      const errShown = await waitFor(`!!document.querySelector('.falert')`, 10000);
      const errTxt = await ev(`(function(){var e=document.querySelector('.falert');return e?e.innerText.trim():''})()`);
      ok('U6', '邮箱不匹配时给出可读提示（不显示订单）', errShown && errTxt.length > 0, 'falert="' + errTxt + '"');
    }
    await shot('07-lookup');

    /* ═══ U7 后台 ═══ */
    console.log('\n─── U7 后台 ───');
    if (!ADMIN_PASS) {
      console.log('   跳过：未提供 ADMIN_PASS');
    } else {
      /* 同一浏览器配置目录会保留上一轮的令牌，先清掉才能验"未登录看到登录页" */
      await send('Page.navigate', { url: BASE + '/?r=' + Date.now() });
      await waitFor(`!!document.body`, 15000);
      await ev(`(function(){localStorage.removeItem('lastgrove_admin');return true})()`);
      await goto(BASE + '/#/admin', `!!document.querySelector('form[data-act=login]') || !!document.querySelector('[data-act=logout]')`, 25000);
      ok('U7', '未登录访问后台显示登录页', await ev(`!!document.querySelector('form[data-act=login]')`),
        'hash=' + (await ev('location.hash')));
      await ev(`(function(){
        var s=function(n,v){var e=document.querySelector('[name='+n+']');if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
        s('email','${ADMIN_EMAIL}'); s('password','${ADMIN_PASS}'); return true;
      })()`);
      await ev(`(function(){var f=document.querySelector('form[data-act=login]');if(f)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
      const dashOk = await waitFor(`location.hash.indexOf('#/admin')===0 && !document.querySelector('form[data-act=login]')`, 25000);
      ok('U7', '登录后进入看板', dashOk, await ev('location.hash'));
      const kpi = await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,200)`);
      ok('U7', '看板显示经营指标', /revenue|order|aov|sales/i.test(kpi), kpi.slice(0, 140));
      await shot('08-admin-dashboard');

      /* 商品列表 → 新建 */
      await ev(`(function(){location.hash='#/admin/products';return true})()`);
      const prodPage = await waitFor(`!!document.querySelector('[data-act=pnew]')`, 25000);
      ok('U7', '商品列表页可打开', prodPage, await ev('location.hash'));
      await ev(`(function(){document.querySelector('[data-act=pnew]').click();return true})()`);
      const drawerOk = await waitFor(`!!document.querySelector('#pTitle')`, 10000);
      ok('U7', '新建商品抽屉打开', drawerOk);
      const title = 'AU Test Necklace ' + SUF;
      await ev(`(function(){
        var s=function(sel,v){var e=document.querySelector(sel);if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
        s('#pTitle', '${title}');
        s('#pPrice', '64');
        s('#pCost', '15');
        s('#pDesc', 'UI acceptance item. Shell-set on a 45 cm chain with an adjustable extender.');
        var c=document.querySelector('#pCat'); if(c){c.value='necklaces';c.dispatchEvent(new Event('change',{bubbles:true}))}
        return true;
      })()`);
      /* 上传图片：真文件走 CDP，才能验证"选图到落盘"这一段 */
      try {
        const doc = await send('DOM.getDocument', { depth: -1 });
        const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#pFile' });
        if (node.nodeId) {
          await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [UPLOAD_IMG] });
        }
      } catch (e) { ok('U7', '图片上传（CDP 注入文件）', false, e.message); }
      /* 前端要 Canvas 压缩再 base64 上传，跨境链路上 1 张图 2~6 秒，轮询等 */
      const imgReady = await waitFor(`document.querySelectorAll('.imgcell img').length>0`, 30000);
      const imgCells = await ev(`document.querySelectorAll('.imgcell img').length`);
      ok('U7', '上传后抽屉里出现缩略图', imgReady && imgCells >= 1, 'imgs=' + imgCells);
      const stockInput = await ev(`!!document.querySelector('#pVars input[data-f=stock]')`);
      if (stockInput) {
        await ev(`(function(){
          var e=document.querySelector('#pVars input[data-f=stock]');
          e.value='6'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        })()`);
      }
      await shot('09-admin-drawer');
      await ev(`(function(){document.querySelector('[data-act=psave]').click();return true})()`);
      const saved = await waitFor(`!document.body.classList.contains('pedit-open')`, 20000);
      ok('U7', '保存草稿后抽屉关闭', saved, 'body.pedit-open=' + (await ev(`document.body.classList.contains('pedit-open')`)));
      /* 保存后列表按插入顺序追加在末尾，不搜索的话第一屏看不到自己刚建的商品——
         这本身是个体验问题（已记入报告），所以这里走列表自带的搜索框去找。 */
      await wait(1200);
      const searchable = await waitFor(`!!document.querySelector('[data-act=psearch] input')`, 15000);
      if (searchable) {
        await ev(`(function(){
          var i=document.querySelector('[data-act=psearch] input'); i.value='${title}';
          i.dispatchEvent(new Event('input',{bubbles:true}));
          i.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
          return true;
        })()`);
      }
      const found = await waitFor(`document.body.innerText.indexOf('${title}')>=0`, 25000);
      ok('U7', '新商品可在后台列表搜到', found, found ? '' : (await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,200)`)));
      /* 发布 */
      const pubBtn = await ev(`(function(){
        var rows=Array.from(document.querySelectorAll('tr'));
        var row=rows.filter(function(r){return r.innerText.indexOf('${title}')>=0})[0];
        if(!row)return null; var b=row.querySelector('[data-act=toggle]'); return b?b.getAttribute('data-active'):null;
      })()`);
      if (pubBtn === '0') {
        await ev(`(function(){
          var rows=Array.from(document.querySelectorAll('tr'));
          var row=rows.filter(function(r){return r.innerText.indexOf('${title}')>=0})[0];
          if(row)row.querySelector('[data-act=toggle]').click(); return true;
        })()`);
        /* 点完会整表重渲染，DOM 可能短暂还是旧的；重新查一次列表再看状态最稳 */
        await wait(3000);
        await ev(`(function(){
          var i=document.querySelector('[data-act=psearch] input');
          if(i){i.value='${title}';i.dispatchEvent(new Event('input',{bubbles:true}));i.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}
          return true;
        })()`);
        let nowActive = null;
        for (let i = 0; i < 12; i++) {
          await wait(1000);
          nowActive = await ev(`(function(){
            var rows=Array.from(document.querySelectorAll('tr'));
            var row=rows.filter(function(r){return r.innerText.indexOf('${title}')>=0})[0];
            if(!row)return null;var b=row.querySelector('[data-act=toggle]');return b?b.getAttribute('data-active'):null;
          })()`);
          if (nowActive === '1') break;
        }
        ok('U7', '点 Publish 后状态变为已上架', nowActive === '1', 'active=' + nowActive);
      } else {
        ok('U7', '商品已处于上架状态', pubBtn === '1', 'active=' + pubBtn);
      }
      await shot('10-admin-products');

      /* 订单页能看到刚才 UI 下的单 */
      await ev(`(function(){location.hash='#/admin/orders';return true})()`);
      const ordersPage = await waitFor(`!!document.querySelector('[data-act=osearch]')`, 25000);
      ok('U7', '后台订单页可打开', ordersPage, await ev('location.hash'));
      await wait(1200);
      const orderVisible = orderNumber ? await ev(`document.body.innerText.indexOf('${String(orderNumber || '').replace('#', '')}')>=0`) : false;
      ok('U7', '后台订单列表能看到前台新下的单', orderVisible, '单号=' + orderNumber);
      await shot('11-admin-orders');
    }

    /* ═══ U8 XSS ═══ */
    console.log('\n─── U8 内容安全 ───');
    ok('U8', '全程没有 alert 弹窗（XSS 未触发）', dialogs.length === 0, dialogs.join(' | '));
    const injectedImgs = await ev(`document.querySelectorAll('img[src="x"]').length`);
    ok('U8', '页面没有被注入的 <img src=x> 节点', injectedImgs === 0, 'found=' + injectedImgs);

    /* ═══ U10 本轮修复项（搜索 / 收藏 / 评价 / 导出 / SEO） ═══ */
    console.log('\n─── U10 搜索 · 收藏 · 评价 · SEO ───');

    /* 搜索：从浮层输入到结果页，全站范围 */
    await goto(BASE + '/', `document.querySelectorAll('a[href*="#/products/"]').length>0`, 35000);
    await ev(`(function(){var b=document.querySelector('[data-act=open-search]');if(b)b.click();return true})()`);
    await wait(500);
    await ev(`(function(){var i=document.getElementById('searchInput');if(i){i.value='ring';i.dispatchEvent(new Event('input',{bubbles:true}))}return true})()`);
    await wait(1400);
    const liveRes = await ev(`document.querySelectorAll('#searchRes .slres').length`);
    ok('U10', '搜索浮层输入即时出建议', liveRes >= 1, 'suggestions=' + liveRes);

    await ev(`(function(){
      var i=document.getElementById('searchInput');
      i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return true;
    })()`);
    const onSearch = await waitFor(`location.hash.indexOf('#/search')===0 && document.querySelectorAll('.grid .card').length>0`, 25000);
    const searchHash = await ev(`location.hash`);
    ok('U10', '回车跳到独立搜索页 #/search?q= 并出结果', onSearch, 'hash=' + searchHash);
    const searchCount = await ev(`document.querySelectorAll('.grid .card').length`);
    ok('U10', '搜索结果非空（搜 ring 能搜到戒指）', searchCount >= 1, 'cards=' + searchCount);
    const searchTitle = await ev(`document.title`);
    ok('U10', '搜索页 title 含关键词（不再是全站同一句）',
      searchTitle.indexOf('ring') >= 0, searchTitle);
    await shot('15-search');

    /* 收藏：详情页加心 → 头部角标 → 收藏页有卡片 */
    await goto(BASE + '/#/collections/all', `document.querySelectorAll('.grid .card').length>0`, 30000);
    const firstHandle = await ev(`(function(){
      var a=document.querySelector('a[href*="#/products/"]');return a?a.getAttribute('href').replace('#/products/',''):''
    })()`);
    await goto(BASE + '/#/products/' + firstHandle, `!!document.querySelector('.pdp')`, 30000);
    await wait(600);
    await ev(`(function(){var b=document.querySelector('.pdp__wish');if(b)b.click();return true})()`);
    await wait(700);
    const wishBadge = await ev(`(function(){var e=document.getElementById('wishCount');return e?e.textContent.trim():''})()`);
    ok('U10', '详情页点收藏后头部角标 +1', wishBadge === '1', 'badge=' + wishBadge);
    await goto(BASE + '/#/account/wishlist', `!!document.querySelector('.collhead h1')`, 25000);
    await wait(900);
    const wishCards = await ev(`document.querySelectorAll('.grid .card').length`);
    const wishHead = await ev(`(function(){var e=document.querySelector('.collhead h1');return e?e.innerText.trim():'(no h1)'})()`);
    ok('U10', '收藏页展示已收藏商品（不再是「订单查询」页）',
      wishCards >= 1 && /saved/i.test(wishHead), `cards=${wishCards} h1="${wishHead}"`);
    await shot('16-wishlist');
    /* 取消收藏，别把本地状态留给后面的用例 */
    await ev(`(function(){var b=document.querySelector('.card__wish');if(b)b.click();return true})()`);
    await wait(600);

    /* 评价：表单存在 + 真提交 + 收到感谢文案 */
    await goto(BASE + '/#/products/' + firstHandle, `!!document.querySelector('form[data-act=writereview]')`, 30000);
    ok('U10', '详情页有「写评价」表单（UGC 入口存在）',
      await ev(`!!document.querySelector('form[data-act=writereview] textarea[name=rbody]')`));
    const rvEmail = 'ui.reviewer.' + SUF.toLowerCase() + '@example.com';
    await ev(`(function(){
      var f=document.querySelector('form[data-act=writereview]');
      var set=function(n,v){var e=f.querySelector('[name='+n+']');if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}};
      set('rname','UI Reviewer'); set('remail','${rvEmail}');
      set('rtitle','Wears well'); set('rbody','Wore it every day for two weeks, the colour has not moved at all.');
      return true;
    })()`);
    await ev(`(function(){
      var f=document.querySelector('form[data-act=writereview]');
      f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true;
    })()`);
    const rvDone = await waitFor(`!!document.querySelector('.revy__done')`, 20000);
    const rvDoneTxt = await ev(`(function(){var e=document.querySelector('.revy__done');return e?e.innerText.replace(/\\s+/g,' ').slice(0,90):''})()`);
    ok('U10', '提交评价后显示「已收到，待审核」而不是报错', rvDone, rvDoneTxt);
    await shot('17-review-form');

    /* SEO：详情页标题、og、canonical、JSON-LD */
    const seo = await ev(`(function(){
      var g=function(s){var e=document.querySelector(s);return e?e.getAttribute('content')||e.getAttribute('href')||e.textContent:''};
      return {
        title: document.title,
        desc: g('meta[name=description]'),
        ogImage: g('meta[property="og:image"]'),
        ogType: g('meta[property="og:type"]'),
        canonical: g('link[rel=canonical]'),
        ld: g('script[type="application/ld+json"]')
      };
    })()`);
    ok('U10', '详情页 title 是该商品名（不再全站同一句）',
      seo.title && seo.title.indexOf('LASTGROVE') >= 0 && seo.title.indexOf('—') > 0,
      seo.title);
    ok('U10', '详情页有 og:image 与 og:type=product',
      !!seo.ogImage && seo.ogType === 'product', 'image=' + (seo.ogImage || '').slice(-40) + ' type=' + seo.ogType);
    ok('U10', '详情页有 canonical', /#\/products\//.test(seo.canonical || ''), seo.canonical);
    let ldOk = false, ldType = '';
    try {
      const ld = JSON.parse(seo.ld || '{}');
      const graph = ld['@graph'] || [ld];
      ldType = graph.map(x => x['@type']).join(',');
      ldOk = ldType.indexOf('Product') >= 0;
    } catch (e) { ldType = 'parse-fail'; }
    ok('U10', '详情页有 Product 结构化数据', ldOk, 'types=' + ldType);

    /* 导航：所有下拉子项都必须落在已存在的集合上，不能 404 */
    await goto(BASE + '/', `!!document.querySelector('.hdr__nav a')`, 25000);
    const navHrefs = await ev(`(function(){
      var out=[];document.querySelectorAll('.mega a[href^="#/collections/"]').forEach(function(a){out.push(a.getAttribute('href'))});
      return Array.from(new Set(out));
    })()`);
    let deadNav = [];
    for (const h of navHrefs.slice(0, 20)) {
      const handle = h.replace('#/collections/', '');
      const r = await fetch(BASE + '/api/v1/collections/' + encodeURIComponent(handle));
      if (!r.ok) deadNav.push(handle);
    }
    ok('U10', '导航下拉没有死链（每个子项都有对应集合）',
      deadNav.length === 0, `共 ${navHrefs.length} 个链接，死链：${JSON.stringify(deadNav)}`);

    /* 价格格式：整数价不带 .00 */
    await goto(BASE + '/#/collections/all', `document.querySelectorAll('.card__price b').length>0`, 30000);
    const priceTexts = await ev(`(function(){
      var o=[];document.querySelectorAll('.card__price b').forEach(function(b){o.push(b.innerText.trim())});
      return o;
    })()`);
    ok('U10', '价格整数不显示 .00（DTC 惯例）',
      priceTexts.length > 0 && !priceTexts.some(t => /\\.00$/.test(t)), JSON.stringify(priceTexts.slice(0, 6)));

    /* 后台部分：沿用 U7 的登录态，掉了就再登一次 */
    if (ADMIN_PASS) {
      await goto(BASE + '/#/admin/orders', `!!document.querySelector('form[data-act=login]') || !!document.querySelector('.adm')`, 30000);
      if (await ev(`!!document.querySelector('form[data-act=login]')`)) {
        await ev(`(function(){
          var s=function(n,v){var e=document.querySelector('[name='+n+']');if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
          s('email','${ADMIN_EMAIL}'); s('password','${ADMIN_PASS}'); return true;
        })()`);
        await ev(`(function(){document.querySelector('form[data-act=login]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
        await waitFor(`!!document.querySelector('.adm')`, 20000);
      }

      const exportPages = [];
      for (const [sec, label] of [['orders', '订单'], ['products', '商品'], ['customers', '客户']]) {
        await goto(BASE + '/#/admin/' + sec, `document.body.innerText.length>100`, 30000);
        await wait(700);
        const has = await ev(`(function(){
          var b=Array.from(document.querySelectorAll('[data-act=export]'));
          return b.length>0 ? b[0].getAttribute('data-what') : '';
        })()`);
        exportPages.push([label, has]);
      }
      ok('U10', '后台三处都有 CSV 导出按钮',
        exportPages.every(x => x[1]), JSON.stringify(exportPages));

      /* 订单页状态 tab 覆盖 Cancelled / Delivered */
      await goto(BASE + '/#/admin/orders', `document.querySelectorAll('.panel__bd a.abtn').length>3`, 30000);
      const tabText = await ev(`(function(){
        var o=[];document.querySelectorAll('.panel__bd a.abtn').forEach(function(a){o.push(a.innerText.trim())});
        return o.join(',');
      })()`);
      ok('U10', '订单状态 tab 覆盖 Delivered 与 Cancelled',
        /Delivered/.test(tabText) && /Cancelled/.test(tabText), tabText || '(空)');
      await shot('18-admin-orders-tabs');
    }

    /* ═══ U11 图片加载（D-111 / D-112） ═══ */    console.log('\n─── U11 图片优化 ───');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto(BASE + '/', `document.querySelectorAll('picture').length>5`, 35000);
    await wait(1500);

    const picStat = await ev(`(function(){
      var all = Array.prototype.slice.call(document.images);
      return {
        total: all.length,
        picture: document.querySelectorAll('picture').length,
        bare: all.filter(function(i){return !(i.parentNode && i.parentNode.tagName === 'PICTURE')}).length,
        png: all.filter(function(i){return /\\.png($|\\?)/.test(i.getAttribute('src')||'')}).length,
        webp: all.filter(function(i){return /\\.webp($|\\?)/.test(i.currentSrc||'')}).length,
        noAlt: all.filter(function(i){return !i.hasAttribute('alt')}).length,
        noDim: all.filter(function(i){return i.parentNode && i.parentNode.tagName==='PICTURE' && !(i.getAttribute('width')&&i.getAttribute('height'))}).length
      };
    })()`);
    ok('U11', '首页图片全部走 <picture>，无裸 <img>',
      picStat.total > 0 && picStat.bare === 0, JSON.stringify(picStat));
    ok('U11', '没有任何图片回落到原始 PNG',
      picStat.png === 0, 'png=' + picStat.png);
    ok('U11', '已加载的图全部是 WebP',
      picStat.webp >= 5, 'webp=' + picStat.webp + '/' + picStat.total);
    ok('U11', '每个 <picture> 内的 img 都带 alt 与宽高',
      picStat.noAlt === 0 && picStat.noDim === 0,
      'noAlt=' + picStat.noAlt + ' noDim=' + picStat.noDim);

    /* srcset 里点名的文件必须真的存在——写错一个宽度前缀，
       浏览器会静默退回兜底 JPG，肉眼看不出来，只有流量悄悄涨回去。 */
    const srcsetFiles = await ev(`(function(){
      var o=[];
      document.querySelectorAll('picture source[srcset]').forEach(function(s){
        s.getAttribute('srcset').split(',').forEach(function(p){ o.push(p.trim().split(/\\s+/)[0]); });
      });
      return o;
    })()`);
    const uniq = Array.from(new Set(srcsetFiles));
    const missing = [];
    for (const u of uniq) {
      const code = await ev(`fetch(${JSON.stringify(u)}, {method:'HEAD'}).then(function(r){return r.status}).catch(function(){return 0})`);
      if (code !== 200) missing.push(u + '→' + code);
    }
    ok('U11', 'srcset 引用的 WebP 全部存在',
      uniq.length > 0 && missing.length === 0,
      uniq.length + ' 个文件，缺失 ' + missing.length + (missing.length ? '：' + missing.slice(0, 3).join(', ') : ''));

    /* 首图之外的轮播图必须挂起，不能跟着首屏一起下 */
    const deferStat = await ev(`(function(){
      var m=document.getElementById('heroMedia'); if(!m) return null;
      var imgs=Array.prototype.slice.call(m.querySelectorAll('img'));
      return {
        n: imgs.length,
        deferred: imgs.filter(function(i){return i.parentNode.dataset.defer==='1'}).length,
        loaded: imgs.filter(function(i){return i.currentSrc}).length
      };
    })()`);
    ok('U11', '首图之外的轮播图处于挂起状态',
      deferStat && deferStat.n >= 2 && deferStat.deferred === deferStat.n - 1 && deferStat.loaded === 1,
      JSON.stringify(deferStat));

    /* 点圆点要能把挂起的图叫醒 */
    if (deferStat && deferStat.n > 1) {
      await ev(`document.querySelectorAll('.hero__dots i')[1].click()`);
      await wait(1500);
      const woke = await ev(`(function(){
        var m=document.getElementById('heroMedia');
        var i=Array.prototype.slice.call(m.querySelectorAll('img'))[1];
        return {cur:(i.currentSrc||'').replace(location.origin,''), defer:i.parentNode.dataset.defer||''};
      })()`);
      ok('U11', '点第 2 个圆点后第 2 张轮播图真正加载',
        /\.webp$/.test(woke.cur) && woke.defer !== '1', JSON.stringify(woke));
    }

    /* 详情页缩略图换图：<picture> 只改 img.src 是无效的，必须连 source 一起换 */
    await ev(`document.querySelector('a[href*="#/products/"]').click()`);
    await waitFor(`!!document.querySelector('.pdp')`, 25000);
    await wait(1200);
    const galBefore = await ev(`(function(){var m=document.getElementById('galMain');return m?{src:m.getAttribute('src'),cur:(m.currentSrc||'').replace(location.origin,'')}:null})()`);
    const galThumbs = await ev(`document.querySelectorAll('.gal__thumbs img').length`);
    if (galThumbs > 1) {
      await ev(`document.querySelectorAll('.gal__thumbs img')[1].click()`);
      await wait(1300);
      const galAfter = await ev(`(function(){
        var m=document.getElementById('galMain');
        var s=document.querySelector('.gal__main picture source');
        return {src:m.getAttribute('src'), cur:(m.currentSrc||'').replace(location.origin,''), srcset:s?s.getAttribute('srcset'):''};
      })()`);
      ok('U11', '详情页点缩略图，大图真的换图（含 source.srcset）',
        galAfter.cur !== galBefore.cur && galAfter.src !== galBefore.src && /\.webp$/.test(galAfter.cur),
        'before=' + galBefore.cur + ' after=' + galAfter.cur);
    } else {
      ok('U11', '详情页点缩略图，大图真的换图（含 source.srcset）', false, '该商品只有 1 张图');
    }
    await shot('19-pdp-gallery-swap');

    /* ═══ U12 顶栏在中间宽度不重叠（D-129） ═══ */
    console.log('\n─── U12 顶栏断点 ───');
    const navBreaks = [];
    for (const w of [1600, 1440, 1366, 1280, 1220]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: BASE + '/' });
      await wait(1600);
      const m = await ev(`(function(){
        var nav=document.querySelector('.hdr__nav'); if(!nav) return {gone:true};
        var items=Array.from(nav.children); if(!items.length) return {gone:true};
        var last=items[items.length-1].getBoundingClientRect();
        var tools=document.querySelector('.hdr__tools');
        var tf=tools?tools.getBoundingClientRect():null;
        return {
          w: window.innerWidth,
          overflow: nav.scrollWidth - nav.clientWidth,
          lastRight: Math.round(last.right),
          toolsLeft: tf?Math.round(tf.left):0,
          hit: tf ? (last.right - tf.left) : 0
        };
      })()`);
      navBreaks.push(m);
    }
    const navBad = navBreaks.filter(function (m) {
      return m && !m.gone && ((m.overflow || 0) > 1 || (m.hit || 0) > 0);
    });
    ok('U12', '顶栏 1220–1600px 导航不溢出、不压到右侧工具区',
      navBad.length === 0, JSON.stringify(navBreaks));

    /* 压缩间距的补丁不能把 mega menu 一起裁掉。
       面板是纯 CSS :hover 展开的，只能用真实鼠标移动，派发 JS 事件无效。 */
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    await wait(1600);
    const navItemBox = await ev(`(function(){
      var it=document.querySelector('.hdr__nav .navitem');
      if(!it) return null;
      var r=it.getBoundingClientRect();
      return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};
    })()`);
    let mega = { none: true };
    if (navItemBox) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: navItemBox.x, y: navItemBox.y, button: 'none' });
      await wait(700);
      mega = await ev(`(function(){
        var p=document.querySelector('.hdr__nav .navitem .mega');
        if(!p) return {noPanel:true};
        var r=p.getBoundingClientRect();
        var cs=getComputedStyle(p);
        var hdr=document.querySelector('.hdr').getBoundingClientRect();
        return {
          display:cs.display, w:Math.round(r.width), h:Math.round(r.height),
          overflowX: Math.round(r.right - window.innerWidth),
          belowHeader: Math.round(r.top - hdr.bottom),
          clipped: cs.display==='none' || r.height < 80
        };
      })()`);
    }
    ok('U12', '导航下拉面板展开后完整显示、未被裁切',
      !mega.none && !mega.noPanel && !mega.clipped && mega.overflowX <= 0,
      JSON.stringify(mega));
    await shot('20-header-1280');

    /* ═══ U13 页脚法务链接（收单机构审核必查项） ═══ */
    console.log('\n─── U13 页脚法务链接 ───');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    await wait(1800);

    const fl = await ev(`(function(){
      var links = Array.prototype.slice.call(document.querySelectorAll('.ftr__legal a'));
      var pay = Array.prototype.slice.call(document.querySelectorAll('.ftr__pay span')).map(function(s){return s.textContent.trim()});
      var admin = Array.prototype.slice.call(document.querySelectorAll('footer a'))
        .filter(function(a){return /admin/i.test(a.getAttribute('href')||'')}).length;
      return {n:links.length, hrefs:links.map(function(a){return a.getAttribute('href')}), pay:pay, admin:admin};
    })()`);

    ok('U13', '页脚法务链接可点击且不少于 5 个',
      fl.n >= 5 && fl.hrefs.every(function(h){ return /^#\/pages\//.test(h || ''); }),
      JSON.stringify(fl.hrefs));
    ok('U13', '页脚不再暴露后台入口', fl.admin === 0, 'admin 链接数=' + fl.admin);
    ok('U13', '支付标识不含本站未接入的 SHOP PAY',
      fl.pay.indexOf('SHOP PAY') < 0, JSON.stringify(fl.pay));

    /* 链接存在但内容是空的，同样过不了审核 —— 逐个真打开看正文长度 */
    const deadPages = [];
    for (const h of fl.hrefs) {
      await send('Page.navigate', { url: BASE + '/' + h });
      await wait(1100);
      const st = await ev(`(function(){
        var p = document.querySelector('.prose');
        var h1 = document.querySelector('h1');
        return { chars: p ? p.innerText.trim().length : 0, h1: h1 ? h1.textContent.trim() : '' };
      })()`);
      if (st.chars < 200 || !st.h1) deadPages.push(h + '(' + st.chars + ')');
    }
    ok('U13', '五个法务页面都有实质正文（>200 字）', deadPages.length === 0, deadPages.join(', '));

    await send('Page.navigate', { url: BASE + '/' });
    await wait(1600);
    await ev('window.scrollTo(0, document.body.scrollHeight)');
    await wait(500);
    await shot('21-footer-legal');

    /* ═══ U9 移动端 ═══ */
    console.log('\n─── U9 移动端 390px ───');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const mA = await goto(BASE + '/', `document.querySelectorAll('a[href*="#/products/"]').length>0`, 35000);
    await wait(900);
    const ovHome = await ev(`(function(){return {sw:document.documentElement.scrollWidth, iw:window.innerWidth}})()`);
    ok('U9', '首页无横向溢出', mA && ovHome.sw <= ovHome.iw + 1, JSON.stringify(ovHome));
    await shot('12-mobile-home');
    await ev(`(function(){document.querySelector('a[href*="#/products/"]').click();return true})()`);
    await waitFor(`!!document.querySelector('.pdp')`, 25000);
    await wait(800);
    const ovPdp = await ev(`(function(){return {sw:document.documentElement.scrollWidth, iw:window.innerWidth}})()`);
    ok('U9', '详情页无横向溢出', ovPdp.sw <= ovPdp.iw + 1, JSON.stringify(ovPdp));
    await shot('13-mobile-pdp');
    await goto(BASE + '/#/cart', `document.body.innerText.length>50`, 25000);
    await wait(1200);
    const ovCart = await ev(`(function(){return {sw:document.documentElement.scrollWidth, iw:window.innerWidth}})()`);
    ok('U9', '购物袋页无横向溢出', ovCart.sw <= ovCart.iw + 1, JSON.stringify(ovCart));
    await shot('14-mobile-cart');

    console.log('\n─── 运行时错误 ───');
    ok('U9', '全流程无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
  } catch (e) {
    console.error('\n执行中断：', e && e.stack || e);
  } finally {
    try { child.kill(); } catch (_) {}
    const pass = RUN.filter(r => r.ok).length;
    const fail = RUN.length - pass;
    console.log('\n════════ 汇总 ════════');
    const byMod = {};
    RUN.forEach(r => { byMod[r.mod] = byMod[r.mod] || { p: 0, f: 0 }; byMod[r.mod][r.ok ? 'p' : 'f']++; });
    Object.keys(byMod).sort().forEach(m => console.log(`${m}  通过 ${byMod[m].p}  失败 ${byMod[m].f}`));
    console.log(`合计 ${RUN.length} 条：通过 ${pass}，失败 ${fail}`);
    if (fail) {
      console.log('\n失败明细：');
      RUN.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.id} ${r.mod} · ${r.name}\n      ${r.detail}`));
    }
    const out = path.join(__dirname, '..', 'tmp_qa', 'accept-ui-' + SUF + '.json');
    fs.writeFileSync(out, JSON.stringify({ base: BASE, run: SUF, total: RUN.length, pass, fail, order: orderNumber, items: RUN }, null, 1));
    console.log('\n截图：' + SHOTS + '\n结果：' + out);
    process.exitCode = fail ? 1 : 0;
  }
})();
