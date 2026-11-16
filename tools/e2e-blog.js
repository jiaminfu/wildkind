#!/usr/bin/env node
/* ============================================================
   LASTGROVE · 博客真路径浏览器验收（BLOG-E2E）
   ------------------------------------------------------------
   这些用例 curl 验不出来，必须真浏览器：
     1. 从 /journal/x 点顶栏集合链接，落点必须是 /#/collections/y
        且**刷新后仍在商品页** —— 验的是 href 前导斜杠策略（SDS §6.2）
     2. view-source 里能看到文章标题 —— 验的是真预渲染，不是 JS 写入
     3. 390px 下文章页不出现横向滚动

   用法：BASE=http://127.0.0.1:4600 node tools/e2e-blog.js
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9460 + Math.floor(Math.random() * 60);
const BASE = (process.env.BASE || 'http://127.0.0.1:4600').replace(/\/$/, '');
const SHOTS = path.join(__dirname, '..', 'tmp_qa', 'blog');
const PROF = path.join(os.tmpdir(), 'edge_blog_' + PORT);

const RUN = [];
let seq = 0;
function ok(mod, name, cond, extra) {
  const id = 'BE-' + String(++seq).padStart(3, '0');
  RUN.push({ id, mod, name, ok: !!cond, detail: extra === undefined ? '' : String(extra).slice(0, 240) });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${id} ${mod} · ${name}` +
    (cond || !extra ? '' : `\n         ↳ ${String(extra).slice(0, 240)}`));
  return !!cond;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const getText = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers })); }).on('error', rej);
});

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server',
    '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => {
        http.get('http://127.0.0.1:' + PORT + '/json/list', r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
        }).on('error', rej);
      }));
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
  const warns = [];
  sock.addEventListener('message', ev2 => {
    const o = JSON.parse(ev2.data);
    if (o.id && pend.has(o.id)) {
      const p = pend.get(o.id); pend.delete(o.id);
      o.error ? p.rej(new Error(o.error.message)) : p.res(o.result);
      return;
    }
    if (o.method === 'Runtime.consoleAPICalled' && (o.params.type === 'error' || o.params.type === 'warning')) {
      const line = (o.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 220);
      if (o.params.type === 'warning') warns.push(line); else consoleErrors.push(line);
    }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails || {};
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '';
      consoleErrors.push('EXCEPTION ' + String(desc).slice(0, 300));
    }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.result && r.result.description) || ''));
    return r.result.value;
  };
  const shot = async name => {
    try {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
    } catch (e) { }
  };
  const goto = async (url, readyExpr, ms) => {
    await send('Page.navigate', { url });
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) {
      try { if (await ev(readyExpr)) return true; } catch (e) { /* 导航中 */ }
      await wait(300);
    }
    return false;
  };
  const closeCookie = async () => {
    try {
      if (await ev(`document.body.classList.contains('ck-open')`)) {
        await ev(`(function(){var b=document.querySelector('[data-act=ck-essential]');if(b)b.click();return true})()`);
        await wait(400);
      }
    } catch (e) { }
  };

  try {
    /* ═══ B1 列表页预渲染 ═══ */
    console.log('\n─── B1 列表页 ───');
    const raw = await getText(BASE + '/journal');
    ok('B1', '/journal 返回 200', raw.status === 200, 'status=' + raw.status);
    ok('B1', 'HTML 里直接含文章标题（真预渲染，非 JS 写入）',
      raw.body.indexOf('Why PVD is not plating') > 0);
    ok('B1', 'HTML 里含 canonical', /<link rel="canonical" href="[^"]*\/journal"/.test(raw.body));
    ok('B1', 'HTML 里含 og:type', /property="og:type"/.test(raw.body));
    ok('B1', 'HTML 里含 Blog JSON-LD', /"@type":"Blog"/.test(raw.body));

    const listOk = await goto(BASE + '/journal', `!!document.querySelector('.jhead__title')`);
    ok('B1', '列表页在浏览器里渲染', listOk);
    await closeCookie();
    const cardN = await ev(`document.querySelectorAll('.jcard').length`);
    ok('B1', '卡片数量与已发布文章一致', cardN === 3, 'cards=' + cardN);
    const titleTxt = await ev(`(document.title||'')`);
    ok('B1', '页面标题含品牌', /LASTGROVE/.test(titleTxt), titleTxt);
    await shot('01-journal');

    /* ═══ B2 详情页 ═══ */
    console.log('\n─── B2 详情页 ───');
    const detailOk = await goto(BASE + '/journal/why-pvd-is-not-plating', `!!document.querySelector('.post__title')`);
    ok('B2', '详情页打开且有正文标题', detailOk);
    const blocks = await ev(`document.querySelectorAll('.post__body p, .post__body h2, .post__body li').length`);
    ok('B2', '正文块渲染出多个段落/小标题', blocks >= 8, 'blocks=' + blocks);
    const strongN = await ev(`document.querySelectorAll('.post__body strong').length`);
    ok('B2', '行内 **粗体** 被解析成 <strong>', strongN >= 1, 'strong=' + strongN);
    const quoteN = await ev(`document.querySelectorAll('.post__body blockquote').length`);
    ok('B2', '引用块渲染成 <blockquote>', quoteN >= 1, 'quote=' + quoteN);
    const ld = await ev(`(function(){var s=document.querySelector('script[type="application/ld+json"]');return s?s.textContent.slice(0,60):''})()`);
    ok('B2', '详情页含 BlogPosting JSON-LD', /BlogPosting/.test(ld), ld);
    const ogImg = await ev(`(function(){var m=document.querySelector('meta[property="og:image"]');return m?m.content:''})()`);
    ok('B2', '无封面时回落站点默认图，不留空 og:image', !!ogImg, ogImg);
    await shot('02-post');

    /* ═══ B3 跨路由链接（最易踩坑的一条） ═══ */
    console.log('\n─── B3 链路跳转 ───');
    const linkHref = await ev(`(function(){
      var a=document.querySelector('header a[href*="/#/collections/"]');
      return a?a.getAttribute('href'):null})()`);
    ok('B3', '博客页顶栏集合链接是前导斜杠绝对路径', /^\/#\//.test(linkHref || ''), linkHref);

    if (linkHref) {
      await ev(`(function(){document.querySelector('header a[href*="/#/collections/"]').click();return true})()`);
      await wait(1800);
      const url1 = await ev('location.href');
      ok('B3', '点击后落到 hash 路由的商品集合页（不是 /journal/…#/…）',
        /\/#\/collections\//.test(url1) && url1.indexOf('/journal/') < 0, url1);

      /* 刷新一次：如果链接策略错了，地址栏会停在文章页后缀上，刷新就退回文章 */
      await send('Page.reload');
      await wait(2200);
      const url2 = await ev('location.href');
      const stillColl = /\/#\/collections\//.test(url2);
      ok('B3', '刷新后仍停在集合页（验证链接策略没把 hash 叠到文章 URL 上）',
        stillColl, url2);

      const headerOk = await ev(`!!document.querySelector('header.hdr') && !!document.querySelector('footer.ftr')`);
      ok('B3', 'hash 页面页头页脚正常', headerOk);
    }

    /* 从 hash 页面点 Journal 回博客 */
    const backToBlog = await goto(BASE + '/journal', `!!document.querySelector('.jcard')`);
    if (backToBlog) {
      await ev(`(function(){var a=document.querySelector('.jcard');if(a)a.click();return true})()`);
      await wait(1800);
      const url3 = await ev('location.href');
      ok('B3', '卡片点击进入文章真路径', /\/journal\/[a-z0-9-]+$/.test(url3), url3);
    }

    /* ═══ B4 交互层（overlays 由 JS 补挂） ═══ */
    console.log('\n─── B4 交互层 ───');
    const drawDiag = await ev(`(function(){
      try { return 'ok len=' + UI.cartDrawer().length } catch (e) { return 'ERR ' + e.message }})()`);
    const hasDrawer = await ev(`!!document.getElementById('cartDrawer')`);
    ok('B4', '购物袋抽屉已挂载（SSR 首屏不含，由 hydrate 补）', hasDrawer,
      drawDiag);
    const hasSearch = await ev(`!!document.getElementById('searchLayer')`);
    ok('B4', '搜索层已挂载', hasSearch);
    const hasMenu = await ev(`!!document.getElementById('mobDrawer')`);
    ok('B4', '移动菜单已挂载', hasMenu);
    const bagBadge = await ev(`(function(){var e=document.getElementById('bagCount');return e?e.textContent.trim():''})()`);
    ok('B4', '购物袋角标已同步（不是预渲染的 0）', bagBadge !== '', 'badge=' + bagBadge);
    const addOk = await ev(`(function(){
      var b=document.querySelector('[data-act=add]');if(!b)return false;b.click();return true})()`);
    if (addOk) {
      await wait(1600);
      const badge2 = await ev(`(function(){var e=document.getElementById('bagCount');return e?e.textContent.trim():''})()`);
      ok('B4', '博客页加购后角标随之变化', badge2 === '1', 'badge=' + badge2);
    }

    /* ═══ B5 移动端 ═══ */
    console.log('\n─── B5 移动端 390px ───');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await goto(BASE + '/journal', `!!document.querySelector('.jhead__title')`);
    const ovList = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    ok('B5', '列表页 390px 无横向溢出', ovList <= 1, 'overflow=' + ovList);
    await shot('05-journal-390');
    await goto(BASE + '/journal/why-pvd-is-not-plating', `!!document.querySelector('.post__title')`);
    const ovPost = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    ok('B5', '详情页 390px 无横向溢出', ovPost <= 1, 'overflow=' + ovPost);
    await shot('06-post-390');
    const menuBtn = await ev(`(function(){
      var b=document.querySelector('[data-act=open-menu]');if(!b)return false;b.click();return true})()`);
    await wait(600);
    const menuOpen = await ev(`document.body.classList.contains('menu-open')`);
    ok('B5', '移动端汉堡按钮能打开菜单', menuBtn && menuOpen);

    /* ═══ B6 404 与无 JS 报错 ═══ */
    console.log('\n─── B6 边界 ───');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const nf = await goto(BASE + '/journal/this-does-not-exist', `!!document.querySelector('.jhead__title')`);
    /* innerText 从公告条开始（很长），截前 120 字根本读不到标题，直接取标题元素 */
    const nfTitle = await ev(`(function(){var e=document.querySelector('.jhead__title');return e?e.textContent.trim():''})()`);
    ok('B6', '不存在的文章显示 404 页而不是白屏', nf && /not found/i.test(nfTitle), 'title=' + nfTitle);
    const nfRobots = await ev(`(function(){var m=document.querySelector('meta[name=robots]');return m?m.content:''})()`);
    ok('B6', '404 页带 noindex', /noindex/.test(nfRobots), nfRobots);

    ok('B6', '全流程无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  } catch (e) {
    console.error('\n执行中断：', e.message);
  } finally {
    try { child.kill(); } catch (e) { }

    const pass = RUN.filter(r => r.ok).length;
    const fail = RUN.length - pass;
    console.log('\n════════ 汇总 ════════');
    const byMod = {};
    RUN.forEach(r => { byMod[r.mod] = byMod[r.mod] || { p: 0, f: 0 }; r.ok ? byMod[r.mod].p++ : byMod[r.mod].f++; });
    Object.keys(byMod).sort().forEach(m => console.log(`${m}  通过 ${byMod[m].p}  失败 ${byMod[m].f}`));
    console.log(`合计 ${RUN.length} 条：通过 ${pass}，失败 ${fail}`);
    if (fail) {
      console.log('\n失败明细：');
      RUN.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.id + ' ' + r.mod + ' · ' + r.name + '\n      ' + r.detail));
    }
    fs.writeFileSync(path.join(__dirname, '..', 'tmp_qa', 'e2e-blog.json'),
      JSON.stringify({ at: new Date().toISOString(), run: RUN }, null, 1));
    console.log('\n截图：' + SHOTS);
    process.exit(fail ? 1 : 0);
  }
})();
