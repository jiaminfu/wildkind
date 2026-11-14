#!/usr/bin/env node
/* ============================================================
   TIDEGLASS · 前台 + 后台 UI 验收（AU 系列）
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
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'owner@tideglassjewelry.com';
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
    ok('U1', '标题含品牌名', /TIDEGLASS/i.test(await ev('document.title')), await ev('document.title'));
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
      await ev(`(function(){localStorage.removeItem('tideglass_admin');return true})()`);
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
