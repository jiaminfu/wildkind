/* 打开任意路由，打印控制台错误、页面异常与指定属性清单
   用法: node tools/probe.js "/products/tidepool-choker" "[data-act]" */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9351;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

const HASH = process.argv[2] || '/';
const SEL = process.argv[3] || '[data-act]';
const PROF = path.join(os.tmpdir(), 'edge_probe_prof');

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { t = v; break; } } catch (e) { }
    await wait(250);
  }
  const page = t.filter((x) => x.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  sock.addEventListener('message', (ev) => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
    if (o.method === 'Runtime.consoleAPICalled') logs.push('console.' + o.params.type + ': ' + o.params.args.map((a) => a.value || a.description || '').join(' '));
    if (o.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (o.params.exceptionDetails.exception && o.params.exceptionDetails.exception.description || o.params.exceptionDetails.text));
  });
  await new Promise((r) => sock.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description) : r.result.value;
  };
  await send('Page.navigate', { url: 'http://localhost:4500/#' + HASH });
  await wait(1600);
  console.log('URL =', await ev('location.href'));
  console.log('main内文本长度 =', await ev('(document.querySelector("#main")||{}).innerText?.length || 0'));
  console.log('匹配 ' + SEL + ' 数量 =', await ev('document.querySelectorAll(' + JSON.stringify(SEL) + ').length'));
  console.log('清单 =', JSON.stringify(await ev('Array.from(document.querySelectorAll(' + JSON.stringify(SEL) + ')).slice(0,25).map(function(e){return e.getAttribute("data-act")||e.className})')));
  console.log('控制台 =', logs.length ? logs.slice(0, 10).join(' | ') : '无');
  sock.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
