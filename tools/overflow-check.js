/* 横向溢出批量检查：多路由 × 多宽度，一次开一个浏览器跑完。
   判定：documentElement.scrollWidth > clientWidth 即为溢出，并列出具体溢出元素
   （靠 body{overflow-x:hidden} 掩盖的问题不算解决，所以这里只检测真实溢出）。
   用法：node tools/overflow-check.js */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9371;
const BASE = 'http://localhost:4500';
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

const ROUTES = [
  ['/', '.rail .card'],
  ['/collections/necklaces', '.fbar'],
  ['/collections/best-sellers?metal=Gold', '.fbar'],
  ['/products/foxtrot-pendant-necklace', '.pdp__info'],
  ['/checkout?demo=cart', '.co'],
  ['/account', '.acct2'],
  ['/pages/about', '.page__body'],
  // 原型的后台已下线（#/admin 现在是一个指向 4600 的说明页），
  // 后台的双端适配改由 tools/app-check.js + tools/admin-sweep.js 在 4600 上验证。
];
const WIDTHS = [470, 900, 1200, 1440];

(async () => {
  const PROF = path.join(os.tmpdir(), 'edge_ovf_' + PORT);
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
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
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
        out.push((e.tagName+'.'+(e.className||'')).toString().slice(0,32)+' sw='+e.scrollWidth+' cw='+e.clientWidth);
      }
    });
    return JSON.stringify({vw:vw,sw:de.scrollWidth,over:de.scrollWidth-vw,leaks:out.slice(0,5)});
  })()`;

  let bad = 0, total = 0;
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 });
    for (const [route, sel] of ROUTES) {
      await send('Page.navigate', { url: BASE + '/#' + route });
      for (let i = 0; i < 40; i++) {
        if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`) === true) break;
        await wait(250);
      }
      await wait(350);
      const raw = await ev(PROBE);
      total++;
      let r;
      try { r = JSON.parse(raw); } catch (e) { console.log(`  ?? ${w}px ${route} -> ${raw}`); bad++; continue; }
      /* 判据只看页面级是否真的产生横向滚动（over > 1px）。
         容器级 scrollWidth 超出不算错——bag 角标、色点选中环、字标负边距补偿都会让子盒比父盒宽，
         只要没顶出滚动条就不影响用户；把它们列出来只为排查时有个线索。 */
      const ok = r.over <= 1;
      if (!ok) bad++;
      const hint = r.leaks.length ? '  (' + r.leaks.length + ' 处内部盒偏宽，未产生滚动)' : '';
      console.log(`${ok ? '  OK ' : '  !! '} ${String(w).padStart(4)}px ${route.padEnd(38)} over=${r.over}${hint}`);
    }
  }
  console.log(`\n结果：${total - bad} / ${total} 无横向溢出`);
  sock.close(); proc.kill(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
