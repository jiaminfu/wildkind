/* 前端诊断：打开页面，收集控制台错误与未捕获异常，并输出渲染状态
   用法：node tools/web-diag.js [url] */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const URL = process.argv[2] || 'http://localhost:4600/#/';
const PROF = path.join(os.tmpdir(), 'edge_diag_' + PORT);
const wait = ms => new Promise(r => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(250);
    try {
      const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
      target = list.find(t => t.type === 'page');
    } catch (e) { }
  }
  if (!target) { console.error('无法连接调试端口'); proc.kill(); process.exit(1); }

  // Node 22+ 自带全局 WebSocket，无需第三方依赖
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', ev0 => {
    const m = JSON.parse(ev0.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[console.' + m.params.type + '] ' + m.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[exception] ' + (d.exception && d.exception.description || d.text) + ' @' + d.url + ':' + d.lineNumber);
    }
    if (m.method === 'Log.entryAdded') {
      logs.push('[' + m.params.entry.level + '] ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    }
  });
  const send = (method, params) => new Promise(res => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  // 轮询等 DOM 就绪：固定 wait 会在慢机器上量到 about:blank
  for (let i = 0; i < 40; i++) {
    await wait(250);
    const r = await send('Runtime.evaluate', { expression: '!!document.getElementById("app")', returnByValue: true });
    if (r.result && r.result.result && r.result.result.value === true) break;
  }
  await wait(1500);

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails.exception);
    return r.result && r.result.result ? r.result.result.value : null;
  };

  const state = await ev(`JSON.stringify({
    S: typeof window.S, UI: typeof window.UI, Views: typeof window.Views,
    AdminViews: typeof window.AdminViews, API: typeof window.API,
    hasBoot: !!(window.S && window.S.state && window.S.state.boot),
    htmlLen: document.getElementById('app').innerHTML.length,
    firstText: document.getElementById('app').innerText.slice(0,120).replace(/\\n/g,' | ')
  })`);

  console.log('页面状态：', state);
  console.log('日志（' + logs.length + '）：');
  logs.slice(0, 30).forEach(l => console.log('  ' + l));

  ws.close();
  proc.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
