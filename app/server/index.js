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

const store = require('./lib/store');
const uploads = require('./lib/uploads');
const { send, fail, readBody, E, CORS, ApiError, resetRateLimits } = require('./lib/http');

const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = process.env.API_PORT || process.env.PORT || 4600;

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
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || !rel) rel = '/index.html';
  // 目录穿越防护：解析后必须仍在 WEB_DIR 内
  const target = path.normalize(path.join(WEB_DIR, rel));
  if (!target.startsWith(WEB_DIR)) {
    return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Invalid path.' } });
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 兜底：未知路径回 index.html，让前端路由接管
      const fallback = path.join(WEB_DIR, 'index.html');
      return fs.readFile(fallback, (e2, buf) => {
        if (e2) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
        res.writeHead(200, {
          'Content-Type': MIME['.html'],
          'Cache-Control': 'no-cache',
        });
        res.end(buf);
      });
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': /\.(png|jpg|jpeg|webp|woff2)$/.test(ext) ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(target).pipe(res);
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
    res.writeHead(200, {
      'Content-Type': uploads.EXT_MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
    });
    fs.createReadStream(file).pipe(res);
  });
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

    await matched.handler(req, res);
  } catch (err) {
    fail(res, err);
  }
});

/* 未捕获异常不能让进程退出——一个坏请求不该打挂整站 */
process.on('uncaughtException', e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

store.load();
server.listen(PORT, () => {
  const db = store.get();
  console.log('TIDEGLASS API 已启动 → http://localhost:' + PORT);
  console.log('  数据：%s（商品 %d / 订单 %d）', store.FILE, db.products.length, db.orders.length);
  console.log('  前台：http://localhost:%d/   后台：http://localhost:%d/#/admin', PORT, PORT);
  console.log('  健康检查：GET /api/v1/health');
});
