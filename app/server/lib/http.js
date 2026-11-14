/* ============================================================
   TIDEGLASS · HTTP 工具
   统一响应结构、CORS、JSON 解析、错误类型、限流。
   错误结构（全站一致，前端只需判断 error.code）：
     { "error": { "code": "OUT_OF_STOCK", "message": "...", "details": [...] } }
   ============================================================ */
'use strict';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || null;
  }
}

const E = {
  badRequest: (m, d) => new ApiError(400, 'BAD_REQUEST', m || 'Invalid request.', d),
  unauthorized: (m) => new ApiError(401, 'UNAUTHORIZED', m || 'Sign in required.'),
  forbidden: (m) => new ApiError(403, 'FORBIDDEN', m || 'You do not have permission to do that.'),
  notFound: (m) => new ApiError(404, 'NOT_FOUND', m || 'Not found.'),
  conflict: (m, d) => new ApiError(409, 'CONFLICT', m || 'Conflicts with current state.', d),
  unprocessable: (code, m, d) => new ApiError(422, code, m, d),
  tooMany: (m) => new ApiError(429, 'RATE_LIMITED', m || 'Too many requests. Try again shortly.'),
  internal: (m) => new ApiError(500, 'INTERNAL', m || 'Something went wrong.'),
};

const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key,X-Request-Id',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, payload, extraHeaders) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    /* 413 时请求体还剩一大截没读，连接无法复用，必须显式关掉。
       不然客户端会等一个永远不会来的响应尾巴。 */
    ...(status === 413 ? { Connection: 'close' } : {}),
  }, CORS, extraHeaders || {}));
  res.end(body);
}

function ok(res, data, status) { send(res, status || 200, { data }); }

function fail(res, err) {
  if (err instanceof ApiError) {
    return send(res, err.status, {
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  console.error('[unhandled]', err);
  send(res, 500, { error: { code: 'INTERNAL', message: 'Something went wrong.' } });
}

const MAX_BODY = 1024 * 256;   // 256 KB，订单/商品都远小于此

/* 图片上传走 base64 JSON，一张压缩后的实拍图约 300~550 KB，
   仅对上传接口单独放宽（见 index.js），其余接口保持 256 KB 不变，
   免得给全站开了个 8 MB 的口子。

   超限的处理方式改过一次，值得记下来：
   原先 reject 之后立刻 req.destroy()，socket 当场销毁——413 响应虽然写进了
   res，但连接已经断了，客户端只看到 "connection reset"，用户界面上就是
   「网络错误」。正确顺序是先让 413 响应发出去，再让连接关（send() 里带
   Connection: close），期间暂停读取即可，不能提前销毁。 */
function readBody(req, limit) {
  const max = limit || MAX_BODY;
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(null);

    /* 有 Content-Length 且明显超限时，一个字节都不必读。
       这是最常见的情形（浏览器、curl、fetch 都会带这个头）。 */
    const declared = parseInt(req.headers['content-length'], 10);
    if (declared && declared > max) {
      req.resume();   // 丢弃剩余数据，但保持连接可写，好让 413 发出去
      return reject(new ApiError(413, 'PAYLOAD_TOO_LARGE',
        'Request body is too large (limit ' + Math.round(max / 1024) + ' KB).'));
    }

    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', c => {
      if (over) return;                 // 超限后不再累积，避免内存被打爆
      size += c.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        req.pause();
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE',
          'Request body is too large (limit ' + Math.round(max / 1024) + ' KB).'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/json')) {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new ApiError(400, 'INVALID_JSON', 'Body is not valid JSON.')); }
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        resolve(Object.fromEntries(new URLSearchParams(raw)));
      } else {
        resolve(raw);
      }
    });
    req.on('error', reject);
  });
}

/* 简易令牌桶：按 IP + 路由分组限流。
   单进程内存计数——多实例部署需换 Redis（已在 SDD 9.3 标注）。 */
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  if (b.count > limit) {
    const retry = Math.ceil((b.reset - now) / 1000);
    throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again in ' + retry + 's.',
      { retryAfter: retry });
  }
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

/* 清空限流计数。仅供测试复位端点调用：
   一套自动化用例会连发几十个下单请求，跑第二遍时必然撞上 20 次/分钟的阈值，
   被自己的限流挡住——那样测出来的就不是业务问题，而是测试噪音。 */
function resetRateLimits() {
  buckets.clear();
}

module.exports = { ApiError, E, send, ok, fail, readBody, rateLimit, resetRateLimits, clientIp, CORS };
