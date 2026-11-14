/* 图片优化（第二轮，D-111/D-112）
   把 1.2–3.3MB 的原始 PNG 直接编码成两档宽度的 WebP。
   做法：起一个 headless Edge，用页面里的 canvas 解码 PNG 再 toDataURL('image/webp')。
   这样不需要 cwebp / sharp / Pillow 任何外部依赖。

   输出：app/web/assets/img/opt/<base>-<w>.webp
   用法: node tools/opt-img2.js
*/
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9377;
const SRC = path.join(__dirname, '..', 'app', 'web', 'assets', 'img');
const OUT = path.join(SRC, 'opt');
const QUALITY = 0.82;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

/* 每类图给两档宽度：小档喂手机 / 卡片，大档喂桌面与详情页大图。
   宽度不超过源图，避免放大导致糊。 */
function widthsFor(file) {
  if (/^hero-/.test(file)) return [700, 1100];
  if (/^c-/.test(file)) return [400, 820];
  return [440, 900];
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PROF = path.join(os.tmpdir(), 'edge_opt2_prof');
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-proxy-server',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 60; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { list = v; break; } } catch (e) { }
    await wait(250);
  }
  if (!list) { console.error('CDP 连接失败'); proc.kill(); process.exit(1); }

  const page = list.filter((x) => x.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  sock.addEventListener('message', (ev) => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) {
      const p = pend.get(o.id); pend.delete(o.id);
      o.error ? p.rej(new Error(o.error.message)) : p.res(o.result);
    }
  });
  await new Promise((r) => sock.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  /* 需要一个真实页面上下文才能用 canvas，用 about:blank 也行，但某些版本不给 Image，
     所以 navigator 到本地 app 的空路由更稳。app 没起时退回 data: 页面。 */
  await send('Page.navigate', { url: 'data:text/html,<html><body></body></html>' });
  await wait(600);

  const files = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  let before = 0, after = 0;
  const rows = [];

  for (const f of files) {
    const src = path.join(SRC, f);
    const buf = fs.readFileSync(src);
    before += buf.length;
    const base = f.replace(/\.png$/i, '');
    const widths = widthsFor(f);

    /* 一次 evaluate 里出全部宽度，避免反复把 MB 级 base64 穿过 CDP */
    const expr = `(async function(){
      var img = new Image();
      img.src = 'data:image/png;base64,${buf.toString('base64')}';
      await img.decode();
      var out = {};
      var widths = ${JSON.stringify(widths)};
      for (var i = 0; i < widths.length; i++) {
        var w = Math.min(widths[i], img.width);
        var h = Math.round(img.height * w / img.width);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        var d = cv.toDataURL('image/webp', ${QUALITY});
        if (d.indexOf('data:image/webp') !== 0) return { err: 'webp encoder unavailable' };
        out[w] = { data: d.split(',')[1], w: w, h: h };
      }
      return { ok: out, srcW: img.width, srcH: img.height };
    })()`;

    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) { console.error(f, 'ERR', JSON.stringify(r.exceptionDetails).slice(0, 300)); continue; }
    const v = r.result.value;
    if (!v || v.err) { console.error(f, 'ERR', v && v.err); continue; }

    const made = [];
    for (const k of Object.keys(v.ok)) {
      const it = v.ok[k];
      const dest = path.join(OUT, base + '-' + it.w + '.webp');
      fs.writeFileSync(dest, Buffer.from(it.data, 'base64'));
      const sz = fs.statSync(dest).size;
      after += sz;
      made.push(it.w + 'w=' + Math.round(sz / 1024) + 'KB');
    }
    rows.push({ f, src: Math.round(buf.length / 1024) + 'KB', srcDim: v.srcW + 'x' + v.srcH, made: made.join('  ') });
    console.log(f.padEnd(30), (Math.round(buf.length / 1024) + 'KB').padStart(7), ' -> ', made.join('  '));
  }

  console.log('\n合计 ' + (before / 1024 / 1024).toFixed(1) + 'MB PNG  ->  ' +
    (after / 1024 / 1024).toFixed(2) + 'MB WebP(双档)   降幅 ' +
    Math.round((1 - after / before) * 100) + '%');
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), quality: QUALITY, items: rows,
  }, null, 2));

  sock.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
