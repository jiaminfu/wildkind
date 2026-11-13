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

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(null);
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
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
