/* 前后端分离版（app/web，端口 4600）双端适配与运行时体检。
   同时做三件事：
     1. 每个路由在 390 / 768 / 1440 三个宽度下检查是否产生横向滚动（顶出滚动条才算不达标）
     2. 收集 console error 与未捕获异常
     3. 校验关键元素是否渲染出来（异步 SPA 最容易「页面在但内容空」）
   用法：node tools/app-check.js
   前置：API + 前端已运行在 http://localhost:4600 */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9385;
const BASE = 'http://localhost:4600';
const OWNER = { email: 'owner@tideglassjewelry.com', password: 'tideglass2026' };
const OPS = { email: 'ops@tideglassjewelry.com', password: 'tideglass-ops' };

const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

/* 门店端路由（无需登录） */
const STORE = [
  ['/', '.rail .card'],
  ['/collections/necklaces', '.fbar'],
  ['/products/foxtrot-pendant-necklace', '.pdp__info'],
  ['/cart', '.cartlines'],   // 依赖下方的一次性加购
  ['/account/lookup', '.collhead'],
  ['/pages/about', '.prose'],        // 内容页：页脚 8 个链接都落在这里，缺一个就是 404
  ['/pages/faq', '.faq-item'],
  ['/pages/shipping', '.prose'],
  ['/custom', 'form[data-act=custom-req]'],
];

/* 后台路由（需要 owner 令牌） */
const ADMIN = [
  ['/admin', '.kpis'],
  ['/admin/orders', '.atable'],
  ['/admin/products', '.atable'],
  ['/admin/collections', '.atable'],
  ['/admin/inventory', '.atable'],
  ['/admin/coupons', '.atable'],
  ['/admin/reviews', '.revcard'],
  ['/admin/custom', '.atable'],
  ['/admin/customers', '.atable'],
  ['/admin/content', 'form[data-act=content]'],
  ['/admin/ledger', '.atable'],
  ['/admin/audit', '.atable'],
  ['/admin/settings', '.afld'],
];

const WIDTHS = [390, 768, 1440];

(async () => {
  const PROF = path.join(os.tmpdir(), 'edge_appchk_' + PORT);
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }

  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { t = v; break; } } catch (e) { }
    await wait(250);
  }
  if (!t) { console.error('无法连接 CDP'); proc.kill(); process.exit(1); }

  const page = t.filter(x => x.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });

  const consoleErrors = [];
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); return; }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails;
      consoleErrors.push('异常: ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      consoleErrors.push('console.error: ' + o.params.args.map(a => a.value || a.description || a.type).join(' ').slice(0, 160));
    }
  });

  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description) : r.result.value;
  };

  const PROBE = `(function(){
    var de=document.documentElement, vw=de.clientWidth;
    var out=[];
    document.querySelectorAll('body *').forEach(function(e){
      var cs=getComputedStyle(e);
      if(cs.position==='fixed')return;
      if(e.scrollWidth>e.clientWidth+1&&e.clientWidth>0&&cs.overflowX==='visible'){
        out.push((e.tagName+'.'+(e.className||'')).toString().slice(0,40)+' sw='+e.scrollWidth+' cw='+e.clientWidth);
      }
    });
    return JSON.stringify({vw:vw,sw:de.scrollWidth,over:de.scrollWidth-vw,leaks:out.slice(0,6)});
  })()`;

  // 先登录拿令牌，后续后台路由直接复用
  await send('Page.navigate', { url: BASE + '/' });
  await wait(1200);
  const login = await ev(`fetch('/api/v1/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(${JSON.stringify(OWNER)})}).then(function(r){return r.json()}).then(function(j){
    localStorage.setItem('tideglass_admin',JSON.stringify({token:j.data.token,staff:j.data.staff}));
    return 'token ok: '+j.data.staff.role;})`);
  console.log('登录：' + login + '\n');

  let bad = 0, total = 0;
  const all = STORE.map(x => x.concat(['store'])).concat(ADMIN.map(x => x.concat(['admin'])));

  // 购物车空态渲染的是 .empty，测不到 .cline 的真实排版，
  // 所以先走一次真实加购，让后续 /cart 检查落在有商品的布局上。
  await send('Page.navigate', { url: BASE + '/#/products/foxtrot-pendant-necklace' });
  await send('Page.reload', { ignoreCache: false });
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('[data-act=add]')`) === true) break;
    await wait(250);
  }
  const added = await ev(`(function(){var b=document.querySelector('[data-act=add]');if(!b)return 'no button';b.click();return 'clicked';})()`);
  await wait(900);
  console.log('加购预置：' + added + ' · 购物车 ' + await ev('S.cartCount()') + ' 件\n');

  for (const w of WIDTHS) {
    console.log(`—— 视口 ${w}px ——`);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 });
    for (const [route, sel] of all) {
      await send('Page.navigate', { url: BASE + '/#' + route });
      await send('Page.reload', { ignoreCache: false });
      let found = false;
      for (let i = 0; i < 40; i++) {
        if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`) === true) { found = true; break; }
        await wait(250);
      }
      await wait(400);
      const raw = await ev(PROBE);
      total++;
      let r;
      try { r = JSON.parse(raw); } catch (e) { console.log(`  ?? ${route} -> ${raw}`); bad++; continue; }
      const ok = r.over <= 1 && found;
      if (!ok) bad++;
      const why = !found ? ' 关键元素未渲染' : r.over > 1 ? ' 横向溢出 ' + r.over + 'px' : '';
      console.log(`${ok ? '  OK ' : '  !! '} ${route.padEnd(40)} over=${String(r.over).padStart(3)}${why}` +
        (r.leaks.length && !ok ? '  [' + r.leaks[0] + ']' : ''));
    }
  }

  console.log('');
  if (consoleErrors.length) {
    console.log('运行时错误 ' + consoleErrors.length + ' 条：');
    [...new Set(consoleErrors)].slice(0, 15).forEach(e => console.log('   · ' + e));
  } else {
    console.log('运行时错误：0 条');
  }
  console.log(`\n结果：${total - bad} / ${total} 通过（无横向溢出 且 关键内容已渲染）`);
  sock.close(); proc.kill();
  process.exit(bad || consoleErrors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
