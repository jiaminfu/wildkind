/* 视口状态截图：先把页面操作成某个状态，再整屏截一张。
   和 shot-el.js 的区别是不按元素裁切，适合看悬停展开的面板这类溢出元素。
   用法：node tools/shot-state.js <url> <输出路径> [宽] [高]
   状态脚本放在环境变量 PRE 里，形如 PRE='js:...' ；可再给 SEL 做出现等待。 */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 端口与 profile 每次独立：两个截图进程并行时会争用同一端口 + 同一 profile 目录，第二个必然连不上
const PORT = Number(process.env.PORT_DBG || (9342 + Math.floor(Math.random() * 200)));
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

const URL = process.argv[2];
const OUT = process.argv[3] || path.join(os.tmpdir(), 'state.png');
const VW = Number(process.argv[4] || 1440);
const VH = Number(process.argv[5] || 900);
const PRE = process.env.PRE || '';
const SEL = process.env.SEL || '.hdr';
const SCALE = Number(process.env.SCALE || 2);

(async () => {
  const PROF = path.join(os.tmpdir(), 'edge_state_prof_' + PORT);
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

  // DEV=1 用设备模拟：headless 窗口有最小宽度（约 470px），不模拟的话窄屏截图会被裁切。
  // 必须在导航之后下发，导航前的设置会被新文档丢掉。
  const DEV = process.env.DEV === '1';
  await send('Page.navigate', { url: URL });
  if (DEV) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: VW, height: VH, deviceScaleFactor: 1, mobile: VW < 700
    });
    await wait(300);
    await send('Page.reload', { ignoreCache: false });
  }
  for (let i = 0; i < 30; i++) {
    if (await ev(`!!document.querySelector(${JSON.stringify(SEL)})`) === true) break;
    await wait(300);
  }
  await wait(500);
  if (PRE) {
    const r = await ev(PRE.indexOf('js:') === 0 ? PRE.slice(3) : PRE);
    if (typeof r === 'string' && r.indexOf('ERR') === 0) console.log('前置脚本报错: ' + r);
    else if (r !== undefined && r !== null) console.log('前置结果: ' + r);
    await wait(800);
  }
  // clip 用的是页面坐标，不是视口坐标：页面滚动过之后必须把 scrollX/Y 加回去，否则截到空白
  const sc = await ev('JSON.stringify({x:Math.round(scrollX),y:Math.round(scrollY)})');
  const off = JSON.parse(sc);
  // 异步 SPA 的首次合成帧可能还是骨架屏：先强制一次布局并丢弃首帧，再截第二帧
  await ev('document.body.offsetHeight');
  await wait(350);
  await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: off.x, y: off.y, width: VW, height: VH, scale: SCALE }
  });
  await wait(250);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: off.x, y: off.y, width: VW, height: VH, scale: SCALE }
  });
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
  console.log('已保存 ' + OUT);
  sock.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
