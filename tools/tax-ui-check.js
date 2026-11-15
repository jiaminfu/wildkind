/* ============================================================
   LASTGROVE · 销售税 UI 验收（真浏览器）
   ------------------------------------------------------------
   为什么必须真浏览器跑：税率是「一行一州」的文本输入，前端要解析成对象。
   curl 测不出「填了 8.25 保存后界面上是不是还显示 8.25」，
   也测不出「税没开的时候申报页有没有提示」。

   用法：
     node tools/tax-ui-check.js                 # 默认 http://127.0.0.1:4600
     BASE_URL=... ADMIN_EMAIL=... ADMIN_PASS=... node tools/tax-ui-check.js
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9351;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4600';
const EMAIL = process.env.ADMIN_EMAIL || 'owner@lastgrove.com';
const PASS = process.env.ADMIN_PASS || 'lastgrove2026';
const PROF = path.resolve(__dirname, '..', 'tmp_tax', 'prof');
const OUT = path.resolve(__dirname, '..', 'tmp_tax');
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
  const ok = (n, v, extra) => rows.push({ 检查: n, 结果: v ? 'PASS' : 'FAIL', 说明: extra || '' });

  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    await waitFor('!!document.querySelector(".hdr")', 30, 500);

    /* 登录：直接打接口拿 token 塞进 localStorage，
       不走表单 —— 表单是另一条链路，这里要验的是税，不是登录。 */
    const login = await js(`(async () => {
      const r = await fetch('/api/v1/admin/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASS)} }) });
      const d = await r.json();
      if (!d.data || !d.data.token) return 'LOGIN_FAIL ' + JSON.stringify(d).slice(0, 160);
      localStorage.setItem('lastgrove_admin', JSON.stringify({ token: d.data.token, staff: d.data.staff }));
      return 'OK';
    })()`);
    ok('后台登录', login === 'OK', String(login).slice(0, 120));

    /* ① 设置页：税务面板 */
    await send('Page.navigate', { url: BASE + '/#/admin/settings' });
    const hasPanel = await waitFor('!!document.querySelector(\'form[data-act="savetax"]\')', 40, 400);
    ok('设置页出现 Sales tax 面板', !!hasPanel);
    if (hasPanel) {
      const info = await js(`(() => {
        const f = document.querySelector('form[data-act="savetax"]');
        return {
          enabledChecked: !!f.querySelector('[name="enabled"]').checked,
          hasShipTaxable: !!f.querySelector('[name="shipTaxable"]'),
          ratesValue: String(f.querySelector('[name="rates"]').value || '').replace(/\\n/g, ' | '),
          mono: getComputedStyle(f.querySelector('[name="rates"]')).fontFamily,
          callout: !!document.querySelector('.acallout'),
        };
      })()`);
      /* 首次进入时税率表本来就是空的（还没配过任何州），
         所以这里不能断言"有内容"——那是把测试环境的初始状态当成需求。
         真正要验的是：输入框用等宽字（一行一州，对得齐才看得出一行写错了），
         以及保存之后回显的是生效值（下一项）。 */
      ok('税率输入框为等宽字，便于逐行核对', info && /mono|Menlo|Consolas/i.test(info.mono),
        'rates=[' + (info && info.ratesValue) + '] font=' + (info && info.mono));
      ok('有「只填已注册州」的提示块', !!info.callout);
      await shot('01-settings-tax.png');
    }

    /* ② 改一行税率并保存，看回显是不是保存后的值 */
    if (hasPanel) {
      const saved = await js(`(async () => {
        const f = document.querySelector('form[data-act="savetax"]');
        f.querySelector('[name="rates"]').value = 'CA 7.25\\nNY 8\\nTX 8.25\\nOR 0';
        f.querySelector('[name="enabled"]').checked = true;
        f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return 'submitted';
      })()`);
      await sleep(1600);
      const after = await js(`(() => {
        const f = document.querySelector('form[data-act="savetax"]');
        return f ? {
          enabled: f.querySelector('[name="enabled"]').checked,
          rates: String(f.querySelector('[name="rates"]').value || '').replace(/\\n/g, ' | '),
          toast: (document.getElementById('toast') || {}).textContent || '',
        } : null;
      })()`);
      ok('保存后开关为开、税率回显正确',
        after && after.enabled === true && /CA 7\.25/.test(after.rates) && /NY 8/.test(after.rates),
        JSON.stringify(after));
    }

    /* ③ 申报页 */
    await send('Page.navigate', { url: BASE + '/#/admin/tax' });
    const hasTax = await waitFor('!!document.querySelector(\'form[data-act="taxrange"]\')', 40, 400);
    ok('申报页可打开', !!hasTax);
    if (hasTax) {
      const tinfo = await js(`(() => {
        const kpis = Array.from(document.querySelectorAll('.kpi')).map(k => k.innerText.replace(/\\n/g, ' '));
        return {
          kpis: kpis,
          hasExport: !!document.querySelector('[data-act="export"][data-what="tax"]'),
          exportQs: (document.querySelector('[data-act="export"][data-what="tax"]') || {}).dataset ?
            document.querySelector('[data-act="export"][data-what="tax"]').dataset.qs : '',
          hasFrom: !!document.querySelector('input[name="from"]'),
          hasTo: !!document.querySelector('input[name="to"]'),
          tables: document.querySelectorAll('table.atable').length,
          bodyHasError: /Something went wrong/i.test(document.body.innerText),
          navHasTax: !!Array.from(document.querySelectorAll('.adm__nav a')).filter(a => /Sales tax/.test(a.innerText)).length,
        };
      })()`);
      ok('KPI 三块渲染', tinfo && tinfo.kpis.length === 3, JSON.stringify(tinfo && tinfo.kpis));
      ok('有导出按钮且带区间参数', tinfo && tinfo.hasExport && /from=/.test(tinfo.exportQs), tinfo && tinfo.exportQs);
      ok('侧栏有 Sales tax 入口', !!(tinfo && tinfo.navHasTax));
      ok('页面无错误态', !!(tinfo && !tinfo.bodyHasError));
      await shot('02-admin-tax.png');
    }

    /* ④ 导出 CSV 真的能下 */
    const csv = await js(`(async () => {
      const a = JSON.parse(localStorage.getItem('lastgrove_admin'));
      const r = await fetch('/api/v1/admin/export/tax.csv?from=2026-01-01&to=2026-12-31',
        { headers: { Authorization: 'Bearer ' + a.token } });
      const txt = await r.text();
      return r.status + '|' + txt.split('\\n').slice(0, 2).join(' / ');
    })()`);
    ok('导出 CSV 可取', /^200\|/.test(String(csv)) && /Period/.test(String(csv)), String(csv).slice(0, 160));

    /* ⑤ 结算页：税行随州变化 —— 塞购物车，进结算，填州 */
    await js(`(async () => {
      const r = await fetch('/api/v1/products?limit=1'); const d = await r.json();
      const p = d.data[0]; const v = p.variants[0];
      localStorage.setItem('lastgrove_cart_v1', JSON.stringify([{ productId: p.id, handle: p.handle, title: p.title,
        image: (p.images || [])[0] || '', metal: v.metal, size: '', qty: 1, unitPrice: v.price, stock: v.stock }]));
      return 'OK';
    })()`);
    await send('Page.reload', {});
    await sleep(1200);
    await send('Page.navigate', { url: BASE + '/#/checkout' });
    const hasCo = await waitFor('!!document.querySelector(\'input[name="state"]\')', 40, 400);
    ok('结算页可打开且州字段存在', !!hasCo);
    if (hasCo) {
      const tax1 = await js(`(() => {
        const row = document.getElementById('sumTaxRow');
        return { hidden: row ? row.hidden : null, total: (document.getElementById('sumTotal') || {}).textContent };
      })()`);
      ok('未填州时不显示税行', tax1 && tax1.hidden === true, JSON.stringify(tax1));

      const after = await js(`(async () => {
        const el = document.querySelector('input[name="state"]');
        el.value = 'California';
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 1400));
        const row = document.getElementById('sumTaxRow');
        return { hidden: row ? row.hidden : null,
          tax: (document.getElementById('sumTax') || {}).textContent,
          label: (document.getElementById('sumTaxLabel') || {}).textContent,
          total: (document.getElementById('sumTotal') || {}).textContent };
      })()`);
      ok('填 California 后出现税行（7.25%，州码归一为 CA）',
        after && after.hidden === false && /CA/.test(after.label || '') && Number(String(after.tax).replace(/[^0-9.]/g, '')) > 0,
        JSON.stringify(after));

      /* 按钮金额与摘要 Total 必须一致 —— 改州之后两者都会变，
         只更新其中一个，客户就会看到两个不同的价格。 */
      const cta = await js(`(() => {
        const b = document.getElementById('payCta');
        const t = document.getElementById('sumTotal');
        const num = s => Number(String(s || '').replace(/[^0-9.]/g, ''));
        return { btn: b ? b.textContent : null, total: t ? t.textContent : null,
                 same: b && t ? num(b.textContent) === num(t.textContent) : false };
      })()`);
      ok('按钮金额与 Total 一致', !!(cta && cta.same), JSON.stringify(cta));
      await shot('03-checkout-tax.png');
    }
  } catch (e) {
    rows.push({ 检查: '运行异常', 结果: 'FAIL', 说明: e.message });
  }

  console.log('\n销售税 UI 验收');
  console.log('─'.repeat(96));
  for (const r of rows) console.log(' ', r.结果.padEnd(5), r.检查, r.说明 ? '\n         ' + r.说明 : '');
  const fail = rows.filter(r => r.结果 === 'FAIL').length;
  console.log('─'.repeat(96));
  console.log('  ' + (rows.length - fail) + ' 通过 / ' + fail + ' 失败 · 截图在 tmp_tax/');
  try { ws.close(); } catch (e) { }
  try { child.kill(); } catch (e) { }
  process.exit(fail ? 1 : 0);
})();
