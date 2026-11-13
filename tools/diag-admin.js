/* 复现「后台点击订单列表就退出/报错」。
   与 app-check.js 的区别：这里走真实交互路径——表单登录 → 点侧边栏链接，
   而不是直接往 localStorage 写令牌再整页刷新。异步 SPA 的问题常常只在真实点击时出现。
   用法：node tools/diag-admin.js [hash]   默认 #/admin/orders */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9387;
const BASE = 'http://localhost:4600';
// 注意：Git Bash 会把以 / 开头的参数改写成 Windows 路径，所以这里收「不带前导斜杠」的形式
const TARGET = '/' + String(process.argv[2] || 'admin/orders').replace(/^\/+/, '');
const WIDTH = Number(process.argv[3] || 1440);

const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const PROF = path.join(os.tmpdir(), 'edge_diag_' + PORT);
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }

  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, '--window-size=' + WIDTH + ',900', 'about:blank'], { stdio: 'ignore' });
  let tabs = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { tabs = v; break; } } catch (e) { }
    await wait(250);
  }
  if (!tabs) { console.error('无法连接 CDP'); proc.kill(); process.exit(1); }

  const page = tabs.filter(x => x.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });

  const logs = [], nets = [];
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); return; }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails;
      logs.push('异常: ' + (d.exception && d.exception.description ? d.exception.description.split('\n').slice(0, 2).join(' | ') : d.text));
    }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      logs.push('console.error: ' + o.params.args.map(a => a.value || a.description || a.type).join(' ').slice(0, 240));
    }
    if (o.method === 'Network.responseReceived') {
      const r = o.params.response;
      if (r.status >= 400) nets.push(r.status + ' ' + r.url.replace(BASE, ''));
    }
    if (o.method === 'Network.loadingFailed') {
      nets.push('FAIL ' + o.params.errorText + ' ' + (o.params.type || ''));
    }
  });

  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0];
    return r.result.value;
  };

  if (WIDTH !== 1440) await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 700 });

  await send('Page.navigate', { url: BASE + '/#/admin' });
  // 等登录表单真的挂上去（SPA 首屏是异步的，固定 sleep 会偶发拿到骨架屏）
  for (let i = 0; i < 60; i++) {
    if (await ev(`!!document.querySelector('form[data-act=login]')`) === true) break;
    await wait(250);
  }

  // 1) 用真实表单登录
  const filled = await ev(`(function(){
    var f=document.querySelector('form[data-act=login]'); if(!f) return 'no form';
    f.email.value='owner@tideglassjewelry.com'; f.password.value='tideglass2026';
    f.querySelector('button[type=submit],button').click(); return 'submitted';
  })()`);
  console.log('登录表单：' + filled);
  let okDash = false;
  for (let i = 0; i < 40; i++) {
    if (await ev('!!document.querySelector(".kpis")') === true) { okDash = true; break; }
    await wait(250);
  }
  console.log('登录后看板渲染：' + (okDash ? 'OK' : '失败'));
  console.log('localStorage：' + await ev(`(function(){try{var v=JSON.parse(localStorage.getItem('tideglass_admin')||'null');
    return v? 'token '+String(v.token).slice(0,8)+'… role '+v.staff.role : '无';}catch(e){return '解析失败 '+e.message}})()`));

  // 2) 记录当前 hash，然后点侧边栏 Orders 链接（真实交互）
  logs.length = 0; nets.length = 0;
  const before = await ev('location.hash');
  const clicked = await ev(`(function(){
    var a=[].slice.call(document.querySelectorAll('.adm__nav a')).filter(function(x){
      return (x.getAttribute('href')||'').split('?')[0]==='#${TARGET}';})[0];
    if(!a) return 'no nav link; 现有：' + [].slice.call(document.querySelectorAll('.adm__nav a')).map(function(x){return x.getAttribute('href')}).join(',');
    a.click(); return 'clicked';
  })()`);
  console.log('\n点击导航 [' + before + ' → #' + TARGET + ']：' + clicked);
  await wait(2200);

  const after = await ev(`(function(){
    var b=document.body;
    return JSON.stringify({
      hash: location.hash,
      hasLogin: !!document.querySelector('.loginwrap'),
      hasTable: !!document.querySelector('.atable'),
      hasErrBox: !!document.querySelector('.err,.toast--err,.emptyst'),
      bodyStart: (b.innerText||'').slice(0,300)
    });})()`);
  try {
    const st = JSON.parse(after);
    st.bodyStart = st.bodyStart.split('\n').join(' / ').slice(0, 220);
    console.log('点击后状态：' + JSON.stringify(st, null, 0));
  } catch (e) { console.log('点击后状态：' + after); }

  console.log('\n控制台/异常：' + (logs.length ? '' : '无'));
  [...new Set(logs)].forEach(l => console.log('  · ' + l));
  console.log('请求失败：' + (nets.length ? '' : '无'));
  [...new Set(nets)].forEach(l => console.log('  · ' + l));

  sock.close(); proc.kill();
})().catch(e => { console.error(e); process.exit(1); });
