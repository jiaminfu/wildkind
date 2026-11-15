/* ============================================================
   LASTGROVE · Airwallex 通道（骨架，待密钥到位后联调）
   ------------------------------------------------------------
   选它的理由：目前唯一同时满足「中国大陆营业执照可开户 + 真卡收单 +
   Apple/Google Pay + 直接结汇到对公人民币账户」的通道，是本项目
   在拿不到 Stripe 境外主体时的主方案。

   ⚠ 本文件与 stripe.js 的成熟度不同：
     - stripe.js 的接口路径、参数、签名算法已按官方文档写全，可直接联调；
     - 本文件按 Airwallex 公开 API 结构写成，但**未经真实账号验证**，
       标注 [TODO-VERIFY] 的字段必须在拿到沙盒密钥后逐一核对官方文档。
     宁可留明确的待办，也不假装能用 —— 支付代码里猜错一个字段，
     表现是「下单成功但钱没到账」，比直接报错危险得多。

   环境变量：
     AIRWALLEX_API_KEY      后台 Developer → API keys
     AIRWALLEX_CLIENT_ID
     AIRWALLEX_WEBHOOK_SECRET
     AIRWALLEX_API_BASE     默认 https://api.airwallex.com
   ============================================================ */
'use strict';
const https = require('https');
const crypto = require('crypto');

const HOST = String(process.env.AIRWALLEX_API_BASE || 'https://api.airwallex.com')
  .replace(/^https?:\/\//, '').replace(/\/+$/, '');

/* 登录拿到的 token 有效期约 30 分钟，缓存起来避免每单都登录一次 */
let cached = { token: '', exp: 0 };

function credentials() {
  return {
    apiKey: String(process.env.AIRWALLEX_API_KEY || '').trim(),
    clientId: String(process.env.AIRWALLEX_CLIENT_ID || '').trim(),
  };
}

function webhookSecret() {
  return String(process.env.AIRWALLEX_WEBHOOK_SECRET || '').trim();
}

function call(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body == null ? '' : JSON.stringify(body);
    const req = https.request({
      hostname: HOST,
      port: 443,
      path: path,
      method: method,
      timeout: 20000,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-api-version': '2022-11-11',
      }, token ? { 'Authorization': 'Bearer ' + token } : {}),
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 兜底见下 */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
        const err = new Error('Airwallex: ' +
          ((json && (json.message || json.error)) || ('HTTP ' + res.statusCode)));
        err.status = 502;
        err.code = 'AIRWALLEX_ERROR';
        err.detail = json;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Airwallex request timed out after 20s')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function token() {
  if (cached.token && cached.exp > Date.now() + 60 * 1000) return cached.token;
  const c = credentials();
  const r = await call('POST', '/api/v1/authentication/login',
    { apiKey: c.apiKey, clientId: c.clientId });
  const t = String(r.token || '');
  if (!t) throw Object.assign(new Error('Airwallex login returned no token.'), { status: 502 });
  cached = { token: t, exp: Date.now() + (Number(r.expiresAt) ? 0 : 25 * 60 * 1000) };
  /* [TODO-VERIFY] expiresAt 的语义（绝对时间戳还是相对秒数）需按文档确认；
     保守取 25 分钟，宁可早一点重新登录。 */
  return t;
}

module.exports = {
  id: 'airwallex',
  label: 'Airwallex',
  supports: ['card', 'apple_pay', 'google_pay'],
  isAsync: true,

  isConfigured() {
    const c = credentials();
    return !!(c.apiKey && c.clientId && webhookSecret());
  },

  /* ctx: { orderNumber, amount, currency, email, description, returnUrl, meta } */
  async createSession(ctx) {
    const c = ctx || {};
    const amount = Math.round(Number(c.amount || 0) * 100) / 100;
    if (!(amount > 0)) {
      throw Object.assign(new Error('Order total must be greater than zero.'),
        { status: 422, code: 'AMOUNT_INVALID' });
    }

    const t = await token();
    const body = {
      /* [TODO-VERIFY] request_id 用于幂等，官方要求唯一字符串 */
      request_id: 'tg-' + (c.orderNumber || '') + '-' + Date.now(),
      amount: { value: amount, currency: String(c.currency || 'USD').toUpperCase() },
      merchant_order_id: String(c.orderNumber || ''),
      return_url: c.returnUrl || ((process.env.PUBLIC_URL || '') + '/#/order/confirm'),
      /* [TODO-VERIFY] descriptor 有长度上限（常见 22 字符），且会显示在持卡人账单上 */
      descriptor: String(c.description || 'LASTGROVE').slice(0, 22),
      metadata: Object.assign({ ref: c.ref || '', orderNumber: c.orderNumber || '' }, c.meta || {}),
    };

    const r = await call('POST', '/api/v1/pa/payment_intents/create', body, t);

    return {
      /* [TODO-VERIFY] 确认前端走 Hosted Page 还是 Drop-in：
         Hosted Page 用返回的 url 跳转（mode: 'redirect'）；
         Drop-in / Elements 用 client_secret（mode: 'embedded'）。
         本项目 PRD 是内嵌，倾向 embedded，但需实测组件行为后定。 */
      mode: 'embedded',
      payment: {
        provider: 'airwallex',
        mode: 'live',
        reference: String(r.id || ''),
        last4: '',
      },
      sessionId: String(r.id || ''),
      clientSecret: String(r.client_secret || ''),
    };
  },

  /* [TODO-VERIFY] 签名格式：Airwallex 的 x-signature 由「时间戳 + HMAC-SHA256」组成，
     具体分隔形式（'t=..,v1=..' 还是 'timestamp,signature'）以文档为准。
     下面的实现按常见形式写，联调第一步就要用真实回调打一遍验证。 */
  async verifyWebhook(rawBody, headers) {
    const h = headers || {};
    const secret = webhookSecret();
    if (!secret) return { ok: false, reason: 'AIRWALLEX_WEBHOOK_SECRET is not set.' };

    const sigHeader = String(h['x-signature'] || '');
    if (!sigHeader) return { ok: false, reason: 'Missing x-signature header.' };

    const parts = sigHeader.split(',').map(s => s.trim());
    const ts = parts[0] || '';
    const sig = parts[1] || '';
    if (!ts || !sig) return { ok: false, reason: 'Malformed x-signature header.' };

    const expected = crypto.createHmac('sha256', secret)
      .update(ts + rawBody, 'utf8').digest('hex');

    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Signature mismatch.' };
    }

    let event = null;
    try { event = JSON.parse(rawBody); }
    catch (e) { return { ok: false, reason: 'Body is not valid JSON.' }; }

    const obj = (event && event.data && event.data.object) || {};
    const name = String(event.name || event.type || '');
    const map = {
      'payment_intent.succeeded': 'paid',
      'payment_intent.captured': 'paid',
      'payment_intent.failed': 'failed',
      'payment_intent.cancelled': 'failed',
      'refund.succeeded': 'refunded',
    };

    return {
      ok: true,
      event: name,
      eventId: String(event.id || ''),
      status: map[name] || null,
      ref: String((obj.metadata && obj.metadata.ref) || obj.merchant_order_id || ''),
      orderNumber: String((obj.metadata && obj.metadata.orderNumber) || ''),
      reference: String(obj.id || ''),
      paymentIntent: String(obj.id || ''),
      amount: obj.amount != null ? Number(obj.amount) : null,
      currency: String((obj.currency) || '').toUpperCase(),
    };
  },

  async refund(opts) {
    const o = opts || {};
    if (!o.paymentIntent) {
      throw Object.assign(new Error('Refund needs the original payment intent id.'),
        { status: 422, code: 'REFUND_NO_INTENT' });
    }
    const t = await token();
    /* [TODO-VERIFY] 退款接口路径与参数（是否支持部分退款、幂等键字段名） */
    const r = await call('POST', '/api/v1/pa/refunds/create', {
      payment_intent_id: o.paymentIntent,
      amount: o.amount != null ? Number(o.amount) : undefined,
      reason: o.reason || 'requested_by_customer',
      metadata: { orderNumber: o.orderNumber || '' },
    }, t);

    return {
      ok: true,
      provider: 'airwallex',
      reference: String(r.id || ''),
      status: String(r.status || ''),
      amount: r.amount != null ? Number(r.amount) : o.amount,
    };
  },
};
