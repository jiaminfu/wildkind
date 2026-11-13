/* 真实点击诊断：加购 → 抽屉 → 结算 → 支付 → 完成
   逐步打印页面状态与控制台报错，定位流程断点。
   零依赖：原生 WebSocket 驱动无头 Edge（CDP）。 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const BASE = 'http://localhost:4500';
const PROF = path.join(os.tmpdir(), 'edge_diag_prof');

const wait = ms => new Promise(r => setTimeout(r, ms));
function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

(async () => {
  // 清空 profile，保证干净
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { targets = v; break; } } catch (e) { }
    await wait(250);
  }
  if (!targets) { console.error('无法连接 CDP'); proc.kill(); process.exit(1); }

  const page = targets.filter(t => t.type === 'page').sort((a, b) => (b.url.includes('4500') ? 1 : 0) - (a.url.includes('4500') ? 1 : 0))[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
    if (o.method === 'Runtime.consoleAPICalled') {
      logs.push('[console] ' + (o.params.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' '));
    }
    if (o.method === 'Runtime.exceptionThrown') {
      logs.push('[EXCEPTION] ' + (o.params.exceptionDetails.exception && o.params.exceptionDetails.exception.description || o.params.exceptionDetails.text));
    }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  const evalJS = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const click = async sel => {
    const r = await evalJS(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'NOT_FOUND'; e.scrollIntoView({block:'center'}); e.click(); return 'ok';})()`);
    await wait(420);
    return r;
  };
  const type = async (sel, val) => {
    return await evalJS(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'NOT_FOUND';
      e.focus(); e.value=${JSON.stringify(val)};
      e.dispatchEvent(new Event('input',{bubbles:true}));
      e.dispatchEvent(new Event('change',{bubbles:true}));
      return 'ok';})()`);
  };
  const snap = async label => {
    const s = await evalJS(`(function(){
      var app=document.getElementById('app');
      return {hash:location.hash, len:app?app.innerHTML.length:0, text:(app?app.innerText:'').replace(/\\s+/g,' ').slice(0,150)};
    })()`);
    console.log('— ' + label + ' → hash=' + s.hash + ' html=' + s.len + '\n   "' + s.text + '"');
    return s;
  };

  console.log('=== 开始诊断 ===');
  await send('Page.navigate', { url: BASE + '/' });
  await wait(1200);
  await evalJS('localStorage.clear(); 1');
  await send('Page.reload');
  await wait(1200);
  await snap('首页');

  // 1 商品页加购
  await evalJS('location.hash="#/products/foxtrot-pendant-necklace"; 1');
  await wait(700);
  await snap('商品页');
  console.log('  add-open 按钮存在: ' + await evalJS('!!document.querySelector("[data-act=\\"add-open\\"]")'));
  console.log('  加购按钮: ' + await click('[data-act="add-open"]'));
  await snap('点加购后');
  console.log('  抽屉是否打开: ' + await evalJS('document.body.classList.contains("drawer-open")'));
  console.log('  购物车数量: ' + await evalJS('S.cartCount()'));

  // 2 抽屉结算
  console.log('  点 Checkout: ' + await click('[data-act="checkout"]'));
  await snap('进结算');

  // 3 填表
  for (const [n, v] of [['email', 'ada@example.com'], ['first', 'Ada'], ['last', 'Lovelace'], ['line1', '12 Ocean Ave'], ['city', 'Santa Monica'], ['state', 'CA'], ['zip', '90401']]) {
    const r = await type(`.co input[name="${n}"]`, v);
    if (r !== 'ok') console.log('  ⚠ 填 ' + n + ' 失败: ' + r);
  }
  console.log('  checkoutData = ' + JSON.stringify(await evalJS('JSON.stringify(S.state.checkoutData)')));
  console.log('  点 Continue to payment: ' + await click('[data-act="to-pay"]'));
  await snap('支付步骤');
  console.log('  当前 step: ' + await evalJS('S.state.checkoutStep'));
  console.log('  错误字段数: ' + await evalJS('document.querySelectorAll(".fld.bad").length'));

  // 4 支付
  const payBtn = await evalJS('(function(){var b=document.querySelector("[data-act=\\"place\\"]"); return b? b.textContent : "NO_BUTTON";})()');
  console.log('  支付按钮文案: ' + payBtn);
  console.log('  点 Pay: ' + await click('[data-act="place"]'));
  await wait(1400);
  await snap('支付后');
  console.log('  订单数: ' + await evalJS('S.DB.orders.length'));

  console.log('\n=== 控制台 ===');
  console.log(logs.length ? logs.slice(0, 20).join('\n') : '（无）');

  sock.close(); proc.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
