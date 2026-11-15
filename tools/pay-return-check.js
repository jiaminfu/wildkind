/* ============================================================
   LASTGROVE · PayPal 回跳落点验证（真浏览器，跑线上站点）
   ------------------------------------------------------------
   要验的只有一件事：PayPal 把 token 追加到 return_url 的问号段之后，
   /#/order/confirm 能不能读到它。

   为什么必须真浏览器：这个 bug 只在前端路由里，纯 API 测不出来。
   PayPal 回跳的真实形状是
     https://lastgrove.com/?token=7AB...&PayerID=XYZ#/order/confirm
   参数在 hash 之前 —— 只看 location.hash 的解析器就读不到。
   读不到的后果是：钱已经扣了、页面却显示「Payment link incomplete」。

   三种形态都要过：
     ① ?token=…#/order/confirm   （PayPal 的实际形状）
     ② #/order/confirm?token=…    （万一通道把参数拼在 hash 里）
     ③ #/order/confirm            （真·没有 token，必须明确报缺参，不能白屏）

   用法：node tools/pay-return-check.js
   ============================================================ */
'use strict';
const http = require('http');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9337;
const BASE = process.env.BASE_URL || 'https://lastgrove.com';
const PROF = 'D:/桔子/tmp_e2e/prof_pay';

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

const CASES = [
  {
    name: '① token 在问号段（PayPal 实际形状）',
    url: BASE + '/?token=TESTONLY-ABC&PayerID=ZZZ#/order/confirm',
    want: 'has-token',
  },
  {
    name: '② token 在 hash 内',
    url: BASE + '/#/order/confirm?token=TESTONLY-ABC',
    want: 'has-token',
  },
  {
    name: '③ 没有任何 token',
    url: BASE + '/#/order/confirm',
    want: 'no-token',
  },
];

(async () => {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF,
    '--window-size=1400,900',
    'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 50; i++) {
    try { targets = await getJSON('/json'); if (targets && targets.length) break; } catch (e) { }
    await sleep(400);
  }
  if (!targets) { console.log('FAIL: devtools 未就绪'); child.kill(); process.exit(1); }
  const page = targets.filter(t => t.type === 'page')[0];

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  await new Promise(res => { ws.onopen = res; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, m => m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result));
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async function evalJS(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('JS: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || ''));
    }
    return r.result.value;
  }

  let pass = 0, fail = 0;
  const rows = [];
  try {
    await send('Runtime.enable');
    await send('Page.enable');

    for (const c of CASES) {
      await send('Page.navigate', { url: c.url });
      /* 跨境链路首字节偶发 3–10s，给足 6 秒再判，避免把「慢」当成「错」 */
      let h1 = '', body = '';
      for (let i = 0; i < 15; i++) {
        await sleep(700);
        h1 = await evalJS('(document.querySelector("h1")||{}).textContent||""').catch(() => '');
        if (h1.trim()) break;
      }
      body = await evalJS('document.body.innerText.slice(0,600)').catch(() => '');
      const hasIncomplete = /Payment link incomplete/i.test(body);
      const hasConfirmFail = /could not confirm the payment/i.test(body);
      const hasNotCompleted = /Payment not completed/i.test(body);
      const hasConfirming = /Confirming your payment/i.test(body);

      let verdict;
      if (c.want === 'has-token') {
        /* token 读到了：要么「确认中」，要么「没法确认」——都说明解析到了 token。
           读不到才会是「Payment link incomplete」。 */
        verdict = !hasIncomplete && (hasConfirmFail || hasNotCompleted || hasConfirming);
      } else {
        verdict = hasIncomplete;
      }
      if (verdict) pass++; else fail++;
      rows.push({
        用例: c.name,
        结果: verdict ? 'PASS' : 'FAIL',
        H1: h1.trim().slice(0, 46),
        判定: verdict
          ? (c.want === 'has-token' ? 'token 已读到' : '正确报缺参')
          : (hasIncomplete ? '误报缺参（token 丢了）' : '未见预期文案'),
      });
    }
  } catch (e) {
    console.log('异常：', e.message);
    fail++;
  } finally {
    try { ws.close(); } catch (e) { }
    child.kill();
  }

  console.table(rows);
  console.log('%s 通过 / %s 失败', pass, fail);
  process.exit(fail ? 1 : 0);
})();
