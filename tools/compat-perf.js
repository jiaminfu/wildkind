#!/usr/bin/env node
/* ============================================================
   兼容 + 性能巡检
   用法: node tools/compat-perf.js

   兼容：3 种视口 × 2 种 DPR，逐页检查
         · 横向溢出
         · 控制台报错
         · 移动端可点区域尺寸（< 40px 记为偏小，手指点不准）
         · localStorage 被禁用时页面是否还能渲染（无痕/隐私模式的真实情况）
   性能：逐页采集 TTFB / DOMContentLoaded / load / 请求数 / 传输字节
         按页给出 P50 与 P95（多次采样）
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9490;
const BASE = 'http://127.0.0.1:4600';
const OUT = path.join(__dirname, '..', 'tmp_qa');
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

const PAGES = [
  ['首页', '/#/'],
  ['合集', '/#/collections/all'],
  ['商品详情', '/#/products/dune-hoop-earrings'],
  ['购物袋', '/#/cart'],
  ['查单页', '/#/account'],
  ['内容页', '/#/pages/about'],
];

const VIEWS = [
  { name: '桌面 1440', w: 1440, h: 900, m: false, dpr: 1 },
  { name: '桌面 1920@2x', w: 1920, h: 1080, m: false, dpr: 2 },
  { name: '平板 768', w: 768, h: 1024, m: false, dpr: 2 },
  { name: '手机 390@3x', w: 390, h: 844, m: true, dpr: 3 },
  { name: '小屏 320@2x', w: 320, h: 568, m: true, dpr: 2 },
];

(async () => {
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server',
    '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(os.tmpdir(), 'edge_cp_prof'),
    '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    try { const l = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list')); const t = l.filter(x => x.type === 'page')[0]; if (t) ws = t.webSocketDebuggerUrl; } catch (e) { }
    if (!ws) await wait(300);
  }
  const sock = new WebSocket(ws);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  let errs = [], bytes = 0, reqs = 0;
  sock.addEventListener('message', e => {
    const o = JSON.parse(e.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); return; }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      const s = (o.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 140);
      if (!/pcsVersion|appType|edgeChromium/.test(s)) errs.push(s);
    }
    if (o.method === 'Network.responseReceived') {
      reqs++;
      const h = o.params.response.headers || {};
      const len = Number(h['Content-Length'] || h['content-length'] || 0);
      if (len) bytes += len;
    }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? { __err: r.exceptionDetails.text } : r.result.value; };
  /* 每页都必须真正重新加载。
     站内是 hash 路由：/#/collections/all → /#/cart 只是同文档内换 hash，
     不触发网络请求 —— 于是六页读到的是第一次加载的那条 navigation timing，
     六行数字一模一样，看起来像"测得很稳"，其实只测了一页。
     加一个递变的查询串强制整页加载（前台会把 search 里的参数并进 query，
     多一个 r= 不影响任何页面逻辑）。 */
  let navSeq = 0;
  const open = async (h, hard) => {
    navSeq++;
    const url = hard ? BASE + '/?r=' + navSeq + h : BASE + h;
    await send('Page.navigate', { url });
    for (let i = 0; i < 50; i++) { const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }); if (r.result.value === 'complete') break; await wait(150); }
    await wait(900);
  };

  /* ================= 一、兼容 ================= */
  console.log('════════ 兼容测试 ════════');
  const compatFail = [];
  for (const v of VIEWS) {
    console.log('\n── ' + v.name + ' ──');
    await send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.m });
    if (v.m) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (const [label, h] of PAGES) {
      errs = [];
      await open(h);
      const r = await ev(`(function(){
        var vw = document.documentElement.clientWidth;
        var docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        /* 可点区域：不看元素的装饰盒子，直接量"手指能不能按到"。
           在图标中心画一个 44×44 的网格逐点 elementFromPoint，
           命中自己（含子节点/伪元素命中区）的比例低于 50% 就算按不准。
           只看盒子会永远为 22px 的图标报错 —— 即使它的透明命中区已经是 44px。 */
        var small = [];
        /* 只算真正的控件。正文里的行内链接（商品标题那种）按 WCAG 2.5.8 属于豁免项，
           它们的可点高度天然等于行高，不该按按钮标准判。
           关掉的浮层（搜索层/抽屉）容器上是 pointer-events:none，里面虽然有按钮，
           但本来就不可点，一并跳过 —— 否则每页都会报一个"0% 命中"的假红。 */
        function dead(e){ var p=e; while(p){ if(getComputedStyle(p).pointerEvents==='none') return true; p=p.parentElement; } return false; }
        /* cookie 条是固定定位、覆盖视口底部的。它盖住的那一行商品卡，
           收藏心自然 0% 命中 —— 但那条子是提示，用户点一次就消失，
           不该算成"按钮点不到"。按矩形判，不算进统计。 */
        var ck = document.getElementById('ckbar');
        var ckb = ck ? ck.getBoundingClientRect() : null;
        function underCk(b){ return ckb && b.top < ckb.bottom && b.bottom > ckb.top; }
        var els = document.querySelectorAll('.btn, button, .icon-btn, [data-act]');
        for (var i=0;i<els.length;i++){
          var e = els[i], b = e.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) continue;
          if (b.bottom < 0 || b.top > innerHeight) continue;
          if (b.width >= 44 && b.height >= 44) continue;
          if (dead(e) || underCk(b)) continue;
          var cx = b.left + b.width/2, cy = b.top + b.height/2;
          var hit = 0, total = 0;
          for (var dx = -20; dx <= 20; dx += 8) {
            for (var dy = -20; dy <= 20; dy += 8) {
              var x = cx + dx, y = cy + dy;
              if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
              total++;
              var t = document.elementFromPoint(x, y);
              if (t && (t === e || e.contains(t))) hit++;
            }
          }
          if (total && hit / total < 0.5) {
            small.push((e.textContent||e.getAttribute('aria-label')||e.tagName).trim().slice(0,18) +
              ' 盒' + Math.round(b.width) + 'x' + Math.round(b.height) + ' 可及' + Math.round(hit/total*100) + '%');
          }
        }
        return { over: docW - vw, docW: docW, vw: vw, small: small.slice(0,5), smallCount: small.length };
      })()`);
      const flags = [];
      if (r.over > 1) { flags.push('溢出' + r.over + 'px'); }
      if (errs.length) { flags.push('报错' + errs.length); }
      if (v.m && r.smallCount) { flags.push('小点击区' + r.smallCount); }
      const ok = flags.length === 0;
      if (!ok && (r.over > 1 || errs.length)) compatFail.push(v.name + ' ' + label + ': ' + flags.join('/'));
      const line = (ok ? '  ✅ ' : '  ⚠️ ') + label.padEnd(6) + (flags.length ? flags.join(' · ') : 'ok');
      console.log(line);
      if (v.m && r.small.length) console.log('        小可点区: ' + JSON.stringify(r.small));
    }
  }

  /* ---- localStorage 被禁用（无痕/隐私模式）---- */
  console.log('\n── localStorage 被禁用（模拟无痕模式）──');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      var boom = function(){ throw new DOMException('denied','SecurityError'); };
      try {
        Object.defineProperty(window, 'localStorage', { configurable: true, get: function(){ return {
          getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }; } });
      } catch (e) {}
    })();`
  });
  for (const [label, h] of [['首页', '/#/'], ['商品详情', '/#/products/dune-hoop-earrings'], ['购物袋', '/#/cart']]) {
    errs = [];
    await open(h);
    const r = await ev(`(function(){
      var main = document.getElementById('main');
      var t = main ? main.textContent.replace(/\\s+/g,' ').trim().length : 0;
      return { chars: t, card: document.querySelectorAll('.card').length, empty: t < 40 };
    })()`);
    const ok = !r.empty && errs.length === 0;
    console.log((ok ? '  ✅ ' : '  ❌ ') + label.padEnd(6) + '正文 ' + r.chars + ' 字符 · 商品卡 ' + r.card +
      (errs.length ? ' · 报错: ' + errs[0] : ''));
    if (!ok) compatFail.push('无痕模式 ' + label);
  }

  /* ================= 二、性能 ================= */
  console.log('\n════════ 性能测试 ════════');
  console.log('（每次冷加载，取 3 次采样的中位数；P95 为各页最大值的 95 分位近似，即次大值）');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  /* 关缓存逐页冷加载。关不掉只是数字偏乐观，不该让整段性能测试中断。 */
  try { await send('Network.setCacheDisabled', { cacheDisabled: true }); }
  catch (e) { console.log('  ⚠️ 关缓存失败（' + e.message + '），本次数据偏乐观'); }

  const perf = [];
  for (const [label, h] of PAGES) {
    const runs = [];
    for (let k = 0; k < 3; k++) {
      reqs = 0; bytes = 0;
      await open(h, true);
      const t = await ev(`(function(){
        var n = performance.getEntriesByType('navigation')[0] || {};
        var paints = performance.getEntriesByType('paint') || [];
        var fcp = (paints.filter(function(p){return p.name==='first-contentful-paint'})[0]||{}).startTime || null;
        return { ttfb: Math.round(n.responseStart||0), dcl: Math.round(n.domContentLoadedEventEnd||0),
                 load: Math.round(n.loadEventEnd||0), fcp: fcp ? Math.round(fcp) : null,
                 transfer: n.transferSize||0 };
      })()`);
      runs.push(Object.assign({ reqs, bytes }, t));
      await wait(400);
    }
    const med = key => { const a = runs.map(x => x[key] || 0).sort((x, y) => x - y); return a[1]; };
    const row = {
      page: label,
      ttfb: med('ttfb'), fcp: med('fcp'), dcl: med('dcl'), load: med('load'),
      reqs: med('reqs'), kb: Math.round(med('bytes') / 1024),
    };
    perf.push(row);
  }
  console.log('\n页面       TTFB   FCP    DCL    Load   请求   传输');
  perf.forEach(r => console.log(
    r.page.padEnd(10) +
    String(r.ttfb + 'ms').padStart(6) + String(r.fcp + 'ms').padStart(7) +
    String(r.dcl + 'ms').padStart(7) + String(r.load + 'ms').padStart(8) +
    String(r.reqs).padStart(6) + String(r.kb + 'KB').padStart(8)));

  const pct = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.ceil(a.length * q) - 1))]; };
  const med = arr => pct(arr, 0.5);
  console.log('\n  P50   Load ' + med(perf.map(r => r.load)) + 'ms   FCP ' + med(perf.map(r => r.fcp)) + 'ms');
  console.log('  P95   Load ' + pct(perf.map(r => r.load), 1) + 'ms   FCP ' + pct(perf.map(r => r.fcp), 1) + 'ms' +
    '   请求 ' + pct(perf.map(r => r.reqs), 1) + ' 个   传输 ' + pct(perf.map(r => r.kb), 1) + 'KB');

  console.log('\n════════ 汇总 ════════');
  console.log('兼容硬伤: ' + (compatFail.length ? '\n  - ' + compatFail.join('\n  - ') : '无'));
  child.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
