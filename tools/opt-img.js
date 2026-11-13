/* 图片优化：把 1.5MB 的 PNG 重新编码为 JPEG，尺寸不变，视觉无损。
   用 Edge 自带的解码器 + canvas，不引入任何第三方依赖。
   用法: node tools/opt-img.js */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9361;
const SRC = path.join(__dirname, '..', 'prototype', 'assets', 'img');
const OUT = path.join(SRC, 'opt');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

const QUALITY = 0.82;
const MAXW = 1200;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PROF = path.join(os.tmpdir(), 'edge_opt_prof');
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { t = v; break; } } catch (e) { }
    await wait(250);
  }
  if (!t) { console.error('CDP 连接失败'); proc.kill(); process.exit(1); }
  const page = t.filter((x) => x.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  sock.addEventListener('message', (ev) => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
  });
  await new Promise((r) => sock.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:4500/' });
  await wait(900);

  const conv = async (b64, maxW, q) => {
    const expr = `(async function(){
      var img = new Image();
      img.src = 'data:image/png;base64,${b64}';
      await img.decode();
      var w = img.width, h = img.height;
      if (w > ${maxW}) { h = Math.round(h * ${maxW} / w); w = ${maxW}; }
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#F2EBDF'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', ${q}).split(',')[1];
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const files = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.png'));
  let before = 0, after = 0;
  for (const f of files) {
    const p = path.join(SRC, f);
    const b = fs.readFileSync(p);
    before += b.length;
    const maxW = /^hero-/.test(f) ? 1400 : MAXW;
    const out = await conv(b.toString('base64'), maxW, QUALITY);
    const jpg = path.join(OUT, f.replace(/\.png$/i, '.jpg'));
    fs.writeFileSync(jpg, Buffer.from(out, 'base64'));
    after += fs.statSync(jpg).size;
    console.log(f.padEnd(30), Math.round(b.length / 1024) + 'KB ->', Math.round(fs.statSync(jpg).size / 1024) + 'KB');
  }
  console.log('\n合计 ' + Math.round(before / 1024 / 1024 * 10) / 10 + 'MB -> ' +
    Math.round(after / 1024 / 1024 * 10) / 10 + 'MB  降幅 ' + Math.round((1 - after / before) * 100) + '%');
  sock.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
