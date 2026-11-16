/* ============================================================
   LASTGROVE · 员工管理 UI 验收（真浏览器）
   ------------------------------------------------------------
   为什么必须真浏览器：这一页的价值全在「护栏」和「联动」上 ——
   改角色时权限框跟不跟着变、自己的账号为什么不能停用、
   最后一个 owner 的删除按钮是不是真的按不动。接口测得出 409，
   测不出「按钮该禁没禁、人会不会一头撞上去才知道」。

   用法：
     node tools/staff-ui-check.js
     BASE_URL=... ADMIN_PASS=... node tools/staff-ui-check.js
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9353;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4600';
const EMAIL = process.env.ADMIN_EMAIL || 'owner@lastgrove.com';
const PASS = process.env.ADMIN_PASS || 'lastgrove2026';
const PROF = path.resolve(__dirname, '..', 'tmp_staff', 'prof');
const OUT = path.resolve(__dirname, '..', 'tmp_staff');
fs.mkdirSync(OUT, { recursive: true });

const QA_EMAIL = 'qa-staff-' + Date.now().toString(36) + '@example.com';

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
    '--window-size=1440,1000', '--force-device-scale-factor=2'];
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
    return r.exceptionDetails ? ('ERR ' + String((r.exceptionDetails.exception || {}).description || '').slice(0, 240)) : r.result.value;
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
  const ok = (n, v, extra) => rows.push({ 检查: n, 结果: v ? 'PASS' : 'FAIL', 说明: extra ? String(extra).slice(0, 90) : '' });

  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });

    /* ---------- 登录 ---------- */
    await send('Page.navigate', { url: BASE + '/#/admin' });
    await waitFor('!!document.querySelector(\'form[data-act="login"]\')', 40, 400);
    await js(`(function(){
      var f = document.querySelector('form[data-act="login"]');
      f.email.value = ${JSON.stringify(EMAIL)};
      f.password.value = ${JSON.stringify(PASS)};
      f.querySelector('button[type=submit]').click();
      return 1;
    })()`);
    const logged = await waitFor('!!document.querySelector(".adm__nav")', 50, 400);
    ok('登录进入后台', !!logged);

    /* ---------- 侧栏入口 ---------- */
    const navHas = await js(`!!document.querySelector('.adm__nav a[href$="#/admin/staff"]')`);
    ok('侧栏出现 Staff 入口', !!navHas);

    await send('Page.navigate', { url: BASE + '/#/admin/staff' });
    const listed = await waitFor('!!document.querySelector(\'form[data-act="staff-create"]\')', 40, 400);
    ok('员工页渲染出「添加」表单', !!listed);

    /* ---------- 列表 ---------- */
    const info = await js(`JSON.stringify((function(){
      var trs = Array.prototype.slice.call(document.querySelectorAll('.atable tbody tr'));
      return {
        rows: trs.length,
        firstHasOwner: /owner/.test(trs[0] ? trs[0].textContent : ''),
        youTag: trs.filter(function(tr){var g = tr.querySelector('.tag'); return !!g && /you/.test(g.textContent);}).length,
        kpis: Array.prototype.slice.call(document.querySelectorAll('.kpi b')).map(function(b){return b.textContent;}),
        hasManage: document.querySelectorAll('a.abtn[href^="#/admin/staff/"]').length
      };
    })())`);
    const L = JSON.parse(info || '{}');
    ok('表格有账号行', L.rows >= 2, L.rows + ' 行');
    ok('owner 排在第一行', L.firstHasOwner);
    ok('自己那行带 you 标记', L.youTag === 1, L.youTag + ' 个');
    ok('KPI 显示账号 / 启用 / owner 数', (L.kpis || []).length === 3, (L.kpis || []).join(' / '));
    ok('每行都有 Manage 入口', L.hasManage >= L.rows, L.hasManage + ' 个');

    /* ---------- 权限勾选联动 ---------- */
    const grid = await js(`(function(){
      var f = document.querySelector('form[data-act="staff-create"]');
      return JSON.stringify({
        boxes: f.querySelectorAll('input[name="perms"]').length,
        checked: f.querySelectorAll('input[name="perms"]:checked').length,
        role: f.role.value
      });
    })()`);
    const G = JSON.parse(grid || '{}');
    ok('权限位共 12 项', G.boxes === 12, G.boxes + ' 项');
    ok('默认角色 support 预勾 4 项', G.role === 'support' && G.checked === 4, G.role + ' / ' + G.checked);

    const afterOwner = await js(`(function(){
      var f = document.querySelector('form[data-act="staff-create"]');
      f.role.value = 'owner';
      f.role.dispatchEvent(new Event('change', { bubbles: true }));
      return String(f.querySelectorAll('input[name="perms"]:checked').length);
    })()`);
    ok('切到 owner 时权限全勾（12）', afterOwner === '12', afterOwner);

    const afterSupport = await js(`(function(){
      var f = document.querySelector('form[data-act="staff-create"]');
      f.role.value = 'support';
      f.role.dispatchEvent(new Event('change', { bubbles: true }));
      return String(f.querySelectorAll('input[name="perms"]:checked').length);
    })()`);
    ok('切回 support 权限缩回 4 项', afterSupport === '4', afterSupport);

    /* ---------- 建一个账号 ---------- */
    await js(`(function(){
      var f = document.querySelector('form[data-act="staff-create"]');
      f.name.value = 'QA Bot';
      f.email.value = ${JSON.stringify(QA_EMAIL)};
      f.password.value = 'qa-pass-1234';
      f.querySelector('button[type=submit]').click();
      return 1;
    })()`);
    const created = await waitFor(
      `!!Array.prototype.slice.call(document.querySelectorAll('.atable tbody tr'))
         .filter(function(tr){return tr.textContent.indexOf(${JSON.stringify(QA_EMAIL)}) >= 0;}).length`,
      50, 400);
    ok('新建账号出现在列表里', !!created, QA_EMAIL);
    await shot('01-list.png');

    /* ---------- 自己的账号：不能停用自己、没有危险区 ---------- */
    const myId = await js(`(function(){
      var tr = Array.prototype.slice.call(document.querySelectorAll('.atable tbody tr'))
        .filter(function(x){return !!x.querySelector('.tag');})[0];
      var a = tr && tr.querySelector('a.abtn[href^="#/admin/staff/"]');
      return a ? a.getAttribute('href').split('/').pop() : '';
    })()`);
    await send('Page.navigate', { url: BASE + '/#/admin/staff/' + myId });
    await waitFor('!!document.querySelector(\'form[data-act="staff-save"]\')', 40, 400);
    const self = await js(`JSON.stringify({
      statusDisabled: !!document.querySelector('form[data-act="staff-save"] select[name="status"][disabled]'),
      hasDanger: !!document.querySelector('[data-act="staff-del"]'),
      hasCurrentPw: !!document.querySelector('form[data-act="staff-pw"] input[name="currentPassword"]'),
      hint: document.body.textContent.indexOf('cannot disable it') >= 0
    })`);
    const S = JSON.parse(self || '{}');
    ok('自己账号的 Status 下拉是禁用的', S.statusDisabled);
    ok('自己账号没有删除按钮', !S.hasDanger);
    ok('改自己密码要填当前密码', S.hasCurrentPw);
    ok('页面说明了为什么不能停用', S.hint);

    /* ---------- 别人的账号：有危险区 ---------- */
    const qaId = await js(`(function(){
      var tr = Array.prototype.slice.call(document.querySelectorAll('.atable tbody tr'))
        .filter(function(x){return x.textContent.indexOf(${JSON.stringify(QA_EMAIL)}) >= 0;})[0];
      var a = tr && tr.querySelector('a.abtn[href^="#/admin/staff/"]');
      return a ? a.getAttribute('href').split('/').pop() : '';
    })()`);
    await send('Page.navigate', { url: BASE + '/#/admin/staff' });
    await waitFor('!!document.querySelector(\'form[data-act="staff-create"]\')', 40, 400);
    const qaHref = await js(`(function(){
      var tr = Array.prototype.slice.call(document.querySelectorAll('.atable tbody tr'))
        .filter(function(x){return x.textContent.indexOf(${JSON.stringify(QA_EMAIL)}) >= 0;})[0];
      return tr ? tr.querySelector('a.abtn').getAttribute('href') : '';
    })()`);
    ok('新账号可取到详情链接', /^#\/admin\/staff\/S\d+$/.test(String(qaHref)), qaHref);
    await send('Page.navigate', { url: BASE + qaHref });
    await waitFor('!!document.querySelector(\'form[data-act="staff-save"]\')', 40, 400);
    const other = await js(`JSON.stringify({
      hasDanger: !!document.querySelector('[data-act="staff-del"]'),
      statusEnabled: !document.querySelector('form[data-act="staff-save"] select[name="status"]').disabled,
      noCurrentPw: !document.querySelector('form[data-act="staff-pw"] input[name="currentPassword"]')
    })`);
    const O = JSON.parse(other || '{}');
    ok('他人账号有删除按钮', O.hasDanger);
    ok('他人账号可改状态', O.statusEnabled);
    ok('重置他人密码不问旧密码', O.noCurrentPw);
    await shot('02-detail.png');

    /* ---------- 从界面删掉这个账号 ---------- */
    await js(`(function(){ window.confirm = function(){ return true; }; return 1; })()`);
    await js(`(function(){ document.querySelector('[data-act="staff-del"]').click(); return 1; })()`);
    const back = await waitFor('!!document.querySelector(\'form[data-act="staff-create"]\')', 40, 400);
    const gone = await js(`document.body.textContent.indexOf(${JSON.stringify(QA_EMAIL)}) < 0`);
    ok('删除后回到列表', !!back);
    ok('被删账号不再出现在列表', !!gone);

    await shot('03-after-delete.png');

    /* ---------- 非 owner 看不到员工入口 ---------- */
    const opsLogin = await js(`(async () => {
      const r = await fetch('/api/v1/admin/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ops@lastgrove.com', password: 'lastgrove-ops' }) });
      const d = await r.json();
      if (!d.data || !d.data.token) return 'NO_OPS';
      localStorage.setItem('lastgrove_admin', JSON.stringify({ token: d.data.token, staff: d.data.staff }));
      return 'OK';
    })()`);
    ok('可用 ops 账号登录', opsLogin === 'OK', opsLogin);
    await send('Page.navigate', { url: BASE + '/#/admin' });
    await waitFor('!!document.querySelector(".adm__nav")', 40, 400);
    /* 没权限的入口不该出现在侧栏。只靠接口 403 拦的话，
       人会点进去才发现自己没权限，然后以为是坏了。 */
    const opsHidden = await js(`!document.querySelector('.adm__nav a[href$="#/admin/staff"]')`);
    ok('非 owner 侧栏不显示 Staff', !!opsHidden);
    const opsStillHasOrders = await js(`!!document.querySelector('.adm__nav a[href$="#/admin/orders"]')`);
    ok('非 owner 其他入口照常显示', !!opsStillHasOrders);
    await shot('04-ops-nav.png');

    /* ---------- 没有 JS 报错 ---------- */
    const errs = await js(`String(window.__errs ? window.__errs.length : 0)`);
    ok('页面无脚本异常', errs === '0' || errs === 'undefined', errs);
  } catch (e) {
    ok('执行过程', false, e.message);
  }

  /* ---------- 输出 ---------- */
  console.log('');
  console.log('┌' + '─'.repeat(28) + '┬' + '─'.repeat(6) + '┬' + '─'.repeat(40) + '┐');
  console.log('│ ' + '检查'.padEnd(26) + ' │ ' + '结果'.padEnd(4) + ' │ ' + '说明'.padEnd(38) + ' │');
  console.log('├' + '─'.repeat(28) + '┼' + '─'.repeat(6) + '┼' + '─'.repeat(40) + '┤');
  rows.forEach(r => {
    console.log('│ ' + String(r.检查).padEnd(26) + ' │ ' + String(r.结果).padEnd(4) + ' │ ' + String(r.说明).padEnd(38) + ' │');
  });
  console.log('└' + '─'.repeat(28) + '┴' + '─'.repeat(6) + '┴' + '─'.repeat(40) + '┘');
  const bad = rows.filter(r => r.结果 === 'FAIL').length;
  console.log('通过 ' + (rows.length - bad) + ' / ' + rows.length + (bad ? ' — 有失败项' : ' — 全绿'));

  ws.close();
  child.kill();
  process.exit(bad ? 1 : 0);
})();
