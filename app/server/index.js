/* ============================================================
   TIDEGLASS API · 入口
   零第三方依赖：只用 node: 内置模块。
   启动：node app/server/index.js  （默认 4600）
   同时托管 app/web 静态前端，便于本地联调；
   生产环境建议 API 与静态站分域部署（CORS 已允许，见 lib/http.js）。
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const store = require('./lib/store');
const uploads = require('./lib/uploads');
const { send, fail, readBody, E, CORS, ApiError, resetRateLimits } = require('./lib/http');

const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = process.env.API_PORT || process.env.PORT || 4600;

/* 对外可访问的站点根地址。用于 sitemap 里的绝对 URL 与 og:url。
   容器的 8080 是明文端口，接上域名后设 PUBLIC_URL=https://tideglassjewelry.com 即可。 */
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

/* ---------------- 路由表 ---------------- */
const routes = [];

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[A-Za-z_]+/g, m => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }).replace(/\//g, '\\/') + '$');
  return { re, keys };
}

function add(method, pattern, handler, opts) {
  routes.push({ method, pattern, handler, ...compile(pattern), opts: opts || {} });
}

const router = {
  get: (p, h, o) => add('GET', p, h, o),
  post: (p, h, o) => add('POST', p, h, o),
  patch: (p, h, o) => add('PATCH', p, h, o),
  delete: (p, h, o) => add('DELETE', p, h, o),
};

require('./routes/catalog').routes(router);
require('./routes/checkout').routes(router);
require('./routes/payments').routes(router);
require('./routes/admin').routes(router);

/* ---------------- 测试复位端点（默认关闭） ----------------
   自动化测试会真的下单、退款、改价，跑第二遍时数据已被改过，
   断言必然失败——测试就成了「只能跑一次」的，没有回归价值。
   这里提供一个把数据恢复到基线快照的入口，只在 ALLOW_TEST_RESET=1 时注册，
   生产环境不设该变量，这个路由根本不存在（不是靠权限挡，而是压根没注册）。 */
if (process.env.ALLOW_TEST_RESET === '1') {
  router.post('/api/v1/__test/reset', (req, res) => {
    const baseline = path.join(store.DATA_DIR, 'db.seed.json');
    if (!fs.existsSync(baseline)) {
      throw new ApiError(500, 'NO_BASELINE', '缺少基线快照 db.seed.json，请先运行 node app/server/seed.js');
    }

    /* 会话必须跨复位保留。
       基线快照里没有 sessions，直接覆盖会让所有已登录的浏览器令牌当场失效——
       用户那边看到的现象是「点一下菜单就退出登录」，而测试脚本因为每次都重新登录，
       反而测不出这个坑。复位只该还原业务数据，不该动"谁还登录着"。 */
    const liveSessions = (store.get().sessions || []).slice();

    fs.copyFileSync(baseline, store.FILE);
    const db = store.reload();
    db.sessions = liveSessions;
    store.flush();

    resetRateLimits();   // 否则第二遍会被自己的限流挡住，测出的是噪音不是缺陷
    send(res, 200, {
      data: {
        reset: true,
        products: db.products.length,
        orders: db.orders.length,
        coupons: db.coupons.length,
        sessionsKept: liveSessions.length,
        nextOrderNumber: '#' + (db.sequences && db.sequences.order ? 'TG' + db.sequences.order : '?'),
      },
    });
  });

  /* 只清限流桶、不动数据。
     __test/reset 会把库打回基线，适合 api-test 那种"整库重来"的套件；
     但 accept-zero 是自建自清（自己造数据、跑完删干净），不能重置库，
     它只需要把上一轮遗留的计数器抹掉，否则连跑第二遍会撞上登录 10 次/5 分钟、
     下单 20 单/分钟这些阈值，测出来的是自己的噪音而不是业务缺陷。 */
  router.post('/api/v1/__test/rate-limits', (req, res) => {
    resetRateLimits();
    send(res, 200, { data: { cleared: true } });
  });
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/* 只有文本类才值得压。图片、字体已经是压缩格式，再 gzip 一遍反而更大。 */
function isCompressible(type) {
  return /^(text\/|application\/(javascript|json|xml))/.test(type) || /image\/svg/.test(type);
}

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
}

/* gzip 结果按「文件 + mtime + 大小」缓存。
   49 KB 的 app.js 压一次约 1 ms，但按 350 kbps 的链路算，压完能省 1.5 秒下载。
   缓存是必要的：不加缓存的话每个请求都压一遍，CPU 白烧。 */
const gzCache = new Map();
function gzipFor(file, buf, mtimeMs) {
  const key = file + '|' + mtimeMs + '|' + buf.length;
  const hit = gzCache.get(key);
  if (hit) return hit;
  const gz = zlib.gzipSync(buf, { level: 6 });
  /* 只保留最近 200 条，避免长跑之后 Map 无限增长 */
  if (gzCache.size > 200) gzCache.clear();
  gzCache.set(key, gz);
  return gz;
}

/* 统一发文件：压缩、ETag、缓存头、条件请求（304）都在这里，
   免得 serveStatic 和 serveUpload 各写一套。 */
function writeFile(req, res, file, st, opts) {
  const o = opts || {};
  const ext = path.extname(file).toLowerCase();
  const type = o.type || MIME[ext] || 'application/octet-stream';
  const etag = 'W/"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';

  const headers = Object.assign({
    'Content-Type': type,
    'ETag': etag,
    'Cache-Control': o.cache || 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  }, o.headers || {});

  /* 条件请求：回访时浏览器发 If-None-Match，命中就回 304，一个字节都不传。
     在不支持压缩的链路上，这是仅次于"不发请求"的最优解。 */
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }

  const gz = isCompressible(type) && st.size > 1024 && acceptsGzip(req);
  if (!gz) {
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }

  /* 有缓存就直接吐缓存的字节；没缓存才读盘 + 压。 */
  const key = file + '|' + st.mtimeMs + '|' + st.size;
  let body = gzCache.get(key);
  if (!body) {
    let raw;
    try { raw = fs.readFileSync(file); }
    catch (e) { return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } }); }
    body = gzipFor(file, raw, st.mtimeMs);
  }
  headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  headers['Vary'] = 'Accept-Encoding';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}

/* index.html 里的 assets 引用要带版本号。
   不带的话，只要缓存头设长了，改版后老用户永远拿不到新 JS；
   设短了又等于每次回访都重新下载 230 KB。
   服务端在返回 HTML 时把 assets/xxx?v=<mtime> 补上，
   JS/CSS 就能放心用一年的 immutable 缓存。 */
let htmlCache = { mtime: 0, html: '', gz: null };
function renderIndex(req, res) {
  const file = path.join(WEB_DIR, 'index.html');
  const st = fs.statSync(file);
  if (htmlCache.mtime !== st.mtimeMs) {
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(/(src|href)="assets\/([^"]+)"/g, (m, attr, rel) => {
      try {
        const f = path.join(WEB_DIR, 'assets', rel.split('?')[0]);
        const ms = fs.statSync(f).mtimeMs;
        return attr + '="assets/' + rel + (rel.indexOf('?') >= 0 ? '&' : '?') + 'v=' + Math.floor(ms).toString(36) + '"';
      } catch (e) { return m; }
    });
    htmlCache = { mtime: st.mtimeMs, html, gz: zlib.gzipSync(html, { level: 6 }) };
  }
  const body = acceptsGzip(req) ? htmlCache.gz : Buffer.from(htmlCache.html);
  const headers = {
    'Content-Type': MIME['.html'],
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    /* 现阶段的 CSP：只允许本站脚本与样式，外加 Google Fonts。
       注入的 <img onerror> 这类内联事件处理器仍能跑（unsafe-inline），
       但外部脚本、外链表单、iframe 全部被挡——把 XSS 的"外传"这条路先堵住。
       等前端拆掉内联事件后可以收紧到 nonce。

       img-src 必须包含 blob: —— 后台上传前会用 URL.createObjectURL 预览裁切，
       少了这一条，选完图就报 "That file is not a readable image."（实测踩过）。 */
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: blob: https:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
    ].join('; '),
  };
  if (acceptsGzip(req)) { headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding'; }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* SPA 是 hash 路由：服务端只认 /（以及 /index.html）。
   其他路径以前也回 index.html 且状态码 200，等于告诉 Google
   「这站有无限多个页面」，软 404 会被大量收录。
   现在未知路径仍返回 index.html 的内容（用户能看到 404 页而不是白屏），
   但状态码是 404——爬虫据此不收录。 */
function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); }
  catch (e) { return send(res, 400, { error: { code: 'BAD_REQUEST', message: 'Bad path.' } }); }

  if (rel === '/' || rel === '' || rel === '/index.html') return renderIndex(req, res);

  // 目录穿越防护：解析后必须仍在 WEB_DIR 内
  const target = path.normalize(path.join(WEB_DIR, rel));
  if (!target.startsWith(WEB_DIR)) {
    return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Invalid path.' } });
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      // 未知路径：内容给 index.html（前端会渲染「Page not found」），状态码给 404
      const fallback = path.join(WEB_DIR, 'index.html');
      return fs.readFile(fallback, (e2, buf) => {
        if (e2) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
        const body = acceptsGzip(req) ? zlib.gzipSync(buf, { level: 6 }) : buf;
        const h = {
          'Content-Type': MIME['.html'],
          'Content-Length': body.length,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        };
        if (acceptsGzip(req)) { h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding'; }
        res.writeHead(404, h);
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    }
    const ext = path.extname(target).toLowerCase();
    /* assets 下的文件由 renderIndex 打了 ?v=<mtime>，
       文件变了 URL 就变，所以可以放心让浏览器缓存一年。 */
    const versioned = /[?&]v=/.test(req.url);
    const cache = versioned
      ? 'public, max-age=31536000, immutable'
      : /\.(css|js)$/.test(ext)
        ? 'public, max-age=600, must-revalidate'   // 直接访问（没带版本号）时退一步
        : /\.(png|jpg|jpeg|webp|woff2|ico|svg)$/.test(ext)
          ? 'public, max-age=604800'
          : 'no-cache';
    writeFile(req, res, target, st, { cache });
  });
}

/* 上传的商品图存数据卷，单独一条静态路由。
   不能交给 serveStatic——那玩意儿未命中会回 index.html（SPA 兜底），
   图片 404 时浏览器会收到一段 HTML，前台显示成"裂图 + 控制台奇怪的 MIME 错误"。 */
function serveUpload(req, res, pathname) {
  const name = decodeURIComponent(pathname.replace(/^\/uploads\//, ''));
  const file = uploads.resolve(name);
  if (!file) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Image not found.' } });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Image not found.' } });
    }
    const ext = path.extname(file).slice(1).toLowerCase();
    writeFile(req, res, file, st, {
      type: uploads.EXT_MIME[ext] || 'application/octet-stream',
      cache: 'public, max-age=604800',
      headers: { ...CORS, 'Access-Control-Allow-Origin': '*' },
    });
  });
}

/* ---------------- SEO 文件 ----------------
   robots.txt 和 sitemap.xml 以前根本不存在：两个路径都被 SPA 兜底成 HTML 并返回 200，
   爬虫拿到的是 <!DOCTYPE html>，既不认 robots 规则，也没有任何 URL 可抓。
   这里按请求的 Host 动态生成，换域名不用改代码。 */
function siteOrigin(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  return proto + '://' + host;
}

function serveRobots(req, res) {
  const origin = siteOrigin(req);
  const txt = [
    'User-agent: *',
    'Allow: /',
    /* 后台与接口不该被收录；/uploads/ 是商品图，要放行。
       注意不能写 /#/admin —— robots.txt 里 # 之后算注释，
       整行会退化成 "Disallow: /" 把全站屏蔽掉。 */
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /checkout',
    'Disallow: /account',
    '',
    'Sitemap: ' + origin + '/sitemap.xml',
    '',
  ].join('\n');
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(txt),
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(txt);
}

function serveSitemap(req, res) {
  const origin = siteOrigin(req);
  const db = store.get();
  const urls = [];

  /* SPA 用的是 hash 路由，但 # 之后的部分爬虫不当独立 URL。
     这里给出不带 hash 的路径没有意义，所以统一给出根路径 + 可被索引的入口，
     真正的商品页靠前端渲染后由搜索引擎执行 JS 抓取。
     等迁到 history 路由后，这里可以逐商品输出。 */
  urls.push({ loc: origin + '/', pr: '1.0', freq: 'daily' });

  const cols = (db.collections || []).filter(c => c.visible !== false);
  for (const c of cols) {
    urls.push({ loc: origin + '/#/collections/' + c.handle, pr: '0.8', freq: 'weekly' });
  }
  for (const p of (db.products || []).filter(x => x.active)) {
    urls.push({ loc: origin + '/#/products/' + p.handle, pr: '0.7', freq: 'weekly' });
  }
  for (const key of Object.keys(db.pages || {})) {
    urls.push({ loc: origin + '/#/pages/' + key, pr: '0.3', freq: 'monthly' });
  }

  const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u =>
      '  <url><loc>' + u.loc.replace(/&/g, '&amp;') + '</loc>' +
      '<priority>' + u.pr + '</priority>' +
      '<changefreq>' + u.freq + '</changefreq></url>').join('\n') +
    '\n</urlset>\n';

  res.writeHead(200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'public, max-age=1800',
  });
  res.end(body);
}

/* ---------------- 主处理 ---------------- */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  // 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  res.on('finish', () => {
    if (pathname.startsWith('/api/')) {
      console.log('%s %s → %d (%dms)', req.method.padEnd(6), pathname, res.statusCode, Date.now() - started);
    }
  });

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' } });
    }
    if (pathname === '/robots.txt') return serveRobots(req, res);
    if (pathname === '/sitemap.xml') return serveSitemap(req, res);
    if (pathname.startsWith('/uploads/')) return serveUpload(req, res, pathname);
    return serveStatic(req, res, pathname);
  }

  try {
    const query = Object.fromEntries(url.searchParams.entries());
    let matched = null;
    let params = {};
    let pathExists = false;

    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (r.method !== req.method) continue;
      params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      matched = r;
      break;
    }

    if (!matched) {
      if (pathExists) {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', req.method + ' is not supported on ' + pathname + '.');
      }
      throw E.notFound('No such endpoint: ' + pathname);
    }

    /* 只有上传接口放宽到 8 MB（base64 后体积约是原图的 1.35 倍），
       其余接口维持 256 KB，避免全站被一个大 body 拖住。 */
    const bodyLimit = pathname === '/api/v1/admin/uploads' ? 8 * 1024 * 1024 : undefined;
    const body = await readBody(req, bodyLimit);
    req.query = query;
    req.params = params;
    req.body = body;
    /* 支付回调（webhook）验签必须基于原始字节 —— 见 lib/http.js 的 withRaw */
    req.rawBody = (body && typeof body === 'object' && body.__raw) ? body.__raw : '';

    await matched.handler(req, res);
  } catch (err) {
    fail(res, err);
  }
});

/* 未捕获异常不能让进程退出——一个坏请求不该打挂整站 */
process.on('uncaughtException', e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

store.load();

/* 上传的图片在保存商品之前就已经落盘了：中途放弃、删商品、换图都会留下孤儿文件。
   每小时扫一次，只删「没被任何商品引用且超过 24 小时」的，避免误删正在编辑的图。 */
(function sweepLoop() {
  const run = () => {
    try {
      const n = uploads.sweepOrphans(store.get());
      if (n) console.log('[uploads] 已清理 %d 张未被引用的图片', n);
    } catch (e) { console.error('[uploads] 清理失败', e.message); }
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
})();

server.listen(PORT, () => {
  const db = store.get();
  console.log('TIDEGLASS API 已启动 → http://localhost:' + PORT);
  console.log('  数据：%s（商品 %d / 订单 %d）', store.FILE, db.products.length, db.orders.length);
  console.log('  前台：http://localhost:%d/   后台：http://localhost:%d/#/admin', PORT, PORT);
  console.log('  健康检查：GET /api/v1/health');
  /* 支付通道自检：生产环境若仍是 mock，等于全站免费下单，必须喊出来 */
  const pay = require('./lib/payments');
  const active = pay.getProvider();
  pay.assertProductionSafe();
  console.log('  支付通道：%s（%s，密钥%s）',
    active.id,
    active.isAsync ? '异步确认 · webhook 落账' : '同步 · 仅用于开发与回归',
    active.isConfigured() ? '已配置' : '未配置');
});
