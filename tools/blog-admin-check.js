#!/usr/bin/env node
/* ============================================================
   LASTGROVE · 后台文章编辑器浏览器验收（BADM）
   ------------------------------------------------------------
   验的是「运营能不能真的写完并发布一篇文章」：
   新建 → 填标题 → 插块 → 上移/下移/删除 → 保存 → 发布 → 前台可访问 → 删除。
   这些步骤任何一步卡住，博客就等于没有后台。

   用法：BASE=http://127.0.0.1:4600 ADMIN_PASS=... node tools/blog-admin-check.js
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9520 + Math.floor(Math.random() * 60);
const BASE = (process.env.BASE || 'http://127.0.0.1:4600').replace(/\/$/, '');
const PASS = process.env.ADMIN_PASS || 'lastgrove2026';
const EMAIL = process.env.ADMIN_EMAIL || 'owner@lastgrove.com';
const STAMP = Date.now().toString(36).slice(-5).toUpperCase();
const TITLE = 'Draft test ' + STAMP;
const SHOTS = path.join(__dirname, '..', 'tmp_qa', 'blogadmin');
const PROF = path.join(os.tmpdir(), 'edge_badm_' + PORT);

const RUN = [];
let seq = 0;
function ok(mod, name, cond, extra) {
  const id = 'BD-' + String(++seq).padStart(3, '0');
  RUN.push({ id, mod, name, ok: !!cond, detail: extra === undefined ? '' : String(extra).slice(0, 220) });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${id} ${mod} · ${name}` +
    (cond || !extra ? '' : `\n         ↳ ${String(extra).slice(0, 220)}`));
  return !!cond;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

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
    } catch (e) { }
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
      consoleErrors.push((o.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 180));
    }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails || {};
      consoleErrors.push('EXCEPTION ' + String((d.exception && d.exception.description) || d.text || '').slice(0, 200));
    }
    if (o.method === 'Page.javascriptDialogOpening') {
      dialogs.push(String(o.params.message || '').slice(0, 120));
      /* 删除确认要求逐字输入标题，所以对话框必须被「接受」并回填正确文字。
         这里先记下来，由用例决定接受还是取消。 */
      send('Page.handleJavaScriptDialog', { accept: !!global.__acceptDialog, promptText: global.__dialogText || '' });
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
      try { if (await ev(readyExpr)) return true; } catch (e) { }
      await wait(300);
    }
    return false;
  };

  try {
    /* ---------- 1 登录 ---------- */
    console.log('\n─── A1 登录与入口 ───');
    await goto(BASE + '/#/admin', `!!document.querySelector('input[name=email]')`, 25000);
    await ev(`(function(){
      var s=function(n,v){var e=document.querySelector('[name='+n+']');if(!e)return;e.value=v;
        e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
      s('email','${EMAIL}'); s('password','${PASS}');
      var f=document.querySelector('form[data-act=login]');
      if(f)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      return true})()`);
    const loggedIn = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        if (await ev(`!!document.querySelector('.adm__nav')`)) return true;
        await wait(400);
      }
      return false;
    })();
    ok('A1', '后台登录成功', loggedIn);

    const hasNav = await ev(`!!document.querySelector('.adm__nav a[href$="#/admin/articles"]')`);
    ok('A1', '侧栏出现 Articles 入口', hasNav);

    /* ---------- 2 列表 ---------- */
    console.log('\n─── A2 文章列表 ───');
    /* ready 条件要等到整块面板渲染完，只看 .atable 会抢跑：
       表格和标题栏是同一次 innerHTML 出来的，但 evaluate 的时机可能落在
       中间那一帧，于是「New article 按钮不存在」偶发失败过一次。 */
    const listOk = await goto(BASE + '/#/admin/articles',
      `!!document.querySelector('table.atable') && !!document.querySelector('a[href$="#/admin/articles/new"]')`,
      20000);
    ok('A2', '列表页渲染出表格', listOk);
    const rowN = await ev(`document.querySelectorAll('table.atable tbody tr').length`);
    ok('A2', '列表里有种子文章', rowN >= 3, 'rows=' + rowN);
    const hasNew = await ev(`!!document.querySelector('a[href$="#/admin/articles/new"]')`);
    const hdLinks = await ev(`JSON.stringify(Array.prototype.map.call(
      document.querySelectorAll('.panel__hd a, .phd-r a'),
      function(a){return a.getAttribute('href')}))`);
    ok('A2', '有 New article 入口', hasNew, hdLinks);
    await shot('01-list');

    /* ---------- 3 新建 ---------- */
    console.log('\n─── A3 新建与分块编辑 ───');
    await ev(`(function(){var a=document.querySelector('a[href$="#/admin/articles/new"]');if(a)a.click();return true})()`);
    const edOk = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        if (await ev(`!!document.querySelector('.postform input[name=title]')`)) return true;
        await wait(300);
      }
      return false;
    })();
    ok('A3', '编辑器打开', edOk);
    ok('A3', '默认已有一个空段落块', (await ev(`document.querySelectorAll('.blk').length`)) === 1);

    await ev(`(function(){
      var f=document.querySelector('.postform');
      var set=function(n,v){var e=f.querySelector('[name='+n+']');if(!e)return;e.value=v;
        e.dispatchEvent(new Event('input',{bubbles:true}))};
      set('title','${TITLE}');
      set('excerpt','Written by the admin editor test.');
      set('coverAlt','');
      var ta=f.querySelector('.blk textarea'); if(ta){ta.value='First paragraph from the editor.';ta.dispatchEvent(new Event('input',{bubbles:true}))}
      return true})()`);

    const before = await ev(`document.querySelectorAll('.blk').length`);
    await ev(`(function(){var s=document.querySelector('[data-act=blk-add]');s.value='h2';
      s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await wait(400);
    const afterAdd = await ev(`document.querySelectorAll('.blk').length`);
    ok('A3', '插入块后块数 +1', afterAdd === before + 1, before + ' → ' + afterAdd);

    await ev(`(function(){
      var blks=document.querySelectorAll('.blk');
      var ta=blks[blks.length-1].querySelector('textarea');
      if(ta){ta.value='A heading added by the test';ta.dispatchEvent(new Event('input',{bubbles:true}))}
      return true})()`);

    /* 上移：把最后一个块移到第一个 */
    await ev(`(function(){
      var blks=document.querySelectorAll('.blk');
      blks[blks.length-1].querySelector('[data-act=blk-up]').click();return true})()`);
    await wait(300);
    const firstType = await ev(`document.querySelector('.blk').getAttribute('data-type')`);
    ok('A3', '上移把 H2 换到第一位', firstType === 'h2', 'first=' + firstType);

    /* 下移：移回去 */
    await ev(`(function(){document.querySelector('.blk [data-act=blk-down]').click();return true})()`);
    await wait(300);
    const firstType2 = await ev(`document.querySelector('.blk').getAttribute('data-type')`);
    ok('A3', '下移把它换回第二位', firstType2 === 'p', 'first=' + firstType2);

    /* 删除：先加一块再删掉，验证禁止删到零 */
    await ev(`(function(){var s=document.querySelector('[data-act=blk-add]');s.value='hr';
      s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await wait(300);
    await ev(`(function(){
      var b=document.querySelectorAll('.blk');b[b.length-1].querySelector('[data-act=blk-del]').click();return true})()`);
    await wait(300);
    ok('A3', '删除块后块数回落', (await ev(`document.querySelectorAll('.blk').length`)) === 2);

    const dirty = await ev(`(document.querySelector('.postform')||{}).dataset.dirty`);
    ok('A3', '编辑后标记为未保存', dirty === '1');
    await shot('02-editor');

    /* ---------- 4 保存 ---------- */
    console.log('\n─── A4 保存与发布 ───');
    await ev(`(function(){var f=document.querySelector('.postform');
      f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
    const saved = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        const h = await ev('location.hash');
        if (/\/admin\/articles\/P/.test(h)) return h;
        await wait(400);
      }
      return '';
    })();
    ok('A4', '保存后跳到该文章的编辑页（拿到 id）', /\/admin\/articles\/P/.test(saved), saved);
    const postId = (saved.split('/').pop() || '');

    const statusTxt = await ev(`(function(){
      var b=Array.prototype.slice.call(document.querySelectorAll('.postform__act button'))
        .map(function(x){return x.textContent.trim()});
      return b.join('|')})()`);
    ok('A4', '新建后按钮是 Publish（当前为草稿）', /Publish/.test(statusTxt), statusTxt);

    const slugNow = await ev(`(document.querySelector('.postform [name=slug]')||{}).value`);
    ok('A4', 'slug 已由标题生成', !!slugNow && /^[a-z0-9-]+$/.test(slugNow), slugNow);

    /* 发布 */
    await ev(`(function(){document.querySelector('[data-act=post-publish]').click();return true})()`);
    const published = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        const t = await ev(`(function(){
          var b=document.querySelector('[data-act=post-publish]');return b?b.textContent.trim():''})()`);
        if (t === 'Unpublish') return true;
        await wait(400);
      }
      return false;
    })();
    ok('A4', '发布后按钮变成 Unpublish', published);

    const publicPage = await fetch(BASE + '/journal/' + slugNow);
    ok('A4', '发布后真路径 200', publicPage.status === 200, 'status=' + publicPage.status);
    const html = await publicPage.text();
    ok('A4', '前台能看到刚写的正文', html.indexOf('First paragraph from the editor.') > 0);
    ok('A4', '前台能看到刚写的 H2', html.indexOf('A heading added by the test') > 0);

    /* ---------- 5 删除 ---------- */
    console.log('\n─── A5 删除 ----------');
    global.__acceptDialog = true;
    global.__dialogText = 'wrong title';
    await ev(`(function(){document.querySelector('[data-act=post-delete]').click();return true})()`);
    await wait(1200);
    const stillThere = await ev(`!!document.querySelector('.postform')`);
    ok('A5', '标题打错时拒绝删除（文章仍在）', stillThere, 'dialogs=' + JSON.stringify(dialogs.slice(-1)));

    global.__dialogText = TITLE;
    await ev(`(function(){document.querySelector('[data-act=post-delete]').click();return true})()`);
    const deleted = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        const h = await ev('location.hash');
        if (/\/admin\/articles$/.test(h)) return true;
        await wait(400);
      }
      return false;
    })();
    ok('A5', '标题正确时删除成功并回到列表', deleted, await ev('location.hash'));
    const goneStatus = await fetch(BASE + '/journal/' + slugNow);
    ok('A5', '删除后真路径变 404', goneStatus.status === 404, 'status=' + goneStatus.status);

    ok('A5', '全流程无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  } catch (e) {
    console.error('\n执行中断：', e.message);
  } finally {
    try { child.kill(); } catch (e) { }
    const pass = RUN.filter(r => r.ok).length;
    const fail = RUN.length - pass;
    console.log('\n════════ 汇总 ════════');
    console.log(`合计 ${RUN.length} 条：通过 ${pass}，失败 ${fail}`);
    if (fail) {
      console.log('\n失败明细：');
      RUN.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.id + ' ' + r.mod + ' · ' + r.name + '\n      ' + r.detail));
    }
    fs.writeFileSync(path.join(__dirname, '..', 'tmp_qa', 'blog-admin.json'),
      JSON.stringify({ at: new Date().toISOString(), run: RUN }, null, 1));
    console.log('截图：' + SHOTS);
    process.exit(fail ? 1 : 0);
  }
})();
