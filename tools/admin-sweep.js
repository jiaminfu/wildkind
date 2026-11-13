/* 后台原型全量巡查：逐个点侧边栏模块，报告「是否渲染出内容 / 是否掉回登录 / 是否报错」。
   与 app-check.js 的分工：app-check 用令牌 + 整页刷新验证「地址能打开」，
   这里走真实点击（同一标签页内切路由），专门抓只在交互路径上才炸的问题。

   用法：node tools/admin-sweep.js [base] [width] [email] [password]
   例：  node tools/admin-sweep.js http://localhost:4600 390
        node tools/admin-sweep.js http://localhost:4500 1440
*/
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9389;
const BASE = (process.argv[2] || 'http://localhost:4600').replace(/\/+$/, '');
const WIDTH = Number(process.argv[3] || 1440);
const EMAIL = process.argv[4] || 'owner@tideglassjewelry.com';
const PASS = process.argv[5] || 'tideglass2026';
const SHOT = process.env.SHOT || '';   // 给目录就顺带整页截图，便于肉眼复核

const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const PROF = path.join(os.tmpdir(), 'edge_sweep_' + PORT);
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
  sock.addEventListener('message', e => {
    const o = JSON.parse(e.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); return; }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails;
      logs.push((d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      logs.push('console: ' + o.params.args.map(a => a.value || a.description || a.type).join(' ').slice(0, 200));
    }
    if (o.method === 'Network.responseReceived' && o.params.response.status >= 400) {
      nets.push(o.params.response.status + ' ' + o.params.response.url.replace(BASE, ''));
    }
  });

  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'ERR ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').split('\n')[0];
    return r.result.value;
  };
  const until = async (expr, tries = 60) => {
    for (let i = 0; i < tries; i++) { if (await ev(expr) === true) return true; await wait(250); }
    return false;
  };

  if (WIDTH !== 1440) await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 700 });

  await send('Page.navigate', { url: BASE + '/#/admin' });
  const hasForm = await until(`!!document.querySelector('form[data-act=login]')`);
  console.log(`巡查 ${BASE} @${WIDTH}px 账号 ${EMAIL}`);
  if (hasForm) {
    const r = await ev(`(function(){var f=document.querySelector('form[data-act=login]');
      if(!f) return 'no form'; f.email.value=${JSON.stringify(EMAIL)}; f.password.value=${JSON.stringify(PASS)};
      var b=f.querySelector('button[type=submit]')||f.querySelector('button'); b.click(); return 'ok';})()`);
    console.log('登录提交：' + r);
  } else {
    console.log('无需登录（原型直接开放后台）');
  }
  const dashOk = await until(`!!document.querySelector('.kpis')`, 60);
  console.log('看板渲染：' + (dashOk ? 'OK' : '失败（后续巡查可能无意义）'));
  if (!dashOk) { sock.close(); proc.kill(); process.exit(1); }

  // 收集侧边栏全部链接，逐个真实点击
  const links = JSON.parse(await ev(`JSON.stringify([].slice.call(document.querySelectorAll('.adm__nav a')).map(function(a){
    return { href: a.getAttribute('href') || '', text: (a.innerText||'').trim() }; }))`));
  if (!links.length) { console.log('未找到侧边栏导航（选择器 .adm__nav 不匹配）'); sock.close(); proc.kill(); process.exit(1); }

  let fails = [];
  for (const l of links) {
    if (!l.href || l.href === '#' || /logout/i.test(l.href)) continue;
    logs.length = 0; nets.length = 0;
    await ev(`(function(){var a=[].slice.call(document.querySelectorAll('.adm__nav a')).filter(function(x){
      return (x.getAttribute('href')||'')===${JSON.stringify(l.href)};})[0]; a && a.click();})()`);
    await wait(1500);
    const st = JSON.parse(await ev(`JSON.stringify({
      hash: location.hash,
      login: !!document.querySelector('.loginwrap'),
      content: document.querySelector('.adm__body') ? document.querySelector('.adm__body').innerText.length : 0,
      err: (document.querySelector('.empty,.err,.toast')||{}).innerText||'',
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vw: document.documentElement.clientWidth,
      leaks: (function(){
        var out=[];
        document.querySelectorAll('.adm__body *').forEach(function(e){
          if (getComputedStyle(e).position==='fixed') return;
          if (e.scrollWidth>e.clientWidth+1 && e.clientWidth>0 && getComputedStyle(e).overflowX==='visible')
            out.push((e.tagName+'.'+(typeof e.className==='string'?e.className:'')).slice(0,44)+' sw='+e.scrollWidth+' cw='+e.clientWidth);
        });
        return out.slice(0,4);
      })()
    })`));
    if (SHOT) {
      try {
        fs.mkdirSync(SHOT, { recursive: true });
        // SHOT_H 给高度就按视口截（看细节用），SHOT_SCALE 放大倍数
        const fullH = Math.min(Number(await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')) || 900, 6000);
        const h = process.env.SHOT_H ? Math.min(Number(process.env.SHOT_H), fullH) : fullH;
        const cap = await send('Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: Number(await ev('document.documentElement.clientWidth')), height: h, scale: Number(process.env.SHOT_SCALE || 1) },
        });
        const nm = (l.href === '#/admin' ? 'admin-dashboard'
          : l.href.replace(/^#\//, '').replace(/[\/]+/g, '-')) + '.png';
        fs.writeFileSync(path.join(SHOT, nm), Buffer.from(cap.data, 'base64'));
      } catch (e) { console.log('    截图失败 ' + e.message); }
    }
    const bad = [];
    if (st.login) bad.push('掉回登录页');
    if (st.hash !== l.href) bad.push('路由未切换(' + st.hash + ')');
    if (st.content < 40) bad.push('内容空(' + st.content + ' 字符)');
    if (st.over > 1) bad.push('横向溢出 ' + st.over + 'px' +
      (st.leaks && st.leaks.length ? ' [' + st.leaks[0] + ']' : ''));
    const uniq = [...new Set(logs)];
    if (uniq.length) bad.push('报错 ' + uniq.length + ' 条');
    if (bad.length) fails.push({ href: l.href, text: l.text, bad, logs: uniq.slice(0, 3), nets: [...new Set(nets)].slice(0, 3) });
    console.log(`  ${bad.length ? '!!' : 'OK'} ${String(l.text || '-').padEnd(14)} ${l.href.padEnd(22)} 内容 ${String(st.content).padStart(5)} 字符 溢出 ${String(st.over).padStart(4)}px` + (bad.length ? '  ← ' + bad.join('；') : ''));
  }

  /* 订单行点击 → 详情。列表能渲染不代表能点进去：
     单元格内容被包了一层 .tdv，若事件依赖直接子元素就会失效，这里守住。 */
  await ev(`(function(){var a=[].slice.call(document.querySelectorAll('.adm__nav a')).filter(function(x){
    return (x.getAttribute('href')||'')==='#/admin/orders';})[0]; a&&a.click();})()`);
  await wait(1400);
  const rowClick = await ev(`(function(){
    var tr=document.querySelector('tr[data-act=open-order]');
    if(!tr) return 'no row';
    tr.click(); return 'clicked';})()`);
  await wait(1500);
  const detail = JSON.parse(await ev(`JSON.stringify({
    hash: location.hash,
    back: !!document.querySelector('a[href="#/admin/orders"]'),
    text: (document.querySelector('.adm__body')||{}).innerText ? document.querySelector('.adm__body').innerText.slice(0,120) : ''
  })`));
  const detOk = rowClick === 'clicked' && /#\/admin\/orders\/./.test(detail.hash) && detail.back;
  console.log(`订单行进详情：${detOk ? 'OK' : '!!'} 点击=${rowClick} hash=${detail.hash}`);
  if (SHOT) {
    try {
      const fullH = Math.min(Number(await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')) || 900, 6000);
      const h2 = process.env.SHOT_H ? Math.min(Number(process.env.SHOT_H), fullH) : fullH;
      const cap2 = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Number(await ev('document.documentElement.clientWidth')), height: h2, scale: Number(process.env.SHOT_SCALE || 1) },
      });
      fs.writeFileSync(path.join(SHOT, 'admin-order-detail.png'), Buffer.from(cap2.data, 'base64'));
    } catch (e) { console.log('  详情截图失败 ' + e.message); }
  }
  if (!detOk) fails.push({ href: '(order-detail)', text: '订单详情', bad: ['点行未进入详情'], logs: [], nets: [] });

  /* 后台写操作：找一个 paid 订单，在页面上点一次状态按钮，再用接口核对结果。
     只读巡查会放过"按钮在但点了没反应"这类问题——而那正是运营每天都在做的事。 */
  const write = await ev(`(async function(){
    var t=(JSON.parse(localStorage.getItem('tideglass_admin')||'{}').token)||'';
    var h={'Content-Type':'application/json',Authorization:'Bearer '+t};
    var list=await fetch('/api/v1/admin/orders?status=paid&limit=1',{headers:h}).then(function(r){return r.json()});
    var o=(list.data||[])[0];
    if(!o) return JSON.stringify({skip:'没有 paid 订单可测'});
    location.hash='#/admin/orders/'+encodeURIComponent(o.number);
    await new Promise(function(r){setTimeout(r,1300)});
    var b=document.querySelector('[data-act=ostatus]');
    if(!b) return JSON.stringify({num:o.number,err:'详情页没有状态按钮'});
    var to=b.getAttribute('data-to'); b.click();
    await new Promise(function(r){setTimeout(r,1300)});
    var after=await fetch('/api/v1/admin/orders/'+encodeURIComponent(o.number),{headers:h}).then(function(r){return r.json()});
    return JSON.stringify({num:o.number,to:to,now:after.data.order.status});
  })()`);
  let wr = {};
  try { wr = JSON.parse(write); } catch (e) { wr = { err: String(write) }; }
  const wrOk = wr.skip ? true : (wr.now && wr.now === wr.to);
  console.log(`后台状态写操作：${wrOk ? 'OK' : '!!'} ` +
    (wr.skip ? wr.skip : wr.err ? wr.err : wr.num + ' → ' + wr.now + '（期望 ' + wr.to + '）'));
  if (!wrOk) fails.push({ href: '(order-status-write)', text: '状态流转', bad: [wr.err || '状态未变'], logs: [], nets: [] });

  /* 会话过期场景：这是「点一下菜单就退出登录」的原始缺陷。
     早先 401 是静默删令牌，用户只会看到自己突然被踢出来。
     现在要求：掉回登录页 + 明确说明原因。 */
  await ev(`(function(){
    var s=JSON.parse(localStorage.getItem('tideglass_admin')||'{}');
    s.token='expired-token-for-test'; localStorage.setItem('tideglass_admin',JSON.stringify(s));
  })()`);
  await ev(`(function(){var a=[].slice.call(document.querySelectorAll('.adm__nav a'))[0]; a&&a.click();})()`);
  await wait(1200);
  const exp = JSON.parse(await ev(`JSON.stringify({
    login: !!document.querySelector('.loginwrap'),
    note: (document.querySelector('.falert--note')||{}).innerText||''
  })`));
  const expOk = exp.login && exp.note.trim().length > 0;
  console.log('');
  console.log(`会话过期处理：${expOk ? 'OK' : '!!'} 掉回登录页=${exp.login}，提示=「${exp.note.trim().slice(0, 60)}」`);
  if (!expOk) fails.push({ href: '(session-expiry)', text: '会话过期', bad: ['未给出明确提示'], logs: [], nets: [] });

  console.log('');
  if (fails.length) {
    console.log('失败 ' + fails.length + ' 项明细：');
    fails.forEach(f => {
      console.log('— ' + f.href + '（' + f.text + '）：' + f.bad.join('；'));
      f.logs.forEach(x => console.log('    报错 ' + x));
      f.nets.forEach(x => console.log('    请求 ' + x));
    });
  } else console.log('全部通过：' + links.length + ' 个导航项点击后均正常渲染，0 报错。');

  sock.close(); proc.kill();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
