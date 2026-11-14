/* 商品编辑器端到端验证：真浏览器登录 → 新建 → 传图 → 保存 → 上架 → 前台核对
   用法: node tools/e2e-product.js [baseUrl]
   依赖：本机 Edge；无第三方包，CDP 用 Node 自带 WebSocket。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9444;
const BASE = process.argv[2] || 'http://127.0.0.1:4610';
const SHOTS = path.join(os.tmpdir(), 'tg-e2e-shots');
const PROF = path.join(os.tmpdir(), 'edge_e2e_prof');
const IMG = path.resolve(__dirname, '..', 'app', 'web', 'assets', 'img', 'opt',
  fs.readdirSync(path.resolve(__dirname, '..', 'app', 'web', 'assets', 'img', 'opt')).filter(f => /\.jpg$/.test(f))[0]);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : String(extra).slice(0, 260)); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server',
    '--proxy-bypass-list=*',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF,
    '--window-size=1440,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
      const t = list.filter(x => x.type === 'page')[0];
      if (t) wsUrl = t.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    if (!wsUrl) await wait(300);
  }
  if (!wsUrl) { console.error('无法连接 Edge'); process.exit(1); }

  const sock = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) {
      const p = pend.get(o.id); pend.delete(o.id);
      o.error ? p.rej(new Error(o.error.message)) : p.res(o.result);
    }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.result && r.result.description || ''));
    return r.result.value;
  };
  const shot = async (name) => {
    const m = await send('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    const h = Math.min(Math.ceil(cs.height), 3000);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1440, height: h, scale: 1 },
    });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };
  /* 抽屉是 fixed 全屏，整页截图会把抽屉之外的内容也拍进来；
     看抽屉内部的后两段得滚它的滚动容器，再只截视口。 */
  const shotView = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };

  try {
    /* 1. 登录（先清掉上次的会话，否则会直接进后台、没有登录表单） */
    await send('Page.navigate', { url: BASE + '/#/admin' });
    await wait(900);
    await evalJs(`try{localStorage.removeItem('tideglass_admin');location.reload();}catch(e){} true`);
    await wait(1500);
    let hasForm = false;
    for (let i = 0; i < 12; i++) {
      hasForm = await evalJs(`!!document.querySelector('form[data-act=login]')`);
      if (hasForm) break;
      await wait(400);
    }
    ok('登录页渲染出表单', hasForm);
    await evalJs(`
      (function(){
        var e=document.querySelector('input[name=email]'), p=document.querySelector('input[name=password]');
        e.value='owner@tideglassjewelry.com'; p.value='tideglass2026';
        document.querySelector('form[data-act=login]').requestSubmit();
        return true;
      })()
    `);
    await wait(1800);
    ok('登录进入后台', await evalJs(`!!document.querySelector('.adm__nav')`));

    /* 2. 打开 Products */
    await send('Page.navigate', { url: BASE + '/#/admin/products' });
    await wait(1400);
    const hasNewBtn = await evalJs(`!!document.querySelector('[data-act=pnew]')`);
    ok('Products 页有 New product 按钮', hasNewBtn);
    await shot('01-products');

    /* 3. 点 New product，抽屉应打开 */
    await evalJs(`document.querySelector('[data-act=pnew]').click()`);
    await wait(500);
    ok('抽屉已打开', await evalJs(`document.body.classList.contains('pedit-open')`));
    ok('抽屉显示 New product', await evalJs(`document.getElementById('pdrawerTitle').textContent`) === 'New product');
    await shot('02-drawer-empty');

    /* 4. 填基本信息 */
    await evalJs(`
      (function(){
        var set=function(id,v){var el=document.getElementById(id);el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));};
        set('pTitle','E2E Sea Glass Pendant');
        set('pCat','bracelets');
        set('pPrice','58');
        set('pCost','14');
        set('pDesc','Created by the automated product editor test.');
        set('pMotif','shell');
        set('pSet','ocean');
        set('pSizes','7in|8in');
        document.getElementById('pBadge').value='New';
        return true;
      })()
    `);

    /* 5. 加第二个变体并改值 */
    await evalJs(`document.querySelector('[data-act=pvaradd]').click()`);
    await wait(200);
    const vcount = await evalJs(`document.querySelectorAll('#pVars tr').length`);
    ok('可以加成第二个变体', vcount === 2, vcount);
    await evalJs(`
      (function(){
        var rows=document.querySelectorAll('#pVars tr');
        var m=rows[1].querySelector('select'); m.value='Silver'; m.dispatchEvent(new Event('change',{bubbles:true}));
        var st=rows[1].querySelectorAll('input')[2]; st.value='6'; st.dispatchEvent(new Event('change',{bubbles:true}));
        var r0=rows[0].querySelectorAll('input')[2]; r0.value='9'; r0.dispatchEvent(new Event('change',{bubbles:true}));
        return true;
      })()
    `);

    /* 6. 上传图片：走真实 input[type=file]，验证压缩+落盘 */
    const doc = await send('DOM.getDocument', { depth: -1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#pFile' });
    await send('DOM.setFileInputFiles', { files: [IMG], nodeId: node.nodeId });
    let uploaded = 0;
    for (let i = 0; i < 20; i++) {
      await wait(400);
      uploaded = await evalJs(`document.querySelectorAll('#pImgs .imgcell.on').length`);
      if (uploaded) break;
    }
    ok('图片上传后出现在栅格里', uploaded === 1, uploaded);
    const imgSrc = await evalJs(`(document.querySelector('#pImgs .imgcell.on img')||{}).getAttribute && document.querySelector('#pImgs .imgcell.on img').getAttribute('src')`);
    ok('图片路径指向 uploads/', /^uploads\/p-/.test(String(imgSrc)), imgSrc);
    await evalJs(`document.querySelector('[data-sec=images]').scrollIntoView({block:'start'}); true`);
    await wait(400);
    await shotView('03a-drawer-images');
    await evalJs(`document.querySelector('[data-sec=variants]').scrollIntoView({block:'start'}); true`);
    await wait(400);
    await shotView('03b-drawer-variants');
    await evalJs(`document.querySelector('.pdrawer__bd').scrollTop=0; true`);
    await shot('03-drawer-filled');

    /* 7. 保存 */
    await evalJs(`document.querySelector('[data-act=psave]').click()`);
    await wait(1600);
    ok('保存后抽屉关闭', !(await evalJs(`document.body.classList.contains('pedit-open')`)));
    const listed = await evalJs(`
      (function(){
        var rows=[].map.call(document.querySelectorAll('.atable tbody tr'),function(tr){return tr.innerText;});
        return rows.filter(function(t){return t.indexOf('E2E Sea Glass Pendant')>=0;}).length;
      })()
    `);
    ok('列表出现新商品', listed === 1, listed);
    ok('新商品是 Draft', await evalJs(`
      (function(){
        var tr=[].filter.call(document.querySelectorAll('.atable tbody tr'),function(t){return t.innerText.indexOf('E2E Sea Glass Pendant')>=0;})[0];
        return tr ? tr.innerText.indexOf('Draft')>=0 : false;
      })()
    `));
    ok('库存合计 9+6=15', await evalJs(`
      (function(){
        var tr=[].filter.call(document.querySelectorAll('.atable tbody tr'),function(t){return t.innerText.indexOf('E2E Sea Glass Pendant')>=0;})[0];
        return tr ? /\\b15\\b/.test(tr.innerText) : false;
      })()
    `));
    await shot('04-list-after-save');

    /* 8. 上架 */
    await evalJs(`
      (function(){
        var tr=[].filter.call(document.querySelectorAll('.atable tbody tr'),function(t){return t.innerText.indexOf('E2E Sea Glass Pendant')>=0;})[0];
        tr.querySelector('[data-act=toggle]').click();
        return true;
      })()
    `);
    await wait(1400);
    ok('上架后显示 Live', await evalJs(`
      (function(){
        var tr=[].filter.call(document.querySelectorAll('.atable tbody tr'),function(t){return t.innerText.indexOf('E2E Sea Glass Pendant')>=0;})[0];
        return tr ? tr.innerText.indexOf('Live')>=0 : false;
      })()
    `));

    /* 9. 前台核对：直接开商品详情页（集合页需要商品挂在对应集合里，本例没勾选集合） */
    const apiHit = await evalJs(`
      fetch('/api/v1/products/search?q=' + encodeURIComponent('Sea Glass Pendant'))
        .then(function(r){return r.json();})
        .then(function(j){return JSON.stringify(j.data||[]).indexOf('E2E Sea Glass Pendant')>=0;})
    `);
    ok('前台接口能返回该商品', apiHit === true, apiHit);
    const handle = await evalJs(`
      document.querySelectorAll('.atable tbody tr').length ? 'e2e-sea-glass-pendant' : 'e2e-sea-glass-pendant'
    `);
    await send('Page.navigate', { url: BASE + '/#/products/' + handle });
    await wait(2600);
    const front = await evalJs(`document.body.innerText.indexOf('E2E Sea Glass Pendant')>=0`);
    ok('前台商品详情页可打开', front, await evalJs(`document.body.innerText.replace(/\\s+/g,' ').slice(0,200)`));
    const buyable = await evalJs(`
      (function(){
        var t=document.body.innerText;
        return t.indexOf('Add to bag')>=0 || t.indexOf('ADD TO BAG')>=0 || t.indexOf('Sold out')>=0;
      })()
    `);
    ok('详情页有加购入口', buyable === true, buyable);
    await shot('05-storefront');

    /* 10. 编辑已存在商品：改标题不应改 URL */
    await send('Page.navigate', { url: BASE + '/#/admin/products' });
    await wait(1400);
    await evalJs(`
      (function(){
        var tr=[].filter.call(document.querySelectorAll('.atable tbody tr'),function(t){return t.innerText.indexOf('E2E Sea Glass Pendant')>=0;})[0];
        tr.querySelector('[data-act=pedit]').click();
        return true;
      })()
    `);
    await wait(1200);
    ok('编辑抽屉带出原标题', (await evalJs(`document.getElementById('pTitle').value`)) === 'E2E Sea Glass Pendant');
    ok('编辑抽屉带出 2 个变体', (await evalJs(`document.querySelectorAll('#pVars tr').length`)) === 2);
    ok('编辑抽屉带出 1 张图', (await evalJs(`document.querySelectorAll('#pImgs .imgcell.on').length`)) === 1);
    const handleBefore = await evalJs(`document.getElementById('pHandle').value`);
    await evalJs(`
      (function(){
        var t=document.getElementById('pTitle'); t.value='E2E Renamed Pendant';
        document.querySelector('[data-act=psave]').click(); return true;
      })()
    `);
    await wait(1600);
    ok('改标题后仍在列表', await evalJs(`document.body.innerText.indexOf('E2E Renamed Pendant')>=0`));
    ok('URL handle 未变', (await evalJs(`
      (function(){
        var tr=[].filter.call(document.querySelectorAll('.atable tbody tr'),function(t){return t.innerText.indexOf('E2E Renamed Pendant')>=0;})[0];
        return tr ? tr.innerText : '';
      })()
    `)).indexOf(handleBefore) >= 0, handleBefore);

    /* 11. CSV 导入弹窗 */
    await evalJs(`document.querySelector('[data-act=pimport]').click()`);
    await wait(400);
    ok('导入弹窗打开', await evalJs(`document.body.classList.contains('pimp-open')`));
    await shot('06-import-modal');
    await evalJs(`document.querySelector('[data-act=pimpclose]').click()`);

    /* 12. 清理：删掉测试商品 */
    const del = await evalJs(`
      (function(){
        var tr=[].filter.call(document.querySelectorAll('.atable tbody tr'),function(t){return t.innerText.indexOf('E2E Renamed Pendant')>=0;})[0];
        tr.querySelector('[data-act=pedit]').click();
        return true;
      })()
    `);
    await wait(1200);
    await evalJs(`window.confirm=function(){return true}; document.querySelector('[data-act=pdel]').click()`);
    await wait(1500);
    ok('删除后列表里消失', !(await evalJs(`document.body.innerText.indexOf('E2E Renamed Pendant')>=0`)));

    /* 13. 移动端抽屉 */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
    await send('Page.navigate', { url: BASE + '/#/admin/products' });
    await wait(1500);
    await evalJs(`document.querySelector('[data-act=pnew]').click()`);
    await wait(500);
    const dw = await evalJs(`document.querySelector('.pdrawer__panel').getBoundingClientRect().width`);
    ok('移动端抽屉占满宽度', Math.round(dw) >= 388, dw);
    await shotView('07-mobile-drawer');
    await evalJs(`document.querySelector('[data-act=pclose]').click()`);

  } catch (e) {
    fail++;
    console.log('  ✗ 脚本异常：', e.message);
  }

  console.log('\n截图目录：' + SHOTS);
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  try { child.kill(); } catch (e) { }
  process.exit(fail ? 1 : 0);
})();
