/* 复现 e2e-flow 第一步：清空 localStorage 后 reload，看商品页到底渲染成什么 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9366;
const BASE = 'http://localhost:4500';
const PROF = path.join(os.tmpdir(), 'edge_diag_prof');

const wait = ms => new Promise(r => setTimeout(r, ms));
function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { targets = v; break; } } catch (e) { }
    await wait(250);
  }
  const page = targets.filter(t => t.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
    if (o.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(o.params.exceptionDetails).slice(0, 400));
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') errs.push('console.error: ' + JSON.stringify(o.params.args).slice(0, 300));
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'JS_ERROR: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.navigate', { url: BASE + '/' });
  await wait(1300);
  console.log('step1 hash=', await evalJS('location.hash'), ' appLen=', (await evalJS('document.getElementById("app").innerText.length')));
  console.log('clear:', await evalJS('localStorage.clear(); "cleared"'));
  await send('Page.reload');
  await wait(1400);
  console.log('after reload appLen=', await evalJS('document.getElementById("app").innerText.length'));
  console.log('S exists?', await evalJS('typeof S'), ' DB products:', await evalJS('(window.S && S.DB && S.DB.products) ? S.DB.products.length : "no DB"'));

  await evalJS('location.hash="#/products/foxtrot-pendant-necklace"; 1');
  await wait(1200);
  console.log('\n--- 商品页 ---');
  console.log('hash=', await evalJS('location.hash'));
  console.log('add-open?', await evalJS('!!document.querySelector("[data-act=\\"add-open\\"]")'));
  console.log('appLen=', await evalJS('document.getElementById("app").innerText.length'));
  console.log('TEXT:\n' + String(await evalJS('document.getElementById("app").innerText')).slice(0, 700));
  console.log('\nERRORS:', errs.length ? errs.join('\n') : '(none)');

  proc.kill();
  process.exit(0);
})();
