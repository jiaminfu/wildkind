/* 元素级截图：按选择器把某个元素单独截出来，用来确认它到底长什么样。
   用法：node tools/shot-el.js <url> <selector|js:表达式> <输出路径> [宽] [高]
   第三参数以 js: 开头时，先执行该表达式（用来把页面点成某个状态），等 600ms 再截图。 */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

const URL = process.argv[2];
const SEL = process.argv[3];
const OUT = process.argv[4] || path.join(os.tmpdir(), 'el.png');
const PRE = process.env.PRE || '';
const VW = Number(process.argv[5] || 1440);
const VH = Number(process.argv[6] || 2000);

(async () => {
  const PROF = path.join(os.tmpdir(), 'edge_el_prof');
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, '--window-size=' + VW + ',' + VH, 'about:blank'], { stdio: 'ignore' });
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

  await send('Page.navigate', { url: URL });
  // 轮询等元素出现，比固定 sleep 稳
  const waitSel = SEL.indexOf('js:') === 0 ? '.co, .pdp, .acct2, .hdr' : SEL;
  for (let i = 0; i < 30; i++) {
    if (await ev(`!!document.querySelector(${JSON.stringify(waitSel)})`) === true) break;
    await wait(300);
  }
  // 可选：先把页面操作到某个状态（点击、填表），再截图
  if (PRE && PRE.indexOf('js:') === 0) {
    const r = await ev(PRE.slice(3));
    if (typeof r === 'string' && r.indexOf('ERR') === 0) console.log('前置脚本报错: ' + r);
    await wait(700);
  }

  // 先滚到元素，等过渡动画结束再量尺寸 —— 否则抽屉这类滑动元素会量到屏幕外
  await ev(`(function(){var e=document.querySelector(${JSON.stringify(SEL)});if(e)e.scrollIntoView({block:'center'});return 1;})()`);
  await wait(600);
  const realSel = SEL.indexOf('js:') === 0 ? process.env.TARGET : SEL;
  const box = await ev(`(function(){var e=document.querySelector(${JSON.stringify(realSel)});if(!e)return null;
    var r=e.getBoundingClientRect();
    return {x:r.x+window.scrollX, y:r.y+window.scrollY, w:r.width, h:r.height, vw:window.innerWidth};})()`);
  if (!box) { console.log('元素不存在: ' + SEL); sock.close(); proc.kill(); process.exit(1); }
  console.log('元素盒: x=' + Math.round(box.x) + ' y=' + Math.round(box.y) + ' w=' + Math.round(box.w) + ' h=' + Math.round(box.h) + ' 视口宽=' + box.vw);
  await wait(300);
  const pad = 12;
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2, scale: Number(process.env.SCALE || 3)
    }
  });
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
  console.log('已保存 ' + OUT);
  sock.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
